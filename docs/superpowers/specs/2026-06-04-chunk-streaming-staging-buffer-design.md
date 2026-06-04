# Chunk 流式加载 Staging Buffer + 原子切换设计 (v2)

> 日期: 2026-06-04
> 修订: 2026-06-04 v2 — 根据审阅反馈全面修订
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

步骤 1 和步骤 3 之间存在**多帧可见空窗**：方块已被删除但新数据尚未写入。当新 chunk 的方块大量涌入 mutation queue 时，leaves/grass_block 类型的 TypeBuffer 在 `addVisibleBlock` → `ensureCapacity` 时触发扩容，旧 mesh 被标记 `visible=false`、新 mesh 加入场景，如果 WebGPU buffer upload 存在延迟，该类型所有方块瞬间消失。

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
4. **governor 缺失实时剩余时间检查**：即使有预算分配，拓扑遍历、卸载、shadow、粒子等无预算操作仍然在同帧执行

## 性能目标

- 高刷 macOS (ProMotion): 稳定 100fps（帧预算 10ms）
- 标准显示器: 不低于 60fps（帧预算 16.7ms）
- 奔跑加载远方 chunk 时零卡顿、零闪烁
- 新 chunk 平滑过渡出现（雾遮掩/dither，不使用真透明）

## 架构设计

### Chunk 生命周期（新）

```
创建 → 数据加载 → hydrate → 可中断 buildMesh(分帧) → 写入 Staging Buffer(不渲染)
                                                           ↓
                               全量就绪 → 分帧 prepare(写入 shadow region) → 一帧 publish(flip visibility)
                                                                                ↓
                                                                         雾内淡入(距离渐显)
```

### 核心概念 1: 两阶段原子提交

取代 v1 的"一帧原子 commit 所有方块"，避免制造新的 CPU 峰值：

**阶段 1 — 分帧 Prepare（跨多帧）**：
- 在 TypeBuffer 中预分配 shadow region（count 之外的空间）
- 分帧将方块数据写入 shadow region（每帧 300-600 块，约 0.5-1ms）
- 此时 `mesh.count` 不变，shadow region 对渲染不可见

**阶段 2 — 一帧 Publish（单帧 < 0.1ms）**：
- 全部 prepare 完成后，一帧内做：
  - `mesh.count = newCount`（O(1)，极低成本）
  - `mesh.instanceMatrix.needsUpdate = true`
  - 标记 chunk 进入"雾内淡入"状态
- 从"不存在"到"完整可见"在一帧内完成，无中间态暴露

```
┌────────────────────────────────────────────────────────────────┐
│  TypeBuffer 内存布局                                           │
│                                                                │
│  [0 ─── count ───][count ─── prepareEnd ───][─── capacity ──] │
│   ↑ 已渲染区域     ↑ shadow region (写入中)    ↑ 空闲          │
│                                                                │
│  Publish: count = prepareEnd  (一次赋值，所有新方块立即可见)    │
└────────────────────────────────────────────────────────────────┘
```

### 核心概念 2: 实时帧预算 Scheduler

取代 v1 的"固定分配表"模式：

```javascript
// 每帧开始时记录 frameStart
const frameStart = performance.now();
const frameDeadline = frameStart + targetFrameMs - safetyMarginMs;

// 每个阶段在执行前检查剩余时间
function getRemainingMs() {
  return Math.max(0, frameDeadline - performance.now());
}

// 阶段按优先级顺序执行，时间不够则跳过
if (getRemainingMs() > 0.5) processChunkInit();
if (getRemainingMs() > 1.0) processAssembly();
if (getRemainingMs() > 0.5) processPrepare();
if (getRemainingMs() > 0.3) processDeferred();
```

### 核心概念 3: Worker Transfer 优化

Worker 回包的 Float32Array（matrices、aoLow、aoHigh、orientation）使用 Transferable 零拷贝传输：

```javascript
// Worker 侧
const transfer = [matrices.buffer, aoLow.buffer, aoHigh.buffer, orientation.buffer];
postMessage({ meshData, ... }, transfer);
```

主线程收到后 ArrayBuffer 直接可用，无反序列化成本。

