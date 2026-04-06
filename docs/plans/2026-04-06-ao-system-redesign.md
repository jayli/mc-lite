# AO 系统重构设计文档

日期：2026-04-06

## 1. 背景与动机

当前 AO（环境光遮蔽）阴影系统存在以下性能问题：

1. `rebuildInstancedAOFromWorld()` 每次刷新遍历整个 Chunk 的所有 InstancedMesh 实例
2. `_processPendingAORefreshQueue` 每帧预算仅 0.5ms，最多刷 1 个 Chunk
3. 跨 Chunk 的 `createOcclusionChecker` 在主线程同步执行
4. `AOSystem` 类和 `aoWorker` 使用不充分，很多 AO 计算仍在主线程

经过多次 chunk 加载性能优化后，AO 阴影绘制已成为主要性能瓶颈，且与当前架构不匹配。

## 2. 设计目标

1. **性能优先**：所有 AO 计算在专用 Worker 中完成，不阻塞主线程
2. **最小范围**：只计算受影响方块的 AO（脏集），不遍历整个 Chunk
3. **时序清晰**：补面 → face culling → consolidation → AO 刷新（最后执行）
4. **防闪烁**：AO 值直接覆写，无删除-重建中间态
5. **功能完整**：覆盖放置、删除、Mag7、TNT、机枪、Chunk 加载、跨 Chunk 等所有场景
6. **历史 Bug 免疫**：设计层面规避已知的 Mag7 跟不上、跨 chunk 双重绘制、方向影响 AO 等问题

## 3. 架构设计：Chunk 级脏集 + 专用 AO Worker

### 3.1 核心时序

```
方块操作 (place/remove/batch)
    ↓ [即时]
补面/动态网格创建 (neutral AO = 3，无阴影)
    ↓ [debounce: CONSOLIDATION_DELAY 或达到 DIRTY_THRESHOLD]
Consolidation → WorldWorker 重建 InstancedMesh
    ↓ [debounce: 100ms 后]
_executeAORefresh → 发送脏集 + blockData + 邻居快照给 AOWorker
    ↓ [Worker 异步返回]
_applyAOResults → 直接覆写 InstancedMesh attribute（无闪烁）
```

### 3.2 组件职责

| 组件 | 职责 |
|------|------|
| AOWorker | 接收脏位置 + blockData 快照，计算 AO 值，返回结果 |
| Chunk.dirtyAOPositions | 维护需要重新计算 AO 的方块坐标集合 |
| Chunk._markDirtyAO | 方块操作时标记受影响的邻居（6 正交方向） |
| Chunk._scheduleAORefresh | 防抖调度 AO 刷新（100ms 后执行） |
| Chunk._executeAORefresh | 收集数据发送给 Worker |
| Chunk._applyAOResults | Worker 返回后直接覆写 InstancedMesh attribute |

### 3.3 AOWorker 协议

**输入**：
```javascript
{
  requestId: string,
  chunkKey: string,
  positions: [{x, y, z}],
  blockData: Object,
  neighborChunks: [{ blockData: Object, cx: number, cz: number }]
}
```

**输出**：
```javascript
{
  requestId: string,
  chunkKey: string,
  results: [{x, y, z, aoLow, aoHigh}]
}
```

**Worker 内部逻辑**：
1. 合并 blockData + neighborChunks 为统一查找表
2. 创建 `isOccluding` 函数（复用 AOUtils 逻辑）
3. 对每个 position：检查 `isAOApplicable` → `calculateAOForBlock` → 返回 aoLow/aoHigh
4. 跳过空气、透明、非实心方块

## 4. 脏集管理策略

### 4.1 标记规则

- **删除方块**：标记 6 个正交邻居（不含自身，因为已删除）
- **放置方块**：标记 6 个正交邻居 + 自身
- **只标记实心不透明方块**：`isAOApplicable(type)` 为 true 的方块才入脏集
- **整数坐标**：所有坐标使用 `Math.floor()` 保证一致性

