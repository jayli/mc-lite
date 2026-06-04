# Chunk 流式加载 Staging Buffer + 原子切换设计 (v4)

> 日期: 2026-06-04
> 修订: v4 — 放弃 shared buffer reservation，改为独立 staging arrays
> 状态: approved
> 目标: 消除奔跑过程中加载 chunk 的卡顿和画面闪烁

## 问题诊断

### 画面闪烁根因

闪烁来源于架构上"可见状态中间态暴露"：

**来源 A：`replaceChunkVisibleBlocks` 的"先删后补"**
`removeChunk()` 同步删除所有已渲染方块 → `enqueueMeshDataForChunk()` 入队 → 后续帧分帧写入。步骤 1 到步骤 3 之间存在多帧可见空窗。

**来源 B：`TypeBuffer.ensureCapacity` 的 mesh 替换**
扩容时旧 mesh 立即 `visible=false`，新 mesh 加入 scene，WebGPU buffer upload 可能延迟。

**核心问题**：当前架构没有"chunk 级可见状态原子切换"。

### CPU 尖峰根因

1. `assembleRuntimeBuildMeshFast()` 无预算同步构建（5-15ms）
2. Worker 回包结构化克隆（Float32Array ~192KB/chunk）
3. 各子系统预算独立无全局协调
4. 缺失实时帧剩余时间检查

## 性能目标

- 高刷 macOS: 稳定 100fps（帧预算 10ms）
- 标准显示器: 不低于 60fps（帧预算 16.7ms）
- 奔跑时零卡顿、零闪烁
- 新 chunk 从雾中自然出现

## 架构设计

### Chunk 生命周期与状态机

```
创建 → 数据加载 → hydrate → 可中断 buildMesh(分帧) → meshData 就绪
                                                          ↓
                                              写入独立 Staging Arrays (不可见，chunk.renderState='staged')
                                                          ↓
                                              分帧 prepare：构建 compact write batch
                                                          ↓
                                              publish(一帧)：预扩容 + 写入 TypeBuffer + count bump
                                                          ↓
                                              chunk.renderState='published', isReady=true
                                                          ↓
                                              雾内自然渐显
```

**新增 `chunk.renderState` 字段**：
- `'none'` — 刚创建，未进入渲染管线
- `'staged'` — meshData 已就绪，在 staging arrays 中等待 publish
- `'published'` — 已提交到 TypeBuffer，渲染可见

**`isReady` 语义变更**：`isReady = true` 仅在 `renderState === 'published'` 之后设置。在 `buildMeshes` 完成但未 publish 时，`isReady` 保持 false。这确保 AO refresh、shadow update、交互逻辑不会误认为 chunk 已可见。

### 核心概念 1: 独立 Staging Arrays（不写 TypeBuffer）

**设计原则**：staging 数据与 TypeBuffer 完全隔离，无共享状态，无竞态。

```
┌───────────────────────────────┐     ┌──────────────────────────────┐
│  Staging Zone (per chunk)     │     │  TypeBuffer (活跃渲染)        │
│                               │     │                              │
│  chunkKey → {                 │     │  [0 ─── count ───]           │
│    blocks: [                  │     │   活跃区：add/remove/patch   │
│      { coord, type, matrix,  │     │   正常操作，不受 staging 影响 │
│        aoLow, aoHigh, ori }  │     │                              │
│    ],                         │     │                              │
│    prepareState: {            │     │                              │
│      compactBatch: Map<type,  │  →publish→  写入 [count, count+n)  │
│        { matrices, ao... }>  │     │          count += n            │
│    }                          │     │                              │
│  }                            │     │                              │
└───────────────────────────────┘     └──────────────────────────────┘
```

**关键保证**：
- staging 数据只是普通 JS 对象/TypedArray，不引用 TypeBuffer
- staging 中的坐标不注册到 `coordToRef`/`chunkToCoords`（publish 前不可被交互系统发现）
- `addVisibleBlock`/`removeVisibleBlock`/`updateAO` 等方法完全不知道 staging 的存在
- 活跃区的所有操作（add/remove/swap-remove/patch/consolidation）正常运行，不受影响

