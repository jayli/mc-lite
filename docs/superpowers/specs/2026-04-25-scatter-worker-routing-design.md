# Scatter Worker Routing 设计

## 目标

把 `BlockScatterManager.scatter()` 中“逐 block 计算目标 chunk 归属”的工作前移到 `WorldWorker`，让主线程不再对每个回包方块重复做：

- `Math.floor(x / CHUNK_SIZE)` / `Math.floor(z / CHUNK_SIZE)`
- `chunkKey` 构造
- `isOwnChunk` 判定
- `visibleKeys -> Set -> encodeCoord -> has` 这一套可见性二次转换

本轮目标只聚焦这一项优化，不同时混入 finalize、AO、mutation queue 等其他热点改造。

## 当前问题

当前 `scatter()` 的热点不在“遍历很多 chunk”，而在“遍历很多 block，并且对几乎全部 block 都重复做归属判断”。

结合现有日志和代码，可以确认：

1. 单个 Worker 回包常见规模是 `3000+ blockDataBlocks`
2. 其中绝大多数方块本来就属于当前 worker 的 `cx,cz`
3. 主线程仍然对每个 block 做一次“它属于哪个 chunk”的判断
4. 主线程还会额外做一次可见性集合转换与查询

当前代码路径见：

- `src/workers/WorldWorker.js`
- `src/world/BlockScatterManager.js`
- `src/world/Chunk.js`

这意味着现在的实现是：

- 先把所有 block 都当成“可能跨 chunk”
- 再在主线程逐个证明“大多数其实是 own chunk”

这和数据分布不匹配。

## 设计原则

### 1. own chunk 走 fast path

既然回包里绝大多数方块都属于 own chunk，就不应再让这些方块走统一的逐 block 归属判断流程。

### 2. 主线程只消费 Worker 指令

主线程不再重新推导目标 chunk，只负责：

- 接收 own chunk 的完整逻辑/渲染数据
- 接收 overflow chunk 的补片数据
- 把这些数据转交给已有装配与 patch 管线

### 3. 可见性不再走独立 key 集合二次查询

如果某个方块的可见性已经在 Worker 算出，主线程应直接消费该结果，而不是再通过 `visibleKeys` 重建查询路径。

### 4. 渐进切换，保留短期 fallback

第一阶段允许 Worker 同时回传新旧字段：

- 新字段供主线程新路径消费
- 旧字段仅作为调试/回退路径

待新路径稳定后再删除旧字段与旧逻辑。

## 改造范围

本轮只改下面这条链路：

1. `WorldWorker` 回包结构
2. `World._onChunkGenResult()`
3. `BlockScatterManager.scatter()`
4. `Chunk.acceptScatteredBlocks()`
5. `Chunk.appendScatteredBlocks()`
6. 相关测试与 perf/debug 打点

本轮不处理：

- finalize 切片
- `_initArrayStorageFromBlockData()` 增量化
- AO 算法迁移
- mutation queue 批量化

## 现状与目标数据流对比

### 现状

Worker 回包近似为：

- `blockDataBlocks`
- `scatteredBlocks`
- `visibleKeys`
- `meshData`
- `structureCenters`

主线程流程：

1. `scatter()` 遍历 `blockDataBlocks`
2. 逐 block 计算目标 chunk
3. 逐 block 决定 own / pending patch
4. 逐 block 用 `visibleKeysSet.has(code)` 标记可见性
5. own chunk 进入 `acceptScatteredBlocks()`
6. overflow chunk 进入 deferred patch buffer

### 目标

Worker 回包改为：

- `routing.ownChunk`
- `routing.overflowChunks`
- `routing.schemaVersion`

其中：

- `routing.ownChunk`
  - `chunkKey`
  - `blockDataBlocks`
  - `visibleBlocks`
  - `meshData`
- `routing.overflowChunks`
  - `Array<{ chunkKey, blockDataBlocks, visibleBlocks }>`

主线程流程改为：

1. `scatter()` 直接读取 `routing.ownChunk`
2. own chunk 直接写 own buffer，不再逐 block 归属判断
3. `scatter()` 只遍历少量 `overflowChunks` 桶
4. 每个 overflow 桶直接进入 `pendingCrossChunkPatchBuffers`
5. `acceptScatteredBlocks()` 和 `appendScatteredBlocks()` 直接消费“可见块列表”，不再依赖 `visibleKeys`

## 回包协议设计

### 新增字段

Worker 回包新增：

```js
{
  cx,
  cz,
  routing: {
    schemaVersion: 1,
    ownChunk: {
      chunkKey: "16,1",
      blockDataBlocks: [...],
      visibleBlocks: [...],
      meshData: [...]
    },
    overflowChunks: [
      {
        chunkKey: "17,1",
        blockDataBlocks: [...],
        visibleBlocks: [...]
      },
      {
        chunkKey: "16,2",
        blockDataBlocks: [...],
        visibleBlocks: [...]
      }
    ]
  }
}
```

说明：

- `blockDataBlocks`
  - 包含目标 chunk 需要写入 `blockData` 的逻辑方块
- `visibleBlocks`
  - 只包含当前可见、需要进入渲染装配路径的方块
- `meshData`
  - 本轮仍只为 own chunk 生成
