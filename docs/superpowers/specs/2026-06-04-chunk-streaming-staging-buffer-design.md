# Chunk 流式加载 Staging Buffer + 原子切换设计 (v3)

> 日期: 2026-06-04
> 修订: v3 — 修复 shadow region 竞态、staged 生命周期、Worker 裁剪兼容
> 状态: approved
> 目标: 消除奔跑过程中加载 chunk 的卡顿和画面闪烁

## 问题诊断

### 画面闪烁根因（完整）

闪烁有两个来源，都是架构上"可见状态中间态暴露"的问题：

**来源 A：`replaceChunkVisibleBlocks` 的"先删后补"语义**

`GlobalInstancedMeshManager.replaceChunkVisibleBlocks()` (L371) 的实现是：
1. `removeChunk(chunkKey)` — 同步删除该 chunk 的**所有**已渲染方块
2. `enqueueMeshDataForChunk()` — 将新数据入队 mutation queue
3. 后续帧通过 `flushMutationQueue` 分帧写入

步骤 1 和步骤 3 之间存在**多帧可见空窗**：方块已被删除但新数据尚未写入。

**来源 B：`TypeBuffer.ensureCapacity` 的 mesh 替换**

扩容时创建新 InstancedMesh 替换旧的：
1. 旧 mesh 立即设 `visible = false`
2. 新 mesh 加入 scene，数据完整复制
3. 但 WebGPU buffer upload 可能不在同一渲染帧完成

**核心问题**：当前架构没有"chunk 级可见状态原子切换"的概念。方块逐个写入、逐个可见，任何中间状态都暴露给渲染帧。

### CPU 尖峰根因

1. **`assembleRuntimeBuildMeshFast()` 无预算同步构建**：遍历 3000+ blockData 条目、按类型分组、计算可见性和 AO、生成 meshData —— 全部同步完成，单次 5-15ms
2. **Worker 回包结构化克隆**：`postMessage` 没有 transfer list，Float32Array（matrices 每 chunk ~192KB）在主线程反序列化时阻塞
3. **各子系统预算独立无协调**：assembly 8ms + flush 3ms + delta 1.5ms + idle 2ms，总和 14.5ms 超出 10ms/帧目标
4. **缺失实时剩余时间检查**：即使有预算分配，拓扑遍历、卸载、shadow request、粒子等无预算操作仍然在同帧执行

## 性能目标

- 高刷 macOS (ProMotion): 稳定 100fps（帧预算 10ms）
- 标准显示器: 不低于 60fps（帧预算 16.7ms）
- 奔跑加载远方 chunk 时零卡顿、零闪烁
- 新 chunk 平滑过渡出现（雾遮掩，不使用真透明）

## 架构设计

### Chunk 生命周期（新）

```
创建 → 数据加载 → hydrate → 可中断 buildMesh(分帧，接受外部预算) → 写入 Staging Buffer(不渲染)
                                                                          ↓
                     全量就绪 → reserve 空间 → 分帧 prepare(写入 reserved region) → 一帧 publish(flip count)
                                                                                      ↓
                                                                                雾内自然渐显
```

### 核心概念 1: 两阶段原子提交（带 Reservation）

**关键不变式**：prepare 写入的区域通过 reservation 机制与活跃渲染区域隔离，任何并发的 add/remove/patch 操作不会覆盖 reserved region。

**TypeBuffer 内存布局**：
```
┌──────────────────────────────────────────────────────────────────────┐
│  [0 ─── count ───][count ─── reservedTail ───][─── capacity ───]    │
│   ↑ 活跃渲染区域   ↑ reserved region(各 chunk 分段占用)   ↑ 空闲     │
│                                                                      │
│  活跃区操作 (add/remove/patch):                                      │
│    - add 写入 index=count, count++                                   │
│    - remove 用 swap-remove，只操作 [0, count) 范围                   │
│    - 不会触及 [count, reservedTail) 的 reserved region               │
│                                                                      │
│  Prepare 操作:                                                       │
│    - 写入 [reservedStart, reservedStart + reservedCount) 固定位置    │
│    - reservedStart 在 init 时锁定，不受后续 count 变化影响           │
│                                                                      │
│  Publish 操作:                                                       │
│    - 将 reserved chunk 的方块"嫁接"到活跃区                         │
│    - 方法：把 reserved 数据搬移到 count 位置（如果 count 变化了）    │
│    - 然后 count += reservedCount                                     │
│    - 释放 reservation                                                │
└──────────────────────────────────────────────────────────────────────┘
```

**Reservation 生命周期**：
1. `reserveForChunk(chunkKey, typeBlockCounts)` — 为每个 type 在 TypeBuffer 末尾分配固定段
2. 返回 `{ type → { start, count } }` 映射，在整个 prepare 期间不变
3. prepare 写入只能写 `[start, start + count)` 范围
4. publish 时如果 buffer.count 已变化（有 add/remove），先将 reserved 数据搬到新的 count 位置再 bump
5. 释放 reservation：`reservedTail -= reservedCount`

