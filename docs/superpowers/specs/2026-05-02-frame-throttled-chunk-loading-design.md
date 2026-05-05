# Frame-Throttled Chunk Loading Design v2

日期：2026-05-02
分支：`gen-big-map-first`
定位：在放弃 `renderCache` 方案后，以较低技术复杂度削平 runtime chunk 加载尖峰

## 背景

当前 `runtime-streaming` 阶段的 chunk 热路径，仍然会在短时间内集中触发以下工作：

1. `World.update()` 单帧内创建大量缺失 chunk
2. `loadFromRecord()` 在主线程同步扫描 `blockData` 并生成 `meshData`
3. Worker 回包后的装配、scatter、实例提交形成阶段性洪峰
4. 玩家交互产生的 dirty chunk 在后续又可能集中触发 consolidation

此前的理想方案是为 `ChunkRecord` 引入 `renderCache`，跳过 `blockData -> meshData` 的主线程重建成本。这个方向在逻辑上成立，但当前实现复杂度过高，连续几次改造都带来了较多 bug，因此本轮不再继续推进该方向。

因此，本方案明确转向一个次优但可实施的目标：不试图降低单个 chunk 的总 CPU 成本，而是通过调度与限流，把原本集中发生的 CPU 峰值摊平到多个帧和 idle 窗口中，优先改善体感卡顿。

## 目标

1. runtime 阶段不再在单帧内同步创建整圈缺失 chunk
2. chunk 创建顺序必须优先保障玩家近场可见区域
3. 玩家快速移动时，旧区域 pending 加载任务可被淘汰，避免预算浪费
4. 所有 runtime chunk record 请求入口都受同一调度器约束，避免扩图完成、retry 等旁路重新形成洪峰
5. runtime-build 的主线程长任务必须被观测，并通过更保守的 runtime 装配准入降低集中爆发概率
6. consolidation 保留现有 idle/backpressure 语义，只在空闲窗口内进一步串行化，并限制 worker in-flight 数量
7. bootstrap 阶段保持原有行为不变
8. 提供 feature flag 和性能观测，支持快速回退与调参

## 非目标

1. 不解决 `loadFromRecord()` 内部 `blockData` 扫描的根因成本
2. 不把 `assembleRuntimeBuildPhase()` 拆成可中断的细粒度分片
3. 不引入新的持久化 schema 或 `renderCache`
4. 不承诺提升极端移动速度下的总吞吐，只承诺削峰
5. 不解决 `WorldRuntime.ensureChunkData()` 首次命中 region 时整块 RegionRecord clone/message transfer 的根因成本

## 总体策略

方案拆成三条相对独立的链路：

1. `ChunkLoadScheduler`
运行时负责“发现缺失 chunk 后，何时创建、先创建谁、丢弃谁”，并集中管理 runtime record 请求入口。

2. `ChunkAssemblyScheduler` runtime 策略收紧
不重写装配主流程，但把 runtime 阶段的 `maxTasks` 策略化下调，并增加单任务耗时观测，避免创建削峰后装配阶段再次集中爆发。

3. `GlobalConsolidationQueue`
仅在保留现有 idle grace 的前提下，再把可执行的 consolidation 串行化，防止多个 chunk 同时发起 worker 优化请求。

这三条链路应分阶段落地。第一阶段先落地 chunk 创建节流和 record 请求入口统一，确认它本身可以缓解尖峰；第二阶段收紧 runtime assembly 准入并补充观测；第三阶段再接入 consolidation 全局串行化。

## 架构

