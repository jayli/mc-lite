# AO Refresh Hot Path Design

> **Problem:** chunk finalize 阶段的 AO 稳定刷新仍在主线程做全量标脏、边界扫描和整块同步，导致 `non-deferred-finalize` / deferred finalize task 经常超过帧预算。目标是在不牺牲 AO 正确性的前提下，把 AO 刷新限制到 face culling 后的可见实例和必要边界带，并继续让真实 AO 计算留在 AOWorker。

## 1. 现状判断

当前 AO 真正计算已经在 `src/workers/AOWorker.js` 中执行：

```js
const { aoLow, aoHigh } = calculateAOForBlock(ix, iy, iz, isOccluding);
```

但主线程在发送计算请求前仍有明显热路径成本：

```text
World.onChunkFinalized()
  -> World.onChunkAOSourceStable(fullRefresh: true, markNeighborBoundaries: true)
    -> Chunk._refreshAOFromStableSource()
      -> _markAllBlocksDirtyAO()       // 遍历 blockData，包含隐藏块
      -> aoBridge.fullSync()           // blockData Map 转 plain object 并 postMessage
      -> _executeAORefresh()
        -> decode dirtyAOPositions     // 将全量脏集解码为 positions
        -> AOWorker.computeAO()
```

邻居 chunk ready 时还会触发：

```text
World.onChunkAOSourceStable(markNeighborBoundaries: true)
  -> neighbor._markBoundaryDirtyAO()
    -> 遍历 blockDataArray[4096]，按边界筛选
```

这说明 issue 中“AO 计算虽然在 Worker，但主线程前置工作过重”的判断成立。

## 2. 设计原则

1. AO 真实计算继续在 `AOWorker` 中，主线程只负责决定哪些实例需要刷新和应用结果。
2. AO 刷新必须在 face culling 之后，以 `visibleKeys` / `instanceIndexMap` 作为候选来源；没有渲染实例的隐藏块不计算 AO。
3. 首次显示可继续使用中性 AO，待 chunk 稳定后异步补齐真实 AO。
4. 邻居到达只刷新必要的边界/角点影响带，不触发本 chunk 或邻居的全量 AO。
5. 保持现有 delta/fullSync 时序语义，先做低风险热路径优化，再改 Worker 内部查询结构。

## 3. 拟采用方案

### 3.1 去除重复 finalize AO 刷新

`Chunk.runDeferredFinalizePhase()` 当前在 `_needsDeferredAOStabilization` 分支中触发一次全量 AO，随后如果 `hasDeferredFinalizeWork` 变为 false，又会在 `deferred-finalize-done` 分支触发第二次全量 AO。

设计：在同一轮 `runDeferredFinalizePhase()` 中记录 `aoRefreshTriggeredThisPass`。如果已经因为 `_needsDeferredAOStabilization` 触发过 AO，则本轮完成时不再触发 `deferred-finalize-done` 的 AO 刷新。

### 3.2 全量刷新改为“可见实例刷新”

新增或替换 `_markAllBlocksDirtyAO()` 的行为：

- 优先遍历 `this.instanceIndexMap` 中的实例坐标；
- 其次可回退到 `this.visibleKeys`；
- 最后才回退到 `this.blockData`，仅用于兼容没有可见索引的旧路径。

候选坐标仍需校验：

- `blockData` 中存在该方块；
- 方块类型是 solid 且非 transparent；
- 当前 chunk 的 mesh/全局实例中存在对应实例。

这样 full refresh 不再对被 face culling 剔除的隐藏块计算 AO。

### 3.3 边界 AO 标记改为坐标生成

`_markBoundaryDirtyAO(neighborCx, neighborCz)` 不再扫描整个 `blockDataArray`。根据邻居方向直接生成边界影响带：

- 邻居在 `+X`：本 chunk 需要刷新靠近 `maxX` 的两列；
- 邻居在 `-X`：刷新靠近 `minX` 的两列；
- 邻居在 `+Z`：刷新靠近 `maxZ` 的两列；
- 邻居在 `-Z`：刷新靠近 `minZ` 的两列；
- 方向语义必须先由测试锁定，避免把当前疑似写反的边界选择继续优化固化；
- y 范围不能默认只限于 `worldY..worldY+15`，因为 `blockData` / `visibleKeys` 允许存在 `Y>15` 的可见方块；必要时回退到遍历 `visibleKeys` 的边界过滤。

每个候选坐标通过统一 helper 校验是否为 AO 可刷新实例，再加入 `dirtyAOPositions`。

