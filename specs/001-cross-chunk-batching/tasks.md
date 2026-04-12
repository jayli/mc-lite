# Tasks: 跨 Chunk 材质合批

**Input**: Design documents from `/specs/001-cross-chunk-batching/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: 无自动化测试要求，通过控制台验证命令和视觉检查确认。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` at repository root
- 新增文件: `src/core/ChunkBatchManager.js`
- 修改文件: `src/world/Chunk.js`, `src/world/World.js`, `src/world/ChunkGenerator.js`, `src/world/ChunkConsolidation.js`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 确认现有代码结构，为合批系统做准备

- [ ] T001 阅读 `src/world/Chunk.js` 中 `buildMeshes()` 和 `dispose()` 方法，记录当前 InstancedMesh 创建和销毁逻辑
- [ ] T002 阅读 `src/core/MaterialManager.js` 中 `getBatchedMaterial()` 和 `getTextureGroups()` 方法签名，确认可复用的纹理分组机制
- [ ] T003 阅读 `src/world/ChunkGenerator.js` 中 mesh 数据生成流程，理解 Worker 返回的数据结构

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 创建 ChunkBatchManager 核心类，包含所有数据结构和基础方法

**⚠️ CRITICAL**: 所有 User Story 的实现都依赖此阶段完成

- [x] T004 创建 `src/core/ChunkBatchManager.js`，实现 TextureBatchGroup 数据结构：管理 InstancedMesh、容量、Slot 分配/释放、空闲区段链表
- [x] T005 在 `src/core/ChunkBatchManager.js` 中实现 registerChunk(chunkKey, instancesByTexture) 方法：按纹理分组分配 Slot，写入 instanceMatrix
- [x] T006 在 `src/core/ChunkBatchManager.js` 中实现 unregisterChunk(chunkKey) 方法：释放所有 Slot，归还空闲区段，更新 InstancedMesh count
- [x] T007 在 `src/core/ChunkBatchManager.js` 中实现 updateChunk(chunkKey, instancesByTexture) 方法：增量更新指定 Slot 区间的矩阵数据
- [x] T008 在 `src/core/ChunkBatchManager.js` 中实现 InstancedMesh 容量管理：×2 倍增策略，扩容时复制现有矩阵数据，最大 65536 实例
- [x] T009 在 `src/core/ChunkBatchManager.js` 中实现 Scene 管理逻辑：InstancedMesh 的添加/移除/更新到场景

**Checkpoint**: ChunkBatchManager 核心类完成，可通过手动调用 API 注册/注销/更新 Chunk 数据

---

## Phase 3: User Story 1 - 跨 Chunk 相同纹理合批渲染 (Priority: P1) 🎯 MVP

**Goal**: 将视野内多个 Chunk 中相同纹理的方块合并到共享 InstancedMesh，减少 draw call

**Independent Test**: 游戏加载后通过 `window.game.engine.renderer.info.render.calls` 查看 draw call 数，确认相比优化前减少 60%+

### Implementation for User Story 1

- [x] T010 [US1] 修改 `src/world/ChunkGenerator.js` 的 buildMeshes 方法，使其生成 instancesByTexture 数据结构 `Map<textureUrl, { matrices: Float32Array, count: number }>` 而非直接创建 InstancedMesh
- [x] T011 [US1] 修改 `src/world/Chunk.js` 的 buildMeshes 流程：当 batchManager 存在时，将生成的实例数据传递给 `world.batchManager.registerChunk()` 而非添加到 chunk.group
- [x] T012 [US1] 修改 `src/world/Chunk.js` 的 dispose 方法：当 batchManager 存在时，调用 `world.batchManager.unregisterChunk(chunkKey)` 而非直接 dispose mesh（保留 chunk.group 用于特殊实体）
- [x] T013 [US1] 修改 `src/world/World.js`：在构造函数中创建 ChunkBatchManager 实例并赋值到 `this.batchManager`，传入 scene 和 materialManager 引用
- [x] T014 [US1] 修改 `src/world/World.js` 的 updateChunks 流程：确保新区块 mesh 就绪后自动注册到 batchManager，卸载时自动注销
- [x] T015 [US1] 在 `src/core/Game.js` 中将 batchManager 暴露到 `window.game.batchManager`，便于控制台访问
- [ ] T016 [US1] 运行游戏，确认方块渲染正确（无缺失、无闪烁），通过 `renderer.info.render.calls` 验证 draw call 减少

**Checkpoint**: 跨 Chunk 合批渲染生效，画面正确，draw call 显著减少

---

## Phase 4: User Story 2 - 轻量验证方法 (Priority: P2)

**Goal**: 提供控制台命令查看合批统计数据，支持开关对比

**Independent Test**: 在控制台输入 `window.game.batchManager.getStats()` 获得完整统计输出

### Implementation for User Story 2