```text
World.update()
    ↓ 计算当前玩家所在 chunk
    ↓ 生成本帧目标兴趣集（render distance 范围内）
ChunkLoadScheduler.refreshInterestSet()
    ↓ 丢弃不再需要的 pending key
    ↓ 更新每个 key 的优先级（内圈优先、距离优先）
ChunkLoadScheduler.processOne()
    ↓ 如果本帧允许创建，则只创建 1 个当前最重要的 chunk
    ↓ new Chunk() + scene.add()
    ↓ _requestRuntimeChunkRecord()
    ↓ 后续仍由 ChunkAssemblyScheduler / GlobalInstancedMeshManager 处理

World.onExpansionFinished()
    ↓ 不再直接遍历 awaiting chunk 调 _requestRuntimeChunkRecord()
    ↓ 通知 ChunkLoadScheduler 重新刷新兴趣集 / retry eligible chunk
    ↓ 仍受同一创建与 record 请求节奏约束

ChunkAssemblyScheduler.processWithinBudget()
    ↓ bootstrap 保持当前吞吐
    ↓ runtime 使用更保守的 maxTasks / budgetMs
    ↓ 记录 runtime-build 单任务耗时与 long task 次数

玩家交互或批量操作
    ↓ chunk.scheduleConsolidation()
    ↓ 进入 deferred-consolidation 候选集合
RuntimeIdleScheduler 判断 idle grace 满足
    ↓ 将“可执行 chunk”转移到 GlobalConsolidationQueue
GlobalConsolidationQueue.processOne()
    ↓ 每个 idle 窗口只发起 1 个 chunk.consolidate()
    ↓ 同时限制 consolidation in-flight 数量，降低 worker 回包 apply 同帧聚集概率
```

## 设计详情

### Section 1: ChunkLoadScheduler 升级为兴趣集调度器

**新增文件**: `src/world/ChunkLoadScheduler.js`

核心职责不再是一个简单 FIFO 队列，而是一个“小型调度器”：

1. 维护当前 `pendingLoads`
2. 维护本帧 `interestSet`
3. 按玩家当前位置重新计算优先级
4. 丢弃不在兴趣集中的过时 key
5. 控制首帧立即创建和后续冷却节奏

建议数据结构：

```js
class ChunkLoadScheduler {
  constructor(world, options = {}) {
    this.world = world;
    this.pendingLoads = new Map(); // key -> { cx, cz, distanceSq, ring, enqueuedAtFrame }
    this.frameCounter = 0;
    this.cooldownFrames = options.cooldownFrames ?? 2;
    this.maxCreatesPerFrame = options.maxCreatesPerFrame ?? 1;
    this.nearRingRadius = options.nearRingRadius ?? 1;
    this.framesUntilNextCreate = 0;
    this.lastPlayerChunkKey = null;
    this.stats = {
      droppedPendingLoads: 0,
      createdLoads: 0,
      lastCreatedDistanceSq: -1
    };
  }
}
```

关键规则：

1. 不再提供仅基于 `enqueue()` 的盲目累积行为
2. 每帧由 `World.update()` 调用 `refreshInterestSet(centerCx, centerCz, renderDistance)`
3. `refreshInterestSet()` 会：
   - 生成当前兴趣集
   - 删除已不在兴趣集中的 pending key
   - 为新 key 建立 pending 记录
   - 按与玩家距离更新优先级元数据
4. `processOne()` 不按插入顺序出队，而是选择：
   - 内圈优先
   - 距离近优先
   - 同优先级下按较早入队顺序稳定排序
5. 当队列从空变为非空时，允许首帧立即创建 1 个最近 chunk
6. 创建后进入冷却，后续 `cooldownFrames` 帧内不再创建新的 chunk

这套规则的核心目的是避免“削峰成功，但近场缺块时间过长”。

### Section 2: World.update() 集成方式

**修改**: `src/world/World.js`

bootstrap 阶段保持原有同步创建逻辑不变。

runtime 阶段改为三步：

1. 生成当前目标兴趣集
2. 让 `ChunkLoadScheduler` 清理过时 pending 并刷新优先级
3. 若本帧允许创建，则只创建 1 个最高优先级 chunk

伪代码：

```js
if (this.bootstrapState.phase === 'bootstrapping' || !GameConfig.ENABLE_FRAME_THROTTLED_LOADING) {
  // 原有同步路径不变
} else {
  this.chunkLoadScheduler.refreshInterestSet(cx, cz, this.renderDistance);
  if (this.chunkLoadScheduler.processOne()) {
    chunkTopologyChanged = true;
  }
}
```

