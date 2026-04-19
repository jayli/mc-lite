# blockData 索引优化设计文档 V2

**日期**: 2026-04-19
**目标**: 将 `chunk.blockData` 从字符串 key (`"x,y,z"`) 改为数字编码 key (`Map<number, entry>`)，消除 Chunk 卸载和方块查询时大量 `split(',')` / 模板字符串操作带来的 GC 压力。

## 上次失败根因

1. **位运算编码陷阱**: `encodeCoord` 使用 `(x << 12) | (y << 6) | z`，JS 位运算强制截断到 32bit 有符号整数。负数 Y（如 -3）编码后 `(-3) & 0x3F = 61`，解码后变成 Y=61，地面方块被渲染到高空。
2. **类型不一致**: `solidBlocks` / `visibleKeys` 改为 `Set<number>` 后，多个写入点仍用字符串 key 添加，导致查询永远失败，玩家穿过地面。
3. **遗漏消费者**: `instanceIndexMap`、`crossChunkOwnerCache`、`dirtyAOPositions`、`pendingBatchFaceCullingUpdates` 等未被同步改造。

## 核心原则

- **绝对不用位运算做坐标编码**（JS 32bit 截断）。使用大整数乘法编码。
- **所有与 blockData key 同构的集合必须同步改造**，禁止字符串/数字混用。
- **顶层调用统一走 `getBlockEntry/setBlockEntry/removeBlockEntry`**，禁止任何直接 `this.blockData[...]` 访问。
- **Worker 内部保持字符串格式**，主线程在收发边界做格式转换，最大限度减少 Worker 侧改动。
- **blockDataArray / solidBlockIds / solidBlocks 均保留**，职责不变。

---

## 坐标编码方案

采用**大整数乘法编码**，天然支持负数，无 JS 位运算陷阱。

```js
// 支持范围：x,z ∈ [-1_000_000, +1_000_000]，y ∈ [-512, +512]
// 编码空间验证：
//   max = ((2_000_000 * 2049 + 1024) * 2_000_001 + 2_000_000) ≈ 8.196e15
//   Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991 ≈ 9.007e15
//   8.196e15 < 9.007e15 ✅ 安全

static encodeCoord(x, y, z) {
  return ((Math.floor(x) + 1000000) * 2049 + (Math.floor(y) + 512)) * 2000001 + (Math.floor(z) + 1000000);
}

static decodeCoord(code) {
  const z = (code % 2000001) - 1000000;
  const t = Math.floor(code / 2000001);
  const y = (t % 2049) - 512;
  const x = Math.floor(t / 2049) - 1000000;
  return { x, y, z };
}
```

**为什么不继续用位运算？**
- JS `<<` `>>` `&` `|` 操作数先转 32bit 有符号整数，再运算，结果再转回 Number
- `(y << 6) & 0x3F` 对 y=-3 时：(-3) 的二进制补码在 32bit 下是 `0xFFFFFFFD`，`& 0x3F` 得 `61`
- 乘法编码无此限制，因为 JS 乘法在 IEEE 754 double 精度内运算

---

## 核心数据结构变更

### Chunk.js

**变更前：**
```js
this.blockData = {};                // { "x,y,z": entry }
this.solidBlocks = new Set();       // Set<string> "x,y,z"
this.visibleKeys = new Set();       // Set<string> "x,y,z"
this.instanceIndexMap[type] = new Map();  // Map<string, number> "x,y,z" → index
this.crossChunkOwnerCache = new Map();    // Map<string, string> "x,y,z" → "cx,cz"
this.dirtyAOPositions = new Set();        // Set<string> "x,y,z"
this.pendingBatchFaceCullingUpdates = new Set();  // Set<string> "x,y,z"
```

**变更后：**
```js
this.blockData = new Map();         // Map<number, entry>  encodeCoord(x,y,z) → entry
this.solidBlocks = new Set();       // Set<number>  encodeCoord(x,y,z)
this.visibleKeys = new Set();       // Set<number>  encodeCoord(x,y,z)
this.instanceIndexMap[type] = new Map();  // Map<number, number>  encodeCoord → index
this.crossChunkOwnerCache = new Map();    // Map<number, string>  encodeCoord → "cx,cz"
this.dirtyAOPositions = new Set();        // Set<number>  encodeCoord
this.pendingBatchFaceCullingUpdates = new Set();  // Set<number>  encodeCoord
```

### 其他文件中的同构集合

| 文件 | 变量/字段 | 当前类型 | 改造后类型 |
|------|----------|----------|-----------|
| `World.js` | `crossChunkOwnerCache` | `Map<string, string>` | `Map<number, string>` |
| `ChunkRenderUtils.js` | `_tempOriginalSolidBlocks` | `Array<string>` | `Array<number>` |
| `BlockScatterManager.js` | `visibleBlockKeys` | `Set<string>` | `Set<number>` |
| `FaceCullingSystemDebug.js` | 遍历 `solidBlocks` 的元素 | `string` | `number` |

**保持不变的（非 blockData 同构集合）：**
- `entityCollisionIndex`: `Map<string, {entityType, entityId, x, y, z}>` — 独立系统，与 blockData 无同步关系
- `PlaygroundService.playgroundBlocks`: `Set<string>` — 独立系统，仅记录创造台坐标范围
- `Chunk.js` 中 `structureCenters` 列表里的坐标 — 独立数据结构
- `world.chunks` 的 key `"cx,cz"` — 区块索引，与方块坐标无关

---

## 公共 API 统一

在 `Chunk.js` 中提供并强制使用以下方法：

```js
/**
 * 读取指定坐标的方块条目（权威查询）
 * 先查 blockData（Map），再回退到 blockDataArray
 */
getBlockEntry(x, y, z) → { type, orientation } | null

/**
 * 写入指定坐标的方块条目
 * 同步更新 blockData、blockDataArray、solidBlocks、visibleKeys
 */
setBlockEntry(x, y, z, entry) → void

/**
 * 移除指定坐标的方块条目
 * 同步更新所有派生结构
 */
removeBlockEntry(x, y, z) → void

/**
 * 检查指定坐标是否有方块
 */
hasBlockEntry(x, y, z) → boolean
```

**内部私有辅助方法改造：**
- `_getBlockEntryByKey(key)` → 删除，所有调用方改为 `getBlockEntry(x, y, z)`
- `_getBlockTypeByKey(key)` → 删除，所有调用方改为通过 `getBlockEntry` 获取
- `_isBlockVisibleByKey(key)` → 删除
- `_hasBlockByKey(key)` → 删除
- `_updateBlockState(key, type, entry, x, y, z)` → 改为接受 `(x, y, z, type, entry)`，内部用 `encodeCoord`

---

## 消费方改造清单

### 第一层：Chunk.js 内部（必须全部改造）

| 方法 | 改造内容 |
|------|----------|
| `constructor` | `this.blockData = new Map()` |
| `_updateBlockState` | key 生成改为 `encodeCoord`，Map API |
| `_getBlockTypeByKey` | **删除**，调用方改用 `getBlockEntry` |
| `_getBlockEntryByKey` | **删除**，调用方改用 `getBlockEntry` |
| `_isBlockVisibleByKey` | **删除**，调用方改用 `getBlockEntry` |
| `_hasBlockByKey` | **删除**，调用方改用 `hasBlockEntry` |
| `_removeInstancedMeshBlock` | `typeMap.has(key)` / `typeMap.get(key)` 中的 key 改为数字编码 |
| `_revealNeighbors` | `nKey` 改为数字编码，`this.blockData[nKey]` 改为 `.get(nKey)` |
| `_markAllBlocksDirtyAO` | `Object.entries(this.blockData)` 改为 `for (const [code, entry] of this.blockData)` |
| `_executeAORefresh` | `sentKeys` 元素改为数字编码；positions 仍需坐标，从数字解码 |
| `_addDirtyAOPosition` | `key` 改为数字编码；`_getBlockTypeByKey` 改为 `getBlockEntry` |
| `_registerLightSources` | `for (const key in this.blockData)` 改为 `for (const [code, entry] of this.blockData)` |
| `_unregisterLightSources` | 同上 |
| `addBlockDynamic` | `key` 改为数字编码；所有 blockData 访问改为 Map API |
| `addBlocksBatchFast` | `key` 改为数字编码；`key in this.blockData` 改为 `.has(key)` |
| `removeBlocksBatch` | `key` 改为数字编码；`delete this.blockData[key]` 改为 `.delete(key)` |
| `removeBlock` | 内部已调用 `addBlockDynamic`，随其改造 |
| `acceptScatteredBlocks` | `key` 改为数字编码；Worker 传入的 `visibleBlockKeys` 元素需 `encodeCoord` 后存入 Set |
| `appendScatteredBlocks` | 同上 |
| `buildMeshesFromScatteredData` | `Object.entries(this.blockData)` 改为 Map 迭代；`key` 改为数字编码；`instanceIndexMap[b.key] = i` 中的 key 同步 |
| `_initArrayStorageFromBlockData` | `Object.entries(this.blockData)` 改为 Map 迭代；`key.split(',')` 改为 `decodeCoord` |
| `acceptWorkerResult` | `visibleKeys` / `solidBlocks` 数组元素从 Worker 传来是字符串，需 `encodeCoord` 后存入 Set |
| `_syncVisibilityAndCollision` | `visibleKeys` / `solidBlocks` 数组元素需 `encodeCoord`；`dynamicMeshes.keys()` 也已经是数字编码 |
| `_applyConsolidateResult` | `key = \`${x},${y},${z}\`` 改为 `encodeCoord`；`this.blockData[key]` 改为 `.get(key)` |
| `_convertScatteredBlocksToMeshData` | `instanceIndexMap[key] = i` 中的 key 改为数字编码 |
| `_markBoundaryDirtyAO` | `key` 改为数字编码；`this.dirtyAOPositions.add(key)` 同步 |
| `_refreshBlockRenderMesh` | `key` 参数改为数字编码（调用链传递） |
| `_refreshBlockRenderLightweight` | 同上 |
| `_createDynamicBlockMesh` | `key` 参数改为数字编码 |
| `_removeDynamicMesh` | `this.dynamicMeshes.delete(key)` 中的 key 已是数字编码 |
| `_handleRealisticTreeRemoval` | `posKey` 改为数字编码；`instanceIndexMap.get(posKey)` 同步 |
| `getBlockOrientation` | `key` 改为数字编码 |
| `getBlockEntry` (public) | `key` 改为数字编码，调用 `_getBlockEntryByKey` 改为直接查 Map + blockDataArray |

### 第二层：World.js（跨区块查询）

| 方法 | 改造内容 |
|------|----------|
| `resolveBlockOwner` | `blockKey` 改为数字编码；`coordChunk.blockData[blockKey]` 改为 `.get(blockKey)`；`crossChunkOwnerCache` 的 key 改为数字编码 |
| `getAllBlockOwners` | `blockKey` 改为数字编码；遍历查询改为 `.get(blockKey)` |
| `isSolid` | `blockKey` 改为数字编码；`chunk.solidBlocks.has(blockKey)` 和 `chunk.blockData?.[blockKey]` 同步 |

### 第三层：渲染与工具层

| 文件 | 方法 | 改造内容 |
|------|------|----------|
| `ChunkConsolidation.js` | `_applyConsolidateResult` | `key` 编码；`this.blockData.get(key)` |
| `ChunkConsolidation.js` | `_syncVisibilityAndCollision` | `visibleKeys`/`solidBlocks` 数组元素编码；`dynamicMeshes.keys()` 已编码 |
| `ChunkRenderUtils.js` | `regenerateCrossChunkColliders` | `key` 编码；`this.blockData.get(key)` |
| `ChunkRenderUtils.js` | `processPendingFaceCullingUpdates` | `nKey` 编码；`this.blockData.get(nKey)` |
| `ChunkNeighborUtils.js` | `createChunkNeighborSampler` | `key` 编码；`targetChunk.blockData.get(key)` |
| `ChunkMeshDataFilter.js` | `filterLegacyRenderData` | `blockData` 参数改为 Map；`blockData.get(key)` |
| `ChunkMeshDataFilter.js` | `filterMeshData` | `blockData` 参数改为 Map；`blockData.get(key)`；`instanceIndexMap` 的 key 已编码 |
| `ChunkMeshDataFilter.js` | `filterWorkerResultAgainstBlockData` | `blockData` 参数改为 Map；`.has(key)` |
| `FaceCullingCore.js` | `createBlockDataNeighborQuery` | `blockData` 参数改为 Map；`blockData.get(key)` |
| `FaceCullingCore.js` | `createCrossChunkNeighborQuery` | `blockData` 参数改为 Map；`neighborChunk.blockData.get(key)` |
| `AOUtils.js` | `createOcclusionChecker` | `key` 编码；`chunk.blockData.get(key)` |
| `AOUtils.js` | `createBlockDataOcclusionChecker` | `blockData` 参数改为 Map；`blockData.get(key)` |
| `AOUtils.js` | `computeIncrementalAO` | `blockData` 参数改为 Map；迭代方式改为 Map |
| `FaceCullingSystem.js` | `getBlockFromData` | `blockData` 参数改为 Map；`blockData.get(key)` |
| `FaceCullingSystemDebug.js` | `auditWorld` | `key` 从数字编码解码为坐标 |

### 第四层：实体与服务层

| 文件 | 方法 | 改造内容 |
|------|------|----------|
| `RealisticTree.js` | `generate` | `chunk.solidBlocks.add(code)` 用编码；`chunk.blockData.set(code, entry)` |
| `PlaygroundService.js` | `detectExistingPlayground` | `Object.entries(chunk.blockData)` 改为 `for (const [code, entry] of chunk.blockData)` |
| `ChunkGenerator.js` | `add` | `key` 编码；`this.solidBlocks.add(code)` |

