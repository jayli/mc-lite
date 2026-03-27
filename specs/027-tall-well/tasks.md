# Tasks: Tall Well 结构生成

**Input**: Design documents from `/specs/027-tall-well/`
**Prerequisites**: plan.md, spec.md, data-model.md, quickstart.md

**Tests**: Tests are OPTIONAL - this feature relies on in-browser manual testing per CLAUDE.md testing approach.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Verify prerequisites are in place

- [x] T001 Verify tall_well.json exists in `src/world/structures/tall_well.json`

---

## Phase 2: Foundational

**Purpose**: Register tall_well structure loader

**⚠️ CRITICAL**: StructureLoader registration must be complete before WorldWorker integration

- [x] T002 [P] Add tallWell loader to structureLoaders export in `src/world/entity-system/StructureLoader.js`
- [x] T003 [P] Add tallWell.load() to preloadAllStructures in `src/world/entity-system/StructureLoader.js`

**Checkpoint**: StructureLoader 已注册 tall_well，预加载可正常工作

---

## Phase 3: User Story 1 - City 地图生成 Tall Well (Priority: P1) 🎯 MVP

**Goal**: 在 City 地图中按照与 pavilion 相同的概率和规则生成 tall_well 结构

**Independent Test**: 启动游戏传送到 City 地图，观察 tall_well 是否生成，且与 pavilion 不重叠

### Implementation for User Story 1

- [x] T004 Import tallWell loader in WorldWorker destructuring in `src/workers/WorldWorker.js`
- [x] T005 Add CITY_TALL_WELL_CHANCE constant in `src/workers/WorldWorker.js`
- [x] T006 [P] Add tallWellFootprint calculation using getLoaderBottomFootprint in `src/workers/WorldWorker.js`
- [x] T007 Add cityTallWellFootprintCells Set for occupancy tracking in `src/workers/WorldWorker.js`
- [x] T008 [P] Implement collectTallWellFootprintCells helper function in `src/workers/WorldWorker.js`
- [x] T009 [P] Implement isTallWellFootprintReserved check function in `src/workers/WorldWorker.js`
- [x] T010 [P] Implement reserveTallWellFootprint function in `src/workers/WorldWorker.js`
- [x] T011 [P] Implement isTallWellSpaceClear function in `src/workers/WorldWorker.js`
- [x] T012 Implement canPlaceCityTallWell function (includes pavilion overlap check) in `src/workers/WorldWorker.js`
- [x] T013 Implement queueCityTallWell function in `src/workers/WorldWorker.js`
- [x] T014 Implement generateTallWell function in `src/workers/WorldWorker.js`
- [x] T015 Add tall_well generation call after pavilion in City post-fill phase in `src/workers/WorldWorker.js`
- [x] T016 Add tall_well fallback generation logic in City fallback section in `src/workers/WorldWorker.js`

**Checkpoint**: User Story 1 完成 - City 地图可生成 tall_well 且不与 pavilion 重叠

---

## Phase 4: User Story 2 - Tall Well 避免与其他结构重叠 (Priority: P1)

**Goal**: Tall Well 生成时正确避免与 filler house、flower bed、tree 等其他结构重叠

**Independent Test**: 观察生成的 tall_well 与周围建筑保持安全距离，无穿插现象

### Implementation for User Story 2

**Note**: This story is implemented within T012 (canPlaceCityTallWell) which checks distances to all other structures. The implementation was done in Phase 3.

- [x] T017 [P] Verify distance checks in canPlaceCityTallWell cover: major buildings, filler houses, flower beds, all tree types in `src/workers/WorldWorker.js`

**Checkpoint**: User Story 2 完成 - tall_well 与所有其他结构保持安全距离

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [x] T018 Run lint check: `npm run lint`
- [x] T019 Validate implementation against quickstart.md steps
- [ ] T020 Manual test: Start server, teleport to City, verify tall_well generates without overlapping pavilion

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (tall_well.json exists)
- **User Story 1 (Phase 3)**: Depends on Foundational (StructureLoader registered)
- **User Story 2 (Phase 4)**: Implemented within US1 tasks (T012), just verification needed
- **Polish (Phase 5)**: Depends on all user stories complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P1)**: Implemented together with US1 via canPlaceCityTallWell function

### Task Dependencies Within User Story 1

```
T004 (import) -> T005-T007 (constants/Set) -> T008-T011 (helper functions)
                                         \
                                          -> T012 (canPlaceCityTallWell) -> T013 (queue) -> T014 (generate) -> T015-T016 (integration)
```

### Parallel Opportunities

- **Phase 2**: T002 and T003 can run in parallel (different parts of same file, but sequential is safer)
- **Phase 3**: T006, T008, T009, T010, T011 can run in parallel after T005-T007 (independent helper functions)

---

## Parallel Example: User Story 1 Implementation

```bash
# After T004-T007 complete, these can be parallel:
Task: "T006 Add tallWellFootprint calculation"
Task: "T008 Implement collectTallWellFootprintCells"
Task: "T009 Implement isTallWellFootprintReserved"
Task: "T010 Implement reserveTallWellFootprint"
Task: "T011 Implement isTallWellSpaceClear"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (verify JSON exists)
2. Complete Phase 2: Foundational (register loader)
3. Complete Phase 3: User Story 1 (full implementation)
4. **STOP and VALIDATE**: Test in browser - City map should show tall_well
5. Deploy/demo if ready

### Incremental Delivery

This feature is small enough that all user stories are delivered together in a single implementation phase. The "avoid overlap" story (US2) is essentially a verification that US1 was implemented correctly.

### Execution Flow

```
Setup (T001)
    ↓
Foundational (T002-T003)
    ↓
US1 Core (T004-T007)
    ↓
US1 Helpers (T008-T011) [can be parallel]
    ↓
US1 Main Logic (T012-T014)
    ↓
US1 Integration (T015-T016)
    ↓
US2 Verification (T017)
    ↓
Polish (T018-T020)
```

---

## Notes

- This feature modifies existing files (StructureLoader.js, WorldWorker.js), not creating new files
- No automated tests per CLAUDE.md - testing is manual via browser
- Follow pavilion implementation pattern exactly as specified
- Keep code style consistent: 2-space indentation
- All footprint logic mirrors pavilion logic

## Implementation Summary

**Completed**: 2026-03-27
**Modified Files**:
- `src/world/entity-system/StructureLoader.js` - 注册 tall_well 加载器
- `src/workers/WorldWorker.js` - 集成 tall_well 生成逻辑

**Key Implementation Details**:
- CITY_TALL_WELL_CHANCE = CITY_FLOWER_BED_CHANCE * 6 (与 pavilion 相同概率)
- tall_well 生成在 pavilion 之后
- canPlaceCityTallWell 检查 pavilion 占用避免重叠
- 包含兜底机制确保生成成功率
