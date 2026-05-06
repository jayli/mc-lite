# Chunk-Level Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单 chunk 读取热路径从 “主线程拉取整包 RegionRecord 再裁剪” 改为 “PersistenceWorker 内裁剪后只返回目标 ChunkRecord”，显著降低 `postMessage` 传输体积，并保持运行时写回链路与数据一致性不退化。

**Architecture:** PersistenceWorker 维护 Worker 侧 `regionCache`，`getChunkRecord` 在 Worker 内命中缓存或读取一次完整 region 后，只返回目标 chunk。WorldStore 的 `getChunkRecord` 改为直接调用 Worker action。WorldRuntime 的 `ensureChunkData` 改为直接读取 chunk，但仍需把读到的 chunk 注入运行时 `_regionCache`，以维持现有 flush/unload 回退逻辑所需的最小基线数据。

**Tech Stack:** JavaScript, IndexedDB, Web Workers, postMessage

---

## 设计约束

### 本次优化范围

- 只优化**单 chunk 加载热路径**：
  - `WorldRuntime.ensureChunkData()`
  - `WorldStore.getChunkRecord()`
  - `PersistenceWorker.getChunkRecord()`
- 保留现有 region 级 API：
  - `getRegionRecord()`
  - `ensureRegion()`
  - `prefetchRegions()`
  - `getChunkRecordsInRegion()`
- 这些 region 级路径本次不是优化目标，允许继续传输整包 region。

### 非目标

- 不改变 IndexedDB 的物理存储粒度，仍以 `RegionRecord` 为落盘单位。
- 不重构 `WorldRuntime` 的 flush / unload 架构。
- 不把主线程 `_regionCache` 改造成新的通用 chunk cache 系统，只补足当前写回链路依赖的最小基线数据。

### 正确性要求

- Worker 侧新增缓存后，所有 Worker 内写路径都必须同步更新或失效缓存，不能出现读到旧 region 的情况。
- `WorldRuntime.ensureChunkData()` 改走 chunk 读取后，后续 `_getCachedChunkRecord()`、`_resolveStaticEntities()`、`_resolveRuntimeSeedData()`、`flushBeforeUnload()` 不得因拿不到基线数据而退化。
- 新语义下，`ensureChunkData()` 对 “region 不存在” 和 “chunk 不存在” 统一返回 `missing-chunk`。

### Worker Cache 语义

- `regionCache` 使用 `Map` 实现 LRU。
- **命中时必须刷新新鲜度**：`delete(regionKey)` 后 `set(regionKey, region)`。
- **新增/写入时也要刷新顺序**。
- 淘汰规则：超过 `REGION_CACHE_MAX_SIZE` 时，删除 `Map.keys().next().value`。
- `clearWorld()` 后必须清空 `regionCache`。

### WorldRuntime 运行时缓存语义

- `_regionCache` 允许保存**部分 region**。
- 部分 region 仅表示“当前已读取/已写回过的 chunk 子集”，不能再隐含“这个 region 已完整加载”。
- `ensureChunkData()` 读取到 `chunkRecord` 后，必须把它写入 `_regionCache` 对应 region 的 `chunks[chunkKey]`，并维护 `chunkKeys`，供后续 flush/unload 回退逻辑使用。
- `ensureRegion()` 仍然返回完整 region；两种来源可共存，后写入者覆盖同 chunk key。

---

## 文件变更概览

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `src/workers/PersistenceWorker.js` | 修改 | 添加 Worker 侧 `regionCache`、LRU 工具函数、`getChunkRecord`、写路径缓存同步 |
| `src/world/WorldStore.js` | 修改 | 将 `getChunkRecord` 改为直接调用 Worker action |
| `src/world/WorldRuntime.js` | 修改 | 将 `ensureChunkData` 改为 chunk 级读取，并把返回结果注入运行时 `_regionCache` |
| `src/tests/test-world-runtime.js` | 修改 | 更新 `ensureChunkData` 相关测试，改 mock `getChunkRecord`，校验运行时缓存注入 |

---

## 实施顺序

1. 先改 Worker 侧 API 和缓存一致性。
2. 再改 `WorldStore.getChunkRecord()` 读路径。
3. 再改 `WorldRuntime.ensureChunkData()`，确保最小运行时基线缓存仍成立。
4. 最后更新测试与验证。

---

### Task 1: PersistenceWorker — 实现 Worker 侧 regionCache 与 chunk 级读取

**Files:**
- Modify: `src/workers/PersistenceWorker.js`

- [ ] **Step 1: 在常量区新增 Worker 侧 regionCache 与容量配置**

在 `WORLD_OVERFLOW_STORE` 后添加：

