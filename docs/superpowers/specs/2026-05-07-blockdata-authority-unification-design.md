# BlockData Authority Unification Design

> **Problem:** 当前 runtime 期间的逻辑方块真相被拆散在 `Chunk.blockData`、`MemoryWorldStore.chunks[].blockData`、`WorldRuntime` 的快照链、`PersistenceService.cache` 与 `PersistenceWorker.regionCache` 周围。结果是运行时既存在双权威语义，也存在多条全量 clone / region patch / flush queue 链路，导致数据层次复杂、拷贝次数多、`postMessage` 载荷过大，且后续优化难以落点。

## 1. Goal

本设计的目标是把运行时的逻辑真相统一收敛到 `blockData` 语义上，并在此基础上保留当前所有关键功能：

1. 已加载 chunk 的逻辑真相由 `Chunk.blockData` 唯一承载
2. 未加载 chunk 的逻辑真相由 `MemoryWorldStore` 持有对应 chunk 的 `blockData`
3. `visibleKeys`、`solidBlocks`、`blockDataArray`、`meshData` 等结构继续保留，但明确降级为派生索引或渲染载荷
4. `IndexedDB` 降级为冷存储 / 导出 / 刷新恢复来源，不再参与 runtime 权威判断
5. 消灭运行时的 blockData 全量快照链，减少 clone、序列化和跨线程传输次数，为后续 `postMessage` / 持久化粒度优化打基础

## 2. Non-Goals

本次设计明确不做以下事情：

1. 不重写 `visibleKeys`、`solidBlocks`、`blockDataArray` 的用途与算法
2. 不改变 AO / Face Culling / Global Instanced Mesh 的核心渲染策略
3. 不把特殊实体逻辑硬塞进普通 `blockData` 语义
4. 不在第一阶段改成 chunk 级独立 `IndexedDB` store
5. 不在第一阶段推进 TypedArray 化的权威存储
6. 不要求本次一并解决所有渲染性能热点

## 3. Current System Reality

### 3.1 当前并非单一运行时权威

当前代码中，逻辑真相至少被拆在两处：

- 已加载 chunk 的真相主要在 `Chunk.blockData`
- 未加载 chunk 的真相主要在 `MemoryWorldStore.chunks[].blockData`

这本身是合理的冷热分层，但问题在于系统没有把它们表达为“同一语义在 loaded / unloaded 两种形态下的持有者”，而是让它们看起来像两套并行权威。

### 3.2 运行时仍然保留旧持久化快照链

尽管若干注释已将 `IndexedDB` 描述为冷存储，但当前运行时仍保留下列热路径：

- `Chunk.saveDebounced()`
- `WorldRuntime.recordBlockMutation()`
- `WorldRuntime._dirtyChunks[].blockDataSnapshot`
- `WorldRuntime.flushChunk()`
- `pendingUnloadFlushQueue`
- `WorldStore.commitChunkRecord()`
- `PersistenceWorker.applyRegionPatch()`

这意味着：

- runtime 期间仍在构造稳定 blockData 快照
- 仍在维护 region 级 patch / flush 队列
- 仍有完整对象跨线程传输和 `IndexedDB.put()` 的结构化复制

### 3.3 当前渲染与查询索引本身并不是问题

以下结构虽然重复了部分 block 信息，但其职责是合理的：

- `visibleKeys`：显示可见性索引
- `solidBlocks`：碰撞索引
- `blockDataArray` + `solidBlockIds` + palette：chunk 内高频查询索引
- `meshData` / `instanceIndexMap` / `renderDelta`：渲染载荷与增量补丁
- `lightSourceCoords` / `dirtyAOPositions`：光照与 AO 派生索引
- `deletedBlockTombstones`：异步一致性保护层

因此本设计不是“去掉所有重复数据”，而是“去掉所有重复权威和重复快照链”。

## 4. Proposed Authority Model

### 4.1 统一语义：`blockData` 是唯一逻辑真相

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

### 4.2 Loaded / Unloaded 两种持有形态

`blockData` 在运行时有两种持有形态：

1. **Loaded 形态**
   - 由 `Chunk.blockData` 持有
   - 当 chunk 已加载时，它是该 chunk 的唯一活跃逻辑权威

2. **Unloaded 形态**
   - 由 `MemoryWorldStore.chunks[].blockData` 持有
   - 当 chunk 被卸载后，它接管该 chunk 的逻辑真相

