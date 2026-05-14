# 派生数据清理与增量更新优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 chunk unload 后的 runtime 残留（内存泄漏），清除 RegionCache 中冗余 blockData 副本，以及将 `appendScatteredBlocks` / `_applyConsolidateResult` 中不必要的全量重建改为增量更新或直接删除。

**Architecture:** blockData authority（`WorldBlockDataStore._slices`）全量永驻，所有派生数据在 chunk unload 时释放。`WorldChunkPayloadRegistry` 是独立权威数据，不在 unload 时清理。`_staticTreeTerrainBoostChunkKeys` 在 topology 变化后从已加载 chunks 重建。RegionCache 通过统一 helper `_stripBlockDataFromRegionRecord` 覆盖全部 6 个 `_regionCache.set` 调用点剥离 blockData；full-save 路径改为优先 patch、无 patch API 时重读完整 region，不用 stripped cache 做基底。M6 前置修复 `solidBlockIds` 共享 id 误删 bug。

**Tech Stack:** JavaScript (ES Modules), Three.js, Playwright headless 测试

**前置条件:** 实施前须在另一个终端保持 `npm run start` 运行（默认端口 8080）。`node command/run-tests.js` 通过 Playwright 访问 `127.0.0.1:8080`，不会自动启动 dev server。

---

## 文件结构

| 文件 | 变更类型 | 职责 |
|------|---------|------|
| `src/world/World.js` | Modify: L392-397, L1109-1113, L1118-1122 | M1 冷导入去冗余、M2 chunk unload 清理、M3 topology 变化后重建 boost |
| `src/world/WorldRuntime.js` | Modify: L88-110, L203-210, L320-330, L333-374, L524-535, L640-684, L746-761 | M1 统一 helper + 6 个 `_regionCache.set` 调用点 + full-save 路径修复 + preserveStoredBlockData 防御、M2 新增 clearChunkRuntimeResidue |
| `src/world/Chunk.js` | Modify: L1549-1574, L2624-2631, L3966-3968 | M6 前置修复 solidBlockIds 共享 id bug（_updateBlockState + _injectStaticEntities）、M5 增量更新 blockDataArray |
| `src/world/ChunkConsolidation.js` | Modify: L460-461 | M6 去除多余 _initArrayStorageFromBlockData |
| `src/tests/test-world.js` | Modify | M2/M3 新增测试 |
| `src/tests/test-world-runtime.js` | Modify | M1 新增测试 + 更新已有断言 |
| `src/tests/test-chunk.js` | Modify | M5/M6 新增测试 |

---

### Task 1: M2 — chunk unload 时清理 runtime 残留

**Files:**
- Test: `src/tests/test-world.js`
- Modify: `src/world/WorldRuntime.js` (新增方法)
- Modify: `src/world/World.js:1109-1113`

- [ ] **Step 1: 写失败测试 — unload 后 runtime 残留不残留**

在 `src/tests/test-world.js` 中添加测试（在 "runtime-streaming 区块卸载时不应等待写盘完成" 测试之后）：

```javascript
test('chunk unload 后 runtime 残留（dirty/pendingUnload/flushTimer）不应残留', async () => {
  setupEnvironment();

  scene = new THREE.Scene();
  world = new World(scene);

  world.update(new THREE.Vector3(0, 10, 0), 0.016);
  await waitForChunkReady(world, '0,0');

  world.bootstrapState.phase = 'runtime-streaming';

  // 模拟 worldRuntime，注入 dirty / pendingUnload / flushTimer 三种残留
  // 用 stub timer id 而非真实 setTimeout，避免测试失败时挂住事件循环
  const dirtyChunks = new Map();
  dirtyChunks.set('0,0', { cx: 0, cz: 0, dirty: true });
  const pendingUnloadFlushQueue = new Map();
  pendingUnloadFlushQueue.set('0,0', { chunkKey: '0,0' });
  const flushTimers = new Map();
  const stubTimerId = setTimeout(() => {}, 0); // 立即过期的 stub
  clearTimeout(stubTimerId); // 立即取消，只保留 id 用于验证 Map 行为
  flushTimers.set('0,0', stubTimerId);

  let clearTimeoutCalledWith = null;
  world.worldRuntime = {
    _dirtyChunks: dirtyChunks,
    pendingUnloadFlushQueue,
    _flushTimers: flushTimers,
    _chunkKey(cx, cz) { return `${cx},${cz}`; },
    clearChunkRuntimeResidue(cx, cz) {
      const key = this._chunkKey(cx, cz);
      this._dirtyChunks.delete(key);
      this.pendingUnloadFlushQueue.delete(key);
      const timer = this._flushTimers.get(key);
      if (timer !== undefined) {
        clearTimeoutCalledWith = timer;
        clearTimeout(timer);
        this._flushTimers.delete(key);
      }
    },
    ensureChunkData() {
      return Promise.resolve({ status: 'missing-region' });
    },
    prefetchRegions() {}
  };

  // 移动到远处触发 unload
  world.update(new THREE.Vector3(200, 10, 200), 0.016);

  assertFalse(world.chunks.has('0,0'), 'chunk 应已卸载');
  assertFalse(dirtyChunks.has('0,0'), 'unload 后 _dirtyChunks 不应残留');
  assertFalse(pendingUnloadFlushQueue.has('0,0'), 'unload 后 pendingUnloadFlushQueue 不应残留');
  assertFalse(flushTimers.has('0,0'), 'unload 后 _flushTimers 不应残留');

  teardownEnvironment();
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — World.js 尚未调用 `clearChunkRuntimeResidue`

- [ ] **Step 3: 在 WorldRuntime 新增 clearChunkRuntimeResidue 方法**

在 `src/world/WorldRuntime.js:205`（`clearChunkDirty` 方法之后）添加：

```javascript
  /**
   * 统一清理 chunk 卸载后的 runtime 残留
   */
  clearChunkRuntimeResidue(cx, cz) {
    const key = this._chunkKey(cx, cz);
    this._dirtyChunks.delete(key);
    this.pendingUnloadFlushQueue.delete(key);
    const timer = this._flushTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._flushTimers.delete(key);
    }
  }