### 4.2 跨 Chunk 标记

当脏标记的坐标落在邻居 Chunk 范围内时：
1. 查找邻居 Chunk
2. 如果邻居 Chunk 已 ready，直接标记其 `dirtyAOPositions`
3. 如果未 ready，跳过（后续加载时会自然计算）

### 4.3 防抖机制

- 每次 `_markDirtyAO` 后调用 `_scheduleAORefresh()`
- 定时器 100ms（比 consolidation 晚 100ms，确保数据同步完成）
- 连续操作时定时器被重置，只有最后一次操作后 100ms 才真正执行
- 如果执行时 Chunk 正在 consolidating，重新调度

## 5. 结果应用

### 5.1 直接覆写（防闪烁）

```javascript
_applyAOResults(results) {
  // 按方块类型分组
  // 查找 instanceIndexMap 获取实例索引
  // 直接覆写 aoLowAttr.array[idx] 和 aoHighAttr.array[idx]
  // 标记 needsUpdate
}
```

### 5.2 防重叠绘制

- 每个 (x,y,z) 坐标只属于一个 chunk 的 `instanceIndexMap`
- Worker 结果只更新当前 chunk 的 InstancedMesh
- 现有所有权机制保证不会双重渲染

## 6. 场景覆盖

| 场景 | AO 处理 |
|------|---------|
| 玩家放置方块 | neutral AO → consolidation → _scheduleAORefresh |
| 玩家删除方块 | 补面 neutral AO → consolidation → _scheduleAORefresh |
| Mag7 快速删除 | removeBlocksBatch 中 _markDirtyAO + 防抖，最后一次操作后统一刷新 |
| TNT 爆炸 | 同 Mag7，批量标记脏位，防抖统一刷新 |
| 机枪快速删除 | 每次 removeBlock 都 _markDirtyAO + _scheduleAORefresh，防抖保证只刷新一次 |
| Chunk 加载 | WorldWorker 生成时已计算 AO；跨 chunk 边界等邻居 ready 后补刷 |
| 跨 chunk 方块 | _markDirtyAO 标记邻居 chunk 的脏集；Worker 请求包含邻居 blockData 快照 |

## 7. 历史 Bug 防护

| Bug | 防护措施 |
|-----|---------|
| Mag7 快速删除 AO 跟不上 (03bd015) | 防抖定时器，连续操作只最后一次刷新 |
| 跨 chunk 双重 AO (74c1052) | 现有所有权机制不变，每个坐标只属于一个 chunk |
| 方向影响 AO (f48ceed, 2a6de61) | shader aOrientation 重映射逻辑不变 |
| 及时补面 | _revealNeighbors + _refreshBlockRenderLightweight 不变 |
| 删除后面板黑色 | 动态网格 neutral AO (值=3) 保证 |
| 跨 chunk 方块丢失 | Worker 请求包含邻居 blockData 快照 |
| 实体被 Chunk 切割 | 现有所有权机制不变 |

## 8. 代码变更清单

### 新增文件
- `src/workers/AOWorker.js` — 专用 AO Worker

### 修改文件
- `src/world/Chunk.js` — 新增脏集管理、AO 调度、结果应用
- `src/world/ChunkConsolidation.js` — 创建 AOWorker 实例，调整合并回调
- `src/world/World.js` — 移除旧 AO 队列系统

### 可删除/简化
- `src/core/AOSystem.js` — 可完全删除
- `src/workers/FaceCullingWorker.js` — 移除 AO 相关消息处理
- `src/utils/AOUtils.js` — 保留核心计算，移除 `createOcclusionChecker`（移到 AOWorker）

### 不变
- Shader 代码 — aAoLow/aAoHigh 解包方式不变
- ChunkRenderUtils.js — 构建网格时的 AO 属性设置不变
- BlockData.js — 方块属性定义不变
