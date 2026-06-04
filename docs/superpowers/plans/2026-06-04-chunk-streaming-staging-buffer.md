# Chunk 流式加载 Staging Buffer 实施计划 (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除玩家奔跑过程中加载 chunk 时的卡顿和画面闪烁。通过废除同步构建路径、引入带 reservation 的两阶段原子提交（分帧 prepare + 一帧 publish）、Worker Transferable 优化和实时帧预算调度实现流畅体验。

**Architecture:** TypeBuffer 引入 reservation 机制将 shadow region 与活跃渲染区严格隔离。prepare 阶段分帧写入 reserved region 并同步注册索引映射，publish 阶段只做 count bump。FrameBudgetScheduler 基于 `performance.now() - frameStart` 实时分配预算，每个阶段领取剩余时间。

**Tech Stack:** Three.js 0.184.0 (WebGPURenderer + TSL Node Material), ES Modules, Web Workers, Playwright (压测)

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/FrameBudgetScheduler.js` | 新建 | 实时帧预算调度器 |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | staging zone + reservation + prepare + publish + 生命周期清理 |
| `src/world/Chunk.js` | 修改 | 废除 fast path；assembleRuntimeBuildMeshPhase 接受外部 maxMs |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 合并 fast stage；传递剩余预算 |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 初次加载写入 staging |
| `src/workers/WorldWorker.js` | 修改 | postMessage transfer list |
| `src/world/World.js` | 修改 | 集成 scheduler + prepare/publish 调度 + 生命周期清理 |
| `src/tests/test-frame-budget-scheduler.js` | 新建 | scheduler 单测 |
| `src/tests/test-global-instanced-mesh-manager.js` | 修改 | staging/reservation/publish 测试 |
| `src/tests/test-streaming-perf.js` | 新建 | 自动化奔跑压测 |

---

### Task 1: [P0] 废除 fast path + 可中断路径接受外部预算

**Files:**
- Modify: `src/world/Chunk.js:858-887`
- Modify: `src/world/ChunkAssemblyScheduler.js:49-152`

- [ ] **Step 1: 修改 assembleRuntimeBuildMeshPhase 接受外部 maxMs**

在 `src/world/Chunk.js` 中将方法签名和调用改为：

```javascript
  assembleRuntimeBuildMeshPhase(maxMs = 3) {
    if (this.loadState === 'finalized') return true;
    if (this.loadState !== 'hydrated') {
      return this.loadState === 'terrain-built' || this.loadState === 'entities-built';
    }

    const result = this._buildMeshFromExistingBlockDataIncremental(maxMs);
    if (result === 'done') {
      this.loadState = 'terrain-built';
      this.isReady = true;
    }
    return result;
  }
```

- [ ] **Step 2: 将 assembleRuntimeBuildMeshFast 改为转发**

```javascript
  assembleRuntimeBuildMeshFast() {
    return this.assembleRuntimeBuildMeshPhase();
  }
```

- [ ] **Step 3: 修改 ChunkAssemblyScheduler 传递预算给 chunk**

在 `ChunkAssemblyScheduler.processWithinBudget` 中，将 `_runTask` 调用改为传递当前剩余预算：

```javascript
  async _runTask(task, remainingBudgetMs) {
    const { chunk, stage } = task;
    // ... existing guard code ...

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
      // ... rest unchanged ...
    }
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

