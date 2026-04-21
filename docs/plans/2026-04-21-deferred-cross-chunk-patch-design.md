# 延迟跨 Chunk 补刷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将跨 chunk 方块的渲染补刷从 chunk 首次加载高峰期延后到 runtime idle 阶段，降低 streaming 时 `appendScatteredBlocks -> consolidation -> AO` 链式尖峰。

**Architecture:** 首帧只渲染 chunk 自身坐标范围内的方块；跨 chunk 方块仍由 Worker 正常生成和收集，但进入 `BlockScatterManager` 的延迟补刷 buffer。新增可复用的 runtime idle 调度器，允许各系统注册空闲回调；`World.update()` 只负责喂入 idle 信号和执行预算内回调，跨 chunk 补刷作为其中一个 idle task 按玩家所在 chunk 向外逐层低预算执行。

**Tech Stack:** Vanilla JS, Three.js, ES Modules, Web Workers, Map/Set, browser test page

---

## 背景与问题

当前跨 chunk 方块会被 `BlockScatterManager.scatter()` 按真实坐标分发到目标 chunk。目标 chunk 如果已经 `isReady`，`flushReadyChunks()` 会调用 `chunk.appendScatteredBlocks()`。该路径会写入 `blockData`、增加 `dirtyBlocks`，然后在非 defer 情况下触发 `scheduleConsolidation()`。

这会把跨 chunk 方块补刷放在 chunk 首次生成和 runtime streaming 的高峰期执行，导致以下重活串联：

- `appendScatteredBlocks()` 打脏目标 chunk。
- `consolidate()` 把整个 chunk 快照发回 WorldWorker 重算可见面和 AO。
- `_applyConsolidateResult()` 清理旧 mesh、重建 InstancedMesh、重建光源和数组存储。
- `onChunkAOSourceStable()` 触发当前 chunk 与邻居边界 AO 刷新。
- 如果处在 assembly finalize 阶段，`dirtyBlocks > 0` 会让 chunk 卡在 `waiting-consolidation`。

本计划的目标不是永久取消跨 chunk 方块，而是改变时机和节奏：首帧先快，跨 chunk 补刷在空闲期、按玩家距离、有预算地做。

## 设计原则

1. **数据语义不变**：跨 chunk 方块最终仍归属于其坐标所在 chunk，不引入源 chunk 永久越界 owner。
2. **首帧不补刷跨 chunk**：chunk 首次渲染只消费自身范围内方块，避免 ready chunk 被其他 worker 回包反复打脏。
3. **收集不丢弃**：跨 chunk 方块仍完整收集到延迟 buffer，不能像 `skipCrossChunk` 那样直接丢失。
4. **空闲调度可复用**：runtime idle 不写成某个场景的私有 if 判断，而是封装成可注册回调的调度器。
5. **补刷可中断**：只要新 chunk 创建、worker 回包、assembly queue 有工作，暂停补刷。
6. **补刷限预算**：每帧最多处理少量 chunk/block，优先玩家附近，向外围逐层推进。
7. **合并也限流**：补刷写入后只进入 deferred consolidation queue，不能同帧或立即触发大量 WorldWorker 重算。
8. **AO 后置且局部化**：补刷引起的 AO 刷新应依赖 consolidation 完成后的现有稳定源流程，但需要避免额外 full refresh 扩散。

## 核心数据流

### 现状

```text
WorldWorker result
  -> BlockScatterManager.scatter()
  -> chunkBuffers 按目标 chunk 收集
  -> flushReadyChunks()
     -> 首次: acceptScatteredBlocks()
     -> ready chunk: appendScatteredBlocks()
        -> scheduleConsolidation()
        -> AOWorker refresh
```

### 目标

```text
WorldWorker result
  -> BlockScatterManager.scatter()
     -> own blocks: chunkBuffers
     -> cross chunk blocks: pendingCrossChunkPatchBuffers
  -> flushReadyChunks()
     -> 首次: acceptScatteredBlocks() 只处理自身范围
     -> 不再即时 append 跨 chunk patch

World.update()
  -> runtimeIdleScheduler.markBusy/markIdleCandidate
  -> runtimeIdleScheduler.process()
     -> crossChunkPatch idle task
        -> flushDeferredCrossChunkPatchesAround(playerCx, playerCz)
     -> 按玩家距离取最近 ready chunk
     -> appendDeferredCrossChunkPatch(..., deferConsolidation=true)
     -> queueDeferredConsolidation(chunk)

     -> deferredConsolidation idle task
        -> _processDeferredConsolidationQueue(maxChunks=1)
        -> chunk.scheduleConsolidation()
        -> consolidation 完成后刷新 AO
```

