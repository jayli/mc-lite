# 跨 Region Overflow Block 路由机制设计

日期：2026-04-27
状态：待实施

## 问题陈述

Region 级 Worker 预生成（`generateRegion`）在单个 Worker 调用内生成 8×8 chunk。`resolveOverflowWithinRegion` 只将 overflow blocks 路由到同 region 内的目标 chunk。**跨 region 的 overflow blocks 被静默丢弃**。

日志数据显示，大量 region 存在严重 unresolved overflow：

- Region `1,0`: 7489 resolved, **20640 unresolved**
- Region `2,0`: 15172 resolved, **18214 unresolved**
- Region `2,1`: 13864 resolved, **21611 unresolved**

预生成 49 个 region 的总 unresolved 数量预估超过 **10 万方块**。这些数据丢失导致地图在 region 边界处出现结构断裂（城市、金字塔、树木等被截断）。

## 目标

1. **不丢失任何跨 region overflow block**：所有 overflow 数据都应当被保留并最终路由到正确的 chunk。
2. **预生成阶段自动补齐**：同一批次预生成的 region 之间，overflow 在生成结束后自动分发。
3. **扩图阶段自动消费**：持久化的 overflow 在目标 region 被生成（或扩图）时自动合并。
4. **运行时路径不受影响**：现有 chunk 级运行时加载逻辑保持原样。

## 架构设计

### 数据流概览

```
Worker 生成 Region A
  └─ resolveOverflowWithinRegion
      ├─ 同 region 内 overflow → 直接路由到目标 chunk (已有)
      └─ 跨 region overflow → 序列化返回 (新增)

主线程 _generateRegion 回调
  └─ 保存 Region A 的 64 个 chunk 到 WorldStore
  └─ 收集跨 region overflow → 暂存到 _crossRegionOverflowMap

预生成/扩图批次完成后
  └─ _distributeCrossRegionOverflow()
      ├─ 目标 region 已在同批次中 → 直接追加到对应 RegionRecord
      └─ 目标 region 不在同批次中 → 持久化到 world_overflow store

未来目标 region 被生成/扩图时
  └─ 从 world_overflow store 读取属于该 region 的方块
  └─ 合并到 RegionRecord 后删除
```

### 核心数据结构

**Cross-Region Overflow Block**（Worker 返回，主线程传递）：

```javascript
{
  chunkKey: "cx,cz",       // 目标 chunk
  blockDataBlocks: [       // 需要追加到该 chunk 的方块
    { x, y, z, type, orientation }
  ]
}
```

**主线程暂存结构**（`WorldGenerationService._crossRegionOverflowMap`）：

```javascript
// Map<regionKey, Array<{chunkKey, blockDataBlocks}>>
// regionKey 是目标 region（不是源 region）
```

**持久化结构**（`world_overflow` IndexedDB store）：

```javascript
{
  regionKey: "rx,rz",      // 目标 region
  data: {
    "cx,cz": [             // key 为目标 chunkKey
      { x, y, z, type, orientation }
    ]
  },
  lastModified: timestamp
}
```

## 组件改动清单

### 1. `src/workers/WorldWorker.js`

**`resolveOverflowWithinRegion`**（`line 1307`）：
- 返回对象新增 `unresolvedOverflowBlocks` 字段
- 将当前丢弃的跨 region overflow 数据收集为数组返回

```javascript
return {
  resolved,
  unresolved,
  uniqueUnresolvedCoords: unresolvedCoords.size,
  topDistanceBuckets: [...],
  unresolvedOverflowBlocks: [...]  // 新增
};
```

**`handleRegionGeneration`**（`line 1390`）：
- `postMessage` 返回数据中包含 `unresolvedOverflowBlocks`

### 2. `src/world/WorldGenerationService.js`

**新增成员**：
```javascript
this._crossRegionOverflowMap = new Map(); // 暂存跨 region overflow
```

**新增方法 `_collectCrossRegionOverflow(data)`**：
- 在 `_generateRegion` 的 worker 回调中调用
- 将 `data.unresolvedOverflowBlocks` 按目标 regionKey 分组，存入 `_crossRegionOverflowMap`