```

- [ ] **Step 3.5: 写单测 — WorldRuntime.clearChunkRuntimeResidue 直接验证**

在 `src/tests/test-world-runtime.js` 中添加：

```javascript
test('clearChunkRuntimeResidue - 应清理 dirtyChunks / pendingUnloadFlushQueue / _flushTimers', () => {
  const originalWorldStore = globalThis._worldStore;
  globalThis._worldStore = { getChunkRecord: async () => null };

  const runtime = new WorldRuntime();
  runtime._dirtyChunks.set('0,0', { cx: 0, cz: 0, dirty: true });
  runtime.pendingUnloadFlushQueue.set('0,0', { chunkKey: '0,0' });
  const stubTimerId = setTimeout(() => {}, 0);
  clearTimeout(stubTimerId);
  runtime._flushTimers.set('0,0', stubTimerId);

  runtime.clearChunkRuntimeResidue(0, 0);

  assertFalse(runtime._dirtyChunks.has('0,0'), '_dirtyChunks 应已清理');
  assertFalse(runtime.pendingUnloadFlushQueue.has('0,0'), 'pendingUnloadFlushQueue 应已清理');
  assertFalse(runtime._flushTimers.has('0,0'), '_flushTimers 应已清理');

  // 不存在的 chunk 调用不应报错
  runtime.clearChunkRuntimeResidue(99, 99);

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 4: 在 World.js chunk unload 循环中调用**

在 `src/world/World.js:1109`（`chunk.dispose()` 之前）插入：

```javascript
        // 5. 清理 runtime 残留（dirty + pendingUnload + flushTimer）
        this.worldRuntime?.clearChunkRuntimeResidue?.(chunk.cx, chunk.cz);
```

原来的注释 `// 5. 释放显存并从活动 chunk 集合移除` 改为 `// 6. 释放显存并从活动 chunk 集合移除`。

- [ ] **Step 5: 运行测试，验证通过**

Run: `node command/run-tests.js`
Expected: PASS

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: 无新增警告

---

### Task 2: M3 — chunk topology 变化后重建 `_staticTreeTerrainBoostChunkKeys`

**Files:**
- Test: `src/tests/test-world.js`
- Modify: `src/world/World.js:1118-1122`

- [ ] **Step 1: 写失败测试 — topology 变化后 boost Set 仅包含已加载 chunk 的标记（含过期清除 + 多源 overlap 保留）**

在 `src/tests/test-world.js` 中添加两个测试：

```javascript
test('chunk topology 变化后 _staticTreeTerrainBoostChunkKeys 应从已加载 chunks 重建', async () => {
  setupEnvironment();

  scene = new THREE.Scene();
  world = new World(scene);

  world.update(new THREE.Vector3(0, 10, 0), 0.016);
  await waitForChunkReady(world, '0,0');

  world.bootstrapState.phase = 'runtime-streaming';

  // 手动注入一个过期 boost key（模拟已卸载 chunk 遗留）
  world._staticTreeTerrainBoostChunkKeys.add('99,99');
  assertTrue(world._staticTreeTerrainBoostChunkKeys.has('99,99'), '应已注入过期 key');

  world.worldRuntime = {
    ensureChunkData() {
      return Promise.resolve({ status: 'missing-region' });
    },
    prefetchRegions() {},
    clearChunkRuntimeResidue() {}
  };

  // 移动到远处触发 unload（会触发 chunkTopologyChanged）
  world.update(new THREE.Vector3(200, 10, 200), 0.016);

  assertFalse(world._staticTreeTerrainBoostChunkKeys.has('99,99'),
    'topology 变化后过期 boost key 不应残留');

  teardownEnvironment();
});

test('chunk topology 重建时多源 chunk 产生的重叠 boost key 应保留', async () => {
  setupEnvironment();

  scene = new THREE.Scene();
  world = new World(scene);

  world.update(new THREE.Vector3(0, 10, 0), 0.016);
  await waitForChunkReady(world, '0,0');

  world.bootstrapState.phase = 'runtime-streaming';

  // 确保两个源 chunk 都已加载（防止断言被静默跳过）
  const chunk00 = world.chunks.get('0,0');
  const chunk10 = world.chunks.get('1,0');
  assertTrue(!!chunk00, '测试前提：chunk 0,0 应已加载');
  assertTrue(!!chunk10, '测试前提：chunk 1,0 应已加载');

  // 模拟两个源 chunk 都有 static_tree，且 boost 覆盖范围重叠于 '1,0'
  chunk00.structureCenters = [
    { type: 'static_tree', x: 14, y: 10, z: 8 } // 影响 chunk 0,0 和 1,0
  ];
  chunk10.structureCenters = [
    { type: 'static_tree', x: 18, y: 10, z: 8 } // 也影响 chunk 1,0
  ];

  // 注入过期 key，然后通过生产代码 helper 重建
  world._staticTreeTerrainBoostChunkKeys.add('99,99');
  world._rebuildStaticTreeTerrainBoostChunkKeys();

  // '1,0' 应存在（被两个源 chunk 共同标记），过期 key 应清除
  assertTrue(world._staticTreeTerrainBoostChunkKeys.has('1,0'),
    '多源 overlap 的 boost key 应在重建后保留');
  assertFalse(world._staticTreeTerrainBoostChunkKeys.has('99,99'),
    '过期 boost key 应被清除');

  teardownEnvironment();
});

test('卸载一个源 chunk 后，另一个源产生的 boost key 仍应存在', async () => {
  setupEnvironment();

  scene = new THREE.Scene();
  world = new World(scene);

  world.update(new THREE.Vector3(0, 10, 0), 0.016);
  await waitForChunkReady(world, '0,0');

  world.bootstrapState.phase = 'runtime-streaming';

  const chunk00 = world.chunks.get('0,0');
  const chunk10 = world.chunks.get('1,0');
  assertTrue(!!chunk00, '测试前提：chunk 0,0 应已加载');
  assertTrue(!!chunk10, '测试前提：chunk 1,0 应已加载');

  // 两个源 chunk 都标记 '1,0' 为 boost target
  chunk00.structureCenters = [
    { type: 'static_tree', x: 14, y: 10, z: 8 }
  ];
  chunk10.structureCenters = [
    { type: 'static_tree', x: 18, y: 10, z: 8 }
  ];

  // 通过生产代码 helper 初始重建，确认 '1,0' 存在
  world._rebuildStaticTreeTerrainBoostChunkKeys();
  assertTrue(world._staticTreeTerrainBoostChunkKeys.has('1,0'),
    '初始重建后 1,0 应存在');

  // 模拟卸载 chunk 0,0（移除后通过生产代码 helper 重建）
  world.chunks.delete('0,0');
  world._rebuildStaticTreeTerrainBoostChunkKeys();

  // chunk 1,0 仍在，它自身的 structureCenters 仍应标记 '1,0'
  assertTrue(world._staticTreeTerrainBoostChunkKeys.has('1,0'),
    '卸载一个源后，另一个源产生的 boost key 仍应存在');

  teardownEnvironment();
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `_staticTreeTerrainBoostChunkKeys` 仍包含 `99,99`

- [ ] **Step 3: 实现 — 提取 helper 并在 topology 变化后调用**

在 `src/world/World.js` 中新增 helper 方法（放在 `_markStaticTreeTerrainBoostFromChunk` 附近）：

```javascript
  _rebuildStaticTreeTerrainBoostChunkKeys() {
    this._staticTreeTerrainBoostChunkKeys.clear();
    for (const [, ch] of this.chunks) {
      this._markStaticTreeTerrainBoostFromChunk(ch);
    }
  }
```

在 `chunkTopologyChanged` 分支中（约 L1118-1122，`this.clearBlockLookupCaches()` 之后），添加：

```javascript
      this._rebuildStaticTreeTerrainBoostChunkKeys();
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `node command/run-tests.js`
Expected: PASS

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: 无新增警告

---

### Task 3: M1 — RegionCache 去除 blockData 冗余副本（统一 helper + 6 个写入点）

**Files:**
- Test: `src/tests/test-world-runtime.js`
- Modify: `src/world/World.js:392-397`
- Modify: `src/world/WorldRuntime.js:88-110, 346-366, 524-535, 678-683, 746-761`

**设计要点**：不逐点手工剥离，而是新增统一 helper `_stripBlockDataFromRegionRecord(region)`，在所有 `_regionCache.set(...)` 前调用。写盘路径（`saveRegionRecord`）使用原始 region，缓存用 helper 处理后的 shallow clone，避免引用污染。

- [ ] **Step 1: 写失败测试 — _upsertRegionCacheChunkRecord 存入后不含 blockData**

在 `src/tests/test-world-runtime.js` 中添加测试：

```javascript
test('_upsertRegionCacheChunkRecord - 存入 RegionCache 的 chunkRecord 不应包含 blockData', async () => {
  const originalWorldStore = globalThis._worldStore;
  globalThis._worldStore = { getChunkRecord: async () => null };

  const runtime = new WorldRuntime();
  const chunkRecord = {
    cx: 0, cz: 0,
    blockData: { 123: 'stone', 456: 'dirt' },
    staticEntities: [{ type: 'tree' }],
    runtimeSeedData: { structureCenters: [] }
  };

  runtime._upsertRegionCacheChunkRecord(0, 0, chunkRecord);

  const cachedRegion = runtime._regionCache.get('0,0');
  assertTrue(!!cachedRegion, '应已注入 region cache');
  const stored = cachedRegion.chunks['0,0'];
  assertTrue(
    stored.blockData === undefined,
    '存入 RegionCache 的 chunkRecord 不应包含 blockData'
  );
  assertDeepEqual(stored.staticEntities, [{ type: 'tree' }], 'staticEntities 应保留');

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `stored.blockData` 仍包含数据

- [ ] **Step 3: 实现 — 新增统一 helper `_stripBlockDataFromRegionRecord`**

在 `src/world/WorldRuntime.js` 中（`clearChunkRuntimeResidue` 方法之后或类末尾）添加：

```javascript
  /**
   * 从 region record 的各 chunk 中剥离 blockData 冗余副本。
   * 返回可安全放入 _regionCache 的浅克隆，不修改原始对象。
   */
  _stripBlockDataFromRegionRecord(region) {
    if (!region?.chunks) return region;
    const cleaned = { ...region, chunks: {} };
    for (const [ck, rec] of Object.entries(region.chunks)) {
      if (rec && rec.blockData !== undefined) {
        const { blockData: _dropped, ...rest } = rec;
        cleaned.chunks[ck] = rest;
      } else {
        cleaned.chunks[ck] = rec;
      }
    }
    return cleaned;
  }
```

- [ ] **Step 4: 在 `_upsertRegionCacheChunkRecord` 中应用 helper（避免污染缓存引用）**

`src/world/WorldRuntime.js:104` 的 `existingRegion.chunks[chunkKey] = chunkRecord;` 会通过 `_regionCache.get()` 返回的引用原地修改缓存对象，临时将带 blockData 的 chunkRecord 写入旧缓存。外部若持有旧引用则可看到冗余 blockData。

将 L104-L109 整体改为构建新 region 后写入 cache，不修改 `existingRegion` 引用：

```javascript
    const newRegion = this._stripBlockDataFromRegionRecord({
      ...existingRegion,
      chunks: { ...existingRegion.chunks, [chunkKey]: chunkRecord },
      chunkKeys: existingRegion.chunkKeys.includes(chunkKey)
        ? existingRegion.chunkKeys
        : [...existingRegion.chunkKeys, chunkKey]
    });
    this._regionCache.set(regionKey, newRegion);
```

这样：(1) `existingRegion`（旧缓存引用）不被修改；(2) `_stripBlockDataFromRegionRecord` 剥离所有 chunk 的 blockData；(3) cache 中存入的是全新对象。

- [ ] **Step 5: 运行测试，验证通过**

Run: `node command/run-tests.js --verbose`
Expected: 新测试 PASS；已有测试断言 `cachedRegion.chunks['0,0'].blockData` 的用例（L46）会 FAIL

- [ ] **Step 6: 更新已有测试断言**

`src/tests/test-world-runtime.js` 中需要更新的断言：

1. L46: `assertDeepEqual(cachedRegion.chunks['0,0'].blockData, ...)` → 改为 `assertTrue(cachedRegion.chunks['0,0'].blockData === undefined, 'RegionCache 不应保留 blockData 冗余副本')`

2. 检查 L91、L132 等其他引用 `cachedRegion.chunks[...].blockData` 的断言，如断言 blockData 存在，同样更新为断言 blockData 不存在。

3. L910: `assertEqual(runtime._regionCache.get('0,0').chunks['0,0'].blockData, cachedBlockData, ...)` → 改为 `assertTrue(runtime._regionCache.get('0,0').chunks['0,0'].blockData === undefined, 'region cache 不应保留 blockData 冗余副本')`

- [ ] **Step 7: 运行测试，验证全部通过**

Run: `node command/run-tests.js`
Expected: PASS

- [ ] **Step 8: 写失败测试 — _updateRegionCacheChunkRecord 存入后不含 blockData**

```javascript
test('_updateRegionCacheChunkRecord - 写入路径也应剥离 blockData', () => {
  const originalWorldStore = globalThis._worldStore;
  globalThis._worldStore = { getChunkRecord: async () => null };

  const runtime = new WorldRuntime();
  runtime._regionCache.set('0,0', {
    regionKey: '0,0', rx: 0, rz: 0,
    chunkKeys: [], chunks: {}
  });

  runtime._updateRegionCacheChunkRecord(0, 0, {
    blockData: { 789: 'wood' },
    staticEntities: []
  });

  const stored = runtime._regionCache.get('0,0').chunks['0,0'];
  assertTrue(
    stored.blockData === undefined,
    '_updateRegionCacheChunkRecord 也不应保留 blockData'
  );

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 9: 运行测试，验证失败；实现 — _updateRegionCacheChunkRecord 剥离 blockData**

在 `src/world/WorldRuntime.js:535`（`cachedRegion.chunks[key] = chunkRecord;`），改为 per-record 剥离：

```javascript
    const { blockData: _dropped, ...cleanRecord } = chunkRecord;
    cachedRegion.chunks[key] = cleanRecord;
```

> **注意**：`_updateRegionCacheChunkRecord` 没有 `_regionCache.set` 调用（原地修改缓存引用），因此不能使用 `_stripBlockDataFromRegionRecord` 统一处理。per-record 剥离在此处是正确的 — 其他 chunk 的 blockData 已在入缓存时被 helper 剥离过。

- [ ] **Step 10: 写失败测试 — ensureRegion 读入后剥离 blockData**

```javascript
test('ensureRegion - 从 IndexedDB 读入的 region record 应剥离各 chunk 的 blockData', async () => {
  const originalWorldStore = globalThis._worldStore;
  globalThis._worldStore = {
    getRegionRecord: async () => ({
      regionKey: '0,0', rx: 0, rz: 0,
      chunkKeys: ['0,0', '1,0'],
      chunks: {
        '0,0': { blockData: { 1: 'stone' }, staticEntities: [] },
        '1,0': { blockData: { 2: 'dirt' }, staticEntities: [] }
      }
    })
  };

  const runtime = new WorldRuntime();
  const region = await runtime.ensureRegion(0, 0);

  assertTrue(!!region, '应返回 region');
  assertTrue(region.chunks['0,0'].blockData === undefined, 'ensureRegion 后 chunk 0,0 不应保留 blockData');
  assertTrue(region.chunks['1,0'].blockData === undefined, 'ensureRegion 后 chunk 1,0 不应保留 blockData');

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 11: 运行测试，验证失败；实现 — ensureRegion 使用 helper**

在 `src/world/WorldRuntime.js:758-764` 的 `.then((record) => {...})` 中，将：

```javascript
        if (record) {
          this._regionCache.set(regionKey, record);
        }
        this._regionLoadPromises.delete(regionKey);
        return record;
```

改为：

```javascript
        const cleaned = record ? this._stripBlockDataFromRegionRecord(record) : record;
        if (cleaned) {
          this._regionCache.set(regionKey, cleaned);
        }
        this._regionLoadPromises.delete(regionKey);
        return cleaned;
```

**关键**：`return cleaned` 确保 `ensureRegion` 的调用者和 `_regionLoadPromises` resolve 拿到的都是 stripped 后的对象，与测试断言 `region.chunks[...].blockData === undefined` 一致。

- [ ] **Step 12: 写失败测试 — flushAllDirty 写回后 RegionCache 不含 blockData**

```javascript
test('flushAllDirty - 写回后 RegionCache 不含 blockData 且写盘数据完整', async () => {
  const originalWorldStore = globalThis._worldStore;
  const savedRegions = [];
  const patchedRegions = [];

  globalThis._worldStore = {
    saveRegionRecord: async (rx, rz, region) => {
      savedRegions.push({ rx, rz, region: JSON.parse(JSON.stringify(region)) });
      return true;
    },
    getRegionRecord: async (rx, rz) => ({
      regionKey: '0,0', rx: 0, rz: 0,
      chunkKeys: ['0,0', '1,0'],
      chunks: {
        '0,0': { blockData: { 1: 'stone' }, staticEntities: [] },
        '1,0': { blockData: { 2: 'dirt', 3: 'wood' }, staticEntities: [{ type: 'tree' }] }
      }
    }),
    applyRegionPatch: null
  };

  const runtime = new WorldRuntime();
  // M1 后 cache 中的 region 已 stripped（无 blockData）
  runtime._regionCache.set('0,0', {
    regionKey: '0,0', rx: 0, rz: 0,
    chunkKeys: ['0,0', '1,0'],
    chunks: {
      '0,0': { staticEntities: [] },
      '1,0': { staticEntities: [{ type: 'tree' }] }
    }
  });
  // 只有 chunk 0,0 是 dirty
  runtime._dirtyChunks.set('0,0', {
    cx: 0, cz: 0, dirty: true, pendingFlush: false,
    blockDataSnapshot: null
  });

  await runtime.flushAllDirty();

  // 写盘的 region 应保留所有 chunk 的 blockData
  assertTrue(savedRegions.length > 0, '应有写盘操作');
  const saved = savedRegions[0].region;
  const savedChunk00 = saved.chunks['0,0'];
  assertTrue(!!savedChunk00, '写盘 region 应包含 chunk 0,0');

  // 关键断言：未被 flush 的 chunk 1,0 的 blockData 不应丢失
  const savedChunk10 = saved.chunks['1,0'];
  assertTrue(!!savedChunk10, '写盘 region 应包含 chunk 1,0');
  assertTrue(!!savedChunk10.blockData, '未 flush 的 chunk 1,0 写盘时 blockData 不应丢失');
  assertDeepEqual(savedChunk10.blockData, { 2: 'dirt', 3: 'wood' },
    '未 flush 的 chunk 1,0 写盘 blockData 应与 worldStore 原始数据一致');

  // RegionCache 中不应保留 blockData
  const cached = runtime._regionCache.get('0,0');
  assertTrue(!!cached?.chunks?.['0,0'], 'RegionCache 应包含 chunk 0,0');
  assertTrue(cached.chunks['0,0'].blockData === undefined,
    'flushAllDirty 后 RegionCache 不应保留 blockData');

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 13: 运行测试，验证失败；实现 — flushAllDirty 全部 _regionCache.set 使用 helper + 修复 full-save 路径**

M1 剥离 cache 中的 blockData 后，`_regionCache.get(rKey)` 返回的 region 不再包含各 chunk 的 blockData。如果 `flushAllDirty` 用这个 stripped region 做 `saveRegionRecord` 的基底，region 中**未被 flush 的其他 chunk** 的 blockData 会永久丢失。

**修复策略**：`else if (region)` 分支（L347）也优先走 `applyRegionPatch`；无 patch API 时从 `worldStore.getRegionRecord()` 重读完整 region 再 merge。

在 `src/world/WorldRuntime.js` 的 `flushAllDirty` 方法中：

**L336 `__partial` 分支**（已使用 `applyRegionPatch`）：L346 的 `_regionCache.set` 改为使用 helper：

```javascript
          this._regionCache.set(rKey, this._stripBlockDataFromRegionRecord(region));
```

**L347 `else if (region)` 分支**：改为也优先走 `applyRegionPatch`，无 patch API 时重读完整 region：

```javascript
        } else if (region) {
          const chunkPatches = Array.from(group.chunks.entries()).map(([chunkKey, chunkRecord]) => ({
            chunkKey,
            chunkRecord: this._cloneSerializable(chunkRecord, null)
          }));
          if (typeof this._worldStore.applyRegionPatch === 'function') {
            await this._worldStore.applyRegionPatch(group.rx, group.rz, { chunkPatches });
          } else {
            // 无 patch API — 从 worldStore 重读完整 region 再 merge，不用 stripped cache 做基底
            const fullRegion = await this._worldStore.getRegionRecord(group.rx, group.rz) || region;
            for (const [chunkKey, chunkRecord] of group.chunks) {
              // 属性合并：preserveStoredBlockData 删除了 chunkRecord.blockData 时，不会覆盖 fullRegion 已有的 blockData
              fullRegion.chunks[chunkKey] = { ...fullRegion.chunks[chunkKey], ...chunkRecord };
            }
            await this._worldStore.saveRegionRecord(group.rx, group.rz, fullRegion);
          }
          // merge 新 chunkRecord 到 region cache（更新 staticEntities/runtimeSeedData 等元数据）
          for (const [chunkKey, chunkRecord] of group.chunks) {
            region.chunks[chunkKey] = { ...region.chunks[chunkKey], ...chunkRecord };
          }
          this._regionCache.set(rKey, this._stripBlockDataFromRegionRecord(region));
```

**L354 `else` 分支**（新建 region）：L366 的 `_regionCache.set` 改为使用 helper：

```javascript
          this._regionCache.set(rKey, this._stripBlockDataFromRegionRecord(newRegion));
```

- [ ] **Step 14: 实现 — flushPendingUnloadQueueWithinBudget 修复 full-save 路径 + 使用 helper**

`flushPendingUnloadQueueWithinBudget` 的 `else` fallback（L652-683）clone 了 stripped cache 做 `saveRegionRecord` 基底，与发现 1 同类问题。

在 `src/world/WorldRuntime.js:652` 的 `else` 分支中，将 L653 的 `this._cloneSerializable(this._regionCache.get(regionKey), {...})` 改为从 worldStore 重读完整 region：

```javascript
      } else {
        // 无 patch API — 从 worldStore 重读完整 region，不用 stripped cache 做基底
        const fullRegion = await this._worldStore.getRegionRecord(rx, rz) || {
          regionKey, rx, rz,
          chunkKeys: [],
          chunks: {},
          generatedAt: Date.now(),
          generatorVersion: '1.0'
        };
        if (!fullRegion.chunks) fullRegion.chunks = {};
        if (!Array.isArray(fullRegion.chunkKeys)) fullRegion.chunkKeys = [];

        for (const entry of regionEntries) {
          const currentChunk = fullRegion.chunks[entry.chunkKey] || {};
          // 纯属性 merge：Step 14.5 已对 preserveStoredBlockData 的 chunkRecord 删除 blockData 字段，
          // 此处 spread 自然保留 currentChunk 的 blockData；否则 entry.chunkRecord.blockData 覆盖
          fullRegion.chunks[entry.chunkKey] = { ...currentChunk, ...entry.chunkRecord };
          if (!fullRegion.chunkKeys.includes(entry.chunkKey)) {
            fullRegion.chunkKeys.push(entry.chunkKey);
          }
        }

        await this._worldStore.saveRegionRecord(rx, rz, fullRegion);
        this._regionCache.set(regionKey, this._stripBlockDataFromRegionRecord(fullRegion));
      }
```

**关键**：`preserveStoredBlockData` 路径从 `fullRegion`（完整 region）读 `currentChunk.blockData`，而非从 stripped cache 读，确保拿到有效数据。

- [ ] **Step 14.5: 防御 — preserveStoredBlockData 路径改为删除 chunkRecord.blockData**

M1 剥离 RegionCache blockData 后，旧 flush 路径的 `preserveStoredBlockData` 逻辑（flushAllDirty L324-325、flushPendingUnloadQueueWithinBudget L673-675）会从 `cachedChunkRecord?.blockData || {}` 读到空对象。若用 `continue` 跳过，会让 entry 永久残留在队列中（flushAllDirty），或跳过写入但仍删除队列项导致静默丢数据（flushPendingUnloadQueueWithinBudget）。

正确做法：当 `preserveStoredBlockData === true` 时，直接删除 chunkRecord 的 blockData 字段。这样 patch 路径自然保留 IndexedDB 中已有的 blockData，full-save 路径从 `getRegionRecord()` 重读时 merge 也自然保留。

在 `src/world/WorldRuntime.js:324`，将：

```javascript
      if (queueRecord.preserveStoredBlockData === true) {
        chunkRecord.blockData = cachedChunkRecord?.blockData || {};
      }
```

改为：

```javascript
      if (queueRecord.preserveStoredBlockData === true) {
        // RegionCache 已剥离 blockData，不再从 cache 读取。
        // 删除 chunkRecord 的 blockData，让写盘路径自然保留 IndexedDB 中已有数据：
        // - patch 路径：chunkRecord 不含 blockData，已有数据不受影响
        // - full-save 路径：从 getRegionRecord() 重读完整 region，merge 时无 blockData 属性不会覆盖
        delete chunkRecord.blockData;
      }
```

同样在 `flushPendingUnloadQueueWithinBudget` 的 L673-675 做相同处理：

```javascript
      if (entry.preserveStoredBlockData) {
        delete entry.chunkRecord.blockData;
      }
```

同时更新 Step 13 和 Step 14 的 full-save fallback merge 逻辑，确保 merge 使用属性合并而非全量替换：

**Step 13 full-save fallback 的 merge**（已有代码 `fullRegion.chunks[chunkKey] = chunkRecord`）改为：

```javascript
            fullRegion.chunks[chunkKey] = { ...fullRegion.chunks[chunkKey], ...chunkRecord };
```

**Step 14 full-save fallback 的 merge**（已有代码 `fullRegion.chunks[entry.chunkKey] = { ...currentChunk, ...entry.chunkRecord, ... }`）不需要改 — 已经使用 spread merge。

- [ ] **Step 14.6: 写测试 — flushPendingUnloadQueueWithinBudget stripped cache 下写盘不丢数据**

```javascript
test('flushPendingUnloadQueueWithinBudget - stripped cache 下写盘不应丢失其他 chunk 的 blockData', async () => {
  const originalWorldStore = globalThis._worldStore;
  const savedRegions = [];

  globalThis._worldStore = {
    saveRegionRecord: async (rx, rz, region) => {
      savedRegions.push({ rx, rz, region: JSON.parse(JSON.stringify(region)) });
      return true;
    },
    getRegionRecord: async (rx, rz) => ({
      regionKey: '0,0', rx: 0, rz: 0,
      chunkKeys: ['0,0', '1,0'],
      chunks: {
        '0,0': { blockData: { 1: 'stone' }, staticEntities: [{ id: 'e1' }] },
        '1,0': { blockData: { 2: 'dirt', 3: 'wood' }, staticEntities: [] }
      }
    })
  };

  const runtime = new WorldRuntime();
  // RegionCache 中存入 stripped region（无 blockData）
  runtime._regionCache.set('0,0', {
    regionKey: '0,0', rx: 0, rz: 0,
    chunkKeys: ['0,0', '1,0'],
    chunks: {
      '0,0': { staticEntities: [{ id: 'e1' }] },
      '1,0': { staticEntities: [] }
    }
  });

  // 往 pendingUnloadFlushQueue 添加一条 chunk 0,0 的卸载记录
  runtime.pendingUnloadFlushQueue.set('0,0', {
    cx: 0, cz: 0,
    chunkRecord: { blockData: { 1: 'stone', 4: 'sand' }, staticEntities: [{ id: 'e1' }] },
    preserveStoredBlockData: false
  });

  await runtime.flushPendingUnloadQueueWithinBudget(1000);

  // 写盘的 region 应保留 chunk 1,0 的 blockData（从 getRegionRecord 重读）
  assertTrue(savedRegions.length > 0, '应有写盘操作');
  const saved = savedRegions[0].region;
  const savedChunk10 = saved.chunks['1,0'];
  assertTrue(!!savedChunk10, '写盘 region 应包含 chunk 1,0');
  assertTrue(!!savedChunk10.blockData, '未 flush 的 chunk 1,0 写盘时 blockData 不应丢失');
  assertDeepEqual(savedChunk10.blockData, { 2: 'dirt', 3: 'wood' },
    '未 flush 的 chunk 1,0 写盘 blockData 应与 worldStore 原始数据一致');

  // RegionCache 中不应保留 blockData
  const cached = runtime._regionCache.get('0,0');
  assertTrue(cached.chunks['0,0'].blockData === undefined,
    'flush 后 RegionCache 不应保留 blockData');

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 14.6.1: 写测试 — flushPendingUnloadQueueWithinBudget preserveStoredBlockData: true 场景**

```javascript
test('flushPendingUnloadQueueWithinBudget - preserveStoredBlockData: true 时保留原 blockData', async () => {
  const originalWorldStore = globalThis._worldStore;
  const savedRegions = [];

  const storedBlockData = { 1: 'stone', 2: 'dirt' };
  globalThis._worldStore = {
    saveRegionRecord: async (rx, rz, region) => {
      savedRegions.push({ rx, rz, region: JSON.parse(JSON.stringify(region)) });
      return true;
    },
    getRegionRecord: async (rx, rz) => ({
      regionKey: '0,0', rx: 0, rz: 0,
      chunkKeys: ['0,0'],
      chunks: {
        '0,0': { blockData: storedBlockData, staticEntities: [{ id: 'e1' }] }
      }
    })
  };

  const runtime = new WorldRuntime();
  // RegionCache 中存入 stripped region（无 blockData）
  runtime._regionCache.set('0,0', {
    regionKey: '0,0', rx: 0, rz: 0,
    chunkKeys: ['0,0'],
    chunks: {
      '0,0': { staticEntities: [{ id: 'e1' }] }
    }
  });

  // pendingUnloadFlushQueue 带 preserveStoredBlockData: true
  // chunkRecord 中的 blockData 只有新增方块，期望 merge 后保留 store 中的原数据
  runtime.pendingUnloadFlushQueue.set('0,0', {
    cx: 0, cz: 0,
    chunkRecord: { blockData: { 1: 'stone', 2: 'dirt', 5: 'sand' }, staticEntities: [{ id: 'e1' }] },
    preserveStoredBlockData: true
  });

  await runtime.flushPendingUnloadQueueWithinBudget(1000);

  // Step 14.5 delete 了 chunkRecord.blockData，full-save 路径从 getRegionRecord() 重读
  // merge 后 store 中的原 blockData 应保留
  assertTrue(savedRegions.length > 0, '应有写盘操作');
  const saved = savedRegions[0].region;
  const savedChunk = saved.chunks['0,0'];
  assertTrue(!!savedChunk.blockData, 'preserveStoredBlockData: true 写盘后 blockData 不应丢失');
  assertDeepEqual(savedChunk.blockData, storedBlockData,
    'preserveStoredBlockData: true 应保留 store 中的原 blockData，不被 chunkRecord 覆盖');

  // RegionCache 中不应保留 blockData
  const cached = runtime._regionCache.get('0,0');
  assertTrue(cached.chunks['0,0'].blockData === undefined,
    'flush 后 RegionCache 不应保留 blockData');

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 14.7: 运行测试，验证通过**

Run: `node command/run-tests.js`
Expected: PASS（实现已在 Step 14 和 Step 14.5 完成）

- [ ] **Step 15: 实现 — cold import 路径置空 blockData**

在 `src/world/World.js:401`（`if/else` 分支之后，即 `ensureChunkSlice` 和 `replaceChunkSlice` 两个分支结束后），添加：

```javascript
        // 释放 chunkRecord 对 rawBlockData 的引用，无论是否为空
        result.chunkRecord.blockData = null;
```

放在 `if/else` 之后而非只跟在 `replaceChunkSlice` 后，确保空 blockData 也一致释放引用。

- [ ] **Step 16: 运行全部测试，验证通过**

Run: `node command/run-tests.js`
Expected: PASS

- [ ] **Step 17: 运行 lint**

Run: `npm run lint`
Expected: 无新增警告

---

### Task 4: M5 — `appendScatteredBlocks` 增量更新 `blockDataArray`

**Files:**
- Test: `src/tests/test-chunk.js`（需在文件顶部新增 `import { WorldBlockDataStore } from '../world/WorldBlockDataStore.js';`）
- Modify: `src/world/Chunk.js:3966-3968`

- [ ] **Step 1: 写失败测试 — 不调用全量重建 + 行为正确性**

在 `src/tests/test-chunk.js` 中添加测试（在 "appendScatteredBlocks" 测试分组附近）：

```javascript
test('appendScatteredBlocks - 追加方块后应增量更新 blockDataArray 而非全量重建', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);

  // 预填充一些方块
  const baseCode = Chunk.encodeCoord(1, 1, 1);
  chunk.blockData.set(baseCode, 'stone');
  chunk._initArrayStorageFromBlockData();

  const baseIndex = (1 << 8) | (1 << 4) | 1;
  const baseBlockId = chunk.blockDataArray[baseIndex];
  assertTrue(baseBlockId > 0, '预填充方块应有 blockId');

  // spy 全量重建
  let fullRebuildCalled = false;
  const original = chunk._initArrayStorageFromBlockData.bind(chunk);
  chunk._initArrayStorageFromBlockData = () => {
    fullRebuildCalled = true;
    original();
  };

  // 追加实心方块
  const appended = chunk.appendScatteredBlocks(
    [{ x: 5, y: 2, z: 5, type: 'dirt', orientation: 0 }],
    new Set([Chunk.encodeCoord(5, 2, 5)]),
    [],
    { deferConsolidation: true }
  );

  assertEqual(appended, 1, '应追加 1 个方块');
  assertFalse(fullRebuildCalled, '不应调用全量 _initArrayStorageFromBlockData');

  // 行为断言：新方块已写入 blockDataArray
  const newIndex = (2 << 8) | (5 << 4) | 5;
  assertTrue(chunk.blockDataArray[newIndex] > 0, '新方块应有 blockId');

  // 行为断言：旧方块未被破坏
  assertEqual(chunk.blockDataArray[baseIndex], baseBlockId, '预填充方块 blockId 不应被清除');

  // 行为断言：solidBlockIds 包含实心方块
  const newBlockId = chunk.blockDataArray[newIndex];
  assertTrue(chunk.solidBlockIds.has(newBlockId), '实心方块应加入 solidBlockIds');

  teardownEnvironment();
});

test('appendScatteredBlocks - 追加非实心方块不应加入 solidBlockIds', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);
  chunk._initArrayStorageFromBlockData();

  // 追加非实心方块（glass_block 在 test-mocks 中定义为非 solid）
  chunk.appendScatteredBlocks(
    [{ x: 3, y: 1, z: 3, type: 'glass_block', orientation: 0 }],
    new Set([Chunk.encodeCoord(3, 1, 3)]),
    [],
    { deferConsolidation: true }
  );

  const blockIndex = (1 << 8) | (3 << 4) | 3;
  const blockId = chunk.blockDataArray[blockIndex];
  assertTrue(blockId > 0, '非实心方块也应有 blockId');
  assertFalse(chunk.solidBlockIds.has(blockId), '非实心方块不应加入 solidBlockIds');

  teardownEnvironment();
});

test('appendScatteredBlocks - 带 orientation 方块应正确写入 blockDataArray', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);
  chunk._initArrayStorageFromBlockData();

  chunk.appendScatteredBlocks(
    [{ x: 7, y: 3, z: 7, type: 'wood', orientation: 2 }],
    new Set([Chunk.encodeCoord(7, 3, 7)]),
    [],
    { deferConsolidation: true }
  );

  const blockIndex = (3 << 8) | (7 << 4) | 7;
  const blockId = chunk.blockDataArray[blockIndex];
  assertTrue(blockId > 0, '带 orientation 方块应有 blockId');

  // 验证 palette 中存储了完整 entry（含 orientation）
  const entry = chunk.blockPalette.get(blockId);
  assertTrue(typeof entry === 'object' && entry.orientation === 2,
    'palette 应保留 orientation 信息');

  teardownEnvironment();
});

test('appendScatteredBlocks - 通过 authority store 路径追加方块后 blockDataArray 与 store slice 一致', () => {
  setupEnvironment();

  // WorldBlockDataStore 已在文件顶部 import
  const store = new WorldBlockDataStore();

  const world = createMockWorld();
  world.worldBlockDataStore = store;
  const chunk = new Chunk(0, 0, world);

  // attach authority slice — 使用 ensureChunkSlice 获取或创建 slice
  store.replaceChunkSlice(0, 0, new Map(), 'test-setup');
  chunk.blockData = store.ensureChunkSlice(0, 0);
  chunk._initArrayStorageFromBlockData();

  // spy 全量重建
  let fullRebuildCalled = false;
  chunk._initArrayStorageFromBlockData = () => { fullRebuildCalled = true; };

  chunk.appendScatteredBlocks(
    [{ x: 4, y: 2, z: 4, type: 'stone', orientation: 0 }],
    new Set([Chunk.encodeCoord(4, 2, 4)]),
    [],
    { deferConsolidation: true }
  );

  assertFalse(fullRebuildCalled, 'authority store 路径也不应触发全量重建');

  // store slice 应已包含新方块
  const code = Chunk.encodeCoord(4, 2, 4);
  assertTrue(chunk.blockData.has(code), 'authority store slice 应包含追加的方块');

  // blockDataArray 应与 slice 一致
  const blockIndex = (2 << 8) | (4 << 4) | 4;
  assertTrue(chunk.blockDataArray[blockIndex] > 0, 'blockDataArray 应已更新');

  teardownEnvironment();
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `fullRebuildCalled` 为 true

- [ ] **Step 3: 实现 — 替换全量重建为增量更新**

> **导入确认**：`parseBlockEntry` 已在 `Chunk.js:14` 从 `OrientationUtils.js` 导入，无需额外添加。

在 `src/world/Chunk.js:3967-3968`，将：

```javascript
    this.dirtyBlocks += appendedCount;
    this._initArrayStorageFromBlockData();
```

替换为：

```javascript
    this.dirtyBlocks += appendedCount;
    for (const [code] of patches) {
      const actualEntry = this.blockData.get(code);
      if (!actualEntry) continue;
      const parsed = parseBlockEntry(actualEntry);
      const type = parsed.type;
      if (!type || type === 'air') continue;
      const { x, y, z } = Chunk.decodeCoord(code);
      const lx = x - this.cx * CHUNK_SIZE;
      const ly = y - this.worldY;
      const lz = z - this.cz * CHUNK_SIZE;
      if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
      const blockIndex = (ly << 8) | (lz << 4) | lx;
      const blockId = this._getOrCreateBlockId(actualEntry);
      this.blockDataArray[blockIndex] = blockId;
      const props = getBlockProps(type);
      if (props.isSolid) this.solidBlockIds.add(blockId);
    }
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `node command/run-tests.js`
Expected: PASS

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: 无新增警告

---

### Task 5: M6 — `_applyConsolidateResult` 去除多余 `_initArrayStorageFromBlockData`

**Files:**
- Test: `src/tests/test-chunk.js`
- Modify: `src/world/Chunk.js:1549-1574` (`_updateBlockState` solidBlockIds 修复)
- Modify: `src/world/Chunk.js:2624-2631` (`_registerSpecialEntityCollision` 同一 solidBlockIds 共享 id bug)
- Modify: `src/world/ChunkConsolidation.js:460-461`

**前置修复**：`_updateBlockState` 中 `solidBlockIds.delete(oldId)` 存在共享 id 误删 bug — 同一 blockId 可能被多个同类型方块共享，删除一块会将共享 id 从 solidBlockIds 移除。当前 consolidation 的全量重建掩盖了此 bug，M6 移除重建后会暴露。

- [ ] **Step 0.1: 写失败测试 — 两块同类型方块删其一后另一块仍 solid**

```javascript
test('_updateBlockState - 两块同类型方块共享 blockId，删除其中一块后另一块仍应在 solidBlockIds 中', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);

  // 放置两块 stone（共享同一 blockId）
  const code1 = Chunk.encodeCoord(5, 1, 5);
  const code2 = Chunk.encodeCoord(6, 1, 6);
  chunk.blockData.set(code1, 'stone');
  chunk.blockData.set(code2, 'stone');
  chunk._initArrayStorageFromBlockData();

  const idx1 = (1 << 8) | (5 << 4) | 5;
  const idx2 = (1 << 8) | (6 << 4) | 6;
  const stoneBlockId = chunk.blockDataArray[idx1];
  assertTrue(stoneBlockId > 0, 'stone 应有 blockId');
  assertEqual(chunk.blockDataArray[idx2], stoneBlockId, '两块 stone 应共享同一 blockId');
  assertTrue(chunk.solidBlockIds.has(stoneBlockId), 'stone blockId 应在 solidBlockIds 中');

  // 删除第一块 stone（设为 air）
  chunk.blockData.set(code1, 'air');
  chunk._updateBlockState(5, 1, 5, 'air', 'air');

  // 另一块 stone 仍在，其 blockId 应仍在 solidBlockIds 中
  assertTrue(chunk.solidBlockIds.has(stoneBlockId),
    '删除共享 blockId 的一块后，另一块仍存在，solidBlockIds 不应移除该 id');

  teardownEnvironment();
});
```

在同一测试文件中再添加两个替换场景测试：

```javascript
test('_updateBlockState - 两块同类型方块共享 blockId，替换其中一块为其他类型，另一块仍 solid', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);

  // 放置两块 stone（共享同一 blockId）
  const code1 = Chunk.encodeCoord(5, 1, 5);
  const code2 = Chunk.encodeCoord(6, 1, 6);
  chunk.blockData.set(code1, 'stone');
  chunk.blockData.set(code2, 'stone');
  chunk._initArrayStorageFromBlockData();

  const idx1 = (1 << 8) | (5 << 4) | 5;
  const stoneBlockId = chunk.blockDataArray[idx1];
  assertTrue(stoneBlockId > 0, 'stone 应有 blockId');
  assertTrue(chunk.solidBlockIds.has(stoneBlockId), 'stone blockId 应在 solidBlockIds 中');

  // 替换第一块 stone 为 glass_block（非实心）
  chunk.blockData.set(code1, 'glass_block');
  chunk._updateBlockState(5, 1, 5, 'glass_block', 'glass_block');

  // 另一块 stone 仍在，其 blockId 应仍在 solidBlockIds 中
  assertTrue(chunk.solidBlockIds.has(stoneBlockId),
    '替换共享 blockId 的一块后，另一块仍存在，solidBlockIds 不应移除该 id');

  teardownEnvironment();
});

test('_updateBlockState - 替换唯一一块方块后旧 blockId 应从 solidBlockIds 中移除（回归）', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);

  // 放置一块 stone
  const code1 = Chunk.encodeCoord(5, 1, 5);
  chunk.blockData.set(code1, 'stone');
  chunk._initArrayStorageFromBlockData();

  const stoneBlockId = chunk.blockDataArray[(1 << 8) | (5 << 4) | 5];
  assertTrue(stoneBlockId > 0, 'stone 应有 blockId');
  assertTrue(chunk.solidBlockIds.has(stoneBlockId), 'stone blockId 应在 solidBlockIds 中');

  // 替换成 glass_block（非实心）
  chunk.blockData.set(code1, 'glass_block');
  chunk._updateBlockState(5, 1, 5, 'glass_block', 'glass_block');

  // stone blockId 不再被任何位置引用，应从 solidBlockIds 移除
  assertTrue(!chunk.solidBlockIds.has(stoneBlockId),
    '替换后旧 stone blockId 不应继续留在 solidBlockIds 中');

  teardownEnvironment();
});
```

在同一测试文件中再添加 `_registerSpecialEntityCollision` 的共享 id 测试（通过生产代码路径触发 bug）：

```javascript
test('_registerSpecialEntityCollision - 实体占位覆盖方块后，其他同类型方块的 blockId 仍应在 solidBlockIds 中', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);

  // 放置两块 stone
  const code1 = Chunk.encodeCoord(5, 1, 5);
  const code2 = Chunk.encodeCoord(6, 1, 6);
  chunk.blockData.set(code1, 'stone');
  chunk.blockData.set(code2, 'stone');
  chunk._initArrayStorageFromBlockData();

  const stoneBlockId = chunk.blockDataArray[(1 << 8) | (5 << 4) | 5];
  assertTrue(stoneBlockId > 0, 'stone 应有 blockId');
  assertTrue(chunk.solidBlockIds.has(stoneBlockId), 'stone blockId 应在 solidBlockIds 中');

  // 通过生产代码路径注册实体碰撞，覆盖 (5,1,5) 位置的 stone
  chunk._registerSpecialEntityCollision('modGunMan', { id: 'test-entity', x: 5, y: 1, z: 5 });

  // 另一块 stone 仍在，其 blockId 应仍在 solidBlockIds 中
  assertTrue(chunk.solidBlockIds.has(stoneBlockId),
    '_registerSpecialEntityCollision 覆盖一块后，另一块同类型的 blockId 不应被误删');

  teardownEnvironment();
});
```

- [ ] **Step 0.2: 运行测试，预期失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — 3 个测试飘红：(1) 删除共享 id：buggy 代码无 includes 检查，误删仍被引用的 id；(2) 替换共享 id：buggy 代码无 includes 检查，替换一块后另一块的共享 id 被误删；(3) 实体碰撞注册：`_registerSpecialEntityCollision` 直接 delete 不检查引用。单块替换回归测试在 buggy 代码上行为恰好正确，会通过

- [ ] **Step 0.3: 修复 — _updateBlockState 和 _registerSpecialEntityCollision 中 solidBlockIds.delete 加引用检查**

**修复 1**：在 `src/world/Chunk.js:1550-1564`，将 `solidBlockIds.delete(oldId)` 改为扫描确认该 id 不再被其他位置使用后才 delete。

完整替换 `src/world/Chunk.js:1549-1574`（`if (blockIndex >= 0) {` 到对应的 `}`）：

```javascript
    if (blockIndex >= 0) {
      if (type === 'air') {
        // 清空数组位置
        const oldId = this.blockDataArray[blockIndex];
        if (oldId !== 0) {
          this.blockDataArray[blockIndex] = 0;
          // 仅当该 blockId 不再被任何其他位置引用时才从 solidBlockIds 移除
          if (!this.blockDataArray.includes(oldId)) {
            this.solidBlockIds.delete(oldId);
          }
        }
      } else {
        // 获取或创建 blockId
        const blockId = this._getOrCreateBlockId(entry);
        const oldId = this.blockDataArray[blockIndex];
        // 先写入新 id，再检查旧 id 是否还被引用
        // （必须先写，否则 includes(oldId) 会命中当前位置，永远返回 true）
        this.blockDataArray[blockIndex] = blockId;
        if (oldId !== 0 && oldId !== blockId) {
          // 仅当旧 blockId 不再被任何其他位置引用时才从 solidBlockIds 移除
          if (!this.blockDataArray.includes(oldId)) {
            this.solidBlockIds.delete(oldId);
          }
        }
        // 如果是实心方块，加入 solid set
        if (props.isSolid) {
          this.solidBlockIds.add(blockId);
        } else {
          this.solidBlockIds.delete(blockId);
        }
      }
    }
```

> **注意**：`blockDataArray.includes(oldId)` 对 4096 元素的 Uint32Array 是 O(4096) 扫描，但 `_updateBlockState` 只在单方块放置/删除时调用，不在批量路径中，开销可接受。如果后续性能分析发现瓶颈，可改为 refcount Map。

**修复 2**：在 `src/world/Chunk.js:2626-2629`（`_registerSpecialEntityCollision`），将：

```javascript
        const oldBlockId = this.blockDataArray[blockIndex];
        if (oldBlockId !== 0) {
          this.blockDataArray[blockIndex] = 0;
          this.solidBlockIds.delete(oldBlockId);
        }
```

改为：

```javascript
        const oldBlockId = this.blockDataArray[blockIndex];
        if (oldBlockId !== 0) {
          this.blockDataArray[blockIndex] = 0;
          if (!this.blockDataArray.includes(oldBlockId)) {
            this.solidBlockIds.delete(oldBlockId);
          }
        }
```

- [ ] **Step 0.4: 运行测试，验证通过**

Run: `node command/run-tests.js`
Expected: PASS

- [ ] **Step 1: 写失败测试 — consolidation 不触发全量重建 + 行为一致性**

在 `src/tests/test-chunk.js` 中添加测试（在 "_applyConsolidateResult" 测试分组附近）：

```javascript
test('_applyConsolidateResult - 不应调用 _initArrayStorageFromBlockData 且数据保持一致', () => {
  setupEnvironment();

  const world = createMockWorld();
  const chunk = new Chunk(0, 0, world);

  // 预填充方块并初始化 blockDataArray
  const code1 = Chunk.encodeCoord(5, 1, 5);
  const code2 = Chunk.encodeCoord(6, 2, 6);
  chunk.blockData.set(code1, 'stone');
  chunk.blockData.set(code2, 'dirt');
  chunk._initArrayStorageFromBlockData();
  chunk.solidBlocks.add(code1);
  chunk.solidBlocks.add(code2);
  chunk.visibleKeys.add(code1);
  chunk.visibleKeys.add(code2);

  // 记录 consolidation 前的 blockDataArray 值
  const idx1 = (1 << 8) | (5 << 4) | 5;
  const idx2 = (2 << 8) | (6 << 4) | 6;
  const preBlockId1 = chunk.blockDataArray[idx1];
  const preBlockId2 = chunk.blockDataArray[idx2];
  assertTrue(preBlockId1 > 0, 'stone 应有 blockId');
  assertTrue(preBlockId2 > 0, 'dirt 应有 blockId');

  // spy 全量重建
  let fullRebuildCalled = false;
  chunk._initArrayStorageFromBlockData = () => {
    fullRebuildCalled = true;
  };

  // 模拟 consolidation 回包
  chunk.isConsolidating = true;
  chunk.dirtyBlocks = 1;
  chunk._applyConsolidateResult(
    {
      scatteredBlocks: [
        { x: 5, y: 1, z: 5, type: 'stone', orientation: 0 },
        { x: 6, y: 2, z: 6, type: 'dirt', orientation: 0 }
      ],
      meshData: [],
      visibleKeys: ['5,1,5', '6,2,6'],
      solidBlocks: ['5,1,5', '6,2,6'],
      structureCenters: []
    },
    1,
    new Set()
  );

  assertFalse(fullRebuildCalled, 'consolidation 不改 authority，不应触发全量 _initArrayStorageFromBlockData');

  // 行为断言：blockDataArray 未被清零（因为没有调用全量重建，值应保持）
  assertEqual(chunk.blockDataArray[idx1], preBlockId1, 'consolidation 后 stone 的 blockId 应保持');
  assertEqual(chunk.blockDataArray[idx2], preBlockId2, 'consolidation 后 dirt 的 blockId 应保持');

  teardownEnvironment();
});
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `node command/run-tests.js --verbose`
Expected: FAIL — `fullRebuildCalled` 为 true，且 blockDataArray 被全量重建的 spy 清零

- [ ] **Step 3: 实现 — 删除多余的 _initArrayStorageFromBlockData 调用**

在 `src/world/ChunkConsolidation.js:460-461`，删除：

```javascript
    // 重建数组存储，确保 blockDataArray 与 blockData 权威源同步
    this._initArrayStorageFromBlockData();
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `node command/run-tests.js`
Expected: PASS

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: 无新增警告

---

### Task 6: 全量回归验证

**Files:** 无新增文件

- [ ] **Step 1: 运行全部测试**

Run: `node command/run-tests.js --verbose`
Expected: 全部 PASS

- [ ] **Step 2: 运行 lint 检查**

Run: `npm run lint`
Expected: 无新增警告

- [ ] **Step 3: 手动验证清单**

启动开发服务器 `npm run start`，在浏览器中验证以下场景：

1. 放置方块 → 离开 chunk → 返回 → 方块仍在
2. 跨 chunk 结构（树、建筑）生成正确，无缺失
3. AO 阴影正常渲染，无回退到中性值
4. 碰撞检测正常，不穿模
5. 持续奔跑 1-2 分钟，观察是否有渲染异常
6. 静态树附近 chunk 加载优先级正确（boost 生效）