- [x] T017 [US2] 在 `src/core/ChunkBatchManager.js` 中实现 getStats() 方法：返回总 draw call、各纹理组的区块合并数和实例总数
- [x] T018 [US2] 在 `src/core/ChunkBatchManager.js` 中实现 enabled 属性的 getter/setter：设为 false 时回退到逐 Chunk 渲染（chunk 自己创建 InstancedMesh），设为 true 时恢复合批
- [ ] T019 [US2] 在控制台验证 `getStats()` 输出格式正确，`enabled` 开关可正常切换

**Checkpoint**: 开发者可通过控制台完整验证合批效果

---

## Phase 5: User Story 3 - 区块动态更新时合批保持一致 (Priority: P3)

**Goal**: 方块变更、Consolidation、爆炸等操作后合批正确更新，无渲染错误

**Independent Test**: 在区块边界连续快速放置/移除方块，画面无残影/闪烁/丢失

### Implementation for User Story 3

- [x] T020 [US3] 修改 `src/world/ChunkConsolidation.js`：consolidation 完成后，用新的实例数据调用 `batchManager.updateChunk()` 更新合批
- [x] T021 [US3] 修改 `src/world/Chunk.js` 中方块变更（setBlock/addBlockDynamic/removeBlockDynamic）触发的 mesh 重建流程：当 batchManager 存在时，重建后调用 `updateChunk()`
- [x] T022 [US3] 修改 `src/world/World.js` 视距切换（updateRenderDistance）流程：切换后调用 `batchManager.rebuildAll()` 重建所有合批组
- [x] T023 [US3] 在 `src/core/ChunkBatchManager.js` 中实现 rebuildAll() 方法：注销所有 Chunk、清空所有纹理组、重新注册所有活跃 Chunk
- [x] T024 [US3] 运行 lint 检查：`npm run lint`，修复新增代码中的警告
- [ ] T025 [US3] 端到端验证：放置/移除方块、TNT 爆炸、视距切换后渲染均正确，无内存泄漏

**Checkpoint**: 所有动态场景下合批渲染正确，功能完整

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 最终优化和清理

- [x] T026 在 `src/core/ChunkBatchManager.js` 中优化 InstancedMesh 预分配容量计算，减少运行时扩容次数
- [ ] T027 验证 Chunk 卸载时所有 Slot 正确释放，无内存泄漏（通过 Chrome DevTools Memory 面板快照对比）
- [x] T028 运行 `npm run lint` 确认所有代码无警告

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，可立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 完成对现有代码的理解 - 阻塞所有 User Story
- **User Story 1 (Phase 3)**: 依赖 Phase 2 完成 ChunkBatchManager 核心
- **User Story 2 (Phase 4)**: 依赖 Phase 3（需要在合批系统上叠加统计功能）
- **User Story 3 (Phase 5)**: 依赖 Phase 3（需要在合批系统上集成动态更新）
- **Polish (Phase 6)**: 依赖所有 User Story 完成

### User Story Dependencies

```
Phase 2 (Foundational)
    ├── US1 (Phase 3) ─── 核心 MVP
    │       ├── US2 (Phase 4) ─── 验证方法
    │       └── US3 (Phase 5) ─── 动态更新
    └── Polish (Phase 6)
```

- **User Story 1 (P1)**: 依赖 Foundational，无其他 Story 依赖
- **User Story 2 (P2)**: 依赖 US1（需要已注册的合批数据来展示统计）
- **User Story 3 (P3)**: 依赖 US1（需要在已有合批系统上集成动态更新）
- **US2 和 US3 可并行开发**

### Parallel Opportunities

- T004-T009（Foundational 内部）按顺序执行（同一文件，有内部依赖）
- T010-T012（Chunk 侧改造）与 T013-T014（World 侧集成）有逻辑依赖，需按顺序执行
- T017-T018（US2 内部）可并行
- T020-T022（US3 内部涉及不同文件）可并行
- US2 (Phase 4) 和 US3 (Phase 5) 可并行执行

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup — 理解现有代码
2. Complete Phase 2: Foundational — ChunkBatchManager 核心
3. Complete Phase 3: User Story 1 — 合批渲染 + 集成
4. **STOP and VALIDATE**: 启动游戏确认渲染正确、draw call 减少

### Incremental Delivery

1. Setup + Foundational → 基础设施就绪
2. Add User Story 1 → 合批渲染生效（MVP!）
3. Add User Story 2 → 验证工具可用
4. Add User Story 3 → 动态更新完整
5. Polish → 最终优化

---

## Notes

- [P] tasks = 不同文件，无依赖，可并行
- [Story] label 标记任务所属 User Story
- 每个 User Story 独立可测试
- 不提交代码，等待明确指令
- 新增代码遵循 2 空格缩进
- 所有 Three.js 资源在 dispose 时显式释放（Constitution III）
