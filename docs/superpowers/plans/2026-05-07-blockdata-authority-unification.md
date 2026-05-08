# BlockData Authority Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 runtime 中的逻辑真相统一收敛到 world-level `blockData`，去掉 `WorldRuntime` / `PersistenceService` 周围的 blockData 快照链，彻底删除 `MemoryWorldStore`，并把 `Chunk.blockData` 收敛为 chunk 运行时视图而不是第二权威。

**Architecture:** world-level `blockData` 是唯一权威。`Chunk.blockData` 是该权威在 chunk 实例中的局部运行时视图。`visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds`、AO mirror、meshData 等全部保留，但统一视为派生索引、碰撞索引或高速查询结构。本阶段不以 IndexedDB、手动存档、手动读档为交付门槛。

**Tech Stack:** JavaScript, Three.js, Web Workers, ESLint, 浏览器内测试页面 `src/tests/index.html`

---

## 文件结构与职责

## 本阶段边界与验收前提

- 本阶段只交付 runtime 内存权威闭环，不交付 `IndexedDB`、手动存档、手动读档、JSON 导入导出。
- 允许保留空接口、future hook、deprecated 壳层，但不允许让这些冷路径重新成为 runtime 正确性的依赖。
- 本阶段的最低验收闭环是：
  - 世界生成直接写入 world-level authority
  - 玩家编辑直接命中 world-level authority
  - chunk unload 只释放视图与派生层
  - chunk reload 从 world-level authority 恢复
  - AO / tombstone / renderDelta / scatter patch 语义不回退
  - 特殊实体（矿车、丧尸巢穴、炮塔等）的既有渲染、互动、与主世界/玩家的交互能力不回退
- 若实现过程中发现某一步必须重新依赖 `PersistenceService.cache`、`WorldStore.commitChunkRecord()`、`blockDataSnapshot` 或 `pendingUnloadFlushQueue` 才能保证 runtime 正确性，则应停止推进并回到设计层修正，而不是临时接回旧链路。

### 新增文件

- Create: `src/world/WorldBlockDataStore.js`
  - world-level `blockData` 唯一权威容器
  - 负责 chunk slice 读写、生成结果注入、未来导入导出接入点
- Create: `src/world/WorldChunkPayloadRegistry.js`
  - world-level non-block payload authority
  - 本阶段负责 `runtimeSeedData`、`staticEntities` 的持有与恢复
  - 为 `runtimeEntities` 预留兼容挂点，但不要求本阶段完成其 owner 重构
- Create: `src/world/WorldChunkRegistry.js`
  - world-level chunk presence / generation state registry
  - 负责区分 missing chunk、known empty chunk、known non-empty chunk

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
- Modify: `src/world/WorldChunkRegistry.js`
  - 若实现为类文件，补充 chunk presence / generation state 查询
- Modify: `src/world/WorldGenerationService.js`
  - 区域 / chunk 生成结果直接写入 `WorldBlockDataStore`
- Modify: `src/world/BlockScatterManager.js`
  - cross-chunk patch / scatter 编排必须对齐 authority slice 语义
  - 保持 tombstone、hidden block、late worker result 保护在 shared authority 模式下仍然正确
- Modify: `src/world/ChunkAssemblyScheduler.js`
  - hydrate stage 在 authority slice 已存在时只做 attach + rebuild
  - 不再驱动旧的 clear + inject blockData 语义
- Modify: `src/world/WorldRuntime.js`
  - 收缩 `blockDataSnapshot`、`pendingUnloadFlushQueue`、`flushChunk()` 热路径职责
  - 明确 `RegionCache` 降级为冷边界 / region 管理辅助层
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
- Test: `src/tests/test-world-generation-cross-region.js`

### 需要删除或重写的旧测试

- Delete or rewrite: `src/tests/test-memory-world-store.js`
  - `MemoryWorldStore` 删除后，此测试不再成立
- Rewrite: `src/tests/test-runtime-session-persistence.js`
  - 从“cache 是会话权威”迁移为“authority 是会话权威，冷边界只是可选导出路径”
- Rewrite: `src/tests/test-world-runtime.js`
  - 从 `flushChunk()/snapshot/commitChunkRecord()` 主语义迁移为 authority attach / reload / cold boundary 降级语义

---

### Task 0: 锁定 runtime-only 边界、数据模型与验收矩阵

**Files:**
- Modify: `docs/superpowers/specs/2026-05-07-blockdata-authority-unification-design.md`
- Modify: `docs/superpowers/plans/2026-05-07-blockdata-authority-unification.md`

- [ ] **Step 1: 固定阶段边界**

要求：

- 明确本阶段只解决 runtime 内存权威闭环
- 明确 `IndexedDB`、手动存档、手动读档、导入导出均非本阶段门槛
- 明确允许保留空接口 / deprecated 壳层，但不允许回挂 runtime 正确性

