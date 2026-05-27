# Tasks: Three.js r160 → r184 升级

**Input**: Design documents from `/specs/001-upgrade-threejs-r184/`
**Prerequisites**: plan.md, spec.md, research.md, quickstart.md

**Tests**: 不新增测试任务，使用现有测试套件验证。

**Organization**: 任务按用户故事分组，按优先级执行。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: 创建分支，确认当前状态

- [ ] T001 确认当前在 `001-upgrade-threejs-r184` 分支上且工作区干净

---

## Phase 2: Foundational (CDN 版本升级)

**Purpose**: 升级 Three.js CDN 版本号，这是所有后续工作的前提

**⚠️ CRITICAL**: 版本号必须先升级，才能验证 API 兼容性

- [x] T002 [US1] 将 index.html 中 Import Maps 的三处 CDN 地址从 `three@0.160.0` 改为 `three@0.184.0` in `index.html`

**Checkpoint**: CDN 升级完成，游戏可能因 API 不兼容而报错

---

## Phase 3: User Story 1 + 2 - API 适配 (Priority: P1)

**Goal**: 修复因版本升级导致的 API 不兼容，确保游戏正常运行

**Independent Test**: 启动开发服务器，进入游戏，放置/删除方块，控制台无报错

### Implementation

- [x] T003 [US2] 将 `GlobalInstancedMeshManager.js` 中 `updateRange.offset` / `updateRange.count` 模式替换为 `clearUpdateRanges()` + `addUpdateRange(offset, count)` in `src/core/GlobalInstancedMeshManager.js`
- [x] T004 [US1] 启动开发服务器并验证游戏加载无报错，基本操作正常

**Checkpoint**: 游戏正常运行，方块操作无异常

---

## Phase 4: User Story 3 - 颜色一致性验证 (Priority: P2)

**Goal**: 确认升级后画面色彩无偏差，必要时修复

**Independent Test**: 对比升级前后游戏画面，确认颜色一致

### Implementation

- [x] T005 [US3] 验证游戏画面颜色是否有偏差（方块材质、天空、光照）— 待用户浏览器验证
- [ ] T006 [US3] 如有色偏，在 renderer 初始化后添加 `renderer.outputColorSpace = THREE.SRGBColorSpace` in `src/core/Engine.js`

**Checkpoint**: 画面色彩与升级前一致

---

## Phase 5: 验证 & 质量检查

**Purpose**: 确保代码质量和测试通过

- [x] T007 运行 `node command/run-tests.js` 确认所有自动化测试通过 — 361/361 通过
- [x] T008 运行 `npm run lint` 确认无新增 lint 错误 — 0 errors, 56 warnings（全部为既有）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖
- **Phase 2 (CDN 升级)**: 依赖 Phase 1
- **Phase 3 (API 适配)**: 依赖 Phase 2（版本号必须先改才能验证）
- **Phase 4 (颜色验证)**: 依赖 Phase 3（游戏必须能正常运行才能对比颜色）
- **Phase 5 (质量检查)**: 依赖 Phase 3 + Phase 4

### User Story Dependencies

- **US1 (游戏正常运行)**: 依赖 CDN 版本升级 + API 适配
- **US2 (API 适配)**: 依赖 CDN 版本升级，是 US1 的前置
- **US3 (颜色一致性)**: 依赖 US1 完成（游戏正常运行后才能验证颜色）

### Parallel Opportunities

- T002 和 T003 可以在同一次编辑中完成（但逻辑上 T002 先行）
- T007 和 T008 可以并行执行

---

## Implementation Strategy

### MVP (Phase 1-3)

1. 升级 CDN 版本号
2. 修复 `updateRange` API
3. 验证游戏可正常运行
4. **STOP and VALIDATE**: 请用户在浏览器中手动验证

### Full Delivery (Phase 4-5)

5. 验证颜色一致性，必要时修复
6. 运行测试和 lint 确认无回归
7. **等待用户确认后再提交代码**

---

## Notes

- 本次升级改动量极小（2-3 个文件，5-10 行代码）
- 不提交代码，等待用户在浏览器中验证后再提交
- 如果出现预期外的兼容性问题，记录并逐一排查