### 核心概念 4: 雾遮掩代替真透明

新 chunk publish 后通过距离雾自然过渡，不引入 per-instance opacity：
- chunk 在 fog far 附近出现时，雾本身就遮住了方块
- 随玩家靠近，方块自然从雾中"走出来"
- 无需 `material.transparent`、无排序问题、无 depthWrite 冲突
- 对于玩家身边突然加载的 chunk（极端情况），用 chunk group visibility toggle + 1-2 帧 delay 避免突兀

## 模块设计

### 1. [P0] 废除 runtime-build-mesh-fast，全走可中断路径

**当前问题**：`assembleRuntimeBuildMeshFast()` (Chunk.js:878) 调用 `_buildMeshFromExistingBlockData()` (Chunk.js:1316) 同步完成全量构建。

**改造**：
- 删除 `assembleRuntimeBuildMeshFast` 方法
- `ChunkAssemblyScheduler._runTask` 中 `'runtime-build-mesh-fast'` stage 改为 `'runtime-build-mesh'`（使用可中断的 `_buildMeshFromExistingBlockDataIncremental(maxMs)`）
- 可中断路径的 `maxMs` 参数不再硬编码为 3ms，改为从 scheduler 传入的当前帧剩余预算

### 2. [P0] Staging Buffer + 两阶段原子提交

在 `GlobalInstancedMeshManager` 中实现：

**staging 入口**：`stageMeshDataForChunk(chunkKey, meshDataArray)`
- 解析 meshDataArray，按 type 分组存入 `this.stagingZone`
- 不触发任何 GPU 操作

**分帧 prepare**：`prepareStagedBlocks(options)`
- 每帧调用，受时间预算约束
- 对每个 staged chunk：在目标 TypeBuffer 的 shadow region 写入 matrix/AO 数据
- 维护 `prepareProgress` 状态：当前 chunk 已 prepare 到哪个位置
- 预扩容在 prepare 开始前一次性完成（检查 capacity 是否足够容纳 count + staged）

**一帧 publish**：`publishPreparedChunk(chunkKey)`
- 条件：chunk 的所有方块已 prepare 完毕
- 操作：各 TypeBuffer `mesh.count = newCount`，`instanceMatrix.needsUpdate = true`
- 注册 chunkKey 到 chunkToCoords
- 更新 coordToRef 索引
- 成本：O(1) per buffer + O(n) coordToRef 写入（n = 方块数，但只是 Map.set，约 0.3ms/3000块）

**publish 的 coordToRef 写入优化**：
- prepare 阶段就写入 coordToRef（标记为 staged 状态），publish 时只翻转标记
- 或 publish 阶段的 Map.set 本身足够快（<0.5ms），无需额外优化

### 3. [P0] Worker 回包 Transferable + 裁剪

**Transfer List**：
- `WorldWorker.js` 的 `postMessage` 添加第二参数，传输 meshData 中所有 Float32Array 的 buffer
- `WorldWorkerPoolImpl._dispatchToWorker` 传递 transfer list

**裁剪冗余字段**：
- 回包中 `snapshot.blocks` 与 `blockDataBlocks` 内容重叠，去掉 `snapshot.blocks`
- `entities.modGunMan` 和顶层 `modGunMan` 重复，统一为一个
- `routing` 字段在 runtime-streaming 阶段不需要（仅 bootstrap 用），条件性发送

**Worker callback 消费预算化**：
- worker onmessage 收到回包后不立即处理全部数据
- 将 meshData 存入 staging，其余元数据立即处理（成本很低）
- 避免 callback 内同步执行 buildMeshes 造成尖峰

### 4. [P1] 实时帧预算 Scheduler (FrameBudgetScheduler)

取代 v1 的 FrameBudgetGovernor：

```javascript
class FrameBudgetScheduler {
  constructor(options) {
    this.targetFrameMs = 1000 / (options.targetFps || 100);
    this.safetyMarginMs = options.safetyMarginMs || 2; // 留给渲染的安全余量
    this.frameStart = 0;
  }

  beginFrame() {
    this.frameStart = performance.now();
  }

  getRemainingMs() {
    return Math.max(0, this.frameStart + this.targetFrameMs - this.safetyMarginMs - performance.now());
  }

  hasTimeFor(estimatedMs) {
    return this.getRemainingMs() >= estimatedMs;
  }
}
```

