# Tasks: 炮塔与丧尸巢穴实体封装重构

**Input**: Design documents from `/specs/026-turret-nest-encapsulation/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/

**Tests**: Test tasks included for functional verification

**Organization**: Tasks are grouped by infrastructure and user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Infrastructure Setup

**Purpose**: Create foundational entity registry infrastructure

**⚠️ CRITICAL**: All tasks in this phase must complete before user story implementation

- [x] T001 Create `src/actors/entity-registry/` directory structure
- [x] T002 [P] Create `EntityPlacementHandler` base class in `src/actors/entity-registry/EntityPlacementHandler.js`
- [x] T003 [P] Create `EntityRegistry` class in `src/actors/entity-registry/EntityRegistry.js`
- [x] T004 Create `TurretPlacementHandler` class in `src/actors/turret/TurretPlacementHandler.js`
- [x] T005 Create `ZombieNestPlacementHandler` class in `src/actors/zombie-nest/ZombieNestPlacementHandler.js`

**Checkpoint**: Infrastructure classes created, can import without errors

---

## Phase 2: User Story 1 - 统一实体生命周期管理 (Priority: P1) 🎯 MVP

**Goal**: 提供统一的管理接口来创建、更新和销毁炮塔和丧尸巢穴

**Independent Test**: 在指定位置创建炮塔/丧尸巢穴，验证所有组件通过单一入口正确初始化

### Implementation for User Story 1

- [x] T006 [US1] Implement `EntityPlacementHandler` base class with `canPlace()` and `place()` methods in `src/actors/entity-registry/EntityPlacementHandler.js`
- [x] T007 [US1] Implement `EntityRegistry.register()`, `getHandler()`, `isSpecialBlock()` methods in `src/actors/entity-registry/EntityRegistry.js`
- [x] T008 [US1] Implement `TurretPlacementHandler.canPlace()` - check manager availability, turret limit, space availability, player collision in `src/actors/turret/TurretPlacementHandler.js`
- [x] T009 [US1] Implement `TurretPlacementHandler.place()` - place iron_ore base, obsidian pillars, create turret instance in `src/actors/turret/TurretPlacementHandler.js`
- [x] T010 [US1] Implement `ZombieNestPlacementHandler.canPlace()` - check manager availability, nest limit, structure blocks availability in `src/actors/zombie-nest/ZombieNestPlacementHandler.js`
- [x] T011 [US1] Implement `ZombieNestPlacementHandler.place()` - apply structure blocks, create nest instance in `src/actors/zombie-nest/ZombieNestPlacementHandler.js`
- [x] T012 [US1] Initialize `EntityRegistry` in `Game.init()` and register handlers in `src/core/Game.js`
- [x] T013 [US1] Refactor `PlayerInteraction.tryPlaceBlock()` to use `EntityRegistry` for special blocks in `src/actors/player/PlayerInteraction.js`

**Checkpoint**: User Story 1 complete - can place turrets and zombie nests via registry

---

## Phase 3: User Story 2 - 透明的持久化支持 (Priority: P1)

**Goal**: 保存和加载时炮塔和丧尸巢穴状态正确恢复

**Independent Test**: 保存游戏、退出、重新加载，验证实体状态正确恢复

### Implementation for User Story 2

- [ ] T014 [US2] Verify `TurretManager` serialization methods work correctly in `src/actors/turret/TurretManager.js` (already implemented)
- [ ] T015 [US2] Verify `ZombieNestManager` serialization methods work correctly in `src/actors/zombie-nest/ZombieNestManager.js` (already implemented)
- [ ] T016 [US2] Ensure `Game.exportForSave()` exports entity data via managers in `src/core/Game.js` (already implemented, verify integration)
- [ ] T017 [US2] Ensure `Game.restoreFromSave()` restores entity data via managers in `src/core/Game.js` (already implemented, verify integration)

**Checkpoint**: User Story 2 complete - save/load preserves entity states

---

## Phase 4: User Story 3 - 与世界的无缝交互 (Priority: P2)

**Goal**: 玩家可以通过统一方式与炮塔和丧尸巢穴交互

**Independent Test**: 点击炮塔或丧尸巢穴，验证交互事件正确触发

### Implementation for User Story 3

- [ ] T018 [US3] Verify `Turret` class handles interaction callbacks correctly in `src/actors/turret/Turret.js` (already implemented)
- [ ] T019 [US3] Verify `ZombieNest` class handles interaction callbacks correctly in `src/actors/zombie-nest/ZombieNest.js` (already implemented)
- [ ] T020 [US3] Ensure `PlayerInteraction` routes clicks to appropriate handler via registry in `src/actors/player/PlayerInteraction.js`

**Checkpoint**: User Story 3 complete - interactions work via unified interface

---

## Phase 5: User Story 4 - 模块间低耦合 (Priority: P2)

**Goal**: 修改炮塔或丧尸巢穴内部实现无需修改 World、Chunk、Player、Worker 模块

**Independent Test**: 修改实体内部实现，验证其他模块无需同步修改

### Implementation for User Story 4

- [x] T021 [US4] Remove hardcoded turret/zombie_nest checks from `PlayerInteraction.tryPlaceBlock()` in `src/actors/player/PlayerInteraction.js`
- [x] T022 [US4] Remove `tryPlaceTurret()` method from `PlayerInteraction` (moved to handler) in `src/actors/player/PlayerInteraction.js`
- [x] T023 [US4] Remove `tryPlaceZombieNest()` method from `PlayerInteraction` (moved to handler) in `src/actors/player/PlayerInteraction.js`
- [x] T024 [US4] Remove `getZombieNestStructureBlocks()` method from `PlayerInteraction` (moved to handler) in `src/actors/player/PlayerInteraction.js`
- [x] T025 [US4] Remove `canPlaceZombieNestAt()` method from `PlayerInteraction` (moved to handler) in `src/actors/player/PlayerInteraction.js`
- [x] T026 [US4] Remove `applyStructureBlocks()` method from `PlayerInteraction` (moved to handler) in `src/actors/player/PlayerInteraction.js`
- [x] T027 [US4] Remove `rollbackStructureBlocks()` method from `PlayerInteraction` (moved to handler) in `src/actors/player/PlayerInteraction.js`
- [x] T028 [US4] Verify `World.js` has no turret/nest specific code (should be clean)
- [x] T029 [US4] Verify `Chunk.js` has no turret/nest specific code (should be clean)
- [x] T030 [US4] Verify `PlayerInteraction.js` has no turret/nest specific code after refactoring

**Checkpoint**: User Story 4 complete - no scattered turret/nest logic in core modules

---

## Phase 6: Testing & Validation

**Purpose**: Verify all functionality and performance requirements

### Functional Tests

- [ ] T031 [P] Test turret placement via registry - verify blocks placed and turret created
- [ ] T032 [P] Test zombie nest placement via registry - verify structure placed and nest created
- [ ] T033 [P] Test turret limit enforcement via registry
- [ ] T034 [P] Test zombie nest limit enforcement via registry
- [ ] T035 [P] Test save/load cycle preserves turret positions and rotations
- [ ] T036 [P] Test save/load cycle preserves zombie nest positions and states
- [ ] T037 [P] Test entity interactions work correctly after refactoring

### Performance Tests

- [ ] T038 Measure placement operation latency - must be < 50ms
- [ ] T039 Run game for 5 minutes - verify 60 FPS maintained
- [ ] T040 Verify memory usage stable - no leaks from registry

**Checkpoint**: All tests pass, performance meets criteria

---

## Phase 7: Polish & Documentation

**Purpose**: Final cleanup and documentation updates

- [x] T041 Run `npm run lint` and fix any issues
- [ ] T042 Update code comments in new files
- [ ] T043 Verify all success criteria are met:
  - SC-001: Adding new entity type requires only 2 files (Entity definition + registration)
  - SC-002: Save/load success rate 100%
  - SC-003: No turret/nest specific code in World, Chunk, Player, Worker modules
  - SC-004: Interaction response < 50ms
  - SC-005: Decoupled architecture verified
  - SC-006: Integration time < 30 minutes for new entity type

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Infrastructure)**: No dependencies - start immediately
- **Phase 2 (US1)**: Depends on Phase 1 completion
- **Phase 3 (US2)**: Depends on Phase 2 completion (needs US1 infrastructure)
- **Phase 4 (US3)**: Depends on Phase 2 completion (needs US1 infrastructure)
- **Phase 5 (US4)**: Depends on Phase 2-4 completion (cleanup after implementation)
- **Phase 6 (Testing)**: Depends on all implementation phases
- **Phase 7 (Polish)**: Depends on Phase 6 completion

### Within Each Phase

- Tasks marked [P] can run in parallel
- Tasks without [P] have dependencies on previous tasks in same phase

### Execution Strategy

**One-shot approach** (as specified in clarifications):
1. Complete Phase 1 (Infrastructure)
2. Complete Phase 2 (US1) - Core functionality
3. Complete Phase 3-5 (US2-US4) - Remaining stories
4. Run Phase 6 (Testing) - Validate all at once
5. Complete Phase 7 (Polish)

---

## Implementation Strategy

### One-shot Refactoring

As specified in clarifications, this is a one-step replacement:

1. Create all new infrastructure files (Phase 1)
2. Implement all handlers with full functionality (Phase 2)
3. Modify PlayerInteraction and Game to use registry (Phase 2-5)
4. Remove old scattered code (Phase 5)
5. Run complete test suite (Phase 6)
6. Validate all success criteria (Phase 7)

### Success Criteria Verification

| Criteria | How to Verify |
|----------|---------------|
| SC-001 | Add test entity type, count modified files |
| SC-002 | Run save/load tests 10 times, check pass rate |
| SC-003 | Search codebase for turret/nest references in World/Chunk/Player/Worker |
| SC-004 | Measure placement operation time |
| SC-005 | Architecture review - verify single interface dependency |
| SC-006 | Time-box new entity type implementation |

---

## Notes

- Each task is specific and actionable
- File paths are absolute from repo root
- Tests are included for functional verification
- Performance tests ensure no regression
- All success criteria have verification steps