这意味着：

- `MemoryWorldStore` 不能删除
- 但它不再被视为“另一套并行权威模型”
- 它应被重新定义为“未加载 chunk 的 `blockData` 容器 + 世界级索引”

### 4.3 冷存储退出运行时权威判断

`IndexedDB` 在目标模型中只负责：

- 启动时读入旧档
- 手动保存或后台异步落盘
- 刷新页面后的恢复来源

运行时正确性不再依赖：

- `WorldRuntime.blockDataSnapshot`
- `PersistenceService.cache`
- `pendingUnloadFlushQueue`
- `PersistenceWorker.regionCache`

## 5. Target Layering

### 5.1 权威逻辑层

- `Chunk.blockData`
- `MemoryWorldStore.chunks[].blockData`

语义：世界逻辑真相，只在 loaded / unloaded 两种状态下切换持有者。

### 5.2 渲染索引层

- `Chunk.visibleKeys`

语义：当前是否应显示、是否参与补面与可见块更新。

### 5.3 碰撞索引层

- `Chunk.solidBlocks`

语义：当前是否是实心块、是否参与碰撞和物理查询。

### 5.4 高频查询索引层

- `Chunk.blockDataArray`
- `Chunk.solidBlockIds`
- `Chunk.blockPalette`
- `Chunk.blockPaletteReverse`

语义：服务 chunk 内高频 `isSolid` / `resolveBlockOwner` / 局部块访问，不承担权威职责。

### 5.5 渲染载荷层

- Worker `meshData`
- `Chunk.instanceIndexMap`
- `Chunk.renderDelta`
- `GlobalInstancedMeshManager` 的 chunk 输出状态

语义：面向渲染提速和 GPU 输出。

### 5.6 光照与一致性保护层

- `Chunk.lightSourceCoords`
- `Chunk.dirtyAOPositions`
- AO Worker 的 `blockData` 镜像
- `Chunk.deletedBlockTombstones`

语义：AO / 光照增量刷新与晚到回包保护。

### 5.7 实体与冷存储层

- `runtimeEntities`
- `staticEntities`
- `entityCollisionIndex`
- `IndexedDB`

语义：实体域权威与冷存储。

## 6. Target Data Flow

### 6.1 单块修改

目标链路：

```text
WorldAccessLayer.setBlock/removeBlock
-> Chunk._updateBlockState()
-> 修改 Chunk.blockData
-> 增量更新 visibleKeys / solidBlocks / blockDataArray / lightSourceCoords / dirtyAOPositions / renderDelta
-> AOBridge / tombstones 同步
-> MemoryWorldStore.applyBlockMutation()
-> 标记冷存储落盘脏块（仅标脏，不构造快照）
```

关键约束：

- 真相先改 `Chunk.blockData`
- `MemoryWorldStore` 只做 unloaded 接班准备
- 不再构造完整 `blockDataSnapshot`

### 6.2 Chunk 加载

目标链路：

```text
World 请求 chunk
-> 先查 MemoryWorldStore.getChunkRecord()
-> miss 时回源冷存储或生成器
-> 回源结果先写入 MemoryWorldStore
-> Chunk.loadFromRecord()
-> Chunk.blockData 接管为 loaded 权威
-> 从 blockData 重建 blockDataArray / solidBlocks / solidBlockIds / lightSourceCoords
-> Worker 计算 visibleKeys / meshData / AO
-> Worker 回包只更新派生层
```

关键约束：

- Worker 不能直接改写逻辑真相
- `Chunk.blockData` 在加载完成后成为唯一活跃逻辑权威

### 6.3 Chunk 卸载

目标链路：

```text
World.beforeChunkUnloadSync()
-> 用当前 Chunk.blockData / runtimeEntities / staticEntities 覆盖 MemoryWorldStore 中对应记录
-> 释放 visibleKeys / solidBlocks / blockDataArray / meshData / instanceIndexMap / dynamicMeshes
-> 标记冷存储落盘脏块
```

关键约束：

- 卸载后仍能 reload 恢复
- 不再依赖 `pendingUnloadFlushQueue`

### 6.4 Reload / 刷新恢复

目标链路：

```text
启动
-> 从 IndexedDB 读取 chunkRecord / regionRecord
-> 导入 MemoryWorldStore
-> runtime streaming 时从 MemoryWorldStore 读取
-> Chunk.loadFromRecord() 接管 loaded 权威
```

