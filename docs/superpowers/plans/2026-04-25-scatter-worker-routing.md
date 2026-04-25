# Scatter Worker Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `scatter` 的目标 chunk 归属判断与可见性二次转换从主线程前移到 Worker，减少 Worker 回包后的主线程逐 block 装配开销。

**Architecture:** Worker 新增 `routing` 回包结构，直接把 own chunk 与 overflow chunk 的逻辑块/可见块按目标 chunk 预分桶。主线程优先消费 `routing` 字段，`BlockScatterManager` 不再逐 block 重新推导 chunk 归属；`Chunk` 直接接收 `blockDataBlocks + visibleBlocks`，不再依赖 `visibleKeys` 做二次查询。第一阶段保留旧字段作为 fallback 和调试对照。

**Tech Stack:** Vanilla JS、Web Worker、Three.js、浏览器内测试页 `src/tests/index.html`、ESLint、`ChunkPerf` / `StreamingPerf` 日志。

---

## 文件结构

- Modify: `src/workers/WorldWorker.js`
  - 新增 `routing` 回包字段
  - 一次遍历直接产出 own chunk / overflow chunk 分桶
  - 保留旧字段作为过渡

- Modify: `src/world/BlockScatterManager.js`
  - `scatter()` 优先消费 `routing`
  - buffer 结构从 `visibleBlockKeys` 转向 `visibleBlocks`
  - old path 保留短期 fallback

- Modify: `src/world/Chunk.js`
  - `acceptScatteredBlocks()` 改为接收 `visibleBlocks`
  - `appendScatteredBlocks()` 改为接收 `visibleBlocks`
  - 删除可见性 key 集合重建的主路径依赖

- Modify: `src/world/World.js`
  - 如有需要，仅调整打点细节与字段透传

- Modify: `src/tests/test-block-scatter-manager.js`
  - 新增 routing 分桶消费测试

- Modify: `src/tests/test-world.js`
  - 新增 Worker routing 与主线程装配衔接测试

- Modify: `src/tests/test-worker-world.js`
  - 如果已有 worker 结果契约测试，则补 routing 契约

- Modify: `src/tests/index.html`
  - 仅当新增测试文件需要注册时修改

## Task 1: 固定新回包协议的数据契约

**Files:**
- Modify: `src/tests/test-worker-world.js` 或现有 WorldWorker 相关测试文件
- Modify: `src/tests/index.html`（如需注册新测试）

- [ ] **Step 1: 检查现有 Worker 契约测试入口**

检查：
- `src/tests/` 下是否已有 `WorldWorker` 或 chunk worker 契约测试
- 若没有，确认本轮是在现有测试文件中补，还是新增 `src/tests/test-world-worker-routing.js`

- [ ] **Step 2: 先写失败测试，固定 routing 字段结构**

新增测试覆盖：
- 回包包含 `routing.schemaVersion`
- `routing.ownChunk.chunkKey === \`${cx},${cz}\``
- `routing.overflowChunks` 为按目标 chunk 分组的数组
- `routing.ownChunk.visibleBlocks` 只包含可见块
- 保留旧字段时，新旧字段在数量语义上可对照

- [ ] **Step 3: 运行测试，确认新契约尚未实现**

Run:
```bash
npm run start
```

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增 routing 契约测试失败
- 失败原因指向 `WorldWorker` 尚未回传 `routing`

## Task 2: 在 Worker 中一次遍历产出 own / overflow 分桶

**Files:**
- Modify: `src/workers/WorldWorker.js`
- Test: `src/tests/test-worker-world.js` 或 `src/tests/test-world-worker-routing.js`

- [ ] **Step 1: 识别现有 blockMap 到回包结果的构建路径**

重点阅读：
- `buildScatteredBlocks`
- `buildMeshDataForChunk`
- 回包前 `blockMap` 的遍历逻辑

明确当前哪一轮遍历最适合直接产出：
- `ownChunk.blockDataBlocks`
- `ownChunk.visibleBlocks`
- `overflowChunks[].blockDataBlocks`
- `overflowChunks[].visibleBlocks`

- [ ] **Step 2: 实现 routing 中间结构，但先不删旧字段**

要求：
- 新增按 `chunkKey` 分桶的中间 Map
- own chunk 走 fast path
- overflow chunk 仅在真实越界时落桶
- 每个桶分别保存逻辑块与可见块

- [ ] **Step 3: 在 postMessage 中追加 routing 字段**

要求：
- 加入 `routing.schemaVersion`
- 回包继续保留：
  - `blockDataBlocks`
  - `scatteredBlocks`
  - `visibleKeys`
- 第一阶段不移除任何旧字段

- [ ] **Step 4: 重新运行测试，验证新契约通过**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- routing 契约测试通过
- 现有 WorldWorker 相关测试不回归

## Task 3: 让 BlockScatterManager 优先消费 routing，而不是逐 block 重算归属

**Files:**
- Modify: `src/world/BlockScatterManager.js`
- Test: `src/tests/test-block-scatter-manager.js`

- [ ] **Step 1: 先补失败测试，固定 scatter 的新消费路径**

