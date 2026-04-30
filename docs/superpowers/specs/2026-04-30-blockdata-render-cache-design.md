# BlockData Render Cache Design

日期：2026-04-30  
分支：`gen-big-map-first`  
代码基线：`fc0eba235a8454507c6e87548c7a746ce7324366`

## 背景

当前 `worldStore` 重构已经完成了权威数据源迁移、运行时内存与 IndexedDB IO 解耦、Region 级预生成和特殊实体的 shadow sync 隔离。现阶段运行时掉帧主因已经不再是“地图生成还在主线程”，而是 chunk 从 `WorldStore` 读出后，主线程仍要重新扫描 `blockData`，构建上屏所需的 `meshData / visibleKeys / lightSources`。

现有日志显示：

- `chunk.load-from-record`: `5.2ms ~ 12.5ms`
- `convertMeshDataMs`: `2.6ms ~ 9.9ms`
- `chunk.build-meshes-global`: `1.8ms ~ 3.3ms`
- `StreamingPerf.mutationQueueBlocks`: 峰值可达 `9k ~ 16k`
- `WorkerRpcClient.js:15 message handler`: 可见 `305ms / 448ms` 级别的跨线程大对象传输尖峰

说明问题已经转移到：

1. runtime 主线程重复解释 `blockData`
2. region 级大对象在主线程和 worker 之间搬运
3. 上屏实例提交吞吐不足

本设计专注解决第 1 点，并为第 2 点留下兼容接口。

## 目标

1. 消灭 `load-from-record` 主线程里对 `blockData` 的重复扫描和 `meshData` 重建
2. 保持 `blockData` 作为唯一权威世界真相，不让缓存层影响数据正确性
3. 允许缓存缺失、过期、版本升级时安全回退到 worker 重建
4. 尽量复用现有 `WorldStore / RegionRecord / ChunkRecord / global instanced manager` 架构，不做第一版过度拆分

## 非目标

1. 第一版不解决 `RegionRecord` 整包回主线程的问题
2. 第一版不重写 `GlobalInstancedMeshManager` 的 mutation queue 机制
3. 第一版不改变 `runtimeEntities`、`ShadowSyncWorker` 的职责划分
4. 第一版不尝试把所有 AO 运行时逻辑都缓存化

## 方案对比

### 方案 A：仅把 `load-from-record` 的 mesh/AO 构建挪到 worker，即时生成，不持久化

做法：
- `Chunk.loadFromRecord()` 不在主线程 `_buildMeshFromExistingBlockData()`
- 改为把 `chunkRecord.blockData` 发给 worker，worker 返回 `meshData`
- 主线程只负责 `buildMeshes()`

优点：
- 代码改动相对集中
- 不增加存储体积
- 先把主线程 CPU 热点搬走

缺点：
- 每次 chunk 纯加载仍然要重新计算一次 mesh/AO
- 首次上屏延迟仍然受 worker 计算影响
- 无法把“预生成阶段已经算过的结果”复用到 runtime

结论：
- 适合作为兜底 fallback，不适合作为主方案

### 方案 B：在 `ChunkRecord` 中内嵌 `renderCache`，预生成和 consolidation 时生成，runtime 直接消费

做法：
- 在每个 chunk 权威记录旁边保存一份渲染缓存 `renderCache`
- `renderCache` 包含直接上屏所需的 `meshData / visibleKeys / lightSources`
- runtime 纯加载优先消费 `renderCache`
- 若 cache 缺失或过期，再回退到 worker 重建并补写

优点：
- 完全符合“用空间换 runtime 时间”的目标
- 能复用预生成阶段和 consolidation 阶段已经做过的计算
- `load-from-record` 主线程路径最短

缺点：
- 存储体积增大
- 缓存失效管理变复杂
- 如果继续按 region 整包回主线程，消息体可能更大

结论：
- 这是最符合当前架构目标的主方案

### 方案 C：把 `renderCache` 独立成单独 store，仅在 runtime 读取

做法：
- 权威数据继续存 `world_regions`
- 新增独立 `render_cache` store，按 chunk 或 region 存缓存
- runtime 先取 cache，再按需取权威 chunk record

优点：
- 权威数据和缓存数据边界最干净
- 可以独立清除缓存、独立升级版本
- 后续做 chunk 级直接读取时更灵活

缺点：
- 第一版工程复杂度更高
- 读路径变成双 store 协调
- 容易在第一版就引入过多同步规则

