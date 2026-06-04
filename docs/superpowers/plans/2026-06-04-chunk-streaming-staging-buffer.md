# Chunk 流式加载 Staging Buffer 实施计划 (v4.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除玩家奔跑过程中加载 chunk 时的卡顿和画面闪烁。Staging 数据与 TypeBuffer 完全隔离（独立 typed arrays），publish 时一帧写入。

**Architecture:** Staging zone 持有独立的 per-chunk 连续 Float32Array，不写 TypeBuffer、不注册 coordToRef。prepare 阶段分帧填充预分配的连续 Float32Array。publish 阶段一帧内预扩容 + `Float32Array.set` 连续拷贝 + 注册索引 + count bump + finalizeNonDeferredPhase。assembly 链路在 `runtime-finalize` 后中断，不 enqueue `finalize`/`non-deferred-finalize`，等 publish 后执行。`publishNextReadyChunk` 统一返回 `chunkKey | null`。

**Tech Stack:** Three.js 0.184.0 (WebGPURenderer + TSL Node Material), ES Modules, Web Workers, Playwright

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/FrameBudgetScheduler.js` | 新建 | 实时帧预算调度器 |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | staging zone（独立 arrays）+ prepare + publish |
| `src/world/Chunk.js` | 修改 | 废除 fast path；接受外部 maxMs；新增 renderState；isReady 对齐 |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 合并 fast stage；传递剩余预算 |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 初次加载写入 staging；不再设 isReady |
| `src/workers/WorldWorker.js` | 修改 | postMessage transfer list |
| `src/world/World.js` | 修改 | 集成 scheduler + publish 调度 + 生命周期清理 |
| `src/tests/test-frame-budget-scheduler.js` | 新建 | scheduler 单测 |
| `src/tests/test-global-instanced-mesh-manager.js` | 修改 | staging/prepare/publish 测试 |
| `src/tests/test-streaming-perf.js` | 新建 | 自动化压测 |

---

### Task 1: [P0] 废除 fast path + 可中断路径接受外部预算

**Files:**
- Modify: `src/world/Chunk.js:858-887`
- Modify: `src/world/ChunkAssemblyScheduler.js:49-152`

- [ ] **Step 1: 修改 assembleRuntimeBuildMeshPhase 接受外部 maxMs**

```javascript
  // src/world/Chunk.js — 修改方法签名
  assembleRuntimeBuildMeshPhase(maxMs = 3) {
    if (this.loadState === 'finalized') return true;
    if (this.loadState !== 'hydrated') {
      return this.loadState === 'terrain-built' || this.loadState === 'entities-built';
    }

    const result = this._buildMeshFromExistingBlockDataIncremental(maxMs);
    if (result === 'done') {
      this.loadState = 'terrain-built';
      // 注意：不再设 isReady=true，等 publish 后再设
    }
    return result;
  }
```

- [ ] **Step 2: assembleRuntimeBuildMeshFast 改为转发**

```javascript
  assembleRuntimeBuildMeshFast() {
    return this.assembleRuntimeBuildMeshPhase();
  }
```

- [ ] **Step 3: ChunkAssemblyScheduler 合并 fast stage + 传递剩余预算**

```javascript
  // src/world/ChunkAssemblyScheduler.js — _runTask 修改
  async _runTask(task, remainingBudgetMs) {
    const { chunk, stage } = task;
    const start = now();
    // ... existing guard code (disposed check, etc.) ...

    let stageResult = false;
    switch (stage) {
      case 'runtime-hydrate':
        stageResult = chunk.assembleRuntimeHydratePhase();
        if (stageResult === 'continue') {
          this.enqueue(chunk, stage, task.priority);
        } else if (stageResult === 'done' || stageResult === true) {
          this.enqueue(chunk, 'runtime-build-mesh', task.priority);
        }
        break;
      case 'runtime-build-mesh-fast':
      case 'runtime-build-mesh':
        stageResult = chunk.assembleRuntimeBuildMeshPhase(
          Math.max(1, remainingBudgetMs || 3)
        );
        if (stageResult === 'continue') {
          this.enqueue(chunk, 'runtime-build-mesh', task.priority);
        } else if (stageResult === 'done' || stageResult === true) {
          this.enqueue(chunk, 'runtime-finalize', task.priority);
        }
        break;
      case 'runtime-finalize':
        stageResult = chunk.assembleRuntimeFinalizePhase();
        if (stageResult === 'continue') {
          this.enqueue(chunk, stage, task.priority);
        } else if (stageResult === 'done' || stageResult === true) {
          // 关键变更：如果 chunk 处于 staged 状态，中断链路
          // 不 enqueue finalize/non-deferred-finalize，等 publish 后执行
          if (chunk.renderState === 'staged') {
            chunk.loadState = 'awaiting-publish';
          } else {
            this.enqueue(chunk, 'finalize', task.priority);
          }
        }
        break;
    }
    // ... existing perf recording ...
  }
