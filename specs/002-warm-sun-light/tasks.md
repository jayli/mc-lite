# Tasks: Warm Sun Light

**Input**: Design documents from `/specs/002-warm-sun-light/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Define constant direction and colors for the sun in src/core/Engine.js
- [x] T002 Update existing light configuration in src/core/Engine.js to use warm colors

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T003 Implement sun texture generation logic using Canvas in src/core/Engine.js

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Visible Warm Sun (Priority: P1) 🎯 MVP

**Goal**: Render a visual sun object in the sky that stays at a fixed angular position relative to the player.

**Independent Test**: Look up in the sky to see a soft, warm sun sprite that doesn't get closer as you walk towards it.

### Implementation for User Story 1

- [x] T004 [P] [US1] Create the sun sprite and add it to the scene in src/core/Engine.js
- [x] T005 [US1] Implement sun position update logic in src/core/Game.js (relative to player position)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Consistent Directional Lighting (Priority: P2)

**Goal**: Synchronize the world's directional light with the sun's position for consistent illumination.

**Independent Test**: Place a block and verify that the bright face points directly towards the visible sun.

### Implementation for User Story 2

- [x] T006 [US2] Update directional light target and position logic in src/core/Game.js to align with sun direction
- [x] T007 [P] [US2] Adjust light intensity and shadow parameters in src/core/Engine.js for stable outdoor illumination

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T008 [P] Documentation updates in CLAUDE.md and README.md regarding new lighting system
- [x] T009 Code cleanup and refactoring in src/core/Engine.js
- [x] T010 Run quickstart.md validation to ensure sun and light are perfectly aligned

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1's sun direction for visual alignment

### Implementation Strategy

#### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

#### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently → Complete Feature
