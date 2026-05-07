# 特殊实体 ShadowStore 修复设计

**日期**: 2026-04-29
**分支**: gen-big-map-first

## 问题概述

在 ShadowStore 架构实现中（提交范围 2dbb8483..HEAD），确认了两个影响数据正确性的 bug。

## Bug #2（高风险）：Worker 部分失败未被处理

### 问题

`ShadowSyncDispatcher._flush()` 和 `flushAll()` 只捕获 RPC 异常（catch 块），但 Worker 的 `batchSync`/`flushAll` 即使有 `failedKeys` 也会正常 resolve。Dispatcher 从未检查 result 中的 `failedKeys`，导致部分失败的 key 被静默丢弃。

### 修复方案（完整修复）

**`ShadowSyncDispatcher.js`（主线程）：**
- `_flush()`：检查 `result.failedKeys`，将失败 key 重新加入 `_pending`；区分 RPC 异常（全部重入队）和部分失败（仅重入队失败 key）
- `flushAll()`：同样检查 `failedKeys`，记录失败日志

**`ShadowSyncWorker.js`（Worker）：**
- `batchSync()` 和 `flushAll()`：修正 `successCount += chunkMap.size` 为逐 key 计数
- `flushAll()` 的 catch 块：改为遍历 `chunkMap` 的所有 key 加入 `failedKeys`，而非只记录 region key

### 影响

解决炮塔、矿车、丧尸巢穴的创建/删除可能静默丢失的问题。

## Bug #4（中风险）：矿车 chunkKey 跨 chunk 移动不更新

### 问题

`minecart.chunkKey` 只在创建/恢复时赋值，移动过程只更新位置索引，不更新 `chunkKey`。导致 `stopMinecartsForChunk()` 在 chunk 卸载时可能漏停/漏存。

### 修复方案

在 `MinecartMovementSystem.update()` 的跨 chunk 判断处（line 634-638），同步更新 `minecart.chunkKey`：

```javascript
if (Math.floor(newX) !== currentX || Math.floor(newZ) !== currentZ) {
    if (manager && typeof manager.updateMinecartPositionIndex === 'function') {
      manager.updateMinecartPositionIndex(minecart, oldPos);
    }
    // 新增：跨 chunk 时更新 chunkKey
    const newChunkKey = manager?.getChunkKeyByPosition(minecart.position);
    if (newChunkKey && newChunkKey !== minecart.chunkKey) {
      minecart.chunkKey = newChunkKey;
    }
    minecart.lastTrackPosition = { x: currentX, y: currentY, z: currentZ };
}
```

### 影响

矿车状态将保存到正确的 chunk，重加载后位置准确。
