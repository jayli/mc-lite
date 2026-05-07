# BlockData Render Cache Design

日期：2026-05-01  
分支：`gen-big-map-first`  
定位：P0 快速上屏缓存层设计修订版

## 背景

`WorldStore` 重构后，chunk 纯加载已经不再需要重新生成地形，但 runtime 仍然会在主线程重新解释 `blockData`，再构建首帧上屏所需的 `meshData / visibleKeys`。当前真实热点不在“是否从存档读到 blockData”，而在“读到之后仍然要重新遍历并转换一次”。

结合当前代码，问题已经比较明确：

1. `Chunk.loadFromRecord()` 注入 `blockData` 后，runtime build 阶段仍会进入主线程 `_buildMeshFromExistingBlockData()`。
2. `WorldWorker` 已经具备产出 `meshData / visibleKeys` 的能力，但这些结果没有作为稳定缓存进入 `ChunkRecord`。
3. `WorldRuntime / WorldStore` 当前只投影 `blockData/staticEntities/runtimeSeedData/runtimeEntities`，任何新加的 `renderCache` 字段都会被读写链路吞掉。
4. region 预生成完成后还会在主线程合并 cross-region overflow，这一步会让“预先算好的 mesh cache”立即过期。

因此，P0 的核心不是“再设计一种新渲染格式”，而是：

- 给 `ChunkRecord` 增加非权威 `renderCache`
- 让 runtime 纯加载优先消费它
- 让缓存失效规则是 O(1) 判定
- 让现有 pregen / consolidation / flush 链路不会把缓存写丢或写脏

## 目标

1. 消灭 `load-from-record` 主线程里对 `blockData` 的重复扫描和 `meshData` 重建。
2. 保持 `blockData` 为唯一权威世界真相，`renderCache` 只是快速上屏副本。
3. 缓存失效判定必须是 O(1)，不能为了校验 cache 再次全量遍历 `blockData`。
4. 缓存缺失、过期、版本升级、overflow 污染时都能安全回退到稳定路径。
5. 第一版尽量复用现有 `WorldWorker` 输出与 `buildMeshes()` 输入，不重写渲染提交格式。

## 非目标

1. 第一版不解决 `RegionRecord` 整包回主线程的消息体偏大问题。
2. 第一版不重写 `GlobalInstancedMeshManager` 的 mutation queue。
3. 第一版不把所有 chunk 派生状态都缓存化。
4. 第一版不把 `lightSourceCoords` 恢复链路也一起做成缓存优先。
5. 第一版不拆独立 `render_cache` store。
6. 第一版不把 worker fallback render cache build 作为必需主链路。

## 当前代码现实

### 纯加载热路径

当前 runtime 纯加载真实路径是：

```text
WorldRuntime.ensureChunkData()
-> Chunk.loadFromRecord()
-> loadState = record-ready
-> Chunk.assembleRuntimeBuildPhase()
-> _buildMeshFromExistingBlockData()
-> 遍历 this.blockData
-> _convertScatteredBlocksToMeshData()
-> buildMeshes()
```

说明：

- 设计目标必须覆盖 `assembleRuntimeBuildPhase()`，不能只改 `loadFromRecord()`。
- 只要 `_buildMeshFromExistingBlockData()` 仍是 `record-ready` 主路径，就没有真正消灭卡顿。

### worker 侧现有能力

`WorldWorker` 已经能输出：

- `meshData`
- `visibleKeys`
- `solidBlocks`
- `structureCenters`
- `scatteredBlocks`

这意味着 P0 不应该引入第二套 mesh 构建逻辑，而应直接复用现有 worker 结果去组装 `renderCache`。

### 读写链路现状

当前以下路径都会重建或截断 `chunkRecord`：

- `WorldRuntime.ensureChunkData()`
- `WorldStore._extractChunkRecord()`
- `WorldRuntime.flushChunk()`
- `WorldRuntime.flushAllDirty()`
- `PersistenceWorker.applyRegionPatch()`

如果不先改这些地方，新增的 `renderCache` 字段会出现以下问题：

1. 读不出来
2. 写回时被覆盖丢失
3. pending unload patch 时被旧数据回滚

所以“先接入 Chunk 消费 renderCache，再补数据层”这个顺序是错的。

## 方案对比

### 方案 A：load miss 时只把转换挪到 worker，不持久化

优点：

- 改动集中
- 不增加存储体积

