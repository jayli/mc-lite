# Unload Flush Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `chunk unload` 从“立即写盘触发点”改造成“运行时工作集回收点”，把 `flushBeforeUnload/live-chunk` 的整块序列化与多 chunk flush 洪峰移出热路径，优先保障跑图流畅度。

**Architecture:** 不再在 `World.update()` 的 unload 分支里直接触发 `flushBeforeUnload -> commitChunkRecord`。改为：卸载时只构造稳定 `chunkRecord` 快照并放入后台待写队列；后台按 idle 窗口、按 region 合批、按严格预算慢慢刷写；退出或手动保存时再尽力清空队列。关键原则是：队列里只存稳定快照，不存 live `Chunk` / `blockData Map` 引用；默认禁止 unload 路径退回 `live-chunk` 全量序列化。

**Tech Stack:** Vanilla JS、Three.js、WorldStore / WorldRuntime、浏览器内测试页 `src/tests/index.html`、ESLint、现有 `ChunkPerf` / `StreamingPerf` 日志。

---

## 文件结构

- Modify: `src/world/WorldRuntime.js`
  - 新增 `pendingUnloadFlushQueue`
  - 把 `flushBeforeUnload()` 重定义为“构造稳定快照并入队”
  - 新增后台消费队列的方法（按 region 合批、按预算限流）
  - 调整 `flushAllDirty()` / 退出时 flush，把队列一起纳入

- Modify: `src/world/World.js`
  - 调整 chunk unload 流程，不再把 unload 等同于立即写盘
  - 把后台 unload flush 队列接入现有 idle / runtime 调度窗口
  - 追加 `StreamingPerf` / 诊断信息，观察队列长度和消费速率

- Modify: `src/tests/test-world-runtime.js`
  - 为 unload 入队、覆盖旧记录、禁止 `live-chunk` 回退补测试

- Modify: `src/tests/test-world.js`
  - 为 world unload 行为、后台消费、队列限流补测试

- Modify: `src/utils/ChunkPerfMonitor.js`
  - 必要时补一个轻量日志标签或辅助过滤字段

- Modify: `src/core/Game.js`
  - 若需要，在 debug 输出里区分 `load` / `unload flush queue` 的观测项

## Task 1: 先把失败测试写出来，锁住 unload 新语义

**Files:**
- Modify: `src/tests/test-world-runtime.js`
- Modify: `src/tests/test-world.js`

- [ ] **Step 1: 阅读当前 unload / flush 相关测试**

检查：
- `src/tests/test-world-runtime.js`
- `src/tests/test-world.js`
- `src/world/World.js`
- `src/world/WorldRuntime.js`

确认现有测试是否已经覆盖：
- `flushBeforeUnload()` 当前直接写回语义
- chunk unload 时 `World.update()` 的行为
- idle 队列 / deferred 队列的调度方式

- [ ] **Step 2: 为 WorldRuntime 新增失败测试，固定“unload 只入队不立即 commit”**

在 `src/tests/test-world-runtime.js` 增加测试，覆盖：
- 调用 `flushBeforeUnload(cx, cz, ...)` 后，不应立刻调用 `commitChunkRecord` / `putChunkRecord`
- 应生成一条 `pendingUnloadFlushQueue` 记录
- 队列记录中保存的是稳定 `chunkRecord` 快照，而不是 live `chunk.blockData` 引用

- [ ] **Step 3: 为 WorldRuntime 新增失败测试，固定“同 chunkKey 只保留最新待写记录”**

增加测试：
- 同一 chunk 连续两次入队
- 第二次记录覆盖第一次
- 队列大小保持为 1
- `lastUpdatedAt` / 版本号更新

- [ ] **Step 4: 为 WorldRuntime 新增失败测试，固定“默认禁止回退 live-chunk 全量序列化”**

增加测试：
- 没有 `dirty snapshot`
- 没有可复用 `cached chunkRecord`
- `chunk.blockData` 存在但不应被默认用于 unload 热路径
- 断言新逻辑要么跳过入队，要么只入一个空/轻量记录，但不能走 `live-chunk`

- [ ] **Step 5: 为 World 新增失败测试，固定“unload 不再等待写盘完成”**

在 `src/tests/test-world.js` 增加测试：
- 构造超出渲染范围的 chunk
- 触发 `world.update()`
- 断言 chunk 仍会被 `scene.remove / dispose / delete`
- 同时只会调用“入队接口”，不会同步等待持久化完成

