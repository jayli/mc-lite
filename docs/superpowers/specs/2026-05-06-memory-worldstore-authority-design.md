# Runtime Memory WorldStore Authority Design

> **Problem:** 运行期 chunk 加载当前仍依赖 `IndexedDB` / `PersistenceWorker` 读取权威 `ChunkRecord`，并且后台 unload flush、region patch、chunk 主线程装配、global instanced mesh patch 互相耦合，导致读路径排队、主线程长任务和帧尖峰叠加，无法稳定达到 60fps。

## 1. Goal

将运行期权威数据源从 `IndexedDB` 迁移到常驻内存的 `IndexedDB_Memory_Storage`，并围绕这一变更清理三条高成本链路：

1. 去掉运行期 chunk load 对 `IndexedDB` 的依赖
2. 将 chunk 主线程装配拆成更细粒度的 stage
3. 将 global instanced mesh patch 从全量比较改为增量 patch

本设计明确接受以下取舍：

- 启动/读档可以更慢
- 运行期不考虑异常崩溃后的进度丢失
- 自动持久化不是当前目标
- 未来仅通过手动保存功能将内存权威层导出到 `IndexedDB`

## 2. Non-Goals

- 本次不实现手动保存 UI 或导出流程
- 本次不重做世界生成算法
- 本次不要求第一阶段就把全部权威数据结构 TypedArray 化
- 本次不解决所有渲染性能问题，只聚焦 chunk streaming 主链路

## 3. Current Root Cause

### 3.1 运行期读取与写回竞争

当前 [src/world/World.js](/Users/bachi/jaylli/mc-lite/src/world/World.js:308) 中 `_requestRuntimeChunkRecord()` 通过 `WorldRuntime.ensureChunkData()` 读取权威 chunk record，并记录 `world.runtime-chunk-record-db`。

读取路径最终落到：

- [src/world/WorldStore.js](/Users/bachi/jaylli/mc-lite/src/world/WorldStore.js:136) `getChunkRecord`
- [src/workers/PersistenceWorker.js](/Users/bachi/jaylli/mc-lite/src/workers/PersistenceWorker.js:165) `getChunkRecord`

同时 unload/background flush 路径仍然会在运行期触发：

- [src/world/WorldRuntime.js](/Users/bachi/jaylli/mc-lite/src/world/WorldRuntime.js:584) `_flushPendingUnloadQueueWithinBudgetInternal`
- [src/workers/PersistenceWorker.js](/Users/bachi/jaylli/mc-lite/src/workers/PersistenceWorker.js:229) `applyRegionPatch`

结果是同一个 `PersistenceWorker` 同时承担：

- 运行期 chunk record 读取
- region patch / saveRegionRecord 写回
- worker 内 region cache 仲裁

这会把后台写压力传导到前台读路径。

### 3.2 Chunk 主线程装配过粗

[src/world/Chunk.js](/Users/bachi/jaylli/mc-lite/src/world/Chunk.js:284) `loadFromRecord()` 在逻辑上虽然把装配交给了 scheduler，但当前 `runtime-build` 阶段仍然打包了以下重活：

- `_injectBlockData()`
- `_buildMeshFromExistingBlockData()`
- `buildMeshes()`

[src/world/ChunkAssemblyScheduler.js](/Users/bachi/jaylli/mc-lite/src/world/ChunkAssemblyScheduler.js:127) 的 `runtime-build` stage 不可中断，所以单个 task 仍可跑到 8~12ms。

### 3.3 Global Instanced Mesh Patch 仍做全量比较

[src/core/GlobalInstancedMeshManager.js](/Users/bachi/jaylli/mc-lite/src/core/GlobalInstancedMeshManager.js:393) `patchChunkVisibleBlocks()` 每次 patch 都会：

- 遍历整份 `instanceIndexMap`
- 构造 `Set`
- 做 update/add/remove 三类混合处理
- 对已有 coords 做全量比较删除

这导致 patch 可以单次达到 10ms+。

## 4. Proposed Architecture

### 4.1 Runtime Authority Layers

新的运行期数据层分为两层：

1. **`IndexedDB_Memory_Storage` / `MemoryWorldStore`**
   - 整个已生成世界的唯一权威数据源
   - 启动时一次性全量导入旧世界，或由生成器直接写入
   - 运行期间只在内存中读写
   - 不自动回写 `IndexedDB`

2. **`Chunk Working Set`**
   - 当前已加载 chunk 的热数据视图
   - 以 `chunk.blockData` 为逻辑入口
   - 挂载逻辑/渲染派生缓存：
     - `blockDataArray`
     - `solidBlocks`
     - `solidBlockIds`
     - `lightSourceCoords`
     - `visibleKeys`
     - 增量 render delta