**竞态安全**：
- 活跃区的 add 操作：写入 index=count，但 count < reservedStart，不会碰到 reserved 区域
  - 等等，这不对。如果 add 操作把 count 推到了 reservedStart 怎么办？
  - 解决：`addVisibleBlock` 中的 `ensureCapacity(count + 1)` 改为 `ensureCapacity(reservedTail + 1)`
  - 且 add 时 count++ 不能超过最低的 reservedStart
  - 实际上更简单的方案：add 操作在 count++ 后如果 count == 某个 reservation 的 start，触发冲突处理（搬移 reservation）
  - **最终方案**：`reservedTail` 是全 buffer 的硬边界，`addVisibleBlock` 在 count 达到 reservedTail 时触发扩容（而非达到 capacity），这样 count 永远不会侵入 reserved region

```
ensureCapacity 改造：
  - 旧: if (required <= this.capacity) return;
  - 新: if (required <= this.capacity && required <= this.reservedTail) return;
  - reservedTail 默认等于 capacity（无 reservation 时不影响行为）
```

- 活跃区的 remove 操作：swap-remove 只操作 [0, count) 范围，不影响 reserved region
- 活跃区的 patch 操作：只更新已有实例的 matrix/AO，不改变 count

### 核心概念 2: Staged Chunk 生命周期与清理

Staged chunk 必须与现有 chunk 生命周期正确联动：

**清理触发点**：
1. `GlobalInstancedMeshManager.removeChunk(chunkKey)` — 先清理 staged/reservation
2. `World.update()` 卸载循环 — chunk dispose 前清理 staging
3. `chunk.dispose()` — 如果 chunk 被废弃，对应 staging 必须清除
4. 玩家瞬移导致大量 chunk 同时卸载 — 批量释放 reservation

**不变式**：
- staging zone 中的 chunkKey 必须对应一个活跃的（未 dispose 的）chunk
- reservation 释放后 reservedTail 回退，释放空间给后续使用
- 多个 staged chunk 的 reservation 不重叠（每个 type 依次分配）

### 核心概念 3: 实时帧预算 Scheduler

```javascript
class FrameBudgetScheduler {
  beginFrame() { this.frameStart = performance.now(); }
  getRemainingMs() { return max(0, frameStart + targetFrameMs - safetyMargin - now()); }
  hasTimeFor(ms) { return getRemainingMs() >= ms; }
}
```

每个阶段在执行前检查剩余时间，不够则跳过。总和自动不超标。

### 核心概念 4: 可中断 buildMesh 接受外部预算

`assembleRuntimeBuildMeshPhase(maxMs)` 参数从 scheduler 剩余时间传入，不再硬编码 3ms。ChunkAssemblyScheduler 在调用 chunk 方法时传递当前帧剩余预算。

### 核心概念 5: Worker Transfer 优化

Worker 回包的 meshData 中 Float32Array 使用 Transferable 零拷贝传输：

```javascript
// Worker 侧 — postMessage 第二参数传递 transfer list
const transferList = [];
for (const group of meshData) {
  if (group.matrices?.buffer) transferList.push(group.matrices.buffer);
  if (group.aoLow?.buffer) transferList.push(group.aoLow.buffer);
  if (group.aoHigh?.buffer) transferList.push(group.aoHigh.buffer);
  if (group.orientation?.buffer) transferList.push(group.orientation.buffer);
}
postMessage(payload, transferList);
```

**不裁剪的字段**（有活跃消费方）：
- `snapshot.blocks` — ChunkGenerator.js:79, PersistenceService.js:236/249/266
- `routing` — BlockScatterManager.js:84/175 (scatter 和 overflow 依赖)
- 顶层 `modGunMan`/`rovers` — Chunk.js 解构使用

**仅做 transfer**，不做结构裁剪，避免破坏现有功能。

### 核心概念 6: 雾遮掩代替真透明

新 chunk publish 后通过距离雾自然过渡：
- chunk 在 fog far 附近出现时，雾本身遮住方块
- 随玩家靠近，方块从雾中"走出来"
- 无需 `material.transparent`、无排序/depthWrite/shadow 问题
- 对于身边突然加载的 chunk：publish 受帧预算控制（每帧最多 1 个），加上 prepare 分帧的自然延迟，极端情况也有数帧缓冲

## 文件变更清单

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `src/world/Chunk.js` | 修改 | 废除 fast path；`assembleRuntimeBuildMeshPhase` 接受外部 maxMs |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 合并 fast stage；传递剩余预算给 chunk |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | staging zone、reservation、prepare、publish、生命周期清理 |
| `src/workers/WorldWorker.js` | 修改 | postMessage 添加 transfer list |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 初次加载改为 staging |
| `src/world/World.js` | 修改 | 集成 FrameBudgetScheduler，重构 update() |
| `src/core/FrameBudgetScheduler.js` | 新增 | 实时帧预算调度器 |

## 验收标准

1. 玩家持续奔跑 30 秒，frameMs p99 ≤ 目标帧时的 120%（100fps 下 p99 ≤ 12ms）
2. 奔跑过程中无任何方块闪烁/消失/重现现象
3. 新 chunk 从雾中自然出现，无突兀跳变
4. 现有交互功能（放置/挖掘方块、consolidation、特殊实体、scatter routing）不受影响
5. Worker 回包传输使用 Transferable，主线程 onmessage 无大体积克隆
6. 单帧内不存在 > 4ms 的同步 chunk 构建操作
7. chunk 卸载时 staging/reservation 正确清理，无幽灵方块
8. 自动化压测可重复验证帧率和闪烁