缺点：

- 每次纯加载仍要重新算一次
- 无法复用 pregen / consolidation 已有结果
- 只是把卡顿从主线程换到 worker 等待，不是快速上屏

结论：

- 适合作为 fallback，不适合作为 P0 主方案

### 方案 B：在 `ChunkRecord` 中内嵌 `renderCache`

优点：

- 最符合“空间换时间”
- 能直接复用 worker 已有输出
- 对现有 `Chunk.buildMeshes()` 侵入最小

缺点：

- `RegionRecord` 体积增大
- 需要明确失效与保留规则
- 需要修正 `WorldRuntime/WorldStore` 投影链路

结论：

- 这是 P0 正确主方案

### 方案 C：独立 `render_cache` store

优点：

- 权威数据与缓存边界最干净
- 更利于未来做 chunk 级独立读取

缺点：

- 第一版复杂度过高
- 双 store 协调会扩大战线

结论：

- 留给 P1/P2，不在当前落地

## 设计结论

P0 采用方案 B：在 `ChunkRecord` 中内嵌 `renderCache`，但要补两个关键约束：

1. 不使用 `sourceHash` 作为首版失效机制。
2. 先打通 `renderCache` 的读写保真，再接入 runtime 消费。

## 数据模型

### 当前 `ChunkRecord`

```js
{
  blockData,
  staticEntities,
  runtimeSeedData,
  runtimeEntities
}
```

### 目标 `ChunkRecord`

```js
{
  blockData,
  staticEntities,
  runtimeSeedData,
  runtimeEntities,
  contentRevision: 12,
  renderCache: {
    schemaVersion: 1,
    contentRevision: 12,
    generatorVersion: 'render-cache-v1',
    generatedAt: 1714450000000,
    meshData: [...],
    visibleKeys: [...]
  }
}
```

### 运行时 `Chunk` 实例状态

为了避免 flush 和 unload 路径从旧快照反推出错误版本，`Chunk` 实例在 P0 必须显式持有：

```js
{
  contentRevision: 12,
  renderCache: { ... } | null,
  renderCacheStatus: 'hit' | 'miss' | 'stale' | 'dirty-by-overflow'
}
```

规则：

- `loadFromRecord()` 负责把 `chunkRecord.contentRevision/renderCache` 挂到实例
- runtime 修改 `blockData` 时，先更新实例 `contentRevision`
- flush / pending unload / consolidation 写回时，以实例状态为最高优先级来源

## 为什么不用 `sourceHash`

原方案中的 `sourceHash(blockData)` 有一个根本问题：

- 为了验证 cache 是否有效，runtime 仍要再次遍历整个 `blockData`

这会把 P0 想消灭的主线程扫描重新引回来。即使放在 worker，也会增加加载等待。

因此第一版改用：

- `contentRevision` 作为权威内容版本号
- `renderCache.contentRevision` 作为缓存绑定版本号

命中条件变成：

```text
renderCache.schemaVersion === CURRENT_SCHEMA_VERSION
&& renderCache.contentRevision === chunkRecord.contentRevision
&& renderCache 结构完整
```

这是一组 O(1) 比较。

## `contentRevision` 规则

### 初始值

- 新生成 chunk：`contentRevision = 1`
- 旧档无该字段：按 `1` 兼容读取，且视 `renderCache` 不存在

### 递增时机

任何会改变 `blockData` 权威内容的路径都必须递增：

1. 预生成新 chunk 初次写入
2. runtime 放置/破坏方块后 flush
3. consolidation 产出稳定新结果后准备持久化
4. cross-region overflow 合并进 chunk 时

### 不递增时机

以下情况不应递增：

1. 仅 runtimeEntities 改变
2. 仅 UI / 调试状态变化
3. 仅 AO attribute 局部刷新但权威 `blockData` 未变

### 单调性约束

`contentRevision` 必须单调递增，不允许任何持久化路径回退。

具体要求：

1. 新 patch 不得用更小的 `contentRevision` 覆盖更大的 `contentRevision`
2. `renderCache.contentRevision` 必须等于其绑定的 `chunkRecord.contentRevision`
3. 任何只补写 `renderCache` 的 patch，若携带 `contentRevision`，也必须满足不回退

## `renderCache` 最小字段

P0 先只缓存首帧快速上屏真正需要的字段：

### 必需

- `schemaVersion`
- `contentRevision`
- `generatorVersion`
- `generatedAt`
- `meshData`
- `visibleKeys`

