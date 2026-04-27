# 跨 Region Overflow Block 路由机制实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现跨 region 的 overflow block 收集、分发与持久化机制，修复 region 级预生成时跨边界结构方块被静默丢弃的 P0 缺陷。

**Architecture:** Worker 返回未解析的跨 region overflow 数据，主线程暂存到内存 Map，批次生成完成后分发给同批次目标 region，剩余部分持久化到 IndexedDB `world_overflow` store；扩图时自动消费已持久化的 overflow。

**Tech Stack:** ES Modules, IndexedDB, Web Worker, 自定义浏览器测试 runner (`src/tests/runner.js`)

---

## 文件结构映射

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/constants/PersistenceConfig.js` | IndexedDB 版本号 | 修改 |
| `src/workers/PersistenceWorker.js` | IndexedDB 操作：新增 `world_overflow` store 及读写 | 修改 |
| `src/world/WorldStore.js` | 包装 PersistenceWorker 的 overflow API | 修改 |
| `src/workers/WorldWorker.js` | Region 生成：返回 unresolved overflow block 数据 | 修改 |
| `src/world/WorldGenerationService.js` | 收集、分发、消费 overflow 的核心逻辑 | 修改 |
| `src/tests/test-world-generation-cross-region.js` | 跨 region 生成功能的现有测试 | 修改 |

---

### Task 1: PersistenceWorker.js — 新增 `world_overflow` IndexedDB store

**Files:**
- Modify: `src/constants/PersistenceConfig.js`
- Modify: `src/workers/PersistenceWorker.js`

- [ ] **Step 1: 升级 IndexedDB 版本号**

修改 `src/constants/PersistenceConfig.js` 第 7 行：

```javascript
DB_VERSION: 3, // v3: 新增 world_overflow store（跨 region overflow 持久化）
```

- [ ] **Step 2: 在 PersistenceWorker.js 顶部新增 store 常量**

在 `src/workers/PersistenceWorker.js` 第 9 行后添加：

```javascript
const WORLD_OVERFLOW_STORE = 'world_overflow';
```

- [ ] **Step 3: 在 init() 升级回调中创建 world_overflow store**

在 `init()` 函数内（约第 27-35 行），在 `WORLD_REGION_STORE` 创建后添加：

```javascript
if (!dbInstance.objectStoreNames.contains(WORLD_OVERFLOW_STORE)) {
  dbInstance.createObjectStore(WORLD_OVERFLOW_STORE, { keyPath: 'regionKey' });
}
```

同时，在第 17 行的旧连接检测逻辑中，补充对 `WORLD_OVERFLOW_STORE` 的检测：

```javascript
if (db && !db.objectStoreNames.contains(WORLD_META_STORE)) {
  db.close();
  db = null;
}
if (db && !db.objectStoreNames.contains(WORLD_OVERFLOW_STORE)) {
  db.close();
  db = null;
}
```

- [ ] **Step 4: 新增 save/get/remove overflow 函数**

在 `clearWorld()` 函数之前（约第 163 行前）添加三个函数：

```javascript
/**
 * 保存跨 region overflow blocks
 * @param {string} regionKey - "rx,rz"
 * @param {object} overflowData - { "cx,cz": [{x,y,z,type,orientation}, ...] }
 */
function saveOverflowBlocks(regionKey, overflowData) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readwrite', (store) =>
    store.put({ regionKey, data: overflowData, lastModified: Date.now() })
  );
}

/**
 * 读取跨 region overflow blocks
 * @param {string} regionKey - "rx,rz"
 * @returns {Promise<object|null>} { "cx,cz": [...] }
 */
function getOverflowBlocks(regionKey) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readonly', (store) =>
    store.get(regionKey)
  ).then((result) => result ? result.data : null);
}

/**
 * 删除跨 region overflow blocks
 * @param {string} regionKey - "rx,rz"
 */
