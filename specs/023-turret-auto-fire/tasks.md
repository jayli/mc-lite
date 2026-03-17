# Tasks: 炮塔自动射击系统

**Input**: Design documents from `/specs/023-turret-auto-fire/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Create directory structure for turret system in `src/actors/turret/`
- [X] T002 [P] Create turret JSON structure definition in `src/world/structures/turret.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Implement Projectile class in `src/actors/turret/Projectile.js` with object pool support
- [X] T004 [P] Implement ProjectilePool class in `src/actors/turret/ProjectilePool.js` for memory-efficient projectile management
- [X] T005 Add math utility functions in `src/utils/MathUtils.js` for angle calculations (lerpAngle, shortestAngleDiff)

**Checkpoint**: Foundation ready - projectile system and math utilities are available

---

## Phase 3: User Story 1 - 自动检测与瞄准 (Priority: P1) 🎯 MVP

**Goal**: 炮塔能够检测50格范围内的丧尸，并旋转炮塔顶部将枪管对准最近的丧尸

**Independent Test**: 在游戏中放置炮塔，生成丧尸靠近，观察炮塔是否正确旋转瞄准

### Implementation for User Story 1

- [X] T006 [US1] Create Turret class in `src/actors/turret/Turret.js` with basic structure and properties
- [X] T007 [US1] Implement target detection logic (findNearestEnemy) in `src/actors/turret/Turret.js`
- [X] T008 [US1] Implement rotation calculation (calculateTargetRotation) in `src/actors/turret/Turret.js`
- [X] T009 [US1] Implement smooth rotation (rotateTowardsTarget with 90°/s) in `src/actors/turret/Turret.js`
- [X] T010 [US1] Create TurretManager class in `src/actors/turret/TurretManager.js` to manage all turrets
- [X] T011 [US1] Integrate TurretManager into Game.js update loop

**Checkpoint**: User Story 1 complete - turrets detect and aim at zombies

---

## Phase 4: User Story 2 - 自动发射炮弹 (Priority: P1)

**Goal**: 炮塔在瞄准后能够发射炮弹，炮弹沿枪管方向直线飞行

**Independent Test**: 炮塔瞄准后发射可见炮弹，炮弹沿正确方向飞行并在命中或超距后消失

### Implementation for User Story 2

- [X] T012 [US2] Implement fire logic with cooldown (0.5s) in `src/actors/turret/Turret.js`
- [X] T013 [US2] Implement angle check before firing (夹角<15度) in `src/actors/turret/Turret.js`
- [X] T014 [US2] Implement projectile creation and launch in `src/actors/turret/Turret.js`
- [X] T015 [US2] Implement projectile movement (20格/秒) in `src/actors/turret/Projectile.js`
- [X] T016 [US2] Implement max distance check (50格) and recycling in `src/actors/turret/Projectile.js`
- [X] T017 [US2] Integrate ProjectileManager into Game.js update loop

**Checkpoint**: User Story 2 complete - turrets fire projectiles at aimed targets

---

## Phase 5: User Story 3 - 丧尸受伤与死亡 (Priority: P1)

**Goal**: 炮弹命中丧尸造成伤害，丧尸被击中3次后死亡

**Independent Test**: 丧尸被炮弹击中3次后播放死亡效果并移除

### Implementation for User Story 3

- [X] T018 [US3] Add hitCount property to zombie in `src/core/EnemyManager.js` or zombie class
- [X] T019 [US3] Implement collision detection between projectile and zombies in `src/actors/turret/Projectile.js`
- [X] T020 [US3] Implement damage application and hit count increment in `src/actors/turret/Projectile.js`
- [X] T021 [US3] Implement zombie death logic (hitCount >= 3) in `src/core/EnemyManager.js`
- [X] T022 [US3] Add hit feedback effect (flash/animation) for zombies when hit

**Checkpoint**: User Story 3 complete - zombies take damage and die after 3 hits

---

## Phase 6: User Story 4 - 炮塔结构完整性检查 (Priority: P2)

**Goal**: 检测炮塔组成方块的完整性，任一方块被破坏则炮塔失效

**Independent Test**: 破坏炮塔任一组成方块，观察炮塔停止射击并恢复默认朝向

### Implementation for User Story 4

- [X] T023 [US4] Implement structure integrity check in `src/actors/turret/Turret.js`
- [X] T024 [US4] Implement turret destruction logic (state change, cleanup) in `src/actors/turret/Turret.js`
- [X] T025 [US4] Implement turret reset to default rotation when destroyed in `src/actors/turret/Turret.js`
- [X] T026 [US4] Add block removal detection integration in `src/world/World.js` or chunk update

**Checkpoint**: User Story 4 complete - turrets lose function when structure is damaged

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T027 [P] Add debug visualization for turret range (optional, dev mode)
- [X] T028 [P] Optimize performance for multiple turrets (max 20)
- [X] T029 Run ESLint check on all modified JS files
- [X] T030 Validate against quickstart.md test scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can proceed sequentially in priority order (P1 → P2)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies
- **User Story 2 (P1)**: Can start after US1 - Depends on Turret class and aiming logic
- **User Story 3 (P1)**: Can start after US2 - Depends on projectile system
- **User Story 4 (P2)**: Can start after US1 - Depends on Turret class but independent of firing

### Within Each User Story

- Models before services
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T001, T002 (Setup) can run in parallel
- T003, T004, T005 (Foundational) can run in parallel
- T006-T011 (US1) have some parallel opportunities but mostly sequential due to dependencies
- T012-T017 (US2) depend on US1 completion
- T018-T022 (US3) can start after T015-T017 (projectile movement) complete
- T023-T026 (US4) can start after T006-T011 (Turret class) complete

---

## Parallel Example: Foundational Phase

```bash
# Launch all foundational tasks together:
Task: "Implement Projectile class in src/actors/turret/Projectile.js"
Task: "Implement ProjectilePool class in src/actors/turret/ProjectilePool.js"
Task: "Add math utility functions in src/utils/MathUtils.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test detection and aiming works
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test detection and aiming → Deploy/Demo (MVP!)
3. Add User Story 2 → Test projectile firing → Deploy/Demo
4. Add User Story 3 → Test zombie damage/death → Deploy/Demo
5. Add User Story 4 → Test integrity checking → Deploy/Demo
6. Each story adds value without breaking previous stories

---

## Summary

**Total Tasks**: 30

| Phase | Tasks | Description |
|-------|-------|-------------|
| Setup | 2 | Directory structure, JSON definition |
| Foundational | 3 | Projectile, Pool, Math utils |
| US1 (P1) | 6 | Detection and aiming |
| US2 (P1) | 6 | Projectile firing |
| US3 (P1) | 5 | Zombie damage/death |
| US4 (P2) | 4 | Integrity checking |
| Polish | 4 | Optimization, validation |

**Next Step**: Run `/speckit.implement` to start implementation from T001.
