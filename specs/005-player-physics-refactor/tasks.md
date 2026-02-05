# Tasks: Player Physics and Collision Refactor

**Input**: Design documents from `/specs/005-player-physics-refactor/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Define core constants (GRAVITY, MAX_STEP, etc.) in src/entities/player/Physics.js
- [X] T002 Initialize PlayerState and CameraState trackers in src/entities/player/Player.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T003 Implement multi-point sampling helper in src/entities/player/Physics.js
- [X] T004 Update Physics.isSolid to explicitly include 'leaves', 'glass_block', and 'collider' in src/entities/player/Physics.js

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Robust Movement and Collision (Priority: P1) 🎯 MVP

**Goal**: Implement Swept AABB/Multi-point collision with sliding response for all solid blocks.

**Independent Test**: Walk into stone, glass, and leaves at various angles; player should slide smoothly without jitter or clipping.

### Implementation for User Story 1

- [X] T005 [US1] Implement velocity-based integration for horizontal movement in src/entities/player/Player.js
- [X] T006 [US1] Implement sliding collision response (friction applied) in src/entities/player/Physics.js
- [X] T007 [US1] Implement diagonal convex corner sliding with 0.7 speed penalty in src/entities/player/Physics.js
- [X] T008 [US1] Implement 1x1 tunnel auto-centering logic in src/entities/player/Player.js

**Checkpoint**: User Story 1 (Core Movement) is functional.

---

## Phase 4: User Story 2 - Smooth Vertical Navigation (Priority: P2)

**Goal**: Implement 1-block auto-step and 2-block jump-step.

**Independent Test**: Walk forward onto 1-block ledge (step up) and 1-block drop (step down) without jumping. Jump onto 2-block ledge to clear it.

### Implementation for User Story 2

- [X] T009 [US2] Implement predictive 1-block step-up logic in src/entities/player/Player.js
- [X] T010 [US2] Implement jump-aware 2-block step-up logic in src/entities/player/Player.js
- [X] T011 [US2] Implement smooth Y-axis interpolation for stepping in src/entities/player/Player.js
- [X] T012 [US2] Implement ceiling "bump" detection to truncate jump velocity in src/entities/player/Player.js

**Checkpoint**: Vertical navigation is fluid.

---

## Phase 5: User Story 3 - Immersive Visuals and Camera Behavior (Priority: P3)

**Goal**: Implement procedural bobbing and yaw-aware camera bumper.

**Independent Test**: Stand flush against wall and rotate 360; camera should not clip. Run in open area to see bobbing.

### Implementation for User Story 3

- [X] T013 [US3] Implement 3-point head-level collision check (Center/Left/Right) in src/entities/player/Player.js
- [X] T014 [US3] Implement camera-width aware push-back logic in src/entities/player/Player.js
- [X] T015 [US3] Refactor updateCameraBob to use state-based intensity (Running vs Colliding) in src/entities/player/Player.js

---

## Phase 6: User Story 4 - Special Entity Interactivity (Priority: P4)

**Goal**: Ensure complex models (Rover, Trees) have physical presence.

**Independent Test**: Walk into a Rover or RealisticTree; movement should be blocked by their collider blocks.

### Implementation for User Story 4

- [X] T016 [US4] Verify 'collider' block type is correctly registered in src/core/materials/MaterialManager.js
- [X] T017 [US4] Ensure Physics.isSolid correctly queries the World for entity-placed colliders in src/entities/player/Physics.js

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Safety recovery and frame-rate independence.

- [X] T018 Implement "Push-out" recovery logic for deep clipping in src/entities/player/Physics.js
- [X] T019 [P] Update physics update to use delta time (dt) for frame-rate independence in src/entities/player/Player.js
- [X] T020 Final code cleanup and removal of deprecated collision methods in src/entities/player/Player.js

---

## Dependencies & Execution Order

1. **Phase 1 & 2** (T001-T004) MUST be completed first.
2. **User Story 1** (T005-T008) is the MVP and should be completed before others.
3. **User Story 2 & 3** can be implemented in parallel if needed, as they affect different logic blocks within Player.js.

## Parallel Example: User Story 3
```bash
# T013 and T014 are closely coupled, but T015 (Bobbing) is independent
Task: "Refactor updateCameraBob to use state-based intensity in src/entities/player/Player.js"
```

## Implementation Strategy
### MVP First (User Story 1 Only)
1. Complete Setup + Foundational.
2. Complete User Story 1 (Horizontal movement & sliding).
3. Validate sliding against walls and corners.