其中 `meshData` 第一版沿用现有 worker 结构，包含：

- `type`
- `count`
- `matrices`
- `aoLow`
- `aoHigh`
- `orientation`
- `instanceIndexMap`

### 暂缓

- `lightSources`
- `solidBlocks`
- 其他派生索引

原因：

- `lightSourceCoords` 和 `solidBlocks` 目前已经在 `_injectBlockData()` 时恢复
- 如果不连带重构这段初始化逻辑，先缓存它们收益有限，只会增大消息体和存储体积
- 后续若继续优化 `load-from-record` 的尾部遍历，`lightSources` 是第一候选扩展字段

## `renderCache` 序列化规范

worker 侧 `meshData` 目前包含多个 TypedArray。P0 必须定义持久化格式，避免写入 IndexedDB 后结构损坏。

### 持久化格式

写入 `ChunkRecord.renderCache` 时：

- `Float32Array` -> 普通数组
- `instanceIndexMap` 保持普通对象

示意：

```js
{
  matrices: Array.from(float32Matrices),
  aoLow: Array.from(float32AoLow),
  aoHigh: Array.from(float32AoHigh),
  orientation: Array.from(float32Orientation),
  instanceIndexMap: { ... }
}
```

### 运行时恢复格式

从 `ChunkRecord.renderCache` 读取时：

- `matrices` 恢复为 `new Float32Array(...)`
- `aoLow/aoHigh/orientation` 恢复为 `new Float32Array(...)`
- `instanceIndexMap` 直接复用

因此 P0 需要显式的：

- `serializeRenderCache()`
- `deserializeRenderCache()`

## 缓存状态机

定义 4 种状态：

### `hit`

- `renderCache` 存在
- schema/version 匹配
- 结构完整

运行时行为：

- 直接 `_applyRenderCache()`
- 跳过 `_buildMeshFromExistingBlockData()`

### `miss`

- `renderCache` 不存在

运行时行为：

- 第一版可直接走现有主线程 `_buildMeshFromExistingBlockData()` 兜底
- 若后续启用 worker fallback，则作为 P1 增强，而不是 P0 必需项

### `stale`

- `renderCache.contentRevision !== chunkRecord.contentRevision`
- 或 `schemaVersion` 不匹配

运行时行为：

- 与 miss 相同

### `dirty-by-overflow`

- pregen 后 chunk 又被合并了 cross-region overflow
- 或主线程已知该 chunk 的 cache 不再可信

运行时行为：

- 直接视作 miss
- P0 不尝试在主线程同步修 cache

## 字段来源优先级

P0 必须明确不同运行时来源在写回时的优先级，避免旧快照覆盖新状态。

优先级从高到低：

1. `Chunk` 实例当前状态
2. `pendingUnloadFlushQueue` 中较新的 chunk snapshot
3. `_getCachedChunkRecord()` 返回值
4. `WorldStore` 中的默认值

约束：

- `cachedChunkRecord` 只能补缺字段，不能覆盖实例上的 `contentRevision/renderCache`
- `pendingUnloadFlushQueue` 中的 snapshot 必须包含 `contentRevision/renderCache`
- 若 queue snapshot 的 revision 小于 chunk 实例 revision，禁止回写覆盖

## 生成链路

### 链路 1：预生成阶段

`WorldWorker.generateRegion` 现有输出里已经带有 `meshData / visibleKeys`。  
P0 直接复用这些结果构造 `renderCache`。

但要注意一个现实约束：

- region 结果写入前，`WorldGenerationService` 还会把历史暂存的 cross-region overflow 合并进 `blockData`

因此：

- 对未被 overflow 影响的 chunk，直接保留 worker 产出的 `renderCache`
- 对被 overflow 修改过的 chunk，P0 先清空 `renderCache`，只保留更新后的 `blockData + contentRevision`

不要在主线程为了补 cache 再做一轮大遍历。

### 链路 2：consolidation 阶段

consolidation worker 已经返回：

- `meshData`
- `visibleKeys`

P0 直接在 `_applyConsolidateResult()` 成功后组装新的 `renderCache`，挂到 chunk 的稳定持久化快照上。

这一步是运行时修改后“下次 reload 仍能快上屏”的关键。

### 链路 3：fallback 重建

当 cache miss/stale 时：