- overflow chunk 本轮不直接生成 `meshData`
  - 仍沿用现有 deferred patch / append 语义

### 兼容策略

第一阶段保留旧字段：

- `blockDataBlocks`
- `scatteredBlocks`
- `visibleKeys`

主线程优先读取 `routing`，缺失时回退旧逻辑。

这样做的原因：

- 降低一次性切换风险
- 便于 A/B 比较新旧路径
- 便于逐步补测试

## Worker 端改造设计

### 核心变更

Worker 在生成结果时不再只产出一个“平铺 blocks 列表”，而是在一次遍历中直接产出：

1. own chunk 逻辑方块
2. own chunk 可见方块
3. overflow chunk 逻辑方块桶
4. overflow chunk 可见方块桶

### 为什么不采用“每个 block 附带 belongsToChunk”

这是一个可行的中间方案，但不是最优方案。

原因：

- 它只省掉了主线程重新算归属
- 但主线程仍然要遍历全部 block，再按 `belongsToChunk` 做分桶
- 仍然没有消掉“逐 block 分发”本身

所以本轮直接采用“Worker 预分桶”，而不是“主线程读 belongsToChunk 再分桶”。

## 主线程改造设计

### `World._onChunkGenResult()`

保留现有流程顺序：

1. `chunk.acceptWorkerResult(workerResult)`
2. `scatterManager.scatter(workerResult)`

但 `scatter()` 内部优先消费 `workerResult.routing`。

### `BlockScatterManager.scatter()`

新路径逻辑：

1. 读取 `routing.ownChunk`
2. own chunk 直接写入 `chunkBuffers.get(ownChunk.chunkKey)`
3. 直接保存：
   - `blockDataBlocks`
   - `visibleBlocks`
   - `meshData`
4. 读取 `routing.overflowChunks`
5. 逐桶处理，而不是逐 block 重新归属
6. overflow 桶直接写入 `pendingCrossChunkPatchBuffers`
7. `flushReadyChunks()` 只处理 own chunk / 已触达 ready chunk

### Buffer 结构调整

当前 buffer 里保存的是：

- `blocks`
- `visibleBlockKeys`

改为优先保存：

- `blockDataBlocks`
- `visibleBlocks`
- `meshData`

这样主线程无需再从“逻辑方块全集 + visible key 集合”中还原可见块。

### `Chunk.acceptScatteredBlocks()`

入参改造方向：

```js
acceptScatteredBlocks(blockDataBlocks, visibleBlocks, structureCenters, workerMeshData)
```

语义：

- `blockDataBlocks`
  - 只负责写入 `blockData`
- `visibleBlocks`
  - 只负责写入 `visibleKeys` 和渲染装配路径

这样可以删除：

- `visibleBlockKeys -> encodedVisibleKeys` 的转换过程
- 对每个方块再做一次“它是否可见”的间接判断

### `Chunk.appendScatteredBlocks()`

同样改成直接接 `visibleBlocks`，避免再把所有追加逻辑建立在 key 集合转换上。

## 预期收益

### 直接收益

1. `scatter()` 不再对 own chunk 的 `3000+` blocks 逐个归属判断
2. 不再为可见性额外构造 `Set` 并逐 block `has()`
3. 主线程字符串构造、坐标编码、哈希查询次数明显下降
4. `block-scatter.scatter` 的主耗时段会明显变薄

### 间接收益

1. 主线程 GC 压力下降
2. `acceptScatteredBlocks()` 的可见性装配逻辑更简单
3. 后续继续把主线程复杂性前移到 Worker 时，协议方向一致

## 风险与副作用

### 1. Worker 协议更刚

一旦 Worker 分桶错误，主线程不会再自动纠偏。

应对：

- 第一阶段保留旧字段 fallback
- 增加数据契约测试

### 2. 调试维度变化

以后排查问题要区分：

- 分桶是否正确
- own / overflow 是否重复
- visibleBlocks 是否正确

应对：

- 增加 routing 级别 debug 日志
- 打点 own / overflow block 数量

### 3. API 调整范围较大

`BlockScatterManager` 和 `Chunk` 的接口要一起改。

应对：

- 第一阶段只改最少接口
- 旧路径短期保留

## 验证标准

### 功能正确性

必须保证：

1. own chunk 首次显示不变慢
2. 跨 chunk 结构边界不丢块、不重块
3. tombstone 仍然优先于晚到 patch
4. ready / not-ready chunk 的补刷语义不变

### 性能指标

重点关注：

- `block-scatter.scatter`
- `world.chunk-worker-result`
- `chunk.accept-scattered-blocks`
- `StreamingPerf.mutationQueueBlocks`

通过标准：

1. `block-scatter.scatter` 明显下降
2. `world.chunk-worker-result` 随之下降
3. 远端 chunk 首次可见时机不变差
4. 不引入新的重复渲染或补片漏刷

## 实施建议

按下面顺序推进：

1. Worker 新增 `routing` 字段，但保留旧字段
2. `scatter()` 优先消费新字段
3. `acceptScatteredBlocks()` / `appendScatteredBlocks()` 改吃 `visibleBlocks`
4. 完成测试后，再考虑删除 `visibleKeys` 与旧归位逻辑

这样可以在不一次性打断现有链路的情况下，把主线程最无价值的一段逐 block 归属判断安全移走。
