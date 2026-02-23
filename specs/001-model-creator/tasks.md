# Tasks: 模型创造台 (Model Creator)

**Input**: Design documents from `/specs/001-model-creator/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not included - manual testing per project convention (访问 localhost:8080/src/tests/index.html)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths shown below assume single project structure

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and structure verification

- [x] T001 Verify project structure - src/ directory exists with core/, constants/, services/, ui/, world/ subdirectories

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Add playground_block definition in src/constants/BlockData.js
- [x] T003 [P] Register playground_block material in src/core/MaterialManager.js
- [x] T004 Create PlaygroundService.js in src/services/ directory

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - 打开创造台 (Priority: P1) 🎯 MVP

**Goal**: 在玩家正前方生成 40x40 的灰色创造台平台，按钮创建后置灰

**Independent Test**: 点击"打开创造台"按钮后，生成 40x40 灰色平台，按钮变为不可点击

### Implementation for User Story 1

- [x] T005 [P] [US1] Create PlaygroundService class with singleton pattern in src/services/PlaygroundService.js
- [x] T006 [P] [US1] Add isPlaygroundActive flag and origin tracking in PlaygroundService.js
- [x] T007 [US1] Implement createPlayground(playerPos) method - generate 40x40 platform in src/services/PlaygroundService.js
- [x] T008 [US1] Add space validation logic - check 40x40 area is flat in src/services/PlaygroundService.js
- [x] T009 [US1] Set playground_block as indestructible using isIndestructible property in src/services/PlaygroundService.js
- [x] T010 [US1] Add HTML buttons (btn-create-playground, btn-export-model) in index.html
- [x] T011 [US1] Wire up "打开创造台" button in src/ui/UIManager.js initSettings()
- [x] T012 [US1] Implement button disable logic after playground creation in src/ui/UIManager.js

**Checkpoint**: User Story 1 complete - can independently create playground

---

## Phase 4: User Story 2 - 在创造台上创建模型 (Priority: P2)

**Goal**: 玩家可以在创造台上自由放置各种方块

**Independent Test**: 在已生成的创造台上放置方块，方块正确显示在指定位置

### Implementation for User Story 2

- [x] T013 [P] [US2] Add playground_block collision exclusion logic in src/world/Chunk.js removeBlock()
- [x] T014 [P] [US2] Add indestructible check in World.explode() for TNT protection in src/workers/ExplosionWorker.js
- [x] T015 [US2] Add indestructible check in src/entities/player/Player.js for gun protection
- [x] T016 [US2] Add indestructible check in Chunk.removeBlock() for player mining protection in src/world/Chunk.js
- [x] T017 [US2] Allow player to place blocks on playground using existing World.setBlock() API (already functional)

**Checkpoint**: User Story 2 complete - can build models on playground

---

## Phase 5: User Story 3 - 导出模型为 JSON 文件 (Priority: P3)

**Goal**: 将创造台上非 playground_block 的方块导出为 model.json 文件

**Independent Test**: 点击"导出模型"按钮，下载包含正确数据的 model.json 文件

### Implementation for User Story 3

- [x] T018 [P] [US3] Add parseBlockEntry import from src/utils/OrientationUtils.js in PlaygroundService.js
- [x] T019 [P] [US3] Implement getModelBlocks() method in src/services/PlaygroundService.js
- [x] T020 [US3] Implement coordinate conversion (world to relative) in src/services/PlaygroundService.js
- [x] T021 [US3] Filter out playground_block from export in src/services/PlaygroundService.js
- [x] T022 [US3] Map orientation 0-3 to Minecraft direction 0-5 in src/services/PlaygroundService.js
- [x] T023 [US3] Implement exportModel() method with Blob download in src/services/PlaygroundService.js
- [x] T024 [US3] Wire up "导出模型" button in src/ui/UIManager.js initSettings()
- [x] T025 [US3] Handle empty model case - export empty blocks array in src/services/PlaygroundService.js

**Checkpoint**: User Story 3 complete - can export model JSON

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements and validation

- [x] T026 [P] Add error handling for space validation failures in PlaygroundService.js
- [x] T027 Add playground_center_block as center marker in src/constants/BlockData.js, src/core/MaterialManager.js, src/services/PlaygroundService.js
- [x] T028 [P] Code cleanup and refactoring
- [ ] T027 [P] Add user feedback messages via HUD in src/ui/UIManager.js
- [ ] T028 [P] Code cleanup and refactoring
- [ ] T029 Update CLAUDE.md if new patterns introduced
- [ ] T030 Manual validation - follow quickstart.md test scenarios
- [ ] T031 [P] Add JSDoc comments to PlaygroundService.js

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: BLOCKS all user stories - must complete T002-T004 first
- **User Story 1 (Phase 3)**: Depends on Phase 2 complete - MVP scope
- **User Story 2 (Phase 4)**: Depends on Phase 2 complete - May integrate with US1
- **User Story 3 (Phase 5)**: Depends on Phase 2 complete - Requires playground and block placement
- **Polish (Phase 6)**: Depends on all user stories complete

### User Story Dependencies

| Story | Depends On | Independent Test |
|-------|------------|------------------|
| US1 (P1) | Phase 2 | 点击按钮生成 40x40 平台 |
| US2 (P2) | Phase 2 | 在平台上放置方块 |
| US3 (P3) | Phase 2 | 导出 JSON 文件 |

### Within Each User Story

- Models/foundational code first
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

| Tasks | Parallel |
|-------|----------|
| T002 + T003 + T004 | Yes - different files |
| T005 + T006 | Yes - same file but independent setup |
| T014 + T015 + T016 | Yes - different files (indestructible logic) |
| T018 + T019 | Yes - different concerns |
| T026 + T027 + T028 | Yes - polish tasks |

---

## Parallel Example: User Story 3

```bash
# Launch data collection and export logic in parallel:
Task: "Add parseBlockEntry import in PlaygroundService.js" (T018)
Task: "Implement getModelBlocks() method" (T019)

