# Tasks: Minigun Weapon

**Input**: Design documents from `/specs/011-minigun-weapon/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Initialize Minigun weapon configuration in src/entities/player/Player.js
- [x] T002 Define WEAPON_MINIGUN constant and update weapon count in src/entities/player/Player.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T003 Export minigunModel variable in src/core/Engine.js
- [x] T004 Implement GLTFLoader logic to load src/world/assets/mod/minugun.glb in src/core/Engine.js
- [x] T005 Add minigun_fire and gun_load (if missing) to sound preload list in src/core/AudioManager.js

**Checkpoint**: Foundation ready - weapon model and audio are loaded and accessible.

---

## Phase 3: User Story 1 - 武器切换与模型显示 (Priority: P1) 🎯 MVP

**Goal**: Implement weapon switching logic and ensure the Minigun model is displayed correctly in the player's hand.

**Independent Test**: Press 'R' to cycle through weapons; verify Minigun model appears with correct orientation and scale.

### Implementation for User Story 1

- [x] T006 [US1] Update weapon switching cycle logic (modulo 4) in src/entities/player/Player.js
- [x] T007 [US1] Configure Minigun specific position, scale, and rotation in updateGun() within src/entities/player/Player.js
- [x] T008 [US1] Implement model replacement logic when switching to Minigun in src/entities/player/Player.js

**Checkpoint**: User Story 1 is functional - player can switch to and see the Minigun.

---

## Phase 4: User Story 2 - 连发射击逻辑 (Priority: P1)

**Goal**: Implement the high-frequency continuous firing logic for the Minigun.

**Independent Test**: Hold left-click while holding Minigun; verify continuous tracer generation and rapid block destruction.

### Implementation for User Story 2

- [x] T009 [US2] Add WEAPON_MINIGUN case to handleShooting() with 0.05s interval in src/entities/player/Player.js
- [x] T010 [US2] Implement isShooting trigger for Minigun in interact() within src/entities/player/Player.js
- [x] T011 [US2] Configure Minigun tracer parameters (thickness, color) in spawnTracer() within src/entities/player/Player.js

**Checkpoint**: User Story 2 is functional - Minigun can fire rapidly.

---

## Phase 5: User Story 3 - 切换与射击反馈 (Priority: P2)

**Goal**: Add audio and animation feedback for switching and firing the Minigun.

**Independent Test**: Listen for loading sound on switch and rapid firing sound during use; verify smooth draw animation.

### Implementation for User Story 3

- [x] T012 [US3] Trigger gun_load sound when switching to Minigun in src/entities/player/Player.js
- [x] T013 [US3] Implement drawProgress reset and vertical offset animation for Minigun in src/entities/player/Player.js
- [x] T014 [US3] Trigger minigun_fire sound in shoot() logic for Minigun in src/entities/player/Player.js
- [x] T015 [US3] Add recoil feedback for Minigun firing in src/entities/player/Player.js

**Checkpoint**: All user stories are functional with complete sensory feedback.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T016 Fine-tune Minigun muzzle flash/tracer starting position in src/entities/player/Player.js
- [x] T017 Ensure proper resource disposal when switching away from Minigun in src/entities/player/Player.js
- [x] T018 Run quickstart.md validation for all scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup & Foundational**: MUST be completed first.
- **User Story 1**: Depends on Foundation.
- **User Story 2**: Depends on User Story 1 (switching must work to fire).
- **User Story 3**: Adds polish to US1 and US2.

### Parallel Opportunities

- T003, T004, and T005 can be implemented in parallel across different files.
- Visual fine-tuning (T016) can happen after any firing logic is implemented.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Model Loading (Foundational).
2. Complete Switching Logic (US1).
3. Validate that Minigun appears in hand.

### Incremental Delivery

1. Add Firing Logic (US2).
2. Add Audio/Animation Feedback (US3).
3. Final Polish.