```

在 `processWithinBudget` 循环中传递剩余时间：

```javascript
    while (this.queue.length > 0 && processed < maxTasksThisPass && (now() - start) <= budgetMs) {
      const task = this._takeNext();
      if (!task) break;
      processed++;
      const remaining = budgetMs - (now() - start);
      await this._runTask(task, remaining);
    }
```

- [ ] **Step 4: 运行测试**

Run: `node command/run-tests.js --verbose`
Expected: PASS

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`

- [ ] **Step 6: 如用户要求，提交**

```bash
git add src/world/Chunk.js src/world/ChunkAssemblyScheduler.js
git commit -m "perf(world): 废除 fast path，可中断 buildMesh 接受外部帧预算"
```

---

### Task 2: [P0] GlobalInstancedMeshManager — 独立 Staging Arrays + Prepare + Publish

**Files:**
- Modify: `src/core/GlobalInstancedMeshManager.js`
- Modify: `src/tests/test-global-instanced-mesh-manager.js`

- [ ] **Step 1: 编写测试**

在 `src/tests/test-global-instanced-mesh-manager.js` 末尾追加：

```javascript
  test('stageMeshDataForChunk 不注册到 coordToRef', () => {
    const { manager } = createManager(8);
    const blocks = [{ x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));

    assertEqual(manager.coordToRef.size, 0, 'staging 不注册 coordToRef');
    assertEqual(manager.chunkToCoords.has('0,0'), false, 'staging 不注册 chunkToCoords');
    assertEqual(manager.getStagedChunkKeys().length, 1, '应有 1 个 staged chunk');
  });

  test('prepareStagedBlocks 构建 compact batch 不写 TypeBuffer', () => {
    const { manager } = createManager(8);
    const blocks = [{ x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }, { x: 3, y: 2, z: 3 }];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });

    assertEqual(manager.buffers.has('stone'), false, 'prepare 不创建 buffer');
    assertEqual(manager.coordToRef.size, 0, 'prepare 不注册 coordToRef');
    assertEqual(manager.isPrepareComplete('0,0'), true, 'prepare 应完成');
  });

  test('prepare 期间活跃区操作不受影响', () => {
    const { manager } = createManager(8);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });

    // 活跃区正常 add
    const coord = encodeCoord(10, 10, 10);
    manager.addVisibleBlock(coord, { type: 'stone', orientation: 0 }, '1,1', {
      matrix: makeMatrix(10, 10, 10), aoLow: 1, aoHigh: 1, orientation: 0
    });
    assertEqual(manager.buffers.get('stone').count, 1, '活跃区 add 正常');
    assertEqual(manager.coordToRef.size, 1, 'coordToRef 只有活跃区的');
  });

  test('publishPreparedChunk 写入 TypeBuffer 并注册索引', () => {
    const { manager } = createManager(8);
    const blocks = [{ x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });
    const published = manager.publishPreparedChunk('0,0');

    assertTrue(published, 'publish 应返回 true');
    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 2, 'count 应为 2');
    assertEqual(buffer.mesh.count, 2, 'mesh.count 同步');
    assertEqual(manager.coordToRef.size, 2, '应注册 2 个 coordToRef');
    assertTrue(manager.chunkToCoords.has('0,0'), 'chunkToCoords 应注册');
    assertEqual(manager.getStagedChunkKeys().length, 0, 'staging 应清空');
  });

  test('publish 后 add/remove 正常工作', () => {
    const { manager } = createManager(8);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });
    manager.publishPreparedChunk('0,0');

    const newCoord = encodeCoord(5, 5, 5);
    manager.addVisibleBlock(newCoord, { type: 'stone', orientation: 0 }, '1,1', {
      matrix: makeMatrix(5, 5, 5), aoLow: 1, aoHigh: 1, orientation: 0
    });
    assertEqual(manager.buffers.get('stone').count, 2, 'publish 后 add 正常');

    manager.removeVisibleBlock(encodeCoord(1, 2, 3));
    assertEqual(manager.buffers.get('stone').count, 1, 'publish 后 remove 正常');
  });

  test('removeChunk 清理 staged 数据', () => {
    const { manager } = createManager(8);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });
    manager.removeChunk('0,0');

    assertEqual(manager.getStagedChunkKeys().length, 0, 'staging 应清空');
    assertEqual(manager.coordToRef.size, 0, '无 coordToRef 残留');
  });

  test('publishNextReadyChunk 每次只 publish 1 个', () => {
    const { manager } = createManager(16);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.stageMeshDataForChunk('1,0', makeMeshData([{ x: 17, y: 2, z: 3 }]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });

    assertTrue(manager.isPrepareComplete('0,0'), '0,0 应 prepare 完成');
    assertTrue(manager.isPrepareComplete('1,0'), '1,0 应 prepare 完成');

    const published = manager.publishNextReadyChunk(0, 0);
    assertTrue(published, '应 publish 1 个');
    assertEqual(manager.coordToRef.size, 1, '只有 1 个 chunk 的方块在 coordToRef');
    assertEqual(manager.getStagedChunkKeys().length, 1, '应剩余 1 个 staged');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL

- [ ] **Step 3: 实现 staging zone + prepare + publish**

在 `GlobalInstancedMeshManager` constructor 追加：
```javascript
    this.stagingZone = new Map(); // chunkKey → { meshDataArray, blockCount, prepareState }