```js
// Worker 侧 RegionRecord 缓存：避免重复 IndexedDB 读取
const regionCache = new Map(); // regionKey -> regionRecord
const REGION_CACHE_MAX_SIZE = 6;
```

- [ ] **Step 2: 添加 LRU 辅助函数**

在 `getRegionRecord` 附近新增以下辅助函数：

```js
function touchRegionCache(regionKey, region) {
  if (!regionKey || !region) return;
  if (regionCache.has(regionKey)) {
    regionCache.delete(regionKey);
  }
  regionCache.set(regionKey, region);
  while (regionCache.size > REGION_CACHE_MAX_SIZE) {
    const oldestKey = regionCache.keys().next().value;
    regionCache.delete(oldestKey);
  }
}

function getCachedRegion(regionKey) {
  const region = regionCache.get(regionKey);
  if (!region) return null;
  touchRegionCache(regionKey, region);
  return region;
}

function clearRegionCache() {
  regionCache.clear();
}
```

- [ ] **Step 3: 新增 getChunkRecord，在 Worker 内裁剪单个 chunk**

在 `getRegionRecord` 后新增：

```js
/**
 * 读取单个 ChunkRecord。
 * 命中 Worker 缓存时直接裁剪，未命中时读取完整 RegionRecord 后缓存。
 * @param {string} regionKey
 * @param {string} chunkKey
 * @param {number} cx
 * @param {number} cz
 * @returns {Promise<object|null>}
 */
async function getChunkRecord(regionKey, chunkKey, cx, cz) {
  let region = getCachedRegion(regionKey);
  if (!region) {
    region = await getRegionRecord(regionKey);
    if (!region) return null;
    touchRegionCache(regionKey, region);
  }

  const chunkData = region.chunks?.[chunkKey];
  if (!chunkData) return null;

  return {
    cx,
    cz,
    blockData: chunkData.blockData || {},
    staticEntities: chunkData.staticEntities || [],
    runtimeSeedData: chunkData.runtimeSeedData || {},
    runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] }
  };
}
```

- [ ] **Step 4: 在 saveRegionRecord 写路径同步更新 Worker cache**

将 `saveRegionRecord` 改为在 `store.put(...)` 成功后调用 `touchRegionCache(regionKey, record)`。如果实现形式不方便在 `performTransaction` 内回调，也可以在 `await` 完成后更新缓存，但必须保证写成功后 cache 与 DB 同步。

预期结构：

```js
async function saveRegionRecord(regionKey, record) {
  await performTransaction(...);
  touchRegionCache(regionKey, record);
}
```

- [ ] **Step 5: 在 applyRegionPatch 写路径同步更新 Worker cache**

`applyRegionPatch()` 在合并 patch 后、保存前后都应保持与缓存一致。最简单实现：

1. 先优先从 `getCachedRegion(regionKey)` 取 region；
2. miss 再 `getRegionRecord(regionKey)`；
3. 应用 patch；
4. `await saveRegionRecord(regionKey, region)`；
5. 依赖 `saveRegionRecord()` 内的 `touchRegionCache()` 完成缓存刷新。

这样避免 patch 场景下读旧 region。

- [ ] **Step 6: 在 saveRegionRecordsBatch 批量写路径同步更新 Worker cache**

批量写成功后，遍历 `records` 调用：

```js
for (const { regionKey, record } of records) {
  touchRegionCache(regionKey, record);
}
```

- [ ] **Step 7: 在 clearWorld 清空 Worker cache**

`clearWorld()` 事务完成后调用：

```js
clearRegionCache();
```

- [ ] **Step 8: 在消息分发中新增 getChunkRecord action**

在 `self.onmessage` 的 switch 中添加：

```js
case 'getChunkRecord':
  result = await getChunkRecord(payload.regionKey, payload.chunkKey, payload.cx, payload.cz);
  break;
```

- [ ] **Step 9: 运行 lint 验证 Worker 改动**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 2: WorldStore — 改为直接调用 Worker 的 getChunkRecord

**Files:**
- Modify: `src/world/WorldStore.js`

- [ ] **Step 1: 替换 getChunkRecord 的实现**

将当前 `getChunkRecord()` 从“读取整包 region 后本地裁剪”改为：

```js
/**
 * 读取单个 ChunkRecord（Worker 侧裁剪，仅传输目标 chunk）
 * @param {number} cx
 * @param {number} cz
 * @returns {Promise<object|null>}
 */
async getChunkRecord(cx, cz) {
  const { rx, rz } = this.chunkToRegion(cx, cz);
  const regionKey = this.regionKey(rx, rz);
  const chunkKey = this.chunkKey(cx, cz);
  return getPersistenceService().postMessage('getChunkRecord', {
    regionKey,
    chunkKey,
    cx,
    cz
  });
}
```