新增测试覆盖：
- 当 `workerResult.routing` 存在时，`scatter()` 不再依赖旧的平铺 `blockDataBlocks`
- own chunk 直接进入 own buffer
- overflow chunk 按桶进入 `pendingCrossChunkPatchBuffers`
- 不再要求为每个 block 重算 `chunkCx/chunkCz`

- [ ] **Step 2: 运行测试，确认当前 scatter 仍是旧路径**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增测试失败
- 失败原因指向 `scatter()` 尚未消费 routing

- [ ] **Step 3: 重构 BlockScatterManager buffer 结构**

要求：
- 将 buffer 结构从：
  - `blocks`
  - `visibleBlockKeys`
- 调整为优先支持：
  - `blockDataBlocks`
  - `visibleBlocks`
  - `meshData`

- [ ] **Step 4: 实现 routing 快路径**

要求：
- `scatter()` 先检查 `workerResult.routing`
- 若存在：
  - 直接接 own chunk 桶
  - 逐 overflow 桶处理
- 若不存在：
  - 回退到旧逻辑

- [ ] **Step 5: 保持 flushReadyChunks 与 deferred patch 语义不变**

要求：
- own chunk 仍走 `acceptScatteredBlocks`
- ready chunk 追加仍走 `appendScatteredBlocks`
- not-ready overflow 仍可进入 deferred patch buffer

- [ ] **Step 6: 重新运行测试并验证**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- `test-block-scatter-manager.js` 全部通过
- 无首帧装配和跨 chunk patch 语义回归

## Task 4: 让 Chunk 直接消费 visibleBlocks，去掉 visibleKeys 主路径依赖

**Files:**
- Modify: `src/world/Chunk.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 先补失败测试，固定 Chunk 新入参语义**

新增测试覆盖：
- `acceptScatteredBlocks(blockDataBlocks, visibleBlocks, ...)`
  - 逻辑块都写入 `blockData`
  - 只有 `visibleBlocks` 进入 `visibleKeys` 与渲染路径
- `appendScatteredBlocks(...)`
  - 逻辑写入和可见写入分离

- [ ] **Step 2: 运行测试，确认当前实现仍依赖 visible key 集合**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新测试失败
- 失败原因指向 `Chunk` 仍要求 `visibleBlockKeys`

- [ ] **Step 3: 修改 acceptScatteredBlocks 主路径**

要求：
- 直接用 `blockDataBlocks` 写入逻辑数据
- 直接遍历 `visibleBlocks` 填充 `visibleKeys`
- 不再创建 `encodedVisibleKeys` 作为主路径数据
- `workerMeshData` 仍优先使用

- [ ] **Step 4: 修改 appendScatteredBlocks 主路径**

要求：
- 追加逻辑块时不依赖 `visibleKeysSet`
- 可见块直接驱动 `visibleKeys` 更新
- deferred patch 语义保持不变

- [ ] **Step 5: 保留短期兼容分支**

要求：
- 若上游仍传旧参数，短期内允许 fallback
- 但新 routing 路径应成为默认主路径

- [ ] **Step 6: 重新运行测试并验证**

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- `test-world.js` 新增测试通过
- 现有 chunk 装载测试不回归

## Task 5: 用日志和浏览器场景验证性能与行为

**Files:**
- Modify: 无（验证任务）

- [ ] **Step 1: 运行 ESLint**

Run:
```bash
npm run lint
```

Expected:
- lint 通过

- [ ] **Step 2: 启动项目并进行运行期验证**

Run:
```bash
npm run start
```

在浏览器中：
- 进入游戏
- 按 `L` 打开 `ChunkPerf`
- 按 `N` 打开 `StreamingPerf`
- 连续奔跑触发远端 chunk 装载

- [ ] **Step 3: 记录关键指标**

重点观察：
- `block-scatter.scatter`
- `world.chunk-worker-result`
- `chunk.accept-scattered-blocks`
- `mutationQueueBlocks`

预期：
- `scatter` 相比改造前明显下降
- 远端 chunk 首次可见时机不变差
- 没有出现边界漏块、重复块、晚到 patch 覆盖 tombstone

- [ ] **Step 4: 做跨 chunk 边界专项检查**

人工场景：
- 穿越结构边界奔跑加载
- 先修改边界方块，再加载邻居 chunk
- 验证：
  - 无重复渲染
  - 无漏渲染
  - 删除优先级正确

## Task 6: 清理旧字段与旧逻辑的收尾计划（单独提交，不与主改混做）

**Files:**
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/world/BlockScatterManager.js`
- Modify: `src/world/Chunk.js`
- Test: 相关测试文件

- [ ] **Step 1: 等新路径稳定后，再评估是否删除旧字段**

删除前确认：
- routing 路径已稳定
- 所有相关测试已补齐
- perf 对比数据已记录

- [ ] **Step 2: 在单独提交中清理旧路径**

目标：
- 移除 `visibleKeys` 主路径依赖
- 移除 `scatter()` 中逐 block 归属判断旧逻辑
- 收紧 API，只保留新协议

- [ ] **Step 3: 再跑一次完整验证**

要求：
- 功能不回归
- perf 不倒退

