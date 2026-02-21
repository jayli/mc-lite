# Tasks: Block Orientation System

**Input**: Design documents from `/specs/001-block-orientation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: 未明确要求测试，本任务列表不包含测试任务。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` at repository root
- Paths shown assume single project structure as defined in plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 创建朝向工具模块，定义基础枚举和函数

- [x] T001 Create OrientationUtils.js module with BlockOrientation enum in src/utils/OrientationUtils.js
- [x] T002 [P] Add getRotationAngle(orientation) function in src/utils/OrientationUtils.js
- [x] T003 [P] Add nextOrientation(current) function in src/utils/OrientationUtils.js
- [x] T004 [P] Add parseBlockEntry(value) function in src/utils/OrientationUtils.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 核心基础设施，必须在所有用户故事之前完成

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Extend blockData storage format to support { type, orientation } in src/world/Chunk.js
- [x] T006 Update buildMeshes() to apply Y-axis rotation based on orientation in src/world/Chunk.js
- [x] T007 Import and integrate OrientationUtils in src/world/Chunk.js

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 方块朝向记忆与旋转放置 (Priority: P1) 🎯 MVP

**Goal**: 玩家移除方块后再次放置，朝向顺时针旋转90度

**Independent Test**: 移除一个栏杆方块并再次放置，观察新方块的朝向

### Implementation for User Story 1

- [x] T008 [US1] Add placementMemory Map property to Player class in src/entities/player/Player.js
- [x] T009 [US1] Implement recordPlacementMemory(type, orientation) method in src/entities/player/Player.js
- [x] T010 [US1] Implement getNextPlacementOrientation(type) method in src/entities/player/Player.js
- [x] T011 [US1] Modify removeBlock() to capture and record orientation before removal in src/entities/player/Player.js
- [x] T012 [US1] Modify tryPlaceBlock() to use getNextPlacementOrientation() in src/entities/player/Player.js
- [x] T013 [US1] Extend setBlock(x, y, z, type, orientation) signature in src/world/World.js
- [x] T014 [US1] Extend addBlockDynamic(x, y, z, type, orientation) signature in src/world/Chunk.js
- [x] T015 [US1] Add getBlockOrientation(x, y, z) method to Chunk class in src/world/Chunk.js

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 方块朝向持久化存储 (Priority: P2)

**Goal**: 方块朝向信息正确保存到存档，重新加载后保持一致

**Independent Test**: 放置一个有朝向的方块，保存游戏，重新加载，验证方块朝向是否正确还原

### Implementation for User Story 2

- [x] T016 [US2] Extend recordChange() to support { type, orientation } format in src/services/PersistenceService.js
- [x] T017 [US2] Update saveChunkData() to preserve orientation in stored format in src/services/PersistenceService.js
- [x] T018 [US2] Ensure Chunk.gen() loads orientation from snapshot data in src/world/Chunk.js
- [x] T019 [US2] Update consolidate() to pass orientation in snapshot to Worker in src/world/Chunk.js
- [x] T020 [US2] Update WorldWorker to handle { type, orientation } format in snapshot.blocks in src/workers/WorldWorker.js
- [x] T021 [US2] Ensure allBlockTypes output includes orientation from Worker in src/workers/WorldWorker.js

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 旧存档兼容 (Priority: P2)

**Goal**: 正确加载旧版本存档（字符串格式），赋予默认朝向

**Independent Test**: 加载一个旧版本存档，验证所有方块能正确显示且默认朝东

### Implementation for User Story 3

- [x] T022 [US3] Add backward compatibility check in parseBlockEntry() for string format in src/utils/OrientationUtils.js
- [x] T023 [US3] Update PersistenceService.getChunkData() to normalize old format blocks in src/services/PersistenceService.js
- [x] T024 [US3] Update WorldWorker to parse string values as { type, orientation: 0 } in src/workers/WorldWorker.js
- [x] T025 [US3] Ensure saved data uses new format { type, orientation } in src/services/PersistenceService.js

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently

---

## Phase 6: User Story 4 - 性能不受影响 (Priority: P3)

**Goal**: 新增朝向功能不影响渲染性能、Face Culling、InstancedMesh合并

**Independent Test**: 在放置大量有朝向的方块后，使用性能监控工具（按 P 键）对比帧率

### Implementation for User Story 4

- [x] T026 [US4] Verify rotation uses existing dummy object (no new allocations) in src/world/Chunk.js
- [x] T027 [US4] Verify Face Culling system ignores orientation (no changes needed) in src/core/FaceCullingSystem.js
- [x] T028 [US4] Test consolidation with oriented blocks in src/world/Chunk.js
- [x] T029 [US4] Add performance validation comment in buildMeshes() in src/world/Chunk.js

**Checkpoint**: All user stories should now be independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T030 [P] Add JSDoc comments to all new methods in src/utils/OrientationUtils.js
- [x] T031 [P] Add JSDoc comments to extended methods in src/world/Chunk.js
- [x] T032 [P] Add JSDoc comments to extended methods in src/world/World.js
- [x] T033 [P] Add JSDoc comments to extended methods in src/entities/player/Player.js
- [x] T034 Run quickstart.md validation to verify all scenarios work

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - US1 (P1) can start immediately after Foundational
  - US2 (P2) depends on US1 for blockData format extension
  - US3 (P2) can run in parallel with US2 after US1
  - US4 (P3) depends on US1, US2, US3 completion for validation
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on US1 for blockData format extension
- **User Story 3 (P2)**: Can start after US1, parallel with US2
- **User Story 4 (P3)**: Depends on US1, US2, US3 for validation

### Within Each User Story

- Models/Utilities before services
- Services before endpoints/integration
- Core implementation before validation

### Parallel Opportunities

- T002, T003, T004 can run in parallel (different functions in same file)
- T030, T031, T032, T033 can run in parallel (different files)
- US2 and US3 can run in parallel after US1 completion

---

## Parallel Example: Setup Phase

```bash
# Launch all utility functions together:
Task: "Add getRotationAngle(orientation) function in src/utils/OrientationUtils.js"
Task: "Add nextOrientation(current) function in src/utils/OrientationUtils.js"
Task: "Add parseBlockEntry(value) function in src/utils/OrientationUtils.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
   - 移除一个栏杆方块
   - 再次放置该类型方块
   - 验证朝向顺时针旋转90度
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Add User Story 4 → Validate performance → Deploy/Demo
6. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
