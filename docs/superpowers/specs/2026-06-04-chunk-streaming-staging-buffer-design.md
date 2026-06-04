# Chunk 流式加载 Staging Buffer + 原子切换设计

> 日期: 2026-06-04
> 状态: approved
> 目标: 消除奔跑过程中加载 chunk 的卡顿和画面闪烁

## 问题诊断

### 画面闪烁根因

`GlobalInstancedMeshManager.TypeBuffer.ensureCapacity()` 在渲染帧中被触发时，创建新 InstancedMesh 替换旧的，导致该类型所有方块瞬间消失一帧后恢复。新 chunk 方块涌入时，leaves/grass_block 等高频类型容量不足触发扩容，是闪烁的直接原因。

### CPU 尖峰根因

1. `assembleRuntimeBuildMeshFast()` 同步一次性完成整个 chunk 的 mesh 构建，无时间预算限制
2. IndexedDB 异步返回后多个 chunk 可能在同一帧内进入 assembly 队列
3. 各子系统预算独立硬编码（assembly 8ms + flush 3ms + delta 1.5ms + idle 2ms），无全局协调
4. 在 100fps 目标下（10ms/帧），当前预算总和可能超出帧时间

## 性能目标

- 高刷 macOS (ProMotion): 稳定 100fps（帧预算 10ms）
- 标准显示器: 不低于 60fps（帧预算 16.7ms）
- 奔跑加载远方 chunk 时零卡顿、零闪烁
- 新 chunk 以渐进淡入方式出现

## 架构设计

### Chunk 生命周期（新）

```
创建 → 数据加载 → hydrate → buildMesh → 写入 Staging Buffer(不渲染)
                                              ↓
                                    全量就绪 → 预扩容检查 → 原子提交 → 淡入动画
```

### 核心概念: Staging Buffer

在 mesh 构建完成和实际渲染之间引入中间层 `ChunkStagingBuffer`：

```
┌─────────────────────────────────────────────────────┐
│  GlobalInstancedMeshManager                         │
│                                                     │
│  ┌──────────────┐    ┌─────────────┐    ┌────────┐ │
│  │ Staging Zone │ →  │  Pre-expand │ →  │ Commit │ │
│  │ (不渲染)     │    │  (扩容检测)  │    │ (渲染) │ │
│  └──────────────┘    └─────────────┘    └────────┘ │
└─────────────────────────────────────────────────────┘
```

- **Staging Zone**: chunk 的所有方块数据在此积累，不触发任何 GPU 操作
- **Pre-expand**: 提交前检查各 TypeBuffer 容量，不够则提前扩容（不影响已渲染内容）
- **Commit**: 一帧内原子性将所有方块写入 TypeBuffer，设置 needsUpdate，下次渲染生效

### 约束

- 每帧最多 commit 1 个 chunk（单 chunk ~2000-4000 方块写入约 1-2ms）
- commit 按距离玩家最近优先排序
- commit 是原子的：要么完整提交要么不提交，不存在"半成品"状态

## 模块设计

### 1. TypeBuffer 预扩容

解决闪烁的核心改造。将扩容从"渲染帧被动触发"改为"commit 前主动完成"。

```javascript
commitStagedChunk(chunkKey) {
  const staged = this.stagingZone.get(chunkKey);
  
  // 1. 计算每个 type 需要的额外容量
  const capacityNeeds = new Map();
  for (const block of staged.blocks) {
    const buffer = this.getOrCreateTypeBuffer(block.type);
    const required = buffer.count + (capacityNeeds.get(block.type) || 0) + 1;
    capacityNeeds.set(block.type, required - buffer.count);
  }
  
  // 2. 预扩容
  for (const [type, extraNeeded] of capacityNeeds) {
    const buffer = this.typeBuffers.get(type);
    buffer.ensureCapacity(buffer.count + extraNeeded);
  }
  
  // 3. 原子写入
  for (const block of staged.blocks) {
    this.addVisibleBlock(block.coord, block.entry, chunkKey, block.renderData, { commit: false });
  }
  
  // 4. 一次性 commit
  this.commitDirtyBuffers();
}
```

`ensureCapacity` 改造要点：
- 新旧 mesh 切换必须在同一帧渲染前完成（add new → remove old，不跨帧）
- 初始 typeCapacityHints 调大，减少运行时扩容：leaves 8192、grass_block 6144、dirt/stone 4096

### 2. 帧预算治理器 (FrameBudgetGovernor)

新增文件 `src/core/FrameBudgetGovernor.js`。取代各子系统分散的硬编码预算常量，提供全局协调。

```
┌────────────────────────────────────────────────────┐
│ 单帧预算分配 (目标 100fps = 10ms)                   │
├────────────────────────────────────────────────────┤
│ 渲染 (GPU submit + Three.js)            ~4ms 固定  │
│ 物理 + 玩家 + 敌人                       ~2ms 固定  │
│ ─── chunk 系统可用预算 ───               ~4ms 弹性  │
│   ├─ chunk init (数据请求)              0.5ms      │
│   ├─ assembly (hydrate + buildMesh)     1.5ms      │
│   ├─ staging commit (原子写入)           1.5ms      │
│   └─ deferred (finalize + idle)         0.5ms      │
└────────────────────────────────────────────────────┘
```

动态分配策略：
- 通过帧时长 EMA 检测压力（pressure = frameMsEma / targetFrameMs）
- pressure > 1.2: 严重掉帧，assembly 降到 0.5ms，暂停 init 和 deferred
- pressure > 1.0: 轻微压力，各项缩减
- pressure <= 1.0: 正常预算

chunk init 不再是"每 4 帧 1 个"的固定节奏，改为"有预算就处理，无预算就等"。

### 3. 淡入动画 (ChunkFadeController)

新增文件 `src/core/ChunkFadeController.js`。

技术路径：TypeBuffer 的 InstancedMesh geometry 新增 per-instance `aOpacity` 属性（Float32, 默认 1.0）。

shader 侧：在 MaterialManager 的各材质 fragment 中，将 `aOpacity` 乘入最终 alpha。

动画驱动：
- commit 后调用 `startFadeIn(chunkKey, duration=400)`
- 每帧更新：遍历该 chunk 的坐标集，用 smoothstep 插值更新 opacity
- 开销约 0.1-0.2ms/帧（1-2 个淡入中 chunk × ~3000 方块 = ~6000 Float32 写入）
- 完成后清除动画状态，零额外开销

视觉效果：配合现有 fog 系统，远处 chunk 在雾中自然淡入。近距离 chunk 缩短 duration 到 200ms。

### 4. World.update() 重构

```javascript
update(playerPos, dt) {
  // 1. 帧预算分配
  const budget = this.frameBudgetGovernor.allocate(dt * 1000);
  
  // 2. 拓扑更新（加载/卸载 chunk 对象）
  this._updateChunkTopology(playerPos);
  
  // 3. Chunk 初始化（发起数据请求）
  this._processChunkInitQueue(budget.initMs);
  
  // 4. Assembly（hydrate + buildMesh → 写入 staging）
  this.chunkAssemblyScheduler.processWithinBudget({ budgetMs: budget.assemblyMs });
  
  // 5. Staging commit（原子写入 + 启动淡入）
  this._commitStagedChunks(budget.commitMs);
  
  // 6. 淡入动画更新
  this.chunkFadeController.update();
  
  // 7. 低优先级工作
  this._processDeferredWork(budget.deferredMs);
  
  // 8. 粒子/特效
  this.particles.update(dt);
}
```

### 5. Consolidation 路径适配

Consolidation 是更新已有 chunk，不走 staging：
- 继续使用 `patchChunkVisibleBlocks`（增量 diff，不删除全量）
- patch 前添加预扩容检查，确保容量足够
- 不触发淡入动画（chunk 已在渲染中）

### 6. Mutation Queue 定位变更

staging commit 取代了 mutation queue 在"新 chunk 首次加载"中的角色：
- 新 chunk 首次加载：buildMesh → staging → 原子 commit（新路径）
- 单方块增删（玩家交互）：applyChunkDelta（保持不变）
- Consolidation 更新：patchChunkVisibleBlocks（保持不变）

## 文件变更清单

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `src/core/GlobalInstancedMeshManager.js` | 修改 | 新增 staging zone、预扩容、原子 commit、setChunkOpacity |
| `src/world/World.js` | 修改 | 引入 FrameBudgetGovernor，重构 update() 调度 |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 终点从 enqueue mutation 改为写入 staging |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 改为写入 staging |
| `src/core/MaterialManager.js` | 修改 | 各材质支持 aOpacity per-instance 属性 |
| `src/core/FrameBudgetGovernor.js` | 新增 | 帧预算分配器 |
| `src/core/ChunkFadeController.js` | 新增 | 淡入动画控制器 |

## 验收标准

1. 玩家持续奔跑 30 秒，帧率始终 ≥ 目标帧率的 90%（100fps 目标下 ≥ 90fps）
2. 奔跑过程中无任何方块闪烁/消失/重现现象
3. 新 chunk 以淡入方式自然出现，无突兀跳变
4. 现有交互功能（放置/挖掘方块、consolidation）不受影响
5. 内存峰值增长不超过 15%（staging buffer 的额外占用）
