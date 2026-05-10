# BlockData Authority Unification Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 `blockData authority unification` 首轮实施后仍然悬空的 runtime 权威闭环，彻底收编剩余写入口、冷导入入口、跨 chunk patch 入口，并让 deprecated flush/save 链路退出热路径。

**Architecture:** `WorldBlockDataStore` 继续作为 world-level `blockData` 唯一权威，`Chunk.blockData` 只保留共享视图语义。所有 runtime 写操作必须统一收敛到 store mutation primitive；所有 cold import / scatter / unloaded-target patch 必须先入 authority，再由 loaded chunk attach / rebuild 派生层。`WorldRuntime.flush*` / `ChunkPersistence.saveDebounced()` 只允许保留 deferred shell 或显式 no-op，不再在玩家编辑热路径中执行。

**Tech Stack:** JavaScript, Three.js, Web Workers, ESLint, 浏览器内测试页面 `src/tests/index.html`

---

## Follow-up Scope

本补充计划只处理首轮 authority unification 之后仍未收口的缺口，不重写原设计目标：

- 收拢剩余 blockData 写入口到统一 mutation primitive
- 让 scatter / cross-chunk patch 在目标 chunk 未加载时也先写入 world-level authority
- 让 cold import / `loadFromRecord()` 路径先入 authority，再 attach / rebuild
- 让 deprecated flush/save 链路退出 runtime 热路径
- 增加 shared authority guardrail、观测与退出型测试

本补充计划**不**在本轮交付：

- 新的 IndexedDB 持久化架构
- 手动存档/手动读档的完整 authority-based rewrite
- TypedArray authority 存储
- AO / mesh / face culling 的新一轮性能优化

## 当前缺口清单

1. `Chunk.js` 中 `assembleRuntimeHydratePhase()` 存在双重定义；前一个 authority 版本已成死代码，当前 authority attach 路径依赖“`record-ready` 但 `_pendingChunkRecord` 为空”的隐式巧合工作
2. `Chunk._updateBlockState()` 仍直接写 shared `Map` 并手动递增 `store._versions`
3. `Chunk.acceptScatteredBlocks()` / `appendScatteredBlocks()` 仍存在绕过 store mutation primitive 的路径，且 scatter 写入后没有统一 authority version bump
4. `BlockScatterManager` 对未加载目标 chunk 只保留 pending buffer，没有先写 world-level authority
5. `WorldRuntime.ensureChunkData()` / `Chunk.loadFromRecord()` 冷导入链路还没有先写 `WorldBlockDataStore` / `WorldChunkPayloadRegistry` / `WorldChunkRegistry`
6. `markChunkDirty() -> _scheduleFlush() -> flushChunk()` 链路仍在热路径实际执行
7. `ChunkPersistence.saveDebounced()` 仍触发 `flushChunk()`
8. shared authority 模式下 guardrail 不足，仍缺少针对 live attached slice 的开发期保护
9. 测试主要是兼容旧语义，缺少 authority 新约定的直接覆盖

## 文件结构与职责

### 重点修改文件

- Modify: `src/world/WorldBlockDataStore.js`
  - 补齐唯一合法 mutation primitive
  - 提供 attach-aware patch API、authority version 统一递增、开发期 guardrail
- Modify: `src/world/Chunk.js`
  - 把 `_updateBlockState()`、`acceptScatteredBlocks()`、`appendScatteredBlocks()` 收缩为派生层同步 helper / store 编排调用方
  - 避免直接操作 shared authority slice
- Modify: `src/world/BlockScatterManager.js`
  - 把未加载目标 chunk 的 scatter / deferred patch 先写入 world-level authority
  - 保留 buffer 仅作为派生层/渲染补刷协调结构
- Modify: `src/world/World.js`
  - runtime chunk attach 路径与 cold import 路径统一为“先入 authority，再 attach/rebuild”
- Modify: `src/world/WorldRuntime.js`
  - 退出 `markChunkDirty()` 的自动 flush 调度
  - 收缩 `flushChunk()` / `flushBeforeUnload()` / `flushAllDirty()` 到 deferred shell
- Modify: `src/world/ChunkPersistence.js`
  - 退出 runtime 自动保存职责，改为 no-op / dirty marker shell / 明确 deprecated
- Modify: `src/core/Game.js`
  - 明确 `collectSnapshot()` / `applySaveData()` 的本阶段命运与注释边界
- Modify: `src/tests/test-world-runtime.js`
  - 重写为“旧 flush 退出热路径，但 shell 仍可单测”的测试语义