- [ ] **Step 4: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`

- [ ] **Step 6: 如用户要求，提交**

```bash
git add src/world/Chunk.js src/world/ChunkAssemblyScheduler.js
git commit -m "perf(world): 废除 fast path，可中断 buildMesh 接受外部帧预算"
```

---

### Task 2: [P0] GlobalInstancedMeshManager — Reservation + 两阶段原子

**Files:**
- Modify: `src/core/GlobalInstancedMeshManager.js`
- Modify: `src/tests/test-global-instanced-mesh-manager.js`

- [ ] **Step 1: 编写 reservation + prepare + publish 测试**

在 `src/tests/test-global-instanced-mesh-manager.js` 末尾追加：

```javascript
  test('stageMeshDataForChunk 存入 staging 不触发渲染', () => {
    const { manager } = createManager(8);
    const blocks = [{ x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    assertEqual(manager.coordToRef.size, 0, 'staging 后不应有渲染实例');
    assertEqual(manager.getStagedChunkKeys().length, 1, '应有 1 个 staged chunk');
  });

  test('prepareStagedBlocks 写入 reserved region 不影响 mesh.count', () => {
    const { manager } = createManager(8);
    const blocks = [{ x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }, { x: 3, y: 2, z: 3 }];
    manager.stageMeshDataForChunk('0,0', makeMeshData(blocks));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });

    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 0, 'prepare 期间 mesh.count 保持 0');
    assertEqual(buffer.mesh.count, 0, 'mesh.count 保持 0');
    assertTrue(buffer._reservedTail > 0, 'reservedTail 应被设置');
    assertEqual(manager.isPrepareComplete('0,0'), true, 'prepare 应完成');
  });

  test('prepare 期间 addVisibleBlock 不侵入 reserved region', () => {
    const { manager } = createManager(16);
    manager.stageMeshDataForChunk('0,0', makeMeshData([
      { x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }
    ]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });

    // 活跃区添加方块
    const newCoord = encodeCoord(10, 10, 10);
    manager.addVisibleBlock(newCoord, { type: 'stone', orientation: 0 }, '1,1', {
      matrix: makeMatrix(10, 10, 10), aoLow: 1, aoHigh: 1, orientation: 0
    });

    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 1, '活跃区 count 应为 1');
    // reserved 数据不被覆盖
    assertTrue(buffer._reservedTail >= buffer.count + 2, 'reserved 区域应完整');
  });

  test('publishPreparedChunk 一帧 bump count', () => {
    const { manager } = createManager(8);
    manager.stageMeshDataForChunk('0,0', makeMeshData([
      { x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }
    ]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });
    manager.publishPreparedChunk('0,0');

    const buffer = manager.buffers.get('stone');
    assertEqual(buffer.count, 2, 'publish 后 count = 2');
    assertEqual(buffer.mesh.count, 2, 'mesh.count 同步');
    assertEqual(manager.coordToRef.size, 2, '应有 2 个渲染引用');
    assertEqual(buffer._reservedTail, buffer.count, 'reservation 应释放');
  });

  test('publish 后 add/remove 操作正确', () => {
    const { manager } = createManager(8);
    manager.stageMeshDataForChunk('0,0', makeMeshData([
      { x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }
    ]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });
    manager.publishPreparedChunk('0,0');

    // publish 后正常 add
    const c = encodeCoord(5, 5, 5);
    manager.addVisibleBlock(c, { type: 'stone', orientation: 0 }, '1,1', {
      matrix: makeMatrix(5, 5, 5), aoLow: 1, aoHigh: 1, orientation: 0
    });
    assertEqual(manager.buffers.get('stone').count, 3, 'add 后 count = 3');

    // publish 后正常 remove
    manager.removeVisibleBlock(encodeCoord(1, 2, 3));
    assertEqual(manager.buffers.get('stone').count, 2, 'remove 后 count = 2');
  });

  test('removeChunk 清理 staged + reservation', () => {
    const { manager } = createManager(8);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });
    manager.removeChunk('0,0');

    assertEqual(manager.getStagedChunkKeys().length, 0, 'staging 应清空');
    const buffer = manager.buffers.get('stone');
    assertEqual(buffer._reservedTail, buffer.count, 'reservation 应释放');
  });

  test('removeStagedChunk 清理未 prepare 的数据', () => {
    const { manager } = createManager(8);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.removeStagedChunk('0,0');
    assertEqual(manager.getStagedChunkKeys().length, 0, 'staging 应清空');
  });

  test('每帧最多 publish 1 个 chunk', () => {
    const { manager } = createManager(16);
    manager.stageMeshDataForChunk('0,0', makeMeshData([{ x: 1, y: 2, z: 3 }]));
    manager.stageMeshDataForChunk('1,0', makeMeshData([{ x: 17, y: 2, z: 3 }]));
    manager.prepareStagedBlocks({ maxBlocks: 100, maxMs: 100 });

    // publishNextReady 只 publish 1 个
    const published = manager.publishNextReadyChunk(0, 0);
    assertTrue(published, '应成功 publish 1 个');
    assertEqual(manager.getStagedChunkKeys().length, 0, '两个都应该 prepare 完成');
    // 第一个已 publish，coordToRef 应有 1 个
    // 注意：如果两个都 prepare 完了 getStagedChunkKeys 会是 0
    // 实际上 getStagedChunkKeys 在 publish 后删除对应条目
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL

- [ ] **Step 3: TypeBuffer 添加 reservation 支持**

在 `TypeBuffer` 类中添加 `_reservedTail` 字段和相关方法：

constructor 追加：
```javascript
    this._reservedTail = this.capacity; // 无 reservation 时等于 capacity
```

新增 `reserve` 方法：
```javascript
  reserve(count) {
    const start = this._reservedTail - count; // 从末尾向前分配? 不，从 count 之后向后
    // 实际设计：从 buffer.count (或上一个 reservation 的 end) 开始
    // reservedTail 表示"所有已用空间（活跃+reserved）的尾部"
    // 这里简化为：reserved 从当前 reservedTail 开始追加
    const reservedStart = this._reservedTail;
    this.ensureCapacity(reservedStart + count);
    this._reservedTail = reservedStart + count;
    return { start: reservedStart, count };
  }

  releaseReservation(reservation) {
    // 将 reservedTail 回退（简化：只支持栈式释放，或标记释放后在 publish 时整理）
    // 实际采用更简单的方案：publish 时把 reserved 数据搬到 count 位置后 bump
    // 这里 release 只是标记 reservation 失效
    // reservedTail 的回退由 publish 或 clearReservations 处理
  }

  clearAllReservations() {
    this._reservedTail = this.count;
  }
```

考虑到多 chunk 并发 reservation 的复杂性，采用更简单的方案：

**简化设计**：reservation 以 `buffer.count` 为基准向后分配。`_reservedTail` = `count` + 所有 reservations 的总块数。

```javascript
  // TypeBuffer 新增
  constructor(...) {
    // ...existing...
    this._reservations = []; // [{ chunkKey, start, count }]
    this._reservedTail = 0; // 0 表示无 reservation，等效于 count
  }

  getEffectiveTail() {
    return this._reservations.length > 0 ? this._reservedTail : this.count;
  }

  reserve(chunkKey, blockCount) {
    const start = this.getEffectiveTail();
    this.ensureCapacity(start + blockCount);
    const reservation = { chunkKey, start, count: blockCount };
    this._reservations.push(reservation);
    this._reservedTail = start + blockCount;
    return reservation;
  }

  releaseReservation(chunkKey) {
    const idx = this._reservations.findIndex(r => r.chunkKey === chunkKey);
    if (idx === -1) return;
    this._reservations.splice(idx, 1);
    // 重新计算 reservedTail
    if (this._reservations.length === 0) {
      this._reservedTail = 0;
    } else {
      const last = this._reservations[this._reservations.length - 1];
      this._reservedTail = last.start + last.count;
    }
  }
```

修改 `ensureCapacity`，确保 addVisibleBlock 不侵入 reserved region：

在现有 `addVisibleBlock` 的 `buffer.ensureCapacity(buffer.count + 1)` 改为：
```javascript
    const neededCapacity = Math.max(buffer.count + 1, buffer.getEffectiveTail());
    buffer.ensureCapacity(neededCapacity);
```

- [ ] **Step 4: 实现 staging zone + prepare + publish**

在 `GlobalInstancedMeshManager` 中：

constructor 追加：
```javascript
    this.stagingZone = new Map(); // chunkKey → { meshDataArray, blockCount, prepareState }
```

实现核心方法（完整代码见下方）：

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
        this._initPrepareState(chunkKey, staged);
      }
      const ps = staged.prepareState;
      if (ps.complete) continue;

      while (ps.dataCursor < staged.meshDataArray.length && processed < maxBlocks && now() - start < maxMs) {
        const data = staged.meshDataArray[ps.dataCursor];
        const { type, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;
        const entries = Object.entries(instanceIndexMap || {});
        const buffer = this.getOrCreateBuffer(type);
        const reservation = ps.reservations.get(this.getRenderKey(type));
        if (!reservation) { ps.dataCursor++; ps.entryCursor = 0; continue; }

        while (ps.entryCursor < entries.length && processed < maxBlocks && now() - start < maxMs) {
          const [coordText, sourceIndex] = entries[ps.entryCursor];
          const coord = Number(coordText);
          const writeIndex = reservation.start + ps.writeOffsets.get(this.getRenderKey(type));

          // 写入 reserved region
          const matrix = matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE);
          buffer.mesh.instanceMatrix.array.set(matrix, writeIndex * MATRIX_STRIDE);
          const attrAoLow = buffer.mesh.geometry.getAttribute('aAoLow');
          const attrAoHigh = buffer.mesh.geometry.getAttribute('aAoHigh');
          const attrOrientation = buffer.mesh.geometry.getAttribute('aOrientation');
          if (attrAoLow) attrAoLow.array[writeIndex] = aoLow?.[sourceIndex] ?? 1;
          if (attrAoHigh) attrAoHigh.array[writeIndex] = aoHigh?.[sourceIndex] ?? 1;
          if (attrOrientation) attrOrientation.array[writeIndex] = orientation?.[sourceIndex] ?? 0;

          // 注册索引映射（prepare 阶段就注册，publish 时无需遍历）
          buffer.coordToIndex.set(coord, writeIndex);
          buffer.indexToCoord[writeIndex] = coord;
          const ref = { renderKey: buffer.renderKey, index: writeIndex, chunkKey };
          this.coordToRef.set(coord, ref);
          if (!this.chunkToCoords.has(chunkKey)) this.chunkToCoords.set(chunkKey, new Set());
          this.chunkToCoords.get(chunkKey).add(coord);

          ps.writeOffsets.set(this.getRenderKey(type), ps.writeOffsets.get(this.getRenderKey(type)) + 1);
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

  _initPrepareState(chunkKey, staged) {
    // 按 type 统计块数并 reserve
    const typeBlockCounts = new Map();
    for (const data of staged.meshDataArray) {
      const rk = this.getRenderKey(data.type);
      const entries = Object.entries(data.instanceIndexMap || {});
      typeBlockCounts.set(rk, (typeBlockCounts.get(rk) || 0) + entries.length);
    }
    const reservations = new Map();
    const writeOffsets = new Map();
    for (const [renderKey, count] of typeBlockCounts) {
      const buffer = this.getOrCreateBuffer(renderKey);
      const reservation = buffer.reserve(chunkKey, count);
      reservations.set(renderKey, reservation);
      writeOffsets.set(renderKey, 0);
    }
    staged.prepareState = {
      dataCursor: 0,
      entryCursor: 0,
      reservations,
      writeOffsets,
      complete: false
    };
  }

  publishNextReadyChunk(playerCx, playerCz) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const [chunkKey, staged] of this.stagingZone) {
      if (!staged.prepareState?.complete) continue;
      const dist = this._getChunkDistance(chunkKey, playerCx, playerCz);
      if (dist < bestDist) { bestDist = dist; bestKey = chunkKey; }
    }
    if (!bestKey) return false;
    return this.publishPreparedChunk(bestKey);
  }

  publishPreparedChunk(chunkKey) {
    const staged = this.stagingZone.get(chunkKey);
    if (!staged || !staged.prepareState?.complete) return false;

    const ps = staged.prepareState;

    // 对每个 type：将 reserved 数据搬移到 count 位置（如果 count 变了）
    for (const [renderKey, reservation] of ps.reservations) {
      const buffer = this.buffers.get(renderKey);
      if (!buffer) continue;

      if (reservation.start !== buffer.count) {
        // count 已变化（有 add/remove），需要搬移 reserved 数据到新 count 位置
        const src = reservation.start;
        const dst = buffer.count;
        const blockCount = reservation.count;
        // 搬移 matrix
        const matSrc = buffer.mesh.instanceMatrix.array.subarray(src * MATRIX_STRIDE, (src + blockCount) * MATRIX_STRIDE);
        buffer.mesh.instanceMatrix.array.set(matSrc, dst * MATRIX_STRIDE);
        // 搬移 AO/orientation
        const aoLow = buffer.mesh.geometry.getAttribute('aAoLow');
        const aoHigh = buffer.mesh.geometry.getAttribute('aAoHigh');
        const orientation = buffer.mesh.geometry.getAttribute('aOrientation');
        if (aoLow) aoLow.array.copyWithin(dst, src, src + blockCount);
        if (aoHigh) aoHigh.array.copyWithin(dst, src, src + blockCount);
        if (orientation) orientation.array.copyWithin(dst, src, src + blockCount);
        // 更新索引映射
        for (let i = 0; i < blockCount; i++) {
          const coord = buffer.indexToCoord[src + i];
          if (coord) {
            buffer.indexToCoord[dst + i] = coord;
            buffer.coordToIndex.set(coord, dst + i);
            const ref = this.coordToRef.get(coord);
            if (ref) ref.index = dst + i;
          }
        }
      }

      // bump count
      buffer.count += reservation.count;
      buffer.mesh.count = buffer.count;
      buffer.mesh.instanceMatrix.needsUpdate = true;
      const aoLow = buffer.mesh.geometry.getAttribute('aAoLow');
      const aoHigh = buffer.mesh.geometry.getAttribute('aAoHigh');
      const ori = buffer.mesh.geometry.getAttribute('aOrientation');
      if (aoLow) aoLow.needsUpdate = true;
      if (aoHigh) aoHigh.needsUpdate = true;
      if (ori) ori.needsUpdate = true;
      buffer.mesh.boundingSphere = null;
      buffer.mesh.boundingBox = null;

      // 释放 reservation
      buffer.releaseReservation(chunkKey);
    }

    this.stagingZone.delete(chunkKey);
    return true;
  }

  removeStagedChunk(chunkKey) {
    const staged = this.stagingZone.get(chunkKey);
    if (!staged) return;

    // 如果已经 prepare（有 reservation），释放 reservation 并清理索引
    if (staged.prepareState) {
      const ps = staged.prepareState;
      // 清理已注册的 coordToRef / chunkToCoords
      const coords = this.chunkToCoords.get(chunkKey);
      if (coords) {
        for (const coord of coords) {
          this.coordToRef.delete(coord);
          // 清理 buffer 中的 coordToIndex
          const ref = this.coordToRef.get(coord); // already deleted, skip
        }
        this.chunkToCoords.delete(chunkKey);
      }
      // 释放 TypeBuffer reservation
      for (const [renderKey] of ps.reservations) {
        const buffer = this.buffers.get(renderKey);
        if (buffer) buffer.releaseReservation(chunkKey);
      }
    }

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

- [ ] **Step 5: 修改 removeChunk 先清理 staging**

在现有 `removeChunk` 方法开头添加：

```javascript
  removeChunk(chunkKey) {
    this.removeStagedChunk(chunkKey); // 清理 staged + reservation
    this._purgeQueuedChunk(chunkKey);
    // ... existing logic ...
  }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 7: 运行 lint**

Run: `npm run lint`

- [ ] **Step 8: 如用户要求，提交**

```bash
git add src/core/GlobalInstancedMeshManager.js src/tests/test-global-instanced-mesh-manager.js
git commit -m "feat(core): 两阶段原子提交 — reservation + prepare + publish"
```

---

### Task 3: [P0] ChunkGenerator buildMeshes → staging + World 卸载清理

**Files:**
- Modify: `src/world/ChunkGenerator.js:132-145`
- Modify: `src/world/World.js` (卸载循环)

- [ ] **Step 1: 修改 buildMeshes 初次加载路径**

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

- [ ] **Step 2: World 卸载循环中清理 staging**

在 `World.update()` 的卸载循环中，chunk dispose 前（约 `this.scene.remove(chunk.group)` 之前）添加：

```javascript
        // 清理 staging/reservation（chunk 离开视距，不再需要）
        this.globalInstancedMeshManager?.removeStagedChunk(key);
```

- [ ] **Step 3: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 4: 如用户要求，提交**

```bash
git add src/world/ChunkGenerator.js src/world/World.js
git commit -m "feat(world): buildMeshes→staging + 卸载时清理 staged/reservation"
```

---

### Task 4: [P0] Worker 回包 Transferable

**Files:**
- Modify: `src/workers/WorldWorker.js:2901`

- [ ] **Step 1: 添加 transfer list 到 consolidation 回包**

在 `src/workers/WorldWorker.js` 的 consolidation postMessage 处（约 L2901），在 `postMessage` 调用前收集 transfer list：

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

  postMessage({
    cx, cz, callbackKey, taskId,
    blockDataBlocks,
    scatteredBlocks,
    routing,
    meshData,
    solidBlocks,
    modGunMan, rovers,
    entities: { modGunMan, rovers },
    visibleKeys: Array.from(visibleKeysSet),
    structureCenters,
    snapshot: {
      meta: { ownershipVersion: OWNERSHIP_SCHEMA_VERSION },
      blocks: blocksForSnapshot,
      entities: { modGunMan, rovers, zombieNests: savedSnapshot?.entities?.zombieNests || [] }
    },
    _workerTiming: { workerComputeMs, transitToWorkerMs, workerFinishedAt },
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

注意：保留所有现有字段不变（snapshot.blocks、routing、顶层 modGunMan/rovers），只添加 transfer list。

- [ ] **Step 2: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 3: 如用户要求，提交**

```bash
git add src/workers/WorldWorker.js
git commit -m "perf(worker): consolidation 回包 meshData 使用 Transferable zero-copy"
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
  test('beginFrame 后 getRemainingMs 返回接近目标帧时', () => {
    const scheduler = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    scheduler.beginFrame();
    const remaining = scheduler.getRemainingMs();
    assertTrue(remaining >= 7 && remaining <= 8.5, `剩余应接近 8ms, got ${remaining}`);
  });

  test('hasTimeFor 判断正确', () => {
    const scheduler = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    scheduler.beginFrame();
    assertTrue(scheduler.hasTimeFor(5), '刚开始应有 5ms');
    assertEqual(scheduler.hasTimeFor(10), false, '不应有 10ms');
  });

  test('60fps 模式预算更宽裕', () => {
    const scheduler = new FrameBudgetScheduler({ targetFps: 60, safetyMarginMs: 2 });
    scheduler.beginFrame();
    assertTrue(scheduler.getRemainingMs() >= 14, '60fps 下应有 ~14ms');
  });
});
```

- [ ] **Step 2: 实现 FrameBudgetScheduler**

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

- [ ] **Step 3: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 4: 如用户要求，提交**

```bash
git add src/core/FrameBudgetScheduler.js src/tests/test-frame-budget-scheduler.js
git commit -m "feat(core): 新增 FrameBudgetScheduler 实时帧预算调度器"
```

---

### Task 6: [P1] World.js — 集成 FrameBudgetScheduler + prepare/publish 调度

**Files:**
- Modify: `src/world/World.js`

- [ ] **Step 1: 引入依赖并初始化**

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
    const remainingMs = this.frameBudgetScheduler.getRemainingMs();
    if (remainingMs < 0.5) return;
    this.globalInstancedMeshManager.prepareStagedBlocks({
      maxBlocks: 600,
      maxMs: Math.min(remainingMs * 0.5, 2)
    });
  }

  _publishNextReadyChunk() {
    if (!this.globalInstancedMeshManager) return;
    if (!this.frameBudgetScheduler.hasTimeFor(0.5)) return;
    const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
    const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
    const published = this.globalInstancedMeshManager.publishNextReadyChunk(playerCx, playerCz);
    if (published) {
      this._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();
      this.runtimeIdleScheduler?.markBusy('chunk-published');
      this.requestShadowMapUpdate('chunk-published');
    }
  }
```

