# 修复 Chunk 流式加载 AO 闪烁与方块消失

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除奔跑时 chunk 发布后的 AO 黑闪和方块视觉闪烁，使流式加载的 chunk 首次出现即带正确 AO。

**Architecture:** 将 AO 计算从 "延迟到 publish 后 800ms" 前移到 "增量构建阶段内联计算"，利用已有的 `calculateAOForBlock` + `createOcclusionChecker` 在 `convert-group` 子阶段同步计算每个方块的近似 AO。然后将延迟 finalize 中的 `fullRefresh` 降级为仅边界修正，消除级联雪崩。最后批量化 AO 结果提交，减少 GPU buffer 更新频次。

**Tech Stack:** JavaScript ES Modules, Three.js InstancedMesh, Web Workers (AO Worker)

---

## 根因回顾

| 问题 | 根因 | 修复方向 |
|------|------|----------|
| AO 黑闪 | `convert-group` 中 `b.aoLow ?? 1` 恒为 1（blocks 无 AO 属性），publish 后全亮 → 延迟刷新突变为正确值 | 内联计算 AO |
| 大面积闪烁 | `runDeferredFinalizePhase` 同时触发 N 个 chunk 的 `fullRefresh: true`，级联 8 邻居 ×3000+ 脏位置 | 降级为边界修正，限流 |
| 双重触发 | `runDeferredFinalizePhase` 中 AO 稳定化和 "done" 路径各触发一次 `fullRefresh` | 去掉冗余触发 |
| 逐块 commit | `_applyAOResults` 对每个方块单独 `updateAO` 并 commit | 批量提交 |

## 文件变更清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/world/Chunk.js` | 修改 | 内联 AO 计算 + 降级 deferred refresh + 批量 commit |
| `src/world/World.js` | 修改 | 限流 deferred finalize 每帧处理量 |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | `updateAO` 支持 `commit: false` |
| `src/tests/test-chunk-streaming-ao.js` | 新建 | 验证内联 AO 计算正确性 |

---

## Task 1: 内联 AO 计算 — convert-group 阶段同步计算 AO

**Files:**
- Modify: `src/world/Chunk.js:1062-1160` (convert-group 子阶段)
- Test: `src/tests/test-chunk-streaming-ao.js` (新建)

### 背景

`_buildMeshFromExistingBlockDataIncremental` 的 `convert-group` 子阶段中，行 1139-1140 对每个方块设置 AO：

```js
group.aoLow[i] = b.aoLow ?? 1;   // b 没有 aoLow → 恒为 1
group.aoHigh[i] = b.aoHigh ?? 1;  // b 没有 aoHigh → 恒为 1
```

blocks 数组在 `iterate` 子阶段的行 1026 构建时只含 `{ x, y, z, type, orientation }`，不含 AO。

**修复策略：** 在 `convert-group` 首次初始化（`p.groupedByType` 为空时）创建 `isOccludingFn`，缓存到 `p._aoOcclusionChecker`。然后在内层循环中对每个方块调用 `calculateAOForBlock` 获取正确的打包 AO 值。

已有工具函数：
- `createOcclusionChecker(world, CHUNK_SIZE, getBlockPropsFn)` — 查当前 chunk + 已 ready 的邻居 chunk 的 blockData（`src/utils/AOUtils.js:305`）
- `calculateAOForBlock(x, y, z, isOccludingFn)` — 计算 6 面 ×4 角 AO 并打包为 `{aoLow, aoHigh}`（`src/utils/AOUtils.js:125`）
- `isAOApplicable(blockType)` — 判断方块是否需要 AO（实心+不透明）（`src/utils/AOUtils.js:247`）

chunk 实例上已 import 了 `createOcclusionChecker` 和 `computeBlockAOPacked`（行 16）。

**性能评估：** 每方块 ~78 次 Map.get，128 方块/批 ≈ 0.5ms，在 3ms 帧预算内可接受。

- [ ] **Step 1: 写失败测试 — 验证增量构建后 staging 数据包含正确 AO**

在 `src/tests/test-chunk-streaming-ao.js` 中写测试，验证 `_buildMeshFromExistingBlockDataIncremental` 完成后，meshData 中的 `aoLow` 不全为 1。

