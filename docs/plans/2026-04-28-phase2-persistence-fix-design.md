# Phase 2 统一持久化路径 — 修复闭环设计

## 背景

第二阶段实现将 runtime entities（炮塔、丧尸巢穴、矿车）持久化从 `persistenceService.cache.entities` 迁入 `worldStore` 的 `ChunkRecord.runtimeEntities`，但存在 6 个读取/写入链路的 bug，导致数据写入后读不到。

## 设计决策：最小闭环（方案 A）

只修复 6 个具体 bug，不改变整体架构。保留 `persistenceService.cache` 双写现状（phase 1 遗留），不在 manager 层做桥接。

## 修复清单

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 1 | `WorldRuntime.js` L90-96 | `ensureChunkData` 读取时丢弃 `chunkData.runtimeEntities` | 投影时带上 `runtimeEntities` |
| 2 | `WorldStore.js` L131-137 | `getChunkRecord` 读取时丢弃 `chunkData.runtimeEntities` | 投影时带上 `runtimeEntities` |
| 3 | `WorldStore.js` L155-161 | `getChunkRecordsInRegion` 读取时丢弃 `chunkData.runtimeEntities` | 投影时带上 `runtimeEntities` |
| 4 | `WorldRuntime.js` L283 | `flushBeforeUnload` 传入的 `blockDataSnapshot` 是 Map，没序列化 | `_serializeBlockData(blockDataSnapshot)` |
| 5 | `WorldRuntime.js` L191-195 | `flushChunk` 定时 flush 路径缺少 `runtimeEntities` | 调用 `_collectEntitiesForChunk` 补上 |
| 6 | `WorldRuntime.js` L226-230 | `flushAllDirty` 批量 flush 路径缺少 `runtimeEntities` | 调用 `_collectEntitiesForChunk` 补上 |

## 不做的

- 不在 manager 层桥接 cache → worldStore
- 不在放置/销毁实体时同步 flush worldStore
- 不删除 phase 1 的 session snapshot 机制