## Runtime Idle 调度器设计

新增一个专门的 runtime idle 调度器，不直接把空闲判断写在跨 chunk 补刷逻辑里。玩家停住但 worker 仍在回包时，补刷仍会抢资源，所以 idle 应该表达“世界 streaming 当前没有主路径工作”，而不是单纯“玩家不动”。

建议新增文件：

```text
src/world/RuntimeIdleScheduler.js
```

它提供一个小型事件/任务注册接口：

```js
const unsubscribe = runtimeIdleScheduler.registerTask({
  id: 'cross-chunk-patch',
  priority: 100,
  minIdleMs: 1000,
  run: (context) => {
    // 返回本次是否做了工作
    return { didWork: true, consumedBudgetMs: 1.2 };
  }
});
```

调度器职责：

- 维护最近 busy 时间：`lastBusyAt`。
- 接收 World 每帧传入的状态上下文。
- 判断当前是否处于 runtime idle。
- 按 priority 顺序运行已注册 idle task。
- 限制每帧 idle task 总预算。
- 支持 task 返回 `didWork`，方便同一帧避免继续执行低优先级重活。
- 支持 `unregister`，避免未来系统卸载后回调泄漏。

World 侧只负责告诉调度器何时 busy：

- 新 chunk 创建/卸载时 busy。
- Worker result 到达并进入 `onChunkDataLoaded()` 时 busy。
- `chunkAssemblyScheduler.hasWork()` 时 busy。
- bootstrap 阶段不是 runtime idle。

建议全局常量：

```js
const RUNTIME_IDLE_GRACE_MS = 1000;
const RUNTIME_IDLE_FRAME_BUDGET_MS = 2;
const CROSS_CHUNK_PATCH_MAX_CHUNKS_PER_FRAME = 1;
const CROSS_CHUNK_PATCH_MAX_BLOCKS_PER_FRAME = 400;
```

如果实际补刷仍有卡顿，先降低 `MAX_BLOCKS_PER_FRAME`，不要提高 idle grace 掩盖问题。

## 文件职责

### `src/world/BlockScatterManager.js`

负责跨 chunk 方块的收集与延迟补刷队列。

新增职责：

- 维护 `pendingCrossChunkPatchBuffers`。
- `scatter()` 将本 chunk blocks 与跨 chunk blocks 分流。
- `flushReadyChunks()` 不再把跨 chunk buffer 立即追加到 ready chunk。
- 提供 `flushDeferredCrossChunkPatchesAround(playerCx, playerCz, options)`。
- 提供统计信息：pending chunk 数、pending block 数、本帧补刷 block 数。

### `src/world/World.js`

负责把世界运行状态喂给 runtime idle 调度器，并注册本世界自己的 idle task。

新增职责：

- 创建 `RuntimeIdleScheduler` 实例。
- 在 chunk 拓扑变化、worker 回包、assembly queue 有工作时标记 busy。
- 注册 `cross-chunk-patch` idle task。
- 注册或迁移 `deferred-consolidation` idle task。
- 通过 idle task 的 priority 保证跨 chunk patch 和 consolidation 不在同一帧叠加过重。

### `src/world/RuntimeIdleScheduler.js`

负责可复用 runtime idle 事件和任务调度。

新增职责：

- `registerTask(task)` / 返回 unsubscribe。
- `markBusy(reason, now)`。
- `isIdle(context, now)`。
- `process(context, options)`。
- `getStats()`。

### `src/world/Chunk.js`

负责提供明确的延迟补刷入口。

新增职责：

- `appendDeferredCrossChunkPatch()` 包装 `appendScatteredBlocks(..., { deferConsolidation: true })`。
- 补刷写入后不立即 `scheduleConsolidation()`。
- 必要时返回实际 appended count，方便调度器扣预算。

