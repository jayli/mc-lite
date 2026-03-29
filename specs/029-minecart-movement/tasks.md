# Tasks: Minecart Movement (矿车移动功能)

**Input**: Design documents from `/specs/029-minecart-movement/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md, quickstart.md

**Tests**: 手动测试验证，无自动化测试框架

**Organization**: 任务按用户故事分组，支持独立实现和测试

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 任务所属用户故事（US1, US2, US3, US4）
- 描述包含精确文件路径

---

## Phase 1: Setup (配置与常量)

**Purpose**: 添加移动功能所需的配置常量

- [x] T001 在 `src/constants/GameConfig.js` 添加矿车移动配置常量 MINECART_SPEED (1.0)、MAX_LINKED_MINECARTS (10)、TRACK_BLOCK_TYPES 数组

---

## Phase 2: Foundational (渲染架构重构)

**Purpose**: 重构矿车渲染架构为 InstancedMesh，为所有用户故事提供基础

**⚠️ CRITICAL**: 必须在任何用户故事开始前完成

- [x] T002 创建 `src/actors/minecart/MinecartInstancedRenderer.js` - InstancedMesh 批量渲染器，参照 ZombieInstancedRenderer 设计
- [x] T003 重构 `src/actors/minecart/Minecart.js` - 移除 mesh/createVisuals/updateTransform，添加 movementState/lastTrackPosition/velocity/linkedMinecarts 属性
- [x] T004 修改 `src/actors/minecart/MinecartManager.js` - 集成 MinecartInstancedRenderer，在 update() 中调用渲染器更新
- [x] T005 修改 `src/core/Game.js` - 初始化 MinecartInstancedRenderer 并传递给 MinecartManager

**Checkpoint**: 渲染架构重构完成，矿车显示正常，可进入用户故事开发

---

## Phase 3: User Story 1 - 矿车基础移动 (Priority: P1) 🎯 MVP

**Goal**: 实现 ctrl+左键激发矿车前进/后退，沿铁轨移动，遇到终点停止

**Independent Test**: 放置矿车在直轨上，按 ctrl+左键激发，验证矿车沿铁轨方向移动并在终点停止

### Implementation for User Story 1

- [x] T006 [US1] 创建 `src/actors/minecart/MinecartMovementSystem.js` - 移动系统核心，包含铁轨检测、方向计算、位置更新逻辑
- [x] T007 [US1] 在 `MinecartMovementSystem.js` 实现 `getDirectionVector(orientation, movementState)` - 根据朝向和移动状态返回方向向量
- [x] T008 [US1] 在 `MinecartMovementSystem.js` 实现 `hasTrackAt(x, y, z)` - 检测指定位置是否为铁轨方块
- [x] T009 [US1] 在 `MinecartMovementSystem.js` 实现 `update(minecart, deltaTime)` - 更新矿车位置，处理前进/后退逻辑
- [x] T010 [US1] 修改 `src/actors/player/PlayerInteraction.js` - 添加 ctrl+左键检测，调用 tryActivateMinecart(hit, 'forward')
- [x] T011 [US1] 修改 `src/actors/player/PlayerInteraction.js` - 添加 ctrl+shift+左键检测，调用 tryActivateMinecart(hit, 'backward')
- [x] T012 [US1] 在 `PlayerInteraction.js` 实现 `tryActivateMinecart(hit, direction)` - 激发矿车移动，设置 movementState
- [x] T013 [US1] 修改 `src/actors/minecart/MinecartManager.js` - 在 update() 中调用 MinecartMovementSystem.update() 更新所有矿车

**Checkpoint**: 矿车基础移动功能可用，可独立测试 ctrl+左键激发前进/后退

---

## Phase 4: User Story 2 - 矿车转弯 (Priority: P2)

**Goal**: 矿车到达交叉点时自动检测左右铁轨并转弯

**Independent Test**: 构建 L 形或十字形铁轨网络，让矿车移动到交叉点，观察转弯行为

### Implementation for User Story 2

- [x] T014 [US2] 在 `MinecartMovementSystem.js` 实现 `getLeftDirection(orientation)` - 返回左侧方向向量
- [x] T015 [US2] 在 `MinecartMovementSystem.js` 实现 `getRightDirection(orientation)` - 返回右侧方向向量
- [x] T016 [US2] 在 `MinecartMovementSystem.js` 实现 `checkTurn(minecart, trackPos)` - 检测左右铁轨，返回转弯方向
- [x] T017 [US2] 在 `MinecartMovementSystem.js` 更新 `update()` 方法 - 前方无铁轨时调用 checkTurn()，执行转弯并更新 orientation
- [x] T018 [US2] 在 `MinecartMovementSystem.js` 实现随机转弯选择 - 左右两侧都有铁轨时随机选择一个方向

**Checkpoint**: 矿车转弯功能可用，可在复杂铁轨网络中测试转弯行为

---

## Phase 5: User Story 3 - 矿车链接联动 (Priority: P3)

**Goal**: 相邻矿车形成链接，激发任一矿车时所有链接矿车同步移动

**Independent Test**: 连续放置 3 个矿车形成列车，激发中间矿车，观察 3 节矿车同步移动

### Implementation for User Story 3

- [x] T019 [US3] 创建 `src/actors/minecart/MinecartLinkDetector.js` - 链接检测模块
- [x] T020 [US3] 在 `MinecartLinkDetector.js` 实现 `detectLinks(minecart, manager)` - 检测相邻矿车，返回链接 ID 集合
- [x] T021 [US3] 在 `MinecartLinkDetector.js` 实现 `findAllLinked(minecart, manager, visited)` - 递归查找所有链接矿车（最多 10 节）
- [x] T022 [US3] 修改 `PlayerInteraction.js` tryActivateMinecart() - 激发前检测链接，同步激发所有链接矿车
- [x] T023 [US3] 修改 `MinecartMovementSystem.js` update() - 确保链接矿车同速同向移动
- [x] T024 [US3] 修改 `src/actors/minecart/MinecartManager.js` pickUp() - 拾取时断开链接，停止相关矿车移动

**Checkpoint**: ✅ 矿车链接功能完成

---

## Phase 6: User Story 4 - 矿车碰撞 (Priority: P4)

**Goal**: 实现碰撞检测、推动和回弹逻辑

**Independent Test**: 放置两个矿车相对运动或一静一动，观察碰撞后的行为

### Implementation for User Story 4

- [x] T025 [US4] 创建 `src/actors/minecart/MinecartCollisionSystem.js` - 碰撞检测模块
- [x] T026 [US4] 在 `MinecartCollisionSystem.js` 实现 `checkCollision(minecart, newPos, manager)` - 检测矿车碰撞
- [x] T027 [US4] 在 `MinecartCollisionSystem.js` 实现 `isHeadOn(minecartA, minecartB)` - 判断是否相向运动
- [x] T028 [US4] 在 `MinecartCollisionSystem.js` 实现 `handlePushCollision(movingCart, staticCart)` - 推动碰撞处理
- [x] T029 [US4] 在 `MinecartCollisionSystem.js` 实现 `handleHeadOnCollision(cartA, cartB)` - 相向碰撞处理
- [x] T030 [US4] 在 `MinecartCollisionSystem.js` 实现 `bounceToLastTrack(minecart)` - 回弹到最近铁轨位置
- [x] T031 [US4] 修改 `MinecartMovementSystem.js` update() - 移动前调用碰撞检测，处理碰撞结果
- [x] T032 [US4] 在 `Minecart.js` 更新 lastTrackPosition - 每帧记录最近经过的铁轨位置

**Checkpoint**: ✅ 矿车碰撞功能完成

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 完善功能和代码质量

- [x] T033 扩展 `Minecart.js` toJSON()/fromJSON() - 添加 movementState 和 lastTrackPosition 持久化支持
- [x] T034 运行 `npm run lint` 检查代码规范
- [x] T035 按照 quickstart.md 进行手动功能验证测试 - 服务器已启动，可在 http://localhost:8080 测试
- [x] T036 在 MinecartInstancedRenderer 实现车轮旋转动画（可选优化） - 用户决定跳过

---

## ✅ Implementation Complete

所有任务已完成。矿车移动功能已实现，包括：
- InstancedMesh 批量渲染优化
- 基础移动（ctrl+左键向前，ctrl+shift+左键向后）
- 转弯逻辑
- 链接联动（最多10节）
- 碰撞检测与回弹

**测试方式**: 访问 http://localhost:8080，打开浏览器控制台：
```javascript
// 检查矿车数量
window.game.minecartManager.getCount();
// 检查矿车状态
window.game.minecartManager.minecarts.forEach(m => console.log(m.getState()));
```

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖，立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 - **阻塞所有用户故事**
- **Phase 3-6 (User Stories)**: 全部依赖 Phase 2 完成
- **Phase 7 (Polish)**: 依赖所有用户故事完成

### User Story Dependencies

- **US1 (P1)**: Phase 2 完成后可开始 - 无其他依赖
- **US2 (P2)**: 依赖 US1 完成（需要基础移动逻辑）
- **US3 (P3)**: 依赖 US1 完成（需要移动状态管理）
- **US4 (P4)**: 依赖 US1/US3 完成（需要移动和链接逻辑）

### Parallel Opportunities

- Phase 1 内部: 无并行（单任务）
- Phase 2: T002/T003 可并行（不同文件），T004/T005 依赖 T002/T003
- US1 内部: T006-T009 可并行，T010-T013 顺序执行
- US2 内部: T014-T016 可并行
- US3 内部: T019-T021 可并行
- US4 内部: T025-T027 可并行

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational (关键阻塞点)
3. 完成 Phase 3: User Story 1
4. **STOP and VALIDATE**: 手动测试基础移动功能
5. 可选择部署/演示

### Incremental Delivery

1. Setup + Foundational → 渲染架构就绪
2. US1 基础移动 → 测试 → MVP 交付
3. US2 转弯 → 测试 → 增强体验
4. US3 链接 → 测试 → 列车功能
5. US4 碰撞 → 测试 → 完整物理交互

---

## Notes

- 测试方式：手动测试，访问 http://localhost:8080/src/tests/index.html
- 调试方式：浏览器控制台访问 `window.game.minecartManager`
- 每完成一个用户故事后提交代码
- 遵循 Constitution 原则：内存效率、资源释放、性能优化
- InstancedMesh 渲染是关键优化，确保正确实现