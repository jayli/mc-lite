# Tasks: Codebase Refactoring

**Input**: Design documents from `/specs/012-codebase-refactor/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Manual functional testing is used for this refactor. No automated tests requested.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project structure per implementation plan (mkdir src/assets, src/entities/weapon)
- [x] T002 [P] Rename src/world/assets/mod/minugun.glb to src/world/assets/mod/minigun.glb
- [x] T003 [P] Move src/world/assets/ to src/assets/
- [x] T004 [P] Move src/core/materials/MaterialManager.js to src/core/MaterialManager.js and remove src/core/materials/
- [x] T005 [P] Move src/core/face-culling-utils.js to src/utils/FaceCullingUtils.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T006 Update asset paths in src/core/MaterialManager.js to point to new src/assets/ location
- [x] T007 Update asset paths and model loading in src/core/Engine.js to point to new src/assets/ location
- [x] T008 [P] Update imports in src/core/FaceCullingSystem.js to use src/utils/FaceCullingUtils.js
- [x] T009 [P] Update imports in src/world/Chunk.js or other world files referencing old asset paths
- [x] T010 Consolidate critical constants (waterLevel, fogColor, etc.) to the top of src/core/Engine.js with comments

**Checkpoint**: Foundation ready - asset locations and core utilities are updated and game should still load (though may have broken player logic if started mid-move).

---

## Phase 3: User Story 1 - Maintainer Refactoring Experience (Priority: P1) 🎯 MVP

**Goal**: Extract logic from Player.js into Gun.js and Physics.js to improve maintainability.

**Independent Test**: Game runs, player can move, collide, switch weapons, and shoot with correct visual/audio effects.

### Implementation for User Story 1

- [x] T011 [P] [US1] Create Gun class in src/entities/weapon/Gun.js with weapon configurations (fireRate, recoil, sounds, offsets)
- [x] T012 [US1] Implement shoot and update methods in src/entities/weapon/Gun.js migrating logic from Player.js
- [x] T013 [US1] Move tryStepUp, checkCeilingBump, applyTunnelCentering, and applyCameraBumper from src/entities/player/Player.js to src/entities/player/Physics.js
- [x] T014 [US1] Update Player.js to use the new Gun class instance and delegate weapon logic
- [x] T015 [US1] Update Player.js to call physics methods from the Physics class for collision/step-up logic
- [x] T016 [US1] Clean up unused variables and logic in src/entities/player/Player.js

**Checkpoint**: At this point, User Story 1 is complete. Core logic is abstracted and Player.js is simplified.

---

## Phase 4: User Story 2 - Consistent Naming and Location (Priority: P2)

**Goal**: Ensure all naming and locations follow the new PascalCase utility and root-level manager conventions.

**Independent Test**: No import errors in console and Face Culling / Material registration works as expected.

### Implementation for User Story 2

- [x] T017 [US2] Audit all files for any remaining references to face-culling-utils.js and update to FaceCullingUtils.js
- [x] T018 [US2] Update any external references to MaterialManager.js in src/core/Game.js or other entry points
- [x] T019 [US2] Update CLAUDE.md to reflect the new project structure and architectural changes

**Checkpoint**: All user stories should now be independently functional and documentation is current.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T020 Run quickstart.md validation to ensure no assets are missing (404 check)
- [x] T021 Verify Minigun rotation fix is preserved in the new Gun.js abstraction
- [x] T022 Final code cleanup (remove unused imports, fix indentation)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 - Fixes the broken references caused by moving files.
- **User Stories (Phase 3+)**: Depends on Phase 2 - Implements the actual logic refactoring.
- **Polish (Final Phase)**: Depends on all implementation tasks being complete.

### Parallel Opportunities

- T002, T003, T004, T005 (File moves) can run in parallel if carefully managed.
- T008 and T009 can run in parallel as they touch different parts of the system.
- T011 (Creating Gun.js) can start while T010 is being worked on.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (Crucial to keep the game loading)
3. Complete Phase 3: User Story 1 (The core logic refactor)
4. **STOP and VALIDATE**: Verify movement and shooting work perfectly.

### Incremental Delivery

1. Setup + Foundational -> Project structure cleaned.
2. User Story 1 -> Logic abstracted, Player.js slimmed down.
3. User Story 2 -> Naming consistency and documentation updated.
