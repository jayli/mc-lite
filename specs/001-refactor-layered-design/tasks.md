---
description: "Task list for Refactor Layered Design"
---

# Tasks: Refactor Layered Design

**Input**: Design documents from `/specs/001-refactor-layered-design/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project directory structure (src/core, src/world, src/entities, src/ui) per plan
- [x] T002 Create util module in src/utils/MathUtils.js
- [x] T003 Create entry point src/core/Game.js with barebones loop
- [x] T004 [P] Create initial src/core/Engine.js shell
- [x] T005 [P] Create initial src/world/World.js shell
- [x] T006 [P] Create initial src/ui/UIManager.js shell

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T007 Implement MathUtils logic (noise function extract) in src/utils/MathUtils.js
- [x] T008 Implement MaterialManager abstraction in src/core/materials/MaterialManager.js
- [x] T009 Register default materials in src/core/materials/MaterialManager.js
- [x] T010 Implement Engine (Three.js setup) in src/core/Engine.js
- [x] T011 Verify Engine renders blank scene in src/core/Engine.js

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Game Engine Initialization Refactor (Priority: P1) 🎯 MVP

**Goal**: Extract Three.js core logic into Engine module and Game coordinator

**Independent Test**: Load game, verify scene renders (sky/fog) and loop runs without errors.

### Implementation for User Story 1

- [x] T012 [US1] Complete Engine implementation (resize handler, render loop) in src/core/Engine.js
- [x] T013 [US1] Implement Game initialization logic in src/core/Game.js
- [x] T014 [US1] Refactor index.html to only import and start Game
- [x] T015 [US1] Verify scene rendering and loop execution

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - World Generation & Chunk System Refactor (Priority: P1)

**Goal**: Extract Chunk, TerrainGen, and World management

**Independent Test**: Walk around, verify chunks load/unload and terrain generates.

### Implementation for User Story 2

- [x] T016 [P] [US2] Implement TerrainGen (Noise/Biome logic) in src/world/TerrainGen.js
- [x] T017 [US2] Extract Physical Entity (Cloud) to src/world/entities/Cloud.js
- [x] T018 [P] [US2] Extract Physical Entity (Tree) to src/world/entities/Tree.js
- [x] T019 [P] [US2] Extract Physical Entity (Island) to src/world/entities/Island.js
- [x] T020 [US2] Implement Chunk class (using TerrainGen/Entities) in src/world/Chunk.js
- [x] T021 [US2] Implement World manager (Chunk lifecycle) in src/world/World.js
- [x] T022 [US2] Integrate World into Game loop in src/core/Game.js

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Player & Physics Refactor (Priority: P1)

**Goal**: Extract Player controls, physics and slots

**Independent Test**: Move (WASD/Space), collide with blocks.

### Implementation for User Story 3

- [x] T023 [P] [US3] Implement Physics logic (collision detection) in src/entities/player/Physics.js
- [x] T024 [P] [US3] Implement Slots/Inventory data structure in src/entities/player/Slots.js
- [x] T025 [US3] Implement Player controller (Input + Physics + Camera) in src/entities/player/Player.js
- [x] T026 [US3] Integrate Player into Game loop in src/core/Game.js

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - UI & Interaction Refactor (Priority: P1)

**Goal**: Extract HUD, Inventory UI, and Raycast interaction

**Independent Test**: Interact with blocks, toggle inventory, verify UI.

### Implementation for User Story 4

- [x] T027 [P] [US4] Implement HUD logic (Hotbar/Crosshair) in src/ui/HUD.js
- [x] T028 [P] [US4] Implement Inventory UI logic in src/ui/Inventory.js
- [x] T029 [US4] Implement UIManager (Coordinator) in src/ui/UIManager.js
- [x] T030 [US4] Implement Interaction logic (Raycasting) in src/entities/player/Player.js
- [x] T031 [US4] Connect UI events to Player/Inventory in src/core/Game.js

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T032 Remove old legacy code from index.html (Clean up)
- [x] T033 Verify global variable pollution is zero
- [x] T034 Run full regression test (Quickstart guide)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup
- **User Stories (Phase 3+)**: All depend on Foundational
- **Polish (Final Phase)**: Depends on all user stories

### User Story Dependencies

- **US1 (Engine)**: Independent (after Foundation)
- **US2 (World)**: Independent (after Foundation)
- **US3 (Player)**: Depends on World (for collision)
- **US4 (UI)**: Depends on Player (for inventory data)

### Parallel Opportunities

- Entities (Cloud, Tree, Island) can be implemented in parallel (T017, T018, T019)
- UI components (HUD, Inventory) can be implemented in parallel (T027, T028)
- Physics and Slots can be implemented in parallel (T023, T024)

---

## Implementation Strategy

### MVP First (User Story 1 & 2)

1. Setup & Foundation
2. US1: Get the render loop running
3. US2: Get the world generating
4. Verify: "Walking simulator" (rendering + world)

### Incremental Delivery

1. Add US3: Enable movement and physics
2. Add US4: Enable interaction and UI
3. Final Polish: Clean up

---
