# Chunk 流式加载 Staging Buffer 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除玩家奔跑过程中加载 chunk 时的卡顿和画面闪烁，通过 staging buffer 预积累 + 预扩容 + 原子提交 + 淡入动画实现流畅体验。

**Architecture:** 在 GlobalInstancedMeshManager 中引入 staging zone 中间层，新 chunk 的方块先在幕后积累完毕，再一帧内原子提交到 GPU。新增 FrameBudgetGovernor 统一协调各子系统的每帧 CPU 预算，确保总和不超标。新增 ChunkFadeController 驱动 chunk 淡入动画。

**Tech Stack:** Three.js 0.184.0 (WebGPURenderer + TSL Node Material), ES Modules, Web Workers

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/FrameBudgetGovernor.js` | 新建 | 帧预算分配器，根据帧压力动态调整各子系统预算 |
| `src/core/ChunkFadeController.js` | 新建 | chunk 淡入动画控制器，管理 per-instance opacity |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | 新增 staging zone、stageMeshDataForChunk、commitStagedChunk、setChunkOpacity |
| `src/core/AONodeSystem.js` | 修改 | 新增 aOpacity instance attribute 并乘入材质输出 |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 初次加载路径改为写入 staging |
| `src/world/World.js` | 修改 | 集成 FrameBudgetGovernor，重构 update() 调度流程 |
| `src/tests/test-frame-budget-governor.js` | 新建 | FrameBudgetGovernor 单元测试 |
| `src/tests/test-global-instanced-mesh-manager.js` | 修改 | 新增 staging/commit 相关测试 |
| `src/tests/test-chunk-fade-controller.js` | 新建 | ChunkFadeController 单元测试 |

---

### Task 1: FrameBudgetGovernor — 帧预算分配器

**Files:**
- Create: `src/core/FrameBudgetGovernor.js`
- Test: `src/tests/test-frame-budget-governor.js`

- [ ] **Step 1: 创建测试文件 — 验证基本预算分配**

```javascript
// src/tests/test-frame-budget-governor.js
import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { FrameBudgetGovernor } from '../core/FrameBudgetGovernor.js';

