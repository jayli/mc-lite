# 缓存击穿修复 + Region 预取 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `WorldRuntime.ensureChunkData` 的并发缓存击穿问题，并添加定时器驱动的 Region 预取机制。

**Architecture:** 在 `WorldRuntime` 中引入 `_regionLoadPromises` Map 实现 in-flight 请求去重；在 `World` 中启动 500ms 定时器调用 `WorldRuntime.prefetchRegions` 预热相邻 region。

**Tech Stack:** 纯 ES Modules，无 bundler，浏览器内测试。

---

### Task 1: 重构 `WorldRuntime.ensureRegion` 添加 in-flight Promise 去重

**Files:**
- Modify: `src/world/WorldRuntime.js:25-35`（构造函数）
- Modify: `src/world/WorldRuntime.js:72-107`（`ensureChunkData`）
- Modify: `src/world/WorldRuntime.js:280-290`（`ensureRegion`）

**Step 1: 在构造函数中初始化 `_regionLoadPromises`**

在 `src/world/WorldRuntime.js` 的 `constructor` 中，在 `this._regionSizeInChunks = REGION_SIZE_IN_CHUNKS;` 之后添加：

```javascript
this._regionLoadPromises = new Map(); // regionKey -> Promise
```

**Step 2: 重构 `ensureRegion` 添加去重逻辑**

将 `ensureRegion` 方法替换为：

```javascript
async ensureRegion(rx, rz) {
  const regionKey = this._regionKey(rx, rz);

  // 1. 缓存命中
  let region = this._regionCache.get(regionKey);
  if (region) return region;

  // 2. 检查是否已有正在进行的请求
  const existingPromise = this._regionLoadPromises.get(regionKey);
  if (existingPromise) return existingPromise;

  // 3. 发起新请求
  const loadPromise = this._worldStore.getRegionRecord(rx, rz)
    .then((record) => {
      if (record) {
        this._regionCache.set(regionKey, record);
      }
      this._regionLoadPromises.delete(regionKey);
      return record;
    })
    .catch((err) => {
      this._regionLoadPromises.delete(regionKey);
      throw err;
    });

  this._regionLoadPromises.set(regionKey, loadPromise);
  return loadPromise;
}
```

**Step 3: 简化 `ensureChunkData` 为调用 `ensureRegion`**

将 `ensureChunkData` 替换为：

```javascript
async ensureChunkData(cx, cz) {
  const { rx, rz } = this._chunkToRegion(cx, cz);
  const region = await this.ensureRegion(rx, rz);

  if (!region || !region.chunks) {
    return { status: 'missing-region' };
  }
  const chunkKey = this._chunkKey(cx, cz);
  const chunkData = region.chunks[chunkKey];
  if (!chunkData) {
    return { status: 'missing-chunk' };
  }

  return {
    status: 'ready',
    chunkRecord: {
      cx,
      cz,
      blockData: chunkData.blockData || {},
      staticEntities: chunkData.staticEntities || [],
      runtimeSeedData: chunkData.runtimeSeedData || {}
    }
  };
}
```

**Step 4: 运行 lint**

```bash
npm run lint
```

Expected: 0 errors, 0 new warnings.

**Step 5: Commit**

```bash
git add src/world/WorldRuntime.js
git commit -m "fix(world-runtime): add in-flight promise dedup for region loading

- Introduce _regionLoadPromises Map to share concurrent getRegionRecord calls
- Refactor ensureChunkData to reuse ensureRegion
- Prevents N concurrent IndexedDB reads for the same region"
```

---

### Task 2: 在 `WorldRuntime` 中添加 `prefetchRegions` 方法

**Files:**
- Modify: `src/world/WorldRuntime.js`

**Step 1: 添加 `prefetchRegions` 方法**

在 `WorldRuntime` 类中 `getStats()` 方法之前添加：

```javascript
/**
 * 预取玩家周围的 region（尽力而为，不阻塞）
 * @param {number} playerCx - 玩家所在 chunk X
 * @param {number} playerCz - 玩家所在 chunk Z
 * @param {number} [maxPrefetches=1] - 每轮最多预取数量
 * @returns {number} 实际预取的 region 数量
 */
prefetchRegions(playerCx, playerCz, maxPrefetches = 1) {
  const playerRx = Math.floor(playerCx / this._regionSizeInChunks);
  const playerRz = Math.floor(playerCz / this._regionSizeInChunks);

  // 相邻 4 个 region（上/下/左/右）
  const neighbors = [
    { rx: playerRx - 1, rz: playerRz },
    { rx: playerRx + 1, rz: playerRz },
    { rx: playerRx, rz: playerRz - 1 },
    { rx: playerRx, rz: playerRz + 1 }
  ];

  let prefetched = 0;
  for (const { rx, rz } of neighbors) {
    if (prefetched >= maxPrefetches) break;
    const regionKey = this._regionKey(rx, rz);

    // 跳过已缓存或正在加载的
    if (this._regionCache.has(regionKey)) continue;
    if (this._regionLoadPromises.has(regionKey)) continue;

    // 静默预取（不 await，不阻塞）
    this.ensureRegion(rx, rz).catch(() => {});
    prefetched++;
  }

  return prefetched;
}
```

