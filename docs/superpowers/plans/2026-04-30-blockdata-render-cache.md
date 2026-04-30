# BlockData Render Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `ChunkRecord` 增加非权威 `renderCache` 快速上屏层，消灭 `load-from-record` 主线程重复扫描 `blockData` 并生成 `meshData` 的热路径。

**Architecture:** 在 `ChunkRecord` 中内嵌 `renderCache`，由 worker 在预生成与重建路径中产出，runtime 纯加载优先消费 cache。`blockData` 继续作为唯一权威世界真相；`renderCache` 仅服务快速上屏，缺失或失效时回退到 worker 重建并后台补写。

**Tech Stack:** JavaScript ES Modules、Three.js、Web Worker、IndexedDB(WorldStore/PersistenceWorker)、现有 Chunk/WorldRuntime/WorldGenerationService 渲染链路。

---

## 文件边界

**新增文件：**
- `src/world/RenderCache.js`：`renderCache` 结构校验、版本常量、source hash 计算、失效判定

**修改文件：**
- `src/world/Chunk.js`：`loadFromRecord()` 优先消费 `renderCache`，主线程 `_buildMeshFromExistingBlockData()` 降级为 fallback
- `src/world/ChunkGenerator.js`：需要时为 fallback worker build path 提供统一入口
- `src/world/WorldGenerationService.js`：预生成阶段写入 `renderCache`
- `src/workers/WorldWorker.js`：region/chunk 生成结果附带 `renderCache`
- `src/world/ChunkConsolidation.js` 或相关 consolidation 回包消费文件：合并完成后同步更新 `renderCache`
- `src/world/WorldRuntime.js`：后台补写 `renderCache` 时复用现有 WorldStore 写回路径
- `src/world/WorldStore.js`：必要时补充 `renderCache` 相关读写注释/类型约束
- `src/tests/test-chunk.js`
- `src/tests/test-world-generation-cross-region.js` 或 `src/tests/test-world.js`
- `src/tests/test-world-runtime.js`

**参考文件：**
- `src/world/Chunk.js`
- `src/world/WorldRuntime.js`
- `src/world/WorldGenerationService.js`
- `docs/superpowers/specs/2026-04-30-blockdata-render-cache-design.md`

## Task 1: 定义 renderCache 结构与失效规则

**Files:**
- Create: `src/world/RenderCache.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 写失败测试，覆盖 renderCache 结构判定与失效规则**

测试点：
- `version` 不匹配应失效
- `sourceHash` 不匹配应失效
- 缺少 `meshData`/`visibleKeys`/`lightSources` 应失效
- 结构完整时应判定有效

- [ ] **Step 2: 运行目标测试，确认当前失败**

Run: `npm run start` 后打开 `http://localhost:8080/src/tests/index.html`
Expected: render cache 相关测试失败，因为模块与函数尚不存在

- [ ] **Step 3: 实现 `RenderCache.js` 最小能力**

实现内容：
- `CURRENT_RENDER_CACHE_VERSION`
- `CURRENT_RENDER_CACHE_GENERATOR_VERSION`
- `computeRenderCacheSourceHash(chunkRecord)`
- `isRenderCacheStructurallyValid(renderCache)`
- `isRenderCacheUsable(chunkRecord)`

约束：
- 先用稳定、简单的 hash
- 不追求极致性能，先保证一致性

- [ ] **Step 4: 重新运行测试，确认通过**

Run: 浏览器测试页点击“运行所有测试”
Expected: render cache 结构与失效判定测试通过

## Task 2: 给 Chunk 纯加载路径接入 renderCache 主路径

**Files:**
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 写失败测试，验证 `loadFromRecord()` 优先消费 renderCache**

测试点：
- 当 `chunkRecord.renderCache` 有效时，不调用 `_buildMeshFromExistingBlockData()`
- 直接使用 `renderCache.meshData` 构建 mesh
- 直接恢复 `visibleKeys`
- 直接恢复 `lightSourceCoords`

- [ ] **Step 2: 运行目标测试，确认当前失败**

Expected: 现有实现仍会走 `_buildMeshFromExistingBlockData()`

- [ ] **Step 3: 最小实现 Chunk 的 renderCache 应用逻辑**

实现内容：
- 在 `loadFromRecord()` 中加入 `renderCache` 判定
- 新增内部方法，例如：
  - `_applyRenderCache(renderCache)`
  - `_restoreVisibleKeysFromRenderCache(renderCache)`
  - `_restoreLightSourcesFromRenderCache(renderCache)`
- 将 `_buildMeshFromExistingBlockData()` 降级为 fallback

- [ ] **Step 4: 运行测试，确认主路径改为消费 cache**

Expected: 测试通过，主线程不再在有效 cache 情况下重建 meshData