```js
import { describe } from './runner.js';
import { assertTrue, assertFalse } from './assert.js';
import { Chunk } from '../world/Chunk.js';
import { CHUNK_SIZE } from '../world/ChunkConsolidation.js';
import { isAOApplicable } from '../utils/AOUtils.js';

function createMinimalChunk(cx, cz) {
  const chunk = Object.create(Chunk.prototype);
  chunk.cx = cx;
  chunk.cz = cz;
  chunk.blockData = new Map();
  chunk.visibleKeys = new Set();
  chunk.instanceIndexMap = new Map();
  chunk.lightSourceCoords = new Set();
  chunk.dirtyAOPositions = new Set();
  chunk.loadState = 'hydrated';
  chunk.disposed = false;
  chunk._assemblyProgress = null;
  chunk._assemblyEpoch = 0;
  chunk._aoSourceVersion = 0;
  chunk.world = {
    chunk,
    chunks: new Map(),
    bootstrapState: { phase: 'runtime-streaming' }
  };
  // buildMeshes 拦截：只记录 meshData，不走 GlobalInstancedMeshManager
  chunk._capturedMeshData = null;
  chunk.buildMeshes = function(meshDataArray) {
    this._capturedMeshData = meshDataArray;
    this.renderState = 'staged';
  };
  return chunk;
}

describe('Chunk 流式构建 AO 正确性', (test) => {
  test('convert-group 阶段应计算 AO 而非默认全 1', () => {
    const chunk = createMinimalChunk(0, 0);

    // 放一个 stone 方块，上方和侧面放遮挡方块形成 AO
    const baseX = 8, baseY = 5, baseZ = 8;
    chunk.blockData.set(Chunk.encodeCoord(baseX, baseY, baseZ), 'stone');
    // 在上方放方块，制造 top-face AO
    chunk.blockData.set(Chunk.encodeCoord(baseX, baseY + 1, baseZ), 'stone');
    // 侧面放方块
    chunk.blockData.set(Chunk.encodeCoord(baseX + 1, baseY, baseZ), 'stone');
    chunk.blockData.set(Chunk.encodeCoord(baseX, baseY, baseZ + 1), 'stone');

    // 同步完成整个增量构建（给足够大的预算）
    let result;
    for (let i = 0; i < 200; i++) {
      result = chunk._buildMeshFromExistingBlockDataIncremental(50);
      if (result === 'done') break;
    }
    assertTrue(result === 'done', '增量构建应完成');
    assertTrue(chunk._capturedMeshData !== null, '应生成 meshData');

    // 检查 stone 类型的 meshData
    const stoneGroup = chunk._capturedMeshData.find(d => d.type === 'stone');
    assertTrue(stoneGroup !== undefined, '应有 stone 组');
    assertTrue(stoneGroup.count > 0, 'stone 组应有方块');

    // 至少有一个方块的 aoLow 不是 FULL_BRIGHT (0x00ffffff)
    // 因为互相遮挡会产生 AO < 全亮
    let hasNonFullBright = false;
    const FULL_BRIGHT = 0x00ffffff;
    for (let i = 0; i < stoneGroup.count; i++) {
      if (stoneGroup.aoLow[i] !== FULL_BRIGHT || stoneGroup.aoHigh[i] !== FULL_BRIGHT) {
        hasNonFullBright = true;
        break;
      }
    }
    // 在修复前，所有 aoLow 都是 1（float），修复后应是打包整数
    // 先检查旧行为：全部为 1.0（float）说明未计算
    let allOnes = true;
    for (let i = 0; i < stoneGroup.count; i++) {
      if (stoneGroup.aoLow[i] !== 1 || stoneGroup.aoHigh[i] !== 1) {
        allOnes = false;
        break;
      }
    }
    assertFalse(allOnes, 'AO 值不应全为 1（未计算），应内联计算实际遮挡');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
node command/run-tests.js --verbose
```

预期：`assertFalse(allOnes, ...)` 失败，因为当前代码中 `b.aoLow ?? 1` 恒为 1。

- [ ] **Step 3: 实现内联 AO — 修改 convert-group 子阶段**

修改 `src/world/Chunk.js` 的 `convert-group` 子阶段。

**3a. 在 `convert-group` 初始化块中创建 AO 遮挡检测器（行 1064 附近，`if (!p.groupedByType)` 块内）：**

在 `p.groupKeys = Object.keys(p.groupedByType);` 之后、`p.meshData = [];` 之前，添加：

```js
// 创建 AO 遮挡检测器（可检查当前 chunk + 已加载邻居 chunk）
if (this.world && typeof createOcclusionChecker === 'function') {
  p._aoOcclusionChecker = createOcclusionChecker(
    { chunk: this, chunks: this.world.chunks },
    CHUNK_SIZE,
    getBlockProps
  );
} else {
  p._aoOcclusionChecker = null;
}
```

