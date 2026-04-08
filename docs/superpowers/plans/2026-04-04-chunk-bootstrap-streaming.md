# Chunk Bootstrap And Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将世界加载拆分为启动预装配和运行期增量加载两条链路，消除 chunk 加载与 consolidation/AO/实体恢复在主线程扎堆导致的 FPS 抖动。

**Architecture:** 在 `Game`/`World`/`Chunk` 之间引入启动状态机和 chunk 分阶段装配状态，Worker 回包后先落逻辑数据，再由主线程预算调度器分阶段构建地形、实体和 finalize。启动阶段统一冻结玩家与动态系统，并延迟 consolidation 与阴影刷新到统一 finalize 执行；运行期按预算消费远端 chunk 装配任务。

**Tech Stack:** JavaScript ES Modules、Three.js、Web Workers、现有浏览器测试框架

---

### Task 1: 为启动阶段与装配阶段写回归测试

**Files:**
- Modify: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，覆盖启动阶段冻结与分阶段装配**
- [ ] **Step 2: 在浏览器测试页中运行 `test-world.js`，确认新测试先失败**
- [ ] **Step 3: 仅实现让测试通过所需的最小状态字段与方法**
- [ ] **Step 4: 再次运行 `test-world.js`，确认新测试通过**

### Task 2: 实现世界启动屏障

**Files:**
- Modify: `src/core/Game.js`
- Modify: `src/world/World.js`

- [ ] **Step 1: 在 `World` 中加入 bootstrap 状态与首屏 chunk 目标集合**
- [ ] **Step 2: 在 `Game.update()` 中根据 bootstrap 状态冻结玩家交互、物理和运行时系统**
- [ ] **Step 3: 首屏 chunk 全部 finalize 后再释放玩家并触发一次阴影刷新**
- [ ] **Step 4: 运行世界/玩家相关测试与手动验证启动流程**

### Task 3: 拆分 Chunk 生命周期与主线程装配队列

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/ChunkGenerator.js`
- Modify: `src/world/World.js`
- Create: `src/world/ChunkAssemblyScheduler.js`

- [ ] **Step 1: 给 `Chunk` 增加 `loadState`、装配缓存与队列标记**
- [ ] **Step 2: 把 `ChunkGenerator.gen()` 改为 Worker 回包只落数据并进入 `worker-ready`**
- [ ] **Step 3: 新增调度器，分阶段推进 `terrain`、`entities`、`finalize`**
- [ ] **Step 4: 为运行期近处 chunk 设置更高优先级，远端实体恢复后置**

### Task 4: 接入启动期统一 finalize 和 consolidation 合并

**Files:**
- Modify: `src/world/ChunkConsolidation.js`
- Modify: `src/world/World.js`
- Modify: `src/world/ChunkRenderUtils.js`

- [ ] **Step 1: 启动阶段统一 `deferConsolidation = true`**
- [ ] **Step 2: finalize 时只对 dirty chunk 分批 `consolidate()`**
- [ ] **Step 3: 合并阴影刷新请求，避免每个 chunk ready 都触发**
- [ ] **Step 4: 验证 finalize 后 chunk 状态收敛到 `finalized`**

### Task 5: 运行期增量加载预算化与验证

**Files:**
- Modify: `src/world/World.js`
- Modify: `src/core/Game.js`
- Modify: `src/tests/test-world.js`

- [ ] **Step 1: 为运行期增量加载设置每帧预算与最大装配数**
- [ ] **Step 2: 确保玩家交互链路只处理局部更新，不参与 bootstrap 阶段**
- [ ] **Step 3: 运行 `npm run lint`**
- [ ] **Step 4: 在浏览器测试页运行世界测试并记录结果**
