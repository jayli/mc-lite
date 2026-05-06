# Chunk-Level Read Path 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 chunk 读取路径从 region 级（9MB 传输）改为 chunk 级（100KB 传输），在 PersistenceWorker 侧实现 region 缓存和裁剪。

**Architecture:** 在 PersistenceWorker 内添加 LRU region 缓存（max 6），新增 `getChunkRecord` action 直接在 Worker 内裁剪单个 chunk 数据返回。WorldStore 的 `getChunkRecord` 改为直接调用 Worker action，不再调用 `getRegionRecord`。WorldRuntime 的 `ensureChunkData` 简化为调用 `getChunkRecord` 而非 `ensureRegion`。

**Tech Stack:** JavaScript, IndexedDB, Web Workers, postMessage

---

## 文件变更概览

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `src/workers/PersistenceWorker.js` | 修改 | 添加 regionCache LRU Map、getChunkRecord 函数、新 postMessage action |
| `src/world/WorldStore.js` | 修改 | 替换 getChunkRecord 实现为直接调用 Worker action |
| `src/world/WorldRuntime.js` | 修改 | 简化 ensureChunkData 调用 getChunkRecord 替代 ensureRegion |
| `src/tests/test-world-runtime.js` | 修改 | 更新测试 mock 从 getRegionRecord 改为 getChunkRecord |

---

### Task 1: PersistenceWorker — 添加 regionCache 和 getChunkRecord

**Files:**
- Modify: `src/workers/PersistenceWorker.js`

- [ ] **Step 1: 添加 regionCache 和 LRU 配置常量**

在 `WORLD_OVERFLOW_STORE` 常量之后添加：

```js
// Region 缓存：Worker 侧 LRU 缓存，避免重复读取 IndexedDB
const regionCache = new Map(); // regionKey → regionData
const REGION_CACHE_MAX_SIZE = 6; // 保持 6 个 region（~54MB），覆盖玩家渲染距离 + 边界过渡
```

- [ ] **Step 2: 添加 getChunkRecord 函数**

在 `getRegionRecord` 函数之后添加：

```js
/**
 * 从 Worker 侧 region 缓存中裁剪出单个 chunk 数据
 * 缓存未命中时从 IndexedDB 读取并缓存
 * @param {string} regionKey - "rx,rz"
 * @param {string} chunkKey - "cx,cz"
 * @param {number} cx
 * @param {number} cz
 * @returns {Promise<object|null>}
 */
async function getChunkRecord(regionKey, chunkKey, cx, cz) {
  let region = regionCache.get(regionKey);
  if (!region) {
    region = await getRegionRecord(regionKey);
    if (region) {
      regionCache.set(regionKey, region);
      // LRU 淘汰：移除最旧的条目
      while (regionCache.size > REGION_CACHE_MAX_SIZE) {
        const firstKey = regionCache.keys().next().value;
        regionCache.delete(firstKey);
      }
    } else {
      return null;
    }
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

- [ ] **Step 3: 添加 postMessage action handler**

在 `self.onmessage` 的 switch 语句中，`case 'getRegionRecord':` 之后添加：

```js
case 'getChunkRecord':
  result = await getChunkRecord(payload.regionKey, payload.chunkKey, payload.cx, payload.cz);
  break;