### `src/tests/`

当前项目浏览器内测试，没有 CLI 测试命令。建议补充 `test-world.js` 或 `test-chunk.js` 中的轻量单元测试，覆盖分流和排序逻辑。完成后仍需启动 `npm run start` 并在浏览器访问 `http://localhost:8080/src/tests/index.html`。

---

## Task 1: BlockScatterManager 增加延迟跨 chunk buffer

**Files:**
- Modify: `src/world/BlockScatterManager.js`
- Test: `src/tests/test-world.js` 或新增适合的浏览器测试文件

- [ ] **Step 1: 添加 buffer 初始化**

在 constructor 中新增：

```js
this.pendingCrossChunkPatchBuffers = new Map();
```

buffer 结构：

```js
{
  blocks: [],
  visibleBlockKeys: new Set(),
  structureCenters: null,
  sourceWorkers: new Set(),
  lastUpdatedAt: 0
}
```

- [ ] **Step 2: 提取 buffer helper**

新增内部方法，避免 `chunkBuffers` 和 `pendingCrossChunkPatchBuffers` 重复创建逻辑：

```js
_getOrCreateBuffer(map, chunkKey) {
  let buffer = map.get(chunkKey);
  if (!buffer) {
    buffer = {
      blocks: [],
      ready: false,
      sourceWorkers: new Set(),
      visibleBlockKeys: new Set(),
      structureCenters: null,
      lastUpdatedAt: 0
    };
    map.set(chunkKey, buffer);
  }
  return buffer;
}
```

- [ ] **Step 3: 修改 scatter 分流**

`blockDataBlocks` 遍历时：

- 本 chunk 方块进入 `this.chunkBuffers`。
- 跨 chunk 方块进入 `this.pendingCrossChunkPatchBuffers`。
- `skipCrossChunk` 开启时仍跳过跨 chunk 方块，保留调试语义。

伪代码：

```js
const isOwnChunk = chunkCx === cx && chunkCz === cz;
const targetMap = isOwnChunk ? this.chunkBuffers : this.pendingCrossChunkPatchBuffers;
const buffer = this._getOrCreateBuffer(targetMap, chunkKey);
buffer.blocks.push(block);
buffer.sourceWorkers.add(`${cx},${cz}`);
buffer.lastUpdatedAt = now;
```

注意：`visibleKeysSet` 同样写入对应 buffer 的 `visibleBlockKeys`。

- [ ] **Step 4: structureCenters 只合并到触达 buffer**

现有 `touchedBuffers` 可以继续使用，但要同时包含 own buffer 和 cross patch buffer。不要把本次 worker 的 structureCenters 灌入所有历史 pending buffer。

- [ ] **Step 5: flushReadyChunks 不处理 pendingCrossChunkPatchBuffers**

`flushReadyChunks()` 只处理 `chunkBuffers`。跨 chunk pending buffer 只能由新的 deferred flush 方法消费。

- [ ] **Step 6: unloadChunk 清理两类 buffer**

```js
unloadChunk(chunkKey) {
  this.chunkBuffers.delete(chunkKey);
  this.pendingCrossChunkPatchBuffers.delete(chunkKey);
}
```

- [ ] **Step 7: 添加统计方法**

```js
getPendingCrossChunkPatchStats() {
  let blocks = 0;
  for (const buffer of this.pendingCrossChunkPatchBuffers.values()) {
    blocks += buffer.blocks.length;
  }
  return {
    chunks: this.pendingCrossChunkPatchBuffers.size,
    blocks
  };
}
```

- [ ] **Step 8: 运行 lint**

Run: `npm run lint`

Expected: PASS。

---

## Task 2: 实现按玩家中心向外的 deferred flush