`refreshInterestSet()` 内部需要保证：

1. 只把当前渲染距离内且尚未加载的 key 纳入候选
2. 已经 `this.chunks.has(key)` 的 key 不进入 pending
3. 已脱离兴趣集的 pending key 被淘汰
4. 玩家跨 chunk 快速移动时，调度器立刻改以新中心重新排序

此外，`World.onExpansionFinished()` 不能继续直接遍历所有等待重试的 chunk 并调用 `_requestRuntimeChunkRecord()`。扩图完成后只应让调度器重新刷新兴趣集，或把 eligible retry key 纳入 pending，由 `processOne()` 按同一节奏触发 record 请求。否则扩图完成瞬间仍可能绕过节流形成 `ensureChunkData()` / `loadFromRecord()` 回包洪峰。

### Section 3: 节流参数改为策略化配置

**修改**: `src/constants/GameConfig.js`

不建议把策略写死在实现内部，建议显式配置：

```js
ENABLE_FRAME_THROTTLED_LOADING: true,
FRAME_THROTTLED_LOADING_MAX_CREATES_PER_FRAME: 1,
FRAME_THROTTLED_LOADING_COOLDOWN_FRAMES: 2,
FRAME_THROTTLED_LOADING_NEAR_RING_RADIUS: 1,
FRAME_THROTTLED_LOADING_DROP_STALE_PENDING: true,
FRAME_THROTTLED_RUNTIME_ASSEMBLY_MAX_TASKS: 1,
FRAME_THROTTLED_RUNTIME_ASSEMBLY_BUDGET_MS: 6,

ENABLE_CONSOLIDATION_QUEUE: true,
CONSOLIDATION_QUEUE_MAX_PER_IDLE_TICK: 1,
CONSOLIDATION_QUEUE_MAX_IN_FLIGHT: 1,
```

这样后续可以根据体感和观测数据迭代调参，而不需要改设计主干。

### Section 4: Runtime assembly 只做保守准入与观测，不做深拆

**修改**: `src/world/World.js`
**修改**: `src/world/ChunkAssemblyScheduler.js`

当前 `ChunkAssemblyScheduler` 的预算只在 task 之间生效，不能打断单个 `runtime-build`。`assembleRuntimeBuildPhase()` 内部仍会同步执行 `_buildMeshFromExistingBlockData()`，包含：

1. 遍历 `blockData`
2. 生成 `blocks`
3. 转换 `meshData`
4. 构建 `visibleKeys`
5. 调用 `buildMeshes()`

因此本轮不能声称“彻底解决 runtime-build 长任务”。更稳妥的做法是：

1. bootstrap 阶段保持当前 `budgetMs/maxTasks`
2. runtime 阶段使用配置化的更小 `maxTasks`，默认每帧最多处理 1 个 runtime assembly task
3. 保留现有优先级排序，近场 task 仍优先
4. 在 `chunk-assembly.task` 或 streaming snapshot 中暴露 `runtimeBuildLastMs`、`runtimeBuildMaxMs`、`runtimeBuildLongTaskCount`
5. 如果观测显示单个 runtime-build 仍稳定超过帧预算，再进入后续阶段做 runtime-build 分片或小范围 renderCache

这一步的定位是“防止多个重任务同帧叠加”，不是降低单任务成本。

### Section 5: Consolidation 改为“两层限流”，不破坏现有 idle grace

**修改**: `src/world/World.js`
**修改**: `src/world/ChunkConsolidation.js`

这是 v2 和 v1 最大的差别。

v1 的问题是想用 `GlobalConsolidationQueue` 直接替代现有 deferred idle 逻辑，容易把本来已经后移的工作又拉回 runtime 活跃阶段。

v2 改成两层：

1. 第一层：保留现有 `_pendingDeferredConsolidationChunkKeys`
   这层负责“只有在 streaming activity 停下来一段时间后，才允许进入下一步”。

2. 第二层：新增 `_globalConsolidationQueue`
   这层负责“在已经满足 idle 条件后，也不要让多个 chunk 同时发起 consolidation 请求，而是一次只处理 1 个”。

