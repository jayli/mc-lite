# Tasks: 地图持久化与动态增量存储 (World Persistence)

**Input**: Design documents from `/specs/001-world-persistence/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create `src/services/` and `src/constants/` directories
- [X] T002 Create persistence configuration in `src/constants/PersistenceConfig.js`
- [X] T003 [P] Update `index.html` import map if needed to include new services (if applicable)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure for IndexedDB access and memory caching

- [X] T004 Implement `PersistenceService` skeleton with IndexedDB initialization in `src/services/PersistenceService.js`
- [X] T005 Implement `getDeltas(cx, cz)` and `recordChange(x, y, z, type)` logic in `src/services/PersistenceService.js`
- [X] T006 Implement `flush(cx, cz)` logic to sync memory cache to IndexedDB in `src/services/PersistenceService.js`
- [X] T007 [P] Implement `clearSession()` to reset data on start (if needed) in `src/services/PersistenceService.js`

**Checkpoint**: Foundation ready - persistence service can store and retrieve data in memory and IndexedDB.

---

## Phase 3: User Story 1 - 基础方块修改持久化 (Priority: P1) 🎯 MVP

**Goal**: 确保玩家挖掘和放置方块的操作在区块卸载并重新加载后依然保留。

**Independent Test**: 在特定坐标挖掘方块 -> 远离该区域使其卸载 -> 返回该区域 -> 验证方块是否仍为空气。

### Implementation for User Story 1

- [X] T008 [US1] Inject `PersistenceService` into `World` in `src/world/World.js`
- [X] T009 [US1] Update `World.update()` to call `persistenceService.flush(chunk.cx, chunk.cz)` before `chunk.dispose()` in `src/world/World.js`
- [X] T010 [US1] Update `Chunk.constructor` to accept and store `persistenceService` in `src/world/Chunk.js`
- [X] T011 [US1] Update `Chunk.addBlockDynamic()` to call `persistenceService.recordChange()` in `src/world/Chunk.js`
- [X] T012 [US1] Update `Chunk.removeBlock()` to call `persistenceService.recordChange(x, y, z, 'air')` in `src/world/Chunk.js`
- [X] T013 [US1] Modify `Chunk.gen()` to be asynchronous or handle async delta loading in `src/world/Chunk.js`
- [X] T014 [US1] Update `Chunk.gen()` to fetch deltas and apply them to the `d` object and `solidBlocks` in `src/world/Chunk.js`

**Checkpoint**: User Story 1 should be fully functional. Chunks now remember modifications within a session.

---

## Phase 4: User Story 2 - 高效的数据加载与回收 (Priority: P2)

**Goal**: 优化存储性能，确保只有必要的数据驻留在内存中。

**Independent Test**: 检查内存占用，确保已卸载区块的 Delta 数据不再占用主内存（已刷入 IndexedDB 并从缓存清理）。

### Implementation for User Story 2

- [X] T015 [US2] Implement cache eviction/cleanup in `PersistenceService.flush()` to remove flushed deltas from memory in `src/services/PersistenceService.js`
- [X] T016 [US2] Optimize `Chunk.gen()` to minimize wait time during delta application in `src/world/Chunk.js`

**Checkpoint**: System maintains low memory footprint even with large numbers of modified blocks.

---

## Phase 5: User Story 3 - 会话内的持久化恢复 (Priority: P3)

**Goal**: 验证跨长距离移动后的世界恢复能力。

**Independent Test**: 在 (0,0) 修改 -> 移动到 (1000, 1000) -> 返回 (0,0) -> 验证修改存在。

### Implementation for User Story 3

- [X] T017 [US3] Verify `PersistenceService` handles large coordinate ranges without performance degradation in `src/services/PersistenceService.js`
- [X] T018 [US3] Perform comprehensive manual test of long-distance world persistence.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements and validation

- [X] T019 [P] Update `CLAUDE.md` to reflect the new Persistence system and Service architecture
- [X] T020 Code cleanup: Remove any console logs used for debugging persistence
- [X] T021 Run `quickstart.md` validation steps

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Phase 1.
- **User Story 1 (Phase 3)**: Depends on Phase 2. **CRITICAL MVP**.
- **User Story 2 & 3 (Phase 4-5)**: Depend on Phase 3.
- **Polish (Phase 6)**: Final step.

### Parallel Opportunities

- T002 and T003 in Setup.
- T005, T006, T007 in Foundational (once DB init T004 is designed).
- T011 and T012 in User Story 1 (different methods in Chunk.js).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational phases.
2. Implement User Story 1 (Core Persistence).
3. **VALIDATE**: Perform the "dig and return" test.

### Incremental Delivery

1. Foundation ready (Service + IDB).
2. US1 adds core value (Changes persist across unloads).
3. US2 adds efficiency (Memory management).
4. US3 validates scale.
