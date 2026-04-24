# Runtime Chunk Streaming P1 设计

## 目标

在不通过“延后远端 chunk 可见”换取性能的前提下，同时优化以下三个指标：

- 降低远端 chunk 从 Worker 回包到首次上屏的总耗时
- 降低 chunk 装载过程对主线程的卡顿影响
- 降低流式装载阶段的遍历、检索、查询等纯算法开销

## 当前瓶颈

结合现有 `StreamingPerf` 和 `ChunkPerf` 日志，可以确认当前主线程热点集中在 Worker 回包后的同步装配阶段：

1. `block-scatter.flush-ready`
   - 单次通常 `5.8ms ~ 9.6ms`
   - `acceptedChunks` 基本只有 `1`
   - `appendedChunks` 却长期在 `30+`
   - 说明当前成本主要来自“扫描所有 buffer”的固定开销，而不是本次实际变化的 chunk 数

2. `chunk-assembly.task(finalize)`
   - 单次通常 `9.8ms ~ 16.0ms`
   - `chunk-assembly.process` 明明配置了 `budgetMs: 8`，实际仍频繁跑到 `11ms ~ 19ms`
   - 说明预算调度并没有真正切碎任务，单个 `finalize` 自身就过重

3. `scatter.distributeMs` 与 `mutationQueue`
   - `scatter.distributeMs` 在大 chunk 上可到 `3ms+`
   - `mutationQueueBlocks` 峰值超过 `5000`
   - 当前队列选择算法会随着任务堆积增加额外检索成本，放大远端 chunk 上屏尾延迟

## 设计原则

### 1. 不牺牲远端 chunk 可见时机

chunk 首次可见的时机不能因为优化而明显后移。优化重点应放在：

- 去掉无效遍历
- 减少重复编码与重复检索
- 把粗粒度同步任务切成更小片段

而不是通过降低预算、减少每帧处理量来换取“更平滑但更晚显示”。

### 2. 先做主线程路径的确定收益项

第一阶段不优先改 Worker 协议，而是先优化当前代码路径中最明确的热点：

- `BlockScatterManager.flushReadyChunks()` 的全表扫描
- `ChunkAssemblyScheduler` 下 `finalize` 任务过粗
- `GlobalInstancedMeshManager.mutationQueue` 的线性选任务成本

### 3. 保持现有语义和回退路径

第一阶段不改变以下行为语义：

- 远端 chunk 仍在 Worker 回包后尽快进入可见状态
- 跨 chunk patch 的 deferred 机制保持现有含义
- runtime streaming chunk 的 deferred finalize 行为仍保留

## 方案对比

### 方案 A：最小侵入，先改主线程 scatter/assembly 路径

核心改动：

- `flushReadyChunks()` 改成只处理“本次触达且已满足条件的 chunk”
- `finalize` 拆成更细的装配阶段
- `mutationQueue` 改为“选中任务后批量消费”，减少每个 block 的重复检索

优点：

- 风险最低
- 收益最确定
- 不需要先修改 Worker 协议
- 不改变 chunk 首次可见时机

缺点：

- `scatter()` 的逐 block 分发成本仍然存在
- 后续仍值得继续推进更深层协议优化

### 方案 B：改 Worker 回包协议，直接按目标 chunk 分组

核心改动：

- Worker 直接返回按目标 chunk 分组的 payload
- 主线程不再逐 block 重新计算归属 chunk

优点：

- 能进一步降低 `scatter.distributeMs`
- 主线程编码、分组、字符串 key 构造都会下降

缺点：

- 风险更高
- 回归范围更大
- 不适合在第一阶段和装配切片同时混合推进

### 方案 C：只调 budget

不采用。

原因：

- 这会更接近“降低吞吐换平滑”，不符合当前目标
- 现在的问题是单个 task 太粗，不是预算数值本身不合理

## 最终采用方案

采用方案 A，分为三个优先级阶段推进。

