# BlockData Authority Unification Design

> **Problem:** 当前 runtime 期间的逻辑方块真相被拆散在 `Chunk.blockData`、`MemoryWorldStore.chunks[].blockData`、`WorldRuntime` 的快照链、`PersistenceService.cache` 与 `PersistenceWorker.regionCache` 周围。结果是运行时既存在双权威语义，也存在多条全量 clone / region patch / flush queue 链路，导致数据层次复杂、拷贝次数多、`postMessage` 载荷过大，且后续优化难以落点。

## 1. Revised Scope

结合当前目标，本次设计做三条重要收敛：

1. **runtime 只解决内存中的权威数据正确流转**
2. **世界级 `blockData` 是唯一权威数据源**
3. **彻底删除 `MemoryWorldStore`，其职责并入 world-level `blockData`**

这意味着：

- `IndexedDB` 在本阶段不是必须能力
- 手动存档 / 读档延后到 runtime 架构稳定后再恢复
- chunk unload 不再承担“权威转移”职责
- 所有设计优先服务“运行中的正确性、清晰性、可优化性”

## 1.1 Phase Boundary

这一阶段是一个**runtime-only 的内存权威重构阶段**。

本阶段**必须保证**：

1. 运行中的内存权威语义清晰且唯一
2. loaded chunk 的编辑、生成、卸载、重载都围绕 world-level `blockData` 闭环
3. 后续性能优化可以围绕唯一 authority 落地，不再被双写、快照链、深拷贝牵制

本阶段**明确不作为交付门槛**：

1. `IndexedDB` 持久化正确性
2. 手动存档
3. 手动读档
4. JSON 导入 / 导出
5. 旧存档兼容性完整恢复

允许的过渡形态：

- 保留空接口、future hook、deprecated 壳层
- 保留冷存储 API 的最小兼容签名
- 保留用于测试夹具或下一阶段接入的序列化边界

不允许的回退：

- 为了保住旧持久化路径，把 runtime 正确性重新挂回 `WorldStore` / `PersistenceService` / `PersistenceWorker`
- 为了兼容旧接口，在热路径重新引入 `blockDataSnapshot`、整块 clone、卸载前同步 holder

## 2. Goal

本设计的目标是把运行时的逻辑真相统一收敛到 `blockData` 语义上，并在此基础上保留当前所有关键功能：

1. `blockData` 升级为**世界级唯一权威数据源**
2. `Chunk.blockData` 不再是独立第二份真相，而是 world-level `blockData` 在 chunk 实例中的局部运行时视图
3. 世界生成直接产出并写入 world-level `blockData`
4. 彻底删除 `MemoryWorldStore`
5. `Chunk.visibleKeys`、`Chunk.solidBlocks`、`Chunk.blockDataArray`、`Chunk.solidBlockIds` 继续保留，作为 chunk 层派生索引或高速查询结构
6. 消灭运行时的 blockData 全量快照链，减少 clone、序列化和跨线程传输次数，为后续性能优化打基础

## 2.1 Runtime Minimum Closed Loop

在不实现持久化的前提下，本阶段至少要形成以下 runtime 最小闭环：

1. **世界生成**
   - 生成结果直接进入 world-level authority
   - 当前 chunk 若已加载，直接挂载对应 slice 并重建派生层

2. **运行时编辑**
   - 玩家放置 / 删除 / 批量修改先命中 authority
   - loaded chunk 通过共享 slice 立即观察到变更
   - 派生索引、AO、render patch 随后增量更新

3. **chunk unload / reload**
   - unload 只销毁运行时视图与派生层
   - reload 从 world-level authority 重新 attach / hydrate
   - 不再依赖 unload flush、session cache、`WorldStore.commitChunkRecord()`

4. **跨 chunk patch**
   - 所有 patch 直接命中目标 chunk 的 authority slice
   - 不允许先堆积在某个 chunk-local staging blockData 中等待二次同步

5. **特殊实体兼容性**
   - 矿车、丧尸巢穴、炮塔等既有特殊实体在本阶段改造后必须继续正常运行
   - 必须保持与玩家、主世界、普通方块 authority 的互动行为不回退
   - chunk unload / reload 后，这些特殊实体的既有行为链路不得因 `blockData authority` 重构而失效

## 3. Non-Goals

本次设计明确不做以下事情：

1. 不重写 `visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds` 的用途与算法
2. 不改变 AO / Face Culling / Global Instanced Mesh 的核心渲染策略
3. 不把特殊实体逻辑硬塞进普通 `blockData` 语义
4. 不把 `entityCollisionIndex` 并入 `blockData` 或 `solidBlocks`
5. 不在本阶段实现新的 IndexedDB 持久化方案
6. 不在本阶段推进 TypedArray 化的权威存储
7. 不要求本次一并解决所有渲染性能热点

## 4. Current System Reality

### 4.1 当前真正的问题不是“有没有 blockData”，而是“权威边界不干净”

当前代码里：

- `Chunk.blockData` 已经是 loaded chunk 的完整逻辑块集合
- `MemoryWorldStore.chunks[].blockData` 实际承担 unload 后恢复职责
- `WorldRuntime._dirtyChunks[].blockDataSnapshot`、`pendingUnloadFlushQueue`、`PersistenceService.cache` 又构成了一套持久化过渡快照链

所以问题不是没有权威数据源，而是：

1. 同一个逻辑真相被多层持有
2. 不同层对“自己是不是权威”语义不一致
3. 写路径为照顾旧持久化链路发生了明显写放大

### 4.2 当前渲染与查询索引层本身不是主要矛盾

以下结构虽有重复信息，但职责合理，应保留：

- `Chunk.visibleKeys`
- `Chunk.solidBlocks`
- `Chunk.blockDataArray`
- `Chunk.solidBlockIds`
- `Chunk.blockPalette` / `Chunk.blockPaletteReverse`
- `meshData`
- `instanceIndexMap`
- `renderDelta`
- `lightSourceCoords`
- `dirtyAOPositions`
- `deletedBlockTombstones`

本次设计不是“去掉所有重复数据”，而是“去掉重复权威和重复快照链”。

### 4.3 新设计中，`blockData` 不能再等同于“某个 Chunk 实例上的 Map”

本次改造有一个核心前提：

- `Chunk.blockData` 只是 chunk 运行时对象上的访问入口
- 真正的 `blockData` 是**独立于 chunk 生命周期存在的世界级权威数据**

这意味着：

- chunk unload 不是“把真相写回另一个内存层”
- 而是“销毁一个运行时实例，但不销毁 world-level `blockData`”

所以目标是：

- 让 `Chunk.blockData` 从世界级权威数据中取用自己的 chunk slice
- 卸载时只释放派生层与渲染层，不再做“权威转移”

## 5. Proposed Authority Model

### 5.1 统一语义：`blockData` 是唯一逻辑真相

新模型里，`blockData` 作为概念上的唯一逻辑真相，覆盖：

- 地图中已知存在的方块
- 玩家修改后的方块
- 跨 chunk 结构归属到当前 chunk 的方块
- 需要以块形式存在的逻辑占位

但它不覆盖：

- 当前是否可见
- 当前实例索引
- 当前 AO attribute
- 当前是否已上传 GPU

这些都属于派生层。

### 5.2 统一权威持有模型

runtime 中只存在一份 world-level `blockData authority`：

1. **世界级权威层**
   - 持有者：`World.blockData` 或等价世界级 authority 容器
   - 允许写：是
   - 允许读：是
   - 生命周期：独立于 chunk 实例

2. **Chunk 运行时视图层**
   - 持有者：`Chunk.blockData`
   - 语义：指向 world-level `blockData` 中当前 chunk slice 的运行时访问入口
   - 存储身份：与 `WorldBlockDataStore` 内部该 chunk slice 共享同一个 `Map<number, entry>` 实例
   - 允许写：可以，但写入必须直接命中 world-level authority
   - 生命周期：随 chunk 加载/卸载而出现/消失

状态切换规则：

- `load`：创建 chunk 实例视图
- `unload`：销毁 chunk 实例视图
- world-level `blockData` 全程不发生“转移持有者”

补充约束：