function removeOverflowBlocks(regionKey) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readwrite', (store) =>
    store.delete(regionKey)
  );
}
```

- [ ] **Step 5: 修改 onmessage switch 处理新 action**

在 `switch (action)` 的 `case 'clearWorld'` 之前添加三个 case：

```javascript
case 'saveOverflowBlocks':
  await saveOverflowBlocks(payload.regionKey, payload.overflowData);
  result = true;
  break;
case 'getOverflowBlocks':
  result = await getOverflowBlocks(payload.regionKey);
  break;
case 'removeOverflowBlocks':
  await removeOverflowBlocks(payload.regionKey);
  result = true;
  break;
```

- [ ] **Step 6: 修改 clearWorld 清除 world_overflow store**

将 `clearWorld()` 函数改为：

```javascript
function clearWorld() {
  if (!db) {
    return Promise.reject(new Error('DB not initialized'));
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction([WORLD_META_STORE, WORLD_REGION_STORE, WORLD_OVERFLOW_STORE, PERSISTENCE_CONFIG.STORE_NAME], 'readwrite');
    tx.objectStore(WORLD_META_STORE).clear();
    tx.objectStore(WORLD_REGION_STORE).clear();
    tx.objectStore(WORLD_OVERFLOW_STORE).clear();
    tx.objectStore(PERSISTENCE_CONFIG.STORE_NAME).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 7: Commit**

```bash
git add src/constants/PersistenceConfig.js src/workers/PersistenceWorker.js
git commit -m "feat(persistence): add world_overflow store for cross-region overflow blocks"
```

---

### Task 2: WorldStore.js — 新增 overflow API 包装方法

**Files:**
- Modify: `src/world/WorldStore.js`

- [ ] **Step 1: 在 WorldStore 类中新增 saveOverflowBlocks**

在 `clearWorld()` 方法之前（约第 228 行前）添加：

```javascript
  // ============================================================
  // Cross-Region Overflow Blocks 读写
  // ============================================================

  /**
   * 保存跨 region overflow blocks
   * @param {number} rx
   * @param {number} rz
   * @param {object} overflowData - { "cx,cz": [{x,y,z,type,orientation}, ...] }
   */
  async saveOverflowBlocks(rx, rz, overflowData) {
    const regionKey = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('saveOverflowBlocks', { regionKey, overflowData });
  }

  /**
   * 读取跨 region overflow blocks
   * @param {number} rx
   * @param {number} rz
   * @returns {Promise<object|null>} { "cx,cz": [...] }
   */
  async getOverflowBlocks(rx, rz) {
    const regionKey = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('getOverflowBlocks', { regionKey });
  }

  /**
   * 删除跨 region overflow blocks
   * @param {number} rx
   * @param {number} rz
   */
  async removeOverflowBlocks(rx, rz) {
    const regionKey = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('removeOverflowBlocks', { regionKey });
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/world/WorldStore.js
git commit -m "feat(world-store): add cross-region overflow block read/write API"
```

---

### Task 3: WorldWorker.js — 返回 unresolved overflow blocks 数据

**Files:**
- Modify: `src/workers/WorldWorker.js`

- [ ] **Step 1: 修改 resolveOverflowWithinRegion 收集 unresolved blocks**

在 `src/workers/WorldWorker.js` 的 `resolveOverflowWithinRegion` 函数中（约第 1307 行），找到 `if (!isInRegion)` 分支（约第 1339 行）。

在该函数顶部（第 1308-1311 行后）新增变量：

```javascript
  const unresolvedOverflowBlocks = [];
```

在 `if (!isInRegion)` 分支的 `continue` 之前（约第 1348 行），添加收集逻辑：

```javascript
      if (!isInRegion) {
        const blockCount = overflowEntry.blockDataBlocks?.length || 0;
        unresolved += blockCount;
        const [sourceCx, sourceCz] = sourceKey.split(',').map(Number);
        const offsetKey = `${targetCx - sourceCx},${targetCz - sourceCz}`;
        unresolvedByDistance.set(offsetKey, (unresolvedByDistance.get(offsetKey) || 0) + blockCount);
        for (const block of (overflowEntry.blockDataBlocks || [])) {
          unresolvedCoords.add(encodeCoord(block.x, block.y, block.z));
        }
        // 收集跨 region overflow 数据用于主线程分发
        unresolvedOverflowBlocks.push({
          chunkKey: overflowEntry.chunkKey,
          blockDataBlocks: overflowEntry.blockDataBlocks || []
        });
        continue;
      }
```

修改 return 语句（约第 1374 行），新增 `unresolvedOverflowBlocks`：

```javascript
  return {
    resolved,
    unresolved,
    uniqueUnresolvedCoords: unresolvedCoords.size,
    topDistanceBuckets: Array.from(unresolvedByDistance.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([offset, blocks]) => ({ offset, blocks })),
    unresolvedOverflowBlocks
  };
```

- [ ] **Step 2: 修改 handleRegionGeneration 返回 unresolvedOverflowBlocks**

在 `handleRegionGeneration` 函数中（约第 1390 行），确认 `postMessage` 的数据对象（约第 1431 行）已经通过 `routingDiagnostics` 包含了 `unresolvedOverflowBlocks`。由于 `routingDiagnostics` 已经包含该字段，无需额外修改 `postMessage` 结构。

验证 `postMessage` 调用处：

```javascript
  postMessage({
    type: 'regionGenerated',
    rx, rz,
    chunks: regionChunks,
    routingDiagnostics,
    taskId
  });
```

此步骤只需确认 `routingDiagnostics.unresolvedOverflowBlocks` 已存在。

- [ ] **Step 3: Commit**

```bash
git add src/workers/WorldWorker.js
git commit -m "feat(world-worker): return unresolved cross-region overflow blocks from region generation"
```

---

### Task 4: WorldGenerationService.js — 收集、分发、消费 overflow

**Files:**
- Modify: `src/world/WorldGenerationService.js`

- [ ] **Step 1: 在构造函数中初始化 crossRegionOverflowMap**

在 `constructor` 中（约第 34 行），`this._isGenerating = false` 之后添加：

```javascript
    this._crossRegionOverflowMap = new Map(); // 暂存跨 region overflow
```

- [ ] **Step 2: 新增 _collectCrossRegionOverflow 方法**

在 `_generateRegion` 方法之前（约第 216 行前）添加：

```javascript
  /**
   * 收集 Worker 返回的跨 region overflow blocks
   * @param {object} data - Worker 返回的 regionGenerated 数据
   */
  _collectCrossRegionOverflow(data) {
    const overflowBlocks = data.routingDiagnostics?.unresolvedOverflowBlocks || [];
    for (const entry of overflowBlocks) {
      const [targetCx, targetCz] = entry.chunkKey.split(',').map(Number);
      const { rx: targetRx, rz: targetRz } = this._chunkToRegion(targetCx, targetCz);
      const targetRegionKey = this._regionKey(targetRx, targetRz);

      if (!this._crossRegionOverflowMap.has(targetRegionKey)) {
        this._crossRegionOverflowMap.set(targetRegionKey, []);
      }
      this._crossRegionOverflowMap.get(targetRegionKey).push(entry);
    }
  }
```

- [ ] **Step 3: 新增 _distributeCrossRegionOverflow 方法**

在 `_collectCrossRegionOverflow` 之后添加：

```javascript
  /**
   * 分发跨 region overflow blocks 到目标 region。
   * 目标 region 已在当前批次中的直接合并到 RegionRecord；
   * 不在当前批次中的持久化到 world_overflow store。
   *
   * @param {Set<string>} targetRegionKeys - 当前批次已生成的 region keys
   */
  async _distributeCrossRegionOverflow(targetRegionKeys) {
    const targetKeySet = new Set(targetRegionKeys);
    const remainingEntries = [];

    for (const [regionKey, entries] of this._crossRegionOverflowMap) {
      if (targetKeySet.has(regionKey)) {
        // 目标 region 已生成，直接合并
        const [rx, rz] = regionKey.split(',').map(Number);
        const record = await getWorldStore().getRegionRecord(rx, rz);
        if (!record) {
          remainingEntries.push({ regionKey, entries });
          continue;
        }

        for (const entry of entries) {
          const chunkData = record.chunks[entry.chunkKey];
          if (!chunkData) continue;
          for (const block of entry.blockDataBlocks) {
            const code = encodeCoord(block.x, block.y, block.z);
            if (chunkData.blockData[code] === undefined) {
              chunkData.blockData[code] = block.orientation
                ? { type: block.type, orientation: block.orientation }
                : block.type;
            }
          }
        }

        await getWorldStore().saveRegionRecord(rx, rz, record);
      } else {
        // 目标 region 尚未生成，持久化等待
        remainingEntries.push({ regionKey, entries });
      }
    }

    // 清空已处理的条目
    for (const { regionKey } of remainingEntries) {
      if (this._crossRegionOverflowMap.has(regionKey)) {
        // 仍在 map 中说明上面没被处理，保留
        continue;
      }
    }

    // 移除已成功的条目
    for (const regionKey of targetKeySet) {
      if (this._crossRegionOverflowMap.has(regionKey)) {
        this._crossRegionOverflowMap.delete(regionKey);
      }
    }

    // 将剩余条目持久化到 world_overflow
    for (const { regionKey, entries } of remainingEntries) {
      if (!this._crossRegionOverflowMap.has(regionKey)) continue;

      const [rx, rz] = regionKey.split(',').map(Number);
      const overflowData = {};
      for (const entry of entries) {
        if (!overflowData[entry.chunkKey]) {
          overflowData[entry.chunkKey] = [];
        }
        for (const block of entry.blockDataBlocks) {
          const code = encodeCoord(block.x, block.y, block.z);
          // 去重：同一坐标只保留一次
          const alreadyExists = overflowData[entry.chunkKey].some(
            (b) => encodeCoord(b.x, b.y, b.z) === code
          );
          if (!alreadyExists) {
            overflowData[entry.chunkKey].push(block);
          }
        }
      }

      try {
        await getWorldStore().saveOverflowBlocks(rx, rz, overflowData);
        this._crossRegionOverflowMap.delete(regionKey);
      } catch (err) {
        console.error('[WorldGenerationService] Failed to persist overflow blocks for region', regionKey, err);
      }
    }
  }
```

- [ ] **Step 4: 新增 _consumeOverflowForRegion 方法**

在 `_distributeCrossRegionOverflow` 之后添加：

```javascript
  /**
   * 消费持久化到 world_overflow store 中属于指定 region 的方块。
   * 在扩图生成新 region 后调用。
   *
   * @param {number} rx
   * @param {number} rz
   */
  async _consumeOverflowForRegion(rx, rz) {
    const overflowData = await getWorldStore().getOverflowBlocks(rx, rz);
    if (!overflowData) return;

    const record = await getWorldStore().getRegionRecord(rx, rz);
    if (!record) return;

    let mergedCount = 0;
    for (const [chunkKey, blocks] of Object.entries(overflowData)) {
      const chunkData = record.chunks[chunkKey];
      if (!chunkData) continue;
      for (const block of blocks) {
        const code = encodeCoord(block.x, block.y, block.z);
        if (chunkData.blockData[code] === undefined) {
          chunkData.blockData[code] = block.orientation
            ? { type: block.type, orientation: block.orientation }
            : block.type;
          mergedCount++;
        }
      }
    }

    if (mergedCount > 0) {
      await getWorldStore().saveRegionRecord(rx, rz, record);
      console.log(`[WorldGenerationService] Merged ${mergedCount} overflow blocks into region ${rx},${rz}`);
    }
    await getWorldStore().removeOverflowBlocks(rx, rz);
  }
```

- [ ] **Step 5: 修改 _generateRegion 回调收集 overflow**

在 `_generateRegion` 的 `workerCallbacks.set` 回调中（约第 222 行），在 `resolve(regionRecord)` 之前添加：

```javascript
        // 收集跨 region overflow blocks
        this._collectCrossRegionOverflow(data);
```

位置应在 `await getWorldStore().saveRegionRecord` 成功之后，`resolve(regionRecord)` 之前。

修改后的回调核心逻辑：

```javascript
      workerCallbacks.set(taskId, async (data) => {
        // ... 构建 regionRecord ...

        try {
          await getWorldStore().saveRegionRecord(rx, rz, regionRecord);
        } catch (err) {
          console.error('[WorldGenerationService] Failed to save region record:', err);
          reject(err);
          return;
        }

        // 收集跨 region overflow blocks
        this._collectCrossRegionOverflow(data);

        if (data.routingDiagnostics?.unresolved > 0) {
          console.warn('[WorldGenerationService] Region generation had unresolved overflow blocks', {
            regionKey,
            ...data.routingDiagnostics
          });
        }

        resolve(regionRecord);
      });
```

- [ ] **Step 6: 修改 generateInitialWorld 在全部 region 生成后分发 overflow**

在 `generateInitialWorld` 的双层 for 循环之后（约第 190 行后），更新状态为 `'done'` 之前，添加：

```javascript
      // 分发跨 region overflow blocks
      const generatedRegionKeys = [];
      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let rz = minRz; rz <= maxRz; rz++) {
          generatedRegionKeys.push(this._regionKey(rx, rz));
        }
      }
      await this._distributeCrossRegionOverflow(generatedRegionKeys);

      // 4. 更新状态
      meta.generationState = 'done';
```

- [ ] **Step 7: 修改 expandWorldIfNeeded 消费已持久化的 overflow**

在 `expandWorldIfNeeded` 的 region 生成循环之后（约第 602 行后），更新边界之前，添加：

```javascript
      // 消费已持久化的 overflow blocks
      for (const { rx, rz } of regionsToGenerate) {
        try {
          await this._consumeOverflowForRegion(rx, rz);
        } catch (err) {
          console.error(`[WorldGenerationService] Failed to consume overflow for region ${rx},${rz}:`, err);
        }
      }

      // 分发新生成 region 之间的 overflow
      const newRegionKeys = regionsToGenerate.map(({ rx, rz }) => this._regionKey(rx, rz));
      await this._distributeCrossRegionOverflow(newRegionKeys);
```

- [ ] **Step 8: Commit**

```bash
git add src/world/WorldGenerationService.js
git commit -m "feat(world-generation): collect, distribute, and persist cross-region overflow blocks"
```

---

### Task 5: 更新现有测试与新增集成测试

**Files:**
- Modify: `src/tests/test-world-generation-cross-region.js`

- [ ] **Step 1: 更新 mock worker 返回 routingDiagnostics 和 unresolvedOverflowBlocks**

修改 `createTestWorldWorker()` 函数（约第 10 行）。当前 mock 返回 `{ chunks }`，需要补充 `routingDiagnostics`：

```javascript
function createTestWorldWorker() {
  return {
    postMessage(message) {
      const callback = workerCallbacks.get(message.taskId);
      if (!callback) {
        throw new Error(`Missing worker callback for task ${message.taskId}`);
      }

      const { rx, rz } = message;
      const chunks = {};
      const unresolvedOverflowBlocks = [];

      for (let localCx = 0; localCx < 8; localCx++) {
        for (let localCz = 0; localCz < 8; localCz++) {
          const cx = rx * 8 + localCx;
          const cz = rz * 8 + localCz;
          const chunkKey = `${cx},${cz}`;

          // 目标 region (1,0) 中，chunk 8,0 应持有跨界方块
          const isTargetChunk = cx === 8 && cz === 0 && rx === 1 && rz === 0;

          chunks[chunkKey] = {
            routing: {
              ownChunk: { chunkKey, blockDataBlocks: [], visibleBlocks: [], meshData: [] },
              overflowChunks: []
            },
            blockDataBlocks: isTargetChunk
              ? [{ x: 128, y: 5, z: 0, type: 'stone', orientation: 0 }]
              : [],
            entities: { modGunMan: [], rovers: [] },
            structureCenters: []
          };
        }
      }

      // 模拟从 region (0,0) 溢出到 region (1,0) 的方块
      if (rx === 0 && rz === 0) {
        unresolvedOverflowBlocks.push({
          chunkKey: '8,0',
          blockDataBlocks: [{ x: 128, y: 5, z: 0, type: 'stone', orientation: 0 }]
        });
      }

      setTimeout(() => {
        callback({
          chunks,
          routingDiagnostics: {
            resolved: 0,
            unresolved: unresolvedOverflowBlocks.length > 0 ? 1 : 0,
            uniqueUnresolvedCoords: unresolvedOverflowBlocks.length > 0 ? 1 : 0,
            topDistanceBuckets: [],
            unresolvedOverflowBlocks
          }
        });
      }, 0);
    }
  };
}
```

- [ ] **Step 2: 新增 _collectCrossRegionOverflow 测试**

在测试文件末尾（`globalThis._worldStore = ORIGINAL_WORLD_STORE` 之前）添加：

```javascript
describe('WorldGenerationService 跨 region overflow 收集与分发', (test) => {
  test('_collectCrossRegionOverflow - 应将 overflow 按目标 region 分组', () => {
    const service = new WorldGenerationService();
    service._collectCrossRegionOverflow({
      routingDiagnostics: {
        unresolvedOverflowBlocks: [
          { chunkKey: '8,0', blockDataBlocks: [{ x: 128, y: 5, z: 0, type: 'stone' }] },
          { chunkKey: '0,8', blockDataBlocks: [{ x: 0, y: 5, z: 128, type: 'wood' }] }
        ]
      }
    });

    assertTrue(service._crossRegionOverflowMap.has('1,0'), '目标 region (1,0) 应在 map 中');
    assertTrue(service._crossRegionOverflowMap.has('0,1'), '目标 region (0,1) 应在 map 中');
    assertEqual(service._crossRegionOverflowMap.get('1,0').length, 1, 'region (1,0) 应有一条 overflow');
    assertEqual(service._crossRegionOverflowMap.get('0,1').length, 1, 'region (0,1) 应有一条 overflow');
  });

  test('_distributeCrossRegionOverflow - 应将同批次 overflow 合并到目标 region', async () => {
    const savedRegions = [];
    globalThis._worldStore = {
      getRegionRecord: async (rx, rz) => {
        const key = `${rx},${rz}`;
        const found = savedRegions.find((r) => r.rx === rx && r.rz === rz);
        return found ? found.record : null;
      },
      saveRegionRecord: async (rx, rz, record) => {
        const idx = savedRegions.findIndex((r) => r.rx === rx && r.rz === rz);
        if (idx >= 0) {
          savedRegions[idx] = { rx, rz, record };
        } else {
          savedRegions.push({ rx, rz, record });
        }
      },
      saveOverflowBlocks: async () => {}
    };

    const service = new WorldGenerationService();
    // 预置目标 region record
    savedRegions.push({
      rx: 1, rz: 0,
      record: {
        regionKey: '1,0',
        rx: 1, rz: 0,
        chunkKeys: ['8,0'],
        chunks: {
          '8,0': { blockData: {}, staticEntities: [], runtimeSeedData: {} }
        }
      }
    });

    service._crossRegionOverflowMap.set('1,0', [
      { chunkKey: '8,0', blockDataBlocks: [{ x: 128, y: 5, z: 0, type: 'stone', orientation: 0 }] }
    ]);

    await service._distributeCrossRegionOverflow(['1,0']);

    assertEqual(savedRegions.length, 1, '应仍只有一个 region');
    const targetChunk = savedRegions[0].record.chunks['8,0'];
    const code = encodeCoord(128, 5, 0);
    assertTrue(
      Object.prototype.hasOwnProperty.call(targetChunk.blockData, code),
      'overflow block 应被合并到目标 chunk'
    );
    assertFalse(service._crossRegionOverflowMap.has('1,0'), '分发后应从 map 中移除');
  });

  test('_distributeCrossRegionOverflow - 目标 region 不在同批次时应持久化', async () => {
    let persistedOverflow = null;
    globalThis._worldStore = {
      getRegionRecord: async () => null,
      saveRegionRecord: async () => {},
      saveOverflowBlocks: async (rx, rz, data) => {
        persistedOverflow = { rx, rz, data };
      }
    };

    const service = new WorldGenerationService();
    service._crossRegionOverflowMap.set('5,5', [
      { chunkKey: '40,40', blockDataBlocks: [{ x: 640, y: 5, z: 640, type: 'stone' }] }
    ]);

    await service._distributeCrossRegionOverflow(['1,0']);

    assertNotNull(persistedOverflow, '应持久化到 world_overflow');
    assertEqual(persistedOverflow.rx, 5, '应持久化到目标 region rx=5');
    assertEqual(persistedOverflow.rz, 5, '应持久化到目标 region rz=5');
    assertFalse(service._crossRegionOverflowMap.has('5,5'), '持久化后应从 map 中移除');
  });

  test('_consumeOverflowForRegion - 扩图时应消费已持久化的 overflow', async () => {
    let removedRegionKey = null;
    globalThis._worldStore = {
      getOverflowBlocks: async () => ({
        '8,0': [{ x: 128, y: 5, z: 0, type: 'stone', orientation: 0 }]
      }),
      getRegionRecord: async () => ({
        regionKey: '1,0',
        rx: 1, rz: 0,
        chunkKeys: ['8,0'],
        chunks: {
          '8,0': { blockData: {}, staticEntities: [], runtimeSeedData: {} }
        }
      }),
      saveRegionRecord: async () => {},
      removeOverflowBlocks: async (rx, rz) => {
        removedRegionKey = `${rx},${rz}`;
      }
    };

    const service = new WorldGenerationService();
    await service._consumeOverflowForRegion(1, 0);

    assertEqual(removedRegionKey, '1,0', '消费后应删除 overflow 记录');
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/tests/test-world-generation-cross-region.js
git commit -m "test(world-generation): add cross-region overflow collect, distribute, and consume tests"
```

---

### Task 6: Lint 检查

**Files:**
- All modified files

- [ ] **Step 1: 运行 lint**

```bash
npm run lint
```

- [ ] **Step 2: 如有警告，分析并修复**

重点关注新增代码的 ESLint 警告，保持新增代码无警告。

- [ ] **Step 3: Commit（如需修复）**

```bash
git add -A
git commit -m "style: fix lint warnings in cross-region overflow routing"
```

---

## Self-Review

**1. Spec coverage:**
- Worker 返回 unresolved overflow blocks → Task 3 ✓
- 主线程暂存到 `_crossRegionOverflowMap` → Task 4 Step 2 ✓
- 同批次分发到目标 RegionRecord → Task 4 Step 3 ✓
- 剩余持久化到 world_overflow → Task 4 Step 3 ✓
- 扩图时消费已持久化 overflow → Task 4 Step 4 ✓
- DB_VERSION 升级 → Task 1 Step 1 ✓
- clearWorld 清除 overflow store → Task 1 Step 6 ✓
- 运行时路径不受影响 → 未修改运行时相关代码 ✓

**2. Placeholder scan:**
- 无 TBD/TODO ✓
- 无 "appropriate error handling" 等模糊描述 ✓
- 每个步骤包含完整代码 ✓
- 无 "similar to Task N" ✓

**3. Type consistency:**
- `unresolvedOverflowBlocks` 在 Worker 返回、主线程收集、持久化结构中的字段名一致 ✓
- `regionKey` 格式始终为 `"rx,rz"` ✓
- `chunkKey` 格式始终为 `"cx,cz"` ✓
- PersistenceWorker action 名与 WorldStore 方法名映射正确 ✓
