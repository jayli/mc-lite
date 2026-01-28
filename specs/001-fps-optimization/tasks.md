# Tasks: FPS Optimization through Voxel Reduction

**Input**: Design documents from `/specs/001-fps-optimization/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Verify existing branch `001-fps-optimization` and workspace state
- [x] T002 Review `src/world/assets/textures/End_Stone.png` and ensure it is available for use

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T003 Ensure `end_stone` material is correctly registered in `src/core/materials/MaterialManager.js`
- [x] T004 [P] Identify the sea level constant (`wLvl`) in `src/world/WorldWorker.js`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Smooth Gameplay (Priority: P1) 🎯 MVP

**Goal**: Achieve at least 60 FPS by reducing the total number of blocks rendered.

**Independent Test**: Monitor the FPS counter in the HUD in a Forest or Ocean biome. It should stay above 60.

### Implementation for User Story 1

- [x] T005 [P] [US1] Implement local occupancy mapping in `Tree.generate` within `src/world/entities/Tree.js`
- [x] T006 [US1] Implement 6-direction neighbor visibility check for leaf pruning in `src/world/entities/Tree.js`
- [x] T007 [P] [US1] Implement seabed depth capping (max 2 layers) in `src/world/WorldWorker.js`
- [x] T008 [P] [US1] 实现基于噪声的连续地底空洞（矿洞）逻辑，提高单片矿洞面积

**Checkpoint**: At this point, the game should show a significant FPS improvement due to voxel count reduction.

---

## Phase 4: User Story 2 - Visual Integrity (Priority: P2)

**Goal**: Ensure optimizations are invisible to the player from the surface.

**Independent Test**: Fly through tree canopies and dive into the ocean to verify no "see-through" holes or missing textures are visible.

### Implementation for User Story 2

- [x] T009 [US2] Refine leaf pruning logic in `src/world/entities/Tree.js` to ensure "edge" leaves are never pruned (contacting `air`)
- [x] T010 [US2] Verify that hollows in `src/world/WorldWorker.js` only start at `y < h - 1` to prevent surface holes

**Checkpoint**: At this point, the world should look identical to the baseline despite the internal optimizations.

---

## Phase 5: User Story 3 - Mining Restrictions (Priority: P3)

**Goal**: Prevent players from falling through the world by making the optimized foundation indestructible.

**Independent Test**: Attempt to mine `end_stone` blocks underwater; they should not break.

### Implementation for User Story 3

- [x] T011 [US3] Add `end_stone` type check to `Player.removeBlock` in `src/entities/player/Player.js` to prevent mining
- [x] T012 [US3] Ensure `end_stone` blocks do not drop any items when "mining" is attempted

**Checkpoint**: All user stories should now be independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T013 Code cleanup and removal of any debug logs used during optimization
- [x] T014 [P] Verify performance across all biomes (Desert, Swamp, Plains)
- [x] T015 Run `quickstart.md` validation to confirm all success criteria are met

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (P1) is the MVP and should be completed first.
  - User Story 2 and 3 can technically be done in parallel once Story 1 foundations are in.

### Parallel Opportunities

- T003 and T004 can be done in parallel.
- T005, T007, and T008 can be started in parallel as they touch different files/logic blocks.
- T011 and T014 can be run in parallel.

---

## Parallel Example: User Story 1

```bash
# Implement the three main optimization branches in parallel:
Task: "Implement leaf pruning in src/world/entities/Tree.js"
Task: "Implement seabed capping in src/world/WorldWorker.js"
Task: "Implement inland hollows in src/world/WorldWorker.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & 2.
2. Complete Step 1 (Pruning), Step 2 (Seabed), and Step 3 (Hollows) from US1.
3. **STOP and VALIDATE**: Verify FPS increase.

### Incremental Delivery

1. Foundation ready.
2. Add US1 (FPS Boost).
3. Add US2 (Visual Polish).
4. Add US3 (Safety/Mining).