# Sequential tasks within US3:
T018 → T019 → T020 → T021 → T022 → T023 → T024
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (T002-T004)
3. Complete Phase 3: User Story 1 (T005-T012)
4. **STOP and VALIDATE**: Test playground creation manually
5. Verify: 40x40 platform appears, button grays out

### Incremental Delivery

1. Complete Phase 2 → Foundation ready (playground_block defined)
2. Add User Story 1 → Test: Create playground works
3. Add User Story 2 → Test: Place blocks on playground
4. Add User Story 3 → Test: Export JSON downloads correctly
5. Each phase adds value independently

### Parallel Team Strategy

With multiple developers:

1. Developer completes Phase 2 together
2. Once foundational done:
   - Developer A: User Story 1 (playground creation)
   - Developer B: User Story 2 (indestructible logic)
   - Developer C: User Story 3 (export logic)
3. Stories complete and integrate independently

---

## Task Summary

| Phase | Task Count | Description |
|-------|------------|-------------|
| Phase 1 | 1 | Setup verification |
| Phase 2 | 3 | Foundational (blocking) |
| Phase 3 | 8 | User Story 1 - MVP |
| Phase 4 | 5 | User Story 2 |
| Phase 5 | 8 | User Story 3 |
| Phase 6 | 6 | Polish |
| **Total** | **31** | All tasks |

### Tasks per User Story

- **US1 (P1)**: 8 tasks (T005-T012) - Create playground
- **US2 (P2)**: 5 tasks (T013-T017) - Build models
- **US3 (P3)**: 8 tasks (T018-T025) - Export JSON

### Suggested MVP Scope

**Minimum**: Phase 1 + Phase 2 + Phase 3 (User Story 1)
- Total: 12 tasks (T001-T012)
- Delivers: Create 40x40 playground platform

**Full Feature**: All phases (T001-T031)
- Delivers: Complete model creation and export system