**新增方法 `_distributeCrossRegionOverflow(targetRegionKeys)`**：
- 遍历 `_crossRegionOverflowMap`
- 对于目标 region 在 `targetRegionKeys` 中的条目：
  1. 从 WorldStore 加载对应 RegionRecord
  2. 将 overflow blocks 追加到对应 chunk 的 `blockData`
  3. 保存回 WorldStore
  4. 从 map 中删除该条目
- 剩余的条目（目标 region 不在当前批次）：
  1. 调用 WorldStore 保存到 `world_overflow` store

**修改 `generateInitialWorld`**：
- 双层 for 循环生成完所有 region 后，调用 `_distributeCrossRegionOverflow`
- 传入所有已生成的 region keys

**修改 `expandWorldIfNeeded`**：
- 生成新 region 后，调用 `_distributeCrossRegionOverflow` 传入新 region keys
- **新增步骤**：对每个新 region，调用 WorldStore 检查 `world_overflow` 是否有属于它的方块，如果有则合并到 RegionRecord 并删除

### 3. `src/world/WorldStore.js`

**新增方法**：

```javascript
async saveOverflowBlocks(rx, rz, overflowData) {
  const regionKey = this.regionKey(rx, rz);
  return getPersistenceService().postMessage('saveOverflowBlocks', { regionKey, overflowData });
}

async getOverflowBlocks(rx, rz) {
  const regionKey = this.regionKey(rx, rz);
  return getPersistenceService().postMessage('getOverflowBlocks', { regionKey });
}

async removeOverflowBlocks(rx, rz) {
  const regionKey = this.regionKey(rx, rz);
  return getPersistenceService().postMessage('removeOverflowBlocks', { regionKey });
}
```

### 4. `src/workers/PersistenceWorker.js`

**新增 object store**：
- `WORLD_OVERFLOW_STORE = 'world_overflow'`
- 需要在 `init()` 的升级回调中创建（`keyPath: 'regionKey'`）
- **DB_VERSION 从 2 升级到 3**

**新增函数**：

```javascript
function saveOverflowBlocks(regionKey, overflowData) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readwrite', (store) =>
    store.put({ regionKey, data: overflowData, lastModified: Date.now() })
  );
}

function getOverflowBlocks(regionKey) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readonly', (store) =>
    store.get(regionKey)
  ).then((result) => result ? result.data : null);
}

function removeOverflowBlocks(regionKey) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readwrite', (store) =>
    store.delete(regionKey)
  );
}
```

**修改 `init()`**：
- 检查并创建 `WORLD_OVERFLOW_STORE`
- 升级 `PERSISTENCE_CONFIG.DB_VERSION` 到 3

**修改 `clearWorld()`**：
- 清除 `WORLD_OVERFLOW_STORE`

**修改 `onmessage` switch**：
- 新增 `saveOverflowBlocks`、`getOverflowBlocks`、`removeOverflowBlocks` case

### 5. `src/constants/PersistenceConfig.js`

**修改 `DB_VERSION`**：
```javascript
DB_VERSION: 3, // v3: 新增 world_overflow store（跨 region overflow 持久化）
```

## 关键算法

### `_collectCrossRegionOverflow(data)`

```javascript
const overflowBlocks = data.unresolvedOverflowBlocks || [];
for (const entry of overflowBlocks) {
  const [targetCx, targetCz] = entry.chunkKey.split(',').map(Number);
  const { rx: targetRx, rz: targetRz } = this._chunkToRegion(targetCx, targetCz);
  const targetRegionKey = this._regionKey(targetRx, targetRz);

  if (!this._crossRegionOverflowMap.has(targetRegionKey)) {
    this._crossRegionOverflowMap.set(targetRegionKey, []);
  }
  this._crossRegionOverflowMap.get(targetRegionKey).push(entry);
}
```

### `_distributeCrossRegionOverflow(targetRegionKeys)`