## Task 3: 增加 worker fallback 重建路径

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/world/ChunkGenerator.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 写失败测试，覆盖 cache 缺失/失效时的 worker fallback**

测试点：
- cache 缺失时，不走主线程 `_buildMeshFromExistingBlockData()` 主路径
- 发起 worker render cache build 请求
- worker 返回后应用 render cache 并完成上屏

- [ ] **Step 2: 运行测试，确认当前失败**

- [ ] **Step 3: 为 worker 增加“从 chunkRecord/blockData 构建 renderCache”的消息处理**

实现内容：
- 在 `WorldWorker` 中新增构建 render cache 的 action
- 复用现有 mesh/AO 构建逻辑，直接产出 cache 结构
- 保持结果格式与 `Chunk.buildMeshes()` 兼容

- [ ] **Step 4: 在 Chunk 侧接入 fallback 结果消费**

实现内容：
- `loadFromRecord()` 在 cache 失效时等待 worker 结果
- 成功后调用 `_applyRenderCache()`
- 失败时才允许最终兜底走 `_buildMeshFromExistingBlockData()`

- [ ] **Step 5: 运行测试，确认 fallback 链路可用**

Expected: cache 缺失时仍可加载 chunk，但主路径已切到 worker 而非主线程

## Task 4: 在预生成阶段写入 renderCache

**Files:**
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/world/WorldGenerationService.js`
- Test: `src/tests/test-world-generation-cross-region.js`

- [ ] **Step 1: 写失败测试，验证 region 预生成结果包含 renderCache**

测试点：
- `RegionRecord.chunks[chunkKey]` 中带有 `renderCache`
- `renderCache.sourceHash` 与 `blockData` 对应

- [ ] **Step 2: 运行测试，确认当前失败**

- [ ] **Step 3: 在预生成 worker 结果中为每个 chunk 补齐 renderCache**

实现内容：
- region generation 产出 chunk 时同步生成 render cache
- `WorldGenerationService` 写入 WorldStore 时保持该字段

- [ ] **Step 4: 运行测试，确认新档预生成路径具备 cache**

Expected: 新生成的 region record 已包含 render cache

## Task 5: consolidation 完成后同步刷新 renderCache

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/ChunkConsolidation.js` 或实际 consolidation 回包消费文件
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，验证 runtime 修改后的 chunk 会刷新 renderCache**

测试点：
- 玩家修改后触发 consolidation
- consolidation 回包后 chunk 拿到新的 render cache
- 后台写回时最新 cache 跟随 chunkRecord 一起进入 WorldStore

- [ ] **Step 2: 运行测试，确认当前失败**

- [ ] **Step 3: 在 consolidation 成功链路里生成并挂接新 renderCache**

实现内容：
- worker consolidation 回包附带 render cache
- chunk 应用最新 cache
- WorldRuntime 写回时把新 cache 一并写入 chunkRecord

- [ ] **Step 4: 运行测试，确认修改后的 chunk reload 不再回退到旧主线程重建路径**

Expected: 交互修改后的 chunk 卸载再加载仍优先消费 cache

## Task 6: 增加性能回归观测点

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，验证 `load-from-record` 日志区分 cache-hit / cache-miss / fallback-worker**

- [ ] **Step 2: 运行测试，确认当前失败**

- [ ] **Step 3: 增加最小观测字段**

建议字段：
- `renderCacheStatus: hit | miss | stale | fallback-worker | fallback-main-thread`
- `renderCacheMeshGroups`
- `renderCacheVisibleKeys`

- [ ] **Step 4: 运行测试，确认日志与快照可用于前后对比**

Expected: 后续可以直接比较优化前后 `chunk.load-from-record` 是否仍含 `convertMeshDataMs`

## Task 7: 手工验证

**Files:**
- Modify: 无新增代码，验证已有改动

- [ ] **Step 1: 启动开发服务器**

Run: `npm run start`
Expected: 本地静态服务器启动在 `http://localhost:8080`

- [ ] **Step 2: 运行浏览器测试**

访问: `http://localhost:8080/src/tests/index.html`
Expected: 相关测试全部通过

- [ ] **Step 3: 手工观察 runtime streaming 日志**

关注：
- `chunk.load-from-record`
- `StreamingPerf`
- `mutationQueueBlocks`
- `WorkerRpcClient.js:15 message handler`

Expected:
- cache hit 情况下不再出现主线程 `convertMeshDataMs` 热点
- `chunk.load-from-record` 总耗时下降
- 新档纯加载路径上屏更快

## 备注

1. 本计划第一版不拆独立 `render_cache` store
2. 本计划第一版不处理 region 整包回主线程问题
3. 本计划第一版只把 `_buildMeshFromExistingBlockData()` 从主路径挪走，并保留最终兜底
4. 根据仓库约束，本轮不自动提交；如需提交，等你明确下指令再做
