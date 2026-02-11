---
description: "Task list for zombie enemy system implementation"
---

# Tasks: 丧尸敌人系统

**Input**: Design documents from `/specs/013-zombie-enemy/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: The examples below include test tasks. Tests are OPTIONAL - only include them if explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- **Web app**: `backend/src/`, `frontend/src/`
- **Mobile**: `api/src/`, `ios/src/` or `android/src/`
- Paths shown below assume single project - adjust based on plan.md structure

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create zombie enemy module structure
- [ ] T002 [P] Verify existing physics/collision system compatibility
- [ ] T003 [P] Set up zombie assets and materials in MaterialManager

---
## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create Zombie class skeleton in src/enemy/Zombie.js
- [ ] T005 Implement basic zombie geometry (1x1x2 block dimensions)
- [ ] T006 [P] Set up zombie material properties based on Minecraft style
- [ ] T007 Create zombie manager system for entity lifecycle
- [ ] T008 Implement zombie position and rotation update system
- [ ] T009 [P] Integrate zombie with existing render pipeline

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---
## Phase 3: User Story 1 - 丧尸生成与渲染 (Priority: P1) 🎯 MVP

**Goal**: 丧尸实体的视觉表示，符合我的世界原版角色风格
**Independent Test**: 在特定位置生成丧尸，并验证其外观、尺寸和渲染是否符合预期

### Tests for User Story 1 (OPTIONAL - only if tests requested) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T010 [P] [US1] Test zombie rendering with correct dimensions (1x1x2)
- [ ] T011 [P] [US1] Test zombie appearance matches Minecraft style

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create zombie mesh geometry with Minecraft-style proportions
- [ ] T013 [P] [US1] Implement zombie texture/material based on Minecraft zombie
- [ ] T014 [US1] Position zombie in world space at specified coordinates
- [ ] T015 [US1] Render zombie in the scene using Three.js
- [ ] T016 [US1] Verify zombie dimensions are exactly 1x1x2 blocks

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---
## Phase 4: User Story 2 - 丧尸AI与追踪 (Priority: P1)

**Goal**: 实现丧尸的基本AI逻辑，使其能够感知并追踪玩家
**Independent Test**: 将玩家放置在丧尸附近，验证丧尸是否会检测到玩家并开始移动追逐

### Tests for User Story 2 (OPTIONAL - only if tests requested) ⚠️

- [ ] T017 [P] [US2] Test zombie detects player within perception range
- [ ] T018 [P] [US2] Test zombie moves toward player position

### Implementation for User Story 2

- [ ] T019 [P] [US2] Implement player detection/perception system for zombie
- [ ] T020 [US2] Create zombie movement system with direction control
- [ ] T021 [US2] Implement pathfinding logic to move zombie toward player
- [ ] T022 [US2] Add zombie state management (idle, chasing)
- [ ] T023 [US2] Adjust zombie speed to be appropriate for gameplay
- [ ] T024 [US2] Handle zombie response when player leaves perception range

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---
## Phase 5: User Story 3 - 丧尸物理与碰撞 (Priority: P1)

**Goal**: 确保丧尸具有正确的物理特性，包括与世界的碰撞检测
**Independent Test**: 测试丧尸与各种方块类型的碰撞、上下台阶的能力以及无法跳跃的限制

### Tests for User Story 3 (OPTIONAL - only if tests requested) ⚠️

- [ ] T025 [P] [US3] Test zombie collides with solid blocks
- [ ] T026 [P] [US3] Test zombie can move up/down one block height
- [ ] T027 [P] [US3] Test zombie cannot jump over multiple blocks

### Implementation for User Story 3

- [ ] T028 [P] [US3] Integrate zombie with existing physics/collision system
- [ ] T029 [US3] Implement collision detection between zombie and world blocks
- [ ] T030 [US3] Allow zombie to climb/descend single block steps
- [ ] T031 [US3] Prevent zombie from jumping (disable vertical movement)
- [ ] T032 [US3] Implement zombie-player collision detection
- [ ] T033 [US3] Handle collision responses appropriately

**Checkpoint**: All user stories should now be independently functional

---
## Phase 6: User Story 4 - 丧尸战斗与消灭 (Priority: P2)

**Goal**: 实现丧尸的生命值系统和被枪械消灭的功能
**Independent Test**: 玩家使用枪械攻击丧尸直到其被消灭，验证整个战斗流程

### Tests for User Story 4 (OPTIONAL - only if tests requested) ⚠️

- [ ] T034 [P] [US4] Test zombie takes damage when shot by gun
- [ ] T035 [P] [US4] Test zombie is eliminated when health reaches zero

### Implementation for User Story 4

- [ ] T036 [P] [US4] Add health/life system to zombie
- [ ] T037 [US4] Implement damage response when zombie is hit by bullets
- [ ] T038 [US4] Create elimination/destruction logic for zombie
- [ ] T039 [US4] Handle zombie removal from world when defeated
- [ ] T040 [US4] Add visual/animation feedback for damage and elimination
- [ ] T041 [US4] Integrate with existing gun/bullet system for collision detection

**Checkpoint**: At this point, User Stories 1, 2, 3 AND 4 should all work independently

---
## Phase 7: User Story 5 - 丧尸生命周期管理 (Priority: P2)

**Goal**: 丧尸系统具备完整的生命周期管理，包括生成、更新和清理
**Independent Test**: 验证大量丧尸同时存在时的性能表现和内存管理

### Tests for User Story 5 (OPTIONAL - only if tests requested) ⚠️

- [ ] T042 [P] [US5] Test performance with multiple zombies active
- [ ] T043 [P] [US5] Test zombie cleanup when out of active area

### Implementation for User Story 5

- [ ] T044 [P] [US5] Implement zombie activation/deactivation based on distance
- [ ] T045 [US5] Create system for managing multiple zombie instances
- [ ] T046 [US5] Add performance optimizations for zombie updates
- [ ] T047 [US5] Implement zombie cleanup when exceeding limits
- [ ] T048 [US5] Optimize rendering for multiple zombie instances

**Checkpoint**: All user stories should now be independently functional

---
## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T049 [P] Documentation updates for zombie system
- [ ] T050 Code cleanup and refactoring
- [ ] T051 Performance optimization across all zombie behaviors
- [ ] T052 [P] Additional tests if needed
- [ ] T053 Security hardening (if applicable)
- [ ] T054 Run quickstart.md validation

---
## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 (requires zombie rendering)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on US1 (requires zombie existence)
- **User Story 4 (P4)**: Can start after Foundational (Phase 2) - Depends on US1, US3 (requires zombie existence and collision)
- **User Story 5 (P5)**: Can start after Foundational (Phase 2) - Can work in parallel with other stories

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---
## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---
## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence