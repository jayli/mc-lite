# Tasks: Block-based Land Caves & Bedrock

**Input**: Design documents from `/specs/003-land-caves/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: US1, US2
- Include exact file paths

## Phase 1: Setup

- [x] T001 Verify branch `003-land-caves` and workspace consistency
- [x] T002 Identify terrestrial generation loop in `src/world/WorldWorker.js`

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T003 Define `ROOMS_PER_CHUNK` and `MAX_ROOM_SIZE` constants in `src/world/WorldWorker.js`
- [x] T004 Implement random room seed generation logic in `src/world/WorldWorker.js`

## Phase 3: User Story 1 - Large Scale Caves (Priority: P1) 🎯 MVP

**Goal**: Implement rectangular contiguous hollows.

**Independent Test**: Dig underground; empty spaces should appear as boxy rooms.

### Implementation for User Story 1

- [x] T005 [P] [US1] Implement AABB intersection helper function in `src/world/WorldWorker.js`
- [x] T006 [US1] Integrate AABB check into terrestrial generation loop (Layer 2-10) in `src/world/WorldWorker.js`
- [x] T007 [US1] Remove previous sparse 1D random hollow logic in `src/world/WorldWorker.js`

**Checkpoint**: Contiguous caves are now functional.

## Phase 4: User Story 2 - Solid Foundation (Priority: P2)

**Goal**: Reinforce bedrock and prevent mining.

**Independent Test**: Dig to absolute bottom; Layer 11 must be solid, Layer 12 must be end_stone and unbreakable.

### Implementation for User Story 2

- [x] T008 [US2] Hardcode Layer 11 (`k=11`) to strictly solid in `src/world/WorldWorker.js`
- [x] T009 [US2] Hardcode Layer 12 (`k=12`) to strictly `end_stone` in `src/world/WorldWorker.js`
- [x] T010 [US2] Verify mining interception for `end_stone` in `src/entities/player/Player.js`

**Checkpoint**: Solid foundation and indestructible bedrock are functional.

## Phase 5: Polish & Validation

- [x] T011 Perform voxel count analysis to confirm reduction targets
- [x] T012 Run `quickstart.md` validation steps
