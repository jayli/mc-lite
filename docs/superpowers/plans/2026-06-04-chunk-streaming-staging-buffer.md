# Chunk 流式加载 Staging Buffer 实施计划 (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除玩家奔跑过程中加载 chunk 时的卡顿和画面闪烁。通过废除同步构建路径、引入两阶段原子提交（分帧 prepare + 一帧 publish）、Worker Transferable 优化和实时帧预算调度，实现流畅的 chunk 流式加载体验。

**Architecture:** P0 先消除最大的帧爆炸源（同步 buildMesh、先删后补、Worker 克隆），P1 引入实时预算调度确保帧总和不超标，P2 用雾遮掩自然过渡。两阶段原子的关键创新：prepare 阶段分帧写入 TypeBuffer 的 shadow region（count 之外的空间），publish 阶段只做 `mesh.count = newCount` 一次赋值。

**Tech Stack:** Three.js 0.184.0 (WebGPURenderer + TSL Node Material), ES Modules, Web Workers, Playwright (压测)

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/FrameBudgetScheduler.js` | 新建 | 实时帧预算调度器（基于 frameStart + 剩余时间） |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | staging zone、分帧 prepare（shadow region）、publish |
| `src/world/Chunk.js` | 修改 | 删除 assembleRuntimeBuildMeshFast，可中断路径接受外部 maxMs |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 移除 runtime-build-mesh-fast stage，传递 budgetMs |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 初次加载改为写入 staging |
| `src/workers/WorldWorker.js` | 修改 | postMessage 添加 transfer list、裁剪冗余 |
| `src/workers/WorldWorkerPoolImpl.js` | 修改 | 支持 transfer list 传递 |
| `src/world/World.js` | 修改 | 集成 FrameBudgetScheduler，重构 update() 调度 |
| `src/tests/test-frame-budget-scheduler.js` | 新建 | FrameBudgetScheduler 单元测试 |
| `src/tests/test-global-instanced-mesh-manager.js` | 修改 | staging/prepare/publish 测试 |

---

### Task 1: [P0] 废除 runtime-build-mesh-fast，全走可中断路径

**Files:**
- Modify: `src/world/Chunk.js:858-887`
- Modify: `src/world/ChunkAssemblyScheduler.js:127-152`

- [ ] **Step 1: 修改 ChunkAssemblyScheduler，移除 fast path stage**

在 `src/world/ChunkAssemblyScheduler.js` 的 `_runTask` 方法中，将 `'runtime-build-mesh-fast'` case 改为统一走可中断路径：

```javascript
      case 'runtime-build-mesh-fast':
      case 'runtime-build-mesh':
        stageResult = chunk.assembleRuntimeBuildMeshPhase();
        if (stageResult === 'continue') {
          this.enqueue(chunk, 'runtime-build-mesh', task.priority);
        } else if (stageResult === 'done' || stageResult === true) {
          this.enqueue(chunk, 'runtime-finalize', task.priority);
        }
        break;
```

即：`runtime-build-mesh-fast` 和 `runtime-build-mesh` 合并为同一个 handler，都调用可中断的 `assembleRuntimeBuildMeshPhase()`。

- [ ] **Step 2: 在 Chunk.js 中标记 assembleRuntimeBuildMeshFast 为废弃**

在 `src/world/Chunk.js` 中将 `assembleRuntimeBuildMeshFast` 方法体改为转发到可中断版本：

```javascript
  assembleRuntimeBuildMeshFast() {
    return this.assembleRuntimeBuildMeshPhase();
  }
