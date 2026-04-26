# Region 级 Worker 预生成设计

日期：2026-04-26
状态：待实施（第一期：仅预生成；第二期：运行时路径）

## 问题陈述

当前预生成实现为 **chunk 级独立生成 + 主线程后合并**：

- `WorldGenerationService._generateRegion()` 循环 100+ 次 `_generateChunkWithRouting(cx, cz)`
- 每次都是一次独立的 `worker.postMessage({ cx, cz, ... })`
- 每个 worker 调用各自构建 `StructureCandidateIndex`、各自维护 `largeStructureTaskKeySet`（per-chunk 去重）
- 同一个大结构候选被多个相邻 chunk 的 worker 调用各自执行，导致重复生成
- `CityMap` 的间距逻辑防的是"不同结构中心太近"，防不了"同一结构被多次执行"
- Overflow 方块路由在主线程 `_mergeOverflowBlocks()` 后处理，增加复杂性

**一句话归纳**：间距逻辑防的是 A 结构和 B 结构重叠；现在的问题是同一个 A 结构被 chunk(1,1)、chunk(1,2)、chunk(2,1)、chunk(2,2) 各执行一次。

## 目标

- **第一期**（本设计范围）：将预生成改为 **region 级统一生成 + worker 内部完成 ownership/缓冲/补刷**
- **第二期**（后续）：考虑运行时 chunk 加载是否也走 region 级路径

## 架构变更

### 现状

```
WorldGenerationService._generateRegion(rx, rz)
  └─ 循环 100+ 次 _generateChunkWithRouting(cx, cz)
      └─ 每次独立 worker.postMessage({ cx, cz, ... })
          └─ Worker 内部各自构建 candidates，各自 per-chunk 去重
              └─ 主线程 _mergeOverflowBlocks() 路由跨 chunk 方块
```

### 改造后

```
WorldGenerationService._generateRegion(rx, rz)
  └─ 一次 worker.postMessage({ type: 'generateRegion', rx, rz, ... })
      └─ Worker 内部：
          1. 构建 region 级 candidate index（tile cache 天然覆盖整个 region）
          2. 维护 region 级 largeStructureTaskKeySet（跨 chunk 共享）
          3. 按 chunk 逐个同步生成，共享同一个候选池
          4. 内部完成 overflow routing
          5. 返回完整 region 结果
  └─ 主线程直接写入 WorldStore.saveRegionRecord()
```

## 组件设计

### 1. Worker 侧 `generateRegion` 消息处理

**文件**：`src/workers/WorldWorker.js`

在 `onmessage` 入口增加 `message.type` 判断：

```javascript
onmessage = async function(e) {
  const { type = 'generateChunk', ... } = e.data;

  if (type === 'generateRegion') {
    await handleRegionGeneration(e.data);
    return;
  }

  // 现有 chunk 级生成逻辑（保持不变）
  ...
};
```

`handleRegionGeneration` 核心流程：

1. 创建 region 级 `StructureCandidateIndex`（tile cache 自动跨 chunk 复用）
2. 初始化 `regionLargeStructureTaskKeySet`（跨 chunk 共享去重）
3. 按 chunk 逐个同步循环生成，调用 `generateChunkWithSharedState`
4. 内部执行 `resolveOverflowWithinRegion` 完成方块路由
5. 返回 `{ type: 'regionGenerated', rx, rz, chunks, routingDiagnostics }`

### 2. `generateChunkWithSharedState`

**文件**：`src/workers/WorldWorker.js`

从现有 `onmessage` 中提取 chunk 级生成逻辑为独立函数，关键改动：

- 接收外部传入 `candidateIndex`（替代内部 `new StructureCandidateIndex()`）
- 接收外部传入 `largeStructureTaskKeySet`（替代内部 `new Set()`）
- 接收外部传入 `structureQueueWithCenters`（替代局部变量）
- 其余逻辑（地形生成、结构放置、snapshot 应用等）完全不变

保证向后兼容：运行时路径仍走现有的独立 chunk 生成。

### 3. `resolveOverflowWithinRegion`

**文件**：`src/workers/WorldWorker.js`

替代主线程的 `_mergeOverflowBlocks`，在 worker 内部同步执行：

- 遍历 region 内所有 chunk 的 `routing.overflowChunks`
- 如果目标 chunk 在当前 region 内，直接路由到正确 chunk 的 `blockData`
- 如果目标 chunk 超出 region 范围，标记为 unresolved 并记录统计
- 返回 `{ resolved, unresolved, diagnostics }`

### 4. `WorldGenerationService._generateRegion` 精简

**文件**：`src/world/WorldGenerationService.js`

从当前的循环 100+ 次 `_generateChunkWithRouting` + `_mergeOverflowBlocks` 简化为：

- 一次 `worker.postMessage({ type: 'generateRegion', rx, rz, taskId, seed })`
- 回调中直接构建 `RegionRecord` 并写入 `WorldStore`

## 向后兼容

| 路径 | 变更 |
|------|------|
| 预生成（新档初始 + 后台扩图） | 走 `generateRegion` 新路径 |
| 运行时 chunk 加载 | 保持现有 `generateChunk` 路径不动 |
| Consolidation | 保持现有 `isOptimization` 路径不动 |
| WorldWorkerPool | busy/idle 机制不变，仅单个任务耗时变长 |
| StructureCandidateIndex | tile cache 天然适配，无需改动 |

## 关键收益

| 问题 | 现状 | 改造后 |
|------|------|--------|
| 大结构重复生成 | 多个 chunk 各自执行同一 candidate | region 级去重集合，只执行一次 |
| Overflow 路由 | 主线程后处理 | Worker 内部同步解决 |
| 间距逻辑与生成解耦 | 布局确定后多任务各自执行 | 生成与布局在同一作用域 |

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 单个 region 生成耗时较长，占用 worker | 预生成是阻塞流程，用户本身在等待界面；同步串行避免并发协调复杂度 |
| Overflow 方块可能落到 region 外 | 记录 unresolved 统计，后续扩图时可覆盖（二期考虑） |
| 现有 chunk 生成逻辑提取为共享函数可能遗漏细节 | 通过 `generateChunkWithSharedState` 提取时保留所有现有逻辑，只注入外部状态 |

## 第二期考虑（不在本设计范围）

- 运行时 chunk 加载是否改为 region 级路径
- Region 级生成结果的缓存与复用
- 跨 region 的 overflow 路由机制