关键约束：

- 先建立世界级内存视图，再进入 runtime streaming
- 导入 JSON 存档时走 MemoryWorldStore，而不是先走 PersistenceService.cache

### 6.5 手动保存

目标链路：

```text
保存前先把所有 loaded chunk 同步回 MemoryWorldStore
-> collectSnapshot() 直接从 MemoryWorldStore 读取
-> 生成 saveData
-> 可选异步落盘到 IndexedDB
```

关键约束：

- 导出文件不依赖当前 `IndexedDB` 状态
- `collectSnapshot()` 不再逐 chunk 回查 `worldStore.getChunkRecord()`

## 7. Component Responsibilities After Migration

### 7.1 `Chunk`

保留职责：

- 持有 loaded chunk 的 `blockData`
- 维护所有查询 / 渲染派生层
- 在单块编辑时驱动派生层增量更新
- 对 AO / Face Culling / render delta 负责

调整职责：

- `blockData` 注释更新为“完整逻辑块集合”
- 不再承担持久化快照链的协调逻辑

### 7.2 `MemoryWorldStore`

保留职责：

- 世界级 chunk 索引
- 已知世界块数据的内存持有
- chunk unload 后的逻辑状态承接
- 手动保存与刷新恢复的统一读取入口

调整职责：

- 语义从“并行运行时权威”收窄为“未加载 chunk 的 `blockData` 容器”
- `dirtyChunks` 只为冷存储落盘服务

### 7.3 `WorldRuntime`

保留职责：

- 冷读取协调
- 旧档导入辅助
- region 预取辅助
- 冷写入调度

删除或退出主链路的职责：

- runtime 期间完整 `blockDataSnapshot` 维护
- `flushChunk()` 参与运行时正确性
- `pendingUnloadFlushQueue`

### 7.4 `PersistenceService` / `WorldStore` / `PersistenceWorker`

保留职责：

- 冷存储读写
- 旧档兼容转换
- 手动保存或后台落盘

退出职责：

- runtime 主链路权威读取
- 运行时 blockData snapshot cache

## 8. Migration Strategy

### Phase 1: 语义收敛

- 更新 `Chunk.blockData` 与 `MemoryWorldStore` 的职责定义
- 不改现有功能行为

### Phase 2: 去掉 runtime blockData 快照链

- 收缩 `WorldRuntime.recordBlockMutation()`
- 停止构建完整 `blockDataSnapshot`
- `saveDebounced()` 只标记冷存储脏块

### Phase 3: 保存与导入改读内存权威

- `Game.collectSnapshot()` 改从 `MemoryWorldStore` 读取
- `Game.applySaveData()` 改直接写 `MemoryWorldStore`

### Phase 4: 收缩旧持久化缓存层

- deprecated `PersistenceService.cache`
- deprecated `pendingUnloadFlushQueue`
- 将 `WorldRuntime` 明确降级为冷存储协调器

### Phase 5: 真正评估消息粒度 / 持久化粒度优化

- 区分 `postMessage` 消息体成本与 `IndexedDB.put(regionRecord)` 结构化复制成本
- 再决定是否推进 chunk 级持久化

## 9. Risks

1. 若过早删除 `PersistenceWorker.regionCache`，旧档冷启动可能退化
2. 若 `collectSnapshot()` 改读内存后未先同步 loaded chunk，手动保存会漏最新修改
3. 若错误地删除 `deletedBlockTombstones`，会重新引入晚到 Worker 回包脏写
4. 若把特殊实体占位强塞进普通 `blockData`，会污染块语义与索引层
5. 若误把 `blockDataArray` / `solidBlockIds` 当成多余权威副本删除，会导致高频查询性能回退

## 10. Success Criteria

改造完成后，应满足以下判断：

1. 已加载 chunk 的逻辑真相只在 `Chunk.blockData`
2. 未加载 chunk 的逻辑真相只在 `MemoryWorldStore.chunks[].blockData`
3. `visibleKeys` / `solidBlocks` / `blockDataArray` 只作为派生索引存在
4. runtime 正确性不再依赖任何 `blockDataSnapshot` / unload flush queue / PersistenceService.cache
5. `collectSnapshot()` 与 `applySaveData()` 不再依赖 `worldStore.getChunkRecord()` 或 `PersistenceService.injectSaveData()`
6. `IndexedDB` 只承担冷存储职责