- [ ] **Step 2: 保留 getRegionRecord / getChunkRecordsInRegion 不变，并更新注释**

将 `ChunkRecord 投影读取（通过 RegionRecord）` 相关注释改成更精确表述：

- `getChunkRecord()`：走 Worker 侧裁剪
- `getChunkRecordsInRegion()`：仍通过整包 region 读取后本地裁剪

避免文档和代码注释继续误导后续实现者。

- [ ] **Step 3: 运行 lint 验证 WorldStore 改动**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 3: WorldRuntime — 改为 chunk 级读取，并维护最小运行时基线缓存

**Files:**
- Modify: `src/world/WorldRuntime.js`

- [ ] **Step 1: 新增辅助方法，将单个 chunk 注入运行时 _regionCache**

在 `ensureChunkData()` 附近新增一个私有辅助方法，例如：

```js
_upsertRegionCacheChunkRecord(cx, cz, chunkRecord) {
  const { rx, rz } = this._chunkToRegion(cx, cz);
  const regionKey = this._regionKey(rx, rz);
  const existingRegion = this._regionCache.get(regionKey) || {
    regionKey,
    rx,
    rz,
    chunkKeys: [],
    chunks: {}
  };

  if (!existingRegion.chunks) existingRegion.chunks = {};
  if (!Array.isArray(existingRegion.chunkKeys)) existingRegion.chunkKeys = [];

  const chunkKey = this._chunkKey(cx, cz);
  existingRegion.chunks[chunkKey] = chunkRecord;
  if (!existingRegion.chunkKeys.includes(chunkKey)) {
    existingRegion.chunkKeys.push(chunkKey);
  }

  this._regionCache.set(regionKey, existingRegion);
}
```

说明：

- 该方法允许 `_regionCache` 保存部分 region。
- 不要求补齐 `generatedAt` / `generatorVersion`，因为这里的目标只是给后续 flush/unload 提供 chunk 基线。

- [ ] **Step 2: 替换 ensureChunkData 为 chunk 级读取**

将现有 `ensureChunkData()` 替换为：

```js
/**
 * 确保 chunk 数据已加载到内存
 * 通过 Worker 侧 getChunkRecord 读取，仅传输目标 chunk 数据
 *
 * @param {number} cx
 * @param {number} cz
 * @returns {Promise<object>} { status, chunkRecord? }
 */
async ensureChunkData(cx, cz) {
  const chunkRecord = await this._worldStore.getChunkRecord(cx, cz);

  if (!chunkRecord) {
    return { status: 'missing-chunk' };
  }

  // 渐进式迁移：如果 chunk record 中不含 runtimeEntities，通过 WorldStore 读取旧档
  if (!chunkRecord.runtimeEntities) {
    await this._hydrateLegacyRuntimeEntities(cx, cz, chunkRecord);
  }

  this._upsertRegionCacheChunkRecord(cx, cz, chunkRecord);

  return {
    status: 'ready',
    chunkRecord
  };
}
```

- [ ] **Step 3: 不修改 ensureRegion / prefetchRegions，但补注释说明职责边界**

在 `ensureRegion()` 或相邻注释处补充说明：

- `ensureChunkData()` 已改为 chunk 级热路径
- `ensureRegion()` 仍服务于 region 级预取/完整缓存场景
- `_regionCache` 可能同时包含完整 region 与部分 region

- [ ] **Step 4: 校验 _hydrateLegacyRuntimeEntities 回填后仍会更新运行时缓存**

当前 `_hydrateLegacyRuntimeEntities()` 内部已经调用 `_updateRegionCacheChunkRecord()`。确认在 `ensureChunkData()` 尾部再次执行 `_upsertRegionCacheChunkRecord()` 时不会破坏回填结果；如果会重复覆盖，则以“最终 chunkRecord”为准。

- [ ] **Step 5: 运行 lint 验证 WorldRuntime 改动**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 4: 更新 WorldRuntime 测试，覆盖新语义与运行时缓存注入

**Files:**
- Modify: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 将 ensureChunkData 的读取 mock 从 getRegionRecord 改为 getChunkRecord**

更新前 5 个 `ensureChunkData` 测试用例：

- `missing-region` 改为 `missing-chunk`
- 删除“region 存在但 chunk 不存在”的独立语义区分，改为 `getChunkRecord() -> null`
- 所有成功读取场景都改为 mock `getChunkRecord()`

- [ ] **Step 2: 更新第一个测试，统一缺失语义**