- [ ] **Step 2: 固定 authority 数据模型**

要求：

- 明确 `WorldBlockDataStore` 只负责 world-level `blockData` slice
- 明确 `WorldChunkPayloadRegistry` 本阶段持有 `runtimeSeedData`、`staticEntities`
- 明确 `runtimeEntities` / 特殊实体系统本阶段作为兼容层保留，不作为 primary authority 重构对象
- 明确特殊实体虽然不是 primary authority 重构对象，但其既有运行行为是本阶段硬性验收项，不允许功能回退
- 明确 `WorldChunkRegistry` 持有 chunk presence / generation state，而不是靠空 slice 猜测
- 明确 `runtimeSeedData`、`staticEntities` 属于本阶段要收口的 chunk-level non-block payload
- 明确这些 non-block payload 不再以 `Chunk` 生命周期作为唯一持有语义

- [ ] **Step 3: 固定 runtime 最小闭环**

要求：

- 世界生成 -> authority -> loaded chunk attach / rebuild
- 玩家编辑 -> authority -> 派生层
- unload -> 释放视图与派生层
- reload -> 从 authority 恢复

- [ ] **Step 4: 固定验收矩阵**

要求：

- 文档中明确写出 runtime-only 成功标准
- 明确哪些旧功能降级为 deferred
- 明确哪些旧测试将删除、哪些将重写、哪些将在本阶段降级

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

- `peekChunkSlice(cx, cz)` 或语义等价接口
- `ensureChunkSlice(cx, cz)` 或语义等价接口
- `setBlockEntry(cx, cz, code, entry)`
- `deleteBlockEntry(cx, cz, code)`
- `replaceChunkSlice(cx, cz, blockData)`
- `hasChunkSlice(cx, cz)`

边界要求：

- `WorldBlockDataStore` 的外层结构必须明确固定为“chunkKey -> chunk slice”的映射，不允许留成实现者自由发挥
- 推荐固定为 `Map<string, Map<number, entry>>`，其中 `chunkKey = "${cx},${cz}"`
- `WorldBlockDataStore` 的 runtime 内部主存储格式必须是 `Map<number, entry>`
- 每个 chunk slice 的主存储格式也必须是 `Map<number, entry>`，不能继续以普通对象作为 runtime 主存储
- `peekChunkSlice()` 不存在时返回 `null`，不得隐式创建
- `ensureChunkSlice()` 不存在时创建空 slice 并返回共享实例
- `replaceChunkSlice()` 只允许用于世界生成注入、未来导入、测试夹具、冷边界恢复
- runtime 热路径禁止把 `replaceChunkSlice()` 当成单块修改或 scatter patch 的通用入口
- 一旦某个 slice 已 attach 给 live chunk，禁止静默替换其 `Map` 实例；若必须整块替换，只能走 detach -> replace -> reattach 协议

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

### Task 1.2: 固定 chunk presence / generation state 与 non-block payload owner