```

- [ ] **Step 4: 验证 lint 通过**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 2: WorldStore — 替换 getChunkRecord 实现

**Files:**
- Modify: `src/world/WorldStore.js`

- [ ] **Step 1: 替换 getChunkRecord 方法**

将现有的 `getChunkRecord` 方法（第 140-144 行）替换为：

```js
/**
 * 读取单个 ChunkRecord（Worker 侧裁剪，仅传输目标 chunk 数据）
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

- [ ] **Step 2: 验证 lint 通过**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 3: WorldRuntime — 简化 ensureChunkData

**Files:**
- Modify: `src/world/WorldRuntime.js`

- [ ] **Step 1: 替换 ensureChunkData 方法**

将现有的 `ensureChunkData` 方法（第 87-119 行）替换为：

```js
/**
 * 确保 chunk 数据已加载到内存
 * 通过 Worker 侧 getChunkRecord 读取，仅传输目标 chunk 数据（~100KB）
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

  return {
    status: 'ready',
    chunkRecord
  };
}
```

- [ ] **Step 2: 验证 lint 通过**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 4: 更新测试 — mock getChunkRecord 替代 getRegionRecord

**Files:**
- Modify: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 更新第一个测试 — region 不存在时返回 missing-chunk**

将第 8-19 行的测试替换为：

```js
test('ensureChunkData - region 不存在时返回 missing-chunk', async () => {
  const originalWorldStore = globalThis._worldStore;
  globalThis._worldStore = {
    getChunkRecord: async () => null
  };

  const runtime = new WorldRuntime();
  const result = await runtime.ensureChunkData(0, 0);

  assertEqual(result.status, 'missing-chunk', 'region 和 chunk 缺失时应返回 missing-chunk');
  globalThis._worldStore = originalWorldStore;
});
```

注意：原来的测试名 `missing-region` 改为 `missing-chunk`，因为新的实现中不区分 region 缺失和 chunk 缺失，统一返回 `missing-chunk`。

- [ ] **Step 2: 删除第二个测试（region 存在但 chunk 不存在）**

这个场景现在由 `getChunkRecord` 返回 null 覆盖，与第一个测试合并。删除第 21-35 行的测试。

- [ ] **Step 3: 更新第三个测试 — chunk 存在时返回 ready**

将第 37-61 行的测试替换为：

```js
test('ensureChunkData - chunk 存在时返回 ready 与 chunkRecord', async () => {
  const originalWorldStore = globalThis._worldStore;
  const chunkRecord = {
    cx: 0,
    cz: 0,
    blockData: { 123: 'stone' },
    staticEntities: [{ type: 'rovers', positions: [{ x: 1, y: 2, z: 3 }] }],
    runtimeSeedData: { structureCenters: [{ x: 4, z: 5 }] },
    runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
  };
  globalThis._worldStore = {
    getChunkRecord: async () => chunkRecord
  };

  const runtime = new WorldRuntime();
  const result = await runtime.ensureChunkData(0, 0);

  assertEqual(result.status, 'ready', 'chunk 存在时应返回 ready');
  assertDeepEqual(result.chunkRecord.blockData, chunkRecord.blockData, 'blockData 应原样返回');
  assertDeepEqual(result.chunkRecord.staticEntities, chunkRecord.staticEntities, 'staticEntities 应原样返回');
  assertDeepEqual(result.chunkRecord.runtimeSeedData, chunkRecord.runtimeSeedData, 'runtimeSeedData 应原样返回');
  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 4: 更新第四个测试 — 迁移旧档实体**

将第 63-106 行的测试替换为：

```js
test('ensureChunkData - 缺失 runtimeEntities 时应通过 WorldStore 迁移旧档实体', async () => {
  const originalWorldStore = globalThis._worldStore;
  const migratedEntities = {
    turrets: [{ id: 'legacy-turret', position: { x: 8, y: 4, z: 8 }, rotation: { yaw: 0, pitch: 0 } }],
    zombieNests: [],
    minecarts: []
  };
  const putCalls = [];
  const chunkRecordWithoutEntities = {
    cx: 0,
    cz: 0,
    blockData: {},
    staticEntities: [],
    runtimeSeedData: {}
  };

  globalThis._worldStore = {
    getChunkRecord: async () => chunkRecordWithoutEntities,
    getLegacyChunkDelta: async (cx, cz) => {
      assertEqual(cx, 0, '应查询正确的 legacy cx');
      assertEqual(cz, 0, '应查询正确的 legacy cz');
      return { entities: migratedEntities };
    },
    commitChunkRecord: async (cx, cz, record) => {
      putCalls.push({ cx, cz, record });
      return true;
    }
  };

  const runtime = new WorldRuntime();
  const result = await runtime.ensureChunkData(0, 0);

  assertEqual(result.status, 'ready', '迁移后仍应返回 ready');
  assertDeepEqual(result.chunkRecord.runtimeEntities, migratedEntities, '应通过 WorldStore 迁移旧档 runtimeEntities');
  assertEqual(putCalls.length, 1, '迁移完成后应回填 worldStore 一次');
  assertDeepEqual(putCalls[0].record.runtimeEntities, migratedEntities, '回填内容应与迁移实体一致');

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 5: 更新第五个测试 — 无旧档时补空结构**

将第 108-145 行的测试替换为：

```js
test('ensureChunkData - 缺失 runtimeEntities 且无旧档时应补空结构且不回写', async () => {
  const originalWorldStore = globalThis._worldStore;
  const putCalls = [];
  const chunkRecordWithoutEntities = {
    cx: 0,
    cz: 0,
    blockData: {},
    staticEntities: [],
    runtimeSeedData: {}
  };

  globalThis._worldStore = {
    getChunkRecord: async () => chunkRecordWithoutEntities,
    getLegacyChunkDelta: async () => null,
    commitChunkRecord: async (...args) => {
      putCalls.push(args);
      return true;
    }
  };

  const runtime = new WorldRuntime();
  const result = await runtime.ensureChunkData(0, 0);

  assertEqual(result.status, 'ready', '无旧档时仍应返回 ready');
  assertDeepEqual(result.chunkRecord.runtimeEntities, {
    turrets: [],
    zombieNests: [],
    minecarts: []
  }, '应补齐空的 runtimeEntities 结构');
  assertEqual(putCalls.length, 0, '无旧档数据时不应发生回填');

  globalThis._worldStore = originalWorldStore;
});
```

- [ ] **Step 6: 更新第 487-555 行的测试 — flushBeforeUnload 后读取缓存**

这个测试中的 `getRegionRecord` mock 需要改为 `getChunkRecord`：

将第 493-499 行的 mock 替换为：

```js
globalThis._worldStore = {
  putChunkRecord: async (cx, cz, record) => {
    savedRecords.push({ cx, cz, record });
    return true;
  },
  getChunkRecord: async () => null
};
```

- [ ] **Step 7: 运行测试验证**

Run: `node command/run-tests.js`
Expected: 所有 WorldRuntime 测试通过

- [ ] **Step 8: 验证 lint 通过**

Run: `npm run lint`
Expected: 无新增错误

---

### Task 5: 最终验证和提交

- [ ] **Step 1: 运行全部测试**

Run: `node command/run-tests.js`
Expected: 全部测试通过

- [ ] **Step 2: 最终 lint 检查**

Run: `npm run lint`
Expected: 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/workers/PersistenceWorker.js src/world/WorldStore.js src/world/WorldRuntime.js src/tests/test-world-runtime.js
git commit -m "feat(chunk-read): Worker 侧 region 缓存 + chunk 级读取，降低 postMessage 传输体积

- PersistenceWorker: 添加 LRU regionCache (max 6) 和 getChunkRecord action
- WorldStore: getChunkRecord 改为直接调用 Worker action，不再传输整包 region
- WorldRuntime: ensureChunkData 简化为调用 getChunkRecord
- 测试: 更新 mock 从 getRegionRecord 改为 getChunkRecord

传输体积: 9MB/region → ~100KB/chunk"
```