**Files:**
- Modify: `src/world/BlockScatterManager.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 添加排序方法**

```js
_getPendingPatchKeysByDistance(playerCx, playerCz) {
  return [...this.pendingCrossChunkPatchBuffers.keys()].sort((a, b) => {
    const [ax, az] = a.split(',').map(Number);
    const [bx, bz] = b.split(',').map(Number);
    const da = Math.abs(ax - playerCx) + Math.abs(az - playerCz);
    const db = Math.abs(bx - playerCx) + Math.abs(bz - playerCz);
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
}
```

- [ ] **Step 2: 添加 flushDeferredCrossChunkPatchesAround**

```js
flushDeferredCrossChunkPatchesAround(playerCx, playerCz, options = {}) {
  const maxChunks = Number.isFinite(options.maxChunks) ? options.maxChunks : 1;
  const maxBlocks = Number.isFinite(options.maxBlocks) ? options.maxBlocks : 400;
  let processedChunks = 0;
  let processedBlocks = 0;

  for (const key of this._getPendingPatchKeysByDistance(playerCx, playerCz)) {
    if (processedChunks >= maxChunks || processedBlocks >= maxBlocks) break;

    const chunk = this.world.chunks.get(key);
    const buffer = this.pendingCrossChunkPatchBuffers.get(key);
    if (!buffer) continue;

    if (!chunk || chunk.disposed) {
      this.pendingCrossChunkPatchBuffers.delete(key);
      continue;
    }
    if (!chunk.isReady || chunk.isConsolidating) continue;
    if (buffer.blocks.length === 0) {
      this.pendingCrossChunkPatchBuffers.delete(key);
      continue;
    }

    const remainingBudget = maxBlocks - processedBlocks;
    const blocks = buffer.blocks.length > remainingBudget
      ? buffer.blocks.splice(0, remainingBudget)
      : buffer.blocks.splice(0, buffer.blocks.length);

    const appended = chunk.appendDeferredCrossChunkPatch?.(
      blocks,
      buffer.visibleBlockKeys,
      buffer.structureCenters
    ) ?? 0;

    processedBlocks += blocks.length;
    processedChunks++;

    if (buffer.blocks.length === 0) {
      this.pendingCrossChunkPatchBuffers.delete(key);
    }
  }

  return { processedChunks, processedBlocks };
}
```

实现时要注意：如果做 block 级分片，`visibleBlockKeys` 会包含本 buffer 的完整集合，短期可以接受，因为 `appendScatteredBlocks()` 会按 key 合并。后续可优化为按本次 blocks 建立局部 visible set。

- [ ] **Step 3: 优先保证 correctness**

如果 `appendDeferredCrossChunkPatch()` 返回实际 appended count，则统计使用 appended count；如果返回 0 且 blocks 被跳过，仍应从 buffer 中移除这些 blocks，避免重复尝试。

- [ ] **Step 4: 添加测试**

测试重点：

- 跨 chunk 方块不会进入 `chunkBuffers`。
- pending keys 按玩家 chunk 曼哈顿距离排序。
- `flushDeferredCrossChunkPatchesAround()` 只处理 ready chunk。
- chunk 不存在或 disposed 时会清理 pending buffer。

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`

Expected: PASS。

---

## Task 3: Chunk 增加延迟补刷入口

**Files:**
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 让 appendScatteredBlocks 返回 appendedCount**

当前 `appendScatteredBlocks()` 内部已有 `appendedCount`。修改返回值：

```js
if (appendedCount === 0) return 0;
...
return appendedCount;
```

`options.deferConsolidation` 分支也返回 `appendedCount`。

- [ ] **Step 2: 添加 appendDeferredCrossChunkPatch**

放在 `appendScatteredBlocks()` 附近：

```js
appendDeferredCrossChunkPatch(scatteredBlocks, visibleBlockKeys, structureCenters) {
  return this.appendScatteredBlocks(scatteredBlocks, visibleBlockKeys, structureCenters, {
    deferConsolidation: true
  });
}
```

- [ ] **Step 3: 确认 defer 路径不会立即 consolidation**

`appendScatteredBlocks()` 的 defer 分支应保持：

```js
this.hasDeferredFinalizeWork = true;
this.world?.queueDeferredConsolidation?.(this);
return appendedCount;
```

不要调用 `scheduleConsolidation()`。

- [ ] **Step 4: 运行 lint**

Run: `npm run lint`

Expected: PASS。

---

## Task 4: 新增 RuntimeIdleScheduler

**Files:**
- Create: `src/world/RuntimeIdleScheduler.js`
- Test: `src/tests/test-world.js` 或新增适合的浏览器测试文件

- [ ] **Step 1: 创建调度器类**

```js
const nowMs = () => (globalThis.performance?.now?.() ?? Date.now());

export class RuntimeIdleScheduler {
  constructor(options = {}) {
    this.idleGraceMs = Number.isFinite(options.idleGraceMs) ? options.idleGraceMs : 1000;
    this.frameBudgetMs = Number.isFinite(options.frameBudgetMs) ? options.frameBudgetMs : 2;
    this.lastBusyAt = nowMs();
    this.tasks = new Map();
    this.stats = {
      lastIdleAt: 0,
      lastBusyReason: 'init',
      processedTasks: 0
    };
  }
}
```

- [ ] **Step 2: 添加 markBusy**

```js
markBusy(reason = 'world-busy', now = nowMs()) {
  this.lastBusyAt = now;
  this.stats.lastBusyReason = reason;
}
```

- [ ] **Step 3: 添加 registerTask**

```js
registerTask(task) {
  if (!task?.id || typeof task.run !== 'function') {
    throw new Error('RuntimeIdleScheduler task requires id and run');
  }
  const normalized = {
    priority: 0,
    minIdleMs: this.idleGraceMs,
    ...task
  };
  this.tasks.set(normalized.id, normalized);
  return () => {
    this.tasks.delete(normalized.id);
  };
}
```

- [ ] **Step 4: 添加 isIdle**

```js
isIdle(context = {}, now = nowMs()) {
  if (context.phase !== 'runtime-streaming') return false;
  if (context.hasAssemblyWork) return false;
  return now - this.lastBusyAt >= this.idleGraceMs;
}
```

- [ ] **Step 5: 添加 process**

```js
process(context = {}, options = {}) {
  const now = nowMs();
  if (!this.isIdle(context, now)) return { processedTasks: 0, didWork: false };

  const frameBudgetMs = Number.isFinite(options.frameBudgetMs)
    ? options.frameBudgetMs
    : this.frameBudgetMs;
  const start = now;
  let processedTasks = 0;
  let didWork = false;

  const tasks = [...this.tasks.values()].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  for (const task of tasks) {
    const current = nowMs();
    if (current - this.lastBusyAt < task.minIdleMs) continue;
    if (current - start >= frameBudgetMs) break;

    const result = task.run({ ...context, now: current });
    processedTasks++;
    if (result?.didWork) {
      didWork = true;
      break;
    }
  }

  if (processedTasks > 0) {
    this.stats.lastIdleAt = nowMs();
    this.stats.processedTasks += processedTasks;
  }

  return { processedTasks, didWork };
}
```

说明：`didWork` 后 break 是保守策略，避免一个空闲帧同时跑多个重活。未来如有轻量任务，可给 task 增加 `continueAfterWork: true`。

- [ ] **Step 6: 添加 getStats**

```js
getStats() {
  return {
    ...this.stats,
    taskCount: this.tasks.size,
    idleForMs: nowMs() - this.lastBusyAt
  };
}
```

- [ ] **Step 7: 添加测试**

测试重点：

- 非 runtime-streaming 不 idle。
- assembly queue 有工作不 idle。
- grace 时间未到不 idle。
- priority 高的 task 先运行。
- task 返回 `didWork` 后低优先级 task 不再同帧运行。
- unsubscribe 后 task 不再运行。

- [ ] **Step 8: 运行 lint**

Run: `npm run lint`

Expected: PASS。

---

## Task 5: World 接入 runtime idle 调度器

**Files:**
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 引入 RuntimeIdleScheduler**

```js
import { RuntimeIdleScheduler } from './RuntimeIdleScheduler.js';
```

- [ ] **Step 2: 添加常量**

在现有 deferred 常量附近添加：

```js
const RUNTIME_IDLE_GRACE_MS = 1000;
const RUNTIME_IDLE_FRAME_BUDGET_MS = 2;
const CROSS_CHUNK_PATCH_MAX_CHUNKS_PER_FRAME = 1;
const CROSS_CHUNK_PATCH_MAX_BLOCKS_PER_FRAME = 400;
```

- [ ] **Step 3: constructor 创建调度器**

```js
this.runtimeIdleScheduler = new RuntimeIdleScheduler({
  idleGraceMs: RUNTIME_IDLE_GRACE_MS,
  frameBudgetMs: RUNTIME_IDLE_FRAME_BUDGET_MS
});
this._registerRuntimeIdleTasks();
```

- [ ] **Step 4: 新增 idle task 注册方法**

```js
_registerRuntimeIdleTasks() {
  this.runtimeIdleScheduler.registerTask({
    id: 'cross-chunk-patch',
    priority: 100,
    minIdleMs: RUNTIME_IDLE_GRACE_MS,
    run: () => {
      const processed = this._processDeferredCrossChunkPatchQueue();
      return { didWork: processed > 0 };
    }
  });

  this.runtimeIdleScheduler.registerTask({
    id: 'deferred-consolidation',
    priority: 50,
    minIdleMs: RUNTIME_IDLE_GRACE_MS,
    run: () => {
      const processed = this._processDeferredConsolidationQueue();
      return { didWork: processed > 0 };
    }
  });
}
```

- [ ] **Step 5: busy 场景调用 markBusy**

在 `onChunkDataLoaded()` 或 worker result 进入点：

```js
this.runtimeIdleScheduler?.markBusy('chunk-worker-result');
```

在 `if (chunkTopologyChanged)` 分支内：

```js
this.runtimeIdleScheduler?.markBusy('chunk-topology-changed');
```

在 `processAssemblyQueues()` 前后，如果 queue 有工作：

```js
if (this.chunkAssemblyScheduler.hasWork()) {
  this.runtimeIdleScheduler?.markBusy('chunk-assembly');
}
```

- [ ] **Step 6: 修改 _processDeferredCrossChunkPatchQueue**

```js
_processDeferredCrossChunkPatchQueue() {
  const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
  const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
  const result = this.scatterManager?.flushDeferredCrossChunkPatchesAround?.(playerCx, playerCz, {
    maxChunks: CROSS_CHUNK_PATCH_MAX_CHUNKS_PER_FRAME,
    maxBlocks: CROSS_CHUNK_PATCH_MAX_BLOCKS_PER_FRAME
  });

  return result?.processedChunks || 0;
}
```

- [ ] **Step 7: update 中接入调度器**

在 runtime-streaming 分支中：

```js
if (this.bootstrapState.phase === 'runtime-streaming') {
  this._processDeferredFinalizeQueue();
  this.runtimeIdleScheduler.process({
    phase: this.bootstrapState.phase,
    hasAssemblyWork: this.chunkAssemblyScheduler.hasWork(),
    playerPosition: this._lastPlayerPos
  });
}
```

`RuntimeIdleScheduler.process()` 会通过 `didWork` 控制同帧不继续执行低优先级重活。

- [ ] **Step 8: 添加统计出口**

```js
getRuntimeIdleStats() {
  return this.runtimeIdleScheduler?.getStats?.() || null;
}
```

- [ ] **Step 9: 运行 lint**

Run: `npm run lint`

Expected: PASS。

---

## Task 6: 调整 deferred consolidation 的节奏和安全性

**Files:**
- Modify: `src/world/World.js`
- Modify only if needed: `src/world/ChunkConsolidation.js`

- [ ] **Step 1: 保持每帧最多 1 个 chunk**

现有 `RUNTIME_DEFERRED_FINALIZE_MAX_CHUNKS = 1` 已满足。不要在本任务中提高。

- [ ] **Step 2: consolidation 只通过 runtime idle task 处理**

因为 idle 条件已经由 `RuntimeIdleScheduler` 控制，`_processDeferredConsolidationQueue()` 内部可以保留轻量安全检查，但不要再维护一套重复 idle 判定，避免未来两边条件不一致。

如果该方法仍可能被其他路径直接调用，应添加注释说明：直接调用者必须确保 runtime idle。

- [ ] **Step 3: 避免 dirtyBlocks=0 的 chunk 滞留**

当前已跳过 `dirtyBlocks <= 0`，但没有删除 key。建议改为删除：

```js
if (!chunk.isReady || chunk.isConsolidating) continue;
if (chunk.dirtyBlocks <= 0) {
  this._pendingDeferredConsolidationChunkKeys.delete(key);
  continue;
}
```

- [ ] **Step 4: 运行 lint**

Run: `npm run lint`

Expected: PASS。

---

## Task 7: AO 刷新范围复核

**Files:**
- Inspect: `src/world/World.js`
- Inspect: `src/world/Chunk.js`
- Modify only if measured necessary

- [ ] **Step 1: 确认补刷路径不会调用 onChunkFinalized**

跨 chunk patch 应只写入 chunk 并排 deferred consolidation，不应走 `onChunkFinalized()` 的 `fullRefresh: true`。

- [ ] **Step 2: 确认 consolidation 后 AO 行为**

当前 `_applyConsolidateResult()` 调用：

```js
this.world?.onChunkAOSourceStable?.(this, { reason: 'consolidation' });
```

`World.onChunkAOSourceStable()` 默认 `fullRefresh=false`、`markNeighborBoundaries=false`，因此不会自动 full refresh。这个行为符合本方案。

- [ ] **Step 3: 如边界 AO 出现明显错误，再增加局部边界标记**

如果补刷后跨 chunk 接缝 AO 明显错误，再考虑在 deferred patch 写入时标记受影响边界附近 dirty AO，而不是全量刷新。

---

## Task 8: 调试统计和人工验证

**Files:**
- Modify: `src/world/BlockScatterManager.js`
- Modify: `src/world/World.js`
- Optional: `src/ui/HUD.js`

- [ ] **Step 1: 暴露统计**

在 `World` 或 `BlockScatterManager` 上提供：

```js
getDeferredCrossChunkPatchStats() {
  return this.scatterManager?.getPendingCrossChunkPatchStats?.() || { chunks: 0, blocks: 0 };
}

getRuntimeIdleStats() {
  return this.runtimeIdleScheduler?.getStats?.() || null;
}
```

- [ ] **Step 2: 控制台验证**

启动游戏后可在控制台观察：

```js
window.game.world.getDeferredCrossChunkPatchStats()
window.game.world.getRuntimeIdleStats()
```

- [ ] **Step 3: 运行开发服务器**

Run: `npm run start`

Expected: 服务在 `http://localhost:8080` 启动。

- [ ] **Step 4: 浏览器内测试**

访问：

```text
http://localhost:8080/src/tests/index.html
```

点击“运行所有测试”。

Expected: 所有测试通过。

- [ ] **Step 5: 游戏内验证**

验证场景：

- 快速移动穿过新区域时，chunk 首帧加载不再因跨 chunk patch 明显卡顿。
- 玩家停止约 1 秒后，附近跨 chunk 结构边缘逐步补齐。
- 补刷时 FPS 不出现持续尖峰。
- 跨 chunk 结构最终可碰撞、可挖掘、可被持久化。
- 离玩家近的 chunk 优先补齐，远处 chunk 后补。

---

## 风险与回滚

### 风险 1: 首帧结构边缘短暂缺块

这是本方案的预期取舍。若视觉不可接受，后续再引入 overflow preview mesh，而不是在本方案里恢复即时补刷。

### 风险 2: pending buffer 堆积

通过 `getPendingCrossChunkPatchStats()` 观察。如果长时间不下降，检查 idle 判定是否过严，或 ready chunk 条件是否阻塞。

### 风险 3: 空闲补刷仍然卡顿

优先降低：

```js
CROSS_CHUNK_PATCH_MAX_BLOCKS_PER_FRAME
```

其次降低每帧 chunk 数。不要把补刷和 consolidation 放回同一帧。

### 风险 4: 跨 chunk 碰撞或挖掘延迟

补刷前目标 chunk 的 blockData 没有这些方块，因此逻辑也暂时不存在。这个与视觉缺块一致。补刷后应恢复正确。

### 回滚点

最小回滚方式：

- `scatter()` 恢复跨 chunk 方块进入 `chunkBuffers`。
- 删除 `pendingCrossChunkPatchBuffers` 和 runtime idle flush 调用。

---

## 完成标准

- `npm run lint` 通过。
- 浏览器测试页所有测试通过。
- streaming 过程中 ready chunk 不再因为跨 chunk 方块立即触发大量 consolidation。
- `window.game.world.getDeferredCrossChunkPatchStats()` 能观察 pending 数随 idle flush 下降。
- 玩家停止后，附近跨 chunk 结构逐步补齐。
- 没有自动提交代码；提交必须等待明确指令。
