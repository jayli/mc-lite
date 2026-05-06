# Frame-Throttled Chunk Loading Implementation Plan v2

> 目标不是消灭单 chunk 的 CPU 成本，而是在放弃 `renderCache` 后，以较低风险把 runtime 加载和 consolidation 的 CPU 尖峰摊平到多个帧和 idle 窗口中。

**Goal:** 通过“兴趣集调度 + 近场优先 + 过时任务淘汰 + runtime assembly 保守准入 + consolidation 双层限流”缓解 runtime 移动时的可感知卡顿。

**Architecture:**  
`ChunkLoadScheduler` 负责 runtime 阶段的 chunk 创建节奏与优先级。
runtime 阶段 `ChunkAssemblyScheduler` 使用更保守的配置与观测指标，避免创建削峰后装配任务再次集中爆发。
`_pendingDeferredConsolidationChunkKeys` 继续负责 idle grace。
新增 `_globalConsolidationQueue` 仅负责在 idle 窗口内串行发起 consolidation，并限制 in-flight 数量。

**Tech Stack:** JavaScript ES Modules, Three.js, 现有 `World/Chunk/RuntimeIdleScheduler/ChunkAssemblyScheduler` 架构

---

## 文件边界

**新增文件：**
- `src/world/ChunkLoadScheduler.js` — 基于兴趣集的 chunk 调度器

**修改文件：**
- `src/constants/GameConfig.js` — 新增参数化节流配置
- `src/world/World.js` — 接入 chunk 调度器、双层 consolidation 队列、观测指标
- `src/world/ChunkAssemblyScheduler.js` — 增加 runtime-build 耗时观测与 runtime 准入指标
- `src/world/ChunkConsolidation.js` — `scheduleConsolidation` 回接 deferred 层
- `src/ui/HUD.js` — 展示新的 streaming 调度指标

**测试文件：**
- `src/tests/test-world.js` — 新增 chunk 节流与 consolidation 队列测试

---

## 实施顺序

本计划刻意先做 `chunk 创建调度 + record 请求入口统一`，确认它本身有收益；然后收紧 runtime assembly 准入并补观测；最后做 `consolidation` 二次限流。不要一开始同时改所有链路，否则难以定位收益与回归来源。

---

### Task 1: 参数化 Feature Flags

**Files:**
- Modify: `src/constants/GameConfig.js`

- [ ] 添加以下配置项

```js
  // ==================== runtime chunk 节流配置 ====================
  ENABLE_FRAME_THROTTLED_LOADING: true,
  FRAME_THROTTLED_LOADING_MAX_CREATES_PER_FRAME: 1,
  FRAME_THROTTLED_LOADING_COOLDOWN_FRAMES: 2,
  FRAME_THROTTLED_LOADING_NEAR_RING_RADIUS: 1,
  FRAME_THROTTLED_LOADING_DROP_STALE_PENDING: true,
  FRAME_THROTTLED_RUNTIME_ASSEMBLY_MAX_TASKS: 1,
  FRAME_THROTTLED_RUNTIME_ASSEMBLY_BUDGET_MS: 6,

  // ==================== consolidation 串行化配置 ====================
  ENABLE_CONSOLIDATION_QUEUE: true,
  CONSOLIDATION_QUEUE_MAX_PER_IDLE_TICK: 1,
  CONSOLIDATION_QUEUE_MAX_IN_FLIGHT: 1,
```

- [ ] 运行 `npm run lint`

预期：
- 无新增 lint 错误

---

### Task 2: 实现 ChunkLoadScheduler v2

**Files:**
- Create: `src/world/ChunkLoadScheduler.js`

- [ ] 创建调度器，使用 `Map` 存储 pending 任务，而不是数组

建议接口：