1. chunk 进入 `waiting-render-cache`
2. P0 默认直接走主线程稳定兜底 `_buildMeshFromExistingBlockData()`
3. 后续若进入 P1，可改成 worker 根据当前 `blockData` 构建 `renderCache`
4. worker fallback 不是 P0 必需项

因此 P0 的目标是“hit 快”，不是“所有 miss 都异步化”。

## 运行时加载链路

### 当前路径

```text
chunkRecord
-> loadFromRecord()
-> assembleRuntimeBuildPhase()
-> _buildMeshFromExistingBlockData()
-> buildMeshes()
```

### 目标路径

```text
chunkRecord
-> loadFromRecord()
-> validateRenderCacheStatus()
-> hit: _applyRenderCache()
-> buildMeshes(renderCache.meshData)
```

### miss/stale 路径（P0）

```text
chunkRecord
-> loadFromRecord()
-> validateRenderCacheStatus()
-> 主线程 _buildMeshFromExistingBlockData()
-> buildMeshes()
```

### miss/stale 路径（P1 可选增强）

```text
chunkRecord
-> loadFromRecord()
-> validateRenderCacheStatus()
-> waiting-render-cache
-> worker build render cache
-> _applyRenderCache()
-> 后台补写 WorldStore
```

## 存储层约束

P0 必须先满足以下条件，否则 cache 会被写丢：

1. `WorldStore._extractChunkRecord()` 要投影 `contentRevision/renderCache`
2. `WorldRuntime.ensureChunkData()` 要把它们传给 `Chunk.loadFromRecord()`
3. `flushChunk()/flushAllDirty()` 在未改动 `blockData` 但补写 cache 时，不能覆盖掉已有权威数据
4. `PersistenceWorker.applyRegionPatch()` 要允许 patch 只更新 `renderCache/contentRevision`
5. pending unload queue 要保留最新 cache，而不是回退成旧 chunkRecord
6. `_getCachedChunkRecord()` 只能作为补缺来源，不能覆盖实例当前 revision
7. `applyChunkPatchToRegion()` 如遇到更小的 `contentRevision`，不得覆盖更大的现值

## 内存与体积风险

把 `meshData` 直接塞进 `ChunkRecord` 会扩大两类开销：

1. IndexedDB 中的 region record 体积
2. `RegionCache` 常驻内存体积

因此 P0 需要加观测，不先做复杂压缩：

- 单 chunk `renderCache` 大小
- 单 region 总字节数
- `cache-hit/miss/stale` 比例
- `load-from-record` 耗时

如果体积异常，再决定是否进入 P1 做独立 store 或压缩。

## 兼容与回退

### 旧档兼容

- 无 `contentRevision`：读取时视为 `1`
- 无 `renderCache`：正常 miss，P0 走主线程稳定兜底，P1 可升级为 worker fallback

### 版本升级

- 只要 `schemaVersion` 不匹配，直接 miss

### 功能开关

建议增加显式开关：

- `ENABLE_RENDER_CACHE`

便于：

1. A/B 对比性能
2. 问题回退
3. 定位 cache 相关 bug

## 测试要求

P0 至少覆盖：

1. `renderCache/contentRevision` 在 `WorldStore/WorldRuntime` 投影链路中不丢失
2. cache hit 时 `assembleRuntimeBuildPhase()` 不再调用 `_buildMeshFromExistingBlockData()`
3. cache miss/stale 时 P0 可稳定兜底，P1 再升级为 worker fallback
4. pregen + overflow 场景中受影响 chunk 不错误复用旧 cache
5. consolidation 后新 cache 会进入后续持久化写回
6. 旧档无 cache 时能正常加载
7. `pendingUnloadFlushQueue` / `_getCachedChunkRecord()` / patch merge 不会导致 revision 回退
8. render cache 的 TypedArray 序列化与反序列化正确
9. `instanceIndexMap` 在缓存读写后仍可直接使用，不需要重建

## 最终建议

P0 正确顺序应当是：

1. 先打通 `contentRevision/renderCache` 的读写保真
2. 再让 pregen / consolidation 生产 cache
3. 再让 runtime 消费 cache
4. 最后补性能观测和 feature flag
5. worker fallback 作为 P1 可选增强单独推进

核心判断标准只有两个：

1. cache hit 时，主线程不再扫描 `blockData` 构建 `meshData`
2. cache miss/stale 时，不会因为写回链路不完整而把缓存写丢或写脏
