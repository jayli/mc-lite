# Research: Chunk Optimization (Background Consolidation)

## Decisions

### 1. Consolidation Trigger Mechanism
- **Decision**: 使用双重触发机制：
    1. **Debounce Timer**: 玩家最后一次交互后 1 秒触发。
    2. **Dirty Threshold**: 如果未优化的 Mesh 超过 50 个，立即触发（即便仍在建造中，防止过度堆积）。
- **Rationale**: 既能平衡即时响应，又能防止内存/渲染压力在疯狂建造时失控。

### 2. Mesh Swap Implementation
- **Decision**: 在收到 Worker 数据后，先更新 `InstancedMesh` 的数据，然后在下一帧（或同一个同步周期内）移除所有属于该区块的单体 Mesh。
- **Rationale**: 避免在数据未准备好时出现方块“消失”的瞬间（Flicker）。

### 3. Worker Data Exchange
- **Decision**: 继续使用现有的 `postMessage` 机制，将当前的 `this.blockData` 映射作为 `snapshot` 发送给 Worker。
- **Rationale**: `WorldWorker.js` 已经具备处理全量 Snapshot 的能力，逻辑复用成本最低，且能够自动获得 AO 和 Face Culling 的最新计算结果。

### 4. Instance Management
- **Decision**: 在合并时，重构区块内的 `instanceIndexMap`。
- **Rationale**: 静态 `InstancedMesh` 一旦通过 `consolidate` 重新生成，其内部索引会发生变化，必须清空旧的映射并根据新数据重建，以保证后续挖掘/放置的索引准确性。

## Alternatives Considered

- **Real-time InstancedMesh Expansion**: 每次放置都扩容 `InstancedMesh`。
    - *Rejected*: Three.js `InstancedMesh` 不支持动态扩容，必须重新创建整个 Buffer，高频操作性能极差。
- **Chunk Geometry Merging**: 将整个区块合并为一个大的 `BufferGeometry`。
    - *Rejected*: 虽然 Draw Call 更低，但挖掘方块时需要局部更新几何体，算法复杂度远高于 `InstancedMesh`，且不利于现有的多材质/多方块类型架构。