```

实现方法：

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

  prepareStagedBlocks(options = {}) {
    const maxBlocks = options.maxBlocks || 600;
    const maxMs = options.maxMs || 2;
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    const start = now();
    let processed = 0;

    for (const [chunkKey, staged] of this.stagingZone) {
      if (processed >= maxBlocks || now() - start >= maxMs) break;
      if (!staged.prepareState) {
        this._initPrepareState(staged);
      }
      const ps = staged.prepareState;
      if (ps.complete) continue;

      while (ps.dataCursor < staged.meshDataArray.length && processed < maxBlocks && now() - start < maxMs) {
        const data = staged.meshDataArray[ps.dataCursor];
        const { type, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;
        const renderKey = this.getRenderKey(type);
        const entries = Object.entries(instanceIndexMap || {});
        const batch = ps.compactBatch.get(renderKey);
        if (!batch) { ps.dataCursor++; ps.entryCursor = 0; continue; }

        while (ps.entryCursor < entries.length && processed < maxBlocks && now() - start < maxMs) {
          const [coordText, sourceIndex] = entries[ps.entryCursor];
          const coord = Number(coordText);
          const writePos = batch.cursor;

          // 写入预分配的连续 Float32Array
          batch.coords[writePos] = coord;
          batch.matrices.set(
            matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE),
            writePos * MATRIX_STRIDE
          );
          batch.aoLow[writePos] = aoLow?.[sourceIndex] ?? 1;
          batch.aoHigh[writePos] = aoHigh?.[sourceIndex] ?? 1;
          batch.orientation[writePos] = orientation?.[sourceIndex] ?? 0;
          batch.cursor++;

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
        staged.meshDataArray = null;
      }
    }
    return processed;
  }

  _initPrepareState(staged) {
    // 统计每个 renderKey 的总块数，预分配连续 Float32Array
    const typeCounts = new Map();
    for (const data of staged.meshDataArray) {
      const renderKey = this.getRenderKey(data.type);
      const entries = Object.entries(data.instanceIndexMap || {});
      typeCounts.set(renderKey, (typeCounts.get(renderKey) || 0) + entries.length);
    }

    const compactBatch = new Map();
    for (const [renderKey, count] of typeCounts) {
      compactBatch.set(renderKey, {
        type: renderKey,
        coords: new Array(count),
        matrices: new Float32Array(count * MATRIX_STRIDE),
        aoLow: new Float32Array(count),
        aoHigh: new Float32Array(count),
        orientation: new Float32Array(count),
        count,
        cursor: 0
      });
    }

    staged.prepareState = { compactBatch, dataCursor: 0, entryCursor: 0, complete: false };
  }

  publishPreparedChunk(chunkKey) {
    const staged = this.stagingZone.get(chunkKey);
    if (!staged || !staged.prepareState?.complete) return false;

    const ps = staged.prepareState;

    if (!this.chunkToCoords.has(chunkKey)) this.chunkToCoords.set(chunkKey, new Set());
    const chunkCoords = this.chunkToCoords.get(chunkKey);

    for (const [renderKey, batch] of ps.compactBatch) {
      const buffer = this.getOrCreateBuffer(batch.type);
      const batchCount = batch.count;

      // 预扩容
      buffer.ensureCapacity(buffer.count + batchCount);

      const baseIndex = buffer.count;

      // 连续批量拷贝 matrices（单次 set，非逐块）
      buffer.mesh.instanceMatrix.array.set(batch.matrices, baseIndex * MATRIX_STRIDE);

      // 连续批量拷贝 AO / orientation
      const attrAoLow = buffer.mesh.geometry.getAttribute('aAoLow');
      const attrAoHigh = buffer.mesh.geometry.getAttribute('aAoHigh');
      const attrOrientation = buffer.mesh.geometry.getAttribute('aOrientation');
      if (attrAoLow) attrAoLow.array.set(batch.aoLow, baseIndex);
      if (attrAoHigh) attrAoHigh.array.set(batch.aoHigh, baseIndex);
      if (attrOrientation) attrOrientation.array.set(batch.orientation, baseIndex);

      // 注册索引（逐坐标，无法批量化）
      for (let i = 0; i < batchCount; i++) {
        const coord = batch.coords[i];
        const writeIndex = baseIndex + i;
        buffer.coordToIndex.set(coord, writeIndex);
        buffer.indexToCoord[writeIndex] = coord;
        this.coordToRef.set(coord, { renderKey, index: writeIndex, chunkKey });
        chunkCoords.add(coord);
      }

      // bump count
      buffer.count += batchCount;
      buffer.mesh.count = buffer.count;

      // 标记 dirty
      buffer.dirtyStart = Math.min(buffer.dirtyStart, baseIndex);
      buffer.dirtyEnd = Math.max(buffer.dirtyEnd, baseIndex + batchCount - 1);
      buffer.dirtyMatrix = true;
      buffer.dirtyAO = true;
      buffer.dirtyBounds = true;
    }

    this.commitDirtyBuffers();
    this.stagingZone.delete(chunkKey);
    return true;
  }

  /**
   * 每帧调用，最多 publish 1 个距离最近的 ready chunk。
   * @returns {string|null} 被 publish 的 chunkKey，或 null
   */
  publishNextReadyChunk(playerCx, playerCz) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const [chunkKey, staged] of this.stagingZone) {
      if (!staged.prepareState?.complete) continue;
      const dist = this._getChunkDistance(chunkKey, playerCx, playerCz);
      if (dist < bestDist) { bestDist = dist; bestKey = chunkKey; }
    }
    if (!bestKey) return null;
    const success = this.publishPreparedChunk(bestKey);
    return success ? bestKey : null;
  }

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
```

