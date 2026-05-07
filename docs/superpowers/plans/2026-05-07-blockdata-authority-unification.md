# BlockData Authority Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将运行时逻辑真相统一收敛到 `blockData` 语义，保留当前所有功能，同时去掉 `WorldRuntime` / `PersistenceService` 周围的 blockData 快照链，让 `MemoryWorldStore` 只承担未加载 chunk 的 `blockData` 容器职责，`IndexedDB` 降级为冷存储层。

**Architecture:** 已加载 chunk 的唯一逻辑权威由 `Chunk.blockData` 持有；未加载 chunk 的逻辑权威由 `MemoryWorldStore.chunks[].blockData` 持有。`visibleKeys`、`solidBlocks`、`blockDataArray`、`meshData`、AO mirror 等全部保留，但统一视为派生索引或渲染载荷。持久化层退出 runtime 正确性主链路，只负责导入、导出和异步冷落盘。

**Tech Stack:** JavaScript, Three.js, Web Workers, IndexedDB, ESLint, 浏览器内测试页面 `src/tests/index.html`

---

## 文件结构与职责

### 新增文件

- Create: `src/world/ColdPersistenceCoordinator.js`
  - 负责替代 `WorldRuntime.flushChunk()` 的冷存储标脏与后台落盘调度

### 重点修改文件

- Modify: `src/world/Chunk.js`
  - 明确 `blockData` 为 loaded chunk 唯一逻辑权威
  - 保持 `visibleKeys` / `solidBlocks` / `blockDataArray` / AO / renderDelta 功能不变
- Modify: `src/world/MemoryWorldStore.js`
  - 语义收窄为 unloaded chunk 的 `blockData` 容器 + 世界级索引
  - 增加从 loaded chunk 同步记录的辅助接口
- Modify: `src/world/World.js`
  - chunk 加载 / 卸载前后的 `blockData` 接班逻辑
  - 保存前全量同步 loaded chunks 到 `MemoryWorldStore`
- Modify: `src/world/WorldRuntime.js`
  - 收缩 `blockDataSnapshot`、`pendingUnloadFlushQueue`、`flushChunk()` 热路径职责
- Modify: `src/world/ChunkPersistence.js`
  - `saveDebounced()` 改为调用冷存储协调器，而不是 `WorldRuntime.flushChunk()`
- Modify: `src/core/Game.js`
  - `collectSnapshot()` 改读 `MemoryWorldStore`
  - `applySaveData()` 改写 `MemoryWorldStore + loaded chunks`
- Modify: `src/services/PersistenceService.js`
  - 删除运行时 cache 职责，只保留兼容与冷存储能力
- Modify: `src/world/WorldStore.js`
  - 明确为冷存储门面
- Modify: `src/workers/PersistenceWorker.js`
  - 第二阶段后再评估收缩 `regionCache`

### 重点测试文件

- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`
- Test: `src/tests/test-runtime-session-persistence.js`

---

### Task 1: 先把运行时权威语义收敛到 `Chunk.blockData` 与 `MemoryWorldStore`

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/MemoryWorldStore.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定“loaded / unloaded 两种 blockData 持有语义”**

在 `src/tests/test-world.js` 和 `src/tests/test-chunk.js` 增加测试，覆盖：

- 已加载 chunk 时逻辑真相以 `Chunk.blockData` 为准
- chunk unload 前同步后，`MemoryWorldStore` 中对应 chunkRecord 持有同样的 `blockData`
- reload 后，重新加载的 chunk 恢复出相同的 `blockData`

测试重点：

- 不能只测“有数据”
- 要测 `blockData` 内容完全一致

- [ ] **Step 2: 运行测试，确认当前语义未被显式保证**

Run:
- 启动 `npm run start`
- 打开 `http://localhost:8080/src/tests/index.html`
- 运行相关测试

Expected:
- 新增语义测试至少有一部分失败，暴露现有职责边界不清晰

- [ ] **Step 3: 修改 `Chunk.blockData` 注释和加载路径语义**

在 `src/world/Chunk.js`：

