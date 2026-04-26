# WorldStore Runtime Streaming 设计

## 目标

把主世界改造成以 IndexedDB 为权威数据源的预生成世界：

- 进入主世界前阻塞预生成一片初始大地图
- 运行期 chunk 装载只读取权威世界数据，不再即时生成地形或结构
- 玩家与世界交互只命中运行时 `blockData`，不直接参与 IndexedDB 读写
- 玩家接近地图边缘时后台扩图；扩图未完成前使用硬边界阻挡

## 第一版范围

第一版只支持新档，不兼容旧存档迁移。

第一版必须同时覆盖：

- 预生成大地图
- runtime 纯装载
- 玩家交互统一入口
- 边界扩图与硬边界
- 跨 chunk 结构/实体方块在预生成阶段一次性固化

第一版暂不追求：

- 旧存档兼容
- 最优压缩存储格式
- 独立拆分多个 worker 文件

## 现状问题

当前世界流式链路仍然把“生成世界”和“装载世界”混在一起：

1. `Chunk` 创建时立即进入 `gen()`
2. `ChunkGenerator.gen()` 先读持久化快照，再走统一 `WorldWorker` 协议
3. `skipTerrainGeneration` 只是 worker 内部分支，不是独立装载管线
4. 玩家交互大量依赖已加载 chunk 的裸内存结构
5. 跨 chunk 结构处理与 runtime chunk 生命周期仍然耦合

这会导致：

- 奔跑时远端 chunk 仍然混入世界生成语义
- 交互实现与 chunk 内部结构过度耦合
- 很难把 IndexedDB 提升为真正权威世界

## 核心原则

### 1. WorldStore 才是权威真相

第一版中，IndexedDB 上的 `WorldStore` 是最终权威：

- `WorldMeta`
- `RegionRecord`
- `ChunkRecord`
- 静态实体
- 世界边界

runtime `blockData` 只是某个活动 chunk 的内存视图，不是世界真相。

### 2. 玩家只和运行时世界交互

玩家及业务系统不直接等待 IndexedDB。

上层通过 `WorldAccessLayer` 访问世界：

- `getBlock`
- `isSolid`
- `setBlock`
- `removeBlock`
- `applyBatchEdits`
- `getCollisionAt`

这些操作底层优先命中运行时 `blockData`，数据库同步由底层自动处理。

### 3. 生成和装载彻底分离

预生成/扩图属于 `WorldGenerationService`。

runtime chunk 加载只做：

- 读取权威数据
- 展开 `blockData`
- 计算 AO / visible face / render payload
- 分帧挂载渲染结果

不再做：

- 噪声地形生成
- 结构放置
- 跨 chunk owner 修补

### 4. 跨 chunk 结构必须在预生成阶段固化

跨 chunk 的树、建筑、结构方块、静态实体碰撞占位必须在 region 预生成时完整落地。

运行时 chunk 装载只读取最终结果，不允许再补丁。

## 系统分层

### WorldStore

权威世界存储接口，底层基于 IndexedDB。

职责：

- 读取/保存 `WorldMeta`
- 读取/保存 `RegionRecord`
- 投影读取某个 `ChunkRecord`
- 合并写回 chunk 编辑

### WorldGenerationService

世界生成服务。

职责：

- 新档初始大地图阻塞预生成
- 接近边界时后台扩图
- 使用 region 级生成缓冲区处理跨 chunk 结构
- 把结果写入 `WorldStore`

### WorldRuntime

运行时工作集层。

职责：

- 管理 `RegionCache`
- 创建/释放 runtime chunk 视图
- 调度 chunk 纯装载 worker
- 维护脏 chunk 写回队列
- 协调扩图与边界状态

### WorldAccessLayer

统一世界访问层。

职责：

- 统一查询与编辑入口
- 屏蔽 chunk/view/store 差异
- 统一跨 chunk 编辑
- 统一边界阻挡逻辑

### ChunkRenderPipeline

纯渲染装载层。

职责：

- 从 runtime `blockData` 派生可见面/AO/mesh payload
- 主线程分帧挂载渲染结果

## 数据模型

### WorldMeta

保存：

- `schemaVersion`
- `worldId`
- `seed`
- `chunkSize`
- `regionSizeInChunks`
- `generatedBounds`
- `safeBounds`
- `expandTargetBounds`
- `generationState`
- `generatorVersion`
- `playerSpawn`

其中：

- `generatedBounds` 是已生成世界边界
- `safeBounds` 是玩家可活动边界
- `expandTargetBounds` 是后台扩图目标边界

### RegionRecord

IndexedDB 的物理存储单元，建议固定为 `8x8` chunk。

保存：

- `regionKey`
- `rx`
- `rz`
- `chunkKeys`
- `chunks`
- `generatedAt`
- `generatorVersion`

### ChunkRecord

某个 chunk 的最终权威成品。

保存：