注意：`getBlockProps` 是 Chunk.js 顶部已有的本地变量（通过 `createBlockPropsResolver` 创建），`CHUNK_SIZE` 来自 `ChunkConsolidation.js` 的导入，`createOcclusionChecker` 已在行 16 导入（检查：实际导入名为 `createOcclusionChecker`，来自 `src/utils/AOUtils.js`）。

**3b. 修改内层循环中的 AO 赋值（行 1139-1140）：**

将：
```js
group.aoLow[i] = b.aoLow ?? 1;
group.aoHigh[i] = b.aoHigh ?? 1;
```

替换为：
```js
if (p._aoOcclusionChecker && isAOApplicable(b.type)) {
  const ao = calculateAOForBlock(b.x, b.y, b.z, p._aoOcclusionChecker);
  group.aoLow[i] = ao.aoLow;
  group.aoHigh[i] = ao.aoHigh;
} else {
  group.aoLow[i] = b.aoLow ?? 1;
  group.aoHigh[i] = b.aoHigh ?? 1;
}
```

需要在文件顶部确认导入：行 16 已有 `import { createOcclusionChecker, computeBlockAOPacked } from '../utils/AOUtils.js';`。还需要额外导入 `calculateAOForBlock` 和 `isAOApplicable`：

在行 16 的 import 中添加 `calculateAOForBlock` 和 `isAOApplicable`：

```js
import { createOcclusionChecker, computeBlockAOPacked, packAOData, calculateAOForBlock, isAOApplicable } from '../utils/AOUtils.js';
```

同时需要确认 `getBlockProps` 变量在 `_buildMeshFromExistingBlockDataIncremental` 的作用域内可用。查看 Chunk.js 顶部：

```js
// 行 13
import { getBlockProperties, createBlockPropsResolver } from '../constants/BlockData.js';
```

`getBlockProperties` 是全局的，但 `createOcclusionChecker` 需要的参数名是 `getBlockPropsFn`。在 Chunk.js 行 13 中，`getBlockProperties` 已导入。直接传 `getBlockProperties` 即可。

- [ ] **Step 4: 运行测试验证通过**

```bash
node command/run-tests.js --verbose
```

预期：测试通过 — AO 值不再全为 1。

- [ ] **Step 5: 运行 lint 检查**

```bash
npm run lint
```

- [ ] **Step 6: 提交**

```bash
git add src/world/Chunk.js src/tests/test-chunk-streaming-ao.js
git commit -m "feat(chunk): 增量构建阶段内联计算 AO，消除 publish 后全亮闪烁"
```

---

## Task 2: 降级延迟 AO 刷新 — 去掉 fullRefresh + 去掉双重触发

**Files:**
- Modify: `src/world/Chunk.js:3061-3139` (`runDeferredFinalizePhase`)
- Modify: `src/world/Chunk.js:3017-3058` (`finalizeNonDeferredPhase`)

### 背景

现在 chunk 已在 publish 前计算了近似 AO（使用当前 chunk + 已 ready 邻居数据）。延迟 finalize 阶段只需要修正边界差异（邻居 chunk 后续加载可能改变边界 AO），不再需要 `fullRefresh: true`。

**当前问题代码：**

`runDeferredFinalizePhase`（行 3114-3136）有两个 `fullRefresh: true` 触发点：
1. 行 3114-3121：`_needsDeferredAOStabilization` → `fullRefresh: true`
2. 行 3131-3136：所有工作完成后 → 又一次 `fullRefresh: true`

- [ ] **Step 1: 写失败测试 — 验证 deferred finalize 不触发 fullRefresh**

在 `src/tests/test-chunk-streaming-ao.js` 中追加测试：

