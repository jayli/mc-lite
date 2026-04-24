# Runtime Chunk Streaming P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不增加远端 chunk 首次可见延迟的前提下，降低运行期 chunk 装载的主线程卡顿，并压缩 Worker 回包后的装载总耗时。

**Architecture:** 第一阶段先收敛主线程确定性热点，不改 Worker 回包协议。具体做法是：将 `BlockScatterManager` 从全表扫描改为按触达 key 消费；将 `finalize` 从粗粒度同步任务拆成多个可预算调度的小阶段；将 `GlobalInstancedMeshManager` 的 mutation 队列改为“按任务批量消费”，减少高积压时的重复线性检索。

**Tech Stack:** Vanilla JS、Three.js、浏览器内测试页 `src/tests/index.html`、ESLint、现有 `ChunkPerf` / `StreamingPerf` 日志。

---

## 文件结构

- Modify: `src/world/BlockScatterManager.js`
  - 新增待消费 ready chunk key 集合/队列
  - `scatter()` 只把本次触达的可处理 key 入队
  - `flushReadyChunks()` 改成只处理待消费 key

- Modify: `src/world/Chunk.js`
  - 拆分 `finalizeAssemblyPhase()` 的状态推进
  - 增加可切片执行的 finalize 子阶段
  - 保持 runtime streaming chunk 的 deferred finalize 语义

- Modify: `src/world/ChunkAssemblyScheduler.js`
  - 增加新的装配阶段调度
  - 保证预算真正作用于更小的 task

- Modify: `src/world/World.js`
  - 调整 `onChunkFinalized()` 与 AO 稳定源刷新路径
  - 让 AO 相关收尾适配新的 finalize 切片流程

- Modify: `src/core/GlobalInstancedMeshManager.js`
  - mutation 队列从“每 block 选任务”改成“按 task 连续消费一批”
  - 保留现有对近距离 chunk 的优先性

- Modify: `src/tests/test-world.js`
  - 为新的 finalize/assembly 行为补测试

- Modify: `src/tests/test-global-instanced-mesh-manager.js`
  - 为 mutation 队列批量消费路径补测试

- Modify: `src/tests/test-block-scatter-manager.js`
  - 为 ready key 定向消费补测试

## Task 1: 给 BlockScatterManager 去掉 flush 全表扫描

**Files:**
- Modify: `src/world/BlockScatterManager.js`
- Test: `src/tests/test-block-scatter-manager.js`

- [ ] **Step 1: 先阅读现有 BlockScatterManager 测试与使用路径**

检查：
- `src/tests/test-block-scatter-manager.js`
- `src/world/World.js`
- `src/world/BlockScatterManager.js`

确认现有测试是否已经覆盖：
- own chunk 首次接受
- ready chunk 增量追加
- pending cross-chunk patch 延迟补刷

- [ ] **Step 2: 编写失败测试，固定“只处理触达 key”的行为**

在 `src/tests/test-block-scatter-manager.js` 增加一个测试：
- 准备多个历史 `chunkBuffers`
- 本次 `scatter()` 只触发 1~2 个 chunk
- 断言 `flushReadyChunks()` 之后只调用对应 chunk 的 `acceptScatteredBlocks()` / `appendScatteredBlocks()`
- 断言未触达的历史 buffer 不会被重复扫一遍并重新追加

- [ ] **Step 3: 运行浏览器测试，确认新测试先失败**

Run:
```bash
npm run start
```

然后打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增测试失败
- 失败原因指向 `flushReadyChunks()` 仍会遍历全部 `chunkBuffers`

- [ ] **Step 4: 修改 BlockScatterManager 的数据结构**

在 `src/world/BlockScatterManager.js` 中：
- 新增 `pendingReadyChunkKeys` 之类的集合或队列
- `scatter()` 中只把本次触达且满足处理条件的 key 放进去
- 保证重复 key 不会无限累积

- [ ] **Step 5: 把 flushReadyChunks 改成按 key 消费**

要求：
- 不再 `for (const [key, buffer] of this.chunkBuffers)`
- 改为只消费 `pendingReadyChunkKeys`
- 处理后清空本次消费的 key
- 保持 `acceptScatteredBlocks()` 和 `appendScatteredBlocks()` 的原有语义不变

- [ ] **Step 6: 重新运行浏览器测试并验证**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- `test-block-scatter-manager.js` 全部通过
- 无现有 scatter / patch 逻辑回归

## Task 2: 把 finalize 切成多个可预算调度的小阶段

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/ChunkAssemblyScheduler.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 先补测试，固定新的装配阶段顺序**

在 `src/tests/test-world.js` 增加测试，覆盖：
- runtime streaming chunk 在 `terrain-built` 后进入新的 finalize 阶段
- `isReady` 能在 AO 收尾之前被设置
- AO 相关收尾不会阻止 chunk 先进入可见状态
- deferred finalize 仍会继续执行，且不会丢失