**Files:**
- Create: `src/world/WorldChunkPayloadRegistry.js`
- Create: `src/world/WorldChunkRegistry.js`
- Modify: `src/world/World.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/WorldGenerationService.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定 registry 语义**

新增测试覆盖：

- missing chunk 与 known empty chunk 必须可区分
- bootstrap 生成出的空 chunk 不得因 slice 为空而被判定为 missing
- `runtimeSeedData/staticEntities` 在 chunk unload 后仍有 world-level owner
- reload 时这两类 non-block payload 从 registry 恢复，而不是依赖 live chunk 残留
- `runtimeEntities` / 特殊实体链路在本阶段保持兼容，不要求进入新的 registry owner 体系

- [ ] **Step 2: 实现 `WorldChunkRegistry` 最小骨架**

至少包含：

- `markChunkKnown(cx, cz, meta)`
- `getChunkState(cx, cz)`
- `hasKnownChunk(cx, cz)`
- `markChunkGenerated(cx, cz)` 或等价接口

边界要求：

- 不允许通过 `ensureChunkSlice()` 是否被调用来隐式推断 chunk 是否已知存在
- 必须能明确表达：
  - missing chunk
  - known empty chunk
  - known non-empty chunk

- [ ] **Step 3: 实现 `WorldChunkPayloadRegistry` 最小骨架**

至少包含：

- `getChunkPayload(cx, cz)`
- `setChunkPayload(cx, cz, payload)`
- `mergeChunkPayload(cx, cz, partialPayload)`
- `hasChunkPayload(cx, cz)`

边界要求：

- `runtimeSeedData/staticEntities` 的 world-level owner 必须固定
- `Chunk` 不得继续作为这两类 payload 的唯一最终持有者
- `runtimeEntities` 若预留接口，只允许作为兼容挂点，不得因此扩成本阶段特殊实体大重构

- [ ] **Step 4: 对齐生成与加载链路**

要求：

- 世界生成先写 `WorldChunkRegistry` 与 `WorldChunkPayloadRegistry`
- chunk load / reload 时，先判定 chunk presence，再 attach authority / restore payload
- `WorldRuntime.ensureChunkData()` 若仍保留冷边界职责，必须与 registry 语义对齐，而不是另起一套 missing 判定
- `runtimeEntities` / 特殊实体恢复继续沿用现有兼容链路，只要求与新的 authority attach / reload 不冲突

- [ ] **Step 5: 运行相关测试**

Run:
- 测试页面运行 `test-world.js`
- 运行 `test-world-runtime.js`

Expected:
- chunk presence 与 payload owner 语义稳定成立

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
- `Chunk.blockData` 与 `WorldBlockDataStore.getChunkSlice()` 返回同一个 `Map` 实例
- attached slice 在 chunk 生命周期内保持引用稳定，不会因普通 rebuild 被静默替换成新的 `Map`

- [ ] **Step 2: 运行测试，确认当前实现仍保留双 holder 语义**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- 至少暴露一部分仍依赖 chunk-local 独立持有的行为

- [ ] **Step 3: 调整 `Chunk` 构造与 hydrate 语义**

要求：

- `Chunk.blockData` 明确写成 world-level authority 的 chunk slice 视图
- `Chunk.blockData` 必须直接引用 `WorldBlockDataStore` 内对应 chunk slice 的同一个 `Map<number, entry>` 实例
- `loadFromRecord()` / `_injectBlockData()` 的文档与行为同步调整
- 不再把 `Chunk.blockData` 视作未来 unload 时要转移出去的数据
- 禁止继续保留“先写 chunk-local `blockData`，再同步 world-level authority”的实现方式
- 禁止把“共享同一个 `Map` 实例”误实现成“任意调用方都可直接 `chunk.blockData.set/delete` 而不经过派生层更新”
- 明确区分：
  - attach authority slice
  - rebuild derived indexes
  - restore non-block payload
- `loadFromRecord()` 若继续保留旧命名，必须在注释中写清输入是冷边界快照还是 authority attach 信息
- `_injectBlockData()` / `_injectBlockDataBatch()` 若继续保留，只能承担“从边界数据创建或重建 authority/派生层”的职责，不能悄悄生成第二份 chunk-local 权威
- 明确写出迁移矩阵：
  - 哪些路径属于 cold input -> authority
  - 哪些路径属于 authority -> attach
  - 哪些路径属于 authority -> rebuild derived indexes

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

### Task 2.5: 明确 attach / hydrate / rebuild 的装配协议

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/ChunkAssemblyScheduler.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定装配协议**

新增测试覆盖：

- attach 只建立共享 slice，不复制逻辑真相
- rebuild 派生索引时允许清空 `visibleKeys` / `solidBlocks` / `blockDataArray` 等，但不允许替换 authority slice
- scheduler 切片 hydrate 过程中，`Chunk.blockData` 始终指向 authority slice
- shared view 模式下，任何 `this.blockData.clear()` 都应被视为错误或被新实现彻底移除
- `_clearForBlockInjection()`、`_injectBlockData()`、`_injectBlockDataBatch()` 不得再以“先清空 `this.blockData` 再重建”为实现前提
- `peekChunkSlice()` 与 `ensureChunkSlice()` 的调用方语义不混用
- `replaceChunkSlice()` 只允许在未 attach 或显式 detach 后的场景生效

- [ ] **Step 2: 调整装配 API 语义**

要求：

- 视情况拆分或重命名 `loadFromRecord()` / `_injectBlockData()` / `_injectBlockDataBatch()`
- 让代码层面能看出：
  - 哪一步在 attach
  - 哪一步在 rebuild
  - 哪一步在恢复 `runtimeSeedData` / `staticEntities`
  - 哪一步在兼容现有 `runtimeEntities` / 特殊实体恢复链路
- 让代码层面能看出：
  - 哪一步在处理 cold input -> authority
- `ChunkAssemblyScheduler` 调用的 hydrate stage 在 authority slice 已存在时，只允许：
  - attach authority slice
  - rebuild derived indexes
  - restore payload
  - 禁止继续驱动 `_clearForBlockInjection()` + `_injectBlockDataBatch()` 这类 clear + inject 语义
- 明确采用三段式协议：
  - `WorldBlockDataStore.replaceChunkSlice()` / fill API
  - `Chunk.attachAuthoritySlice()` 或等价挂载步骤
  - `Chunk.rebuildDerivedIndexesFromAuthority()` 或等价重建步骤
- 若旧 helper 名称继续保留，必须通过注释和实现保证：
  - 它不会对 shared `Chunk.blockData` 执行 `clear()`
  - 它不会在 `Chunk` 内部偷偷新建第二份权威 `Map`

- [ ] **Step 2.5: 拆除 shared Map 模式下的非法 clear 语义**

要求：

- 明确识别并移除以下旧模式：
  - `_clearForBlockInjection()` 内直接 `this.blockData.clear()`
  - `_injectBlockData()` / `_injectBlockDataBatch()` 先清空 authority 再回填
- 若需要“整块替换 blockData”，必须改为 store 侧执行 `replaceChunkSlice()`
- `Chunk` 侧只允许：
  - 重新 attach slice
  - 清空并重建派生索引
- 测试必须能证明：shared authority slice 在 chunk rebuild 过程中不会被清空

- [ ] **Step 2.75: 拆除 `loadFromRecord` / `_injectBlockData` 的旧复合职责**

要求：

- `loadFromRecord()` 不再被实现为“读取 plain object -> 写 `Chunk.blockData` -> 建索引”的单函数复合流程
- `_injectBlockData()` 若保留，只能保留一种职责：
  - cold input -> authority helper
  - 或 authority -> derived indexes rebuild helper
- `_injectBlockDataBatch()` 若保留，必须明确是在分批 rebuild 派生索引，而不是分批写 chunk-local 逻辑真相
- 禁止继续保留“一个 helper 同时负责写 `blockData` 和建索引”的旧实现

- [ ] **Step 2.8: 写失败测试，锁定迁移后的职责边界**

新增测试覆盖：

- `chunkRecord.blockData` 作为 plain object 输入时，先进入 authority，而不是直接写 chunk-local map
- authority slice 已存在时，`loadFromRecord()` 只做 attach / rebuild，不重复注入逻辑真相
- rebuild 只影响派生索引，不影响 authority 内容
- `runtimeSeedData/staticEntities` 的恢复步骤与 blockData attach 步骤彼此独立
- `runtimeEntities` / 特殊实体恢复在本阶段只是兼容步骤，不得反向主导 authority attach
- `Chunk` dispose 后，authority / payload registry 仍保留，新的 chunk attach 不依赖旧实例残留

- [ ] **Step 2.9: 固定 detach / dispose 协议**

要求：

- 明确 `Chunk.dispose()` / unload 期间：
  - 哪些结构被释放
  - 哪些 world-level authority 被保留
  - 哪些异步回包必须失效
- 为 attach / detach 生命周期引入 epoch 或等价版本语义
- 测试必须能证明：晚到 worker 结果不会污染新 attach 的 chunk 视图
- 测试必须能证明：scheduler 切片 hydrate 在 authority slice 已存在时不会 clear 或重注入 `Chunk.blockData`

- [ ] **Step 3: 运行相关测试**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world-runtime.js`