- Modify: `src/tests/test-world.js`
  - 增加 world-level authority attach / unload / reload / scatter 行为覆盖
- Modify: `src/tests/test-runtime-session-persistence.js`
  - 把 `loadFromRecord()` 相关测试迁移为 authority import 语义
- Modify: `src/tests/test-block-scatter-manager.js`
  - 增加未加载目标 chunk 先写 authority 的测试

### 需要重点核查但不必默认改动的文件

- Inspect: `src/world/ChunkConsolidation.js`
- Inspect: `src/world/ChunkRenderUtils.js`
- Inspect: `src/world/WorldGenerationService.js`
- Inspect: `src/world/WorldChunkPayloadRegistry.js`
- Inspect: `src/world/WorldChunkRegistry.js`

## 验收矩阵

- 所有 runtime blockData mutation 都通过 `WorldBlockDataStore` 的公开原语完成
- loaded chunk 不再手动碰 `store._versions`
- scatter / cross-chunk patch 命中未加载目标 chunk 时，authority 先更新，目标 chunk 未来加载时可直接 attach/rebuild
- cold import / `ensureChunkData()` / `loadFromRecord()` 不再把 plain object 直接注入 chunk-local truth
- 玩家单块编辑后，不再自动调度 `flushChunk()` / IndexedDB 写入
- `ChunkPersistence.saveDebounced()` 不再在 runtime 热路径承担正确性或保存职责
- old deferred shell 即使保留，也不能再把 `RegionCache.blockData` 当 live truth 回写覆盖 authority
- 至少有退出型测试证明：关闭 `flushChunk()` 后，edit -> unload -> reload 在当前会话内仍正确

---

### Task 0: 固定补充阶段边界与收尾目标

**Files:**
- Modify: `docs/superpowers/plans/2026-05-10-blockdata-authority-unification-followup.md`
- Modify: `docs/superpowers/specs/2026-05-07-blockdata-authority-unification-design.md`

- [ ] **Step 1: 在设计文档中追加 follow-up 边界说明**

要求：

- 明确本补充阶段是首轮 authority unification 的收尾收口
- 明确重点是“入口统一”和“旧热路径退出”，不是新持久化方案
- 明确本轮仍允许保留 deferred shell，但不允许继续实际参与 runtime 热路径

- [ ] **Step 2: 写清 cold import / scatter / unloaded-target patch 的统一语义**

要求：

- cold import 必须先入 authority，再 attach/rebuild
- scatter 对未加载目标 chunk 也必须先写 authority
- pending buffer 只能表示“派生层/渲染补刷未完成”，不能表示“truth 尚未写入”

- [ ] **Step 3: 写清 deprecated shell 的允许边界**

要求：

- `flushChunk()` / `flushBeforeUnload()` / `flushAllDirty()` 若保留，只能服务 future export / manual save
- `saveDebounced()` 不能再驱动 runtime 正确性
- `RegionCache.blockData` 不能再被 shell 当作 live truth fallback

---

### Task 0.5: 清理 runtime hydrate 状态机与 authority-path 死代码

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-runtime-session-persistence.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 hydrate 状态机契约**

测试目标：

- `Chunk` 上只保留一个 `assembleRuntimeHydratePhase()` 定义
- authority attach 路径与 cold import 路径都经过同一套明确的 hydrate 状态机
- 不允许继续依赖“`loadState = record-ready` 但 `_pendingChunkRecord = null`”的隐式巧合

- [ ] **Step 2: 运行测试，确认当前实现存在双定义与死代码问题**

Run:

- 浏览器测试页运行 `test-runtime-session-persistence.js`
- 浏览器测试页运行 `test-world.js`

Expected:

- 新增测试先失败，显示 authority attach 路径与 cold import 路径的 hydrate 约定不清晰

- [ ] **Step 3: 合并两个 `assembleRuntimeHydratePhase()`**

要求：

- 删除死代码定义，只保留一个 runtime hydrate 入口
- 明确区分两类输入：
  - authority attach 后只需 rebuild/补尾部 payload 的路径
  - cold import record 需要先建立 authority 再进入的路径
- 不允许同名方法靠后定义覆盖前定义

- [ ] **Step 4: 收紧 `record-ready` 的状态语义**

要求：

- 明确 `record-ready` 是否必须伴随 `_pendingChunkRecord`
- 若 authority attach 路径不需要 `_pendingChunkRecord`，则应使用显式标志或拆分状态，而不是依赖空数据快速路径
- `World._requestRuntimeChunkRecord()` 的注释与真实执行语义一致