**Step 2: 运行 lint**

```bash
npm run lint
```

Expected: 0 errors, 0 new warnings.

**Step 3: Commit**

```bash
git add src/world/WorldRuntime.js
git commit -m "feat(world-runtime): add prefetchRegions for background region warmup

- Prefetch up to 4 adjacent regions (N/S/E/W)
- Budget-controlled: max 1 region per call by default
- Skips already-cached or in-flight regions"
```

---

### Task 3: 在 `World` 中添加预取定时器

**Files:**
- Modify: `src/world/World.js:76-178`（constructor）
- Modify: `src/world/World.js:738-893`（update 方法附近）

**Step 1: 在 constructor 中启动预取定时器**

在 `src/world/World.js` 的 `constructor` 末尾（`this.worldGenerationService.setWorld(this);` 之后）添加：

```javascript
// --- Region 预取定时器 ---
this._prefetchIntervalMs = 500;
this._prefetchTimer = globalThis.setInterval(() => {
  this._runPrefetch();
}, this._prefetchIntervalMs);
```

**Step 2: 添加 `_runPrefetch` 方法**

在 `World` 类中 `isGameplayReady()` 方法之后添加：

```javascript
_runPrefetch() {
  if (this.bootstrapState.phase !== 'runtime-streaming') return;
  if (!this.worldRuntime) return;

  const playerCx = Math.floor(this._lastPlayerPos.x / CHUNK_SIZE);
  const playerCz = Math.floor(this._lastPlayerPos.z / CHUNK_SIZE);
  this.worldRuntime.prefetchRegions(playerCx, playerCz, 1);
}
```

**Step 3: 添加定时器清理**

在 `src/world/World.js` 中找到或确认有 dispose/cleanup 逻辑。如果没有专门的 dispose 方法，在 constructor 附近添加一个 `dispose` 方法：

```javascript
dispose() {
  if (this._prefetchTimer) {
    globalThis.clearInterval(this._prefetchTimer);
    this._prefetchTimer = null;
  }
  // 其他清理逻辑...
}
```

如果 `World` 类已有 `dispose` 方法，只需在其中添加定时器清理。

**Step 4: 运行 lint**

```bash
npm run lint
```

Expected: 0 errors, 0 new warnings.

**Step 5: Commit**

```bash
git add src/world/World.js
git commit -m "feat(world): add background region prefetch timer

- 500ms interval, only active during runtime-streaming phase
- Calls worldRuntime.prefetchRegions to warm up adjacent regions
- Clean up timer on dispose"
```

---

### Task 4: 运行完整 lint 和回归验证

**Step 1: 运行 lint**

```bash
npm run lint
```

Expected: 0 errors, 0 new warnings.（允许历史遗留的 50 个警告）

**Step 2: 启动开发服务器并浏览器内测试**

```bash
npm run start
```

打开浏览器访问 `http://localhost:8080`

验证项：
- [ ] 游戏正常启动，预生成完成后进入主世界
- [ ] 按 L 键查看 chunk perf 日志，`load-from-record` 时间稳定
- [ ] 按 N 键查看 streaming perf 日志，跑图时无明显卡顿峰值
- [ ] 跨越 region 边界时，chunk 加载延迟无明显增加

**Step 3: Commit（如需）**

如果测试中发现并修复了问题，单独提交。

---

## 风险与回退

| 风险 | 缓解措施 |
|------|---------|
| `_regionLoadPromises` 在异常路径下未清理 | `.catch` 中已添加 `delete`，且 Promise 链总会 settle |
| 预取定时器泄漏 | `dispose` 方法中已添加 `clearInterval` |
| 预取增加 IndexedDB 压力 | 每轮最多 1 个 region，频率 500ms，影响极小 |
| `ensureChunkData` 调用 `ensureRegion` 引入循环依赖 | 无循环，`ensureChunkData` 调用 `ensureRegion`，`ensureRegion` 不调用 `ensureChunkData` |