Expected:
- attach / hydrate / rebuild 语义稳定成立

- [ ] **Step 4: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 3: 穷尽所有 blockData 写入口并统一顺序

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/BlockScatterManager.js`
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
- `BlockScatterManager.distributeBlocks()` / `scatter()` / deferred cross-chunk patch 路径
- `acceptScatteredBlocks()`
- `appendScatteredBlocks()`
- 世界生成结果注入路径
- `WorldGenerationService._generateRegion()` 完成后的 authority 接入路径
- `World` / `Chunk` 接收 WorldWorker 结果后的 authority 接入路径
- `acceptWorkerResult()` 一类直接装配 worker 元数据与派生层的路径
- authority 写入后不得再对同一逻辑修改额外执行一次 `Chunk.blockData.set/delete`
- cross-chunk patch 时，每个目标 chunk 必须命中各自的 authority slice
- bootstrap 阶段生成出的未加载 chunk 数据也必须先存在于 authority，而不是等 chunk 加载后才补写

- [ ] **Step 2: 运行测试，确认当前覆盖存在缺口**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world.js`

Expected:
- 至少暴露一部分写入口没有被新 invariant 约束

- [ ] **Step 3: 收敛写路径顺序**

统一规则：

- 先写 `WorldBlockDataStore`
- 通过 `Chunk.blockData` 视图反映到当前 chunk
- 再更新 `visibleKeys` / `solidBlocks` / `blockDataArray` / `solidBlockIds`
- 再更新 AO / render / tombstone 等异步派生层
- 禁止任何索引层反向决定逻辑真相
- 禁止任何“先改 `Chunk.blockData`，再同步回 authority”的旧双写顺序
- 禁止任何“写 authority 一次后，再对共享 `Chunk.blockData` map 补一次 `set/delete`”的重复 mutation
- `acceptScatteredBlocks()` / `appendScatteredBlocks()` 若涉及多个 chunk，必须对每个目标 chunk 分别写入对应 authority slice
- 禁止为 scatter / deferred patch 构造额外的 staging `blockData` 副本，等待后续再同步到 world-level authority

- [ ] **Step 3.2: 区分 authority 输入与 worker 派生层输入**

要求：