- [ ] **Step 4: 修改 removeChunk 先清理 staging**

```javascript
  removeChunk(chunkKey) {
    this.removeStagedChunk(chunkKey);
    this._purgeQueuedChunk(chunkKey);
    // ... existing removeChunk logic ...
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: PASS

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`

- [ ] **Step 7: 如用户要求，提交**

```bash
git add src/core/GlobalInstancedMeshManager.js src/tests/test-global-instanced-mesh-manager.js
git commit -m "feat(core): 独立 staging arrays + prepare + publish 两阶段原子"
```

---

### Task 3: [P0] ChunkGenerator → staging + Chunk renderState + isReady 对齐

**Files:**
- Modify: `src/world/ChunkGenerator.js:132-145`
- Modify: `src/world/Chunk.js` (renderState + isReady)

- [ ] **Step 1: Chunk 新增 renderState 字段**

在 `Chunk` constructor 中（约 `this.isReady = false` 附近）追加：

```javascript
    this.renderState = 'none'; // 'none' | 'staged' | 'published'
```

- [ ] **Step 2: 修改 assembleRuntimeBuildMeshPhase 不再设 isReady**

```javascript
  assembleRuntimeBuildMeshPhase(maxMs = 3) {
    if (this.loadState === 'finalized') return true;
    if (this.loadState !== 'hydrated') {
      return this.loadState === 'terrain-built' || this.loadState === 'entities-built';
    }

    const result = this._buildMeshFromExistingBlockDataIncremental(maxMs);
    if (result === 'done') {
      this.loadState = 'terrain-built';
      // isReady 不在这里设置，等 publish 后由 World 设置
    }
    return result;
  }
```

