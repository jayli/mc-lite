# Tasks: Chunk Optimization (Background Consolidation)

**Input**: Design documents from `/specs/007-chunk-optimization/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Define threshold constants (DIRTY_THRESHOLD = 50, CONSOLIDATION_DELAY = 1000) in src/world/Chunk.js

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T002 Add tracking properties (`dirtyBlocks`, `consolidationTimer`, `isConsolidating`, `dynamicMeshes`) to the `Chunk` class constructor in src/world/Chunk.js
- [x] T003 Implement `scheduleConsolidation()` method in src/world/Chunk.js to handle debounce and threshold logic
- [x] T004 [P] Update `WorldWorker.js` to handle snapshot-based full rebuilding without side effects in src/world/WorldWorker.js
- [x] T005 Update `Chunk.gen()` callback to ensure it can be reused for background consolidation in src/world/Chunk.js

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Smooth Block Interaction (Priority: P1) 🎯 MVP

**Goal**: Ensure blocks are placed/broken instantly with a Mesh, and then consolidated into InstancedMesh after 1 second of inactivity.

**Independent Test**: Place a block, verify it appears as a Mesh. Wait 1 second, verify it is merged into InstancedMesh (using browser console to check child count if needed).

### Implementation for User Story 1

- [x] T006 Update `Chunk.addBlockDynamic()` to increment `dirtyBlocks` and track individual Meshes in `this.dynamicMeshes` in src/world/Chunk.js
- [x] T007 [P] Update `Chunk.addBlockDynamic()` to call `this.scheduleConsolidation()` in src/world/Chunk.js
- [x] T008 Implement `Chunk.consolidate()` to send the current `blockData` snapshot to the worker in src/world/Chunk.js
- [x] T009 Update the worker message handler in `Chunk.js` to perform the "Swap" logic: dispose old dynamic meshes and rebuild InstancedMesh in src/world/Chunk.js
- [x] T010 [P] Ensure `Chunk.removeBlock()` also triggers `scheduleConsolidation()` to clean up gaps and update face culling in src/world/Chunk.js

**Checkpoint**: At this point, the core background consolidation loop is functional.

---

## Phase 4: User Story 2 - Performance Stability (Priority: P2)

**Goal**: Ensure high-volume interactions (50+ blocks) trigger immediate optimization to prevent FPS drops.

**Independent Test**: Use a loop or rapid clicking to place 55 blocks. Verify that consolidation triggers before the 1-second timeout once the 50th block is reached.

### Implementation for User Story 2

- [x] T011 Verify threshold logic in `scheduleConsolidation()` correctly ignores the timer and calls `consolidate()` immediately when `dirtyBlocks >= 50` in src/world/Chunk.js
- [x] T012 [P] Implement `isConsolidating` guard to prevent multiple concurrent worker requests for the same chunk in src/world/Chunk.js
- [x] T013 Ensure `Chunk.dispose()` clears any pending `consolidationTimer` to prevent memory leaks or errors on unloaded chunks in src/world/Chunk.js

**Checkpoint**: The system is now robust against rapid high-volume modifications.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T014 Performance audit: Verify Draw Calls drop significantly after consolidation in a modified chunk.
- [x] T015 Visual audit: Ensure no "flickering" (blocks disappearing) occurs during the Mesh-to-InstancedMesh swap.
- [x] T016 [P] Update internal documentation/comments in `Chunk.js` to explain the consolidation lifecycle.
- [x] T017 Run quickstart.md validation to confirm all user scenarios pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup.
- **User Stories (Phase 3+)**: Depend on Foundational (T002-T005).
- **Polish (Final Phase)**: Depends on all user stories.

### User Story Dependencies

- **User Story 1 (P1)**: The MVP.
- **User Story 2 (P2)**: Extends US1 with threshold logic and concurrency guards.

### Parallel Opportunities

- T004 (Worker update) can be done in parallel with T002/T003.
- T012 (Guard logic) can be developed alongside US1 tasks.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational tasks.
2. Implement the basic `scheduleConsolidation` and `consolidate` flow in `Chunk.js`.
3. Verify basic "place -> wait 1s -> merged" behavior.

### Incremental Delivery

1. **Foundation**: Properties and worker communication ready.
2. **US1**: Basic time-based consolidation (Solves FPS drop for occasional building).
3. **US2**: Threshold-based consolidation (Solves FPS drop for massive building/explosions).
4. **Polish**: Final performance and visual verification.