- 更新 `blockData` 注释为“完整逻辑块集合”
- 明确 `loadFromRecord()` / `_injectBlockData()` 在 loaded chunk 接管逻辑权威

不要改：

- `visibleKeys`
- `solidBlocks`
- `blockDataArray`
- AO / tombstone 功能

- [ ] **Step 4: 修改 `MemoryWorldStore` 注释和最小辅助接口**

在 `src/world/MemoryWorldStore.js`：

- 把类注释改成“未加载 chunk 的 blockData 容器 + 世界级索引”
- 新增一个最小辅助接口，例如：
  - `syncChunkRecord(cx, cz, record)`
  - 或 `syncLoadedChunkToStore(cx, cz, chunkLikeRecord)`

要求：

- 不要引入新的运行时快照层
- 只做数据接班同步

- [ ] **Step 5: 在 `World` 中补上 unload 前同步入口**

在 `src/world/World.js` 增加一个集中入口，例如：

- `beforeChunkUnloadSync(chunk)`

职责：

- 用当前 chunk 的 `blockData`
- 加上 `runtimeEntities/staticEntities/runtimeSeedData`
- 覆盖 `MemoryWorldStore` 中对应记录

- [ ] **Step 6: 运行相关测试确认通过**

Run:
- 测试页面中运行 `test-world.js`
- 运行 `test-chunk.js`

Expected:
- 新增 loaded/unloaded 权威语义测试通过

- [ ] **Step 7: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 2: 去掉 `WorldRuntime` 的 blockData 快照主链路

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/ChunkPersistence.js`
- Modify: `src/world/Chunk.js`
- Create: `src/world/ColdPersistenceCoordinator.js`
- Test: `src/tests/test-world-runtime.js`
- Test: `src/tests/test-runtime-session-persistence.js`

- [ ] **Step 1: 写失败测试，固定“runtime 正确性不依赖 blockDataSnapshot”**

在 `src/tests/test-world-runtime.js` 和 `src/tests/test-runtime-session-persistence.js` 增加测试：

- 单块修改后，即便不构造 `dirtyEntry.blockDataSnapshot`，chunk unload/reload 仍不丢数据
- `saveDebounced()` 不需要 `flushChunk()` 成功才能保证运行时正确性

- [ ] **Step 2: 运行测试，确认当前实现仍依赖 snapshot 语义**

Run:
- 浏览器测试页运行新增测试

Expected:
- 至少有测试因 `_dirtyChunks[].blockDataSnapshot` 或 `flushChunk()` 假设而失败

- [ ] **Step 3: 新增冷存储协调器最小骨架**

在 `src/world/ColdPersistenceCoordinator.js` 实现最小版本：

- `schedulePersistChunk(cx, cz)`
- `flushDirtyChunks()`

第一版只要求：

- 记录哪些 chunk 需要冷落盘
- 提供未来接入 `WorldStore` 的位置

不要第一步就做复杂批处理。

- [ ] **Step 4: 修改 `ChunkPersistence.saveDebounced()`**

在 `src/world/ChunkPersistence.js`：

- 不再直接调用 `runtime.flushChunk()`
- 改为调用新的冷存储协调器 `schedulePersistChunk()`

目标：

- runtime 正确性退出 `flushChunk()` 依赖

- [ ] **Step 5: 收缩 `WorldRuntime.recordBlockMutation()`**

在 `src/world/WorldRuntime.js`：

- 停止首次脏化时创建完整 `blockDataSnapshot`
- 将其职责收缩为“记录 chunk 脏状态”或直接由新协调器接管

要求：

- 保持 `markChunkDirty()` 语义兼容
- 不要破坏现有其他测试

- [ ] **Step 6: 将 `flushChunk()` 明确降级为冷存储工具接口**

在 `src/world/WorldRuntime.js`：

- 标注 `flushChunk()` 不再参与 runtime 正确性
- 停止让 `saveDebounced()` 依赖它

第一阶段允许保留：

- `flushAllDirty()`
- `_commitChunkRecord()`

仅作为冷写工具。

- [ ] **Step 7: 运行运行时相关测试**

Run:
- 测试页面中运行 `test-world-runtime.js`
- 运行 `test-runtime-session-persistence.js`

Expected:
- 卸载/重载正确性不再依赖 `blockDataSnapshot`

- [ ] **Step 8: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 3: 保持渲染索引与查询索引原样工作

**Files:**
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定“索引层保留原用途”**

在 `src/tests/test-chunk.js` 增加测试，覆盖：

- `visibleKeys` 仍服务可见性判断，不因权威语义收敛被合并或清空
- `solidBlocks` 仍服务碰撞判断
- `blockDataArray + solidBlockIds` 仍保持 chunk 内快路径可用

- [ ] **Step 2: 运行测试，确认索引层行为当前有覆盖缺口**

Run:
- 测试页面运行相关测试

Expected:
- 至少需要补一个或多个更明确的断言

- [ ] **Step 3: 修正 `Chunk` 中可能依赖旧持久化假设的逻辑**

在 `src/world/Chunk.js`：

- 检查 `_updateBlockState()`
- 检查 `acceptScatteredBlocks()`
- 检查 `appendScatteredBlocks()`

要求：

- 只允许 `blockData` 驱动索引层更新
- 禁止让索引层去反向决定逻辑真相

- [ ] **Step 4: 明确保留 tombstone / AO mirror / renderDelta**

在 `src/world/Chunk.js` 添加或修正文档注释：

- `deletedBlockTombstones` 继续保留
- `AOBridge` 镜像仍从 `blockData` 派生
- `renderDelta` 仍供全局实例系统消费

- [ ] **Step 5: 运行 chunk/world 相关测试**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- 索引层与渲染补丁相关测试通过

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 4: 手动保存改为直接从 `MemoryWorldStore` 导出

**Files:**
- Modify: `src/core/Game.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定 `collectSnapshot()` 的新来源**

