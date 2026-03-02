# Tasks: AO 阴影渲染逻辑重构

**Input**: Design documents from `/specs/001-refactor-ao-shadows/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ao-worker-protocol.md, quickstart.md

**Tests**: Included for validation purposes - TDD approach recommended for core AO logic

**Organization**: Tasks grouped by user story to enable independent implementation and testing

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., [US1], [US2], [US3])
- Include exact file paths in descriptions

## Path Conventions

Single project structure at repository root:
- `src/` - Source code
- `src/core/` - Core systems (Engine, Game, MaterialManager, etc.)
- `src/world/` - World management (Chunk, World, entities)
- `src/workers/` - Web Workers
- `src/utils/` - Utility functions
- `src/constants/` - Constants and data definitions
- `src/tests/` - Test files

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and existing code audit

- [ ] T001 [P] Audit existing AO implementation in src/workers/WorldWorker.js (lines 447-629)
- [ ] T002 [P] Audit existing AO shader injection in src/core/MaterialManager.js (lines 179-227)
- [ ] T003 [P] Audit existing BlockData.js AO flags (lines 180-209, 244-248)
- [ ] T004 Establish performance baseline for current AO computation time
- [ ] T005 Create specs/001-refactor-ao-shadows/ directory structure for artifacts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core AO infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 [P] Create src/utils/AOUtils.js with AO calculation helper functions
  - packAOData(aos: Uint8Array) → { aoLow, aoHigh }
  - unpackAOValue(aoLow, aoHigh, vertexIdx) → number
  - isAOApplicable(blockType) → boolean
  - getAONeighbors(x, y, z, faceIdx, cornerIdx) → neighbor coordinates
- [ ] T007 [P] Create src/core/AOSystem.js framework class
  - Constructor with Worker reference
  - computeChunkAO() method stub
  - computeBlockAO() method stub
  - applyToMesh() method stub
- [ ] T008 [P] Extend src/workers/FaceCullingWorker.js with AO message handlers
  - Add COMPUTE_AO_BATCH message type handler
  - Add COMPUTE_AO_INCREMENTAL message type handler
  - Import AOUtils functions
- [ ] T009 Update src/constants/BlockData.js to remove explicit isAOEnabled flags
  - Remove isAOEnabled: true from lines 180-209
  - Update getBlockProperties() to auto-compute: !isTransparent && isSolid

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - 玩家在游戏中看到一致的 AO 阴影效果 (Priority: P1) 🎯 MVP

**Goal**: All solid+opaque blocks display consistent AO shadows without gaps or flickering

**Independent Test**: Player places solid blocks and observes uniform AO shadow transitions from all angles

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T010 [P] [US1] Create test-ao.js with AO calculation unit tests
  - Test getAOValue() with all 8 neighbor combinations
  - Test packAOData() round-trip (pack → unpack → verify)
  - Test isAOApplicable() for solid+opaque vs transparent blocks
- [ ] T011 [P] [US1] Create integration test for chunk AO generation in src/tests/test-chunk-ao.js
  - Generate test chunk, verify all solid blocks have AO data
  - Verify transparent blocks excluded from AO
  - Verify AO continuity at chunk boundaries

### Implementation for User Story 1

- [ ] T012 [P] [US1] Implement AOUtils.getAOValue() in src/utils/AOUtils.js
  - Port existing formula from WorldWorker.js line 452-458
  - Preserve Minecraft optimization (corner ignored when both sides air)
- [ ] T013 [P] [US1] Implement AOUtils.getAO() for single block in src/utils/AOUtils.js
  - Port existing getAO() function from WorldWorker.js lines 461-528
  - Support all 6 faces × 4 corners = 24 vertices
- [ ] T014 [US1] Implement FaceCullingWorker COMPUTE_AO_BATCH handler in src/workers/FaceCullingWorker.js
  - Use AOUtils.calculateAOForBlock() for each solid+opaque block
  - Support cross-chunk neighbor lookups via worldChunks parameter
  - Return packed aoLow/aoHigh for each block
- [ ] T015 [US1] Implement AOSystem.computeChunkAO() in src/core/AOSystem.js
  - Send COMPUTE_AO_BATCH request to Worker
  - Handle AO_RESULT response with Promise
  - Transfer large data via Transferable Objects
- [ ] T016 [US1] Integrate AO computation into src/world/Chunk.js mergeChunk()
  - Call AOSystem.computeChunkAO() after block data received from WorldWorker
  - Store AO data in chunk.aoData Map
  - Apply AO data to InstancedMesh attributes
- [ ] T017 [US1] Update src/core/MaterialManager.js to simplify AO detection
  - Replace props.isAOEnabled check with: !props.isTransparent && props.isSolid
  - Auto-apply AO shader for all solid+opaque blocks
- [ ] T018 [US1] Implement dynamic block AO update in src/core/AOSystem.js
  - computeBlockAO() for single block placement/destruction
  - Queue affected neighbors for AO recalculation
  - Debounce rapid updates (player placing multiple blocks)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently
- Player can place blocks and see consistent AO shadows
- AO shadows update correctly for dynamic block changes
- No visual gaps or flickering

---

## Phase 4: User Story 2 - 新添加的方块类型自动支持 AO 阴影 (Priority: P2)

**Goal**: New solid+opaque block types automatically get AO without configuration

**Independent Test**: Add new block type to BlockData.js → verify AO appears without code changes

### Tests for User Story 2 ⚠️

- [ ] T019 [P] [US2] Create test for automatic AO on new block types in src/tests/test-ao.js
  - Add temporary test block type to BlockData.js
  - Verify AO data generated without explicit isAOEnabled flag
  - Remove test block type after verification

### Implementation for User Story 2

- [ ] T020 [P] [US2] Update src/constants/BlockData.js getBlockProperties() helper
  - Ensure auto-computed isAOEnabled logic is correct
  - Add JSDoc comment explaining automatic AO behavior
- [ ] T021 [US2] Verify src/world/Chunk.js uses isAOApplicable() not explicit flags
  - Check all AO-related code paths
  - Remove any remaining isAOEnabled references
- [ ] T022 [US2] Update src/core/AOSystem.js to log AO auto-application
  - Add debug logging when new block type gets AO automatically
  - Include block type name in log for debugging
- [ ] T023 [US2] Add developer documentation to src/constants/BlockData.js
  - Comment explaining that AO is automatic for solid+opaque blocks
  - No need to set isAOEnabled manually

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently
- Adding new block type requires only isSolid/isTransparent definition
- AO shadows appear automatically on new block types

---

## Phase 5: User Story 3 - 复杂场景中 AO 阴影计算保持高性能 (Priority: P3)

**Goal**: AO computation maintains high performance in complex scenes with 1000+ blocks

**Independent Test**: Measure frame time with AO enabled vs disabled, verify <15% performance impact

### Tests for User Story 3 ⚠️

- [ ] T024 [P] [US3] Create performance test for AO computation in src/tests/test-ao-perf.js
  - Measure chunk generation time with AO
  - Measure single block AO update time
  - Measure frame time impact with 1000+ blocks
- [ ] T025 [P] [US3] Create Worker communication overhead test
  - Measure message latency for COMPUTE_AO_BATCH
  - Measure message latency for COMPUTE_AO_INCREMENTAL
  - Verify Transferable Objects reduce overhead

### Implementation for User Story 3

- [ ] T026 [P] [US3] Optimize AOUtils.getAO() with neighbor offset cache in src/utils/AOUtils.js
  - Pre-compute neighbor offsets for each face corner
  - Store in AO_NEIGHBOR_OFFSETS constant
  - Eliminate runtime coordinate calculation
- [ ] T027 [US3] Implement AO request batching in src/core/AOSystem.js
  - Queue incremental AO requests within animation frame
  - Batch multiple block changes into single Worker request
  - Priority queue for visible vs off-screen updates
- [ ] T028 [US3] Add AO computation profiling to src/core/AOSystem.js
  - Track pending request count
  - Track average computation duration
  - Expose getStats() method for debugging
- [ ] T029 [US3] Optimize cross-chunk AO lookups in src/workers/FaceCullingWorker.js
  - Cache adjacent chunk block data
  - Minimize worldChunks map lookups
  - Early exit for blocks not needing AO update

**Checkpoint**: All user stories should now be independently functional
- AO computation time <30ms for chunk generation
- Single block AO update <5ms
- Frame time impact <15% at 1000+ blocks

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T030 [P] Update quickstart.md with AO debugging tips
  - How to visualize AO values in browser console
  - Common issues and solutions
- [ ] T031 [P] Add AO visualization debug mode to src/core/AOSystem.js
  - Optional overlay showing AO values per vertex
  - Toggle via debug flag
- [ ] T032 Code cleanup - remove unused isAOEnabled references
  - Search codebase for remaining isAOEnabled usage
  - Update comments and documentation
- [ ] T033 [P] Performance optimization - profile and reduce GC pressure
  - Reuse AO data arrays where possible
  - Minimize object allocations in hot paths
- [ ] T034 Visual consistency verification
  - Compare AO appearance before/after refactoring
  - Verify corner shadows match original Minecraft-style formula
- [ ] T035 Update CLAUDE.md with AO system documentation
  - Add AOSystem.js to architecture diagram
  - Document Worker message protocol

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - **BLOCKS all user stories**
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Builds on US1 infrastructure
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Optimization layer on top of working implementation

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Utils/functions before system integration
- Worker handlers before main thread callers
- Core implementation before optimization

---

## Parallel Opportunities

### Setup Phase (Phase 1)
- T001, T002, T003 can run in parallel (different files)
- T004 requires T001-T003 completion (need to know what to measure)

### Foundational Phase (Phase 2)
- T006 (AOUtils), T007 (AOSystem), T008 (Worker handler) can run in parallel
- T009 (BlockData.js cleanup) is independent

### User Story 1 (Phase 3)
- T010, T011 (tests) can run in parallel
- T012, T013 (utils functions) can run in parallel
- T014 (Worker handler) depends on T012/T013
- T015 (main thread caller) depends on T014
- T016 (Chunk integration) depends on T015
- T017 (MaterialManager) is independent
- T018 (dynamic updates) depends on T015

### User Story 2 (Phase 4)
- T019 (test) is independent
- T020, T021, T022, T023 can mostly run in parallel (different files)

### User Story 3 (Phase 5)
- T024, T025 (perf tests) can run in parallel
- T026 (neighbor cache), T027 (batching), T028 (profiling) can run in parallel
- T029 (cross-chunk optimization) depends on T026

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Create test-ao.js with AO calculation unit tests" (T010)
Task: "Create integration test for chunk AO generation" (T011)

# Launch all utility functions for User Story 1 together:
Task: "Implement AOUtils.getAOValue()" (T012)
Task: "Implement AOUtils.getAO()" (T013)

# After utils complete, launch Worker and main thread in parallel:
Task: "Implement FaceCullingWorker COMPUTE_AO_BATCH handler" (T014)
Task: "Update MaterialManager.js AO detection" (T017)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**:
   - Run test-ao.js tests (should pass)
   - Manual test: Place blocks, verify AO shadows consistent
   - Check chunk boundaries for AO continuity
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Visual AO working
3. Add User Story 2 → Verify new blocks auto-get AO → Developer experience improved
4. Add User Story 3 → Measure performance → Performance targets met
5. Each phase adds value without breaking previous phases

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (core AO functionality)
   - Developer B: User Story 2 (auto-AO for new types) + documentation
   - Developer C: User Story 3 (performance optimization)
3. Stories integrate independently, merge when complete

---

## Notes

- **[P]** tasks = different files, no dependencies on incomplete tasks
- **[Story]** label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at checkpoints to validate story independently
- **Critical files**: AOUtils.js, AOSystem.js, FaceCullingWorker.js (core AO logic)
- **Integration points**: Chunk.js, MaterialManager.js (apply AO to rendering)

---

## Task Summary

| Phase | Task Count | Description |
|-------|------------|-------------|
| Phase 1: Setup | 5 | Code audit, baseline |
| Phase 2: Foundational | 4 | AOUtils, AOSystem, Worker handler |
| Phase 3: US1 | 9 | Core AO functionality (MVP) |
| Phase 4: US2 | 4 | Auto-AO for new types |
| Phase 5: US3 | 6 | Performance optimization |
| Phase 6: Polish | 6 | Documentation, cleanup |
| **Total** | **34** | Complete refactoring |

**MVP Scope**: Phases 1-3 (18 tasks) → Working AO with consistent shadows

---

## Checklist Validation

✅ All tasks follow format: `- [ ] [ID] [P?] [Story?] Description with file path`
✅ All tasks have clear file paths
✅ User stories organized by priority (P1 → P2 → P3)
✅ Each user story is independently testable
✅ Tests included for core AO logic (TDD approach)
✅ Parallel opportunities identified
✅ MVP scope clearly defined (User Story 1 only)