- 生成结果中的 `blockData` 必须先进入 authority
- worker 回包中的 `visibleKeys`、`solidBlocks`、`meshData`、`structureCenters` 等只允许作为派生层输入
- `acceptWorkerResult()` 若继续直接装配派生层，必须建立在 authority 已写入且 chunk 已 attach 的前提下
- 禁止把 worker 回包的派生层数据反向当成逻辑真相来源

- [ ] **Step 3.3: 适配 `BlockScatterManager` 到 authority slice 语义**

要求：

- `BlockScatterManager` 在 shared authority 模式下被明确视为 patch 编排层，而不是 chunk-local blockData 灌入层
- `distributeBlocks()`、`scatter()`、deferred cross-chunk patch 路径必须对每个目标 chunk 命中其 authority slice
- tombstone 检查、hidden block 过滤、late worker result 保护在 shared authority 模式下必须继续成立
- 禁止 `BlockScatterManager` 通过“先把块灌进 chunk-local 副本，后续再同步”的旧思路维持正确性
- 测试必须覆盖：
  - cross-chunk patch 命中正确目标 slice
  - 玩家修改不会被晚到 scatter 结果覆盖
  - hidden block / tombstone 保护不会因 shared Map 而失效

- [ ] **Step 3.5: 建立统一 mutation 原语**

要求：

- 为 runtime 热路径提供唯一合法原语：
  - `setBlockEntry()`
  - `deleteBlockEntry()`
  - 批量局部 patch API
- 除 attach / replace / 测试夹具外，业务代码禁止直接 `chunk.blockData.set/delete`
- 除 store 侧整块 replace 外，任何路径禁止对 shared `Chunk.blockData` 执行 `clear()`
- mutation 固定顺序必须可在代码中读出来：
  - authority mutation
  - 差异判定
  - 派生索引更新
  - AO / tombstone / renderDelta / render patch 更新
  - dirty 标记 / 异步派生调度
- 测试或断言必须能发现“authority 写一次 + chunk map 再写一次”的重复 mutation

- [ ] **Step 3.6: 建立 authority codec 边界**

要求：

- 明确 runtime authority 主存储为 `Map<number, entry>`
- 明确 worker / 冷边界 / 测试夹具的序列化格式为 plain object 或等价边界格式
- 为 object <-> Map 转换提供统一 codec，而不是让 `WorldGenerationService`、`WorldRuntime`、`Chunk` 各自散落转换
- 禁止热路径借助 codec 进行整块 object/map 往返

- [ ] **Step 3.8: 完成双写机制切换**

要求：

- `_updateBlockState()` 一类 helper 中“写 `Chunk.blockData` + 同步写 `MemoryWorldStore`”的旧双写模式必须整体退出
- 所有主要写路径都切换到：
  - 写 `WorldBlockDataStore`
  - 共享 `Chunk.blockData` 自动可见
  - 再更新派生层
- 测试必须能证明：主线程不再需要 `memStore.applyBlockMutation()` 这类第二写入步骤

- [ ] **Step 4: 让世界生成直接产出权威 blockData**

要求：

- 生成器结果先进入 `WorldBlockDataStore`
- 当前 chunk 已加载时，再 hydrate 到 `Chunk.blockData`
- 不再为持久化缓存额外铺第二条热路径
- 当前 chunk 未加载时，authority 仍应持有对应 slice，等待未来 chunk attach
- `runtimeSeedData`、`staticEntities` 若随生成阶段一起产出，也必须写入对应的 world-level / registry 层，而不是继续只暂存在 chunk 生命周期中
- `runtimeEntities` / 特殊实体本阶段不要求随生成链路一并重构，只要求不破坏既有兼容逻辑

- [ ] **Step 4.5: 明确禁止 world generation 双写旧持久化层**

要求：

- 本阶段 `WorldGenerationService` 采用 single-write to runtime authority
- `_generateRegion()`、expand 路径、cross-region overflow 合并路径不得再把 `WorldStore.saveRegionRecord()`、`saveWorldMeta()`、`commitChunkRecord()` 当成 runtime 正确性的必要步骤
- 若暂时保留这些接口调用，必须显式标记为 deferred / future hook，且失败不会影响当前会话 runtime 正确性
- `region` 可以继续作为生成 / 路由 / 分批调度单位存在，但 `region persistence` 不再是生成主链路

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

### Task 3.5: 打通 bootstrap 预生成到 WorldBlockDataStore 的主链路

