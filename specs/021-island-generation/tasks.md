# Tasks: Island Generation

**Input**: Design documents from `/specs/021-island-generation/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, quickstart.md

**Tests**: 本功能的测试主要通过浏览器端手动验证，无需自动化测试任务

**Organization**: 任务按用户故事组织，支持独立开发和测试

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可以并行执行（不同文件，无依赖）
- **[Story]**: 任务所属的用户故事（US1, US2, US3）
- 描述中包含确切的文件路径

---

## Phase 1: Setup (共享基础设施)

**Purpose**: 项目初始化和基础结构

- [ ] T001 确认项目结构符合 plan.md 中的 Source Code 布局
- [ ] T002 [P] 确认开发服务器可以正常启动 (`npm run start`)

---

## Phase 2: Foundational (阻塞型前置条件)

**Purpose**: 核心基础设施，所有用户故事实现前必须完成

- [ ] T003 [P] 创建海岛生成器模块骨架 `src/workers/maps/IslandMap.js`，导出空函数
- [ ] T004 [P] 在 `src/workers/WorldWorker.js` 中导入 IslandMap 模块（第 11 行附近）
- [ ] T005 定义海岛配置常量对象（在 IslandMap.js 中）
  - regionSize: 400
  - islandSize: 30
  - transitionSize: 4
  - spawnProbability: 0.08
  - seaLevel: -2

**Checkpoint**: 基础结构已就绪，可以开始用户故事实现

---

## Phase 3: User Story 1 - 探索新生成的海岛 (Priority: P1) 🎯 MVP

**Goal**: 实现海岛生成核心功能，玩家在世界中探索时可以发现一座独立的海岛，四周环海

**Independent Test**: 玩家在世界中移动约 200-400 格时，可以观察到海岛的存在，四周有海水环绕，与大陆距离约 20 格

### Implementation for User Story 1

- [ ] T006 [P] [US1] 实现 `getIslandInfo` 函数 - 计算区域和海岛中心点 `src/workers/maps/IslandMap.js`
  - 使用确定性随机函数计算每 400x400 区域的海岛中心
  - 返回海岛中心坐标、区域类型、过渡因子

- [ ] T007 [P] [US1] 实现海岛范围判断逻辑 - 判断坐标是否在海岛范围内 `src/workers/maps/IslandMap.js`
  - 使用 Max 距离判断方形范围
  - 支持 transitionZone 过渡带判断

- [ ] T008 [P] [US1] 实现海岛形状噪声算法 - 生成不规则海岸线 `src/workers/maps/IslandMap.js`
  - 使用两层噪声叠加（主噪声 + 细节噪声）
  - 动态阈值产生不规则边缘

- [ ] T009 [US1] 实现 `generateIsland` 函数 - 生成海岛基本结构 `src/workers/maps/IslandMap.js`
  - 计算地表高度（基于地形高度 + 最多 2 格起伏）
  - 判断是否在海平面以下

- [ ] T010 [US1] 生成海岛地下填充层 `src/workers/maps/IslandMap.js`
  - 地表下方生成 dirt 层（3-5 层）
  - 继续生成 stone 层和 end_stone 基岩层（共 12 层）

- [ ] T011 [US1] 在 WorldWorker 主生成循环中集成海岛检查 `src/workers/WorldWorker.js`
  - 在第 160 行附近添加 `islandInfo` 检查逻辑
  - 调用 `IslandMap.generate` 生成海岛方块

- [ ] T012 [US1] 确保海岛与大陆的隔离距离不少于 20 格
  - 在海岛生成逻辑中添加边界检查
  - 验证海岛四周都是海水

**Checkpoint**: 用户故事 1 已完成 - 玩家可以探索到独立的海岛

---

## Phase 4: User Story 2 - 在海岛上行走和互动 (Priority: P2)

**Goal**: 海岛表面由 sand 和 stone 方块分片聚集分布，表面相对平坦，有 1-2 棵树木

**Independent Test**: 玩家可以走上并穿越海岛，验证海岛表面的方块类型、地形起伏和树木分布

### Implementation for User Story 2

- [ ] T013 [P] [US2] 实现方块分片聚集分布算法 - sand 和 stone 各自成片 `src/workers/maps/IslandMap.js`
  - 使用 Voronoi 区域 + 噪声扰动方法
  - 生成 3-5 个 sand 种子点和 2-4 个 stone 种子点
  - 根据最近种子点决定方块类型

- [ ] T014 [US2] 实现沙滩区域生成逻辑 - 海岸边缘为 sand 方块 `src/workers/maps/IslandMap.js`
  - 根据距离海岛中心的距离判断沙滩区域
  - 沙滩位于海岸边缘（靠近海水）

- [ ] T015 [US2] 实现 stone 区域生成逻辑 - 海岛内部主要为 stone `src/workers/maps/IslandMap.js`
  - stone 主要分布在海岛中心区域
  - 与 sand 区域平滑过渡

- [ ] T016 [P] [US2] 实现树木生成逻辑 - 随机生成 1-2 棵橡树 `src/workers/maps/IslandMap.js`
  - 在海岛主体区域以适当概率生成树木
  - 使用 `Tree.generate` 函数生成普通橡树
  - 树木生成时确保有足够空间

- [ ] T017 [US2] 确保海岛高度起伏不超过 2 格 `src/workers/maps/IslandMap.js`
  - 限制地表高度的最大高差
  - 以平地为主，允许少量缓坡

- [ ] T018 [US2] 添加树木到 structureCenters 列表 - 确保跨 Chunk 渲染 `src/workers/maps/IslandMap.js`
  - 将生成的树木中心点记录到 structureCenters
  - 确保 reload 后树木不丢失

**Checkpoint**: 用户故事 2 已完成 - 玩家可以在海岛上行走和互动

---

## Phase 5: User Story 3 - 在海岛附近出生 (Priority: P3)

**Goal**: 玩家在世界中出生或重生时，有几率直接出生在海岛附近的沙滩位置

**Independent Test**: 玩家重生时，可以观察到出生点位于海岛沙滩位置

### Implementation for User Story 3

- [ ] T019 [P] [US3] 在 IslandMap 中导出海岛出生点计算函数 `src/workers/maps/IslandMap.js`
  - 计算沙滩边缘位置作为出生点
  - 返回出生点坐标和朝向

- [ ] T020 [US3] 修改 `src/core/Game.js` 中的玩家初始生成逻辑
  - 添加海岛出生点检测
  - 当玩家首次生成时，有几率选择海岛作为出生点

- [ ] T021 [US3] 在 World.js 中添加出生点查找函数（如需要）
  - `findIslandSpawnPoint()` 函数
  - 返回最近的海岛出生点坐标

**Checkpoint**: 用户故事 3 已完成 - 玩家可以在海岛附近出生

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: 改进和跨功能关注点

- [ ] T022 [P] 更新 CLAUDE.md 添加海岛生成相关说明
  - 在核心架构表中添加海岛生成器
  - 更新地图生成相关文档

- [ ] T023 [P] 代码审查和清理
  - 移除未使用的变量和注释
  - 确保代码缩进为 2 个空格

- [ ] T024 [P] 验证 quickstart.md 中的测试步骤
  - 启动开发服务器验证海岛生成
  - 记录验证结果

- [ ] T025 确保存档加载后海岛状态一致
  - 验证 snapshot 保存和恢复逻辑
  - 确保树木和方块正确恢复

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 - 可以立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成 - 阻塞所有用户故事
- **User Story 1 (Phase 3)**: 依赖 Foundational 完成 - 无其他故事依赖
- **User Story 2 (Phase 4)**: 依赖 Foundational 完成 - 可独立测试
- **User Story 3 (Phase 5)**: 依赖 Foundational 完成 - 可独立测试
- **Polish (Phase N)**: 依赖所有用户故事完成

### User Story Dependencies

- **User Story 1 (P1)**: 无依赖 - Foundational 完成后即可开始
- **User Story 2 (P2)**: 依赖 US1 的海岛基础生成，但可以独立测试
- **User Story 3 (P3)**: 依赖 US1 和海岛生成，但可以独立测试

### Within Each User Story

- 模型/基础函数 优先于 服务/生成函数
- 核心实现 优先于 集成
- 故事完成后再移动到下一个优先级

### Parallel Opportunities

- **Phase 1 Setup**: T001 和 T002 可以并行执行
- **Phase 2 Foundational**: T003、T004、T005 可以并行执行（不同文件）
- **Phase 3 US1**: T006、T007、T008 可以并行执行（不同函数）
- **Phase 4 US2**: T013（方块分布）和 T016（树木生成）可以并行执行
- **Phase 5 US3**: T019（出生点函数）可以独立并行

---

## Parallel Example: User Story 1

```bash
# 并行执行海岛生成器的基础函数开发：
Task: "实现 getIslandInfo 函数 - 计算区域和海岛中心点"
Task: "实现海岛范围判断逻辑 - 判断坐标是否在海岛范围内"
Task: "实现海岛形状噪声算法 - 生成不规则海岸线"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational
3. 完成 Phase 3: User Story 1
4. **停止并验证**: 测试用户故事 1 是否独立工作
5. 启动开发服务器，探索世界，确认海岛生成

### Incremental Delivery

1. 完成 Setup + Foundational → 基础结构就绪
2. 添加 User Story 1 → 独立测试 → 海岛可以生成
3. 添加 User Story 2 → 独立测试 → 沙滩和树木可以生成
4. 添加 User Story 3 → 独立测试 → 出生点可以工作
5. 每个故事都增加价值而不破坏之前的故事

### Parallel Team Strategy

如果有多个开发者：

1. 团队共同完成 Setup + Foundational
2. Foundational 完成后：
   - 开发者 A: User Story 1（海岛核心生成）
   - 开发者 B: User Story 2（方块分布和树木）
   - 开发者 C: User Story 3（出生点逻辑）
3. 故事独立完成后集成

---

## Notes

- [P] 任务 = 不同文件，无依赖，可以并行执行
- [Story] 标签将任务映射到特定用户故事以便追踪
- 每个用户故事应该是独立可完成和可测试的
- 每次提交一个任务或逻辑组
- 在任何检查点停止以验证故事是否独立工作
- 避免：模糊的任务、相同文件冲突、跨故事依赖破坏独立性