结论：
- 更适合作为第二阶段演进，不适合第一版直接上

## 结论与推荐

推荐先落地方案 B：在 `ChunkRecord` 中内嵌 `renderCache`，并明确它是非权威、可丢弃、可重建的快速上屏缓存层。

这条路线能在最少架构扰动下，直接消灭当前 `load-from-record` 的主线程热点。

## 数据模型

### 当前 ChunkRecord

```js
{
  blockData,
  staticEntities,
  runtimeSeedData,
  runtimeEntities
}
```

### 目标 ChunkRecord

```js
{
  blockData,
  staticEntities,
  runtimeSeedData,
  runtimeEntities,
  renderCache: {
    version: 1,
    sourceHash: "string",
    meshData: [
      {
        type,
        count,
        matrices,
        aoLow,
        aoHigh,
        orientation,
        instanceIndexMap
      }
    ],
    visibleKeys: [123, 456, 789],
    lightSources: [123, 456],
    generatedAt: 1714450000000,
    generatorVersion: "render-cache-v1"
  }
}
```

## 字段语义

### `version`

缓存结构版本号。用于未来 cache 格式升级时快速失效。

### `sourceHash`

由权威层内容计算得到的签名，至少覆盖：

- `blockData`
- 必要时覆盖影响 mesh 的 `runtimeSeedData.structureCenters`

第一版可以先实现稳定但不极致高效的 hash，例如：
- 先对 blockData key 排序
- 再对 `{ type, orientation }` 序列化后生成字符串 hash

要求不是密码学安全，而是稳定、一致、可检测是否过期。

### `meshData`

直接兼容现有 `buildMeshes()` / `replaceChunkVisibleBlocks()` 输入格式。第一版目标不是重新设计渲染提交格式，而是直接绕过主线程 `_convertScatteredBlocksToMeshData()`。

### `visibleKeys`

直接恢复 chunk 的可见块索引，避免 runtime 再从 `meshData` 或 `blockData` 反推。

### `lightSources`

直接恢复该 chunk 内的光源编码坐标，避免 finalize 或 deferred finalize 再遍历 `blockData`。

## 核心原则

1. `blockData` 永远权威
2. `renderCache` 永远非权威
3. 主线程只消费 cache，不负责修 cache
4. cache 缺失或过期时，由 worker 重建
5. cache 重建失败不影响世界正确性，只影响上屏延迟

## 生成链路

### 链路 1：预生成阶段

由 `WorldWorker.generateRegion` 产出每个 chunk 的：

- `blockData`
- `staticEntities`
- `runtimeSeedData`
- `renderCache`

再一起写入 `RegionRecord.chunks[chunkKey]`。

这样新档进入 runtime streaming 时，第一次加载就能直接消费 `renderCache`。

### 链路 2：运行时 consolidation 完成后

当前 consolidation 已经在 worker 重算可见面和 AO。此时应顺手产出新的 `renderCache`，并把它与最新 `blockData` 一起回写 `WorldStore`。

这样经过交互修改后的 chunk，在下一次卸载/重载时仍然能直接走快速上屏路径。

### 链路 3：缓存缺失或失效时

如果 `renderCache`：

- 不存在
- `version` 不匹配
- `sourceHash` 不匹配
- 结构校验失败

则：

1. runtime 发起 worker 重建请求
2. 当前 chunk 进入“等待渲染缓存”状态
3. worker 返回 `renderCache`
4. 主线程只负责挂载 mesh
5. 后台把新 cache 补写回 `WorldStore`

## 运行时加载链路

### 当前路径

```text
WorldStore chunkRecord
-> Chunk.loadFromRecord()
-> _injectBlockData()
-> _buildMeshFromExistingBlockData()
-> 遍历 blockData
-> _convertScatteredBlocksToMeshData()
-> buildMeshes()
```

### 目标路径

```text
WorldStore chunkRecord
-> Chunk.loadFromRecord()
-> _injectBlockData()   // 保留，作为运行时逻辑视图
-> validateRenderCache()
-> applyRenderCache()
-> buildMeshes(renderCache.meshData)
```

### fallback 路径

```text
WorldStore chunkRecord
-> renderCache invalid/missing
-> worker build render cache
-> applyRenderCache()
-> background patch WorldStore
```

## 主线程职责调整

### 保留