**Files:**
- Modify: `src/world/WorldGenerationService.js`
- Modify: `src/world/World.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/WorldBlockDataStore.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定 bootstrap generation authority 链路**

新增测试覆盖：

- `generateInitialWorld()` 完成后，尚未加载的目标 chunk 也已在 `WorldBlockDataStore` 中拥有对应 slice
- bootstrap chunk 后续首次加载时，走的是 attach / rebuild，而不是把旧 `WorldStore` 当成 live truth 回源
- 不依赖 `saveRegionRecord()` 也能完成同会话内 bootstrap -> load -> unload -> reload 闭环
- cross-region overflow 在 bootstrap 路径里仍能正确并入目标 authority slice

- [ ] **Step 2: 重构 `generateInitialWorld()` / `_generateRegion()` 的 runtime 落点**

要求：

- 预生成结果的 runtime 主落点改为 `WorldBlockDataStore`
- `_writeRegionToMemoryStore` 一类旧内存权威写入路径必须退出
- `RegionRecord` / chunk 结果整理后，先写 authority，再决定是否触发已加载 chunk 的 attach / rebuild
- `WorldStore.saveRegionRecord()`、`saveWorldMeta()` 若暂时保留，只能作为 deferred / future hook，不得作为 runtime 正确性的必要步骤

- [ ] **Step 3: 处理 bootstrap 路径中的 overflow 与未加载 chunk**

要求：

- cross-region overflow 合并后，目标 chunk 的 `blockData` 必须先进入 authority
- 目标 chunk 尚未加载时，不得因为没有 live chunk view 就跳过写入
- bootstrap 期间 authority 必须能够独立持有未加载 chunk 的 slice，等待未来 attach
- bootstrap 期间也必须同步建立 chunk presence / generation state，不允许把“空 slice”误当缺失 chunk

- [ ] **Step 4: 对齐 bootstrap chunk 的后续加载来源**

要求：

- bootstrap 后续通过 `World.update()` 创建 chunk 时，应优先从 `WorldBlockDataStore` attach / rebuild
- 不允许重新退回“先从旧 `WorldStore` / region persist 读取，再把结果当真相注入 chunk”的旧路径
- 若冷边界接口暂时保留，必须在代码注释中明确：bootstrap runtime 真相已由 authority 持有

- [ ] **Step 5: 运行相关测试**

Run:
- 测试页面运行 `test-world.js`
- 运行 `test-world-runtime.js`

Expected:
- bootstrap generation 到 authority 的主链路稳定成立
- 之后的 chunk load / unload / reload 闭环不再依赖旧持久化路径

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

说明：

- 这里特别点名的结构，是热路径上最需要优先锁死的保留项
- 但它们不是本次改造的完整保留清单
- `Section 6` 中其他已列出的派生结构，也默认属于保留对象，只是测试优先级和强调程度不同

明确覆盖：

- `Chunk.visibleKeys` 仍服务可见性判断
- `Chunk.solidBlocks` 仍服务碰撞判断
- `Chunk.blockDataArray` 仍作为 chunk 内紧凑快路径
- `Chunk.solidBlockIds` 仍配合数组路径做 O(1) 实心判断
- `Chunk.blockPalette` / `Chunk.blockPaletteReverse` 仍支撑 `blockDataArray` 紧凑映射
- `Chunk.lightSourceCoords` 仍服务光源索引
- `Chunk.dirtyAOPositions` 仍服务 AO 增量刷新
- `Chunk.instanceIndexMap` / `meshData` / `renderDelta` 仍服务渲染派生层

- [ ] **Step 2: 运行测试，确认索引层行为当前有覆盖缺口**

Run:
- 测试页面运行相关测试

Expected:
- 至少需要补一个或多个更明确的断言

- [ ] **Step 3: 检查 AO mirror / renderDelta / tombstone 相关逻辑**

要求：

- 明确保留 `deletedBlockTombstones`
- AO mirror 继续从 `blockData` 派生
- `lightSourceCoords` 继续从 `blockData` 派生，不退回全量扫描
- `blockPalette` / `blockPaletteReverse` 继续作为 `blockDataArray` 配套结构存在
- `instanceIndexMap` / `meshData` 继续服务局部渲染更新
- `renderDelta` 仍供全局实例系统消费

- [ ] **Step 3.5: 明确保留范围不止四个热路径结构**

要求：

- 在实现说明、注释或测试命名中明确：`visibleKeys`、`solidBlocks`、`blockDataArray`、`solidBlockIds` 是“重点锁定的热路径保留项”，不是完整保留清单
- `blockPalette` / `blockPaletteReverse`、`lightSourceCoords`、`dirtyAOPositions`、`instanceIndexMap`、`meshData`、`renderDelta`、`deletedBlockTombstones` 仍默认保留
- `entityCollisionIndex` 继续保持独立的特殊实体碰撞语义，不并入 `blockData` / `solidBlocks`
- 除非后续专项设计明确替代方案，本次 authority 重构不得顺手删除这些结构

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

- [ ] **Step 3.2: 拆分 runtime dirty 与 export/save dirty**

要求：

- `markChunkDirty()` 只表达 runtime 后续处理需求
- 若需要保留 future save dirty，必须显式拆成独立字段、独立注释、独立调度
- 禁止 runtime dirty 默认附带“顺手准备持久化快照”的旧语义

- [ ] **Step 3.5: 降级 `RegionCache` 中的 blockData 语义**

要求：

- 明确 `RegionCache` 不再承担 runtime live `blockData` 权威职责
- `cachedChunkRecord.blockData` 只允许作为冷边界输入或测试夹具输入
- authority 建立后，runtime 热路径不得继续依赖 `_resolveSerializedBlockData()` 一类逻辑从 `RegionCache.blockData` 取 live truth
- 若 `RegionCache` 仍保留 chunk record / entity / region 管理信息，必须在代码注释中明确其降级身份

- [ ] **Step 4: 修改 `ChunkPersistence.saveDebounced()`**

要求：

- 不再直接依赖 `runtime.flushChunk()`
- 本阶段允许只保留防抖 dirty 标记，或直接让它成为 no-op

- [ ] **Step 5: 将 `flushChunk()` 和 `pendingUnloadFlushQueue` 明确降级**

要求：

- 注释标明不再参与 runtime 正确性
- 若暂时保留，仅作为未来冷存储恢复时的兼容工具

- [ ] **Step 5.5: 为 snapshot 消费者逐一定义命运**

要求：

- 对以下路径逐一标记为 delete / deferred shell / authority-based rewrite：
  - `_resolveSerializedBlockData()`
  - `flushChunk()`
  - `flushBeforeUnload()`
  - `flushAllDirty()`
  - `_ensureDirtyChunkEntry()` 中 `blockDataSnapshot` 相关字段
- 禁止留下“snapshot 已不再可靠，但消费者仍沿用旧回退链”的中间态
- 若某方法继续保留，必须在注释中明确：
  - 它是否仍参与 runtime 主链路
  - 它若取数据，新来源是什么

- [ ] **Step 5.8: 重写运行时测试语义**

要求：

- `src/tests/test-world-runtime.js` 从“flush/snapshot 正确性”迁移为“authority attach/reload/deferred cold boundary”语义
- `src/tests/test-runtime-session-persistence.js` 从“cache 是会话权威”迁移为“authority 是会话权威，cache/worker 只是导出或冷边界”
- 删除或彻底改写 `src/tests/test-memory-world-store.js`

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
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定“热路径不允许全量 clone”约束**

重点覆盖：

- 单块修改
- 批量改单块
- 普通运行中的 chunk unload

测试不要求精确测时间，但要能证明：

- 不再依赖整份 `blockDataSnapshot`
- 不再用持久化理由对整 chunk 做热路径全量复制
- `WorldBlockDataStore` / `Chunk.blockData` 共享同一个 `Map` 实例，而不是通过额外复制维持一致

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
- 将 `replaceChunkSlice()` 的调用点限制在生成、导入、测试夹具、冷边界恢复
- 为热路径保留局部 patch API，禁止单块修改/批量修改回退到整块替换
- 通过测试或断言确保不会出现“authority 写一次 + chunk map 再写一次”的重复 mutation 流程
- 明确 `replaceChunkSlice()` 的职责是 store 侧整块 authority 替换，而不是 `Chunk` 侧“clear 后重灌”

- [ ] **Step 4: 明确允许 clone 的边界**

代码和注释中只允许在以下边界做全量复制：

- Worker 消息边界
- 测试快照
- 未来导出存档
- 未来冷存储恢复前的显式序列化边界

- [ ] **Step 4.5: 对齐测试夹具与 worker 边界格式**

要求：

- 测试夹具可以继续使用 plain object，但进入 runtime authority 前必须走 codec
- worker 消息边界允许继续使用序列化对象，不要求直接传 `Map`
- 注释中明确：plain object 是 boundary format，不是 runtime authority format

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
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定“runtime 不再依赖旧持久化层”**

测试覆盖：

- `PersistenceService.cache` 不再承载 runtime blockData 权威
- `WorldStore.getChunkRecord()` 不是 runtime 主链路的必需前提
- `collectSnapshot()` / `applySaveData()` 若继续保留，应显式标记 deferred 或兼容路径
- `RegionCache.blockData` 不再是 runtime 热路径的 live truth 来源

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
- `WorldRuntime.ensureChunkData()` 若暂时仍承接冷边界输入，必须在注释中明确：它不再是 runtime 正确性的权威来源，只是未来冷恢复接入点或过渡边界
- `WorldGenerationService` 若暂时仍保留 `saveRegionRecord()` / `saveWorldMeta()` 一类调用，必须在注释中明确：这些调用不是本阶段生成正确性的组成部分
- `RegionCache` 若继续缓存带 `blockData` 的 chunkRecord，也必须在注释中明确：这些 `blockData` 只用于冷边界输入，不得作为 live authority

- [ ] **Step 3.2: 收紧 `WorldRuntime.ensureChunkData()` 的边界语义**

要求：

- 明确它的职责是 cold boundary import / compatibility bridge，而不是 live authority owner
- 若该方法返回 plain-object `chunkRecord`，必须在进入 runtime authority 前走 codec 与 registry
- `missing-chunk` 判定必须与 `WorldChunkRegistry` 对齐，不能再由旧 `WorldStore` 是否命中单独决定

- [ ] **Step 4: 运行运行时测试**

Run:
- 浏览器测试页运行 `test-world-runtime.js`

Expected:
- runtime 路径不再把持久化层当成正确性前提
- 特殊实体兼容链路不会因 authority 重构而被冷边界降级逻辑误伤

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 7.5: 明确 AO Worker mirror 的派生副本契约

**Files:**
- Modify: `src/core/AOBridge.js`
- Modify: `src/world/Chunk.js`
- Modify: `src/workers/AOWorker.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定 AO mirror 不是第二权威**

