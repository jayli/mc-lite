# Chunk 流式加载 Staging Buffer + 原子切换设计 (v4.1)

> 日期: 2026-06-04
> 修订: v4.1 — 修复 finalize 状态机、compact batch、接口一致性
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
                                              写入独立 Staging Arrays (chunk.renderState='staged')
                                                          ↓
                                              runtime-finalize（实体恢复，不涉及渲染）
                                                          ↓
                                              *** 链路中断：不 enqueue finalize/non-deferred-finalize ***
                                                          ↓
                                              分帧 prepare：构建 compact Float32Array batch
                                                          ↓
                                              publish(一帧)：预扩容 + Float32Array.set + 注册索引 + count bump
                                                          ↓
                                              chunk.renderState='published'
                                                          ↓
                                              执行 finalizeNonDeferredPhase → isReady=true, loadState='finalized'
                                                          ↓
                                              雾内自然渐显
```

**新增 `chunk.renderState` 字段**：
- `'none'` — 刚创建，未进入渲染管线
- `'staged'` — meshData 已就绪，在 staging arrays 中等待 publish
- `'published'` — 已提交到 TypeBuffer，渲染可见

**`isReady` / finalize 状态机闭环**：
- `assembleRuntimeFinalizePhase()`（实体恢复）完成后，如果 `renderState === 'staged'`，**不 enqueue `finalize`/`non-deferred-finalize`**
- `isReady = true` 和 `loadState = 'finalized'` 仅在 publish 后执行
- World 在 `_publishNextReadyChunk` 成功后调用 `chunk.finalizeNonDeferredPhase()`
- 这确保 AO refresh、shadow update、交互逻辑不会误认为 chunk 已可见

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

### 核心概念 2: Prepare 阶段（分帧，构建 compact Float32Array）

Prepare 将原始 meshDataArray 转换为按 type 分组的**连续 Float32Array**：

```javascript
// prepare 输出：每个 type 一个 compact batch（真正的连续 TypedArray）
compactBatch = Map<renderKey, {
  coords: number[],           // 坐标列表
  type: string,               // 方块类型
  matrices: Float32Array,     // 预分配连续 Float32Array(count * 16)
  aoLow: Float32Array,        // 预分配连续 Float32Array(count)
  aoHigh: Float32Array,
  orientation: Float32Array,
  count: number,              // 方块数
  cursor: number              // 分帧填充进度
}>
```

**工作方式**：
1. 首次访问某 chunk 的 prepare：预分配目标大小的连续 Float32Array
2. 分帧填充：每帧在预算内向 Float32Array 中逐块写入数据，推进 cursor
3. cursor === count 时标记该 batch 完成
4. publish 时直接 `buffer.instanceMatrix.array.set(batch.matrices, baseIndex * 16)`（单次连续拷贝）

Prepare 可跨帧（受预算限制），因为它只操作 staging 自己的数据结构。

### 核心概念 3: Publish 阶段（一帧，原子可见）

Publish 在单帧内完成：
1. **预扩容**：对每个 type 的 buffer，`ensureCapacity(count + batch.count)`
2. **批量写入**：`buffer.instanceMatrix.array.set(batch.matrices, baseIndex * 16)` — 单次连续拷贝
3. **AO/orientation**：同样 `Float32Array.set(batch.aoLow, baseIndex)` 连续拷贝
4. **注册索引**：逐坐标 `coordToRef.set`、`coordToIndex.set`、`chunkToCoords.add`
5. **Bump count**：`buffer.count += batch.count; mesh.count = buffer.count`
6. **标记 needsUpdate**
7. **执行 finalizeNonDeferredPhase**：设置 isReady=true、loadState='finalized'

**Publish 成本预估**：
- 预扩容：0ms（通常 capacity 足够，因 hints 已调大）
- 批量写入：`Float32Array.set()` 连续拷贝 3000*16 floats ≈ 0.05ms
- AO/orientation set：3 × `Float32Array.set()` ≈ 0.02ms
- 索引注册：3000 × Map.set ≈ 0.3ms
- finalizeNonDeferredPhase：~0.1ms
- 总计：~0.5ms/chunk

**每帧最多 publish 1 个 chunk**，受 `FrameBudgetScheduler.hasTimeFor(0.8)` 控制。

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
