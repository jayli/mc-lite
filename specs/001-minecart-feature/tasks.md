# Tasks: Minecart (矿车系统)

**Input**: Design documents from `/specs/001-minecart-feature/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: 手动测试，访问 http://localhost:8080/src/tests/index.html

**Organization**: 任务按用户故事组织，支持独立实现和测试。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属用户故事 (US1, US2, US3)
- 包含精确文件路径

## Path Conventions

- **Single project**: `src/` 位于仓库根目录
- 路径基于 plan.md 定义的项目结构

---

## Phase 1: Setup (基础设施)

**Purpose**: 项目结构、配置和物品注册准备

- [x] T001 在 src/actors/ 下创建 minecart 目录结构
- [x] T002 [P] 在 src/constants/BlockData.js 中添加 mine_cart 方块定义
- [x] T003 [P] 在 src/constants/GameConfig.js 中添加矿车配置常量 (MAX_MINECARTS: 50)
- [x] T004 [P] 准备矿车材质文件到 src/assets/textures/ (minecart_body.png, minecart_wheel.png)
- [x] T005 [P] 在背包系统中注册矿车物品，图标使用 src/assets/textures/Invicon_Minecart.png

---

## Phase 2: Foundational (核心基础)

**Purpose**: 所有用户故事依赖的核心实体和管理器

**⚠️ CRITICAL**: 用户故事实现必须等待此阶段完成

- [x] T006 创建 Minecart 实体类骨架在 src/actors/minecart/Minecart.js (包含 id, position, orientation, state, mesh 属性)
- [x] T007 创建 MinecartManager 类在 src/actors/minecart/MinecartManager.js (minecarts Map, positionIndex Map, createMinecart, removeMinecart 方法)
- [x] T008 在 src/core/Game.js 中初始化 MinecartManager 实例并挂载到 this.minecartManager
- [x] T009 创建 MinecartPlacementHandler 类骨架在 src/actors/minecart/MinecartPlacementHandler.js (继承 EntityPlacementHandler)

**Checkpoint**: 基础框架就绪，用户故事可并行开始

---

## Phase 3: User Story 1 - 放置矿车 (Priority: P1) 🎯 MVP

**Goal**: 玩家手持矿车物品在铁轨上右键放置，方向自动同步

**Independent Test**: 在铁轨上放置矿车，验证位置、方向正确；非铁轨位置拒绝放置

### Implementation for User Story 1

- [x] T010 [US1] 实现 MinecartPlacementHandler.canPlace() 方法 - 检查目标是否为铁轨、是否已被占用
- [x] T011 [US1] 实现 MinecartPlacementHandler.place() 方法 - 获取铁轨 orientation，调用 MinecartManager.createMinecart()
- [x] T012 [US1] 在 src/actors/entity-registry/EntityRegistry.js 中注册 mine_cart → MinecartPlacementHandler (在 Game.js 初始化时)
- [x] T013 [P] [US1] 扩展 src/services/PersistenceService.js 支持矿车数据存储 (minecarts 字段)
- [x] T014 [US1] 实现 MinecartManager 的 chunk 绑定逻辑 - 矿车随 chunk 加载/卸载
- [x] T015 [US1] 实现矿车拾取功能 - MinecartManager.pickUp() 方法，返回物品到玩家背包
- [x] T016 [US1] 在 PlayerInteraction.js 中添加矿车拾取检测（右键点击矿车位置触发 pickUp）

**Checkpoint**: US1 完成，可独立测试放置和拾取功能

---

## Phase 4: User Story 2 - 矿车3D模型渲染 (Priority: P2)

**Goal**: 矿车以独特3D模型渲染（车斗+四轮），不参与 instancedMesh

**Independent Test**: 创建矿车实体，验证模型几何结构、材质、方向旋转正确

### Implementation for User Story 2

- [x] T017 [US2] 实现 Minecart.createVisuals() 方法 - 创建 THREE.Group 包含车斗和四轮
- [x] T018 [US2] 创建车斗几何体 - BoxGeometry(0.8, 0.4, 0.8)，上开口箱形，在 Minecart.js 中
- [x] T019 [US2] 创建四个车轮几何体 - CylinderGeometry(0.1, 0.1, 0.1)，轴距 0.8，在 Minecart.js 中
- [x] T020 [US2] 实现 Minecart.updateOrientation() 方法 - 根据 orientation 值旋转模型
- [x] T021 [P] [US2] 在 src/core/MaterialManager.js 中添加矿车材质加载逻辑
- [x] T022 [US2] 实现 Minecart.destroy() 方法 - 释放 geometry 和 material，从 scene 移除
- [x] T023 [US2] 在 MinecartManager 中实现矿车渲染更新循环 - 调用所有矿车的 update()

**Checkpoint**: US2 完成，矿车模型正确渲染，可独立验证视觉效果

---

## Phase 5: User Story 3 - 矿车碰撞与物理交互 (Priority: P3)

**Goal**: 矿车作为透明实心物体参与物理碰撞

**Independent Test**: 放置矿车后尝试穿越，验证玩家被阻挡；玩家可站在矿车上

### Implementation for User Story 3

- [x] T024 [US3] 在 src/actors/player/Physics.js 中添加矿车碰撞检测逻辑
- [x] T025 [US3] 实现 Minecart.getBoundingBox() 方法 - 返回 1x1x1 碰撞盒
- [x] T026 [US3] 在 MinecartManager 中添加 getMinecartAt(x, y, z) 方法供物理系统查询
- [x] T027 [US3] 确保矿车不参与 faceculling - 验证透明实心属性 (isTransparent: true, isSolid: true)
- [x] T028 [US3] 实现爆炸摧毁矿车逻辑 - 在爆炸处理中检测矿车并调用 destroy()

**Checkpoint**: US3 完成，碰撞交互正确，所有用户故事功能完整

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 收尾和跨故事改进

- [x] T029 [P] 验证背包图标正确显示 Invicon_Minecart.png
- [x] T030 运行 npm run lint 检查代码规范
- [x] T031 手动测试 quickstart.md 中的所有验证场景
- [x] T032 [P] 清理调试代码和 console.log

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成 - **阻塞所有用户故事**
- **User Stories (Phase 3-5)**: 依赖 Foundational 完成
  - 用户故事可并行执行（如有多个开发者）
  - 或按优先级顺序执行 (P1 → P2 → P3)
- **Polish (Phase 6)**: 依赖所有用户故事完成

### User Story Dependencies

- **User Story 1 (P1)**: Foundational 完成后可开始 - 无其他故事依赖
- **User Story 2 (P2)**: Foundational 完成后可开始 - 依赖 T006 的 Minecart 实体骨架
- **User Story 3 (P3)**: Foundational 完成后可开始 - 依赖 US1 的放置功能和 US2 的实体模型

### Within Each User Story

- 核心实现在前，集成在后
- 故事完成后再进入下一优先级

### Parallel Opportunities

- T002, T003, T004, T005 可并行执行（Phase 1 全部可并行）
- T013 与 T010-T012 可并行（不同文件）
- T021 与 T017-T020 可并行（不同文件）
- T029 与 T030 可并行执行

---

## Parallel Example: Phase 1 Setup

```bash
# 同时执行所有标记 [P] 的任务:
Task: "在 src/constants/BlockData.js 中添加 mine_cart 方块定义"
Task: "在 src/constants/GameConfig.js 中添加矿车配置常量"
Task: "准备矿车材质文件到 src/assets/textures/"
Task: "在背包系统中注册矿车物品，图标使用 Invicon_Minecart.png"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational (关键阻塞点)
3. 完成 Phase 3: User Story 1
4. **停止并验证**: 独立测试放置和拾取功能
5. 可部署/演示

### Incremental Delivery

1. Setup + Foundational → 基础就绪
2. User Story 1 → 独立测试 → MVP 可演示
3. User Story 2 → 独立测试 → 视觉完善
4. User Story 3 → 独立测试 → 功能完整
5. 每个故事增值而不破坏前序功能

---

## Notes

- [P] 任务 = 不同文件，无依赖冲突
- [Story] 标签映射任务到用户故事，便于追踪
- 每个用户故事独立可完成和测试
- 每个任务或逻辑组完成后提交
- 任意检查点可停止验证故事独立性
- 避免：模糊任务、同文件冲突、破坏独立性的跨故事依赖
- **重要**: T005 背包注册使用已存在的图标文件 Invicon_Minecart.png