- [ ] **Step 6: 运行浏览器测试，确认新测试先失败**

Run:
```bash
npm run start
```

然后打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增 unload 语义测试失败
- 失败原因明确指向当前实现仍会在 `flushBeforeUnload()` 中直接提交 WorldStore

## Task 2: 重写 WorldRuntime 的 unload 路径，让它只构造稳定快照并入队

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 在 WorldRuntime 中新增后台待写队列结构**

在 `src/world/WorldRuntime.js` 中新增：
- `pendingUnloadFlushQueue`
- 队列记录结构定义
- 必要的辅助方法：`_enqueuePendingChunkFlushRecord()`、`_getPendingChunkFlushRecord()` 等

要求：
- 使用 `Map<chunkKey, record>`
- 队列记录只保存稳定 `chunkRecord`
- 不保存 live `Chunk` 或 `Map` 引用

- [ ] **Step 2: 抽出“为卸载构造稳定 chunkRecord”的辅助方法**

新增辅助方法，例如：
- `_buildChunkRecordForBackgroundFlush(cx, cz, options)`

优先级要求：
1. `dirtyEntry.blockDataSnapshot`
2. `cached chunkRecord`
3. 显式传入的 snapshot
4. 明确禁止默认回退 `chunk.blockData`

- [ ] **Step 3: 改写 flushBeforeUnload 的职责**

将 `flushBeforeUnload()` 改成：
- 构造稳定 `chunkRecord`
- 更新 region cache（如果需要）
- 入 `pendingUnloadFlushQueue`
- 返回，不调用 `_commitChunkRecord`

要求：
- 保持函数对调用方的接口尽量稳定
- 但行为改为“enqueue only”

- [ ] **Step 4: 处理同 chunk 多次入队覆盖**

要求：
- 同一 `chunkKey` 新记录覆盖旧记录
- 保留最新 `chunkRecord`
- 更新时间戳 / 版本号
- 不让队列无限膨胀

- [ ] **Step 5: 运行浏览器测试，验证 WorldRuntime 行为**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- `test-world-runtime.js` 新增测试通过
- 现有 `markChunkDirty / flushChunk / ensureChunkData` 测试不回归

## Task 3: 增加后台消费器，按 region 合批、按预算限流刷写

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 先写失败测试，固定后台消费器的预算行为**

在 `src/tests/test-world.js` 或 `src/tests/test-world-runtime.js` 增加测试：
- 队列里有多个不同 chunk / region
- 一次消费最多处理一个 region 或少量 chunk
- 消费后剩余记录保留到下一个窗口

- [ ] **Step 2: 在 WorldRuntime 中新增后台消费方法**

新增方法，例如：
- `flushPendingUnloadQueueWithinBudget(options)`

要求：
- 优先从队列中选择最高优先级记录
- 再尽量捎带同 region 的记录
- 每轮只提交很小批次

- [ ] **Step 3: 用现有 WorldStore region 粒度做合批提交**

在消费器中：
- 按 region 聚合 `chunkRecord`
- 读取 region cache / worldStore record
- 覆盖对应 chunk
- 一次提交 `saveRegionRecord`

要求：
- 不要退回一条记录一次 `commitChunkRecord`
- 尽量减少碎片化读改写

- [ ] **Step 4: 把后台消费挂到 World 的 idle/runtime 调度**

在 `src/world/World.js` 中：
- 把 unload flush 队列消费接入现有 idle scheduler
- 只在 `runtime-streaming` 且空闲窗口里处理
- 不允许与当前帧的主要装载/渲染抢预算

- [ ] **Step 5: 为积压场景加最小观测**

至少补：
- 队列长度
- 本轮消费 chunk 数 / region 数
- 最近消费耗时

可放入：
- `StreamingPerf`
- `ChunkPerf` 标签
- 或 `World.getRuntimeIdleStats()` 扩展字段

- [ ] **Step 6: 运行浏览器测试并人工验证**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增预算/合批测试通过
- 现有 deferred queue / streaming queue 测试不回归

## Task 4: 改造 World.update 的 unload 语义，只做回收与入队

**Files:**
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 先写失败测试，固定 unload 顺序**

新增测试覆盖：
- chunk 超出渲染范围时
- 先停止与 chunk 强绑定的运行时行为
- 再 enqueue background flush
- 再 scene remove / dispose / delete
- 整个过程中不等待持久化完成