- “共享同一个 `Map` 实例”意味着不存在“先写 world-level authority，再把结果同步写回另一份 `Chunk.blockData` 副本”的第二次写入
- `Chunk.blockData` 的共享身份只解决零拷贝视图问题，不意味着业务代码可以绕过受控写路径任意 `set/delete`
- runtime mutation 仍必须统一经过 `WorldAccessLayer`、`Chunk` 的受控 mutation 方法或 store 约定的单一写入口，以保证 `visibleKeys`、`solidBlocks`、`blockDataArray`、AO、tombstone、renderDelta` 等派生层一起更新

### 5.2.1 Shared Map Compatibility Rules

“共享同一个 `Map<number, entry>` 实例”是本次重构的性能核心，但它必须配套更严格的生命周期协议。

在 shared authority view 模式下：

1. `Chunk.blockData` 不再是可随意清空、重建、替换的 chunk-local 容器
2. `Chunk.blockData.clear()`、`Chunk.blockData = new Map()`、`for (...) delete + set` 这类直接改写整个容器身份或整体内容的行为，都必须被视为高风险操作
3. 除非语义上就是“删除整个 authority slice”，否则 `clear()` 在 shared view 模式下一律视为非法

这意味着当前旧实现里这类模式必须被设计层显式废止：

- `_clearForBlockInjection()` 通过 `this.blockData.clear()` 开始一次“重新注入”
- `_injectBlockData()` / `_injectBlockDataBatch()` 先清空 `this.blockData` 再逐条写入

这些做法在 chunk-local holder 模式下可行，但在 shared authority view 模式下会直接清空 world-level authority，因此不能带入新模型。

### 5.3 删除 `MemoryWorldStore`

本设计的目标态中：

- 不保留 `MemoryWorldStore`
- 不保留“loaded / unloaded 双 holder”模型
- 不保留任何“卸载前把权威同步到另一个内存层”的语义

需要留下来的能力只有：

- world-level `blockData`
- world-level chunk record 索引
- chunk 视图的加载和释放

### 5.3.1 Authority Data Model

本阶段建议把 world-level authority 拆成两个明确层次：

1. **`WorldBlockDataStore`**
   - 只负责 chunk 级 `blockData` slice 的持有、替换、局部 mutation、读取视图挂载
   - runtime 主存储格式固定为 `Map<number, entry>`

2. **chunk-level non-block payload registry**
   - 负责与 `blockData` 同生命周期存在、但不属于普通块逻辑真相的 chunk 元数据
   - 至少包括：
     - `runtimeSeedData`
     - `staticEntities`
   - 本阶段 primary scope 只要求明确：
     - `runtimeSeedData`
     - `staticEntities`
   - `runtimeEntities` / 特殊实体系统不作为本阶段 primary authority 重构对象，只要求与新 `blockData authority` 保持兼容
   - 这些数据可以暂时不并入 `WorldBlockDataStore` 同一个类，但必须在语义上明确：它们不再依赖 `Chunk` 生命周期作为唯一持有者

约束：

- 本阶段重构的中心是 `blockData authority`
- 但设计文档必须显式指出：`blockData` 之外的 chunk payload 不能继续处于“谁最后碰到了谁就临时持有”的模糊状态
- 若暂不统一实现容器，也必须在接口命名和注释中写明其未来接入点

补充说明：

- `WorldBlockDataStore` 不是“仅服务已加载 chunk 的 cache”
- 它必须能在 chunk 尚未加载时就持有对应的 chunk slice
- 也就是说，world-level authority 是世界逻辑真相仓库，而不是 loaded chunk 的附属物

### 5.3.1.1 Chunk Payload Registry Contract

仅统一 `blockData authority` 还不够，本阶段还必须把 `blockData` 之外的 chunk 级 payload owner 写清楚，否则删除 `MemoryWorldStore` 后，只会把“第二权威”从 blockData 转移到其他字段。

本阶段建议显式引入：

1. **`WorldChunkPayloadRegistry`**（名称可调整，但职责必须固定）
   - 持有与 chunk 同坐标关联、但不属于普通块逻辑真相的 payload
   - 本阶段至少包括：
     - `runtimeSeedData`
     - `staticEntities`
   - 可预留 `runtimeEntities` 接口挂点，但不要求本阶段完成其 owner 重构

2. **持有语义**
   - 生命周期独立于 live `Chunk` 实例
   - chunk unload 后仍可保留
   - chunk reload 时可再次 attach / restore

3. **职责边界**
   - `WorldBlockDataStore` 只负责普通逻辑块 authority
   - `WorldChunkPayloadRegistry` 只负责本阶段纳入范围的 non-block payload authority
   - `Chunk` 只负责 attach、restore、rebuild 本地运行时视图
   - `runtimeEntities` / `specialEntitiesShadowStore` 在本阶段视为既有兼容层，而不是新的 primary authority 改造对象

4. **不允许的旧语义**
   - `Chunk` 作为 `runtimeSeedData/staticEntities` 的最终唯一持有者
   - `WorldRuntime._regionCache` 临时碰到谁就替谁持有 live payload
   - `loadFromRecord()` 同时隐式决定普通块权威和 non-block payload 权威

补充要求：

- 本阶段即便不把 `WorldChunkPayloadRegistry` 做成最终形态，也必须在接口、注释和调用关系上把 owner 固定下来
- 否则后续 reload、export、entity restore 都会继续混用冷边界对象与 live chunk 状态
- `runtimeEntities` / 特殊实体系统本阶段只要求：
  - 渲染、互动、reload 行为不回退
  - 矿车、丧尸巢穴、炮塔等既有实体在世界流式加载、玩家交互、方块权威切换后仍可正常工作
  - 不反向成为 `blockData authority` 的真相来源
  - 不阻塞 `runtimeSeedData/staticEntities` 的 world-level restore 设计

### 5.3.1.2 Chunk Registry / Generation State Contract

只靠 `WorldBlockDataStore: Map<string, Map<number, entry>>` 无法表达“一个 chunk 是否已知存在”。本阶段还必须显式区分以下状态：

1. **missing chunk**
   - 当前 authority 中根本不存在该 chunk
   - 可能尚未生成、尚未导入、也可能不在当前已知世界范围内

2. **known empty chunk**
   - chunk 已被生成或导入
   - 只是其 `blockData` slice 为空

3. **known non-empty chunk**
   - chunk 已被生成或导入
   - 且 authority slice 中存在至少一个条目

建议显式引入 world-level chunk registry（可以是单独容器，也可以是 `WorldBlockDataStore` 的元数据层），至少记录：

- `chunkKey`
- `presenceState` 或等价字段
- 是否完成 bootstrap/runtime generation
- non-block payload 是否存在

最低约束：

- `ensureChunkSlice()` 创建空 slice 不能自动等价于“世界中确实存在该 chunk”
- 查询 missing/known-empty 必须有不同返回语义
- `WorldRuntime.ensureChunkData()`、bootstrap、cross-region overflow、未来 import/export 都必须基于同一套 chunk presence contract

否则会出现两类严重歧义：

- 一个空 `Map` 到底代表“这个 chunk 已生成但没有逻辑块”，还是“只是有人顺手 ensure 了一下”
- reload 到底应该 attach 一个空 slice，还是回源生成器 / 冷边界

### 5.3.2 WorldBlockDataStore Storage Contract

`WorldBlockDataStore` 不能只停留在“里面用 `Map<number, entry>`”这一层描述，还必须明确它的外层结构与 API 语义，否则 shared chunk view 的设计无法稳定落地。

本阶段建议固定为：

1. **外层结构**
   - `Map<string, Map<number, entry>>`
   - 外层 key 使用标准 `chunkKey = "${cx},${cz}"`
   - 内层 value 是该 chunk 的 authority slice：`Map<number, entry>`

2. **内层结构**
   - 必须是 `Map<number, entry>`
   - 不允许在 runtime 主存储中回退为普通对象

3. **读取接口应区分 peek 与 ensure**
   - `peekChunkSlice(cx, cz)`
     - 只查询
     - 不存在时返回 `null`
     - 不得隐式创建新 slice
   - `ensureChunkSlice(cx, cz)`
     - 查询或创建
     - 不存在时创建空 `Map<number, entry>` 并返回
     - 返回值可作为未来 `Chunk.blockData` attach 的共享实例

4. **若继续保留 `getChunkSlice()` 命名**
   - 必须在文档与注释中明确它究竟是 `peek` 还是 `ensure`
   - 不允许让不同调用方对其语义做不同假设

推荐原因：

- 这样可以避免“查询接口顺手创建新 slice”导致的隐式状态增长
- 也可以避免“调用方以为一定会创建，结果拿到 `null`”造成后续 attach / patch / generation 流程分叉

### 5.3.3 Attached Slice Reference Stability

一旦某个 chunk slice 已经 attach 给 live `Chunk.blockData`，其引用稳定性必须被视为设计契约：

1. 在该 chunk 生命周期内，除非显式 detach / reattach，否则不应悄悄更换其背后的 `Map` 实例
2. `Chunk.blockData` 的共享引用一旦建立，后续普通 rebuild 只能重建派生索引，不能替换 authority slice 引用
3. 如果实现需要整块替换 authority slice，必须首先满足：
   - 当前没有 live chunk view attach 到该 slice
   - 或者先显式 detach 旧 view，再 replace，最后重新 attach

换句话说：

- `Chunk.blockData` 的共享身份不是“每次随便拿一个最新 Map”
- 而是“attach 后在当前生命周期内具有引用稳定性”

### 5.3.4 Chunk -> WorldBlockDataStore Access Contract

本阶段还必须显式固定 `Chunk` 访问 authority owner 的路径，否则 `_updateBlockState()` 一类旧双写汇聚点在实现时会重新临时发明依赖路径。

约束如下：

1. `WorldBlockDataStore` 的 owner 是 `World`
   - `World` 负责创建并持有唯一 runtime `WorldBlockDataStore` 实例
   - `Chunk` 不允许自行 new / 缓存另一份 authority store owner

2. `Chunk` 对 authority 的访问必须经由所属 `World`
   - 推荐固定为 `this.world.worldBlockDataStore`
   - 或由 `World` 提供等价稳定 accessor
   - 但语义上都属于“`World` 向 `Chunk` 提供 world-level authority 引用”

3. `Chunk.blockData` 不是 owner，只是 attach 后的 shared slice view
   - `Chunk._updateBlockState()`
   - `acceptScatteredBlocks()`
   - `appendScatteredBlocks()`
   - batch edit / patch helper
   - 都必须通过 `World` 提供的 `WorldBlockDataStore` mutation API 落 authority

4. 本阶段不建议把 `WorldBlockDataStore` 作为独立构造参数广泛注入到 `new Chunk(...)`
   - 当前代码基线里 `Chunk` 已经通过 `world` 获取跨 chunk 能力与运行时资源
   - 因此优先保持“authority owner 在 world-level，由 `World` 暴露给 `Chunk`”这一结构
   - 若未来为了测试夹具或解耦需要增加 accessor wrapper，可以做，但不能改变 owner 语义

设计目标：

- 避免实现时重新出现 `this.world.memoryWorldStore` 退役后“Chunk 不知道该写谁”的临时拼接
- 避免把 world-level authority 错误地下沉成 chunk constructor 层面的第二持有者
- 让 `_updateBlockState()` 的迁移保持最小签名扰动，同时与“authority owner 在 world-level”原则一致

### 5.3.5 replaceChunkSlice Contract

`replaceChunkSlice(cx, cz, entries)` 必须被定义为**低频 authority lifecycle API**，而不是普通热路径 mutation API。

允许场景：

- 世界生成注入
- 未来导入
- 测试夹具
- 冷恢复

不允许场景：

- 单块修改
- 批量改单块
- scatter patch
- deferred patch
- 普通 unload / reload 热路径

额外约束：

1. 若目标 slice 尚未 attach 给 live chunk，可直接 replace 为新的 `Map`
2. 若目标 slice 已 attach 给 live chunk，禁止直接 replace 其 `Map` 实例
3. 对已 attach slice 的“整块刷新”必须走显式协议：
   - detach old view
   - replace at store
   - reattach chunk view
   - rebuild derived indexes

因此，`replaceChunkSlice()` 不应被实现为：

- `Chunk` 侧 `clear + repopulate`
- 对 live attached slice 静默换引用

### 5.3.5 Unloaded Chunk Mutation Contract

world-level authority 独立于 live `Chunk` 生命周期存在，这意味着本阶段必须把“目标 chunk 未加载时的写入语义”明确固定下来，而不能继续让不同子系统各自决定是否暂存、忽略或延后同步。

本阶段统一采用以下契约：

1. **逻辑修改先命中 authority**
   - 只要某个 mutation 已经被判定为合法世界修改，它的首个稳定落点必须是 world-level authority
   - 目标 chunk 当前是否已加载，不影响其是否进入 authority

2. **未加载 chunk 不是“禁止写入”的理由**
   - `cross-chunk scatter`
   - `overflow merge`
   - `deferred patch`
   - bootstrap 期间生成出的目标 chunk 数据
   - 上述几类路径在目标 chunk 未加载时，也必须写入对应 authority slice 或等价 world-level patch 容器

3. **pending buffer 只能是装配/调度层，不是第二权威**
   - `BlockScatterManager.pendingCrossChunkPatchBuffers`
   - 各类 worker result buffer
   - 各类 runtime deferred patch queue
   - 这些结构若继续存在，只允许持有：
     - 待装配的派生层输入
     - 待应用到 authority 的临时 patch 描述
   - 不允许成为“唯一尚未写入 authority 的逻辑真相 holder”

4. **玩家编辑的边界必须单独定义**
   - 若当前产品语义仍然规定“未加载 chunk 上的玩家编辑被忽略”，则应在 `WorldAccessLayer` 中显式保留此边界
   - 但文档必须同时写明：这是一条产品交互边界，而不是 authority 模型能力限制
   - 也就是说，本阶段不要求把所有未加载 chunk 玩家编辑都改成可写，但禁止实现者据此推导“未加载 chunk 一律不能进入 authority”

最低约束：

- 任何已经接受的逻辑修改，不得只存在于 chunk-local buffer
- `reload` / `future attach` 必须能从 authority 重新观察到之前写入的结果
- 不允许出现“某个补丁在 live chunk 时正确，一旦目标 chunk 当时未加载就丢失”的分叉语义

### 5.3.6 Query Boundary Contract

本阶段的 primary goal 是统一 runtime 写入权威，而不是顺手扩展所有查询能力。因此查询边界也必须显式固定。

本阶段建议采用保守契约：

1. `WorldAccessLayer.getBlock()`
2. `WorldAccessLayer.isSolid()`
3. `WorldAccessLayer.getCollisionAt()`

默认仍然以 **loaded chunk view correctness** 为主，不要求在本阶段把 world-level authority 暴露成 unloaded chunk 查询后备源。

理由：

- 这样可以避免在 authority 重构过程中，额外把 world-level store 拉进碰撞、物理、可见性等热路径
- 这样也可以把本阶段聚焦在“唯一真相如何写入、attach、restore”，而不是把查询体系一并扩散改造

明确约束：

- 不允许因为 world-level authority 已存在，就默认把所有 unloaded chunk 查询回源到 authority
- 若后续确有需要扩展 world-level logical query，应作为单独设计决策提出
- 当前查询路径继续只保证 live chunk 视图语义，不得因此反向影响 authority 的唯一性设计

### 5.4 冷存储完全退出本阶段主链路

本阶段 runtime 正确性不再依赖：

- `WorldRuntime.blockDataSnapshot`
- `PersistenceService.cache`
- `pendingUnloadFlushQueue`
- `PersistenceWorker.regionCache`
- `WorldStore.commitChunkRecord()`

`IndexedDB`、`PersistenceService`、`WorldStore`、`PersistenceWorker` 在本阶段统一视为：

- 延后恢复的冷存储能力
- 暂不作为 runtime 改造的阻塞条件

### 5.4.1 RegionCache Demotion

`RegionCache` 在当前代码里承载了 region 管理、chunk record 缓存与部分 `blockData` 读取前提，这使它非常容易在 `MemoryWorldStore` 删除后被误用成新的“半权威层”。

本阶段必须明确把 `RegionCache` 降级：

1. **允许保留的职责**
   - region 级加载状态与并发控制
   - chunk 非 `blockData` payload 的冷边界缓存
   - 未来冷恢复 / 批量加载的过渡上下文

2. **不允许保留的职责**
   - runtime live `blockData` 权威持有
   - loaded chunk 热路径上的逻辑真相读取来源
   - unload / reload 正确性的最终依据

3. **对 `cachedChunkRecord.blockData` 的约束**
   - 只允许作为冷边界输入
   - 只允许作为测试夹具输入
   - 只允许作为一次性导入到 `WorldBlockDataStore` 的源对象
   - 一旦对应 chunk slice 已进入 authority，后续 runtime 热路径不得继续把 `cachedChunkRecord.blockData` 当成 live truth 读取

换句话说：

- `RegionCache` 可以保留
- 但它必须从“权威候选层”降级为“冷边界 / region 管理辅助层”

### 5.4.2 Legacy Hot-Path Exit Criteria

本阶段不仅要“设计上降级旧链路”，还要给出明确的退出标准，避免实现完成后 runtime 仍然暗中依赖旧 holder。

最低退出标准：

1. `MemoryWorldStore`
   - 不再参与 runtime 热路径读写
   - 不再承担 unload/reload 正确性

2. `WorldRuntime.blockDataSnapshot`
   - 不再参与 runtime 正确性
   - 即便暂时保留，也只能作为 future cold export / deprecated hook

3. `pendingUnloadFlushQueue`
   - 不再是 runtime 会话闭环的一部分
   - flush 成功/失败不得影响当前会话中的逻辑正确性

4. `ChunkPersistence.saveDebounced()`
   - 不再是玩家编辑后保持 runtime 正确性的必要步骤

5. `World._requestRuntimeChunkRecord()`
   - 不再以 “memory store -> db fallback” 作为 runtime 主语义
   - cold boundary 只允许作为 authority 尚未建立时的一次性输入源

换句话说：

- “deprecated” 不应只是注释标签
- 必须通过测试与调用关系保证这些旧链路退出热路径正确性闭环

## 6. Target Layering

### 6.1 权威逻辑层

- world-level `blockData authority`

语义：世界逻辑真相的唯一持有者，独立于 chunk 生命周期。

### 6.2 渲染索引层

- `Chunk.visibleKeys`

语义：当前是否应显示、是否参与补面与可见块更新。

### 6.3 碰撞索引层

- `Chunk.solidBlocks`

语义：当前是否是实心块、是否参与碰撞和物理查询。

### 6.4 高频查询索引层

- `Chunk.blockDataArray`
- `Chunk.solidBlockIds`
- `Chunk.blockPalette`
- `Chunk.blockPaletteReverse`

语义：服务 chunk 内高频 `isSolid` / `resolveBlockOwner` / 局部块访问，不承担权威职责。

以下四项是**热路径上需要特别强调的保留项**，但它们**不是完整保留清单**：

- `Chunk.visibleKeys`
- `Chunk.solidBlocks`
- `Chunk.blockDataArray`
- `Chunk.solidBlockIds`

这四类结构在新设计中仍然有明确价值：

- `visibleKeys`：可见性与补面判断
- `solidBlocks`：碰撞与实心判定
- `blockDataArray`：chunk 内紧凑数组快路径
- `solidBlockIds`：配合数组路径做 O(1) 实心判断

它们都应继续存在，只是语义上必须严格降级为**派生索引 / 高速查询缓存**。

补充说明：

- `Section 6` 各子节列出的结构默认都属于本次重构的保留对象
- `6.4` 这里特别点名，是因为这四项直接位于最高频的碰撞 / `isSolid` / 局部查询热路径上
- `blockPalette` / `blockPaletteReverse`、`lightSourceCoords`、`dirtyAOPositions`、`instanceIndexMap`、`meshData`、`renderDelta`、`deletedBlockTombstones` 等并不是可删项，只是它们的保留理由已在各自层级小节中单独说明

### 6.5 渲染载荷层

- Worker `meshData`
- `Chunk.instanceIndexMap`
- `Chunk.renderDelta`
- `GlobalInstancedMeshManager` 的 chunk 输出状态

语义：面向渲染提速和 GPU 输出。

### 6.6 光照与一致性保护层

- `Chunk.lightSourceCoords`
- `Chunk.dirtyAOPositions`
- AO Worker 的 `blockData` 镜像
- `Chunk.deletedBlockTombstones`

语义：AO / 光照增量刷新与晚到回包保护。

### 6.6.1 AO Worker Mirror Contract

AO Worker 的 `blockData` 镜像在新模型中仍然允许存在，但它必须被严格定义为：

- **authority 派生出的计算副本**

而不是：

- 第二权威
- runtime 逻辑真相来源
- 可反向写回主线程 authority 的 holder

本阶段明确采用：

1. 保持当前 `aoBridge.enqueueSet()` / `enqueueDelete()` / `enqueueBatch()` 的单向同步模型
2. AO Worker 不直接访问 `WorldBlockDataStore`
3. AO Worker 镜像只服务于 AO 增量计算与一致性保护

必须满足的约束：

- AO mirror 的更新方向只能是 `authority -> AO mirror`
- AO Worker 计算结果不能反向改写 `blockData authority`
- AO mirror 丢失后可以从 authority 重新播种
- AO mirror 延迟、失败或被重建，只影响 AO 新鲜度，不影响 runtime 逻辑正确性

因此，AO Worker mirror 虽然是数据副本，但它属于**派生副本**，不与“唯一权威”设计冲突

### 6.7 实体层

- `runtimeEntities`
- `staticEntities`
- `entityCollisionIndex`
- `specialEntitiesShadowStore`

语义：实体域权威与碰撞域，不混入普通块逻辑真相。

补充约束：

- `entityCollisionIndex` 继续保持特殊实体碰撞占位的独立语义
- 本次 authority 重构不把 `entityCollisionIndex` 合并进 `blockData` 或 `solidBlocks`
- 对 `entityCollisionIndex` 的修改不应被误纳入普通方块写入口改造
- `runtimeEntities` / `specialEntitiesShadowStore` 在本阶段视为兼容对象：
  - 只要求现有渲染、互动、reload 行为不回退
  - 不要求本阶段完成其 owner 模型重构
  - 但必须明确其状态不能反向成为 `blockData authority` 的真相来源
- 相比之下，`staticEntities` 与 `runtimeSeedData` 更靠近 chunk reload / 装配主链路，本阶段必须为它们提供明确的 world-level restore 来源

### 6.8 Section 6 保留范围总结

除非后续有单独专项设计明确替代方案，`Section 6` 中列出的各层结构默认都应保留：

- 保留它们当前承担的查询、碰撞、渲染、AO、一致性保护职责
- 只重新定义其权威边界和数据来源
- 不在本次 runtime authority 重构中顺手删除或合并掉这些结构

## 7. Target Data Flow

### 7.1 世界生成

目标链路：

```text
WorldGenerationService / WorldWorker
-> 产出 chunkRecord.blockData
-> 直接写入 world-level blockData authority
-> 若 chunk 当前已加载，则 hydrate 到 Chunk.blockData
-> 从 blockData 派生可见性 / mesh / AO
```

关键约束：

- 生成结果首先是 `blockData`
- 不通过 `PersistenceService.cache`
- 不为“未来存档”额外维护第二条热路径

### 7.1.0 Runtime Generation Ordering Contract

为了避免实现中继续沿用“先落冷存储、再回灌 runtime”旧顺序，本阶段必须把生成链路顺序写死。

推荐顺序：

```text
WorldGenerationService / WorldWorker result
-> 写 WorldChunkRegistry
-> 写 WorldChunkPayloadRegistry
-> 写 WorldBlockDataStore
-> 若目标 chunk 已加载，则 attach / rebuild
-> 若需要保留 cold persistence hook，则异步 deferred 触发
```

强约束：

- runtime authority 的建立必须先于任何 cold persistence
- `saveRegionRecord()`、`saveWorldMeta()`、`commitChunkRecord()` 若暂时保留，不得成为 runtime 正确性的前提
- generation result 中的 `blockData`、`runtimeSeedData`、`staticEntities` 必须先进入 world-level runtime owner，再决定是否额外导出

### 7.1.1 WorldGenerationService / WorldBlockDataStore Contract

本阶段必须明确：`WorldGenerationService` 的运行时主产物是 `WorldBlockDataStore`，不是 `WorldStore`。

也就是说：

1. bootstrap 预生成
2. runtime 扩图
3. cross-region overflow 合并

这三类路径都应先写入 world-level authority。

推荐链路：

```text
WorldGenerationService._generateRegion()
-> 生成 chunk blockData / runtimeSeedData / staticEntities / routing overflow
-> blockData 直接写入 WorldBlockDataStore
-> non-block payload 写入 chunk-level non-block payload registry
-> 若对应 chunk 已加载，则 attach / rebuild
-> 若对应 chunk 未加载，则仅保留在 authority 中，等待未来 attach
```

本阶段明确采用：

- **single-write to runtime authority**

补充强调：

- bootstrap 预生成路径是本阶段第一条必须稳定打通的大规模 authority 写入链路
- 若这条链路仍停留在旧的 `WorldStore` / `MemoryWorldStore` 双落点模型，后续 chunk attach / rebuild / reload 语义将无法被正确验证

本阶段明确不采用：

- `WorldBlockDataStore` + `WorldStore` 双写
- 生成正确性依赖 `saveRegionRecord()` / `saveWorldMeta()` / `commitChunkRecord()`

如果保留这些旧接口：

- 它们只能是 deferred / future hook
- 不能是本阶段生成完成的必要步骤

### 7.1.2 Region Concept vs Region Persistence

本阶段必须把两个概念拆开：

1. **region as generation/routing unit**
   - 可以保留
   - 用于批量生成、overflow 路由、分批调度、边界扩图

2. **region persistence as cold storage mechanism**
   - 不再属于本阶段运行时主链路
   - 可以保留接口壳层，但只作为下一阶段冷存储恢复接入点

换句话说：

- `region` 这个计算与调度概念可以继续存在
- 但 `saveRegionRecord()` 一类持久化动作不能继续作为 world generation 的正确性前提

### 7.2 单块修改

目标链路：

```text
WorldAccessLayer.setBlock/removeBlock
-> WorldBlockDataStore.setBlockEntry()
-> Chunk._updateBlockState()
-> Chunk.blockData 视图立即观察到 world-level authority 的变更
-> 增量更新 visibleKeys / solidBlocks / blockDataArray / lightSourceCoords / dirtyAOPositions / renderDelta
-> AOBridge / tombstones 同步
-> 仅标记 chunk runtime dirty
```

关键约束：

- 真相先改 world-level `blockData authority`
- `Chunk.blockData` 只是世界级权威的 chunk 访问入口，与 authority chunk slice 共享同一个 `Map<number, entry>` 实例
- 不得先写 chunk-local 副本再“同步回权威层”，也不得执行“authority 写一次 + `Chunk.blockData` 再写一次”的双写流程
- 共享 `Map` 身份不放开任意直写；合法 mutation 仍必须走受控入口，确保派生索引同步
- 不再构造完整 `blockDataSnapshot`
- 不再为了持久化链路即时 clone 整个 chunkRecord

### 7.2.1 Scatter / Cross-Chunk Patch 写入

目标链路：

```text
BlockScatterManager / deferred cross-chunk patch
-> 将 patch 按目标 chunk 分组
-> 对每个目标 chunk 命中各自的 WorldBlockDataStore chunk slice
-> Chunk.acceptScatteredBlocks() / appendScatteredBlocks()
-> 共享 Chunk.blockData 视图立即观察到对应 slice 变更
-> 更新 visibleKeys / solidBlocks / blockDataArray / tombstone / meshData 等派生层
```

关键约束：

- `acceptScatteredBlocks()` / `appendScatteredBlocks()` 对逻辑方块的写入必须直接命中目标 chunk 的 authority slice
- 若 patch 涉及多个 chunk，必须分别写入各自 chunk slice，不得先落入某个临时 `blockData` 副本后再统一同步
- 共享 `Map` 方案下，不允许对同一 patch 再执行一次额外的 `Chunk.blockData.set/delete` 补写
- tombstone、hidden block、late worker result 过滤等现有一致性保护逻辑继续保留
- 目标 chunk 未加载时，patch 也必须先进入 authority 或 authority-level patch 容器，不能因为缺少 live chunk view 就只停留在待装配 buffer
- `pendingCrossChunkPatchBuffers` 若继续保留，只能承担 authority patch 调度与派生层装配延迟职责，不能成为“尚未写入 authority 的唯一逻辑真相 holder”
- 对同一坐标的 patch 冲突必须固定优先级：玩家后续修改 > tombstone / 删除保护 > 晚到生成或 scatter patch

### 7.2.2 BlockScatterManager Contract

`BlockScatterManager` 在新模型中不能继续被理解为“把 worker 结果灌进某个 chunk 的本地 blockData”，而必须被重新定义为：

- **authority patch 编排层**

也就是说，它负责：

1. 按目标 chunk 分组 patch
2. 将 patch 路由到各自 authority slice
3. 驱动目标 chunk 的派生层更新
4. 保持 tombstone、hidden block、late worker result 保护逻辑继续成立

硬约束：

- `BlockScatterManager` 不得再隐式依赖“chunk 先局部持有逻辑真相，未来再同步到别处”
- `distributeBlocks()`、`scatter()`、deferred cross-chunk patch 都必须以 authority slice 为目标语义
- shared authority 模式下，late worker result 的保护必须同时考虑：
  - tombstone
  - authority version / assembly epoch
  - 玩家后续修改优先级

换句话说：

- `Chunk.acceptScatteredBlocks()` / `appendScatteredBlocks()` 是目标 chunk 的派生层装配入口
- `BlockScatterManager` 才是 scatter patch 的 authority-level 编排入口

### 7.2.3 Unloaded Target Chunk Write Semantics

本阶段必须额外固定一个容易被实现时绕回旧模型的问题：**未加载目标 chunk 的逻辑修改是否进入 authority**。

统一答案是：

- **会**

更准确地说：

1. 对于世界生成、overflow、scatter、deferred cross-chunk patch：
   - 目标 chunk 未加载时，逻辑修改仍然必须进入对应 world-level authority owner
   - live chunk view 只是未来 attach 的消费者，不是写入前提

2. 对于玩家主动编辑：
   - 若当前产品语义仍规定“未加载 chunk 不响应编辑”，可以继续保留该交互边界
   - 但这是一条产品交互边界，而不是 authority 模型能力限制

3. 对于 reload 语义：
   - 后续 chunk attach 时，应从 authority 观察到这些先前写入的结果
   - 不允许再依赖重新生成、重新散射或回源冷边界来“碰巧恢复”

### 7.3 Chunk 加载

目标链路：

```text
World 请求 chunk
-> 先查 world-level blockData authority / chunk record 索引
-> miss 时回源生成器
-> 回源结果直接写入 world-level blockData
-> Chunk.loadFromRecord() / createChunkView()
-> 从 blockData 重建 blockDataArray / solidBlocks / solidBlockIds / lightSourceCoords
-> Worker 只计算派生层
```

关键约束：

- Worker 不能直接改写逻辑真相
- `Chunk.blockData` 不是第二权威，而是权威数据的 chunk 视图
- chunk 是否已加载，不影响 world-level authority 是否可以预先持有其 slice

### 7.3.1 Hydrate / Attach Protocol

本阶段必须把 `loadFromRecord()` 一类 API 的语义彻底改清楚。

目标不是“把 `chunkRecord.blockData` 再复制一份到 `Chunk.blockData`”，而是：

1. 先确保 world-level authority 中存在目标 chunk slice
2. `Chunk` attach 到该 slice，令 `Chunk.blockData` 直接引用该 `Map<number, entry>`
3. 基于该 slice 重建：
   - `visibleKeys`
   - `solidBlocks`
   - `blockDataArray`
   - `solidBlockIds`
   - `blockPalette` / `blockPaletteReverse`
   - `lightSourceCoords`
4. Worker 只消费 authority 的序列化边界产物去生成 mesh / visibleKeys / AO 派生结果

因此需要区分两类动作：

- **attach authority slice**
  - 建立 `Chunk.blockData` 与 world-level slice 的共享引用
  - 不负责复制逻辑真相

- **rebuild derived indexes**
  - 从共享 slice 重建当前 chunk 的派生结构
  - 允许清空索引层
  - 不允许替换 authority slice 本身

本阶段推荐固定为以下三段式协议：

1. **store replace / fill**
   - 由 `WorldBlockDataStore` 负责创建、填充、替换目标 chunk slice
   - 推荐 API：
     - `replaceChunkSlice(cx, cz, entries)`
     - `applyChunkPatch(cx, cz, entries)`
   - `Chunk` 不直接承担整块 `blockData` 注入责任

2. **chunk attach**
   - `Chunk` 通过 `attachAuthoritySlice(cx, cz)` 或等价步骤挂接 store 内现有 slice
   - `Chunk.blockData` 只在这一阶段获得共享引用
   - attach 本身不复制逻辑真相

3. **rebuild derived indexes**
   - `Chunk` 从共享 slice 重建 `visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds`、`blockPalette`、`lightSourceCoords`
   - 这一步可以清空派生层
   - 但严禁清空或替换 authority slice

这三步中，只有第 1 步允许改变整块逻辑真相；第 2、3 步都不允许改变 authority 内容。

额外约束：

- `loadFromRecord()`、`_injectBlockData()`、`_injectBlockDataBatch()` 这类旧命名若继续保留，必须在注释中明确：
  - 输入到底是“authority slice attach 信息”还是“冷边界对象快照”
  - 哪些场景允许清空重建
  - 哪些场景严禁替换当前共享 `Map` 实例
- 更进一步地说，若这些旧 API 名称持续暗示“Chunk 自己拥有并注入 blockData”，则应优先拆分或重命名为更准确的协议层名称，例如：
  - `replaceAuthoritySliceFromRecord()`
  - `attachAuthoritySlice()`
  - `rebuildDerivedIndexesFromAuthority()`

### 7.3.1.0 ChunkAssemblyScheduler Alignment

`ChunkAssemblyScheduler` 是 attach/hydrate/rebuild 协议的真实执行器之一，因此本阶段必须显式要求它与 shared authority 模型对齐。

当前旧语义中，scheduler 驱动的 hydrate stage 仍可能复用：

```text
_clearForBlockInjection()
-> _injectBlockDataBatch()
```

这在 chunk-local holder 模式下可以工作，但在 shared authority view 模式下属于非法路径。

因此本阶段要求：

1. 当 authority slice 已存在时，scheduler 驱动的 hydrate stage 只允许：
   - attach authority slice
   - rebuild derived indexes
   - restore payload

2. 当输入是 cold boundary plain object 时：
   - 先执行 cold input -> authority
   - 再进入 attach / rebuild

3. scheduler 不得在 authority slice 已 attach 的场景下继续驱动：
   - `Chunk.blockData.clear()`
   - `_clearForBlockInjection()`
   - `_injectBlockDataBatch()` 这类以“重建 chunk-local blockData”为前提的旧流程

换句话说：

- scheduler 不只是“调用 Chunk 的某个方法”
- 它本身也承担了新 authority 生命周期协议是否真正落地的边界责任

### 7.3.1.1 loadFromRecord / _injectBlockData Migration Matrix

本阶段必须把 `loadFromRecord()`、`_injectBlockData()`、`_injectBlockDataBatch()` 的旧复合职责拆开，否则 shared authority view 设计会在实施时被旧 mental model 拉回去。

当前旧语义大致是：

1. 从 `chunkRecord.blockData`（plain object）读取条目
2. 逐个写入 `Chunk.blockData`
3. 同时填充 `blockPalette`、`blockDataArray`、`solidBlocks`、`solidBlockIds`

新模型下，这三步必须分流为三类完全不同的职责：

1. **cold input -> authority**
   - 输入来源：
     - `chunkRecord.blockData` plain object
     - 世界生成结果
     - 测试夹具
     - 未来导入数据
   - 新语义：
     - 不再直接写 `Chunk.blockData`
     - 先进入 `WorldBlockDataStore.replaceChunkSlice()` 或等价 cold-fill API

2. **authority -> chunk view attach**
   - 输入来源：
     - 已存在于 authority 的 chunk slice
   - 新语义：
     - `Chunk.blockData` 直接引用 authority slice
     - 不复制逻辑真相

3. **authority -> derived indexes rebuild**
   - 输入来源：
     - attach 后首次装配
     - runtime rebuild / reload
     - 派生层失效后的重建
   - 新语义：
     - 清空并重建 `visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds`、`blockPalette`、`lightSourceCoords`
     - 严禁写 authority 内容

因此：

- `loadFromRecord()` 不应再被理解为“把 record.blockData 注入 chunk.blockData”
- `_injectBlockData()` 不应再同时承担“写 authority + 建索引”
- `_injectBlockDataBatch()` 也不应继续以“分批写 chunk-local blockData”为前提

更准确的目标是：

- `loadFromRecord()` 成为一个编排函数，负责协调：
  - cold input 是否需要先写 authority
  - chunk attach
  - derived indexes rebuild
  - non-block payload restore

- `_injectBlockData()` 若保留，应只保留其中一种职责：
  - 要么是 cold input -> authority 的边界 helper
  - 要么是 authority -> derived indexes 的 rebuild helper
  - 不能两者混合

- `_injectBlockDataBatch()` 若保留，应明确它是在“分批 rebuild 派生索引”，而不是“分批把逻辑真相写进 chunk.blockData”

硬约束：

- 禁止继续保留“一个 helper 同时负责写 `blockData` 和建索引”的旧复合职责
- 禁止在 authority 已存在时，`loadFromRecord()` 仍重复执行“plain object -> chunk.blockData”注入流程

### 7.3.1.2 Non-Block Payload Attach / Restore Protocol

与 `blockData` attach 协议并列，本阶段还必须补上 non-block payload 的 restore 协议。

推荐拆成独立步骤：

1. `restoreChunkPayloadsFromRegistry(cx, cz)`
   - 从 `WorldChunkPayloadRegistry` 读取 `runtimeSeedData/staticEntities`
   - 不处理普通块 authority

2. `Chunk.attachAuthoritySlice()`
   - 只挂接 shared `blockData` slice

3. `Chunk.rebuildDerivedIndexesFromAuthority()`
   - 只重建 `visibleKeys/solidBlocks/blockDataArray/...`

4. `Chunk.restoreRuntimePayloads()`
   - 只恢复 `structureCenters`、静态实体
   - `runtimeEntities` / 特殊实体恢复继续走现有兼容链路

硬约束：

- 恢复 `runtimeSeedData/staticEntities` 不能再顺手承担普通块 authority 建立职责
- 同样地，普通块 authority attach / rebuild 也不能再顺手决定这些 payload 的 owner
- 若继续保留 `loadFromRecord()`，它必须只是上面几步的编排入口，而不是新的混合权威容器
- `runtimeEntities` / `specialEntitiesShadowStore` 在本阶段可以继续保留既有恢复方式，但必须明确：
  - 它是兼容层，不是 `blockData authority`
  - 它的状态不能反向决定普通块真相

### 7.3.2 Clear / Replace Boundary

为了避免 shared Map 方案在实施时被旧实现语义污染，必须把“谁可以 clear / replace 什么”写成硬约束：

1. 允许 clear 的对象：
   - `visibleKeys`
   - `solidBlocks`
   - `blockDataArray`
   - `solidBlockIds`
   - `blockPalette`
   - `blockPaletteReverse`
   - `lightSourceCoords`
   - 其他 chunk-local 派生索引

2. 不允许 clear 的对象：
   - `Chunk.blockData`（当其指向 shared authority slice 时）
   - world-level authority 内已挂载的 chunk slice

3. 允许 replace 的对象：
   - `WorldBlockDataStore` 中尚未 attach 的 chunk slice
   - 低频场景下由 store 统一替换的整块 authority slice

4. 不允许 replace 的对象：
   - 业务代码手里的 `Chunk.blockData`
   - 通过 `Chunk` 内部 helper 悄悄重建的新 `Map`

换句话说：

- **整块逻辑真相替换是 store 的职责**
- **共享视图挂载是 chunk 的职责**
- **派生层清空与重建是 chunk 的职责**
- 三者不得混用

### 7.4 Chunk 卸载

目标链路：

```text
World.unloadChunk()
-> 释放 visibleKeys / solidBlocks / blockDataArray / meshData / instanceIndexMap / dynamicMeshes
-> 销毁 chunk 实例视图
```

关键约束：

- unload 不再承担权威同步动作
- unload 后 reload 必须仍从 world-level `blockData` 恢复
- 本阶段不要求同步写盘

### 7.4.1 Detach / Dispose Protocol

本阶段必须把 unload/dispose 写成与 attach/hydrate 同等级别的协议，而不是只说“卸载时不再 flush”。

建议最少拆成：

1. **detach authority view**
   - `Chunk.blockData` 与 world-level authority 的共享引用解除
   - 解除后 chunk 实例不再参与 live 读写

2. **dispose derived indexes**
   - 释放 `visibleKeys`
   - 释放 `solidBlocks`
   - 释放 `blockDataArray`
   - 释放 `solidBlockIds`
   - 释放 `meshData/instanceIndexMap/dynamicMeshes/renderDelta` 等 chunk-local 派生层

3. **preserve world-level authorities**
   - `WorldBlockDataStore` 中的 block slice 保留
   - `WorldChunkPayloadRegistry` 中本阶段纳入范围的 non-block payload 保留
   - `runtimeEntities` / 特殊实体状态继续沿用现有兼容层，不要求在本阶段改造为 registry owner

4. **invalidate async callbacks**
   - 与该 chunk 生命周期绑定的 worker 回包、AO 回包、consolidation 回包必须在 dispose 后可被识别为过期

补充说明：

- chunk dispose 允许清空 chunk-local 派生结构
- chunk dispose 不允许清空 world-level authority
- 若某段旧代码仍以 `Chunk.clear()` / `_injectBlockData()` 作为“卸载前准备”，必须明确拆除

### 7.4.2 Authority Version / Assembly Epoch Contract

shared authority view 模式下，必须显式定义“晚到回包如何失效”，否则旧 worker 结果会污染新 attach 的 slice。

本阶段建议引入至少一种显式版本机制：

1. **authority version**
   - 每个 chunk slice 在发生逻辑变更时递增
   - AO / consolidation / worker rebuild 可带上 version 或基于 version 做过滤

2. **assembly epoch**
   - 每次 chunk attach / detach / rebuild 生命周期切换时递增
   - live chunk 只接受当前 epoch 的异步回包

最低要求：

- `acceptWorkerResult()`、scatter patch、AO 回包、consolidation 回包都必须有过期识别依据
- `deletedBlockTombstones` 继续保留，但 tombstone 不是唯一的一致性保护机制
- 不能只靠“当前 chunk 还在不在 map 里”判断回包是否有效

最小实现契约：

1. `authority version` 必须由 world-level authority owner 维护
   - 对同一 chunk slice 的逻辑修改一旦提交到 `WorldBlockDataStore`，对应 version 递增
   - 不能由各个 worker 链路各自维护一套彼此无关的“本地版本号”

2. `assembly epoch` 必须由 live chunk attach lifecycle 维护
   - 每次 attach 新 live view 时生成或递增
   - detach / dispose 后旧 epoch 立即失效
   - 同坐标 chunk reload 后，即使复用同一 authority slice，也必须视为新的 assembly epoch

3. 发往异步链路的 request 必须携带过期识别信息
   - 至少带上 `chunkKey + assemblyEpoch`
   - 需要基于逻辑变更过滤的链路还应带上 `authorityVersion` 或等价快照版本

4. 异步回包落地前必须统一校验
   - 当前 live chunk 是否仍存在
   - 当前 live chunk 的 `assemblyEpoch` 是否仍匹配
   - 若该链路依赖逻辑快照，则 `authorityVersion` 是否仍可接受
   - 任一条件不满足，都必须把回包视为 stale result 并丢弃

5. 该协议必须作为统一 runtime contract 复用
   - consolidation
   - AO worker
   - chunk assembly / worker hydrate callback
   - 其他 attach 后才允许落到派生层的异步结果
   - 不允许每条链路各自发明一套 token / disposed / boolean 标志来替代统一协议

设计意图：

- tombstone 解决“旧块被删除后晚到结果复活”
- authority version / epoch 解决“整个 attach 生命周期已经变化，旧回包不该再落地”

### 7.4.3 Consolidation Protocol

`consolidation` 不是本阶段的 primary redesign target。它的既有 face culling / mesh / 3x3x3 AO 相关行为逻辑应当继续保留，本阶段只要求它与新的 authority / shared view / epoch 语义兼容，不得因为权威数据源重构而回退。

之所以仍需单独写出协议，是因为 `consolidation` 天然是一条“authority 边界序列化 -> worker 重算 -> 异步结果回放”链路。如果不把它的边界写清楚，实施时很容易在这里重新引入第二权威或旧式快照 holder。

因此，本阶段对 consolidation 的定位必须是：

- **它消费 authority 的边界快照**
- **它产出新的派生层/渲染层结果**
- **它不能反向成为逻辑真相来源**

也就是说，在本阶段它的职责是：

1. 基于 authority 当前内容构造 worker 输入
2. 让 worker 重算 face culling / mesh / AO 相关派生结果
3. 在主线程回放结果时，与 authority 当前状态做兼容性校验
4. 只更新派生层与渲染输出，不替换 authority

#### 7.4.3.1 Consolidation Send-Side Contract

send side 必须明确：

1. `consolidate()` 读取的是当前 authority slice
2. 允许为了 worker `postMessage` 做一次 **boundary serialization**
3. 这次 serialization 的语义是：
   - worker 输入快照
   - 不是新的权威 holder
   - 不是后续 reload 的真相来源

因此，在本阶段：

- `blockDataToNumberKeys(this.blockData)` 一类操作在新模型下只允许被视为 worker 消息边界 codec
- 它的存在不应重新引入 `blockDataSnapshot` / parked snapshot / unload holder 语义
- consolidation send side 允许 clone 一次，但这个 clone 只能服务于当前 worker 任务

#### 7.4.3.2 Consolidation Receive-Side Contract

receive side 必须明确：

1. `_applyConsolidateResult()` 回放的是 worker 派生结果
2. 它可以：
   - 重建 mesh
   - 清理旧 dynamic mesh / instanced mesh
   - 刷新 `instanceIndexMap`
   - 刷新 `renderDelta` 对应输出状态
   - 从 authority 重新 rebuild `blockDataArray` / `solidBlockIds` / `lightSourceCoords` 等派生索引

3. 它不可以：
   - 用 worker 回包替换 authority slice
   - 把 worker 结果当成“比 authority 更新的逻辑真相”
   - 因为收到 consolidation 结果，就重走一遍 “clear authority -> reinject blockData” 旧流程

硬约束：

- `_initArrayStorageFromBlockData()` 在 consolidation receive side 的语义必须明确为：
  - **从 authority rebuild derived indexes**
  - 而不是“根据 worker 回包重建逻辑真相”

#### 7.4.3.3 Consolidation Concurrency Contract

consolidation 期间，玩家可能继续修改方块。因此 worker 回包必须额外通过以下保护，以确保既有行为逻辑在新 authority 模型下不退化：

1. `authority version`
2. `assembly epoch`
3. `deletedBlockTombstones`
4. 玩家修改后与 worker 输入快照之间的差异过滤

最低要求：

- consolidation 开始后发生的玩家修改，不得被旧回包覆盖
- `_applyConsolidateResult()` 中对 scatteredBlocks / visible blocks / meshData 的过滤，必须以“authority 当前状态优先”为原则
- 若 worker 回包与 authority 当前内容冲突，authority 胜出，冲突部分结果必须被丢弃或裁剪

换句话说：

- consolidation 的结果是“可应用的派生建议”
- 不是“主线程必须无条件接受的新真相”

#### 7.4.3.4 Consolidation and Shared Map Compatibility

shared `Map` 模式下，consolidation 还必须满足两个额外兼容条件：

1. consolidation 不能通过 `this.blockData.clear()` 或替换 `this.blockData = new Map()` 来准备重建
2. consolidation 不能因为要重建派生层，就隐式改变 live authority slice 的引用身份

因此：

- consolidation 允许清空 chunk-local 派生索引
- consolidation 不允许清空或替换 shared authority slice
- consolidation 结果落地后，`Chunk.blockData` 仍应保持对同一 authority slice 的共享引用

### 7.5 JSON 导入 / 导出

本阶段结论：

- **推迟实现**
- 文档只保留约束，不把它放进第一阶段交付门槛

未来恢复时应满足：

- 导入先写 world-level `blockData`
- 已加载 chunk 再从 world-level `blockData` 覆盖刷新
- 导出直接从 world-level `blockData` 统一读取

## 8. 写入口清单

以下所有路径都必须纳入统一改造，不允许遗漏：

1. `addBlockDynamic()`
2. `addBlocksBatchFast()`
3. `removeBlocksBatch()`
4. `Chunk._updateBlockState()`
5. `Chunk.acceptScatteredBlocks()`
6. `Chunk.appendScatteredBlocks()`
7. `Chunk.loadFromRecord()` / `_injectBlockData()`
8. `WorldGenerationService` 写入生成结果的路径
9. 未来 `applySaveData()` / import 路径

补充说明：

- 不仅要覆盖“最终执行 `blockData.set/delete` 的位置”
- 还要覆盖“谁在上游决定这次逻辑真相应该写到哪里”的接入路径

因此在本阶段，至少还必须显式纳入：

10. `WorldGenerationService._generateRegion()` 完成后的 authority 接入路径
11. `World` / `Chunk` 接收 WorldWorker 结果后的 authority 接入路径
12. `acceptWorkerResult()` 一类直接装配 worker 元数据与派生层的路径

统一原则：

- 所有逻辑修改必须先触达 `blockData`
- 索引层只能被 `blockData` 驱动更新
- 不允许索引层反向决定逻辑真相
- 不允许沿用“先改 `Chunk.blockData` 再同步第二处 holder”的旧双写模式

### 8.0.1 Worker Callback Boundary

本阶段必须明确区分两类 worker 回包处理：

1. **authority input**
   - 例如生成出的 `chunkRecord.blockData`
   - 必须先写 `WorldBlockDataStore`

2. **derived payload input**
   - 例如 `visibleKeys`
   - `solidBlocks`
   - `meshData`
   - `structureCenters`
   - 其他 worker 回传的渲染 / AO / routing 元数据
   - 这些内容可以直接装配到 chunk 派生层，但前提是 authority 已经成立

硬约束：

- worker 回包路径不得把 `visibleKeys` / `solidBlocks` / `meshData` / `structureCenters` 之类派生层数据反向当成逻辑真相来源
- `acceptWorkerResult()` 或等价路径若继续直接写派生层，必须建立在：
  - `blockData authority` 已正确写入
  - `Chunk.blockData` 已 attach 到对应 authority slice

### 8.0.2 Write Mechanism Transition

当前旧实现里，大量路径仍遵循：

```text
写 Chunk.blockData
-> 再同步写 MemoryWorldStore
```

本阶段必须整体切换为：

```text
写 WorldBlockDataStore
-> Chunk.blockData 作为共享视图自动观察到变更
-> 再更新派生索引与异步派生层
```

这意味着：

- `_updateBlockState()` 一类 helper 中“`this.blockData.set/delete` + `memStore.applyBlockMutation()`”的旧双写模式必须整体退出
- `acceptScatteredBlocks()` / `appendScatteredBlocks()` / world generation 接入路径 / batch edit 路径都必须迁移到同一机制

## 8.1 Unified Mutation Primitive

仅仅“列出所有写入口”还不够，本阶段还必须建立**唯一合法 mutation 原语**。

建议约束为：

1. 热路径合法原语：
   - `setBlockEntry(cx, cz, code, entry)`
   - `deleteBlockEntry(cx, cz, code)`
   - `applyChunkPatch(cx, cz, entries)` 或等价批量局部 patch API

2. 低频整块原语：
   - `replaceChunkSlice(cx, cz, blockData)`
   - 仅用于生成注入、未来导入、测试夹具、冷边界恢复

3. 业务层禁止事项：
   - 除 attach / replace / 测试夹具外，禁止直接 `chunk.blockData.set/delete`
   - 禁止在 authority 写入后，再对共享 `Chunk.blockData` 做第二次补写
   - 禁止为兼容旧路径额外构造 chunk-local `blockData` staging 副本

4. mutation 后续步骤必须是固定序列：
   - authority mutation
   - 旧值/新值差异判定
   - 派生索引更新
   - AO / tombstone / renderDelta / global instance patch 更新
   - dirty 标记或后续异步派生调度

本设计的关键不是“把 `Map` 共享出去”，而是“共享 `Map` 后依然只有受控 mutation 才是合法写路径”。

补充限制：

- attach / hydrate / rebuild 流程不属于普通 mutation 热路径
- 但即便在这些流程中，也不得让 `Chunk` 直接通过 `clear()` 接管 authority slice 生命周期

## 8.2 Read Path Contract

authority 重构后，读路径也必须显式收敛，避免后续出现“写路径统一了，读路径还在各自猜真相”的状态。

本阶段至少需要写清以下契约：

1. `WorldAccessLayer.getBlock()`
   - 优先命中 loaded chunk view
   - 未加载 chunk 在本阶段可以返回 miss，不要求回源冷存储

2. `isSolid` / `getCollisionAt`
   - 优先使用 `blockDataArray` / `solidBlockIds` / `solidBlocks`
   - authority 只提供逻辑真相，不替代高频碰撞索引

3. `resolveBlockOwner`
   - loaded chunk 场景可以继续优先走 chunk 派生索引 / 视图
   - 若继续支持跨 chunk owner fallback，必须明确它是在 loaded chunk 集合内工作，还是允许直接查 world-level authority

4. cross-chunk patch / deferred patch / neighbor sampling
   - 必须明确是否允许读取未加载 authority slice
   - 若不允许，调用方必须先确保目标 chunk 已 attach 或已有 world-level slice

5. RegionCache 读取边界
   - runtime 热路径不得把 `RegionCache` 中的 `blockData` 当成 live truth
   - 若某条路径仍读取 `cachedChunkRecord.blockData`，必须明确这是冷边界导入阶段，而不是运行中逻辑判定阶段

## 8.3 Authority Codec / Serialization Boundary

本阶段必须显式区分两种数据格式：

1. **runtime authority format**
   - `Map<number, entry>`
   - 仅存在于主线程 world-level authority 与 live chunk shared view

2. **boundary serialization format**
   - plain object / worker payload / 测试夹具对象
   - 仅用于：
     - Worker 消息
     - 冷边界输入输出
     - 测试断言快照
     - 未来导入导出

建议新增明确 codec：

- `deserializeChunkBlockDataObject(obj) -> Map<number, entry>`
- `serializeChunkBlockDataSlice(map) -> object`

硬约束：

- codec 是边界层，不是热路径 mutation API
- 业务代码不得在 runtime 主链路中频繁 `Object.entries(blockData)` 再回填 authority
- `WorldGenerationService`、`WorldRuntime.ensureChunkData()`、未来 import/export 必须统一走 codec，而不是各自散落地做 object/map 转换

这样做的目的不是形式统一，而是防止旧 plain object 心智继续从冷边界回流到 runtime 主存储

## 8.4 Runtime Dirty vs Export Dirty

本阶段虽然不以持久化为门槛，但必须把“dirty”语义拆清楚：

1. **runtime dirty**
   - 含义：chunk 的派生层、AO、render patch、consolidation 等需要后续处理
   - 服务对象：runtime correctness / visual consistency
   - 不要求生成 `blockDataSnapshot`

2. **export/save dirty**
   - 含义：将来若要导出或持久化，此 chunk 有尚未导出的变更
   - 服务对象：冷存储 / 手动保存
   - 不得再反向影响 runtime live truth

因此：

- `markChunkDirty()` 不应再默认触发“为持久化构造完整 snapshot”
- `recordBlockMutation()` 若保留，必须明确自己属于哪种 dirty 语义
- `flushChunk()`、`pendingUnloadFlushQueue`、`PersistenceService.cache` 不得再被当成 runtime correctness 机制

## 9. 复制与序列化边界

这次改造必须把“什么时候允许 clone”写成硬约束，否则只会把性能问题换位置。

### 9.1 允许 clone 的边界

- Worker `postMessage`
- 测试断言快照
- 未来真正导出存档时

### 9.2 不允许全量 clone 的热路径

- 单块修改
- 批量改单块
- `markChunkDirty()`
- `saveDebounced()`
- 普通运行中的 AO / FaceCulling 派生刷新
- chunk unload

### 9.3 API 边界约束

- `WorldBlockDataStore` 在 runtime 内部的权威存储格式必须是 `Map<number, entry>`
- chunk slice 的主存储格式也必须是 `Map<number, entry>`，不得以普通对象作为 runtime 主存储格式
- `Chunk.blockData` 必须直接引用 `WorldBlockDataStore` 内该 chunk slice 的同一个 `Map` 实例
- world-level `blockData` 的读取接口默认应返回只读视图或约定不可变结果
- 需要高性能时，应优先提供“取 chunk slice 视图”“同步指定字段”“直接挂载 chunk view”的 API
- `Chunk.loadFromRecord()` 必须明确输入是“权威视图”还是“保护性快照”，不能混用
- `replaceChunkSlice(cx, cz, blockData)` 只能用于生成器注入、未来导入、测试夹具、冷边界恢复等低频整块装载场景
- 单块修改、批量改单块、scatter patch、普通 chunk unload / reload 等热路径禁止调用 `replaceChunkSlice()`
- `setBlockEntry()`、`deleteBlockEntry()`、批量局部 patch API 才是 runtime 热路径的合法写入口
- 普通对象序列化形态只允许出现在 Worker 消息、测试快照、未来导出存档等边界，不得回流为 runtime 主存储

## 10. Bootstrap / Import / Export Strategy

### 10.1 本阶段 bootstrap

本阶段推荐最小闭环：

1. 启动游戏
2. 需要 chunk 时先查 world-level `blockData`
3. 没有则走生成器
4. 生成结果直接写 world-level `blockData`
5. loaded chunk 从 world-level `blockData` hydrate

### 10.2 本阶段不恢复的能力

- 不要求冷启动从 IndexedDB 批量导入
- 不要求手动导入 JSON
- 不要求手动导出 JSON

这些能力等 runtime 架构稳定后再恢复，成本更低，也更不容易反复返工。

### 10.3 将来恢复持久化时的接入点

- world-level `blockData` 是唯一导入入口
- world-level `blockData` 是唯一导出来源
- 持久化层永远不得再次插入 runtime 正确性主链路

## 11. 测试迁移矩阵

### 11.1 必须新增的 invariant

1. loaded chunk 修改后，world-level `blockData` 是唯一立即可见真相
2. chunk unload 后，reload 恢复的数据与 unload 前一致
3. 世界生成结果直接进入 world-level `blockData`
4. 不构造 `blockDataSnapshot` 仍能保持 runtime 正确性
5. `visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds` 保持原职责
6. `blockPalette` / `blockPaletteReverse` 继续支撑 `blockDataArray` 紧凑快路径
7. `lightSourceCoords` / `dirtyAOPositions` 继续支撑光照与 AO 增量刷新
8. `instanceIndexMap` / `meshData` / `renderDelta` 继续服务渲染派生层
9. `deletedBlockTombstones` 继续保护晚到 Worker 回包一致性
10. `Chunk.blockData` 与 `WorldBlockDataStore` chunk slice 共享同一个 `Map<number, entry>` 实例
11. 热路径中不允许出现“authority 写一次 + chunk map 再写一次”的重复 mutation
12. `Chunk` attach / rebuild 过程中不会悄悄替换 authority slice 为新的 `Map`
13. runtime-only 模式下，即使 `WorldStore` / `PersistenceService` 不可用，loaded chunk 的编辑 / unload / reload 闭环仍然成立

### 11.2 需要改写的旧测试

- 任何把 `flushChunk()`、`blockDataSnapshot`、`PersistenceService.cache` 当作 runtime 正确性前提的测试
- 任何把 `MemoryWorldStore`、parked holder 或 unload 接班同步当成目标语义的测试

### 11.3 仍应保留的测试

- 旧档迁移测试可暂时保留但降级为 deferred
- AO / tombstone / late worker result 防护测试必须保留
- `acceptScatteredBlocks` / `appendScatteredBlocks` 对隐藏块和跨 chunk 块的正确性测试必须保留

### 11.4 必须新增的竞态与生命周期测试

1. chunk unload 后，晚到 worker 回包不能污染新的 authority / 新 chunk view
2. reload 后，deferred cross-chunk patch 仍命中正确的 authority slice
3. 玩家先修改、后收到 scatter/append patch 时，旧生成结果不能覆盖玩家修改
4. AO mirror / tombstone / renderDelta 在共享 `Map` 后不发生双重消费或漏更新
5. `saveDebounced()`、`flushChunk()`、`PersistenceService.cache` 失效或旁路时，不影响 runtime authority 正确性
6. `RegionCache` 中残留的 `blockData` 不会在 authority 建立后重新覆盖或污染 live truth
7. AO Worker mirror 延迟或重建时，不会把旧 AO 结果回写成逻辑真相
8. consolidation 期间玩家后续修改不会被晚到 consolidation 回包覆盖
9. consolidation 回包不会替换 authority slice，只会刷新派生层与渲染输出

## 12. Migration Strategy

### Phase 1: 语义收敛

- 把文档和注释全部收敛到“world-level `blockData` 唯一权威”语义
- 删除 `MemoryWorldStore` 的目标地位
- 建立 `Chunk.blockData` 作为 chunk 视图的语义

### Phase 2: 统一所有 blockData 写入口

- 穷尽写入口清单
- 统一修改顺序为：`blockData -> 派生索引 -> 异步派生系统`
- 移除任何从索引层反推权威层的路径

### Phase 3: 去掉 runtime blockData 快照链

- 收缩 `WorldRuntime.recordBlockMutation()`
- 停止构建完整 `blockDataSnapshot`
- `saveDebounced()` 只保留 runtime dirty 标记或直接去除其持久化职责

### Phase 3.1: Snapshot Consumer Retirement

“停止构造 `blockDataSnapshot`”本身并不够，还必须明确所有 snapshot consumer 的去留策略。

至少需要覆盖以下路径：

1. `_resolveSerializedBlockData()`
2. `flushChunk()`
3. `flushBeforeUnload()`
4. `flushAllDirty()`
5. `_ensureDirtyChunkEntry()` 中与 `blockDataSnapshot` 相关的初始化字段

每条路径都必须明确属于以下哪一类：

- **delete**
  - 本阶段直接删除，不再保留

- **deferred shell / no-op**
  - 保留函数签名，但不再参与 runtime 正确性

- **authority-based rewrite**
  - 若未来仍需保留功能，则改为直接从 authority 或其显式序列化边界取数据

不允许出现的中间态：

- snapshot 生产逻辑已被删弱
- 但消费者仍沿用 `snapshot -> region-cache -> live-chunk` 的旧模糊回退链

如果某个旧方法暂时保留，其文档必须明确：

- 它不再消费 `blockDataSnapshot`
- 它是否仍参与 runtime 主链路
- 它若取数据，新的来源是什么

### Phase 4: 推迟存档层实现

- `PersistenceService` / `WorldStore` / `PersistenceWorker` 标记为 deferred
- 等 runtime 架构稳定后，再基于 world-level `blockData` 恢复导入导出

## 13. Risks

1. 若 world-level `blockData` 实际上仍只是 `Chunk.blockData` 的拷贝集合，而不是唯一权威，则会重新引入双写与同步歧义
2. 若只改单块修改路径，漏掉 scatter / batch / generation 等写入口，最终仍会存在双语义
3. 若未明确 clone 边界，只会把深拷贝热点从 `WorldRuntime` 转移到新的 authority API
4. 若错误地删除 `deletedBlockTombstones`，会重新引入晚到 Worker 回包脏写
5. 若误把 `blockDataArray` / `solidBlockIds` 当成多余权威副本删除，会导致高频查询性能回退

## 14. Success Criteria

改造完成后，应满足以下判断：

1. runtime 中逻辑真相只认 world-level `blockData`
2. `Chunk.blockData` 只是 chunk 视图，不再是第二权威
3. 世界生成结果直接写入 world-level `blockData`
4. chunk unload 不再承担权威同步动作
5. runtime 正确性不再依赖任何 `blockDataSnapshot` / unload flush queue / `PersistenceService.cache`
6. `visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds` 继续存在，但只作为派生索引或高速查询缓存
7. 持久化层即使暂时缺席，也不影响 runtime 正确性
8. `Chunk` 的 attach / hydrate / rebuild 语义明确，不再把“复制 blockData 到 chunk 本地”误当成权威接入
9. 所有热路径写入都经过统一 mutation 原语，不再允许隐式直写共享 `Map`