数据流：

```text
chunk.scheduleConsolidation()
  -> world.queueDeferredConsolidation(chunk)

World._processDeferredConsolidationQueue()
  -> 仅在 idle grace 满足时运行
  -> 将可执行 chunk 从 deferred set 转移到 global queue

World._processGlobalConsolidationQueue()
  -> 每次只处理 1 个
  -> chunk.consolidate()
```

因此，`scheduleConsolidation()` 在启用新特性后，不应该直接调用 `queueConsolidation()`，而应该继续进入 deferred 层。真正进入 global queue 的时机，必须由 `_processDeferredConsolidationQueue()` 决定。

关键实现约束：

1. 普通玩家交互调用 `chunk.scheduleConsolidation()` 时，新模式下进入 `world.queueDeferredConsolidation(chunk)`
2. `_processDeferredConsolidationQueue()` 在 idle grace 满足后，不能再调用 `chunk.scheduleConsolidation()`，否则会重新进入 deferred 层形成循环
3. 新模式下 `_processDeferredConsolidationQueue()` 应删除 deferred key，并调用 `world.queueConsolidation(chunk)` 把任务推进 global queue
4. `_processGlobalConsolidationQueue()` 才允许真正调用 `chunk.consolidate()`
5. global queue 需要维护 `inFlight`，默认最多 1 个，chunk consolidation 完成或失效后释放

### Section 6: ChunkConsolidation 的行为调整

建议改成：

```js
Chunk.prototype.scheduleConsolidation = function() {
  if (this.isConsolidating || !this.isReady) return;
  if (this.deferConsolidation) return;
  if (this.dirtyBlocks <= 0) return;

  if (this.consolidationTimer) {
    clearTimeout(this.consolidationTimer);
    this.consolidationTimer = null;
  }

  if (GameConfig.ENABLE_CONSOLIDATION_QUEUE) {
    this.world?.queueDeferredConsolidation?.(this);
    return;
  }

  if (this.dirtyBlocks >= DIRTY_THRESHOLD) {
    this.consolidate();
  } else {
    this.consolidationTimer = setTimeout(() => {
      this.consolidate();
    }, CONSOLIDATION_DELAY);
  }
};
```

这里的关键是：

1. 不跳过现有 deferred 层
2. 不改变 feature flag 关闭时的旧逻辑
3. 兼容 `dirtyBlocks` 阈值和防抖的回退行为
4. 避免从 deferred 处理阶段再次调用 `scheduleConsolidation()` 造成队列循环

### Section 7: RuntimeIdleScheduler 的接入方式

**修改**: `World._registerRuntimeIdleTasks()`

不再把旧的 `deferred-consolidation` 任务直接替换掉，而是拆成两段：

1. `deferred-consolidation-candidate`
负责在 idle grace 满足时，把可执行 chunk 转移到 global queue

2. `global-consolidation`
负责从 global queue 中一次取 1 个真正发起 consolidation

示意：

```js
this.runtimeIdleScheduler.registerTask({
  id: 'deferred-consolidation-candidate',
  priority: 50,
  minIdleMs: RUNTIME_DEFERRED_CONSOLIDATION_IDLE_GRACE_MS,
  run: () => {
    const moved = this._processDeferredConsolidationQueue();
    return { didWork: moved > 0 };
  }
});

this.runtimeIdleScheduler.registerTask({
  id: 'global-consolidation',
  priority: 45,
  minIdleMs: RUNTIME_DEFERRED_CONSOLIDATION_IDLE_GRACE_MS,
  run: () => {
    if (!GameConfig.ENABLE_CONSOLIDATION_QUEUE) return { didWork: false };
    const processed = this._processGlobalConsolidationQueue();
    return { didWork: processed > 0 };
  }
});
```

`global-consolidation` 的 `run()` 必须同时检查：

1. `GameConfig.ENABLE_CONSOLIDATION_QUEUE`
2. global queue 非空
3. 当前 in-flight 数小于 `CONSOLIDATION_QUEUE_MAX_IN_FLIGHT`
4. chunk 仍 loaded、ready、dirty 且未 disposed