关系如下：

```text
MemoryWorldStore (唯一真相)
  -> Chunk.loadFromMemoryRecord()
    -> Chunk Working Set
      -> 渲染 / 碰撞 / 交互

Chunk Working Set mutation
  -> 同步 apply 到 MemoryWorldStore
```

### 4.2 New Data Sources

运行期只允许两种权威数据进入 `MemoryWorldStore`：

1. **旧存档读档**
   - `IndexedDB -> MemoryWorldStore.importAll()`
2. **新世界生成**
   - `World generation -> MemoryWorldStore.createOrReplaceChunkRecord()`

一旦进入 session：

- `MemoryWorldStore` 成为唯一真相
- `Chunk` 不再从 `IndexedDB` 读取
- `Chunk` 卸载不再触发保存正确性的后台回写

## 5. Memory Data Model

### 5.1 First-Phase Structure

第一阶段先保持语义稳定，不立刻做激进压缩：

```js
class MemoryWorldStore {
  worldMeta;
  regions;     // Map<regionKey, MemoryRegionRecord>
  chunks;      // Map<chunkKey, MemoryChunkRecord>
  dirtyChunks; // Set<chunkKey>
  stats;
}

class MemoryRegionRecord {
  regionKey;
  rx;
  rz;
  chunkKeys;
  chunks;
  generatedAt;
  generatorVersion;
}

class MemoryChunkRecord {
  chunkKey;
  cx;
  cz;
  blockData;
  staticEntities;
  runtimeSeedData;
  runtimeEntities;
  version;
  dirty;
  lastModifiedAt;
}
```

其中 `blockData` 第一阶段仍可沿用当前对象格式 `{ [encodedCoord]: entry }`，以降低迁移成本并复用现有 `ChunkRecord` 语义。

### 5.2 Second-Phase Upgrade Path

等运行期链路稳定后，再考虑：

- `blockData` 改为稠密层 + 稀疏层
- 活跃 chunk working set 优先 TypedArray 化
- 权威层保留对象版或做延后压缩

本次设计不把 TypedArray 化作为前置条件。

## 6. Read / Write Semantics

### 6.1 Read Path

运行期 chunk 加载路径改成：

```text
World
  -> MemoryWorldStore.getChunkRecord(chunkKey)
  -> Chunk.loadFromMemoryRecord(record)
  -> ChunkAssemblyScheduler enqueue fine-grained stages
```

运行期不允许出现：

- `world.runtime-chunk-record-db`
- chunk load 回源 `WorldStore.getChunkRecord()`
- `PersistenceWorker` 参与 chunk streaming

### 6.2 Write Path

你已明确要求 `chunk.blockData` 改动后立即同步到权威层，因此规则固定为：

1. 所有方块修改先改 `chunk.blockData`
2. 同一调用栈内立即调用 `MemoryWorldStore.applyBlockMutation(...)`
3. 渲染/AO/face culling patch 继续由 `Chunk` 自己负责

这意味着：

- `dirty` 不再服务运行期正确性
- `dirty` 只为未来手动保存准备
- 卸载 chunk 时不需要再“补写真相”

## 7. Component Changes

### 7.1 `MemoryWorldStore`

新增 `src/world/MemoryWorldStore.js`，负责：

- 全量导入旧存档到内存
- 接收新世界生成结果
- 提供 chunk 级快速索引
- 记录 dirty/version/stats
- 提供 block mutation API

建议核心 API：

- `importAllFromPersistence()`
- `createOrReplaceChunkRecord(chunkKey, chunkRecord)`
- `getChunkRecord(cx, cz)`
- `getRegion(rx, rz)`
- `applyBlockMutation(cx, cz, coord, entry)`
- `applyChunkBlockSnapshot(cx, cz, blockData)`
- `getStats()`

### 7.2 `WorldRuntime`

`WorldRuntime` 从“回写协调器”改为“内存工作集协调器”。

下线或旁路的职责：

- `pendingUnloadFlushQueue`
- `flushChunk`
- `flushAllDirty`
- `flushBeforeUnload`
- `background-flush`

保留职责：

- chunk 生命周期
- 运行时 region/chunk 索引
- 预取/边界逻辑
- 活跃 chunk 与权威内存层的协调

### 7.3 `WorldStore`

`WorldStore` 从“运行期权威接口”降级为：

- 旧存档导入工具
- 未来手动保存导出工具