1. 注入 `blockData` 到 runtime 视图
2. 恢复 `runtimeEntities`/shadow store
3. 最终 mesh 挂载
4. deferred finalize

### 删除或降级为 fallback

1. `_buildMeshFromExistingBlockData()` 不再是主路径
2. `_convertScatteredBlocksToMeshData()` 不再在 `load-from-record` 期间主线程执行
3. `visibleKeys` 不再由主线程扫描 blockData 重建

## 失效规则

以下任一命中时，`renderCache` 失效：

1. `renderCache.version !== CURRENT_RENDER_CACHE_VERSION`
2. `renderCache.generatorVersion !== CURRENT_RENDER_CACHE_GENERATOR_VERSION`
3. `renderCache.sourceHash !== computeRenderCacheSourceHash(chunkRecord)`
4. `meshData` 缺字段或结构非法

第一版不追求局部修复，直接整块 chunk cache 重建。

## 存储位置

第一版建议直接内嵌到 `RegionRecord.chunks[chunkKey]`：

```js
region.chunks[chunkKey] = {
  blockData,
  staticEntities,
  runtimeSeedData,
  runtimeEntities,
  renderCache
};
```

原因：

1. 改动面最小
2. 不需要额外 store 协议
3. 与当前 `ChunkRecord` 读取方式兼容

已知代价：
- region record 变大
- 主线程和 worker 之间整包消息更重

但这属于下一阶段要继续解决的问题，不应该阻塞第一版先把 `load-from-record` 热点拿掉。

## 第二阶段演进方向

第一版稳定后，可以继续评估：

1. `renderCache` 独立 store
2. `PersistenceWorker` 直接提供 chunk 级投影读取
3. `meshData` 是否改成更适合 `GlobalInstancedMeshManager` 直接消费的紧凑格式
4. `visibleKeys` 是否需要改为 typed array / transferable 以降低 message 成本

## 风险与防护

### 风险 1：存储体积膨胀

防护：
- 接受这是“用空间换 runtime 时间”的设计取舍
- 第一版只缓存确实能消灭主线程热点的字段，不扩大范围

### 风险 2：缓存与权威数据不一致

防护：
- 严格坚持 `blockData` 权威、`renderCache` 非权威
- 统一用 `version + sourceHash` 判失效
- 不做主线程修补 cache

### 风险 3：region 级整包传输变更重

防护：
- 先落地 render cache 层，验证 `load-from-record` 热点是否消失
- 再推进 chunk 级投影读取，分阶段解决

## 测试策略

1. 单元测试
- `renderCache` 结构校验
- `sourceHash` 稳定性
- 失效判定逻辑
- cache 缺失时 fallback worker 重建

2. 集成测试
- 新档预生成后，runtime 纯加载直接消费 cache
- 玩家修改 chunk 后，consolidation 重建 cache 并持久化
- chunk unload/reload 后，不再走主线程 `convertMeshData`

3. 性能验证
- 对比优化前后 `chunk.load-from-record`
- 目标是把 `convertMeshDataMs` 从主线程热点中消灭
- 验证 `StreamingPerf` 下 mutation queue 是否下降

## 分阶段落地建议

### Phase 1

1. 定义 `renderCache` 数据结构和版本号
2. 在 `Chunk.loadFromRecord()` 中增加 `renderCache` 优先路径
3. 把 `_buildMeshFromExistingBlockData()` 降级为 fallback
4. 增加 worker 侧“从权威 chunkRecord 构建 renderCache”的能力

### Phase 2

1. 在预生成阶段写入 `renderCache`
2. 在 consolidation 回包中同步更新 `renderCache`
3. 增加持久化回写链路

### Phase 3

1. 评估是否拆出独立 cache store
2. 推进 chunk 级读取投影，减少 region 整包回主线程

## 最终结论

`renderCache` 不是一层可有可无的附加缓存，而是当前 `worldStore` 架构继续向“runtime 只做上屏、不做重计算”推进时必须补齐的一层。

它的职责边界应该非常明确：

- 不代表世界真相
- 不参与逻辑正确性判断
- 只负责 chunk 快速上屏
- 丢了可重建
- 过期可失效

第一版推荐以内嵌 `ChunkRecord.renderCache` 的方式落地，先直接消灭 `load-from-record` 期间那段 `3ms ~ 10ms / chunk` 的主线程重建成本，再继续处理 region 级大对象传输和 mutation queue 吞吐问题。
