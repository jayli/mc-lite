# Research: 跨 Chunk 材质合批

**Date**: 2026-04-12
**Branch**: `001-cross-chunk-batching`

## R1: 现有架构分析

### Decision: 在 World 层新建 ChunkBatchManager，统一管理跨 Chunk 的 InstancedMesh

**Rationale**:
- 当前每个 Chunk 独立持有 `this.group = new THREE.Group()`，其中每个 blockType 对应一个 `THREE.InstancedMesh`
- `MaterialManager` 已有 `getBatchedMaterial(textureUrl, blockTypes)` 和 `batchedMaterials` Map，以及 `getTextureGroups()` 方法按纹理 URL 分组
- Chunk 通过 `${cx},${cz}` 键在 `World.chunks` Map 中索引，World 完整管理 Chunk 生命周期
- 最小侵入方案：在 World 和 Chunk 之间插入一个合批层，Chunk 不再直接向 Scene 添加 mesh，而是将实例数据注册到 ChunkBatchManager

**Alternatives considered**:
1. **修改 Worker 层合批** — 需要改动 WorldWorker 通信协议，侵入性大，且 Worker 生成的是原始矩阵数据，合批更适合在主线程渲染层完成
2. **使用 THREE.BatchedMaterial** — 项目已有自定义的 batched material 机制，无需引入新 API
3. **全局单 InstancedMesh（所有纹理合并）** — 不现实，不同纹理必须使用不同材质，无法合并到一个 draw call

### 现有数据流

```
Chunk.buildMeshes() (ChunkGenerator)
  → 对每个 blockType 创建 InstancedMesh(geometry, material, count)
  → 设置 instanceMatrix
  → 添加到 chunk.group (THREE.Group)
  → chunk.group 被添加到 scene

World.updateChunks()
  → 检测视距内的 chunk，创建/销毁
  → chunk.dispose() 时清理 geometry + group
```

### 目标数据流

```
Chunk.buildMeshes()
  → 生成实例矩阵数据（不创建 InstancedMesh）
  → 调用 ChunkBatchManager.registerChunk(chunkKey, instancesByTexture)

ChunkBatchManager
  → 按纹理组管理全局 InstancedMesh
  → 每个纹理组一个 InstancedMesh，包含所有 Chunk 的实例
  → registerChunk/unregisterChunk/updateChunk 增量更新

Chunk.dispose()
  → 调用 ChunkBatchManager.unregisterChunk(chunkKey)
```

## R2: 实例矩阵增量更新策略

### Decision: 分区写入 — 每个 Chunk 在 InstancedMesh 中占用连续区段

**Rationale**:
- 每个 Chunk 注册时分配一个偏移量区间 [start, end)
- 更新时只写入该区间的矩阵数据（`instanceMatrix.array.set(data, offset)`）
- 卸载时标记区间为空闲，通过空闲列表管理复用
- 比全量重建所有实例矩阵更高效，且支持增量更新

**Alternatives considered**:
1. **全量重建** — 简单但每次 Chunk 变更都要重建所有实例，O(N) 开销
2. **紧凑排列** — 每次卸载后紧凑化，避免空洞但增加移动开销

**更新频率分析**:
- 区块加载/卸载：低频（秒级），可接受少量重排
- 方块放置/移除：中频，需要增量更新
- 爆炸等大规模操作：低频，可触发局部重排

### InstancedMesh 容量管理

- 初始分配预估值：`maxInstancesPerTexture = totalChunks * avgBlocksPerType`
- 当实例数超过当前 InstancedMesh 容量时，创建更大的 InstancedMesh 并复制数据
- 容量增长策略：×2 倍增，最大不超过 GPU 限制

## R3: 与现有 Chunk 系统的集成点

### Decision: 通过 Chunk 生命周期钩子集成，最小化 Chunk 内部修改

**关键集成点**:

| 事件 | 触发点 | ChunkBatchManager 操作 |
|------|--------|----------------------|
| Chunk mesh 数据就绪 | `Chunk.onMeshReady()` | `registerChunk()` |
| 方块变更触发重建 | `Chunk.buildMeshes()` | `updateChunk()` |
| Consolidation 完成 | `ChunkConsolidation` 回调 | `updateChunk()` |
| Chunk 卸载 | `World.removeChunk()` | `unregisterChunk()` |
| 视距切换 | `World.updateRenderDistance()` | `rebuildAll()` |

**Chunk 修改范围**:
- `buildMeshes()`: 不再创建 InstancedMesh，改为产出实例数据 → 注册到 BatchManager
- `dispose()`: 不再直接 dispose mesh，改为通知 BatchManager 注销
- 保留 `chunk.group` 用于特殊实体（树、矿车等非方块渲染）

## R4: 验证方法设计

### Decision: 控制台命令 `window.game.batchManager.getStats()`

**Rationale**:
- 游戏实例已暴露在 `window.game`，符合项目惯例
- 返回结构化对象，开发者可在控制台直接查看
- 包含：总 draw call 数、各纹理组的区块合并数、实例总数

**输出示例**:
```
跨 Chunk 合批统计:
  总 Draw Call: 15 (优化前: 147, 减少: 89.8%)
  纹理组: 15
  总实例数: 28456
  各组详情:
    [stone] 区块: 42, 实例: 8920
    [grass_top] 区块: 39, 实例: 6340
    ...
```

## R5: 性能预算

### Decision: 合批管理器单帧开销不超过 2ms

**Rationale**:
- 规格要求总帧耗时增加不超过 5ms
- Chunk 注册/注销发生在区块加载时（低频），可分散到多帧
- 增量矩阵更新（方块变更）在单帧内完成，写入量通常 <100 个矩阵
- 实测基线：当前渲染约 49 个区块 × 10 种纹理 ≈ 490 draw call，目标减少到 10-20

**关键指标**:
- InstancedMesh 容量预分配避免运行时扩容
- 矩阵写入使用 TypedArray.set() 批量操作
- 空闲区段管理使用简单链表，O(1) 分配/释放