运行期主链路不再直接依赖它。

### 7.4 `Chunk`

`Chunk` 继续承担活跃 chunk 的热数据结构和局部渲染逻辑，但不再承担“卸载前回写持久化”的职责。

需要改造的重点：

- 提供 `loadFromMemoryRecord()`
- 将 block mutation 同步到 `MemoryWorldStore`
- 拆细运行期装配 stage
- 维护 render delta

## 8. Chunk Assembly Refactor

### 8.1 Target

目标不是减少阶段数，而是压低单阶段峰值：

- 单个 stage 尽量控制在 2~4ms
- 避免任何单 task 长时间阻塞主线程

### 8.2 Proposed Stages

将当前粗粒度 `runtime-build` 拆成：

1. `hydrate`
   - 接收 `MemoryChunkRecord`
   - 绑定最小上下文

2. `rebuild-indices`
   - 重建 `solidBlocks`、`lightSourceCoords`、`blockDataArray`

3. `collect-blocks`
   - 从 `blockData` 收集 `blocks[]`

4. `convert-mesh`
   - 转成 mesh groups / AO / orientation 数据

5. `prepare-visible`
   - 构建 `visibleKeys`

6. `enqueue-mesh`
   - 将数据推入 global manager 队列

7. `finalize-minimal`
   - 仅做 `isReady/loadState` 切换

8. `deferred-finalize`
   - 光源注册
   - AO stable refresh
   - 运行时实体恢复

### 8.3 Stage Discipline

- `Chunk.loadFromMemoryRecord()` 只做 record 接收和调度入队
- 重活都放到 scheduler 的细粒度 stage
- `finalize-minimal` 必须保持极轻

## 9. Global Instanced Mesh Patch Refactor

### 9.1 Problem

现状中 patch 基于“全量可见集合对比”，导致：

- `Object.entries(instanceIndexMap)`
- `Set`
- `Array.from(existingCoords)`
- update/add/remove 混合处理

### 9.2 Proposed Delta Model

让 `Chunk` 维护自己的渲染增量：

- `addedCoords`
- `removedCoords`
- `updatedCoords`

新增接口：

- `GlobalInstancedMeshManager.applyChunkDelta(chunkKey, delta)`

路径区分为：

1. 首次 chunk 加载
   - 走 `replaceChunkVisibleBlocks`
2. 运行期方块修改
   - 走 `applyChunkDelta`

### 9.3 Budgeting

增量 patch 同样纳入帧预算：

- 限制单帧 patch 块数
- 限制单帧 patch ms
- 与现有 `flushMutationQueue` 预算模型对齐

## 10. Migration Strategy

### Phase 1

先引入 `MemoryWorldStore`，切断运行期 DB 权威性，但暂时保留旧持久化代码供导入使用。

### Phase 2

将 `Chunk` 的 block mutation 立即同步到 `MemoryWorldStore`，去掉 unload flush 正确性依赖。

### Phase 3

拆细 chunk assembly stage，消除 8~12ms 主线程任务。

### Phase 4

实现 global mesh 增量 patch，削掉 10ms+ patch 尖峰。

### Phase 5

再做 GC/内存压缩优化。

## 11. Observability

本次改造后，建议补充以下运行期指标：

- `world.runtime-chunk-record-memory`
- `memory-worldstore.hit/miss`
- `memory-worldstore.world-size`
- `chunk-assembly.stage.*`
- `global-instanced-mesh.delta-patch`
- `chunk.block-mutation.sync-memory`

目标是能清楚区分：

- 权威层读取是否还在卡
- 主线程装配是否仍有超预算阶段
- patch 是否还有局部峰值

## 12. Expected Outcome

如果该设计完整落地，运行期应具备以下特征：

- chunk load 不再等待 `IndexedDB`
- chunk unload 不再触发后台写回竞争
- `PersistenceWorker` 不再参与 streaming 主链路
- `ChunkAssemblyScheduler` 不再存在 8~12ms 的粗任务
- global mesh patch 不再依赖全量集合比较
- 运行期权威链路收敛为：

```text
MemoryWorldStore
  -> Chunk Working Set
    -> Render Delta
```

## 13. Risks

1. 全世界一次性载入内存会增加启动时间与 RAM 占用
2. 如果仍有旧路径直接改 `chunk.blockData` 而不改权威层，会造成双份状态漂移
3. stage 拆细后需要更严格的 chunk 生命周期状态机
4. 增量 patch 若漏清理 delta，会出现渲染残影或重复实例

这些风险都可接受，因为它们比当前“运行期掉帧”更容易被观测和修正。