- [ ] **Step 5: 明确 `_injectBlockData*` / `_clearForBlockInjection` 的命运**

要求：

- `_injectBlockData()`：收缩为“从 cold input 重建派生层”的 helper，或删除
- `_injectBlockDataBatch()`：若保留，只允许做分帧派生层 rebuild，不再承担 truth injection
- `_clearForBlockInjection()`：确认实现与注释一致，不得触碰 authority slice
- 这些 helper 的注释必须明确自己是否还参与 runtime 主链路

- [ ] **Step 6: 运行 hydrate 相关测试**

Run:

- 浏览器测试页运行 `test-runtime-session-persistence.js`
- 浏览器测试页运行 `test-world.js`

Expected:

- authority attach 与 cold import 的 hydrate 语义清晰且通过测试

---

### Task 1: 建立唯一合法 mutation primitive，并收编 chunk 写入口

**Files:**
- Modify: `src/world/WorldBlockDataStore.js`
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定“Chunk 不得直接修改 shared Map”约束**

测试目标：

- `_updateBlockState()` 触发后，authority version 来自 store 公开 API，而不是手动碰私有字段
- `acceptScatteredBlocks()` / `appendScatteredBlocks()` 写入后 authority version 正确变化
- scatter / deferred cross-chunk patch 写入后 authority version 必须统一 bump
- `WorldBlockDataStore.stats.mutations` 能反映这些 runtime mutation

- [ ] **Step 2: 运行相关测试，确认当前实现仍绕过 store 原语**

Run:

- 浏览器测试页运行 `test-world.js`
- 浏览器测试页运行 `test-world-runtime.js`

Expected:

- 新增测试先失败，显示 `_updateBlockState()` / scatter 路径未走 store mutation primitive

- [ ] **Step 3: 扩展 `WorldBlockDataStore` 公开 mutation API**

要求：

- 提供单块 set/delete 原语
- 复用或扩展现有 `applyChunkPatch(cx, cz, patches)` 作为 chunk-level patch 原语
- 原语内部统一完成：
  - entry 规范化
  - version 递增
  - 统计计数
  - attached / missing slice guard

- [ ] **Step 4: 把 `Chunk._updateBlockState()` 改为 store 原语调用方**

要求：

- `Chunk` 不再直接 `this.blockData.set/delete`
- `Chunk` 不再直接写 `store._versions`
- `Chunk` 只负责派生层同步：
  - `visibleKeys`
  - `solidBlocks`
  - `lightSourceCoords`
  - `blockDataArray`
  - `solidBlockIds`
  - AO / tombstone / render delta

- [ ] **Step 5: 把 `acceptScatteredBlocks()` / `appendScatteredBlocks()` 改为 store 原语调用方**

要求：

- 首次接收 scatter 时不直接改 shared Map
- 增量 patch 时也不直接改 shared Map
- scatter 的批量写入默认走 `WorldBlockDataStore.applyChunkPatch()`
- scatter / deferred patch 不允许遗漏 authority version bump
- 允许一次 patch 后再重建/增量同步派生层

- [ ] **Step 6: 运行测试确认写入口已经统一**

Run:

- 浏览器测试页运行 `test-world.js`
- 浏览器测试页运行 `test-world-runtime.js`

Expected:

- 新增 authority mutation 测试通过
- 旧功能测试不回退

- [ ] **Step 7: 运行 lint**

Run:

- `npm run lint`

Expected:

- 无新增 error

---

### Task 2: 让 scatter / cross-chunk patch 在未加载目标 chunk 上先入 authority

**Files:**
- Modify: `src/world/BlockScatterManager.js`
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-block-scatter-manager.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定“未加载目标 chunk 也先写 authority”约束**

测试目标：

- `BlockScatterManager.scatter()` 命中未加载目标 chunk 时，`WorldBlockDataStore` 立刻有对应 slice / entry
- 目标 chunk 未来加载时，不依赖 source chunk 再次生成也能 attach/rebuild
- pending buffer 只表示待补刷的 render/derived work，而不是待写 truth

- [ ] **Step 2: 运行测试确认当前实现仍只保留 pending buffer**

Run:

- 浏览器测试页运行 `test-block-scatter-manager.js`

Expected:

- 新增测试先失败，显示未加载目标 chunk 时 authority 未建立

- [ ] **Step 3: 重构 `BlockScatterManager` 的数据流**

要求：