- `chunkKey`
- `cx`
- `cz`
- `blockData`
- `staticEntities`
- `runtimeSeedData`
- `structureCenters`

要求：

- `blockData` 已完成 owner 固化
- 不能包含属于邻居 chunk 的权威方块

### StaticEntityRecord

用于表达不适合纯 `blockData` 表达的静态对象，例如特殊模型与碰撞占位。

### RegionGenerationBuffer

只存在于生成阶段，不落盘。

保存：

- region 级 `blockMap`
- `staticEntities`
- `structureCenters`
- `collisionOccupancy`
- `touchedChunkKeys`

所有地形、结构、跨 chunk 方块先写这里，再按坐标所属 chunk 切分为多个 `ChunkRecord`。

## BlockData 与 IndexedDB 的关系

第一版中：

- IndexedDB / `WorldStore` 更权威
- runtime `blockData` 是内存工作集视图

### 什么时候从 IndexedDB 读到 blockData

1. 进入主世界后首次加载活动 chunk
2. 玩家奔跑时加载新的远端 chunk
3. chunk 卸载后重新进入，且 region 不在内存缓存中

### 什么时候回写 IndexedDB

1. 玩家放置/破坏方块后异步写回
2. 持久化实体状态变化后异步写回
3. chunk 卸载前脏数据兜底 flush
4. 世界扩图生成完成后由生成服务直接写入

### 不回写的派生数据

以下数据不视为权威状态：

- `visibleKeys`
- `solidBlocks`
- `blockDataArray`
- AO 结果
- mesh 数据

这些都应当由 runtime `blockData` 重建。

## 关键时序

### 进入主世界前

1. 新档初始化 `WorldMeta`
2. `WorldGenerationService` 阻塞预生成初始世界
3. 把生成结果写入 `WorldStore`
4. 更新 `generatedBounds` 和 `safeBounds`
5. 允许玩家出生

### runtime chunk 装载

1. `WorldRuntime` 计算需要加载的 chunk
2. 优先从 `RegionCache` 读取
3. 不命中时从 `WorldStore` 读取整个 `RegionRecord`
4. 切出目标 `ChunkRecord`
5. 创建 runtime chunk 视图并展开 `blockData`
6. 派生 `blockDataArray / solidBlocks`
7. 送入 `ChunkRenderPipeline`
8. worker 只计算 AO / visible face / render payload
9. 主线程分帧挂载渲染结果

### 玩家交互

1. `PlayerInteraction` / `Physics` 通过 `WorldAccessLayer` 调用
2. `WorldAccessLayer` 定位活动 chunk
3. 直接修改 runtime `blockData`
4. 更新派生缓存、AO 脏位、渲染 patch
5. 登记写回队列
6. 异步合并到 `WorldStore`

### 边界扩图

1. 玩家接近 `safeBounds`
2. 触发后台扩图
3. 新 region 生成并写入 `WorldStore`
4. 更新 `generatedBounds / safeBounds`
5. 扩图完成前，硬边界阻挡玩家继续外扩

## 模块落点

### 新增模块

- `src/world/WorldStore.js`
- `src/world/WorldGenerationService.js`
- `src/world/WorldAccessLayer.js`
- `src/world/WorldRuntime.js`
- `src/world/RegionCache.js`
- `src/world/WorldBoundsController.js`

### 保留并迁移职责

- `src/world/World.js`
- `src/world/Chunk.js`
- `src/services/PersistenceService.js`
- `src/world/ChunkGenerator.js`

### worker 职责拆分

第一版在现有 `WorldWorker` 中区分两种消息模式：

- `generate-region`
- `build-chunk-mesh`

验证通过后再考虑物理拆分成两个 worker 文件。

## 第一版验收标准

### 功能

- 进入世界前完成初始大地图预生成
- runtime 奔跑时不再触发地形生成
- 玩家挖掘/放置/碰撞行为保持正确
- 接近边界时触发后台扩图
- 扩图未完成前存在明确硬边界

### 性能

- 远端 chunk 装载链路不再混入世界生成成本
- 玩家交互热路径不等待 IndexedDB
- runtime chunk 装载主要消耗集中在 AO / 可见面 / 渲染挂载

## 风险

1. `PersistenceService.cache` 当前是 chunk 级 `Map`，需要升级为 region 工作集
2. 现有 `Chunk` 过于中心化，职责迁移过程中容易遗漏调用点
3. 批量编辑、爆炸、跨 chunk 交互需要统一走 `WorldAccessLayer`
4. 预生成世界与运行时实体状态需要严格区分

## 最终建议

第一版优先顺序应为：

1. 抽出 `WorldAccessLayer`
2. 新增 `WorldStore`
3. 实现新档初始预生成
4. 切 runtime chunk 装载到 `WorldStore`
5. 接入边界扩图与硬边界

这样可以先做对世界真相与交互边界，再逐步替换 runtime 装载主链路。
