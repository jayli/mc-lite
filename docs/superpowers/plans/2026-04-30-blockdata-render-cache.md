# BlockData Render Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `ChunkRecord` 增加非权威 `renderCache` 快速上屏层，并让 runtime 纯加载优先消费 cache，避免主线程重复遍历 `blockData` 构建 `meshData`。

**Architecture:** 使用内嵌于 `ChunkRecord` 的 `renderCache + contentRevision` 方案。先打通 `WorldStore / WorldRuntime / PersistenceWorker` 对新字段的读写保真，再接入 pregen / consolidation 的 cache 生产，最后切换 `Chunk` 纯加载主路径到 cache-first。P0 的 miss/stale 保留主线程稳定兜底；worker fallback 下放到 P1 可选增强。

**Tech Stack:** JavaScript ES Modules、Three.js、Web Worker、IndexedDB(WorldStore/PersistenceWorker)、现有 Chunk/WorldRuntime/WorldGenerationService 渲染与持久化链路。

---

## 文件边界

**新增文件：**
- `src/world/RenderCache.js`：render cache 版本常量、结构校验、状态判定、cache 组装辅助函数

**修改文件：**
- `src/world/Chunk.js`
- `src/world/ChunkConsolidation.js`
- `src/world/WorldRuntime.js`
- `src/world/WorldStore.js`
- `src/workers/PersistenceWorker.js`
- `src/workers/WorldWorker.js`
- `src/world/WorldGenerationService.js`
- `src/constants/GameConfig.js` 或项目当前管理 runtime feature flag 的位置
- `src/tests/test-chunk.js`
- `src/tests/test-world-runtime.js`
- `src/tests/test-world-generation-cross-region.js`
- `src/tests/test-world.js`

**参考文件：**
- `src/world/Chunk.js`
- `src/world/ChunkConsolidation.js`
- `src/world/WorldRuntime.js`
- `src/world/WorldStore.js`
- `src/workers/PersistenceWorker.js`
- `docs/superpowers/specs/2026-04-30-blockdata-render-cache-design.md`

## Task 1: 定义 renderCache/contentRevision 基础模型

**Files:**
- Create: `src/world/RenderCache.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 写失败测试，覆盖 render cache 基础判定**

测试点：
- `schemaVersion` 不匹配时应判定 unusable
- `contentRevision` 不匹配时应判定 stale
- 缺少 `meshData` 或 `visibleKeys` 时应判定 unusable
- 完整结构应判定 hit
- `instanceIndexMap` 应被视为 `meshData` 持久化结构的一部分
- TypedArray 序列化后可恢复为运行时可用结构

- [ ] **Step 2: 运行目标测试，确认当前失败**

访问：`http://localhost:8080/src/tests/index.html`
Expected: render cache 判定相关测试失败，因为模块与函数尚不存在

- [ ] **Step 3: 实现 `RenderCache.js` 最小能力**

实现内容：
- `CURRENT_RENDER_CACHE_SCHEMA_VERSION`
- `CURRENT_RENDER_CACHE_GENERATOR_VERSION`
- `normalizeChunkContentRevision(chunkRecord)`
- `isRenderCacheStructurallyValid(renderCache)`
- `getRenderCacheStatus(chunkRecord)`
- `buildRenderCacheFromWorkerResult({ meshData, visibleKeys, contentRevision })`
- `serializeRenderCache(renderCache)`
- `deserializeRenderCache(renderCache)`

约束：
- 第一版禁止引入 `sourceHash`
- 只做 O(1) 失效判定
- `meshData` 持久化时必须显式处理 TypedArray

- [ ] **Step 4: 重新运行测试，确认通过**

Expected: render cache 基础测试通过

## Task 2: 打通 WorldStore / WorldRuntime / PersistenceWorker 对新字段的保真