World.update() 使用：
```javascript
update(playerPos, dt) {
  this.frameBudgetScheduler.beginFrame();
  
  this._updateChunkTopology(playerPos); // 无预算，必须执行
  
  if (this.frameBudgetScheduler.hasTimeFor(0.5))
    this._processChunkInit(this.frameBudgetScheduler.getRemainingMs());
  
  if (this.frameBudgetScheduler.hasTimeFor(1.0))
    this._processAssembly(this.frameBudgetScheduler.getRemainingMs() * 0.5);
  
  if (this.frameBudgetScheduler.hasTimeFor(0.5))
    this._processPrepare(this.frameBudgetScheduler.getRemainingMs() * 0.5);
  
  this._publishReadyChunks(); // 极低成本，始终执行
  
  if (this.frameBudgetScheduler.hasTimeFor(0.3))
    this._processDeferred(this.frameBudgetScheduler.getRemainingMs());
  
  this.particles.update(dt);
}
```

### 5. [P1] 分帧 Prepare 细化

Prepare 阶段将 staged 方块分帧写入 TypeBuffer shadow region：

- 每帧预算从 scheduler 获取（通常 1-2ms）
- 按 chunk 距离排序，最近的 chunk 优先 prepare
- 单 chunk prepare 可跨帧（维护 cursor）
- 预计 3000 方块 / 600 块每帧 = 5 帧完成一个 chunk 的 prepare
- Publish 只在 prepare 完成后的下一帧执行

### 6. [P2] 雾遮掩淡入

不修改材质系统，利用现有 fog 机制：
- chunk publish 后立即可见
- 远处 chunk 被 fog 自然遮盖
- 现有 FOG_NEAR=30, FOG_FAR=70 已经提供渐变
- 渲染距离 2-3 chunks（32-48 blocks），大部分新 chunk 在 fog 区域内出现

对于极端情况（玩家瞬移或 chunk 在身边加载）：
- publish 前检查距离，如果 < FOG_NEAR，delay 1-2 帧 publish（让玩家远离一点）
- 或使用 chunk group 的 `visible` toggle + requestAnimationFrame 微延迟

### 7. [P2] 奔跑压测验证

使用 Playwright 自动化：
- 模拟玩家持续一方向移动 30 秒
- 每帧采集 `performance.now()` diff（frameMs）
- 统计 p50/p95/p99 和 long task（>16ms）计数
- 截图检测整类方块消失（像素对比连续帧）

## 文件变更清单

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `src/world/Chunk.js` | 修改 | 删除 `assembleRuntimeBuildMeshFast`，可中断路径接受外部预算 |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 移除 `runtime-build-mesh-fast` stage |
| `src/core/GlobalInstancedMeshManager.js` | 修改 | staging zone、分帧 prepare、publish、预扩容 |
| `src/workers/WorldWorker.js` | 修改 | postMessage 添加 transfer list、裁剪冗余字段 |
| `src/workers/WorldWorkerPoolImpl.js` | 修改 | _dispatchToWorker 传递 transfer list |
| `src/world/ChunkGenerator.js` | 修改 | buildMeshes 初次加载改为 staging |
| `src/world/World.js` | 修改 | 集成 FrameBudgetScheduler，重构 update() |
| `src/core/FrameBudgetScheduler.js` | 新增 | 实时帧预算调度器 |

## 验收标准

1. 玩家持续奔跑 30 秒，frameMs p99 ≤ 目标帧时的 120%（100fps 下 p99 ≤ 12ms）
2. 奔跑过程中无任何方块闪烁/消失/重现现象（Playwright 截图验证）
3. 新 chunk 从雾中自然出现，无突兀跳变
4. 现有交互功能（放置/挖掘方块、consolidation）不受影响
5. Worker 回包传输使用 Transferable，主线程 onmessage 回调耗时 < 1ms
6. 单帧内不存在 > 4ms 的同步 chunk 构建操作