- [ ] **Step 2: 运行测试，确认新行为尚未实现**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增 finalize 状态机测试失败
- 当前实现仍只有粗粒度 `finalize` 一步

- [ ] **Step 3: 在 Chunk 中引入 finalize 子阶段状态**

在 `src/world/Chunk.js` 中：
- 为 chunk 增加 finalize 子阶段标识
- 将 `finalizeAssemblyPhase()` 拆分为多个小阶段
- 至少覆盖：
  - ready 标记阶段
  - AO/稳定源收尾阶段
  - post finalize 阶段

- [ ] **Step 4: 修改 ChunkAssemblyScheduler 支持新的阶段调度**

在 `src/world/ChunkAssemblyScheduler.js` 中：
- 增加新的阶段分支
- 完成一个小阶段后，再 enqueue 下一个小阶段
- 保证 `budgetMs` 能被多个小 task 实际利用，而不是被单个大 task 吃光

- [ ] **Step 5: 调整 World 的 onChunkFinalized / AO 路径**

在 `src/world/World.js` 中：
- 不再把完整 AO 稳定源刷新直接压进同一个粗粒度 finalize task
- 让 AO 收尾适配新的分阶段流程
- 保证邻居边界 AO 标记逻辑仍保留

- [ ] **Step 6: 重新运行浏览器测试并人工检查状态机**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- `test-world.js` 新增测试通过
- 现有 chunk 装载、finalize、deferred finalize 相关测试不回归

## Task 3: 优化 GlobalInstancedMeshManager 的 mutation 队列检索

**Files:**
- Modify: `src/core/GlobalInstancedMeshManager.js`
- Test: `src/tests/test-global-instanced-mesh-manager.js`

- [ ] **Step 1: 补测试，固定“选中任务后批量消费”的行为**

在 `src/tests/test-global-instanced-mesh-manager.js` 增加测试：
- 构造多个不同 chunk 的 mutation task
- 指定玩家 chunk 位置
- 断言 flush 时优先选择最近 task
- 断言同一个 task 会连续消费多条 entry，而不是每处理一条都重新选任务

- [ ] **Step 2: 运行测试，确认新行为先失败**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新测试失败
- 当前实现表现为每处理一个 block 都重新调用 `_selectNextMutationTaskIndex()`

- [ ] **Step 3: 修改 flushMutationQueue 的消费策略**

在 `src/core/GlobalInstancedMeshManager.js` 中：
- 保留按距离优先选择 task 的策略
- 但选中某个 task 后，连续消费该 task 的一批 entries
- 批大小仍需受 `maxOps` 和 `maxMs` 限制

- [ ] **Step 4: 保持现有渲染语义不变**

要求：
- 不改变 `queuedCoordToChunk` 的一致性
- 不改变 `commitDirtyBuffers()` 时机
- 不破坏 AO 延迟写回逻辑

- [ ] **Step 5: 重新运行浏览器测试并验证**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- `test-global-instanced-mesh-manager.js` 全部通过
- 无坐标索引、AO、patch/remove 相关回归

## Task 4: 用 lint 和运行期日志验证 P1 目标

**Files:**
- Modify: 无（验证任务）

- [ ] **Step 1: 运行 ESLint**

Run:
```bash
npm run lint
```

Expected:
- lint 通过

- [ ] **Step 2: 启动项目并跑运行期验证**

Run:
```bash
npm run start
```

然后在浏览器中：
- 进入游戏
- 按 `L` 打开 `ChunkPerf`
- 按 `N` 控制 `StreamingPerf`
- 奔跑触发连续远端 chunk 加载

- [ ] **Step 3: 记录并比对关键指标**

重点观察：
- `block-scatter.flush-ready`
- `block-scatter.scatter`
- `chunk-assembly.task` 中的 `finalize` 相关阶段
- `chunk-assembly.process`
- `StreamingPerf.flushMaxMs`
- `StreamingPerf.mutationQueueBlocks`
- `requestAnimationFrame` violation

Expected:
- `flush-ready` 明显低于当前基线
- `finalize` 不再频繁出现单次 `10ms+`
- `mutationQueueBlocks` 积压下降更快或峰值降低
- 远端 chunk 首次可见时机不劣化

## 风险与边界

- `BlockScatterManager` 改成按触达 key 消费后，若入队/出队状态管理不严谨，可能出现 ready buffer 漏处理或重复处理。
- `finalize` 切片后最容易出错的是状态机一致性，尤其是 `isReady`、`hasDeferredFinalizeWork`、AO 稳定源刷新之间的关系。
- `mutationQueue` 的优化只做第一阶段低风险改法，不在本轮引入堆结构，避免同时变更多个数据结构。
- 本计划明确不包含 Worker 回包协议重构；如本轮收益仍不足，再进入第二轮协议层优化。