```javascript
const targetKeySet = new Set(targetRegionKeys);
for (const [regionKey, entries] of this._crossRegionOverflowMap) {
  if (targetKeySet.has(regionKey)) {
    // 1. 加载 RegionRecord
    const [rx, rz] = regionKey.split(',').map(Number);
    const record = await getWorldStore().getRegionRecord(rx, rz);
    if (!record) continue;

    // 2. 按 chunkKey 合并到 blockData
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

    // 3. 保存
    await getWorldStore().saveRegionRecord(rx, rz, record);
    this._crossRegionOverflowMap.delete(regionKey);
  }
}

// 剩余条目持久化
for (const [regionKey, entries] of this._crossRegionOverflowMap) {
  const [rx, rz] = regionKey.split(',').map(Number);
  const overflowData = {};
  for (const entry of entries) {
    if (!overflowData[entry.chunkKey]) overflowData[entry.chunkKey] = [];
    overflowData[entry.chunkKey].push(...entry.blockDataBlocks);
  }
  await getWorldStore().saveOverflowBlocks(rx, rz, overflowData);
  this._crossRegionOverflowMap.delete(regionKey);
}
```

### 扩图时的 Overflow 消费

```javascript
async _consumeOverflowForRegion(rx, rz) {
  const overflowData = await getWorldStore().getOverflowBlocks(rx, rz);
  if (!overflowData) return;

  const record = await getWorldStore().getRegionRecord(rx, rz);
  if (!record) return;

  for (const [chunkKey, blocks] of Object.entries(overflowData)) {
    const chunkData = record.chunks[chunkKey];
    if (!chunkData) continue;
    for (const block of blocks) {
      const code = encodeCoord(block.x, block.y, block.z);
      if (chunkData.blockData[code] === undefined) {
        chunkData.blockData[code] = block.orientation
          ? { type: block.type, orientation: block.orientation }
          : block.type;
      }
    }
  }

  await getWorldStore().saveRegionRecord(rx, rz, record);
  await getWorldStore().removeOverflowBlocks(rx, rz);
}
```

## 错误处理

| 场景 | 处理策略 |
|------|----------|
| 目标 RegionRecord 不存在 | 跳过该 region 的分发，将 overflow 持久化到 world_overflow（等待目标 region 被生成） |
| 目标 chunk 在 RegionRecord 中不存在 | 跳过该 chunk 的方块（说明 chunk 可能未生成，持久化等待） |
| 方块坐标已被占用 | 跳过该方块（保留已有数据，不覆盖） |
| IndexedDB 写入失败 | 输出错误日志，不中断流程，overflow 保留在内存 map 中等待下次重试 |
| DB 升级失败（v2→v3） | 在 `init()` 中捕获并输出错误，回退到不持久化 overflow（内存-only 模式） |

## 测试策略

1. **单元测试**：`_collectCrossRegionOverflow` 和 `_distributeCrossRegionOverflow` 的分组/合并逻辑
2. **集成测试**：预生成 3×3 region，在边界放置一个跨越 4 个 region 的大型结构，验证所有 overflow block 最终都在正确的 chunk 中
3. **持久化测试**：预生成后清除内存，重新加载 region record，验证 overflow blocks 已正确合并
4. **扩图测试**：预生成小范围后扩图，验证之前持久化的 overflow 被正确消费

## 向后兼容

| 路径 | 影响 |
|------|------|
| 运行时 chunk 加载 | 无影响，继续使用现有 `_mergeOverflowBlocks` 路径 |
| 旧存档（DB v2） | 打开时自动升级至 v3，`world_overflow` store 为空，不影响已有数据 |
| `clearWorld` | 新增清除 `world_overflow`，不影响业务逻辑 |
| Region 级生成 Worker | 仅新增 `unresolvedOverflowBlocks` 返回字段，主线程旧代码可忽略 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 跨 region overflow 数据量过大，内存占用激增 | `_crossRegionOverflowMap` 在分发后立即清空；单个 region 的 overflow 数据通常 < 50KB |
| 扩图时消费 overflow 与 region 生成产生竞态 | `expandWorldIfNeeded` 串行执行，先 `_generateRegion` 再 `_consumeOverflowForRegion` |
| DB v3 升级时浏览器已有旧 tab 打开 v2 DB | `init()` 中检测 store 缺失则关闭重连，触发升级 |
| 持久化 overflow 长期累积无人消费 | 日志输出未消费 overflow 的统计；未来可考虑定期清理 |