- own chunk routing 结果：先写 authority，再通知 ready chunk 消费
- overflow / deferred cross-chunk patch：目标 chunk 无论是否已加载，都先写 authority
- 不能仅以 `pendingCrossChunkPatchBuffers` 充当 truth 挂起区
- `chunkBuffers` / `pendingCrossChunkPatchBuffers` 改为“派生层待装配队列”

- [ ] **Step 4: 对齐 `Chunk.acceptScatteredBlocks()` / `appendDeferredCrossChunkPatch()` 的职责**

要求：

- loaded chunk 消费 scatter 时，默认 authority 已经存在
- chunk 方法只做 attach 后的 rebuild / incremental derived sync
- 不再承担“顺便建立 truth”的职责

- [ ] **Step 5: 运行 scatter / world 测试**

Run:

- 浏览器测试页运行 `test-block-scatter-manager.js`
- 浏览器测试页运行 `test-world.js`

Expected:

- 未加载目标 chunk authority 测试通过
- 现有 scatter 行为不回退

---

### Task 3: 统一 cold import 路径，先入 authority 再 attach / rebuild

**Files:**
- Modify: `src/world/World.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/Chunk.js`
- Modify: `src/world/WorldChunkRegistry.js`
- Modify: `src/world/WorldChunkPayloadRegistry.js`
- Test: `src/tests/test-runtime-session-persistence.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 imported chunk 与 generated chunk 的统一 authority 语义**

测试目标：

- `ensureChunkData()` 返回 chunkRecord 后，会先写 `WorldBlockDataStore`
- 同时写入 `WorldChunkPayloadRegistry`
- 同时标记 `WorldChunkRegistry.markChunkImported()`
- chunk reload 后从 authority attach/rebuild，而不是再次把 plain object 注入 chunk-local truth

- [ ] **Step 2: 运行测试确认当前 imported 路径仍未进入 authority store**

Run:

- 浏览器测试页运行 `test-runtime-session-persistence.js`
- 浏览器测试页运行 `test-world.js`

Expected:

- 新增测试先失败，显示 imported chunk 仍只活在 live chunk / chunkRecord 注入链路

- [ ] **Step 3: 在 `WorldRuntime.ensureChunkData()` 或等价编排点建立 authority import helper**

要求：

- plain object `blockData` 先反序列化为 `Map`
- 写入 `WorldBlockDataStore`
- 写入 payload registry
- 标记 chunk registry imported
- 再把“如何 attach/rebuild loaded chunk”交给 `World`

- [ ] **Step 4: 收缩 `Chunk.loadFromRecord()` 的职责**

要求：

- 若保留此命名，只允许它作为冷边界编排/兼容壳层
- 不再直接承担“把 record.blockData 注入当前 chunk truth”
- 优先走 attach existing authority slice + rebuild derived indexes

- [ ] **Step 5: 运行 cold import 相关测试**

Run:

- 浏览器测试页运行 `test-runtime-session-persistence.js`
- 浏览器测试页运行 `test-world.js`

Expected:

- imported / generated 两条路径的 authority 语义一致

- [ ] **Step 6: 运行 lint**

Run:

- `npm run lint`

Expected:

- 无新增 error

---

### Task 4: 让 deprecated flush/save 链路彻底退出 runtime 热路径

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/ChunkPersistence.js`
- Modify: `src/world/World.js`
- Modify: `src/core/Game.js`
- Test: `src/tests/test-world-runtime.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定“玩家编辑后不再自动调度 flushChunk()”约束**

测试目标：

- `markChunkDirty()` 不再调 `_scheduleFlush()`
- `saveDebounced()` 不再调 `flushChunk()`
- `flushChunk()` 若保留，只能显式调用

- [ ] **Step 2: 运行测试确认旧 flush 调度链仍活跃**

Run:

- 浏览器测试页运行 `test-world-runtime.js`
- 浏览器测试页运行 `test-world.js`

Expected:

- 新增测试先失败，显示自动 flush 仍被调度

- [ ] **Step 3: 收缩 `markChunkDirty()` / `_scheduleFlush()`**

要求：

- runtime dirty 只用于观测、导出标记或 future save hook
- 默认不再自动发起 `flushChunk()`
- 若保留 `_scheduleFlush()`，必须从 runtime 热路径解绑

- [ ] **Step 4: 收缩 `ChunkPersistence.saveDebounced()`**

要求：

- 明确标记 `@deprecated`
- 改为 no-op、dirty marker shell 或显式告警壳层
- 不允许继续实际写 `WorldStore`

- [ ] **Step 5: 为 `flushChunk()` / `flushBeforeUnload()` / `flushAllDirty()` 定义 shell 语义**

要求：

- 明确它们不再从 `RegionCache.blockData` 推导 live truth
- 若需要保留测试/未来导出能力，必须要求显式 snapshot / export source
- 不允许 silent fallback 到旧缓存数据覆盖 authority

- [ ] **Step 6: 对齐 `collectSnapshot()` / `applySaveData()` 注释与边界**

要求：

- 若本轮不重写，必须显式标注 deferred / compatibility-only
- 不允许文档与实现继续处于语义模糊状态

- [ ] **Step 7: 运行退出型测试**

Run:

- 浏览器测试页运行 `test-world-runtime.js`
- 浏览器测试页运行 `test-world.js`

Expected:

- 玩家编辑、unload、reload 的当前会话闭环不依赖 flush/save

- [ ] **Step 8: 运行 lint**

Run:

- `npm run lint`

Expected:

- 无新增 error

---

### Task 5: 增加 shared authority guardrail 与迁移期观测

**Files:**
- Modify: `src/world/WorldBlockDataStore.js`
- Modify: `src/world/Chunk.js`
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，固定 live attached slice 的防护约束**

测试目标：

- attached slice 上禁止整块 replace
- attached slice 上禁止通过旧 helper 执行 `clear + reinject`
- 直接改写 `Chunk.blockData = new Map()` 只允许发生在 detach/dispose 边界

- [ ] **Step 2: 在 store 中补 guardrail**

要求：

- 对 live attached slice 的整块 replace 保持显式告警或抛错
- 增加开发期断言 helper，检查 authority slice identity 和 attach 状态
- 记录 mutation / replace / fallback 路径统计

- [ ] **Step 3: 在 chunk 侧补 guardrail**

要求：

- 保留 `detachAuthoritySlice()` 作为唯一合法脱钩入口
- 对旧 helper 增加注释或重命名，避免再次被误用为 truth injection

- [ ] **Step 4: 在 runtime 侧补观测**

要求：

- 统计 `flushChunk()`、`flushBeforeUnload()`、`saveDebounced()`、`RegionCache` fallback 命中次数
- 日志区分 authority mutation、cold import、derived rebuild、deferred export shell

- [ ] **Step 5: 运行 guardrail 相关测试**

Run:

- 浏览器测试页运行 `test-world-runtime.js`

Expected:

- guardrail 生效，旧误用路径可被检测

---

### Task 6: 重写 authority 语义测试并完成最终回归

**Files:**
- Modify: `src/tests/test-world-runtime.js`
- Modify: `src/tests/test-world.js`
- Modify: `src/tests/test-runtime-session-persistence.js`
- Modify: `src/tests/test-block-scatter-manager.js`

- [ ] **Step 1: 删除或改写仍然把旧 flush 行为当作“推荐语义”的测试**

要求：

- 不再把“dirty 时优先复用 region cache blockData”写成推荐行为
- shell 相关测试若保留，必须明确它们只验证 deferred/export 兼容边界

- [ ] **Step 2: 增加 authority 新约定测试矩阵**

至少覆盖：

- 单块编辑走 store primitive
- scatter 写入会 bump authority version
- 未加载目标 chunk 的 patch 先入 authority
- imported chunk 先入 authority，再 attach/rebuild
- 关闭 flush/save 后 runtime unload/reload 仍正确

- [ ] **Step 3: 运行浏览器内测试全套回归**

Run:

- 启动 `npm run start`
- 访问 `http://localhost:8080/src/tests/index.html`
- 点击“运行所有测试”

Expected:

- 所有相关测试通过

- [ ] **Step 4: 手动验证 runtime-only 闭环**

验证点：

- 玩家改单块后 500ms 内不再自动出现 flush/save 热路径写盘
- 卸载后 reload 能从 world-level authority 恢复
- 跨 chunk scatter / deferred patch 不会因目标 chunk 未加载而丢失
- 特殊实体行为不回退

- [ ] **Step 5: 运行 lint 作为最终门禁**

Run:

- `npm run lint`

Expected:

- 无新增 error

- [ ] **Step 6: 记录最终结论**

结论中必须明确：

- 哪些入口已经完全统一到 authority mutation primitive
- 哪些 deprecated shell 还保留、但已退出热路径
- 哪些 deferred 能力仍未重写
- 为下一步性能优化留下了哪些可直接利用的前提