测试覆盖：

- `aoBridge.enqueueSet/delete/batch` 继续作为 authority -> AO mirror 的单向同步路径
- AO Worker mirror 延迟或重建不会改变 runtime `blockData` 真相
- AO 结果回包不会反向覆写 authority

- [ ] **Step 2: 明确代码边界**

要求：

- `AOWorker` 不直接访问 `WorldBlockDataStore`
- `AOBridge` 继续承担 authority 到 worker mirror 的单向同步
- 注释中明确 AO mirror 是派生副本，不是第二权威
- 若 AO mirror 需要全量重播或重新播种，来源必须是 authority 序列化边界，而不是旧 cache / snapshot

- [ ] **Step 3: 运行相关测试**

Run:
- 测试页面运行 `test-chunk.js`
- 运行 `test-world-runtime.js`

Expected:
- AO mirror 契约成立，且不与唯一 authority 语义冲突

- [ ] **Step 4: 运行 lint**

Run: `npm run lint`
Expected: PASS

---

### Task 8: 完整回归与性能验证

**Files:**
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`
- Test: `src/tests/test-runtime-session-persistence.js`
- Test: `src/tests/test-world-generation-cross-region.js`

- [ ] **Step 1: 运行浏览器内测试全套回归**

Run:
- `npm run start`
- 打开 `http://localhost:8080/src/tests/index.html`
- 点击“运行所有测试”

