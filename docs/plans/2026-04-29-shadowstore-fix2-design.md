# ShadowStore 二次修复设计

**日期**: 2026-04-29
**分支**: gen-big-map-first

## 背景

基于上次提交 `a8bcd68` 的 review 反馈，有三个遗漏问题需要修复。

## Fix 1: 失败 key 重入队后未重新调度 flush

### 问题

`_flush()` 将 failedKeys 加入 `_pending` 后没有调用 `_scheduleFlush()`。如果后续没有 `markDirty` 触发，失败 key 永远滞留内存，不会自动重试。

### 修复

在 `_flush()` 的 try 块和 catch 块中，重入队后调用 `_scheduleFlush()`：

```javascript
// try 块中
if (failedKeys.length > 0) {
  console.warn(...);
  for (const key of failedKeys) {
    this._pending.add(key);
  }
  this._scheduleFlush();  // 新增
}

// catch 块中
for (const key of keys) {
  this._pending.add(key);
}
this._scheduleFlush();  // 新增
```

## Fix 2: 空 runtimeEntities 不清空 ShadowStore

### 问题

`Chunk.loadFromRecord` 中，当 persistence 返回 `runtimeEntities` 但三数组都为空时，不会调用 `deserializeAndMerge` 清空 ShadowStore。如果之前有残留数据（如异常崩溃后），可能导致已删除实体回流。

### 修复

当 `hasRuntimeEntities` 为 false 但 `cache.entities` 存在时，检查是否为空实体状态。如果是，调用 `deserializeAndMerge` 用空数据清空该 chunk 的 ShadowStore。

## Fix 3: flushAll() 未接入生命周期

### 问题

`flushAll()` 无调用点，`dispose()` 只清理 timer 和 worker，不触发最终 flush。

### 修复

在 `ShadowSyncDispatcher.dispose()` 中调用 `flushAll()`，确保退出前最后脏数据落盘。