- [ ] **Step 3: 修改 buildMeshes 初次加载路径**

```javascript
    if (this.world?.globalInstancedMeshManager) {
      const chunkKey = `${this.cx},${this.cz}`;
      const isInitialBuild = this.loadState !== 'finalized' && this.loadState !== 'waiting-consolidation';
      let result;
      if (isInitialBuild) {
        result = this.world.globalInstancedMeshManager.stageMeshDataForChunk(chunkKey, meshDataArray);
        this.renderState = 'staged';
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

- [ ] **Step 4: World 卸载循环清理 staging**

在 `World.update()` 卸载循环中 `chunk.dispose()` 前添加：

```javascript
        this.globalInstancedMeshManager?.removeStagedChunk(key);
```

- [ ] **Step 5: World._publishNextReadyChunk 中设置 isReady 和 renderState**

```javascript
  _publishNextReadyChunk() {
    if (!this.globalInstancedMeshManager) return;
    if (!this.frameBudgetScheduler.hasTimeFor(0.8)) return;
    const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
    const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
    const publishedKey = this.globalInstancedMeshManager.publishNextReadyChunk(playerCx, playerCz);
    if (publishedKey) {
      const chunk = this.chunks.get(publishedKey);
      if (chunk && !chunk.disposed) {
        chunk.renderState = 'published';
        // publish 后执行 finalize（设置 isReady=true, loadState='finalized'）
        chunk.finalizeNonDeferredPhase();
      }
      this._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();
      this.runtimeIdleScheduler?.markBusy('chunk-published');
      this.requestShadowMapUpdate('chunk-published');
    }
  }
```

为了让 World 知道哪个 chunk 被 publish 了，修改 `publishNextReadyChunk` 返回值：

```javascript
  // GlobalInstancedMeshManager 中
  publishNextReadyChunk(playerCx, playerCz) {
    // ... find bestKey ...
    if (!bestKey) return null;
    const success = this.publishPreparedChunk(bestKey);
    return success ? bestKey : null;
  }
```

World 中（与 Task 3 Step 5 中的定义一致）：

```javascript
  _publishNextReadyChunk() {
    if (!this.globalInstancedMeshManager) return;
    if (!this.frameBudgetScheduler.hasTimeFor(0.8)) return;
    const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
    const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
    const publishedKey = this.globalInstancedMeshManager.publishNextReadyChunk(playerCx, playerCz);
    if (publishedKey) {
      const chunk = this.chunks.get(publishedKey);
      if (chunk && !chunk.disposed) {
        chunk.renderState = 'published';
        chunk.finalizeNonDeferredPhase();
      }
      this._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();
      this.runtimeIdleScheduler?.markBusy('chunk-published');
      this.requestShadowMapUpdate('chunk-published');
    }
  }
```

- [ ] **Step 6: 运行测试**

Run: `node command/run-tests.js --verbose`
Expected: PASS

- [ ] **Step 7: 如用户要求，提交**

```bash
git add src/world/Chunk.js src/world/ChunkGenerator.js src/world/World.js
git commit -m "feat(world): buildMeshes→staging + renderState 状态机 + isReady 对齐"
```

---

### Task 4: [P0] Worker 回包 Transferable

**Files:**
- Modify: `src/workers/WorldWorker.js:2901`

- [ ] **Step 1: 在 consolidation 回包前收集 transfer list**

在 `postMessage` 调用前追加：

```javascript
  const transferList = [];
  if (meshData && Array.isArray(meshData)) {
    for (const group of meshData) {
      if (group.matrices?.buffer) transferList.push(group.matrices.buffer);
      if (group.aoLow?.buffer) transferList.push(group.aoLow.buffer);
      if (group.aoHigh?.buffer) transferList.push(group.aoHigh.buffer);
      if (group.orientation?.buffer) transferList.push(group.orientation.buffer);
    }
  }