Expected:
- 所有与 runtime authority 相关的现有测试通过
- 已删除/已替换的旧测试不再依赖 `MemoryWorldStore` 或 session cache 权威语义

- [ ] **Step 2: 手动验证单块修改与 reload**

手动步骤：

1. 放置方块
2. 删除方块
3. 离开区块触发卸载
4. 返回原区块触发 reload

Expected:
- 方块状态与 unload 前一致
- 不需要 `flushChunk()` / `PersistenceService.cache` / `WorldStore.commitChunkRecord()` 也能完成 runtime reload

- [ ] **Step 2.5: 手动验证跨 chunk patch 与玩家修改不互相覆盖**

手动步骤：

1. 触发带跨 chunk 结构的生成 / 补片
2. 在目标 chunk 对相关位置做玩家修改
3. 离开再返回，或等待 deferred patch / finalize 路径完成

Expected:
- authority 仍以玩家最终修改为准
- 不会出现旧 scatter / append 结果回写覆盖玩家修改

- [ ] **Step 2.75: 手动验证未加载 chunk 的生成结果已先进入 authority**

手动步骤：

1. 触发 bootstrap 预生成或 runtime 扩图
2. 选择一个当下尚未加载、但已生成过的目标 chunk
3. 后续移动到该区域触发 chunk 加载

Expected:
- 该 chunk 加载前，对应 slice 已存在于 `WorldBlockDataStore`
- 加载时执行的是 attach / rebuild，而不是重新向旧持久化层回源作为真相来源
- 不依赖 `saveRegionRecord()` 也能完成当前会话内的生成 -> 未来加载闭环

- [ ] **Step 3: 手动验证 runtime-only 模式下的降级边界**

手动步骤：

1. 不执行手动存档 / 读档
2. 只验证当前会话内的生成、编辑、卸载、重载闭环
3. 检查控制台无把旧持久化路径当成 runtime 必要前提的报错

Expected:
- runtime-only 闭环稳定
- 冷存储路径缺席不会破坏当前会话内正确性
- 方块状态正确恢复

- [ ] **Step 3.2: 手动验证特殊实体兼容性**

手动步骤：

1. 验证矿车、丧尸巢穴、炮塔在改造后仍能生成或被恢复到既有运行状态
2. 验证它们与玩家的互动不回退
3. 验证它们与主世界方块、碰撞、流式加载/卸载的交互不回退
4. 对包含这些特殊实体的 chunk 执行 unload / reload，再次验证行为

Expected:
- 特殊实体的渲染、更新、互动、与主世界/玩家的交互能力保持正常
- `blockData authority` 重构不会导致特殊实体失活、丢失或交互异常

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
