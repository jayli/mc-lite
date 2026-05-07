# BlockData Authority Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 runtime 中的逻辑真相统一收敛到 world-level `blockData`，去掉 `WorldRuntime` / `PersistenceService` 周围的 blockData 快照链，彻底删除 `MemoryWorldStore`，并把 `Chunk.blockData` 收敛为 chunk 运行时视图而不是第二权威。

**Architecture:** world-level `blockData` 是唯一权威。`Chunk.blockData` 是该权威在 chunk 实例中的局部运行时视图。`visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds`、AO mirror、meshData 等全部保留，但统一视为派生索引、碰撞索引或高速查询结构。本阶段不以 IndexedDB、手动存档、手动读档为交付门槛。

**Tech Stack:** JavaScript, Three.js, Web Workers, ESLint, 浏览器内测试页面 `src/tests/index.html`

---

## 文件结构与职责

### 新增文件

- Create: `src/world/WorldBlockDataStore.js`
  - world-level `blockData` 唯一权威容器
  - 负责 chunk slice 读写、生成结果注入、未来导入导出接入点

### 删除文件

- Delete: `src/world/MemoryWorldStore.js`
  - 其旧有职责全部并入 `WorldBlockDataStore`

### 重点修改文件

- Modify: `src/world/Chunk.js`
  - 明确 `blockData` 为 chunk 运行时视图
  - 收敛所有 blockData 写入口
  - 保持 `visibleKeys` / `solidBlocks` / `blockDataArray` / `solidBlockIds` / AO / renderDelta 功能不变
- Modify: `src/world/World.js`
  - chunk 加载 / 卸载前后的 world-level authority 接入
  - 统一通过 `WorldBlockDataStore` 接收生成结果
- Modify: `src/world/WorldGenerationService.js`
  - 区域 / chunk 生成结果直接写入 `WorldBlockDataStore`
- Modify: `src/world/WorldRuntime.js`
  - 收缩 `blockDataSnapshot`、`pendingUnloadFlushQueue`、`flushChunk()` 热路径职责
- Modify: `src/world/ChunkPersistence.js`
  - 去掉运行中对 `flushChunk()` 的依赖
- Modify: `src/world/WorldAccessLayer.js`
  - 明确编辑入口只驱动 runtime authority，不再关心持久化
- Modify: `src/core/Game.js`
  - 若存在导入导出路径，仅标记 deferred 或改为 future hook
- Modify: `src/services/PersistenceService.js`
  - 标记 deferred / deprecated runtime 职责
- Modify: `src/world/WorldStore.js`
  - 标记 deferred 冷存储门面
- Modify: `src/workers/PersistenceWorker.js`
  - 标记 deferred

### 重点测试文件

- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`
- Test: `src/tests/test-runtime-session-persistence.js`

---

### Task 1: 固定新的权威模型并删除 `MemoryWorldStore`

**Files:**
- Create: `src/world/WorldBlockDataStore.js`
- Delete: `src/world/MemoryWorldStore.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 world-level `blockData` 唯一权威语义**

新增测试覆盖：

- loaded chunk 修改后，world-level `blockData` 立即反映变更
- chunk unload 后，reload 仍能从 world-level `blockData` 恢复
- 运行时不再依赖 `MemoryWorldStore`

- [ ] **Step 2: 运行测试，确认当前语义未被显式保证**

Run:
- `npm run start`
- 打开 `http://localhost:8080/src/tests/index.html`
- 运行相关测试

Expected:
- 新增语义测试至少部分失败

- [ ] **Step 3: 实现 `WorldBlockDataStore` 最小骨架**

至少包含：

- `getChunkSlice(cx, cz)`
- `setBlockEntry(cx, cz, code, entry)`
- `replaceChunkSlice(cx, cz, blockData)`
- `hasChunkSlice(cx, cz)`

- [ ] **Step 4: 从 `World` 中移除 `MemoryWorldStore` 初始化与引用**

要求：

- `World` 不再创建 `MemoryWorldStore`
- `World` 改为持有 `WorldBlockDataStore`
- 任何“卸载前同步到内存仓库”的语义全部删除

- [ ] **Step 5: 运行相关测试确认通过**

Run:
- 测试页面中运行 `test-world.js`

Expected:
- 新增唯一权威语义测试通过

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 2: 将 `Chunk.blockData` 收敛为 world-level authority 的 chunk 视图

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 `Chunk.blockData` 不是第二权威**

新增测试覆盖：

- 修改 `Chunk.blockData` 后，world-level `blockData` 同步可见
- reload 后新 chunk 视图看到相同数据
- chunk dispose 后 world-level `blockData` 仍保留

