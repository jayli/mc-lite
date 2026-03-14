# Tasks: 关闭创造台功能

**Input**: Design documents from `/specs/019-workbench-close/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup & Foundational

**Purpose**: Prepare existing code structure for the feature

**Note**: This feature builds on existing PlaygroundService and UIManager. No new infrastructure needed.

- [x] T001 Review existing PlaygroundService implementation in `src/services/PlaygroundService.js`
- [x] T002 Review existing UIManager playground button handling in `src/ui/UIManager.js`
- [x] T003 [P] Verify game.world.setBlock API supports deletion (set to 'air') in `src/world/World.js`

**Checkpoint**: Understand existing code structure and APIs ready for modification

---

## Phase 2: User Story 1 - 关闭已开启的创造台 (Priority: P1) 🎯 MVP

**Goal**: 实现关闭创造台的核心功能：按钮状态变化、方块删除、玩家位置检测

**Independent Test**: 打开设置 -> 创建创造台 -> 点击"关闭创造台" -> 验证方块清除、按钮恢复

### Implementation for User Story 1

**PlaygroundService 修改**:

- [x] T004 [US1] Add `isPlayerInPlayground(playerPos)` method in `src/services/PlaygroundService.js`
  - Check if player position is within playground bounds (X, Y, Z)
  - Return boolean
  - Use playgroundOrigin and playgroundSize for bounds

- [x] T005 [US1] Add `closePlayground()` method in `src/services/PlaygroundService.js`
  - Check isPlaygroundActive first, return error if not active
  - Call isPlayerInPlayground, return PLAYER_IN_PLAYGROUND error if true
  - Iterate playgroundBlocks Set and call world.setBlock(x,y,z,'air') for each
  - Clear playgroundBlocks Set
  - Set isPlaygroundActive = false
  - Return {success: true}

**UIManager 修改**:

- [x] T006 [US1] Update `updateActiveButtons()` in `src/ui/UIManager.js`
  - Change logic: when playground is active, show "关闭创造台" instead of "创造台已打开"
  - Remove disabled state when playground is active (make it clickable)
  - Keep export button visibility logic

- [x] T007 [US1] Modify `btnCreatePlayground.onclick` handler in `src/ui/UIManager.js`
  - Add condition: if playgroundService.isPlaygroundActive, execute close flow
  - On close success: show message "创造台已关闭", update button to "打开创造台"
  - On PLAYER_IN_PLAYGROUND error: show message "请离开创造台区域后再关闭"
  - Hide export button on close success
  - Keep existing create flow for non-active state

**Edge Cases**:

- [x] T008 [US1] Add duplicate click prevention in `src/ui/UIManager.js`
  - Use local isClosing flag to prevent multiple simultaneous close operations
  - Reset flag after operation completes (success or error)

**Checkpoint**: User Story 1 complete - can create, close, and recreate playground with proper button states

---

## Phase 3: User Story 2 - 保留原有游戏功能 (Priority: P1)

**Goal**: 验证关闭创造台不影响其他游戏系统

**Independent Test**: 关闭创造台后 -> 测试射击、丧尸、存档、设置等功能

### Implementation for User Story 2

**Regression Prevention**:

- [x] T009 [US2] Verify Game.world reference remains valid after closing playground in `src/services/PlaygroundService.js`
  - Ensure world reference is not cleared on close
  - Verify world.setBlock calls still work after close

- [x] T010 [US2] Verify UIManager state consistency in `src/ui/UIManager.js`
  - Ensure other settings buttons (resolution, zombie count, etc.) work after closing
  - Verify settings modal can be reopened after close operation

**Manual Test Checklist** (document in quickstart.md):

- [ ] T011 [US2] Verify shooting functionality after close
- [ ] T012 [US2] Verify zombie spawning (X key) after close
- [ ] T013 [US2] Verify save game functionality after close
- [ ] T014 [US2] Verify other settings (resolution, zombie count) after close

**Checkpoint**: All existing game features work correctly after closing playground

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Code quality, performance, and documentation

- [x] T015 [P] Verify memory cleanup - playgroundBlocks Set is cleared (no references leaked)
- [x] T016 Verify code follows 2-space indentation convention
- [ ] T017 [P] Test edge case: player manually removes some playground blocks before close
- [ ] T018 Test edge case: rapid open/close cycles
- [x] T019 Update quickstart.md with final test scenarios
- [ ] T020 Run manual validation per quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: No dependencies - review existing code
- **Phase 2 (US1)**: Depends on Phase 1 understanding - implement core feature
- **Phase 3 (US2)**: Depends on Phase 2 completion - verify no regressions
- **Phase 4**: Depends on Phase 3 - polish and finalize

### Task Dependencies

```
T001, T002, T003 (parallel review)
    ↓
T004 (isPlayerInPlayground) → T005 (closePlayground)
    ↓
T006 (update button state) → T007 (click handler)
    ↓
T008 (duplicate prevention) - parallel with T007
    ↓
T009, T010 (regression checks)
    ↓
T011-T014 (manual tests)
    ↓
T015-T020 (polish)
```

### Parallel Opportunities

- T001, T002, T003 can be reviewed in parallel
- T004 and T006 can be implemented in parallel (different files)
- T009 and T010 can be verified in parallel
- T011-T014 manual tests can be done in any order

---

## Parallel Example: User Story 1 Implementation

```bash
# Developer A: PlaygroundService changes
Task: "Add isPlayerInPlayground() method in src/services/PlaygroundService.js"
Task: "Add closePlayground() method in src/services/PlaygroundService.js"

# Developer B: UIManager changes (can start after T004/T006 understood)
Task: "Update updateActiveButtons() in src/ui/UIManager.js"
Task: "Modify btnCreatePlayground.onclick handler in src/ui/UIManager.js"
Task: "Add duplicate click prevention in src/ui/UIManager.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Review existing code
2. Complete Phase 2: User Story 1 - implement close feature
3. **STOP and VALIDATE**: Test creating, closing, recreating playground
4. Deploy/demo if ready

### Full Feature Delivery

1. Complete Phase 1 + Phase 2: Core feature ready
2. Complete Phase 3: Verify no regressions
3. Complete Phase 4: Polish and finalize

---

## Task Summary

| Phase | Tasks | Story | Focus |
|-------|-------|-------|-------|
| 1 | T001-T003 | - | Code review |
| 2 | T004-T008 | US1 | Core close feature |
| 3 | T009-T014 | US2 | Regression verification |
| 4 | T015-T020 | - | Polish |

**Total Tasks**: 20
**Parallel Tasks**: T001-T003, T009-T010, T011-T014, T015, T017

---

## Notes

- All modifications are to existing files (no new files created)
- Keep changes minimal and focused
- Follow existing code style (2-space indentation, ES6+ modules)
- No external dependencies needed
- Manual testing is primary validation method for this feature
