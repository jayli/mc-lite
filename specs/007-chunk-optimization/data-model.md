# Data Model: Chunk Optimization (Background Consolidation)

## Entities

### 1. Chunk (Extended State)
负责管理区块的优化生命周期。

| Field | Type | Description |
|-------|------|-------------|
| `dirtyBlocks` | Integer | 计数器，记录当前区块内单体 Mesh (非优化的) 的数量。 |
| `consolidationTimer` | TimerID | 防抖定时器引用。 |
| `isConsolidating` | Boolean | 标记位，防止重复发送相同的优化请求。 |
| `blockData` | Object | **(核心数据)** `x,y,z -> type` 的映射，作为全量数据的 Single Source of Truth。 |
| `dynamicMeshes` | Map | `x,y,z -> Mesh` 的映射，用于在合并时精准销毁单体 Mesh。 |

### 2. Consolidation Request (Message Payload)
主线程发送给 Worker 的优化请求。

| Field | Type | Description |
|-------|------|-------------|
| `cx`, `cz` | Integer | 区块坐标。 |
| `snapshot` | Object | 包含 `blocks` 和 `entities` 的全量数据快照。 |
| `isOptimization` | Boolean | 标记位，告知 Worker 这是一个合并优化请求，而非首次生成。 |

### 3. Consolidation Result (Message Response)
Worker 返回给主线程的优化结果。

| Field | Type | Description |
|-------|------|-------------|
| `d` | Object | 按类型分类的方块位置、AO 数据。 |
| `visibleKeys` | Array | 经过 Face Culling 计算后，需要实际渲染的方块 Key 列表。 |
| `allBlockTypes` | Object | 完整的方块类型映射（用于更新主线程状态）。 |

## State Transitions

1. **IDLE**: 区块完全优化状态。
2. **DIRTY**: 玩家操作（放置/挖掘），`dirtyBlocks++`，启动/重置 `consolidationTimer`。
3. **OPTIMIZING**: 定时器到期或阈值达到，发送请求给 Worker，`isConsolidating = true`。
4. **REBUILDING**: 收到 Worker 响应，销毁旧 Mesh，应用新 `InstancedMesh` 数据。
5. **IDLE**: 重置 `dirtyBlocks = 0`，`isConsolidating = false`。