```js
class ChunkLoadScheduler {
  constructor(world, options = {}) {}
  refreshInterestSet(centerCx, centerCz, renderDistance) {}
  hasPending(key) {}
  getPendingCount() {}
  getPendingNearCount() {}
  getDroppedCount() {}
  getLastCreatedDistanceSq() {}
  processOne() {}
  _collectInterestKeys(centerCx, centerCz, renderDistance) {}
  _selectNextChunkKey() {}
  _createAndLoadChunk(key) {}
  refreshRetryCandidates(centerCx, centerCz, renderDistance) {}
}
```

- [ ] `refreshInterestSet()` 必须完成以下行为

要求：
- 只保留当前 render distance 范围内的缺失 key
- 已加载 chunk 不应进入 pending
- 已创建但等待 store retry 的 chunk 不应重复创建，只能进入 retry 候选
- 不在当前兴趣集内的 pending key 必须被淘汰
- 每个 pending 项必须更新 `distanceSq` 与 `ring`
- `ring <= nearRingRadius` 的视为近场

- [ ] `processOne()` 必须完成以下行为

要求：
- 队列从空变非空时，允许首帧立即创建 1 个 chunk
- 创建后进入冷却帧窗口
- 冷却未结束时不再继续创建
- 每次最多创建 `maxCreatesPerFrame`
- 选择逻辑为：近场优先、距离优先、入队时间稳定排序

- [ ] `_createAndLoadChunk()` 必须完成以下行为

要求：
- 缺失 chunk：创建 `new Chunk()`、加入 `world.chunks`、`scene.add()`、调用 `_requestRuntimeChunkRecord()`
- 已存在但 `awaitingStoreRecord` / `needsStoreRetry` 的 chunk：不重复创建，只按调度节奏调用 `_requestRuntimeChunkRecord()`
- 已 disposed 或离开兴趣集的任务应跳过

- [ ] 运行 `npm run lint`

预期：
- 无新增 lint 错误

---

### Task 3: ChunkLoadScheduler 单元测试

**Files:**
- Modify: `src/tests/test-world.js`

- [ ] 为调度器新增以下测试

1. 去重：同一 key 不重复进入 pending
2. 首帧创建：队列从空变非空时，第 1 次 `processOne()` 即可创建最近 chunk
3. 冷却：创建后接下来的 `cooldownFrames` 内不应继续创建
4. 淘汰：玩家移动后，旧区域 key 被移出 pending
5. 优先级：近场 key 优先于远场 key 被创建
6. retry：已存在且等待 store retry 的 chunk 不应被重复创建

- [ ] 若现有 `World` 构造耦合较强，可直接对 `ChunkLoadScheduler` 做局部 stub 测试

- [ ] 运行浏览器测试

验证方式：
- 启动 `npm run start`
- 打开 `http://localhost:8080/src/tests/index.html`

预期：
- 新增测试通过

---

### Task 4: 集成到 World.update()

**Files:**
- Modify: `src/world/World.js`

- [ ] 在构造函数中初始化 `ChunkLoadScheduler`

```js
this.chunkLoadScheduler = new ChunkLoadScheduler(this, {
  maxCreatesPerFrame: GameConfig.FRAME_THROTTLED_LOADING_MAX_CREATES_PER_FRAME,
  cooldownFrames: GameConfig.FRAME_THROTTLED_LOADING_COOLDOWN_FRAMES,
  nearRingRadius: GameConfig.FRAME_THROTTLED_LOADING_NEAR_RING_RADIUS
});
```

- [ ] 保持 bootstrap 路径不变

- [ ] runtime 路径改成：

```js
this.chunkLoadScheduler.refreshInterestSet(cx, cz, this.renderDistance);
if (this.chunkLoadScheduler.processOne()) {
  chunkTopologyChanged = true;
}
```

- [ ] 确保 `chunkTopologyChanged` 只在实际创建 chunk 时为 `true`

- [ ] 保证 feature flag 关闭时完整回退到旧逻辑

- [ ] 修改 `World.onExpansionFinished()`

要求：
- 启用 `ENABLE_FRAME_THROTTLED_LOADING` 时，不再直接遍历所有 awaiting/retry chunk 调 `_requestRuntimeChunkRecord()`
- 只通知 `ChunkLoadScheduler` 刷新当前兴趣集或 retry 候选
- feature flag 关闭时保留旧行为