```

修改 `postMessage(payload)` 为 `postMessage(payload, transferList)`。

保留所有现有字段不变（snapshot.blocks、routing、modGunMan、rovers 等）。

- [ ] **Step 2: 运行测试**

Run: `node command/run-tests.js --verbose`
Expected: PASS

- [ ] **Step 3: 如用户要求，提交**

```bash
git add src/workers/WorldWorker.js
git commit -m "perf(worker): consolidation 回包 meshData 使用 Transferable"
```

---

### Task 5: [P1] FrameBudgetScheduler

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
  test('beginFrame 后 getRemainingMs 接近 targetFrameMs - safetyMargin', () => {
    const s = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    s.beginFrame();
    const r = s.getRemainingMs();
    assertTrue(r >= 7 && r <= 8.5, `应接近 8ms, got ${r}`);
  });

  test('hasTimeFor 正确判断', () => {
    const s = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    s.beginFrame();
    assertTrue(s.hasTimeFor(5), '应有 5ms');
    assertEqual(s.hasTimeFor(10), false, '不应有 10ms');
  });
});
```

- [ ] **Step 2: 实现**

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
}
```

- [ ] **Step 3: 运行测试**

Run: `node command/run-tests.js --verbose`
Expected: PASS

- [ ] **Step 4: 如用户要求，提交**

```bash
git add src/core/FrameBudgetScheduler.js src/tests/test-frame-budget-scheduler.js
git commit -m "feat(core): 新增 FrameBudgetScheduler 实时帧预算调度器"
```

---

### Task 6: [P1] World.js — 集成 FrameBudgetScheduler + 调度重构

**Files:**
- Modify: `src/world/World.js`

- [ ] **Step 1: 引入并初始化**

import 追加：
```javascript
import { FrameBudgetScheduler } from '../core/FrameBudgetScheduler.js';
```

constructor 追加：
```javascript
    this.frameBudgetScheduler = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
```

- [ ] **Step 2: 新增调度方法**

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

  _processStagingPrepare() {
    if (!this.globalInstancedMeshManager) return;
    const remaining = this.frameBudgetScheduler.getRemainingMs();
    if (remaining < 0.5) return;
    this.globalInstancedMeshManager.prepareStagedBlocks({
      maxBlocks: 600,
      maxMs: Math.min(remaining * 0.5, 2)
    });
  }

  _publishNextReadyChunk() {
    if (!this.globalInstancedMeshManager) return;
    if (!this.frameBudgetScheduler.hasTimeFor(0.8)) return;
    const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
    const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
    const publishedKey = this.globalInstancedMeshManager.publishNextReadyChunk(playerCx, playerCz);
    if (publishedKey) {
      const chunk = this.chunks.get(publishedKey);
      if (chunk && !chunk.disposed) {
        chunk.renderState = 'published';
        chunk.finalizeNonDeferredPhase();
      }
      this._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();
      this.runtimeIdleScheduler?.markBusy('chunk-published');
      this.requestShadowMapUpdate('chunk-published');
    }
  }
```

- [ ] **Step 3: 重构 update() runtime-streaming 调度**

替换 L1217-1239：

```javascript
    if (this.bootstrapState.phase === 'runtime-streaming') {
      this.frameBudgetScheduler.beginFrame();

      this._processChunkInitBudgeted();

      if (this.frameBudgetScheduler.hasTimeFor(1.0)) {
        const budgetMs = Math.min(this.frameBudgetScheduler.getRemainingMs() * 0.4, 3);
        this.chunkAssemblyScheduler.processWithinBudget({ budgetMs, maxTasks: 20 });
      }

      if (this.frameBudgetScheduler.hasTimeFor(0.5)) {
        this._processStagingPrepare();
      }

      this._publishNextReadyChunk();

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

      if (this.pendingShadowUpdate) {
        const now = globalThis.performance?.now?.() ?? Date.now();
        if (now - this.shadowUpdateScheduledAt >= 200) {
          this.flushShadowUpdates('batched-world-change');
        }
      }
    } else {
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

- [ ] **Step 4: 运行测试**

Run: `node command/run-tests.js --verbose`
Expected: PASS

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`

- [ ] **Step 6: 如用户要求，提交**

```bash
git add src/world/World.js
git commit -m "feat(world): 集成 FrameBudgetScheduler + prepare/publish 调度"
```

---

### Task 7: [P1] TypeBuffer 容量 hints + Consolidation 预扩容

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