## P0：Scatter 路径去全表扫描

### 目标

把 `block-scatter.flush-ready` 从“与全部 buffer 数量相关”改成“只与本次实际变化的 chunk 数量相关”。

### 设计

在 `BlockScatterManager` 中新增“待消费 ready chunk key 队列”：

- `scatter()` 在处理本次 Worker 回包时，只记录本次实际被触达的 chunk key
- 对于满足渲染或追加条件的 chunk key，加入待消费集合/队列
- `flushReadyChunks()` 不再遍历整个 `chunkBuffers`
- 改为消费本次待处理 key，并只对这些 chunk 执行 `acceptScatteredBlocks()` 或 `appendScatteredBlocks()`

### 预期收益

- 消除 `acceptedChunks = 1` 却仍扫描 `30+` appended buffer 的固定成本
- 明显降低 `block-scatter.flush-ready`

### 风险

- 需要避免重复入队
- 需要避免某些 ready buffer 因状态变化漏处理

## P1：Assembly/finalize 切片

### 目标

把目前单个 `finalize` 的大块同步工作切开，避免单 task 超过 `8ms` 预算。

### 设计

把 `finalize` 拆成更细的阶段，例如：

- `finalize-ready`
  - 做 ready 标记
  - 清理本阶段轻量状态
  - 触发后续 finalize 子任务排队

- `finalize-ao`
  - 处理 `onChunkFinalized()` 中 AO 稳定源相关工作
  - 避免在一个同步 task 里做完整 chunk + 邻居 AO 刷新链路

- `finalize-post`
  - 执行 deferred finalize 挂钩或轻量收尾逻辑

### 关键策略

- chunk 可见性优先，AO 修正紧随其后
- 不把远端 chunk 首屏显示挪到更后面
- 预算要真正作用于多个小 task，而不是一个大 task

### 预期收益

- 降低 `chunk-assembly.task(finalize)` 峰值
- 降低 `requestAnimationFrame` 长帧概率

### 风险

- 状态机切片后，容易出现 ready、AO、deferred finalize 状态不同步
- 需要确保每个子阶段都能幂等执行

## P2：MutationQueue 检索降复杂度

### 目标

降低 `GlobalInstancedMeshManager.flushMutationQueue()` 在高积压时的检索开销，减少远端 chunk 上屏尾延迟。

### 设计

第一阶段不直接引入堆结构，先做低风险优化：

- 当前实现是“每处理一个 block，重新线性扫描整个 `mutationQueue` 找最近任务”
- 改成“选中一个最近 task 后，连续消费该 task 的一批 entries”
- 批量消费结束后，再重新选择下一个 task

### 后续扩展

如果第一阶段收益明显但仍有积压，可继续演进为：

- 按距离分桶
- 或最小堆/优先队列

### 预期收益

- 当 `mutationQueueTasks`、`mutationQueueBlocks` 较高时，减少纯检索损耗
- 加快可见实例补齐速度

## 验证标准

### 日志指标

重点观察：

- `block-scatter.flush-ready`
- `block-scatter.scatter`
- `chunk-assembly.task` 中 `finalize`
- `chunk-assembly.process`
- `StreamingPerf.flushMaxMs`
- `StreamingPerf.mutationQueueBlocks`

### 通过标准

满足以下条件即认为设计达成目标：

- `flush-ready` 相比当前基线明显下降
- `finalize` 不再频繁出现 `10ms+` 单任务
- `requestAnimationFrame` 相关 violation 明显减少
- 远端 chunk 首次可见时间不变差，最好更快

## 不在本轮范围内

本轮暂不包含：

- Worker 回包协议重构为按目标 chunk 直接分组
- `acceptScatteredBlocks()` / `_initArrayStorageFromBlockData()` 的彻底增量化重构
- AO 算法本身的重写
- WorldWorker 端结构生成策略重构

这些内容可作为后续第二轮优化方向。