describe('FrameBudgetGovernor', (test) => {
  test('正常帧率下返回完整预算', () => {
    const gov = new FrameBudgetGovernor({ targetFps: 100 });
    const budget = gov.allocate(10); // 10ms 帧时长 = 100fps
    assertTrue(budget.initMs > 0, 'initMs 应大于 0');
    assertTrue(budget.assemblyMs >= 1, 'assemblyMs 应至少 1ms');
    assertTrue(budget.commitMs >= 1, 'commitMs 应至少 1ms');
    assertTrue(budget.deferredMs > 0, 'deferredMs 应大于 0');
  });

  test('掉帧时缩减预算', () => {
    const gov = new FrameBudgetGovernor({ targetFps: 100 });
    // 连续喂入高帧时让 EMA 稳定
    for (let i = 0; i < 20; i++) gov.allocate(15);
    const budget = gov.allocate(15); // 15ms = 67fps, pressure > 1.2
    assertTrue(budget.assemblyMs <= 0.5, '严重掉帧时 assemblyMs 应降到最低');
    assertEqual(budget.initMs, 0, '严重掉帧时应暂停 init');
  });

  test('帧率恢复后预算回升', () => {
    const gov = new FrameBudgetGovernor({ targetFps: 100 });
    for (let i = 0; i < 20; i++) gov.allocate(15);
    // 恢复正常帧率
    for (let i = 0; i < 30; i++) gov.allocate(9);
    const budget = gov.allocate(9);
    assertTrue(budget.assemblyMs >= 1, '恢复后 assemblyMs 应回升');
    assertTrue(budget.initMs > 0, '恢复后 initMs 应恢复');
  });

  test('轻微压力时适度缩减', () => {
    const gov = new FrameBudgetGovernor({ targetFps: 100 });
    for (let i = 0; i < 20; i++) gov.allocate(11);
    const budget = gov.allocate(11); // pressure ~1.1
    assertTrue(budget.assemblyMs >= 0.5 && budget.assemblyMs <= 1.5, '轻微压力时 assembly 适度缩减');
    assertTrue(budget.initMs > 0, '轻微压力时 init 不应为 0');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `FrameBudgetGovernor` 模块不存在

- [ ] **Step 3: 实现 FrameBudgetGovernor**

```javascript
// src/core/FrameBudgetGovernor.js
const EMA_ALPHA = 0.15;

export class FrameBudgetGovernor {
  constructor(options = {}) {
    this.targetFps = options.targetFps || 100;
    this.targetFrameMs = 1000 / this.targetFps;
    this.fixedOverheadMs = options.fixedOverheadMs || 6;
    this.frameMsEma = this.targetFrameMs;
  }

  allocate(actualFrameMs) {
    const frameMs = Math.min(100, Math.max(1, actualFrameMs));
    this.frameMsEma = this.frameMsEma * (1 - EMA_ALPHA) + frameMs * EMA_ALPHA;

    const pressure = this.frameMsEma / this.targetFrameMs;

    if (pressure > 1.2) {
      return { initMs: 0, assemblyMs: 0.5, commitMs: 1, deferredMs: 0 };
    }
    if (pressure > 1.0) {
      return { initMs: 0.3, assemblyMs: 1, commitMs: 1.2, deferredMs: 0.3 };
    }
    return { initMs: 0.5, assemblyMs: 1.5, commitMs: 1.5, deferredMs: 0.5 };
  }

  getPressure() {
    return this.frameMsEma / this.targetFrameMs;
  }

  getFrameMsEma() {
    return this.frameMsEma;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/FrameBudgetGovernor.js src/tests/test-frame-budget-governor.js
git commit -m "feat(core): 新增 FrameBudgetGovernor 帧预算分配器"
```

---

### Task 2: GlobalInstancedMeshManager — Staging Zone

**Files:**
- Modify: `src/core/GlobalInstancedMeshManager.js`
- Modify: `src/tests/test-global-instanced-mesh-manager.js`

- [ ] **Step 1: 编写 staging 测试**

在 `src/tests/test-global-instanced-mesh-manager.js` 文件末尾追加：

```javascript
  test('stageMeshDataForChunk 将数据存入 staging 而不写入渲染', () => {
    const { manager } = createManager(4);
    const blocks = [
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 }
    ];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));

    assertEqual(manager.coordToRef.size, 0, 'staging 后不应有渲染实例');
    assertEqual(manager.getStagedChunkKeys().length, 1, '应有 1 个 staged chunk');
    assertEqual(manager.getStagedBlockCount('0,0'), 2, 'staged 方块数应为 2');
  });

  test('commitStagedChunk 原子提交所有方块到渲染', () => {
    const { manager } = createManager(4);
    const blocks = [
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 },
      { x: 3, y: 2, z: 3 }
    ];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    manager.commitStagedChunk('0,0');

    assertEqual(manager.coordToRef.size, 3, 'commit 后应有 3 个渲染实例');
    assertEqual(manager.getStagedChunkKeys().length, 0, 'commit 后 staging 应为空');
    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 3, 'buffer count 应为 3');
  });

  test('commitStagedChunk 预扩容避免中途 ensureCapacity', () => {
    const { scene, manager } = createManager(1); // 初始容量极小
    const blocks = [
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 },
      { x: 3, y: 2, z: 3 },
      { x: 4, y: 2, z: 3 }
    ];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    manager.commitStagedChunk('0,0');

    const buffer = manager.buffers.get('stone');
    assertTrue(buffer.capacity >= 4, '容量应足够容纳所有方块');
    assertEqual(buffer.count, 4, '所有方块应被写入');
    // 旧 mesh 延迟处理，新 mesh 应该已在 scene 中
    const visibleMeshes = scene.children.filter(c => c.visible !== false);
    assertTrue(visibleMeshes.length >= 1, '至少有一个可见 mesh');
  });

  test('removeStagedChunk 清理未提交的 staging 数据', () => {
    const { manager } = createManager(4);
    const blocks = [{ x: 1, y: 2, z: 3 }];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    manager.removeStagedChunk('0,0');

    assertEqual(manager.getStagedChunkKeys().length, 0, '应清空 staging');
    assertEqual(manager.coordToRef.size, 0, '不应有渲染实例');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `stageMeshDataForChunk` 方法不存在

- [ ] **Step 3: 实现 staging zone**

在 `src/core/GlobalInstancedMeshManager.js` 的 `GlobalInstancedMeshManager` 类中添加：

constructor 中追加:
```javascript
    this.stagingZone = new Map(); // chunkKey → { meshDataArray, blockCount }
```

新增方法:
```javascript
  stageMeshDataForChunk(chunkKey, meshDataArray) {
    if (!Array.isArray(meshDataArray)) return 0;
    this._purgeQueuedChunk(chunkKey);

    let blockCount = 0;
    const validData = [];
    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, count, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered || count === 0) continue;
      const entries = Object.entries(instanceIndexMap || {});
      if (entries.length === 0) continue;
      validData.push(data);
      blockCount += entries.length;
    }

    if (blockCount === 0) return 0;
    this.stagingZone.set(chunkKey, { meshDataArray: validData, blockCount });
    return blockCount;
  }

  commitStagedChunk(chunkKey) {
    const staged = this.stagingZone.get(chunkKey);
    if (!staged) return 0;
    this.stagingZone.delete(chunkKey);

    // 1. 预扩容：计算每个 type 需要的容量
    const capacityNeeds = new Map();
    for (const data of staged.meshDataArray) {
      const { type, instanceIndexMap } = data;
      const entries = Object.entries(instanceIndexMap || {});
      const buffer = this.getOrCreateBuffer(type);
      const current = capacityNeeds.get(type) || 0;
      capacityNeeds.set(type, current + entries.length);
    }
    for (const [type, extra] of capacityNeeds) {
      const buffer = this.buffers.get(this.getRenderKey(type));
      if (buffer) {
        buffer.ensureCapacity(buffer.count + extra);
      }
    }

    // 2. 原子写入
    let committed = 0;
    for (const data of staged.meshDataArray) {
      const { type, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;
      const entries = Object.entries(instanceIndexMap || {});
      for (const [coordText, sourceIndex] of entries) {
        const coord = Number(coordText);
        const matrix = matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE);
        this.addVisibleBlock(coord, { type, orientation: orientation?.[sourceIndex] || 0 }, chunkKey, {
          matrix,
          aoLow: aoLow?.[sourceIndex] ?? 1,
          aoHigh: aoHigh?.[sourceIndex] ?? 1,
          orientation: orientation?.[sourceIndex] ?? 0
        }, { commit: false });
        committed++;
      }
    }

    // 3. 一次性 commit
    this.commitDirtyBuffers();
    return committed;
  }

  removeStagedChunk(chunkKey) {
    this.stagingZone.delete(chunkKey);
  }

  getStagedChunkKeys() {
    return Array.from(this.stagingZone.keys());
  }

  getStagedBlockCount(chunkKey) {
    const staged = this.stagingZone.get(chunkKey);
    return staged ? staged.blockCount : 0;
  }

  getStagedChunksForCommit(playerCx, playerCz) {
    const entries = [];
    for (const [chunkKey, staged] of this.stagingZone) {
      const dist = this._getChunkDistance(chunkKey, playerCx, playerCz);
      entries.push({ chunkKey, blockCount: staged.blockCount, distToPlayer: dist });
    }
    entries.sort((a, b) => a.distToPlayer - b.distToPlayer);
    return entries;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/GlobalInstancedMeshManager.js src/tests/test-global-instanced-mesh-manager.js
git commit -m "feat(core): GlobalInstancedMeshManager 新增 staging zone 和原子 commit"
```

---

### Task 3: ChunkGenerator — buildMeshes 改为写入 staging

**Files:**
- Modify: `src/world/ChunkGenerator.js:132-145`

- [ ] **Step 1: 修改 buildMeshes 初次加载路径**

将 `src/world/ChunkGenerator.js` 第 132-145 行修改为：

```javascript
    if (this.world?.globalInstancedMeshManager) {
      const chunkKey = `${this.cx},${this.cz}`;
      const isInitialBuild = this.loadState !== 'finalized' && this.loadState !== 'waiting-consolidation';
      let result;
      if (isInitialBuild) {
        // 新 chunk 首次加载：写入 staging，等待原子 commit
        result = this.world.globalInstancedMeshManager.stageMeshDataForChunk(chunkKey, meshDataArray);
      } else {
        // consolidation 更新：直接 patch（chunk 已在渲染中）
        result = this.world.globalInstancedMeshManager.patchChunkVisibleBlocks(chunkKey, meshDataArray);
      }
      recordChunkPerf('chunk.build-meshes-global', (globalThis.performance?.now?.() ?? Date.now()) - t0, {
        chunkKey,
        meshGroups: meshDataArray.length,
        instanceCount: typeof result === 'number' ? result : result?.queued || 0,
        patchUpdated: result?.updated || 0,
        patchRemoved: result?.removed || 0,
        staged: isInitialBuild
      });
      return;
    }
```

- [ ] **Step 2: 运行测试确认不破坏现有逻辑**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS（现有测试中 buildMeshes 的覆盖路径应仍然工作）

- [ ] **Step 3: 提交**

```bash
git add src/world/ChunkGenerator.js
git commit -m "feat(world): buildMeshes 初次加载路径改为写入 staging"
```

---

### Task 4: World.js — 集成 FrameBudgetGovernor 和 staging commit

**Files:**
- Modify: `src/world/World.js`

- [ ] **Step 1: 引入 FrameBudgetGovernor 并修改 constructor**

在 `src/world/World.js` 顶部 import 区追加：

```javascript
import { FrameBudgetGovernor } from '../core/FrameBudgetGovernor.js';
```

在 constructor 中（约第 166 行 `this.chunkAssemblyScheduler = ...` 之后）追加：

```javascript
    this.frameBudgetGovernor = new FrameBudgetGovernor({ targetFps: 100 });
```

- [ ] **Step 2: 新增 `_processChunkInitQueueBudgeted` 方法**

替换现有的基于帧计数的节流，改为基于时间预算：

```javascript
  _processChunkInitQueueBudgeted(budgetMs) {
    if (this._pendingChunkInitQueue.length === 0) return;
    if (budgetMs <= 0) return;

    const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
    const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
    this._pendingChunkInitQueue.sort((a, b) => {
      const distA = Math.abs(a.cx - playerCx) + Math.abs(a.cz - playerCz);
      const distB = Math.abs(b.cx - playerCx) + Math.abs(b.cz - playerCz);
      return distA - distB;
    });

    // 每次最多初始化 1 个 chunk（数据请求本身是异步的，开销很小）
    const chunk = this._pendingChunkInitQueue.shift();
    if (!chunk || chunk.disposed) return;
    this._requestRuntimeChunkRecord(chunk);
  }
```

- [ ] **Step 3: 新增 `_commitStagedChunks` 方法**

```javascript
  _commitStagedChunks(budgetMs) {
    if (!this.globalInstancedMeshManager) return;
    const staged = this.globalInstancedMeshManager.getStagedChunksForCommit(
      Math.floor(this._lastPlayerPos.x / CHUNK_SIZE),
      Math.floor(this._lastPlayerPos.z / CHUNK_SIZE)
    );
    if (staged.length === 0) return;

    const start = globalThis.performance?.now?.() ?? Date.now();
    for (const entry of staged) {
      const estimatedMs = entry.blockCount * 0.0005;
      if ((globalThis.performance?.now?.() ?? Date.now()) - start + estimatedMs > budgetMs) break;

      this.globalInstancedMeshManager.commitStagedChunk(entry.chunkKey);
      this._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();
      this.runtimeIdleScheduler?.markBusy('staging-commit');
      this.requestShadowMapUpdate('chunk-staged-commit');
    }
  }
```

- [ ] **Step 4: 重构 update() 方法的调度部分**

将 `update()` 方法中约第 1217-1239 行的调度逻辑替换为：

```javascript
    // --- 帧预算协调调度 ---
    const budget = this.frameBudgetGovernor.allocate(dt * 1000);

    this._processChunkInitQueueBudgeted(budget.initMs);

    this.chunkAssemblyScheduler.processWithinBudget({
      budgetMs: budget.assemblyMs,
      maxTasks: 20
    });

    this._commitStagedChunks(budget.commitMs);

    if (this.bootstrapState.phase === 'runtime-streaming') {
      this._processChunkDeltaPatches({ maxMs: Math.min(1.5, budget.deferredMs) });
      this._processDeferredFinalizeQueue();
      this.runtimeIdleScheduler.process({
        phase: this.bootstrapState.phase,
        hasAssemblyWork: this.chunkAssemblyScheduler.hasWork(),
        playerPosition: this._lastPlayerPos
      }, { frameBudgetMs: budget.deferredMs });
    }
```

同时保留旧的 `_processChunkInitQueue` 方法不删除（bootstrap 阶段仍可能使用）。在 bootstrap 阶段使用旧路径，runtime-streaming 使用新路径。完整判断：

```javascript
    // --- 帧预算协调调度 ---
    if (this.bootstrapState.phase === 'runtime-streaming') {
      const budget = this.frameBudgetGovernor.allocate(dt * 1000);
      this._processChunkInitQueueBudgeted(budget.initMs);
      this.chunkAssemblyScheduler.processWithinBudget({
        budgetMs: budget.assemblyMs,
        maxTasks: 20
      });
      this._commitStagedChunks(budget.commitMs);
      this._processChunkDeltaPatches({ maxMs: Math.min(1.5, budget.deferredMs) });
      this._processDeferredFinalizeQueue();
      this.runtimeIdleScheduler.process({
        phase: this.bootstrapState.phase,
        hasAssemblyWork: this.chunkAssemblyScheduler.hasWork(),
        playerPosition: this._lastPlayerPos
      }, { frameBudgetMs: budget.deferredMs });
    } else {
      // bootstrap 阶段保留旧路径
      this._processChunkInitQueue();
      this.processAssemblyQueues();
      const flushBudget = this._computeGlobalInstanceFlushBudget(dt);
      const flushResult = this.globalInstancedMeshManager?.flushMutationQueue?.({
        ...flushBudget,
        playerCx: Math.floor(this._lastPlayerPos.x / CHUNK_SIZE),
        playerCz: Math.floor(this._lastPlayerPos.z / CHUNK_SIZE)
      }) || { processedBlocks: 0, elapsedMs: 0 };
      this._recordStreamingPerfFlush(flushResult, flushBudget);
    }
```

- [ ] **Step 5: 移除 runtime-streaming 中的旧 mutation queue flush**

在上面的新调度逻辑中，runtime-streaming 阶段不再调用 `flushMutationQueue`（因为新 chunk 不再进入 mutation queue）。但 `flushMutationQueue` 保留给可能的遗留场景使用。

- [ ] **Step 6: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/world/World.js
git commit -m "feat(world): 集成 FrameBudgetGovernor，重构 runtime-streaming 调度"
```

---

### Task 5: TypeBuffer 容量 hints 调大

**Files:**
- Modify: `src/world/World.js:83-99`

- [ ] **Step 1: 调大 typeCapacityHints**

将 `World` constructor 中 `globalInstancedMeshManager` 的初始容量配置修改为：

```javascript
    this.globalInstancedMeshManager = new GlobalInstancedMeshManager(this.scene, {
      typeCapacityHints: new Map([
        ['leaves', 8192],
        ['azalea_leaves', 8192],
        ['azalea_flowers', 4096],
        ['yellow_leaves', 8192],
        ['sky_leaves', 8192],
        ['snow_leaves', 8192],
        ['swamp_leaves', 8192],
        ['realistic_oak_leaves', 8192],
        ['realistic_yellow_leaves', 8192],
        ['grass_block', 6144],
        ['dirt', 4096],
        ['stone', 4096],
        ['cobblestone', 4096],
        ['sand', 4096],
      ])
    });
```

- [ ] **Step 2: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/world/World.js
git commit -m "perf(world): 调大 TypeBuffer 初始容量，减少运行时扩容"
```

---

### Task 6: ChunkFadeController — 淡入动画

**Files:**
- Create: `src/core/ChunkFadeController.js`
- Modify: `src/core/GlobalInstancedMeshManager.js`
- Modify: `src/core/AONodeSystem.js`
- Test: `src/tests/test-chunk-fade-controller.js`

- [ ] **Step 1: 创建测试文件**

```javascript
// src/tests/test-chunk-fade-controller.js
import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { ChunkFadeController } from '../core/ChunkFadeController.js';

function createMockManager() {
  const opacityLog = [];
  return {
    opacityLog,
    chunkToCoords: new Map(),
    setChunkOpacity(chunkKey, opacity) {
      opacityLog.push({ chunkKey, opacity });
    }
  };
}

describe('ChunkFadeController', (test) => {
  test('startFadeIn 注册动画', () => {
    const manager = createMockManager();
    const controller = new ChunkFadeController(manager);
    controller.startFadeIn('0,0');
    assertEqual(controller.getActiveCount(), 1, '应有 1 个活跃动画');
  });

  test('update 推进 opacity 从 0 到 1', () => {
    const manager = createMockManager();
    const controller = new ChunkFadeController(manager);
    controller.startFadeIn('0,0', { duration: 100 });

    // 模拟经过 50ms
    controller.update(50);
    assertTrue(manager.opacityLog.length > 0, '应调用 setChunkOpacity');
    const lastOp = manager.opacityLog[manager.opacityLog.length - 1];
    assertTrue(lastOp.opacity > 0 && lastOp.opacity < 1, 'opacity 应在 0-1 之间');

    // 模拟经过 150ms（超过 duration）
    manager.opacityLog.length = 0;
    controller.update(150);
    const finalOp = manager.opacityLog[manager.opacityLog.length - 1];
    assertEqual(finalOp.opacity, 1, '完成后 opacity 应为 1');
    assertEqual(controller.getActiveCount(), 0, '完成后应移除动画');
  });

  test('cancelFadeIn 立即停止并设为完全不透明', () => {
    const manager = createMockManager();
    const controller = new ChunkFadeController(manager);
    controller.startFadeIn('0,0', { duration: 400 });
    controller.cancelFadeIn('0,0');

    assertEqual(controller.getActiveCount(), 0, '取消后应无活跃动画');
    const lastOp = manager.opacityLog[manager.opacityLog.length - 1];
    assertEqual(lastOp.opacity, 1, '取消后应设为完全不透明');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `ChunkFadeController` 不存在

- [ ] **Step 3: 实现 ChunkFadeController**

```javascript
// src/core/ChunkFadeController.js

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export class ChunkFadeController {
  constructor(manager) {
    this.manager = manager;
    this.animations = new Map(); // chunkKey → { startedAt, duration }
    this._lastUpdateAt = 0;
  }

  startFadeIn(chunkKey, options = {}) {
    const duration = options.duration || 400;
    const now = globalThis.performance?.now?.() ?? Date.now();
    this.animations.set(chunkKey, { startedAt: now, duration });
    this.manager.setChunkOpacity(chunkKey, 0);
  }

  cancelFadeIn(chunkKey) {
    this.animations.delete(chunkKey);
    this.manager.setChunkOpacity(chunkKey, 1);
  }

  update(nowOverride) {
    const now = nowOverride ?? (globalThis.performance?.now?.() ?? Date.now());
    for (const [chunkKey, anim] of this.animations) {
      const elapsed = now - anim.startedAt;
      const progress = Math.min(1, elapsed / anim.duration);
      const opacity = smoothstep(progress);
      this.manager.setChunkOpacity(chunkKey, opacity);

      if (progress >= 1) {
        this.animations.delete(chunkKey);
      }
    }
    this._lastUpdateAt = now;
  }

  getActiveCount() {
    return this.animations.size;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 5: 在 GlobalInstancedMeshManager 中添加 setChunkOpacity**

在 `src/core/GlobalInstancedMeshManager.js` 中添加：

```javascript
  setChunkOpacity(chunkKey, opacity) {
    const coords = this.chunkToCoords.get(chunkKey);
    if (!coords) return;
    for (const coord of coords) {
      const ref = this.coordToRef.get(coord);
      if (!ref) continue;
      const buffer = this.buffers.get(ref.renderKey);
      if (!buffer) continue;
      const attrOpacity = buffer.mesh.geometry.getAttribute('aOpacity');
      if (!attrOpacity) continue;
      attrOpacity.array[ref.index] = opacity;
    }
    // 标记所有涉及 buffer 的 opacity 属性需更新
    const touchedBuffers = new Set();
    for (const coord of coords) {
      const ref = this.coordToRef.get(coord);
      if (ref) touchedBuffers.add(ref.renderKey);
    }
    for (const renderKey of touchedBuffers) {
      const buffer = this.buffers.get(renderKey);
      if (buffer) {
        const attrOpacity = buffer.mesh.geometry.getAttribute('aOpacity');
        if (attrOpacity) attrOpacity.needsUpdate = true;
      }
    }
  }
```

- [ ] **Step 6: TypeBuffer._createMesh 添加 aOpacity 属性**

在 `TypeBuffer._createMesh` 方法中，紧接现有 `aAoLow`/`aAoHigh`/`aOrientation` 属性之后添加：

```javascript
    // 所有类型的方块都支持淡入 opacity
    geometry.setAttribute('aOpacity',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1.0), 1)
    );
```

同时在 `ensureCapacity` 中复制旧 opacity 数据：

在获取 `oldOrientation` 之后追加：
```javascript
    const oldOpacity = oldGeometry.getAttribute('aOpacity')?.array || null;
```

在复制 `nextOrientation` 之后追加：
```javascript
    const nextOpacity = this.mesh.geometry.getAttribute('aOpacity');
    if (oldOpacity && nextOpacity) nextOpacity.array.set(oldOpacity.subarray(0, this.count));
```

- [ ] **Step 7: AONodeSystem 中添加 aOpacity 支持**

在 `src/core/AONodeSystem.js` 顶部的 instance attribute 声明区（约第 12-14 行）追加：

```javascript
const aOpacity = attribute('aOpacity', 'float');
```

修改 `applyAOToMaterial` 函数，将 `aOpacity` 乘入材质输出：

```javascript
export function applyAOToMaterial(material) {
  material.colorNode = Fn(() => {
    let base = materialColor;
    if (material.map) {
      base = base.mul(texture(material.map).rgb);
    }
    return mix(base, base.mul(vAo), uAoEnabled);
  })();
  material.opacityNode = aOpacity;
}
```

同时确保使用了 `aOpacity` 的材质设为 `transparent: true`。但这会带来性能问题（alpha 排序），所以改为使用 `alphaTest` 方案：当 opacity < 0.01 时 discard，否则正常渲染：

```javascript
export function applyAOToMaterial(material) {
  material.colorNode = Fn(() => {
    let base = materialColor;
    if (material.map) {
      base = base.mul(texture(material.map).rgb);
    }
    return mix(base, base.mul(vAo), uAoEnabled);
  })();
  material.opacityNode = aOpacity;
  material.transparent = true;
}
```

注意：如果 transparent 全局启用对性能影响过大，可替代方案为仅在淡入期间启用 transparent 并在完成后关闭。但实际验证后再决定——先用最简方案。

- [ ] **Step 8: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 9: 提交**

```bash
git add src/core/ChunkFadeController.js src/core/GlobalInstancedMeshManager.js src/core/AONodeSystem.js src/tests/test-chunk-fade-controller.js
git commit -m "feat(core): 新增 ChunkFadeController 淡入动画 + aOpacity 属性支持"
```

---

### Task 7: World.js — 集成 ChunkFadeController

**Files:**
- Modify: `src/world/World.js`

- [ ] **Step 1: 引入 ChunkFadeController**

在 `src/world/World.js` 顶部 import 区追加：

```javascript
import { ChunkFadeController } from '../core/ChunkFadeController.js';
```

在 constructor 中（FrameBudgetGovernor 初始化之后）追加：

```javascript
    this.chunkFadeController = new ChunkFadeController(this.globalInstancedMeshManager);
```

- [ ] **Step 2: 修改 _commitStagedChunks 触发淡入**

将 `_commitStagedChunks` 方法中 `commitStagedChunk` 调用后追加淡入启动：

```javascript
  _commitStagedChunks(budgetMs) {
    if (!this.globalInstancedMeshManager) return;
    const staged = this.globalInstancedMeshManager.getStagedChunksForCommit(
      Math.floor(this._lastPlayerPos.x / CHUNK_SIZE),
      Math.floor(this._lastPlayerPos.z / CHUNK_SIZE)
    );
    if (staged.length === 0) return;

    const start = globalThis.performance?.now?.() ?? Date.now();
    for (const entry of staged) {
      const estimatedMs = entry.blockCount * 0.0005;
      if ((globalThis.performance?.now?.() ?? Date.now()) - start + estimatedMs > budgetMs) break;

      this.globalInstancedMeshManager.commitStagedChunk(entry.chunkKey);

      // 根据距离选择淡入时长：近距离 200ms，远距离 400ms
      const fadeDuration = entry.distToPlayer <= 1 ? 200 : 400;
      this.chunkFadeController.startFadeIn(entry.chunkKey, { duration: fadeDuration });

      this._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();
      this.runtimeIdleScheduler?.markBusy('staging-commit');
      this.requestShadowMapUpdate('chunk-staged-commit');
    }
  }
```

- [ ] **Step 3: 在 update() 中调用 chunkFadeController.update()**

在 runtime-streaming 调度块中，`_commitStagedChunks` 之后追加：

```javascript
      this.chunkFadeController.update();
```

- [ ] **Step 4: chunk 卸载时取消淡入**

在 `update()` 的卸载循环中（chunk dispose 之前）追加：

```javascript
        this.chunkFadeController?.cancelFadeIn(key);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/world/World.js
git commit -m "feat(world): 集成 ChunkFadeController，staging commit 后触发淡入"
```

---

### Task 8: Consolidation 路径预扩容适配

**Files:**
- Modify: `src/core/GlobalInstancedMeshManager.js:390-460`

- [ ] **Step 1: 修改 patchChunkVisibleBlocks 添加预扩容**

在 `patchChunkVisibleBlocks` 方法的开头（`_purgeQueuedChunk` 之后、遍历 `meshDataArray` 之前）插入预扩容逻辑：

```javascript
    // 预扩容：避免 patch 过程中触发 ensureCapacity 导致闪烁
    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered) continue;
      const entries = Object.entries(instanceIndexMap || {});
      if (entries.length === 0) continue;
      const buffer = this.getOrCreateBuffer(type);
      buffer.ensureCapacity(buffer.count + entries.length);
    }
```

- [ ] **Step 2: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/core/GlobalInstancedMeshManager.js
git commit -m "fix(core): patchChunkVisibleBlocks 预扩容，防止 consolidation 闪烁"
```

---

### Task 9: 手动集成测试

**Files:** 无新文件

- [ ] **Step 1: 启动开发服务器**

Run: `npm run start`

- [ ] **Step 2: 在浏览器中验证基本功能**

打开 `http://localhost:8080`，确认：
1. 初始加载正常，chunk 以淡入方式出现
2. 在初始位置站立时画面稳定无闪烁

- [ ] **Step 3: 奔跑测试**

使用 WASD 向一个方向持续奔跑 30 秒，观察：
1. 远方 chunk 是否以淡入方式加载（无突兀弹出）
2. 已显示的 chunk 是否有闪烁/方块消失现象
3. 帧率是否稳定（查看 HUD 右上角 FPS 显示）

- [ ] **Step 4: 放置/挖掘方块测试**

验证 consolidation 路径正常：
1. 放置多个方块，确认方块即时出现
2. 挖掘方块，确认方块即时消失
3. 快速放置 50+ 方块触发 consolidation，确认无闪烁

- [ ] **Step 5: 检查 lint**

Run: `npm run lint`
Expected: 无新增 warning/error

- [ ] **Step 6: 运行全量测试套件**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 7: 最终提交（如有 lint 修复）**

```bash
git add -A
git commit -m "chore: lint 修复"
```

---

## 注意事项

1. **Bootstrap 阶段不受影响**：所有改动仅影响 `runtime-streaming` 阶段，启动阶段的 chunk 加载保留旧路径（直接 flush mutation queue），确保首屏加载速度不退化。

2. **透明度性能权衡**：`material.transparent = true` 会导致 Three.js 对这些物体进行深度排序，可能有性能影响。如果验证时发现掉帧，替代方案是使用 `alphaTest: 0.01` + 不透明渲染（但淡入过程中会有硬边缘）。需在 Task 9 手动测试时验证并调整。

3. **Consolidation 不走 staging**：Consolidation 使用 `patchChunkVisibleBlocks`，它做增量 diff 而非全量替换，因此不需要 staging 的"积累后原子提交"语义。但预扩容仍然需要（Task 8）。

4. **旧 mutation queue 保留**：`flushMutationQueue` 代码不删除，它仍然服务于 bootstrap 阶段。runtime-streaming 阶段只是不再向其中添加新 chunk 数据。