在相关测试中新增断言：

- `collectSnapshot()` 不再调用 `worldStore.getChunkRecord()`
- 保存前先同步所有 loaded chunks 到 `MemoryWorldStore`
- 导出结果来自 `MemoryWorldStore`

- [ ] **Step 2: 运行测试确认当前实现仍依赖 `worldStore.getChunkRecord()`**

Run:
- 浏览器测试页运行新增测试

Expected:
- 新增测试失败，暴露当前逐 chunk 冷读取路径

- [ ] **Step 3: 在 `World` 中新增保存前同步入口**

在 `src/world/World.js` 增加：

- `syncAllLoadedChunksToMemoryStore()`

职责：

- 遍历 `this.chunks`
- 将每个 loaded chunk 当前 `blockData` 和实体记录同步回 `MemoryWorldStore`

- [ ] **Step 4: 改写 `Game.collectSnapshot()`**

在 `src/core/Game.js`：

- 调用 `world.syncAllLoadedChunksToMemoryStore()`
- 直接从 `world.memoryWorldStore` 读取 chunk 记录
- 生成 `worldDeltas`

要求：

- 不再逐 chunk `await world.worldStore.getChunkRecord()`

- [ ] **Step 5: 运行相关测试**

Run:
- 浏览器测试页中运行 `test-world-runtime.js`

Expected:
- `collectSnapshot()` 路径测试通过

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 5: 手动导入改为先写 `MemoryWorldStore`，再同步已加载 chunk