### 核心概念 2: Prepare 阶段（分帧，构建 compact batch）

Prepare 将原始 meshDataArray 转换为按 type 分组的连续 TypedArray batch：

```javascript
// prepare 输出：每个 type 一个 compact batch
compactBatch = Map<renderKey, {
  coords: number[],         // 坐标列表
  entries: object[],        // { type, orientation }
  matrices: Float32Array,   // 连续 16*n floats
  aoLow: Float32Array,
  aoHigh: Float32Array,
  orientation: Float32Array,
  count: number
}>
```

Prepare 可跨帧（受预算限制），因为它只操作 staging 自己的数据结构。

### 核心概念 3: Publish 阶段（一帧，原子可见）

Publish 在单帧内完成：
1. **预扩容**：对每个 type 的 buffer，`ensureCapacity(count + batch.count)`
2. **批量写入**：使用 `TypedArray.set()` 批量拷贝 matrices 到 TypeBuffer
3. **注册索引**：写入 coordToRef/chunkToCoords/coordToIndex/indexToCoord
4. **Bump count**：`buffer.count += batch.count; mesh.count = buffer.count`
5. **标记 needsUpdate**

**Publish 成本预估**：
- 预扩容：0ms（通常 capacity 足够）或 0.2ms（一次 mesh 替换）
- 批量写入：`Float32Array.set()` 对 3000 块 ≈ 0.15ms
- 索引注册：3000 × Map.set ≈ 0.3ms
- 总计：~0.5-0.8ms/chunk

**每帧最多 publish 1 个 chunk**，受 FrameBudgetScheduler 剩余时间控制。

### 核心概念 4: 实时帧预算 Scheduler

```javascript
scheduler.beginFrame();
// 每个阶段执行前检查 scheduler.getRemainingMs()
// 不够则跳过，总和自然不超标
```

### 核心概念 5: 可中断 buildMesh 接受外部预算

`assembleRuntimeBuildMeshPhase(maxMs)` 不再硬编码 3ms，从 scheduler 获取。

### 核心概念 6: Worker Transfer

meshData 中 Float32Array 使用 Transferable 零拷贝。保留所有现有字段不裁剪。

### 核心概念 7: 雾遮掩

远处 chunk publish 后被现有 fog 自然遮盖，无需材质修改。

## Staged Chunk 生命周期管理

**清理触发点**：
1. `GlobalInstancedMeshManager.removeChunk(chunkKey)` — 清理 staging（如果有）
2. `World.update()` 卸载循环 — chunk dispose 前调用 `removeStagedChunk`
3. chunk dispose — 对应 staging 必须已清除

**不变式**：
- staging zone 中的 chunkKey 必须对应活跃（未 dispose）的 chunk
- staging 中的坐标不在 `coordToRef` 中（publish 前不可被发现）
- `removeStagedChunk` 只需 `stagingZone.delete(chunkKey)`（因为没有注册任何全局索引）

## 文件变更清单

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `src/world/Chunk.js` | 修改 | 废除 fast path；接受外部 maxMs；新增 renderState |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 合并 fast stage；传递剩余预算 |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | staging zone（独立 arrays）、prepare、publish |
| `src/workers/WorldWorker.js` | 修改 | postMessage 添加 transfer list |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 初次加载写入 staging |
| `src/world/World.js` | 修改 | 集成 scheduler + publish 调度 + 生命周期清理 + isReady 对齐 |
| `src/core/FrameBudgetScheduler.js` | 新增 | 实时帧预算调度器 |

## 验收标准

1. 奔跑 30 秒，frameMs p99 ≤ 12ms（100fps 目标）
2. 零方块闪烁/消失/重现
3. 新 chunk 从雾中自然出现
4. 放置/挖掘/consolidation/scatter/特殊实体 不受影响
5. Worker 回包使用 Transferable
6. 单帧无 > 4ms 的同步 chunk 构建
7. chunk 卸载时 staging 正确清理，无幽灵方块
8. staging 中的坐标在 publish 前不可被 raycast/交互系统发现