```js
test('runDeferredFinalizePhase 不应触发 fullRefresh', () => {
  const chunk = createMinimalChunk(0, 0);
  chunk.isReady = true;
  chunk.isConsolidating = false;
  chunk.loadState = 'finalized';
  chunk.hasDeferredFinalizeWork = true;
  chunk._needsDeferredAOStabilization = true;
  chunk._needsDeferredRuntimeEntityRestore = false;
  chunk._needsDeferredLightRegistration = false;

  // 追踪 onChunkAOSourceStable 调用
  const calls = [];
  chunk.world.onChunkAOSourceStable = (c, opts) => {
    calls.push({ chunkKey: `${c.cx},${c.cz}`, ...opts });
  };

  chunk.runDeferredFinalizePhase();

  // 应该有调用，但 fullRefresh 应该为 false
  assertTrue(calls.length > 0, '应触发 AO 边界刷新');
  for (const call of calls) {
    assertFalse(call.fullRefresh === true,
      `不应 fullRefresh: true，实际: ${JSON.stringify(call)}`);
  }
});

test('runDeferredFinalizePhase 完成后不应二次触发 AO 刷新', () => {
  const chunk = createMinimalChunk(0, 0);
  chunk.isReady = true;
  chunk.isConsolidating = false;
  chunk.loadState = 'finalized';
  chunk.hasDeferredFinalizeWork = true;
  chunk._needsDeferredAOStabilization = true;
  chunk._needsDeferredRuntimeEntityRestore = false;
  chunk._needsDeferredLightRegistration = false;

  const calls = [];
  chunk.world.onChunkAOSourceStable = (c, opts) => {
    calls.push(opts);
  };

  chunk.runDeferredFinalizePhase();

  // 应只有 1 次调用（不应有 "deferred-finalize-done" 的第二次）
  assertTrue(calls.length === 1,
    `应只触发 1 次 AO 刷新，实际: ${calls.length} 次`);
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
node command/run-tests.js --verbose
```

预期：第一个测试 `assertFalse(call.fullRefresh === true, ...)` 失败（当前是 `fullRefresh: true`）。

- [ ] **Step 3: 修改 runDeferredFinalizePhase — 降级 fullRefresh + 去掉双重触发**

在 `src/world/Chunk.js` 中修改 `runDeferredFinalizePhase`。

**3a. 行 3114-3121 — 将 `fullRefresh: true` 改为 `fullRefresh: false`：**

将：
```js
    if (this._needsDeferredAOStabilization) {
      this.world?.onChunkAOSourceStable?.(this, {
        fullRefresh: true,
        markNeighborBoundaries: true,
        reason: 'deferred-finalize-ao-stable'
      });
      aoRefreshTriggeredThisPass = true;
      this._needsDeferredAOStabilization = false;
    }
```

替换为：
```js
    if (this._needsDeferredAOStabilization) {
      this.world?.onChunkAOSourceStable?.(this, {
        fullRefresh: false,
        markNeighborBoundaries: true,
        reason: 'deferred-finalize-ao-stable'
      });
      aoRefreshTriggeredThisPass = true;
      this._needsDeferredAOStabilization = false;
    }
```

**3b. 行 3131-3136 — 删除第二次 fullRefresh 触发：**

将：
```js
    // 所有延迟工作完成后，触发 AO 刷新（避免同一轮重复触发）
    if (!this.hasDeferredFinalizeWork && !aoRefreshTriggeredThisPass) {
      this.world?.onChunkAOSourceStable?.(this, {
        fullRefresh: true,
        markNeighborBoundaries: true,
        reason: 'deferred-finalize-done'
      });
    }
```

替换为：
```js
    // 已在 _needsDeferredAOStabilization 分支中触发边界刷新，此处不再重复
```

- [ ] **Step 4: 运行测试验证通过**

```bash
node command/run-tests.js --verbose
```

- [ ] **Step 5: 运行 lint**

```bash
npm run lint
```

- [ ] **Step 6: 提交**

```bash
git add src/world/Chunk.js src/tests/test-chunk-streaming-ao.js
git commit -m "fix(chunk): 降级延迟 AO 刷新为边界修正，去除双重 fullRefresh 触发"
```

---

## Task 3: 限流延迟 finalize — 每帧最多处理 1 个 chunk

**Files:**
- Modify: `src/world/World.js:44` (常量定义)

### 背景

当前 `RUNTIME_DEFERRED_FINALIZE_MAX_CHUNKS = 2`，即每帧可处理 2 个 chunk 的延迟 finalize。当玩家奔跑后停下来，多个 chunk 同帧触发 AO 边界刷新，仍可能产生明显的视觉跳变。改为 1 可将 AO 更新分散到更多帧。

- [ ] **Step 1: 修改常量**

在 `src/world/World.js` 行 44：

将：
```js
const RUNTIME_DEFERRED_FINALIZE_MAX_CHUNKS = 2;
```

替换为：
```js
const RUNTIME_DEFERRED_FINALIZE_MAX_CHUNKS = 1;
```

- [ ] **Step 2: 运行全量测试确认无回归**

```bash
node command/run-tests.js --verbose
```

- [ ] **Step 3: 提交**