- [ ] **Step 2: patchChunkVisibleBlocks 精确预扩容（只算 missing）**

在方法开头 `_purgeQueuedChunk` 之后添加：

```javascript
    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered) continue;
      let missingCount = 0;
      for (const coordText of Object.keys(instanceIndexMap || {})) {
        if (!this.coordToRef.has(Number(coordText))) missingCount++;
      }
      if (missingCount > 0) {
        const buffer = this.getOrCreateBuffer(type);
        buffer.ensureCapacity(buffer.count + missingCount);
      }
    }
```

- [ ] **Step 3: 运行测试**

Run: `node command/run-tests.js --verbose`
Expected: PASS

- [ ] **Step 4: 如用户要求，提交**

```bash
git add src/world/World.js src/core/GlobalInstancedMeshManager.js
git commit -m "perf(core): 调大容量 hints + consolidation 精确预扩容"
```

---

### Task 8: [P2] 自动化压测 + 手动验证

**Files:**
- Create: `src/tests/test-streaming-perf.js`

- [ ] **Step 1: 编写压测**

```javascript
// src/tests/test-streaming-perf.js
import { describe } from './runner.js';
import { assertTrue } from './assert.js';

describe('Streaming Performance', (test) => {
  test('持续移动 10 秒帧率 p95 < 20ms', async () => {
    const game = window.game;
    if (!game?.world?.bootstrapState) { console.warn('[perf] skip'); return; }

    let waited = 0;
    while (game.world.bootstrapState.phase !== 'runtime-streaming' && waited < 10000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (game.world.bootstrapState.phase !== 'runtime-streaming') {
      console.warn('[perf] not runtime-streaming, skip');
      return;
    }

    const frameTimes = [];
    const duration = 10000;
    const start = performance.now();
    let lastFrame = start;

    await new Promise(resolve => {
      const collect = () => {
        const now = performance.now();
        frameTimes.push(now - lastFrame);
        lastFrame = now;
        if (game.player?.position) game.player.position.z += 0.3;
        if (now - start < duration) requestAnimationFrame(collect);
        else resolve();
      };
      requestAnimationFrame(collect);
    });

    frameTimes.sort((a, b) => a - b);
    const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)];
    const p99 = frameTimes[Math.floor(frameTimes.length * 0.99)];
    const longTasks = frameTimes.filter(t => t > 16.7).length;

    console.log(`[perf] frames=${frameTimes.length} p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms longTasks=${longTasks}`);
    assertTrue(p95 < 20, `p95=${p95.toFixed(1)}ms should be < 20ms`);
  });
});
```

- [ ] **Step 2: 手动集成验证**

1. `npm run start` → 浏览器验证初始加载
2. WASD 奔跑 30 秒 → 无闪烁、无突兀弹出、FPS 稳定
3. 放置/挖掘方块 → consolidation 无闪烁
4. DevTools Performance 录制 10 秒确认无 >16ms long task

- [ ] **Step 3: 如用户要求，提交**

```bash
git add src/tests/test-streaming-perf.js
git commit -m "test(perf): 自动化奔跑压测 — p95/p99 + long task 统计"
```

---

## 注意事项

1. **Staging 与 TypeBuffer 完全隔离**：staging 数据是独立 JS arrays，不写 TypeBuffer、不注册 coordToRef。所有现有 add/remove/patch/updateAO/resolveHit 方法完全不知道 staging 的存在。

2. **isReady 仅在 publish 后设置**：buildMeshes 完成后 chunk 进入 `renderState='staged'`，assembly 链路在 `runtime-finalize` 后中断（不 enqueue `finalize`/`non-deferred-finalize`）。World 在 `_publishNextReadyChunk` 成功后调用 `chunk.finalizeNonDeferredPhase()`（设置 isReady=true、loadState='finalized'、onChunkFinalized）。

3. **每帧最多 publish 1 个 chunk**：`publishNextReadyChunk` 按距离排序只返回 1 个 chunkKey。受 FrameBudgetScheduler 剩余时间 ≥ 0.8ms 门槛控制。

4. **Bootstrap 不受影响**：所有改动在 `runtime-streaming` 阶段生效。

5. **Worker 保留所有字段**：只加 transfer list，不裁剪任何现有字段。

6. **Git 提交按用户指令**：所有 commit step 标注"如用户要求"。