### 第五层：Worker 边界

**Worker 传回主线程的数据格式不变**（字符串 key 数组），主线程在接收边界做转换：

```js
// acceptScatteredBlocks / acceptWorkerResult 中
for (const strKey of visibleBlockKeys) {
  const [x, y, z] = strKey.split(',').map(Number);
  this.visibleKeys.add(Chunk.encodeCoord(x, y, z));
}
```

**主线程传给 Worker 的数据**：由于 postMessage 无法传递 Map，需要在发送前序列化为 Object：

```js
// _executeAORefresh / FaceCullingSystem 等发送给 Worker 前
const blockDataObj = Object.fromEntries(this.blockData);
```

但注意：`Object.fromEntries(this.blockData)` 的 key 会变成字符串（因为 Object 的 key 只能是 string 或 symbol）。这对 Worker 内部逻辑没有影响，因为 Worker 内部本来就是按字符串 key 查找的。不过会损失 Map 的性能优势——但这里只是序列化到 Worker 的瞬时开销，主线程内部仍使用 Map。

**更优方案**：如果 Worker 侧需要 blockData 做大量查询，可以给 Worker 传 `{ entries: [[code, entry], ...] }` 数组，Worker 内部重建为 Object。但这会增加 Worker 侧改动。考虑到"尽量不改 Worker"的原则，采用 `Object.fromEntries` 是最小改动的方案。

### 第六层：测试文件

| 文件 | 改造内容 |
|------|----------|
| `test-chunk.js` | 所有 `chunk.blockData['5,10,5']` 改为 `chunk.blockData.get(Chunk.encodeCoord(5,10,5))`；`Object.keys(chunk.blockData)` 改为 `[...chunk.blockData.keys()]` |
| `test-world.js` | 同上 |
| `test-chunk-mesh-data-filter.js` | `filterWorkerResultAgainstBlockData` 的 blockData 参数改为 Map |

---

## 持久化兼容层

序列化到 IndexedDB 时保持 `{ "x,y,z": entry }` 格式不变，只在内存中使用 Map。

```js
// save（持久化前）
function serializeBlockData(blockDataMap) {
  const obj = {};
  for (const [code, entry] of blockDataMap) {
    const { x, y, z } = Chunk.decodeCoord(code);
    obj[`${x},${y},${z}`] = entry;
  }
  return obj;
}

// load（持久化加载后）
function deserializeBlockData(obj) {
  const map = new Map();
  for (const [key, entry] of Object.entries(obj)) {
    const [x, y, z] = key.split(',').map(Number);
    map.set(Chunk.encodeCoord(x, y, z), entry);
  }
  return map;
}
```

---

## 风险检查清单（实施前必检）

- [ ] `encodeCoord` 对负数 x/y/z 的编码/解码是否对称？单元测试覆盖边界值。
- [ ] `solidBlocks` 所有 `.add()` / `.has()` / `.delete()` 调用是否都使用数字编码？
- [ ] `visibleKeys` 所有 `.add()` / `.has()` / `.delete()` 调用是否都使用数字编码？
- [ ] `instanceIndexMap[type]` 中所有 `.get()` / `.set()` / `.has()` / `.delete()` 的 key 是否都是数字编码？
- [ ] `crossChunkOwnerCache` 的 key 是否都是数字编码？
- [ ] `dirtyAOPositions` 的元素是否都是数字编码？
- [ ] `pendingBatchFaceCullingUpdates` 的元素是否都是数字编码？
- [ ] Worker 返回的 `visibleKeys` / `solidBlocks` 字符串数组在主线程接收时是否做了 `encodeCoord` 转换？
- [ ] `Object.entries(this.blockData)` 是否已全部替换为 `for (const [code, entry] of this.blockData)`？
- [ ] `key in this.blockData` 是否已全部替换为 `this.blockData.has(code)`？
- [ ] `delete this.blockData[key]` 是否已全部替换为 `this.blockData.delete(code)`？
- [ ] 持久化加载路径是否做了 `Object → Map` 转换？
- [ ] `PlaygroundService` 和 `entityCollisionIndex` 是否**未被意外修改**？

---

## 回退方案

如果实施过程中发现不可预见的兼容性问题：
1. 保留 `blockData` 的 Map 改造作为独立分支
2. 回退时恢复 `this.blockData = {}`，但保留已提取的 `getBlockEntry` / `setBlockEntry` 公共方法（它们内部可以临时恢复为字符串 key 操作）
3. 这样即使回退，公共方法层的抽象仍然保留，为后续再次尝试打下基础
