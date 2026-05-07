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

## 2. Goal

本设计的目标是把运行时的逻辑真相统一收敛到 `blockData` 语义上，并在此基础上保留当前所有关键功能：

1. `blockData` 升级为**世界级唯一权威数据源**
2. `Chunk.blockData` 不再是独立第二份真相，而是 world-level `blockData` 在 chunk 实例中的局部运行时视图
3. 世界生成直接产出并写入 world-level `blockData`
4. 彻底删除 `MemoryWorldStore`
5. `Chunk.visibleKeys`、`Chunk.solidBlocks`、`Chunk.blockDataArray`、`Chunk.solidBlockIds` 继续保留，作为 chunk 层派生索引或高速查询结构
6. 消灭运行时的 blockData 全量快照链，减少 clone、序列化和跨线程传输次数，为后续性能优化打基础

## 3. Non-Goals

本次设计明确不做以下事情：

1. 不重写 `visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds` 的用途与算法
2. 不改变 AO / Face Culling / Global Instanced Mesh 的核心渲染策略
3. 不把特殊实体逻辑硬塞进普通 `blockData` 语义
4. 不在本阶段实现新的 IndexedDB 持久化方案
5. 不在本阶段推进 TypedArray 化的权威存储
6. 不要求本次一并解决所有渲染性能热点

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
   - 允许写：可以，但写入必须直接命中 world-level authority
   - 生命周期：随 chunk 加载/卸载而出现/消失

状态切换规则：

- `load`：创建 chunk 实例视图
- `unload`：销毁 chunk 实例视图
- world-level `blockData` 全程不发生“转移持有者”

### 5.3 删除 `MemoryWorldStore`

本设计的目标态中：

- 不保留 `MemoryWorldStore`
- 不保留“loaded / unloaded 双 holder”模型
- 不保留任何“卸载前把权威同步到另一个内存层”的语义

需要留下来的能力只有：

- world-level `blockData`
- world-level chunk record 索引
- chunk 视图的加载和释放

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

需要特别确认保留：

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

### 6.7 实体层

- `runtimeEntities`
- `staticEntities`
- `entityCollisionIndex`
- `specialEntitiesShadowStore`

语义：实体域权威与碰撞域，不混入普通块逻辑真相。

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

### 7.2 单块修改

目标链路：

```text
WorldAccessLayer.setBlock/removeBlock
-> Chunk._updateBlockState()
-> 修改 Chunk.blockData
-> 同步写入 world-level blockData authority
-> 增量更新 visibleKeys / solidBlocks / blockDataArray / lightSourceCoords / dirtyAOPositions / renderDelta
-> AOBridge / tombstones 同步
-> 仅标记 chunk runtime dirty
```

关键约束：

- 真相先改 `blockData`
- `Chunk.blockData` 只是世界级权威的 chunk 访问入口
- 不再构造完整 `blockDataSnapshot`
- 不再为了持久化链路即时 clone 整个 chunkRecord

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

统一原则：

- 所有逻辑修改必须先触达 `blockData`
- 索引层只能被 `blockData` 驱动更新
- 不允许索引层反向决定逻辑真相

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

- world-level `blockData` 的读取接口默认应返回只读视图或约定不可变结果
- 需要高性能时，应优先提供“取 chunk slice 视图”“同步指定字段”“直接挂载 chunk view”的 API
- `Chunk.loadFromRecord()` 必须明确输入是“权威视图”还是“保护性快照”，不能混用

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

### 11.2 需要改写的旧测试

- 任何把 `flushChunk()`、`blockDataSnapshot`、`PersistenceService.cache` 当作 runtime 正确性前提的测试
- 任何把 `MemoryWorldStore`、parked holder 或 unload 接班同步当成目标语义的测试

### 11.3 仍应保留的测试

- 旧档迁移测试可暂时保留但降级为 deferred
- AO / tombstone / late worker result 防护测试必须保留
- `acceptScatteredBlocks` / `appendScatteredBlocks` 对隐藏块和跨 chunk 块的正确性测试必须保留

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