**Files:**
- Modify: `src/world/WorldStore.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/workers/PersistenceWorker.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，验证 `contentRevision/renderCache` 不会在读写链路中丢失**

测试点：
- `WorldStore._extractChunkRecord()` 能投影 `contentRevision/renderCache`
- `WorldRuntime.ensureChunkData()` 返回的 `chunkRecord` 含这两个字段
- `applyRegionPatch()` merge 时不会意外抹掉已有 `renderCache`
- `_getCachedChunkRecord()` 返回值若参与补缺，也必须包含新字段

- [ ] **Step 2: 运行目标测试，确认当前失败**

Expected: 当前代码仅读写 `blockData/staticEntities/runtimeSeedData/runtimeEntities`

- [ ] **Step 3: 最小实现数据层字段透传**

实现内容：
- `WorldStore._extractChunkRecord()` 增加 `contentRevision/renderCache`
- `WorldRuntime.ensureChunkData()` 增加 `contentRevision/renderCache`
- `PersistenceWorker.applyChunkPatchToRegion()` 保持对新增字段的 merge 兼容

注意：
- 不在这一任务里接入 cache 消费
- 先保证新字段完整穿透
- 统一旧档默认 `contentRevision = 1`

- [ ] **Step 4: 运行测试，确认新字段读写保真**

Expected: 新字段从 RegionRecord 到 ChunkRecord 往返不丢失

## Task 3: 修正 flush 链路，避免 renderCache 被写丢或写脏

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/WorldStore.js`
- Modify: `src/workers/PersistenceWorker.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，覆盖 flush / pending unload / patch 回写场景**

测试点：
- 仅补写 cache 时不会覆盖掉权威 `blockData`
- dirty chunk flush 会连同最新 `renderCache/contentRevision` 一起写回
- pending unload queue 不会把较新的 cache 回滚成旧值
- `_getCachedChunkRecord()` 只能补缺字段，不能用旧 revision 覆盖实例最新 revision
- patch merge 遇到更小的 `contentRevision` 时不得回退

- [ ] **Step 2: 运行目标测试，确认当前失败**

- [ ] **Step 3: 实现最小写回策略**

实现内容：
- 为 `WorldRuntime` 增加“保留已有权威 blockData，仅补写 cache”的能力
- 统一构建 chunkRecord snapshot 时带上 `contentRevision/renderCache`
- 明确 snapshot 字段来源优先级：
  - `Chunk` 实例当前状态
  - `pendingUnloadFlushQueue` snapshot
  - `_getCachedChunkRecord()`
  - store 默认值
- 必要时扩展 patch metadata，区分：
  - `preserveStoredBlockData`
  - `renderCacheOnly`

约束：
- 不要重构整条 WorldRuntime flush 架构
- 只补足 render cache 所需保真能力
- `pendingUnloadFlushQueue` 中存入的 chunk snapshot 必须完整携带 `contentRevision/renderCache`
- `PersistenceWorker.applyChunkPatchToRegion()` 必须保护 `contentRevision` 单调不回退

- [ ] **Step 4: 运行测试，确认 cache 写回不丢失**

Expected: flush 链路能稳定保留并更新 `renderCache`

## Task 4: 定义 blockData 变更时的 revision 与 cache 失效规则

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，验证权威内容变更会使旧 cache 失效**

测试点：
- chunk 初始记录默认有 `contentRevision`
- `loadFromRecord()` 会把 `contentRevision/renderCache` 挂到 chunk 实例属性
- 方块变更后 revision 递增
- 旧 `renderCache.contentRevision` 与新 `contentRevision` 不一致时应判定 stale

- [ ] **Step 2: 运行目标测试，确认当前失败**

- [ ] **Step 3: 最小实现 revision 规则**

实现内容：
- 旧档兼容默认 revision 为 `1`
- 新生成 chunk 初始化 revision
- `Chunk` 实例新增 `contentRevision/renderCache/renderCacheStatus`
- 所有权威 `blockData` 修改路径递增 revision
- blockData 变化后立即使当前 cache 失效

注意：
- 只在权威内容变化时递增
- 仅 runtimeEntities 改动不得递增
- flushChunk / flushAllDirty 构建 snapshot 时，从 chunk 实例拿最新 revision

- [ ] **Step 4: 运行测试，确认 stale 判定成立**

Expected: blockData 变化后不会继续错误复用旧 cache

## Task 5: 在预生成阶段生产 renderCache，并正确处理 overflow 污染

**Files:**
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/world/WorldGenerationService.js`
- Modify: `src/world/WorldStore.js`（如需补注释）
- Test: `src/tests/test-world-generation-cross-region.js`

