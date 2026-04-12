# Data Model: 跨 Chunk 材质合批

**Date**: 2026-04-12
**Branch**: `001-cross-chunk-batching`

## Entities

### 1. ChunkBatchManager

全局合批协调器，由 `World` 持有。

| 字段 | 类型 | 说明 |
|------|------|------|
| textureGroups | `Map<string, TextureBatchGroup>` | 按纹理 URL 索引的合批组 |
| chunkRegistry | `Map<string, ChunkBatchEntry>` | 按 chunkKey 注册的区块条目 |
| scene | `THREE.Scene` | 渲染场景引用 |
| materials | `MaterialManager` | 材质管理器引用 |
| enabled | `boolean` | 合批开关（用于调试对比） |

**生命周期**: 随 `World` 创建和销毁。

### 2. TextureBatchGroup

每个纹理 URL 对应一个合批组，持有一个共享的 `InstancedMesh`。

| 字段 | 类型 | 说明 |
|------|------|------|
| textureUrl | `string` | 纹理标识 |
| material | `THREE.Material` | 共享材质（通过 getBatchedMaterial 获取） |
| geometry | `THREE.BoxGeometry` | 共享几何体 |
| instancedMesh | `THREE.InstancedMesh` | 跨 Chunk 合批的 InstancedMesh |
| capacity | `number` | 当前 InstancedMesh 容量 |
| usedCount | `number` | 已使用实例数 |
| chunkSlots | `Map<string, Slot>` | 各 Chunk 在此组中的区段 |
| freeSlots | `Slot[]` | 空闲区段链表 |

### 3. Slot（区段）

一个 Chunk 在某个 TextureBatchGroup 中占用的连续实例区间。

| 字段 | 类型 | 说明 |
|------|------|------|
| start | `number` | 起始实例索引 |
| count | `number` | 实例数量 |
| chunkKey | `string` | 所属 Chunk 键 |

### 4. ChunkBatchEntry

一个 Chunk 在合批系统中的注册信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| chunkKey | `string` | Chunk 键 `${cx},${cz}` |
| slots | `Map<string, Slot>` | 各纹理组中的区段引用 |
| instanceData | `Map<string, Float32Array>` | 各纹理组的原始矩阵数据 |
| dirty | `boolean` | 是否有待更新的数据 |

## Relationships

```
World (1) ──holds──► ChunkBatchManager (1)
ChunkBatchManager (1) ──manages──► TextureBatchGroup (N)
TextureBatchGroup (1) ──contains──► Slot (N)
ChunkBatchEntry (1) ──references──► Slot (N, per texture group)
Chunk (1) ──registers as──► ChunkBatchEntry (1)
```

## State Transitions

### ChunkBatchEntry 状态

```
[不存在] ──registerChunk()──► [已注册]
[已注册] ──updateChunk()───► [已更新] (dirty = false)
[已注册] ──markDirty()─────► [脏] (dirty = true)
[脏] ────updateChunk()─────► [已更新]
[已注册] ──unregisterChunk()──► [不存在] (资源释放)
```

### TextureBatchGroup 容量管理

```
[空] ──首 Chunk 注册──► [初始化] (预分配容量)
[正常] ──容量不足────► [扩容] (×2 倍增, 最大 65536)
[正常] ──Chunk 注销──► [收缩空闲] (更新 freeSlots)
```

## Validation Rules

- 同一个 Chunk 不能重复注册（幂等性）
- Slot 的 start + count 不能超过 InstancedMesh 容量
- 注销 Chunk 时必须释放所有 Slot 并归还到 freeSlots
- 容量扩容时所有已注册 Chunk 的矩阵数据必须完整复制