目标用例：

```js
test('ensureChunkData - region 或 chunk 缺失时返回 missing-chunk', async () => {
  const originalWorldStore = globalThis._worldStore;
  globalThis._worldStore = {
    getChunkRecord: async () => null
  };

  const runtime = new WorldRuntime();
  const result = await runtime.ensureChunkData(0, 0);

  assertEqual(result.status, 'missing-chunk', '缺失时应统一返回 missing-chunk');
  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 3: 更新 chunk 存在测试，并断言运行时 _regionCache 已注入最小基线**

在成功用例中补充断言：

```js
const cachedRegion = runtime._regionCache.get('0,0');
assertTrue(!!cachedRegion, '读取 chunk 后应向运行时 region cache 注入最小基线');
assertDeepEqual(cachedRegion.chunks['0,0'].blockData, chunkRecord.blockData, '缓存中的 chunkRecord 应与读取结果一致');
```

- [ ] **Step 4: 更新旧档迁移测试，继续校验回填写回**

保持以下断言：

- `getLegacyChunkDelta()` 被调用
- `commitChunkRecord()` 被调用一次
- `result.chunkRecord.runtimeEntities` 为迁移结果

并新增断言：

- `_regionCache` 中该 chunk 的 `runtimeEntities` 也是迁移后的值

- [ ] **Step 5: 更新“无旧档时补空结构”测试**

保持以下断言：

- 返回 `ready`
- `runtimeEntities` 为三类空数组结构
- 不发生回写

并新增断言：

- `_regionCache` 中该 chunk 也有补齐后的空 `runtimeEntities`

- [ ] **Step 6: 更新 flushBeforeUnload 相关测试中的 worldStore mock**

把依赖 `getRegionRecord` 的相关 mock 改为 `getChunkRecord` 或 `null`，避免旧接口假设留在测试里。

- [ ] **Step 7: 运行浏览器测试页验证 WorldRuntime 测试**

Run: `npm run start`
Expected: 本地静态服务器启动在 `http://localhost:8080`

Run: 在浏览器打开 `http://localhost:8080/src/tests/index.html` 并点击“运行所有测试”
Expected: `WorldRuntime` 相关测试通过，无新增失败

- [ ] **Step 8: 运行 lint**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 5: 回归检查与性能验收

**Files:**
- Modify: 无

- [ ] **Step 1: 手工检查旁路未被误改**

确认以下接口仍保持原行为：

- `WorldStore.getRegionRecord()`
- `WorldStore.getChunkRecordsInRegion()`
- `WorldRuntime.ensureRegion()`
- `WorldRuntime.prefetchRegions()`

预期：本次只优化单 chunk 热路径，不顺手改动 region 级预取与批量读取。

- [ ] **Step 2: 通过日志或断点确认热路径已改为 getChunkRecord**

在一次典型 chunk 加载过程中确认：

- 主线程调用的是 `postMessage('getChunkRecord', ...)`
- 不再为单 chunk 读取发送整包 `getRegionRecord`

Expected: 热路径消息 action 为 `getChunkRecord`

- [ ] **Step 3: 记录验收结论**

在任务说明或提交描述中明确记录：

- 首次触达某个 region 时，Worker 仍可能读取一次完整 RegionRecord
- 但主线程收到的消息体已缩小为单个 ChunkRecord
- 同 region 后续 chunk 读取将命中 Worker cache，避免重复 DB I/O 与大包跨线程传输

---

### Task 6: 最终验证

- [ ] **Step 1: 启动本地服务器**

Run: `npm run start`
Expected: 静态服务器启动成功

- [ ] **Step 2: 运行浏览器测试**

Run: 打开 `http://localhost:8080/src/tests/index.html`，点击“运行所有测试”
Expected: 所有测试通过

- [ ] **Step 3: 运行 lint**

Run: `npm run lint`
Expected: 无新增错误

- [ ] **Step 4: 审查 git diff**

Run: `git diff -- src/workers/PersistenceWorker.js src/world/WorldStore.js src/world/WorldRuntime.js src/tests/test-world-runtime.js`
Expected: 仅包含本计划预期改动；无不相关文件被修改

---

## 实施提示

- `WorldRuntime._regionCache` 的“部分 region”语义是这次改造最容易被误删的约束，修改相关代码时必须保留。
- 不要顺手把 `getChunkRecordsInRegion()` 也改成多次 `getChunkRecord()`，这会改变它的性能特征和调用契约，不在本次范围内。
- `applyRegionPatch()` 已经是 Worker 内写路径，本次应复用它的方向，而不是把更多整包 region 再拉回主线程。