- [ ] **Step 1: 写失败测试，覆盖 pregen cache 生成与 overflow 失效**

测试点：
- worker 生成的 chunk 结果包含组装 `renderCache` 所需字段
- 未受 overflow 影响的 chunk 会带上 `renderCache`
- 被 cross-region overflow 修改过 `blockData` 的 chunk，不会继续保留旧 cache
- `renderCache` 写入前会经过序列化规范，TypedArray 不会直接落库

- [ ] **Step 2: 运行目标测试，确认当前失败**

- [ ] **Step 3: 实现预生成 cache 写入逻辑**

实现内容：
- `WorldWorker` 生成结果保留 `meshData/visibleKeys`
- `WorldGenerationService` 为每个 chunk 写入：
  - `contentRevision`
  - `renderCache`（经 `serializeRenderCache()`）
- overflow 合并后，如 `blockData` 被主线程再修改：
  - 递增 `contentRevision`
  - 清空对应 `renderCache`

约束：
- P0 不在主线程为 overflow chunk 补算 cache
- miss 时允许直接走现有主线程兜底

- [ ] **Step 4: 运行测试，确认 pregen 路径正确**

Expected: 正常 chunk 预带 cache，overflow 受影响 chunk 安全 miss

## Task 6: 在 consolidation 阶段刷新 renderCache

**Files:**
- Modify: `src/world/ChunkConsolidation.js`
- Modify: `src/world/Chunk.js`
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，验证 consolidation 成功后生成新 cache**

测试点：
- consolidation worker 回包后 chunk 获得新的 `renderCache`
- 新 cache 绑定当前 `contentRevision`
- 后续 flush/reload 时优先使用新 cache
- cache 写回前遵守序列化规范，读取后仍可恢复 `instanceIndexMap`

- [ ] **Step 2: 运行目标测试，确认当前失败**

- [ ] **Step 3: 复用 worker 回包组装 renderCache**

实现内容：
- 在 `_applyConsolidateResult()` 中使用 `workerMeshData/visibleKeys` 组装 cache
- 将新 cache 挂到 chunk 的稳定快照上
- 在进入持久化快照前执行 `serializeRenderCache()`
- 让 `WorldRuntime` 后续写回带上该 cache

约束：
- 不新增第二套 mesh 计算
- 直接复用 worker 已有输出

- [ ] **Step 4: 运行测试，确认 reload 仍命中新 cache**

Expected: 玩家修改后的 chunk 卸载再加载，不再回退到旧主线程转换路径

## Task 7: 给 Chunk 纯加载主路径接入 renderCache-first

**Files:**
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 写失败测试，验证 cache hit 时不再主线程遍历 blockData**

测试点：
- `loadFromRecord()` 读到有效 cache 时保存为待消费状态
- `assembleRuntimeBuildPhase()` 优先 `_applyRenderCache()`
- hit 场景不调用 `_buildMeshFromExistingBlockData()`
- `visibleKeys` 从 cache 直接恢复
- `deserializeRenderCache()` 后 `meshData.instanceIndexMap` 可直接用

- [ ] **Step 2: 运行目标测试，确认当前失败**

Expected: 当前 `record-ready` 路径仍直接调 `_buildMeshFromExistingBlockData()`

- [ ] **Step 3: 最小实现 cache-first runtime build**

实现内容：
- 在 `Chunk` 中新增：
  - `_applyRenderCache(renderCache)`
  - `_pendingRenderCache`
  - render cache 状态字段
- 修改 `loadFromRecord()`
- 修改 `assembleRuntimeBuildPhase()`

注意：
- 改动重点是 runtime build 状态机，不只是 `loadFromRecord()`
- 同步保留无 world 调度器的测试/孤立路径兼容
- miss/stale 场景 P0 继续允许主线程 `_buildMeshFromExistingBlockData()` 兜底