- [ ] 运行 `npm run lint`

---

### Task 5: World.update() 集成测试

**Files:**
- Modify: `src/tests/test-world.js`

- [ ] 新增以下集成测试

1. bootstrap 阶段仍然同步创建整圈 chunk
2. runtime 阶段首次进入新区域时，第 1 帧只创建 1 个 chunk
3. 接下来的冷却帧内不继续创建
4. 冷却结束后继续只创建 1 个 chunk
5. 玩家从 `(0, 0)` 快速移动到远处后，pending 队列会改以新区域为主
6. `onExpansionFinished()` 在新模式下不会批量触发 `_requestRuntimeChunkRecord()`

- [ ] 测试不要再使用互相矛盾的“第 1 帧不创建 / 第 1 帧创建”混合预期

统一预期：
- 队列首次变非空时允许立即创建
- 后续受冷却窗口控制

- [ ] 运行浏览器测试并确认通过

---

### Task 6: 收紧 runtime assembly 准入并增加观测

**Files:**
- Modify: `src/world/World.js`
- Modify: `src/world/ChunkAssemblyScheduler.js`

- [ ] 在 `World.processAssemblyQueues()` 中对 bootstrap/runtime 使用不同配置

要求：
- bootstrap 保持当前高吞吐配置
- runtime 使用 `GameConfig.FRAME_THROTTLED_RUNTIME_ASSEMBLY_MAX_TASKS`
- runtime 使用 `GameConfig.FRAME_THROTTLED_RUNTIME_ASSEMBLY_BUDGET_MS`
- feature flag 关闭时可回退当前 runtime 配置

- [ ] 在 `ChunkAssemblyScheduler` 或 `World` 中记录 runtime-build 单任务耗时

指标：
- `runtimeBuildLastMs`
- `runtimeBuildMaxMs`
- `runtimeBuildLongTaskCount`

说明：
- long task 阈值建议先使用 8ms
- 这一步不拆分 `assembleRuntimeBuildPhase()`，只限制同帧重任务数量并暴露观测

- [ ] 新增测试

测试项：
1. bootstrap 仍按原配置允许多 task
2. runtime 新模式下每次 `processAssemblyQueues()` 最多处理配置允许数量
3. runtime-build 超过阈值时 long task 计数增加

- [ ] 运行 `npm run lint`

---

### Task 7: 增加观测指标

**Files:**
- Modify: `src/world/World.js`
- Modify: `src/ui/HUD.js`

- [ ] 在 `consumeStreamingPerfSnapshot()` 中增加：

```js
pendingChunkLoads
pendingNearChunkLoads
droppedPendingLoads
lastCreatedChunkDistance
pendingDeferredConsolidation
pendingGlobalConsolidation
consolidationInFlight
runtimeBuildLastMs
runtimeBuildMaxMs
runtimeBuildLongTaskCount
```

- [ ] 在 HUD 中增加对应展示

建议格式：
- `loadQ total/near`
- `drop stale`
- `lastDist`
- `deferredCon`
- `globalCon`
- `conInFlight`
- `rtBuild last/max/long`

- [ ] 保持现有日志结构兼容，不删除旧指标

---

### Task 8: 接入 consolidation 双层限流

**Files:**
- Modify: `src/world/World.js`
- Modify: `src/world/ChunkConsolidation.js`

- [ ] 在 `World` 构造函数中新增：

```js
this._globalConsolidationQueue = new Set();
this._globalConsolidationInFlight = new Set();
```

- [ ] 新增 `queueConsolidation(chunk)` 与 `_processGlobalConsolidationQueue()`

要求：
- `queueConsolidation()` 只负责加入 global queue
- `_processGlobalConsolidationQueue()` 每次最多真正 `consolidate()` 1 个 chunk
- `_processGlobalConsolidationQueue()` 必须遵守 `CONSOLIDATION_QUEUE_MAX_IN_FLIGHT`
- global queue 中已失效、已卸载、已 clean 的 chunk 要自动跳过
- consolidation 完成、chunk 卸载或失效后要释放 in-flight 标记