```

- [ ] **Step 3: 运行测试确认不破坏**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 4: 运行 lint**

Run: `npm run lint`
Expected: 无新增 error

- [ ] **Step 5: 提交**

```bash
git add src/world/Chunk.js src/world/ChunkAssemblyScheduler.js
git commit -m "perf(world): 废除 runtime-build-mesh-fast，统一走可中断 buildMesh 路径"
```

---

### Task 2: [P0] GlobalInstancedMeshManager — Staging + 两阶段原子提交

**Files:**
- Modify: `src/core/GlobalInstancedMeshManager.js`
- Modify: `src/tests/test-global-instanced-mesh-manager.js`

- [ ] **Step 1: 编写 staging + prepare + publish 测试**

在 `src/tests/test-global-instanced-mesh-manager.js` 末尾追加：

```javascript
  test('stageMeshDataForChunk 存入 staging 不触发渲染', () => {
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

  test('prepareStagedBlocks 分帧写入 shadow region 不改变 mesh.count', () => {
    const { manager } = createManager(8);
    const blocks = [
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 },
      { x: 3, y: 2, z: 3 },
      { x: 4, y: 2, z: 3 }
    ];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));

    // prepare 前 buffer 不存在
    assertEqual(manager.buffers.has('stone'), false, 'prepare 前无 buffer');

    // 限制每次 prepare 2 个方块
    manager.prepareStagedBlocks({ maxBlocks: 2, maxMs: 100 });

    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 0, 'prepare 期间 mesh.count 应保持 0');
    assertTrue(buffer.capacity >= 4, '应预扩容');
    assertEqual(manager.isPrepareComplete('0,0'), false, '第一次 prepare 未完成');

    // 第二次 prepare 完成
    manager.prepareStagedBlocks({ maxBlocks: 2, maxMs: 100 });
    assertEqual(buffer.count, 0, 'prepare 完成后 mesh.count 仍为 0');
    assertEqual(manager.isPrepareComplete('0,0'), true, '应标记为 prepare 完成');
  });

  test('publishPreparedChunk 一帧切换 count 使方块可见', () => {
    const { manager } = createManager(8);
    const blocks = [
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 },
      { x: 3, y: 2, z: 3 }
    ];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });
    manager.publishPreparedChunk('0,0');

    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 3, 'publish 后 count 应为 3');
    assertEqual(buffer.mesh.count, 3, 'mesh.count 应同步');
    assertEqual(manager.coordToRef.size, 3, '应有 3 个渲染引用');
    assertEqual(manager.getStagedChunkKeys().length, 0, 'staging 应清空');
  });

  test('removeStagedChunk 清理未提交数据', () => {
    const { manager } = createManager(4);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.removeStagedChunk('0,0');
    assertEqual(manager.getStagedChunkKeys().length, 0, 'staging 应清空');
  });

  test('两阶段原子：prepare 中途不影响已渲染方块', () => {
    const { manager } = createManager(8);
    // 先添加一个已渲染方块
    const existingCoord = encodeCoord(10, 10, 10);
    manager.addVisibleBlock(existingCoord, { type: 'stone', orientation: 0 }, '1,1', {
      matrix: makeMatrix(10, 10, 10), aoLow: 1, aoHigh: 1, orientation: 0
    });
    assertEqual(manager.buffers.get('stone').count, 1, '已有 1 个渲染实例');

    // staging 新 chunk
    manager.stageMeshDataForChunk('0,0', makeMeshData([
      { x: 1, y: 2, z: 3 },
      { x: 2, y: 2, z: 3 }
    ]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });

    // prepare 期间已有方块不受影响
    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 1, 'prepare 不影响已渲染 count');
    assertEqual(buffer.mesh.count, 1, 'mesh.count 不变');

    // publish 后新旧方块共存
    manager.publishPreparedChunk('0,0');
    assertEqual(buffer.count, 3, 'publish 后 count = 1(旧) + 2(新)');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `stageMeshDataForChunk` 等方法不存在

- [ ] **Step 3: 实现 staging zone 数据结构**

在 `GlobalInstancedMeshManager` 的 constructor 中追加：

```javascript
    this.stagingZone = new Map(); // chunkKey → { meshDataArray, blockCount, prepareState: null | { ... } }
```

实现 `stageMeshDataForChunk`：

```javascript
  stageMeshDataForChunk(chunkKey, meshDataArray) {
    if (!Array.isArray(meshDataArray)) return 0;
    this._purgeQueuedChunk(chunkKey);
    this.removeStagedChunk(chunkKey);

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
    this.stagingZone.set(chunkKey, { meshDataArray: validData, blockCount, prepareState: null });
    return blockCount;
  }
```

- [ ] **Step 4: 实现 prepareStagedBlocks（分帧 prepare，写入 shadow region）**

```javascript
  prepareStagedBlocks(options = {}) {
    const maxBlocks = options.maxBlocks || 600;
    const maxMs = options.maxMs || 2;
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    const start = now();
    let processed = 0;

    for (const [chunkKey, staged] of this.stagingZone) {
      if (processed >= maxBlocks || now() - start >= maxMs) break;
      if (!staged.prepareState) {
        // 初始化 prepare：预扩容 + 初始化 cursor
        this._initPrepareState(staged);
      }
      const ps = staged.prepareState;
      if (ps.complete) continue;

      // 分帧写入 shadow region
      while (ps.dataCursor < staged.meshDataArray.length && processed < maxBlocks && now() - start < maxMs) {
        const data = staged.meshDataArray[ps.dataCursor];
        const { type, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;
        const entries = Object.entries(instanceIndexMap || {});
        const buffer = this.getOrCreateBuffer(type);

        while (ps.entryCursor < entries.length && processed < maxBlocks && now() - start < maxMs) {
          const [coordText, sourceIndex] = entries[ps.entryCursor];
          const coord = Number(coordText);
          const shadowIndex = buffer.count + ps.shadowOffsets.get(type);

          // 写入 shadow region（count 之外）
          const matrix = matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE);
          buffer.mesh.instanceMatrix.array.set(matrix, shadowIndex * MATRIX_STRIDE);

          const attrAoLow = buffer.mesh.geometry.getAttribute('aAoLow');
          const attrAoHigh = buffer.mesh.geometry.getAttribute('aAoHigh');
          const attrOrientation = buffer.mesh.geometry.getAttribute('aOrientation');
          if (attrAoLow) attrAoLow.array[shadowIndex] = aoLow?.[sourceIndex] ?? 1;
          if (attrAoHigh) attrAoHigh.array[shadowIndex] = aoHigh?.[sourceIndex] ?? 1;
          if (attrOrientation) attrOrientation.array[shadowIndex] = orientation?.[sourceIndex] ?? 0;

          // 记录映射关系待 publish 时注册
          ps.coordMap.push({ coord, type, shadowIndex, chunkKey,
            entry: { type, orientation: orientation?.[sourceIndex] || 0 } });

          ps.shadowOffsets.set(type, ps.shadowOffsets.get(type) + 1);
          ps.entryCursor++;
          processed++;
        }

        if (ps.entryCursor >= entries.length) {
          ps.dataCursor++;
          ps.entryCursor = 0;
        }
      }

      if (ps.dataCursor >= staged.meshDataArray.length) {
        ps.complete = true;
      }
    }
    return processed;
  }

  _initPrepareState(staged) {
    // 预扩容：计算每个 type 需要的容量
    const typeBlockCounts = new Map();
    for (const data of staged.meshDataArray) {
      const { type, instanceIndexMap } = data;
      const entries = Object.entries(instanceIndexMap || {});
      typeBlockCounts.set(type, (typeBlockCounts.get(type) || 0) + entries.length);
    }
    for (const [type, extra] of typeBlockCounts) {
      const buffer = this.getOrCreateBuffer(type);
      buffer.ensureCapacity(buffer.count + extra);
    }

    // shadow offset：每个 type 从 buffer.count 开始写
    const shadowOffsets = new Map();
    for (const type of typeBlockCounts.keys()) {
      shadowOffsets.set(type, 0);
    }

    staged.prepareState = {
      dataCursor: 0,
      entryCursor: 0,
      shadowOffsets,
      coordMap: [],
      complete: false
    };
  }
```

- [ ] **Step 5: 实现 publishPreparedChunk（一帧 flip count）**

```javascript
  publishPreparedChunk(chunkKey) {
    const staged = this.stagingZone.get(chunkKey);
    if (!staged || !staged.prepareState?.complete) return false;

    const ps = staged.prepareState;

    // 注册 coordToRef 和 chunkToCoords
    if (!this.chunkToCoords.has(chunkKey)) this.chunkToCoords.set(chunkKey, new Set());
    const chunkCoords = this.chunkToCoords.get(chunkKey);

    // 按 type 统计新增数量，用于 bump count
    const typeBumps = new Map();
    for (const item of ps.coordMap) {
      const renderKey = this.getRenderKey(item.type);
      const buffer = this.buffers.get(renderKey);
      if (!buffer) continue;

      const ref = { renderKey, index: item.shadowIndex, chunkKey };
      this.coordToRef.set(item.coord, ref);
      chunkCoords.add(item.coord);
      buffer.coordToIndex.set(item.coord, item.shadowIndex);
      buffer.indexToCoord[item.shadowIndex] = item.coord;

      typeBumps.set(renderKey, (typeBumps.get(renderKey) || 0) + 1);
    }

    // 一次性 bump count（所有新方块瞬间可见）
    for (const [renderKey, bump] of typeBumps) {
      const buffer = this.buffers.get(renderKey);
      if (!buffer) continue;
      buffer.count += bump;
      buffer.mesh.count = buffer.count;
      buffer.mesh.instanceMatrix.needsUpdate = true;
      const aoLow = buffer.mesh.geometry.getAttribute('aAoLow');
      const aoHigh = buffer.mesh.geometry.getAttribute('aAoHigh');
      const orientation = buffer.mesh.geometry.getAttribute('aOrientation');
      if (aoLow) aoLow.needsUpdate = true;
      if (aoHigh) aoHigh.needsUpdate = true;
      if (orientation) orientation.needsUpdate = true;
      buffer.mesh.boundingSphere = null;
      buffer.mesh.boundingBox = null;
    }

    this.stagingZone.delete(chunkKey);
    return true;
  }
```

- [ ] **Step 6: 实现辅助方法**

```javascript
  removeStagedChunk(chunkKey) {
    this.stagingZone.delete(chunkKey);
  }

  getStagedChunkKeys() {
    return Array.from(this.stagingZone.keys());
  }

  getStagedBlockCount(chunkKey) {
    return this.stagingZone.get(chunkKey)?.blockCount || 0;
  }

  isPrepareComplete(chunkKey) {
    return this.stagingZone.get(chunkKey)?.prepareState?.complete || false;
  }

  getReadyToPublishChunks(playerCx, playerCz) {
    const ready = [];
    for (const [chunkKey, staged] of this.stagingZone) {
      if (!staged.prepareState?.complete) continue;
      const dist = this._getChunkDistance(chunkKey, playerCx, playerCz);
      ready.push({ chunkKey, blockCount: staged.blockCount, distToPlayer: dist });
    }
    ready.sort((a, b) => a.distToPlayer - b.distToPlayer);
    return ready;
  }
```

- [ ] **Step 7: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add src/core/GlobalInstancedMeshManager.js src/tests/test-global-instanced-mesh-manager.js
git commit -m "feat(core): 两阶段原子提交 — staging + 分帧 prepare + 一帧 publish"
```

---

### Task 3: [P0] ChunkGenerator buildMeshes → staging 路径

**Files:**
- Modify: `src/world/ChunkGenerator.js:132-145`

- [ ] **Step 1: 修改 buildMeshes 初次加载路径写入 staging**

```javascript
    if (this.world?.globalInstancedMeshManager) {
      const chunkKey = `${this.cx},${this.cz}`;
      const isInitialBuild = this.loadState !== 'finalized' && this.loadState !== 'waiting-consolidation';
      let result;
      if (isInitialBuild) {
        result = this.world.globalInstancedMeshManager.stageMeshDataForChunk(chunkKey, meshDataArray);
      } else {
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

- [ ] **Step 2: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/world/ChunkGenerator.js
git commit -m "feat(world): buildMeshes 初次加载改为写入 staging"
```

---

### Task 4: [P0] Worker 回包 Transferable + 裁剪冗余

**Files:**
- Modify: `src/workers/WorldWorker.js:2901-2941`
- Modify: `src/workers/WorldWorkerPoolImpl.js:109-112`

- [ ] **Step 1: WorldWorker postMessage 添加 transfer list**

在 `src/workers/WorldWorker.js` 的 consolidation 回包处（约 L2901），将 `postMessage({...})` 改为：

```javascript
  // 收集 meshData 中所有 Float32Array 的 buffer 用于 zero-copy transfer
  const transferList = [];
  if (meshData && Array.isArray(meshData)) {
    for (const group of meshData) {
      if (group.matrices?.buffer) transferList.push(group.matrices.buffer);
      if (group.aoLow?.buffer) transferList.push(group.aoLow.buffer);
      if (group.aoHigh?.buffer) transferList.push(group.aoHigh.buffer);
      if (group.orientation?.buffer) transferList.push(group.orientation.buffer);
    }
  }

  postMessage({
    cx, cz, callbackKey, taskId,
    blockDataBlocks,
    scatteredBlocks,
    routing,
    meshData,
    solidBlocks,
    entities: {
      modGunMan,
      rovers
    },
    visibleKeys: Array.from(visibleKeysSet),
    structureCenters,
    snapshot: {
      meta: {
        ownershipVersion: OWNERSHIP_SCHEMA_VERSION
      },
      entities: {
        modGunMan,
        rovers,
        zombieNests: savedSnapshot?.entities?.zombieNests || []
      }
    },
    _workerTiming: {
      workerComputeMs,
      transitToWorkerMs,
      workerFinishedAt
    },
    _workerPerfPhases: {
      faceCullingMs: _workerPhaseFaceCullingMs || 0,
      aoComputationMs: _workerPhaseAOComputationMs || 0,
      buildBlockDataBlocksMs: tBuildDataBlocksEnd - tBuildDataBlocksStart,
      buildScatteredBlocksMs: tBuildScatteredEnd - tBuildScatteredStart,
      buildMeshDataMs: tBuildMeshDataEnd - tBuildMeshDataStart,
      buildRoutingMs: tBuildRoutingEnd - tBuildRoutingStart,
      workerComputeMs
    },
    isOptimization
  }, transferList);
```

注意：去掉了 `snapshot.blocks`（与 blockDataBlocks 冗余）、去掉了顶层 `modGunMan`/`rovers`（统一在 entities 下）。

- [ ] **Step 2: 检查 snapshot.blocks 的消费方，确保去除后不影响**

Run: `grep -rn "snapshot\.blocks\|snapshot\[.blocks.\]" src/ --include="*.js" | grep -v "WorldWorker.js"`

如果有消费方引用 `snapshot.blocks`，需要改为从 `blockDataBlocks` 读取。

- [ ] **Step 3: WorldWorkerPoolImpl 支持 transfer list**

在 `src/workers/WorldWorkerPoolImpl.js` 的 `_dispatchToWorker` 方法中：

```javascript
  _dispatchToWorker(index, message) {
    this.pool[index].busy = true;
    this.lastUsedIndex = index;
    const transfer = message._transferList || [];
    delete message._transferList;
    this.pool[index].worker.postMessage(message, transfer);
  }
```

调用方如需 transfer，在 message 中附带 `_transferList` 字段。

- [ ] **Step 4: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: 无新增 error

- [ ] **Step 6: 提交**

```bash
git add src/workers/WorldWorker.js src/workers/WorldWorkerPoolImpl.js
git commit -m "perf(worker): 回包使用 Transferable zero-copy + 裁剪冗余字段"
```

---

### Task 5: [P1] FrameBudgetScheduler — 实时帧预算调度器

**Files:**
- Create: `src/core/FrameBudgetScheduler.js`
- Create: `src/tests/test-frame-budget-scheduler.js`

- [ ] **Step 1: 编写测试**

```javascript
// src/tests/test-frame-budget-scheduler.js
import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { FrameBudgetScheduler } from '../core/FrameBudgetScheduler.js';

describe('FrameBudgetScheduler', (test) => {
  test('beginFrame 后 getRemainingMs 返回接近目标帧时的值', () => {
    const scheduler = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    scheduler.beginFrame();
    const remaining = scheduler.getRemainingMs();
    // 10ms - 2ms = 8ms，刚调用 beginFrame 后应接近 8ms
    assertTrue(remaining >= 7 && remaining <= 8.5, `剩余时间应接近 8ms，得到 ${remaining}`);
  });

  test('hasTimeFor 正确判断是否有足够预算', () => {
    const scheduler = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    scheduler.beginFrame();
    assertTrue(scheduler.hasTimeFor(5), '刚开始应有 5ms 预算');
    assertTrue(scheduler.hasTimeFor(7), '刚开始应有 7ms 预算');
    assertEqual(scheduler.hasTimeFor(10), false, '不应有 10ms 预算');
  });

  test('consume 正确记录已消耗时间用于 telemetry', () => {
    const scheduler = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    scheduler.beginFrame();
    const snapshot = scheduler.getFrameSnapshot();
    assertTrue(snapshot.targetFrameMs === 10, '目标帧时应为 10ms');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `FrameBudgetScheduler` 不存在

- [ ] **Step 3: 实现 FrameBudgetScheduler**

```javascript
// src/core/FrameBudgetScheduler.js

export class FrameBudgetScheduler {
  constructor(options = {}) {
    this.targetFps = options.targetFps || 100;
    this.targetFrameMs = 1000 / this.targetFps;
    this.safetyMarginMs = options.safetyMarginMs || 2;
    this.frameStart = 0;
    this.frameDeadline = 0;
  }

  beginFrame() {
    this.frameStart = globalThis.performance?.now?.() ?? Date.now();
    this.frameDeadline = this.frameStart + this.targetFrameMs - this.safetyMarginMs;
  }

  getRemainingMs() {
    const now = globalThis.performance?.now?.() ?? Date.now();
    return Math.max(0, this.frameDeadline - now);
  }

  hasTimeFor(estimatedMs) {
    return this.getRemainingMs() >= estimatedMs;
  }

  getFrameSnapshot() {
    const now = globalThis.performance?.now?.() ?? Date.now();
    return {
      targetFrameMs: this.targetFrameMs,
      elapsed: now - this.frameStart,
      remaining: Math.max(0, this.frameDeadline - now)
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/FrameBudgetScheduler.js src/tests/test-frame-budget-scheduler.js
git commit -m "feat(core): 新增 FrameBudgetScheduler 实时帧预算调度器"
```

---

### Task 6: [P1] World.js — 集成 FrameBudgetScheduler + prepare/publish 调度

**Files:**
- Modify: `src/world/World.js`

- [ ] **Step 1: 引入新依赖**

在 `src/world/World.js` 顶部 import 区追加：

```javascript
import { FrameBudgetScheduler } from '../core/FrameBudgetScheduler.js';
```

constructor 中追加：

```javascript
    this.frameBudgetScheduler = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
```

- [ ] **Step 2: 新增 _processChunkInitBudgeted 方法**

```javascript
  _processChunkInitBudgeted() {
    if (this._pendingChunkInitQueue.length === 0) return;
    if (!this.frameBudgetScheduler.hasTimeFor(0.3)) return;

    const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
    const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
    this._pendingChunkInitQueue.sort((a, b) => {
      const distA = Math.abs(a.cx - playerCx) + Math.abs(a.cz - playerCz);
      const distB = Math.abs(b.cx - playerCx) + Math.abs(b.cz - playerCz);
      return distA - distB;
    });

    const chunk = this._pendingChunkInitQueue.shift();
    if (!chunk || chunk.disposed) return;
    this._requestRuntimeChunkRecord(chunk);
  }
```

- [ ] **Step 3: 新增 _processStagingPrepare 和 _publishReadyChunks 方法**

```javascript
  _processStagingPrepare() {
    if (!this.globalInstancedMeshManager) return;
    const remainingMs = this.frameBudgetScheduler.getRemainingMs();
    if (remainingMs < 0.5) return;

    this.globalInstancedMeshManager.prepareStagedBlocks({
      maxBlocks: 600,
      maxMs: Math.min(remainingMs * 0.6, 2)
    });
  }

  _publishReadyChunks() {
    if (!this.globalInstancedMeshManager) return;
    const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
    const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
    const ready = this.globalInstancedMeshManager.getReadyToPublishChunks(playerCx, playerCz);

    for (const entry of ready) {
      this.globalInstancedMeshManager.publishPreparedChunk(entry.chunkKey);
      this._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();
      this.runtimeIdleScheduler?.markBusy('chunk-published');
      this.requestShadowMapUpdate('chunk-published');
    }
  }
```

- [ ] **Step 4: 重构 update() 的 runtime-streaming 调度**

将 update() 中现有的 runtime-streaming 调度逻辑（约 L1217-1239）替换为：

```javascript
    if (this.bootstrapState.phase === 'runtime-streaming') {
      this.frameBudgetScheduler.beginFrame();

      this._processChunkInitBudgeted();

      if (this.frameBudgetScheduler.hasTimeFor(1.0)) {
        this.chunkAssemblyScheduler.processWithinBudget({
          budgetMs: Math.min(this.frameBudgetScheduler.getRemainingMs() * 0.4, 3),
          maxTasks: 20
        });
      }

      if (this.frameBudgetScheduler.hasTimeFor(0.5)) {
        this._processStagingPrepare();
      }

      this._publishReadyChunks();

      if (this.frameBudgetScheduler.hasTimeFor(0.5)) {
        this._processChunkDeltaPatches({ maxMs: Math.min(1.5, this.frameBudgetScheduler.getRemainingMs()) });
      }

      if (this.frameBudgetScheduler.hasTimeFor(0.3)) {
        this._processDeferredFinalizeQueue();
        this.runtimeIdleScheduler.process({
          phase: this.bootstrapState.phase,
          hasAssemblyWork: this.chunkAssemblyScheduler.hasWork(),
          playerPosition: this._lastPlayerPos
        }, { frameBudgetMs: this.frameBudgetScheduler.getRemainingMs() });
      }
    } else {
      // bootstrap 保留旧路径
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

- [ ] **Step 5: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: 无新增 error

- [ ] **Step 7: 提交**

```bash
git add src/world/World.js
git commit -m "feat(world): 集成 FrameBudgetScheduler + 两阶段提交调度"
```

---

### Task 7: [P1] TypeBuffer 容量 hints 调大 + Consolidation 预扩容

**Files:**
- Modify: `src/world/World.js:83-99`
- Modify: `src/core/GlobalInstancedMeshManager.js` (patchChunkVisibleBlocks)

- [ ] **Step 1: 调大 typeCapacityHints**

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

- [ ] **Step 2: patchChunkVisibleBlocks 添加预扩容**

在 `patchChunkVisibleBlocks` 方法开头（`_purgeQueuedChunk` 之后）添加：

```javascript
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

- [ ] **Step 3: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add src/world/World.js src/core/GlobalInstancedMeshManager.js
git commit -m "perf(core): 调大 TypeBuffer 初始容量 + consolidation 预扩容"
```

---

### Task 8: [P2] 手动集成测试 + 奔跑验证

**Files:** 无新文件

- [ ] **Step 1: 启动开发服务器**

Run: `npm run start`

- [ ] **Step 2: 验证初始加载**

打开 `http://localhost:8080`，确认：
1. 初始 chunk 正常加载
2. 方块正常渲染，无闪烁

- [ ] **Step 3: 奔跑压测（30 秒持续移动）**

使用 WASD 向一个方向持续奔跑 30 秒，观察：
1. 新 chunk 是否从雾中自然出现（无突兀弹出）
2. 已显示的 chunk 是否有闪烁/方块消失
3. FPS 是否稳定（HUD 右上角）
4. 打开浏览器控制台检查是否有错误

- [ ] **Step 4: 交互测试**

1. 放置多个方块 → 确认即时出现
2. 挖掘方块 → 确认即时消失
3. 快速放置 50+ 方块触发 consolidation → 确认无闪烁

- [ ] **Step 5: Performance 面板验证**

打开 Chrome DevTools Performance 面板，录制 10 秒奔跑：
1. 检查是否有 > 16ms 的 long task
2. 检查 Worker 通信是否使用了 transferable（Message 事件应无大体积 clone）
3. 检查帧时间分布

- [ ] **Step 6: 运行 lint + 全量测试**

```bash
npm run lint
node command/run-tests.js --verbose
```
Expected: 无新增 error，测试全 PASS

- [ ] **Step 7: 提交修复（如有）**

```bash
git add -A
git commit -m "fix: 集成测试修复"
```

---

## 注意事项

1. **Bootstrap 阶段完全不受影响**：所有改动仅影响 `runtime-streaming` 阶段。bootstrap 阶段使用旧的 mutation queue flush 路径，确保首屏加载速度不退化。

2. **两阶段原子的关键不变式**：prepare 期间 `buffer.count` 不变，shadow region 的数据对渲染不可见。只有 publish 时的 `count = newCount` 是唯一的可见性切换点。

3. **Consolidation 不走 staging**：Consolidation 使用 `patchChunkVisibleBlocks`（增量 diff），chunk 已在渲染中不需要"原子出现"语义。但需要预扩容防止 `ensureCapacity` 触发 mesh 切换。

4. **Worker transfer 后 ArrayBuffer 不可复用**：transfer 后 Worker 侧的 buffer 变 detached。如果 Worker 有复用 buffer 的逻辑需要检查。当前代码每次 consolidation 都新建数组，不复用，所以安全。

5. **snapshot.blocks 裁剪风险**：Task 4 Step 2 要求 grep 确认消费方。如果有代码依赖 `snapshot.blocks`，需要保留或改读 `blockDataBlocks`。