**Files:**
- Modify: `src/core/Game.js`
- Modify: `src/world/World.js`
- Modify: `src/services/PersistenceService.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定 `applySaveData()` 新链路**

新增测试覆盖：

- `applySaveData()` 不再依赖 `persistenceService.injectSaveData()`
- 存档中的 `worldDeltas` 先写入 `MemoryWorldStore`
- 如果目标 chunk 已加载，需同步刷新对应 `Chunk.blockData`

- [ ] **Step 2: 运行测试确认当前仍依赖 `injectSaveData()`**

Run:
- 浏览器测试页运行新增测试

Expected:
- 当前实现因调用 `injectSaveData()` 而失败

- [ ] **Step 3: 修改 `Game.applySaveData()`**

在 `src/core/Game.js`：

- 将 `saveData.worldDeltas` 转写到 `world.memoryWorldStore`
- 对已加载 chunk：
  - 覆盖其 `blockData`
  - 重建 `blockDataArray`
  - 重建 `solidBlocks`
  - 触发可见性 / mesh 重新装配

- [ ] **Step 4: 将 `PersistenceService.injectSaveData()` 降级为 deprecated**

在 `src/services/PersistenceService.js`：

- 保留旧接口以兼容旧代码
- 注释标明不再是 runtime 主链路

- [ ] **Step 5: 运行导入相关测试**

Run:
- 浏览器测试页运行 `test-world-runtime.js`

Expected:
- 存档导入、loaded chunk 覆盖、reload 恢复测试通过

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 6: 收缩旧持久化缓存层，只保留冷存储职责

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/services/PersistenceService.js`
- Modify: `src/world/WorldStore.js`
- Modify: `src/workers/PersistenceWorker.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定“运行时不再依赖旧 cache 层”**

测试覆盖：

- `PersistenceService.cache` 不再承载 runtime blockData 权威
- `WorldRuntime._regionCache` 只服务冷读取/预取
- `pendingUnloadFlushQueue` 不再参与运行时正确性

- [ ] **Step 2: 运行测试，确认当前实现仍保留旧缓存职责**

Run:
- 浏览器测试页运行新增测试

Expected:
- 测试失败，暴露旧缓存职责仍在

- [ ] **Step 3: 收缩 `PersistenceService` 的运行时接口**

在 `src/services/PersistenceService.js`：

- 标记以下方法 deprecated：
  - `snapshotChunkBlocks`
  - `hydrateChunkBlocks`
  - `replaceChunkBlocks`
  - `injectSaveData`

- [ ] **Step 4: 收缩 `WorldRuntime` 的旧 flush 队列职责**

在 `src/world/WorldRuntime.js`：

- 将 `pendingUnloadFlushQueue` 标注为冷写兼容工具
- 检查是否仍有调用路径依赖它保证 runtime 正确性
- 若有，改接到 `MemoryWorldStore`

- [ ] **Step 5: 暂不删除 `PersistenceWorker.regionCache`，只改注释和边界**

在 `src/workers/PersistenceWorker.js`：

- 注释说明其仅服务冷启动/冷读取
- 不把它作为运行时主链路优化项

原因：

- 避免过早删除导致旧档冷启动性能回退

- [ ] **Step 6: 运行运行时测试**

Run:
- 浏览器测试页运行 `test-world-runtime.js`

Expected:
- 无回归

- [ ] **Step 7: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 7: 完整回归与性能验证

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
- 所有现有测试通过

- [ ] **Step 2: 手动验证单块修改与 reload**

手动步骤：

1. 放置方块
2. 删除方块
3. 离开区块触发卸载
4. 返回原区块触发 reload

Expected:
- 方块状态正确恢复

- [ ] **Step 3: 手动验证导入导出**

手动步骤：

1. 导出当前存档
2. 刷新页面
3. 导入刚导出的存档

Expected:
- 世界块数据、实体数据、玩家状态正确恢复

- [ ] **Step 4: 手动验证渲染与碰撞功能未丢失**

重点检查：

- `visibleKeys` 驱动的上屏/补面仍正常
- `solidBlocks` 驱动的碰撞仍正常
- AO 无明显错乱

- [ ] **Step 5: 记录 Chrome Trace 基线与结果**

对比项：

- consolidation 后长帧
- `WorldRuntime.flushChunk()` 是否已退出热路径
- 是否仍有大块 `postMessage` / `applyRegionPatch` 热点

Expected:
- 热路径显著收缩
- 若仍有长帧，应归因为下一阶段“持久化粒度优化”而不是旧 snapshot 链

- [ ] **Step 6: 运行 lint 作为最终门禁**

Run: `npm run lint`
Expected: PASS