### 3.4 对角邻居传播补齐 AO 语义

AO 计算依赖 `3x3x3` 邻域，而不仅仅是共享边的四邻 chunk。因此 `World.onChunkAOSourceStable()` 不能只向正交四邻传播稳定源事件。

设计要求：

- 正交邻居继续刷新边界影响带；
- 对角邻居也必须收到 AO 脏位传播，否则角点处会在“对角 chunk 晚到”时留下旧 AO；
- 对角传播不应退化为全量刷新，只允许刷新对应角点的小范围影响带。

实现上可二选一：

- 在 `Chunk` 侧新增专门的角点 helper（推荐）；
- 扩展 `_markBoundaryDirtyAO()` 使其同时处理对角方向。

无论采用哪种方式，都应保持“只对已就绪、非 consolidation 中的邻居执行即时刷新”的现有时序约束。

### 3.5 AOWorker 遮挡查询避免每次合并大对象

`AOWorker.createOcclusionCheckerFromCache()` 当前每个请求都会把当前 chunk 和邻居 cache 复制到 `merged` 对象。这个成本在 Worker，不阻塞主线程，但会拖慢 AO 回包。

设计：新增基于坐标定位 chunk cache 的查询函数：

```js
function getChunkKeyForWorldCoord(x, z) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  return `${cx},${cz}`;
}
```

`isOccluding(x, y, z)` 直接计算 `chunkKey`，查 `chunkCache[chunkKey][encodeCoord(x, y, z)]`。这会删除 per request 的 `merged` 构造。

## 4. 非目标

- 不改变 AO shader、AO packing 格式或 `aAoLow` / `aAoHigh` attribute。
- 不把 bootstrap 阶段 AO 改回 WorldWorker 同步计算。
- 不改 IndexedDB、WorldStore 或 chunk 存档格式。
- 不在本次重构 `Chunk.js` 大文件边界，只做局部 helper 提取。

## 5. 正确性约束

| 场景 | 预期行为 |
|------|----------|
| 新 chunk 首次显示 | 先显示中性 AO，稳定后异步补真实 AO |
| 正交邻居后到达 | 只刷新双方接壤边界影响带 |
| 对角邻居后到达 | 只刷新对应角点影响带，不做全量刷新 |
| 放置方块 | 当前动态交互期仍延迟到 consolidation 后收敛 |
| 删除方块 / 批量删除 | 保持现有 `_markDirtyAO()` 3x3x3 影响区语义 |
| chunk 正在 consolidation | AO 回包仍由 `_aoSourceVersion` 丢弃过期结果 |
| 边界上存在 `Y>15` 可见方块 | 仍能被边界 AO 标记覆盖，不依赖 `blockDataArray[4096]` |
| 可见集合缺失 | 回退到旧全量 blockData 标记，优先保证正确性 |

## 6. 观测与验证

新增或扩展 `recordChunkPerf` 观测：

- `chunk.ao-refresh.mark-visible`
- `chunk.ao-refresh.mark-boundary`
- `chunk.ao-refresh.full-sync`
- `chunk.ao-refresh.collect-positions`
- `chunk.ao-refresh.apply-results`
- `worker.ao.compute`

验证目标：

- `non-deferred-finalize` / `deferred-finalize` 不再出现由 AO 前置工作引起的 30ms 级峰值。
- full refresh positions 数量接近可见实例数量，而不是 `blockData` 全量数量。
- 邻居边界刷新不再每方向扫描 4096 slot。
- 东西南北边界方向语义正确，不会把错误边界带继续保留下去。
- 对角 chunk 晚到时，角点 AO 会触发补刷新，不会留下角落断层。
- `Y>15` 的可见边界方块仍能进入 AO dirty 集。
- AO 视觉在 chunk 边界、挖掘、放置、批量删除后保持稳定。

## 7. 推荐实施顺序

1. 添加 AO 热路径计时，确认改动前后数据。
2. 修复 deferred finalize 重复 AO 刷新。
3. 将 full refresh 候选从全量 `blockData` 改为 `instanceIndexMap` / `visibleKeys`。
4. 先用测试锁定边界方向语义，再将边界 dirty 标记从全数组扫描改为边界/高层可见带生成。
5. 补齐 `World.onChunkAOSourceStable()` 的对角邻居传播与角点 AO 刷新语义。
6. 优化 AOWorker 遮挡查询，删除 per request `merged` 构造。
7. 运行 lint 和浏览器测试页，最后用 chunk perf 日志做手动对比。
