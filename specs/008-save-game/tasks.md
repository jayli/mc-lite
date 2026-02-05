# Tasks: Save Game Functionality (Manual & Decoupled)

**Input**: Design documents from `/specs/008-save-game/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the specification, so tasks focus on functional implementation and manual verification as per plan.md.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for the new decoupled save system.

- [x] T001 [P] Create independent save configuration in src/constants/SaveConfig.js
- [x] T002 [P] Create dedicated manual save worker file in src/workers/ManualSaveWorker.js
- [x] T003 [P] Create manual save service interface in src/services/ManualSaveService.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Implement IndexedDB initialization for `mc_lite_manual_saves` in src/workers/ManualSaveWorker.js
- [x] T005 [P] Implement `CHECK_SAVE` logic in src/workers/ManualSaveWorker.js
- [x] T006 [P] Implement message proxying in src/services/ManualSaveService.js
- [x] T007 Add `hasSave()` and base initialization check to main script in index.html

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - Manual Game Saving (Priority: P1) 🎯 MVP

**Goal**: Allow players to manually save their current position and all world modifications to a dedicated database.

**Independent Test**: Make changes to the world, click "Save" in settings, and verify the "Save successful" message and IndexedDB entry.

### Implementation for User Story 1

- [x] T008 [P] [US1] Define `SAVE_SNAPSHOT` message handling in src/workers/ManualSaveWorker.js
- [x] T009 [P] [US1] Add "Save" button HTML to settings modal in index.html
- [x] T010 [US1] Implement `saveToDisk()` logic in src/core/Game.js to gather player and world state
- [x] T011 [US1] Bind "Save" button click event and handle notification in src/ui/UIManager.js
- [x] T012 [US1] Implement `save(snapshot)` method in src/services/ManualSaveService.js

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Resuming from Save (Priority: P1)

**Goal**: Prompt the user at startup to either load the manual save or start a new world.

**Independent Test**: Restart the game with an existing manual save, select "Load Save", and verify position and blocks are restored.

### Implementation for User Story 2

- [x] T013 [P] [US2] Implement `LOAD_SNAPSHOT` logic in src/workers/ManualSaveWorker.js
- [x] T014 [P] [US2] Add `load-save-prompt` modal HTML/CSS to index.html
- [x] T015 [US2] Implement `load()` method in src/services/ManualSaveService.js
- [x] T016 [US2] Add `injectSaveData(data)` method to src/services/PersistenceService.js to manually populate cache
- [x] T017 [US2] Modify Game initialization in index.html to show prompt and handle "Load" vs "New World" choice
- [x] T018 [US2] Implement `applySaveData(data)` in src/core/Game.js and src/entities/player/Player.js to restore state

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and robustness.

- [x] T019 Handle "Save in progress" UI state (disable button) in src/ui/UIManager.js
- [x] T020 [P] Add error boundary for corrupted save data in src/services/ManualSaveService.js
- [x] T021 [P] Ensure pointer lock is correctly handled after closing startup modal in index.html
- [x] T022 Run full quickstart.md validation to ensure no regression on original persistence logic

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion. US1 and US2 can be implemented in parallel if data gathering and injection points are agreed upon.
- **Polish (Final Phase)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Foundation. Required to create the data that US2 will load.
- **User Story 2 (P1)**: Depends on US1's data format.

### Parallel Opportunities

- T001, T002, T003 can be created in parallel.
- T005, T006 can be worked on in parallel within Phase 2.
- UI changes (T009, T014) can be done in parallel with service/worker logic.

---

## Parallel Example: User Story 1

```bash
# Implement worker and UI parts in parallel
Task: "Define SAVE_SNAPSHOT message handling in src/workers/ManualSaveWorker.js"
Task: "Add Save button HTML to settings modal in index.html"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational.
2. Complete User Story 1 (Saving).
3. **STOP and VALIDATE**: Manually check IndexedDB `mc_lite_manual_saves` after clicking Save.

### Incremental Delivery

1. Add User Story 2 (Loading).
2. Validate the complete loop.
3. Add Polish items.