- [ ] **Step 3: 重构 update() runtime-streaming 调度**

替换 update() 中 L1217-1239 的调度逻辑为：

```javascript
    if (this.bootstrapState.phase === 'runtime-streaming') {
      this.frameBudgetScheduler.beginFrame();

      this._processChunkInitBudgeted();

      if (this.frameBudgetScheduler.hasTimeFor(1.0)) {
        const assemblyBudget = Math.min(this.frameBudgetScheduler.getRemainingMs() * 0.4, 3);
        this.chunkAssemblyScheduler.processWithinBudget({
          budgetMs: assemblyBudget,
          maxTasks: 20
        });
      }

      if (this.frameBudgetScheduler.hasTimeFor(0.5)) {
        this._processStagingPrepare();
      }

      this._publishNextReadyChunk(); // 每帧最多 1 个 chunk

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

- [ ] **Step 4: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

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

- [ ] **Step 2: patchChunkVisibleBlocks 添加预扩容（只算 missing entries）**

在方法开头（`_purgeQueuedChunk` 之后）添加精确预扩容：

```javascript
    // 预扩容：只计算真正需要新增的方块数（排除已存在的 update）
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
        buffer.ensureCapacity(buffer.getEffectiveTail() + missingCount);
      }
    }
```

- [ ] **Step 3: 运行测试确认通过**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 4: 如用户要求，提交**

```bash
git add src/world/World.js src/core/GlobalInstancedMeshManager.js
git commit -m "perf(core): 调大容量 hints + consolidation 精确预扩容"
```

---

### Task 8: [P2] 自动化奔跑压测

**Files:**
- Create: `src/tests/test-streaming-perf.js`

- [ ] **Step 1: 编写自动化压测测试**

```javascript
// src/tests/test-streaming-perf.js
import { describe } from './runner.js';
import { assertTrue } from './assert.js';