- [ ] **Step 2: 调整 World.update 的 unload 分支**

在 `src/world/World.js` 中：
- 保留 `minecart stop`、实体快照采集、`scene.remove`、`chunk.dispose`
- 将 `flushBeforeUnload()` 视为 enqueue-only
- 不在 unload 当帧触发立即写盘语义

- [ ] **Step 3: 确认 chunk dispose 后不影响待写快照**

要求：
- 入队前必须拿到稳定 `chunkRecord`
- `chunk.dispose()` 之后不再依赖 chunk 内部数据

- [ ] **Step 4: 运行测试验证 unload 新语义**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- `test-world.js` 新增 unload 测试通过
- chunk 删除、deferred finalize、deferred consolidation 等现有行为不回归

## Task 5: 收口退出/手动保存路径，把后台待写队列一并尽力 flush

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/World.js`
- Potentially Modify: `src/core/Game.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 先写失败测试，固定“退出时应尽力处理 unload 队列”**

增加测试：
- `_dirtyChunks` 与 `pendingUnloadFlushQueue` 同时存在
- 调用总 flush / dispose 路径后
- 两者都应被纳入处理

- [ ] **Step 2: 扩展 flushAllDirty 或新增 flushAllPendingWork**

要求：
- 不只处理编辑脏块
- 也处理 unload 队列
- 优先级允许更高，因为这是退出 / 保存路径，不是 runtime 热路径

- [ ] **Step 3: 确认 World.dispose / Game 退出链路会调用它**

检查：
- `src/world/World.js`
- `src/core/Game.js`

要求：
- 正常退出时尽量多落盘
- 但不要重新把 runtime 帧路径绑回同步写盘

- [ ] **Step 4: 重新运行测试**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增退出路径测试通过
- 原有 runtime persistence 相关测试不回归

## Task 6: 调整观测，避免 perf debug 本身放大 unload 成本

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/utils/ChunkPerfMonitor.js`
- Potentially Modify: `src/core/Game.js`

- [ ] **Step 1: 先阅读当前 flush perf 统计逻辑**

检查：
- `src/world/WorldRuntime.js`
- `src/utils/ChunkPerfMonitor.js`
- `src/core/Game.js`

确认哪些统计会对大 `blockData` 做：
- `Object.keys`
- `JSON.stringify`

- [ ] **Step 2: 对 unload/background flush 的大对象统计降级**

要求：
- debug 打开时，`flush-before-unload` / background flush 不再默认 `JSON.stringify` 大对象
- 保留必要的 `blockCount`、source、queue size 即可

- [ ] **Step 3: 增加 load / unload 的区分字段**

要求：
- 后续日志里能明确区分：
  - `chunk load`
  - `unload enqueue`
  - `background flush`
  - `shutdown flush`

- [ ] **Step 4: 运行 lint**

Run:
```bash
npm run lint
```

Expected:
- 无新增 lint error

## Task 7: 跑运行期验证，确认主瓶颈已从 unload 热路径移走

**Files:**
- Modify: 无（验证任务）

- [ ] **Step 1: 启动项目**

Run:
```bash
npm run start
```

- [ ] **Step 2: 打开 debug 并执行高速跑图场景**

在浏览器中：
- 进入游戏
- 开启 `CHUNK_PERF_DEBUG`
- 开启 `StreamingPerf`
- 高速直线跑图，持续触发 chunk load/unload

- [ ] **Step 3: 记录关键指标**

重点观察：
- 是否还出现 `world-runtime.flush-before-unload` 的超长日志
- 是否仍出现 `blockDataSource: live-chunk`
- unload 队列长度是否可控
- background flush 是否分批稳定消化

- [ ] **Step 4: 验证目标是否达成**

达标标准：
- unload 当帧不再触发 `live-chunk` 整块序列化
- 高速跑图时体感 jank 明显下降
- `chunk.accept-scattered-blocks` 等 load 路径指标不回退
- 队列不会失控增长

## 备注

- 当前仓库明确要求：**不能自动提交代码**。执行本计划时不要自动 commit，除非用户明确要求。
- 当前目标是 runtime 流畅度优先，所以允许后台待写队列中的最近变更在崩溃场景下丢失。
- 不要把 unload 优化重新做成“换个地方同步写盘”；凡是会把 `chunk unload` 再次和即时持久化绑定起来的实现，都偏离本计划目标。