- [ ] **Step 2: 运行测试，确认当前实现仍保留双 holder 语义**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- 至少暴露一部分仍依赖 chunk-local 独立持有的行为

- [ ] **Step 3: 调整 `Chunk` 构造与 hydrate 语义**

要求：

- `Chunk.blockData` 明确写成 world-level authority 的 chunk slice 视图
- `loadFromRecord()` / `_injectBlockData()` 的文档与行为同步调整
- 不再把 `Chunk.blockData` 视作未来 unload 时要转移出去的数据

- [ ] **Step 4: 运行相关测试确认通过**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- `Chunk.blockData` 视图语义成立

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 3: 穷尽所有 blockData 写入口并统一顺序

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/WorldGenerationService.js`
- Modify: `src/world/WorldAccessLayer.js`
- Modify: `src/world/WorldBlockDataStore.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，覆盖所有主要写入口**

至少覆盖：

- `addBlockDynamic()`
- `addBlocksBatchFast()`
- `removeBlocksBatch()`
- `acceptScatteredBlocks()`
- `appendScatteredBlocks()`
- 世界生成结果注入路径

- [ ] **Step 2: 运行测试，确认当前覆盖存在缺口**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- 至少暴露一部分写入口没有被新 invariant 约束

- [ ] **Step 3: 收敛写路径顺序**

统一规则：

- 先写 world-level `blockData`
- 通过 `Chunk.blockData` 视图反映到当前 chunk
- 再更新 `visibleKeys` / `solidBlocks` / `blockDataArray` / `solidBlockIds`
- 再更新 AO / render / tombstone 等异步派生层
- 禁止任何索引层反向决定逻辑真相

- [ ] **Step 4: 让世界生成直接产出权威 blockData**

要求：

- 生成器结果先进入 `WorldBlockDataStore`
- 当前 chunk 已加载时，再 hydrate 到 `Chunk.blockData`
- 不再为持久化缓存额外铺第二条热路径

- [ ] **Step 5: 运行相关测试确认通过**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- 所有主要写入口都满足统一顺序

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 4: 明确保留 chunk 层索引结构

**Files:**
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定索引层职责**

明确覆盖：

- `Chunk.visibleKeys` 仍服务可见性判断
- `Chunk.solidBlocks` 仍服务碰撞判断
- `Chunk.blockDataArray` 仍作为 chunk 内紧凑快路径
- `Chunk.solidBlockIds` 仍配合数组路径做 O(1) 实心判断

- [ ] **Step 2: 运行测试，确认索引层行为当前有覆盖缺口**

Run:
- 测试页面运行相关测试

Expected:
- 至少需要补一个或多个更明确的断言

- [ ] **Step 3: 检查 AO mirror / renderDelta / tombstone 相关逻辑**

要求：

- 明确保留 `deletedBlockTombstones`
- AO mirror 继续从 `blockData` 派生
- `renderDelta` 仍供全局实例系统消费

- [ ] **Step 4: 运行 chunk/world 相关测试**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- 派生索引与渲染补丁相关测试通过

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 5: 去掉 runtime blockData 快照主链路

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/ChunkPersistence.js`
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-world-runtime.js`
- Test: `src/tests/test-runtime-session-persistence.js`

- [ ] **Step 1: 写失败测试，固定“runtime 正确性不依赖 blockDataSnapshot”**

新增测试覆盖：

- 单块修改后，即便不构造 `dirtyEntry.blockDataSnapshot`，unload/reload 仍不丢数据
- `saveDebounced()` 失败或被旁路时，不影响 runtime 正确性

- [ ] **Step 2: 运行测试，确认当前实现仍依赖 snapshot 语义**

Run:
- 浏览器测试页运行新增测试

Expected:
- 至少有测试因 `_dirtyChunks[].blockDataSnapshot` 或 `flushChunk()` 假设而失败

- [ ] **Step 3: 收缩 `WorldRuntime.recordBlockMutation()`**

要求：

- 停止首次脏化时创建完整 `blockDataSnapshot`
- 收缩为 runtime dirty 标记，或直接由 chunk/local state 接管

- [ ] **Step 4: 修改 `ChunkPersistence.saveDebounced()`**

要求：

- 不再直接依赖 `runtime.flushChunk()`
- 本阶段允许只保留防抖 dirty 标记，或直接让它成为 no-op

- [ ] **Step 5: 将 `flushChunk()` 和 `pendingUnloadFlushQueue` 明确降级**

要求：

- 注释标明不再参与 runtime 正确性
- 若暂时保留，仅作为未来冷存储恢复时的兼容工具

- [ ] **Step 6: 运行运行时相关测试**