describe('Streaming Performance', (test) => {
  test('持续移动 10 秒内帧率 p95 ≥ 目标的 80%', async () => {
    // 获取 game 实例
    const game = window.game;
    if (!game || !game.world || !game.player) {
      console.warn('[perf] game 未就绪，跳过压测');
      return;
    }

    // 等待 bootstrap 完成
    let waited = 0;
    while (game.world.bootstrapState?.phase !== 'runtime-streaming' && waited < 10000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (game.world.bootstrapState?.phase !== 'runtime-streaming') {
      console.warn('[perf] 未进入 runtime-streaming，跳过');
      return;
    }

    // 模拟持续前进 10 秒，采集帧时长
    const frameTimes = [];
    const duration = 10000;
    const start = performance.now();

    const originalUpdate = game.update.bind(game);
    let lastFrame = start;

    const collectFrame = () => {
      const now = performance.now();
      frameTimes.push(now - lastFrame);
      lastFrame = now;

      // 模拟前进
      if (game.player?.position) {
        game.player.position.z += 0.3;
      }

      if (now - start < duration) {
        requestAnimationFrame(collectFrame);
      }
    };
    requestAnimationFrame(collectFrame);

    // 等待采集完成
    await new Promise(r => setTimeout(r, duration + 500));

    // 分析
    frameTimes.sort((a, b) => a - b);
    const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)];
    const p99 = frameTimes[Math.floor(frameTimes.length * 0.99)];
    const longTasks = frameTimes.filter(t => t > 16.7).length;

    console.log(`[perf] frames=${frameTimes.length} p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms longTasks=${longTasks}`);

    // 断言：p95 应 < 14ms（允许一定余量）
    assertTrue(p95 < 20, `p95 帧时 ${p95.toFixed(1)}ms 超出预期 20ms`);
  });
});
```

- [ ] **Step 2: 运行确认测试框架可执行**

Run: `node command/run-tests.js --verbose`
Expected: 测试执行（可能 skip 如果 game 未完整初始化，但不应 crash）

- [ ] **Step 3: 如用户要求，提交**

```bash
git add src/tests/test-streaming-perf.js
git commit -m "test(perf): 新增自动化奔跑压测 — 帧率 p95/p99 + long task 统计"
```

---

### Task 9: [P2] 手动集成验证

- [ ] **Step 1: 启动开发服务器并验证基本功能**

Run: `npm run start`
打开浏览器验证初始加载正常。

- [ ] **Step 2: 奔跑压测**

WASD 持续奔跑 30 秒，验证：
1. 新 chunk 从雾中自然出现
2. 无方块闪烁/消失
3. FPS 稳定

- [ ] **Step 3: 交互测试**

放置/挖掘方块、触发 consolidation，确认无闪烁。

- [ ] **Step 4: DevTools Performance 录制**

录制 10 秒奔跑，确认：
1. 无 > 16ms long task
2. Worker Message 事件无大体积 clone
3. 帧时间分布均匀

- [ ] **Step 5: lint + 全量测试**

```bash
npm run lint
node command/run-tests.js --verbose
```

---

## 注意事项

1. **Bootstrap 不受影响**：所有改动仅在 `runtime-streaming` 阶段生效。

2. **Reservation 不变式**：活跃区 `[0, count)` 和 reserved 区 `[count, reservedTail)` 严格隔离。`addVisibleBlock` 的 count++ 不会超过最低 reservation start（通过 ensureCapacity 保证空间足够）。

3. **publish 搬移成本**：如果 prepare 期间有 add/remove 导致 count 变化，publish 需要搬移 reserved 数据。搬移成本 = `copyWithin` 一段连续内存，对 3000 块约 0.2ms，可接受。

4. **每帧最多 publish 1 个 chunk**：避免多 chunk 同帧 publish 造成突发。按距离排序确保最近的优先可见。

5. **Worker 保留所有现有字段**：只添加 transfer list，不裁剪 snapshot.blocks/routing/modGunMan/rovers，确保 BlockScatterManager、PersistenceService、ChunkGenerator 等消费方不受影响。

6. **Git 提交**：所有 commit step 标注"如用户要求"，遵循仓库规则不自动提交。
