# 缓存击穿修复 + Region 预取设计文档

## 背景

当前 `gen-big-map-first` 分支已实现 region 级预生成 + IndexedDB 权威存储架构。运行时 chunk 加载通过 `WorldRuntime.ensureChunkData` 从 `RegionCache` / IndexedDB 纯装载。代码审查发现两个影响运行时加载性能的问题。

## 问题 1：缓存击穿（并发 IndexedDB 读取）

### 现象

`World.update` 同步创建渲染距离内所有 Chunk（最多 7x7 = 49 个），每个 Chunk 调用 `_requestRuntimeChunkRecord`，进而调用 `WorldRuntime.ensureChunkData`。由于：

1. `_requestRuntimeChunkRecord` 不 `await` `ensureChunkData`
2. `ensureChunkData` 内没有 in-flight Promise 去重
3. `RegionCache` 只有 LRU 缓存，没有"加载中"状态

导致同一 region 内的多个 chunk 会在同一帧内并发穿透到 IndexedDB，发起多次 `getRegionRecord` 请求读取同一个 region。

### 方案：WorldRuntime 内引入 `_regionLoadPromises` Map

**改动范围**：仅 `src/world/WorldRuntime.js`

**具体设计**：

1. `WorldRuntime` 构造函数新增 `this._regionLoadPromises = new Map()`
2. 重构 `ensureRegion` 方法：
   - 先检查 `RegionCache`
   - 再检查 `_regionLoadPromises`，命中则返回共享 Promise
   - 否则发起 `getRegionRecord`，将 Promise 存入 Map
   - 无论成功/失败，完成后从 Map 移除
3. `ensureChunkData` 改为调用 `ensureRegion`，不再直接访问 `WorldStore`

**关键代码逻辑**：

```javascript
async ensureRegion(rx, rz) {
  const regionKey = this._regionKey(rx, rz);

  // 1. 缓存命中
  const cached = this._regionCache.get(regionKey);
  if (cached) return cached;

  // 2. 已有正在进行的请求，共享 Promise
  const existing = this._regionLoadPromises.get(regionKey);
  if (existing) return existing;

  // 3. 发起新请求
  const promise = this._worldStore.getRegionRecord(rx, rz)
    .then(record => {
      if (record) this._regionCache.set(regionKey, record);
      this._regionLoadPromises.delete(regionKey);
      return record;
    })
    .catch(err => {
      this._regionLoadPromises.delete(regionKey);
      throw err;
    });

  this._regionLoadPromises.set(regionKey, promise);
  return promise;
}
```

**错误处理**：
- 请求失败时清理 Map 条目，避免死锁
- 不自动重试，由下次 chunk 加载触发自然重试
- 保持现有错误日志

---

## 问题 2：Region 预取

### 现象

当前 chunk 加载完全被动——只有 chunk 进入渲染距离时才触发 `ensureChunkData`。首次进入新 region 时必有 1 次 IndexedDB 读取延迟。

### 方案：定时器驱动 + 预取预算

**改动范围**：`src/world/WorldRuntime.js` + `src/world/World.js`

**具体设计**：

1. `WorldRuntime` 新增 `prefetchRegions(playerCx, playerCz, maxPrefetches = 1)` 方法：
   - 计算玩家当前 region 坐标
   - 遍历相邻 4 个 region（上/下/左/右）
   - 跳过已在 `RegionCache` 或 `_regionLoadPromises` 中的 region
   - 对未缓存的 region 调用 `ensureRegion` 预热（不 await，不阻塞）
   - 每轮最多预取 `maxPrefetches` 个（默认 1）

2. `World` 新增预取定时器：
   - 在 `constructor` 中启动 `setInterval(() => this._runPrefetch(), 500)`
   - `_runPrefetch` 仅在 `bootstrapState.phase === 'runtime-streaming'` 时执行
   - 计算玩家当前 chunk 坐标，调用 `worldRuntime.prefetchRegions`
   - `World.dispose` 中清理定时器（如存在）

**预取参数**：
- 频率：500ms
- 范围：相邻 4 个 region（上/下/左/右）
- 每轮预算：1 个 region

**对 FPS 的影响**：
- 不占用渲染帧预算（定时器独立于 `requestAnimationFrame`）
- 每轮最多 1 个异步 IndexedDB 请求，开销极小
- 预取是"尽力而为"（best-effort），失败不报错

---

## 测试计划

1. **缓存击穿测试**：
   - 模拟同一 region 内 25 个 chunk 同时调用 `ensureChunkData`
   - 验证 IndexedDB `getRegionRecord` 只被调用 1 次
   - 验证所有 chunk 都正确拿到数据

2. **预取测试**：
   - 玩家移动到新 region 边界前，验证相邻 region 已被预热到 `RegionCache`
   - 验证 bootstrapping 阶段不触发预取
   - 验证定时器在 World 卸载时被清理

3. **回归测试**：
   - `npm run lint`
   - 浏览器内跑图测试，观察 L 键 / N 键性能日志