```bash
git add src/world/World.js
git commit -m "perf(world): 限流延迟 finalize 每帧处理 1 个 chunk，减少 AO 级联峰值"
```

---

## Task 4: 批量化 AO 结果提交

**Files:**
- Modify: `src/world/Chunk.js:2409-2414` (`_applyAOResults` 中的全局更新)
- Modify: `src/core/GlobalInstancedMeshManager.js:708-719` (`updateAO` 方法，确认 `commit` 参数支持)

### 背景

`_applyAOResults` 对每个方块逐个调用 `globalInstancedMeshManager.updateAO(code, r.aoLow, r.aoHigh)`。`updateAO` 内部默认 `commit !== false` 时立即调用 `commitDirty()`。对 3000+ 个结果，这导致 3000+ 次无意义的 `needsUpdate = true` + dirty 范围重置。

`updateAO` 已经支持 `options.commit` 参数（`GlobalInstancedMeshManager.js:197-206`），只需调用时传 `{ commit: false }`，最后统一 `commitDirtyBuffers()`。

- [ ] **Step 1: 写失败测试 — 验证批量提交行为**

在 `src/tests/test-chunk-streaming-ao.js` 中追加测试：

```js
test('_applyAOResults 应批量提交而非逐块提交', () => {
  const chunk = createMinimalChunk(0, 0);
  chunk.isReady = true;
  chunk.loadState = 'finalized';

  let commitCount = 0;
  const mockManager = {
    updateAO(coord, aoLow, aoHigh, options = {}) {
      if (options.commit !== false) commitCount++;
      return true;
    },
    commitDirtyBuffers() { commitCount++; }
  };
  chunk.world.globalInstancedMeshManager = mockManager;

  // 模拟 10 个 AO 结果
  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push({ x: 8, y: i, z: 8, aoLow: 0x00aaaaaa, aoHigh: 0x00bbbbbb });
  }
  chunk._applyAOResults(results, new Set());

  // 批量提交：应该只有 1 次 commit（commitDirtyBuffers），不应有逐块 commit
  assertTrue(commitCount === 1,
    `应只有 1 次批量 commit，实际 ${commitCount} 次`);
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
node command/run-tests.js --verbose
```

预期：`commitCount` 为 10（每次 updateAO 默认 commit），测试失败。

- [ ] **Step 3: 修改 _applyAOResults — 批量 commit**

在 `src/world/Chunk.js` 的 `_applyAOResults` 方法中，修改行 2409-2414 的全局更新部分。

将：
```js
    if (this.world?.globalInstancedMeshManager) {
      for (const r of results) {
        const code = Chunk.encodeCoord(r.x, r.y, r.z);
        this.world.globalInstancedMeshManager.updateAO(code, r.aoLow, r.aoHigh);
      }
    }
```

替换为：
```js
    if (this.world?.globalInstancedMeshManager) {
      for (const r of results) {
        const code = Chunk.encodeCoord(r.x, r.y, r.z);
        this.world.globalInstancedMeshManager.updateAO(code, r.aoLow, r.aoHigh, { commit: false });
      }
      this.world.globalInstancedMeshManager.commitDirtyBuffers();
    }
```

- [ ] **Step 4: 运行测试验证通过**

```bash
node command/run-tests.js --verbose
```

- [ ] **Step 5: 运行 lint**

```bash
npm run lint
```

- [ ] **Step 6: 提交**

```bash
git add src/world/Chunk.js src/tests/test-chunk-streaming-ao.js
git commit -m "perf(chunk): AO 结果批量提交，消除逐块 commit 开销"
```

---

## Task 5: 全量回归验证

**Files:** 无新增修改

- [ ] **Step 1: 运行全量测试**

```bash
node command/run-tests.js --verbose
```

预期：所有测试通过，包括已有的 AO 遮挡一致性测试 (`test-ao-occlusion`)。

- [ ] **Step 2: 运行 lint**

```bash
npm run lint
```

- [ ] **Step 3: 启动开发服务器进行手动验证**

```bash
npm run start
```

在浏览器中操作：
1. 等待初始加载完成
2. 向一个方向持续奔跑 10+ 秒
3. 观察新加载 chunk 是否出现 AO 闪烁
4. 观察已加载 chunk 是否出现方块消失或黑闪
5. 按 N 键开启 StreamingPerf 日志，确认无异常

验收标准：
- 新加载的 chunk 首次出现即有正确 AO 阴影，无全亮→变暗的跳变
- 已加载 chunk 地面/树叶无闪烁消失
- 帧率无明显下降（与修复前对比）