### Section 8: 观测指标

**修改**: `World.consumeStreamingPerfSnapshot()`
**修改**: `HUD.formatStreamingPerf()`

新增以下观测数据：

1. `pendingChunkLoads`
2. `pendingNearChunkLoads`
3. `droppedPendingLoads`
4. `lastCreatedChunkDistance`
5. `pendingDeferredConsolidation`
6. `pendingGlobalConsolidation`
7. `consolidationInFlight`
8. `runtimeBuildLastMs`
9. `runtimeBuildMaxMs`
10. `runtimeBuildLongTaskCount`

这些指标比单纯显示“队列长度”更有意义，因为它们能直接回答：

1. 队列有没有积压
2. 近场 chunk 是否被饿死
3. 玩家快速移动时是否存在大量过时任务
4. consolidation 是否真的被后移到 idle 窗口
5. 创建削峰后，runtime-build 是否仍是单任务长帧来源
6. consolidation worker 回包是否仍可能集中 apply

### Section 9: 风险与缓解

| 风险 | 缓解 |
|------|------|
| 玩家快速移动导致 pending 任务失效 | 每帧刷新兴趣集，淘汰不在当前视野需求内的 key |
| 近处 chunk 被远处 chunk 抢占 | 内圈优先 + 距离优先 + 首帧立即创建最近 chunk |
| 节流过强导致世界出现明显空窗 | 参数化调节 `cooldownFrames`，保留 feature flag 回退 |
| consolidation 抢占 runtime 预算 | 保留现有 idle grace，仅在满足空闲窗口后串行发起 |
| 方案只能削峰，不能降低单 chunk 总成本 | 明确这是次优可实施方案，不与 `renderCache` 的目标混淆 |
| `onExpansionFinished()` 绕过调度器重试大量 chunk | retry 入口统一纳入 `ChunkLoadScheduler` |
| `runtime-build` 单任务仍然过重 | 本轮先限制同帧 task 数并观测 long task，后续再决定分片/renderCache |
| consolidation worker 回包同帧聚集 | global queue 增加 in-flight 上限，默认只允许 1 个 |
| 首次 region 加载仍有 structured clone 尖峰 | 本轮只通过减少并发触发缓解，后续再评估 chunk 级投影读取 |

## 测试要求

1. bootstrap 阶段行为不变
2. runtime 阶段每次只允许创建最多 1 个 chunk
3. 队列从空变非空时，首帧允许立即创建 1 个最近 chunk
4. 冷却帧未过时，不应继续创建新的 chunk
5. 玩家快速移动后，旧区域 pending key 会被清理
6. 近场和远场同时缺失时，必须优先创建近场 chunk
7. consolidation 在 active streaming 期间不能直接发起 worker 请求
8. idle grace 满足后，global consolidation queue 每次只处理 1 个 chunk
9. feature flag 关闭时，完整回退到旧行为
10. `onExpansionFinished()` 不应绕过调度器批量触发 record 请求
11. runtime assembly 在新配置下每帧最多处理配置允许的任务数
12. `_processDeferredConsolidationQueue()` 新模式下应推进到 global queue，而不是重新调用 `scheduleConsolidation()` 形成循环
13. global consolidation in-flight 达上限时，不应继续发起新的 `consolidate()`

## 改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/world/ChunkLoadScheduler.js` | 新增 | 运行时兴趣集调度器 |
| `src/world/World.js` | 修改 | 集成 chunk 节流、双层 consolidation 队列、性能观测 |
| `src/world/ChunkAssemblyScheduler.js` | 修改 | 增加 runtime-build 耗时观测与 runtime 准入指标 |
| `src/world/ChunkConsolidation.js` | 修改 | `scheduleConsolidation` 接回 deferred 层 |
| `src/constants/GameConfig.js` | 修改 | 增加节流参数与 feature flags |
| `src/ui/HUD.js` | 修改 | 展示新的 streaming 调度指标 |