- [ ] 不删除现有 `_pendingDeferredConsolidationChunkKeys`

- [ ] 修改 `_processDeferredConsolidationQueue()`：

要求：
- 继续保留当前的 `idle grace` 判定
- 在启用 `ENABLE_CONSOLIDATION_QUEUE` 时，不再直接触发 `chunk.scheduleConsolidation()`
- 改为把满足条件的 chunk 从 deferred set 转移到 global queue
- 新模式下必须调用 `queueConsolidation(chunk)`，不能再次调用 `scheduleConsolidation()`，否则会形成 deferred 循环
- feature flag 关闭时保留旧逻辑

- [ ] 修改 `Chunk.prototype.scheduleConsolidation()`

要求：
- 新逻辑下仍然先进入 `queueDeferredConsolidation()`
- 不要直接跳到 global queue
- feature flag 关闭时保留旧的阈值立即触发和防抖逻辑

- [ ] 运行 `npm run lint`

---

### Task 9: consolidation 队列测试

**Files:**
- Modify: `src/tests/test-world.js`

- [ ] 增加以下测试

1. dirty chunk 调 `scheduleConsolidation()` 后先进入 deferred queue
2. active streaming 期间 `_processDeferredConsolidationQueue()` 不应把任务推进到 global queue
3. idle grace 满足后，deferred queue 可把任务转移到 global queue
4. `_processGlobalConsolidationQueue()` 每次只处理 1 个
5. 失效 chunk 会在处理时被自动跳过
6. `_processDeferredConsolidationQueue()` 新模式下不会再次调用 `scheduleConsolidation()`
7. in-flight 达上限时不会继续发起新的 `consolidate()`
8. consolidation 完成后释放 in-flight

- [ ] 尽量用 stub chunk 验证队列语义，而不是依赖完整 worker

- [ ] 运行浏览器测试并确认通过

---

### Task 10: 手工验证

**Files:**
- 无代码新增，运行现有项目

- [ ] 启动 `npm run start`

- [ ] 在以下场景下观察 HUD / 控制台 StreamingPerf

场景：
1. 初始 bootstrap 完成后进入 runtime
2. 匀速向新区域移动
3. 快速飞行或传送到远处
4. 批量放置/删除方块后等待 idle

- [ ] 重点观察以下信号

检查点：
- `pendingChunkLoads` 不应长期堆积不降
- `pendingNearChunkLoads` 不应长期大于 0
- `droppedPendingLoads` 在快速移动时应增长
- `pendingGlobalConsolidation` 不应在持续移动时快速上涨
- `consolidationInFlight` 不应超过配置上限
- `runtimeBuildMaxMs` 若仍长期超过 8-12ms，应记录为后续分片/renderCache 决策依据
- active streaming 期间 consolidation 不应频繁抢占

---

## 完成标准

满足以下条件才算该计划完成：

1. bootstrap 行为未回归
2. runtime 下 chunk 创建不再整圈同步爆发
3. 近场优先可感知成立，不出现明显“远处先出来、脚下仍空”的退化
4. `onExpansionFinished()` / retry 入口不再绕过 chunk 加载调度器
5. runtime assembly 不再一帧处理多个配置外的重任务
6. consolidation 仍被延后到 idle 窗口，而不是重新抢占 runtime
7. consolidation in-flight 不超过配置上限
8. 所有新增测试通过
9. `npm run lint` 通过

## 暂不做的事

1. 不再尝试 `renderCache`
2. 不优化 `loadFromRecord()` 内部 `blockData -> meshData` 的根因成本
3. 不把 `assembleRuntimeBuildPhase()` 拆成可中断的细粒度分片
4. 不解决首次 region 加载的整块 structured clone/message transfer 成本
5. 不修改持久化 schema