Run:
- 测试页面中运行 `test-world-runtime.js`
- 运行 `test-runtime-session-persistence.js`

Expected:
- 卸载/重载正确性不再依赖 `blockDataSnapshot`

- [ ] **Step 7: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 6: 收紧 clone / snapshot / serialize 边界

**Files:**
- Modify: `src/world/WorldBlockDataStore.js`
- Modify: `src/world/World.js`
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定“热路径不允许全量 clone”约束**

重点覆盖：

- 单块修改
- 批量改单块
- 普通运行中的 chunk unload

测试不要求精确测时间，但要能证明：

- 不再依赖整份 `blockDataSnapshot`
- 不再用持久化理由对整 chunk 做热路径全量复制

- [ ] **Step 2: 运行测试确认当前实现仍存在快照式依赖**

Run:
- 浏览器测试页运行新增测试

Expected:
- 至少有测试或断言暴露旧 clone 假设

- [ ] **Step 3: 调整 world-level authority API**

要求：

- 提供 chunk slice 视图读取接口
- 提供局部 block entry 更新接口
- 避免所有路径都走整份 chunk record 替换

- [ ] **Step 4: 明确允许 clone 的边界**

代码和注释中只允许在以下边界做全量复制：

- Worker 消息边界
- 测试快照
- 未来导出存档

- [ ] **Step 5: 运行相关测试**

Run:
- 测试页面运行 `test-world-runtime.js`

Expected:
- 热路径中的整包快照依赖显著收缩

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 7: 推迟存档与冷存储能力，并把代码边界标记清楚

**Files:**
- Modify: `src/core/Game.js`
- Modify: `src/services/PersistenceService.js`
- Modify: `src/world/WorldStore.js`
- Modify: `src/workers/PersistenceWorker.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定“runtime 不再依赖旧持久化层”**

测试覆盖：

- `PersistenceService.cache` 不再承载 runtime blockData 权威
- `WorldStore.getChunkRecord()` 不是 runtime 主链路的必需前提
- `collectSnapshot()` / `applySaveData()` 若继续保留，应显式标记 deferred 或兼容路径

- [ ] **Step 2: 运行测试，确认当前实现仍保留旧缓存职责**

Run:
- 浏览器测试页运行新增测试

Expected:
- 测试失败，暴露旧缓存职责仍在

- [ ] **Step 3: 标记 deferred / deprecated 边界**

要求：

- `PersistenceService.injectSaveData()`、`snapshotChunkBlocks()`、`hydrateChunkBlocks()`、`replaceChunkBlocks()` 标记 deprecated
- `WorldStore`、`PersistenceWorker` 标记为冷存储 deferred
- `Game.collectSnapshot()`、`Game.applySaveData()` 若不立即重写，至少明确为非本阶段门槛

- [ ] **Step 4: 运行运行时测试**

Run:
- 浏览器测试页运行 `test-world-runtime.js`

Expected:
- runtime 路径不再把持久化层当成正确性前提

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 8: 完整回归与性能验证

**Files:**
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`
- Test: `src/tests/test-runtime-session-persistence.js`

- [ ] **Step 1: 运行浏览器内测试全套回归**

Run:
- `npm run start`
- 打开 `http://localhost:8080/src/tests/index.html`
- 点击“运行所有测试”

Expected:
- 所有与 runtime authority 相关的现有测试通过

- [ ] **Step 2: 手动验证单块修改与 reload**

手动步骤：

1. 放置方块
2. 删除方块
3. 离开区块触发卸载
4. 返回原区块触发 reload

Expected:
- 方块状态正确恢复

- [ ] **Step 3: 手动验证世界生成结果直接进入 blockData**

手动步骤：

1. 进入未生成区域
2. 观察新区块生成
3. 触发 unload / reload

Expected:
- 生成结果经 unload / reload 后仍一致

- [ ] **Step 4: 手动验证渲染与碰撞功能未丢失**

重点检查：

- `visibleKeys` 驱动的上屏/补面仍正常
- `solidBlocks` 驱动的碰撞仍正常
- `blockDataArray + solidBlockIds` 快路径仍正常
- AO 无明显错乱

- [ ] **Step 5: 记录性能对比**

对比项：

- consolidation 后长帧
- `WorldRuntime.flushChunk()` 是否已退出热路径
- 是否仍有大块 `blockDataSnapshot` / region patch / 结构化复制热点

Expected:
- 热路径显著收缩
- 剩余长帧若存在，应归因于后续渲染或数据结构优化，而不是旧快照链

- [ ] **Step 6: 运行 lint 作为最终门禁**

Run: `npm run lint`
Expected: PASS
