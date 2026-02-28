# Tasks: Frozen Mountain Custom Map

**Input**: Design documents from `/specs/017-frozen-mountain/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Not explicitly requested, using manual in-game verification per existing pattern

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Single project: `src/` at repository root
- Custom maps: `src/workers/maps/`
- Integration: `src/workers/WorldWorker.js`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create new FrozenMountain.js file following existing API pattern

- [x] T001 [P] Create FrozenMountain.js skeleton in src/workers/maps/FrozenMountain.js
- [x] T002 [P] Add getFrozenMountainInfo function skeleton in src/workers/maps/FrozenMountain.js
- [x] T003 [P] Add generateFrozenMountain function skeleton in src/workers/maps/FrozenMountain.js
- [x] T004 [P] Add module export object in src/workers/maps/FrozenMountain.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Mountain placement and shape generation - MUST complete before ANY user story implementation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Implement mountain region placement logic (-160 X offset from Pyramid) in src/workers/maps/FrozenMountain.js
- [x] T006 Implement conical mountain shape generation in src/workers/maps/FrozenMountain.js
- [x] T007 Implement core/transition zone logic in src/workers/maps/FrozenMountain.js
- [x] T008 Add FrozenMountain import in src/workers/WorldWorker.js
- [x] T009 Add FrozenMountain info check in src/workers/WorldWorker.js terrain generation loop

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Tall Frozen Peak (Priority: P1 🎯 MVP)

**Goal**: Implement the tall frozen peak with layered block composition (snow_grass → dirt → stone)

**Independent Test**: Travel to the frozen mountain region. Verify that a tall, elevated peak structure exists with snow_grass on top. Digging reveals 2-3 dirt layers then stone.

### Implementation for User Story 1

- [x] T010 [US1] Implement snow_grass top layer generation in src/workers/maps/FrozenMountain.js
- [x] T011 [US1] Implement dirt layer generation (2-3 layers, randomized) in src/workers/maps/FrozenMountain.js
- [x] T012 [US1] Implement stone main body generation in src/workers/maps/FrozenMountain.js
- [x] T013 [US1] Implement end_stone foundation layers in src/workers/maps/FrozenMountain.js
- [x] T014 [US1] Add terrain blending in transition zone in src/workers/maps/FrozenMountain.js
- [x] T015 [US1] Integrate generate() function call in src/workers/WorldWorker.js

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Mysterious Mountain Caves (Priority: P1)

**Goal**: Add large, continuous cave systems inside the frozen mountain interior

**Independent Test**: Enter the frozen mountain (either by digging or finding a natural entrance). Verify that large, continuous cave spaces exist inside.

### Implementation for User Story 2

- [x] T016 [US2] Add mountain cave room generation in src/workers/maps/FrozenMountain.js
- [x] T017 [US2] Add cave room bounds checking (only inside mountain volume) in src/workers/maps/FrozenMountain.js
- [x] T018 [US2] Add bottom 2 layers protection (no caves) in src/workers/maps/FrozenMountain.js
- [x] T019 [US2] Integrate cave air block generation in src/workers/WorldWorker.js

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Proximity to Snow Land (Priority: P2)

**Goal**: Ensure mountain is larger than Pyramid and properly positioned near snow_land

**Independent Test**: Locate a snow_land region. Verify that a frozen mountain exists nearby and is visibly larger than Pyramid.

### Implementation for User Story 3

- [x] T020 [US3] Verify mountain size (60x60 blocks) in src/workers/maps/FrozenMountain.js
- [x] T021 [US3] Verify placement relative to snow_land in src/workers/maps/FrozenMountain.js
- [x] T022 [US3] Verify integration priority in src/workers/WorldWorker.js

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final integration and verification

- [ ] T023 [P] Run quickstart.md verification checklist
- [ ] T024 Verify FPS performance near frozen mountain region
- [ ] T025 Verify no overlap with Pyramid or SnowLand
- [ ] T026 Verify transition zone blending works correctly

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
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Models before services
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: Setup Phase

```bash
# Launch all Setup tasks together:
Task: "Create FrozenMountain.js skeleton in src/workers/maps/FrozenMountain.js"
Task: "Add getFrozenMountainInfo function skeleton in src/workers/maps/FrozenMountain.js"
Task: "Add generateFrozenMountain function skeleton in src/workers/maps/FrozenMountain.js"
Task: "Add module export object in src/workers/maps/FrozenMountain.js"
```

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

## Task Summary

| Category | Count |
|----------|-------|
| **Total Tasks** | 26 |
| User Story 1 Tasks | 6 |
| User Story 2 Tasks | 4 |
| User Story 3 Tasks | 3 |
| Setup Tasks | 4 |
| Foundational Tasks | 5 |
| Polish Tasks | 4 |
| **MVP Tasks (US1 only)** | 15 |
| **Completed** | 22 |
| **Remaining** | 4 |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