- [ ] **Step 4: 运行测试，确认 hit 已切换为 cache 主路径**

Expected: cache hit 时 `convertMeshDataMs` 不再来自主线程 blockData 扫描

## Task 8: 增加 feature flag 与性能观测点

**Files:**
- Modify: `src/constants/GameConfig.js` 或现有配置文件
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，验证日志能区分 cache 状态**

测试点：
- `chunk.load-from-record` 能标识：
  - `hit`
  - `miss`
  - `stale`
  - `fallback-main-thread`
- feature flag 关闭时仍走旧逻辑

- [ ] **Step 2: 运行目标测试，确认当前失败**

- [ ] **Step 3: 增加最小可观测字段**

实现内容：
- 增加 `ENABLE_RENDER_CACHE`
- flag 关闭时完全绕过新逻辑，便于回退

建议字段：
- `renderCacheStatus`
- `renderCacheMeshGroups`
- `renderCacheVisibleKeys`
- `renderCacheBytes`（可近似）
- `contentRevision`

- [ ] **Step 4: 运行测试，确认可对比优化效果**

Expected: 可以清晰分辨 hit/miss 场景，并支持开关回退

## Task 9: 手工验证

**Files:**
- Modify: 无

- [ ] **Step 1: 启动开发服务器**

Run: `npm run start`
Expected: 静态服务器启动在 `http://localhost:8080`

- [ ] **Step 2: 运行浏览器测试**

访问：`http://localhost:8080/src/tests/index.html`
Expected: 相关测试全部通过

- [ ] **Step 3: 手工观察 runtime streaming 日志**

重点关注：
- `chunk.load-from-record`
- `StreamingPerf`
- `mutationQueueBlocks`
- `WorkerRpcClient.js:15 message handler`

Expected:
- cache hit 时不再出现主线程 `convertMeshDataMs` 热点
- miss/stale 时允许出现 `fallback-main-thread`
- 新档 pregen chunk 大多数首屏为 `hit`

- [ ] **Step 4: 对比 feature flag 开关前后**

Expected:
- 开启 cache 后纯加载上屏更快
- 关闭 cache 后行为回退且不影响正确性

## Task 10: P1 Optional - worker fallback renderCache 构建路径

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 写失败测试，覆盖 miss/stale 时的 worker fallback**

测试点：
- cache miss/stale 时 chunk 进入等待 worker cache 状态
- worker 返回后应用新 cache 并完成上屏
- worker 失败时最终才回退 `_buildMeshFromExistingBlockData()`

- [ ] **Step 2: 运行目标测试，确认当前失败**

- [ ] **Step 3: 实现 fallback worker action**

实现内容：
- 在 `WorldWorker` 中增加“从当前 chunkRecord/blockData 构建 renderCache”的 action
- `Chunk` 侧接入等待与消费逻辑
- 成功后通过 `WorldRuntime` 后台补写 cache

约束：
- 这是 P1 增强，不是 P0 必需主路径
- 仅在 P0 稳定后再推进

- [ ] **Step 4: 运行测试，确认 miss/stale 可异步恢复**

Expected: 无 cache/旧 cache 的 chunk 仍能正常上屏，且长尾卡顿进一步下降

## 备注

1. 本计划明确不采用 `sourceHash(blockData)` 作为 P0 失效机制。
2. 本计划将“数据层保真”放在“渲染层消费”之前，这是当前代码下的必要前置。
3. 本计划对 cross-region overflow 采用保守策略：污染即 miss，不在主线程补算 cache。
4. 本计划要求 `Chunk` 实例显式持有 `contentRevision/renderCache/renderCacheStatus`。
5. 本计划要求 `contentRevision` 在 flush / unload / patch merge 过程中保持单调不回退。
6. 本计划要求 render cache 对 TypedArray 做显式序列化/反序列化。
7. 本计划只复用现有 worker 已产出的 `meshData/visibleKeys`，不新增第二套大规模渲染转换逻辑。
8. worker fallback 被下调为 P1 Optional，不是 P0 验收前置。
9. 根据仓库约束，本轮不自动提交；如需提交，等你明确指令再做。
