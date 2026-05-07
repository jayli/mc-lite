# Region 级 Worker 预生成实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将预生成从 "chunk 级独立生成 + 主线程后合并" 改造为 "region 级统一生成 + worker 内部完成 ownership/缓冲/补刷"，解决同一大结构被多个 chunk 任务重复执行的问题。

**架构:** 在 WorldWorker.js 新增 `generateRegion` 消息类型，在单个 worker 调用内同步循环生成整个 region（8x8=64 个 chunk）的所有 chunk，共享 region 级候选索引和去重集合，内部完成 overflow routing 后一次性返回完整 region 结果。WorldGenerationService 的 `_generateRegion` 简化为单次 worker 调用。

**技术栈:** Web Workers (WorldWorker.js), JavaScript ES Modules, WorldGenerationService

**关键文件:**
- `src/workers/WorldWorker.js` — Worker 入口，新增 region 生成逻辑
- `src/world/WorldGenerationService.js` — 预生成服务，简化 `_generateRegion`
- `src/workers/structure-index/StructureCandidateIndex.js` — 候选索引（无需改动）
- `src/workers/structure-index/LargeStaticCandidateCollector.js` — 候选收集（无需改动）

---

## 实施策略

- **TDD 不适用**: 这是重构型任务，项目没有 CLI 测试框架，测试通过浏览器内测试完成
- **DRY**: 提取 `generateChunkWithSharedState` 复用现有 chunk 生成逻辑
- **YAGNI**: 只做预生成路径，运行时 chunk 加载不动
- **频繁提交**: 每个 Task 完成后单独提交

---

### Task 1: Worker 侧 — 提取 `generateChunkWithSharedState` 函数

**Files:**
- Modify: `src/workers/WorldWorker.js`

**目标:** 将 `onmessage` 中的 chunk 生成逻辑提取为可复用函数，支持注入外部状态。

**Step 1: 分析现有逻辑边界**

阅读 `WorldWorker.js` 的 `onmessage` handler（line 477-1937），识别需要参数化的部分：

- `structureCandidateIndex` → 改为可注入参数
- `largeStructureTaskKeySet` → 改为可注入参数
- `structureQueueWithCenters` → 改为可注入参数
- `blockMap`, `modGunMan`, `rovers`, `structureCenters` 等局部变量 → 保持内部创建
- `fakeChunk` → 保持内部创建
- `savedSnapshot` → region 生成时为 null
- `isOptimization` → false
- `skipTerrainGeneration` → false

**Step 2: 创建 `generateChunkWithSharedState` 函数**

在 `WorldWorker.js` 的 `onmessage` 之前（约 line 470 处）添加新函数：

```javascript
/**
 * 生成单个 chunk，使用外部注入的共享状态。
 * 用于 region 级生成路径，多个 chunk 共享同一个候选索引和去重集合。
 *
 * @param {Object} params
 * @param {number} params.cx - Chunk X
 * @param {number} params.cz - Chunk Z
 * @param {number} params.seed - 世界种子
 * @param {StructureCandidateIndex} params.candidateIndex - 共享的候选索引
 * @param {Set} params.largeStructureTaskKeySet - 共享的大结构去重集合
 * @param {Array} params.structureQueueWithCenters - 共享的结构生成队列
 * @param {Array} params.structureCenters - 共享的结构中心列表
 * @param {Array} params.modGunMan - 共享的 gun_man 实体列表
 * @param {Array} params.rovers - 共享的 rover 实体列表
 * @returns {Object} chunk 结果 { blockDataBlocks, scatteredBlocks, routing, meshData, ... }
 */
function generateChunkWithSharedState(params) {
  const {
    cx, cz, seed,
    candidateIndex,
    largeStructureTaskKeySet,
    structureQueueWithCenters,
    structureCenters,
    modGunMan,
    rovers
  } = params;

  const CHUNK_SIZE = 16;
  const minX = cx * CHUNK_SIZE;
  const maxX = (cx + 1) * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const maxZ = (cz + 1) * CHUNK_SIZE;

  const blockMap = new Map();
  const structureQueue = [];
  // 这些 Set 在 region 路径下不需要，因为 candidate 已在外部去重
  const islandTowerCenters = new Set();
  const plainLandCastleCenters = new Set();
  const cityStructureCenters = new Set();
  const cityFillerHouseCenters = new Set();
  const cityTreeCenters = new Set();
  const cityTallTreeCenters = new Set();
  const citySwampTreeCenters = new Set();
  const cityYellowTreeCenters = new Set();
  const cityBirchTreeCenters = new Set();
  const cityFlowerBedCenters = new Set();
  const cityPavilionFootprintCells = new Set();
  const cityTallWellFootprintCells = new Set();
  const cityCoreCandidates = [];

  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true, orientation = 0) => {
      const key = encodeCoord(x, y, z);
      const existing = blockMap.get(key);
      if (existing && existing.type !== 'air' && type !== 'air') return;
      blockMap.set(key, { x, y, z, type, solid, orientation });
    },
    getBlockType: (x, y, z) => {
      const key = encodeCoord(x, y, z);
      return blockMap.get(key)?.type || null;
    }
  };

  // -- 地形生成（复用 onmessage 中 !isOptimization && !skipTerrainGeneration 块的内容）--
  // 此处完整复制 line 566-1581 的地形/结构生成逻辑，但做以下替换：
  // - 所有对 structureCandidateIndex 的引用 → 改为使用 candidateIndex 参数
  // - 所有对 largeStructureTaskKeySet 的引用 → 改为使用传入的 largeStructureTaskKeySet
  // - 所有对 structureQueueWithCenters 的 push → 改为 push 到传入的 structureQueueWithCenters
  // - pushStructureCenter → push 到传入的 structureCenters
  // - snapshot 相关逻辑 → 跳过（region 生成没有 snapshot）
  // - ... 详细代码见 Step 3 ...

  // -- 方块数据处理 --
  const blockDataBlocks = buildBlockDataBlocks(blockMap);
  const scatteredBlocks = []; // region 生成不需要 scatteredBlocks（不需要渲染）
  const meshData = []; // region 生成不需要 meshData
  const routing = buildChunkRouting(blockDataBlocks, scatteredBlocks, cx, cz, meshData);

  return {
    blockDataBlocks,
    routing,
    structureCenters: [...structureCenters],
    modGunMan: [...modGunMan],
    rovers: [...rovers]
  };
}
```

**Step 3: 复制地形生成逻辑到函数内**

将 `onmessage` 中从 line 566（`// 地形生成：房间、CityMap...`）到 line 1581（`} // end if (!isOptimization)`）的完整逻辑复制到 `generateChunkWithSharedState` 中，做以下变量替换：

1. `structureCandidateIndex` → `candidateIndex`
2. `largeStructureTaskKeySet`（原为局部变量）→ 使用参数
3. `structureQueueWithCenters`（原为局部变量）→ 使用参数
4. `pushStructureCenter` 内部操作 → push 到 `params.structureCenters`
5. 删除 `savedSnapshot` 相关代码（region 生成无 snapshot）
6. 删除 `isOptimization` / `skipTerrainGeneration` 判断（始终为 false）

**Step 4: 保持现有 `onmessage` 不变**

现有 `onmessage` 中的所有逻辑保持不动，确保运行时 chunk 加载和 consolidation 路径不受影响。

**Step 5: 验证**

```bash
npm run lint
```

确保无新增 lint 警告。

---

### Task 2: Worker 侧 — 实现 `handleRegionGeneration` 函数

**Files:**
- Modify: `src/workers/WorldWorker.js`

**目标:** 实现 region 级生成入口函数，协调 chunk 循环、overflow 路由和结果返回。

**Step 1: 创建 `handleRegionGeneration` 函数**

在 `generateChunkWithSharedState` 之后添加：

```javascript
/**
 * Region 级生成入口函数。
 * 在单个 worker 调用内同步循环生成整个 region 的所有 chunk，
 * 共享候选索引和去重集合，内部完成 overflow routing。
 */
async function handleRegionGeneration(data) {
  const { rx, rz, seed, taskId } = data;
  const REGION_CHUNK_SIZE = 8;
  const CHUNK_SIZE = 16;

  // 1. Region 级共享状态
  const regionCandidateIndex = new StructureCandidateIndex();
  const regionLargeStructureTaskKeySet = new Set();
  const regionStructureQueueWithCenters = [];
  const regionStructureCenters = [];
  const regionModGunMan = [];
  const regionRovers = [];

  // 2. 逐个 chunk 同步生成
  const regionChunks = {};
  for (let localCx = 0; localCx < REGION_CHUNK_SIZE; localCx++) {
    for (let localCz = 0; localCz < REGION_CHUNK_SIZE; localCz++) {
      const cx = rx * REGION_CHUNK_SIZE + localCx;
      const cz = rz * REGION_CHUNK_SIZE + localCz;

      const chunkResult = generateChunkWithSharedState({
        cx, cz, seed,
        candidateIndex: regionCandidateIndex,
        largeStructureTaskKeySet: regionLargeStructureTaskKeySet,
        structureQueueWithCenters: regionStructureQueueWithCenters,
        structureCenters: regionStructureCenters,
        modGunMan: regionModGunMan,
        rovers: regionRovers
      });

      regionChunks[`${cx},${cz}`] = chunkResult;
    }
  }

  // 3. Worker 内部 overflow routing
  const routingDiagnostics = resolveOverflowWithinRegion(
    regionChunks, rx, rz, REGION_CHUNK_SIZE
  );

  // 4. 返回完整 region 结果
  postMessage({
    type: 'regionGenerated',
    rx, rz,
    chunks: regionChunks,
    routingDiagnostics,
    taskId
  });
}
```

**Step 2: 创建 `resolveOverflowWithinRegion` 函数**

```javascript
/**
 * 在 Worker 内部完成 region 内的 overflow 方块路由。
 * 替代主线程的 _mergeOverflowBlocks。
 */
function resolveOverflowWithinRegion(regionChunks, rx, rz, regionChunkSize) {
  const resolved = 0;
  const unresolved = 0;
  const unresolvedCoords = new Set();
  const unresolvedByDistance = new Map();

  const regionMinCx = rx * regionChunkSize;
  const regionMaxCx = regionMinCx + regionChunkSize - 1;
  const regionMinCz = rz * regionChunkSize;
  const regionMaxCz = regionMinCz + regionChunkSize - 1;

  for (const [sourceKey, result] of Object.entries(regionChunks)) {
    if (!result.routing?.overflowChunks) continue;

    for (const overflowEntry of result.routing.overflowChunks) {
      const [targetCx, targetCz] = overflowEntry.chunkKey.split(',').map(Number);
      const isInRegion = (
        targetCx >= regionMinCx && targetCx <= regionMaxCx &&
        targetCz >= regionMinCz && targetCz <= regionMaxCz
      );

      if (!isInRegion) {
        // 目标超出 region
        unresolved += overflowEntry.blockDataBlocks?.length || 0;
        const [sourceCx, sourceCz] = sourceKey.split(',').map(Number);
        const offsetKey = `${targetCx - sourceCx},${targetCz - sourceCz}`;
        unresolvedByDistance.set(offsetKey, (unresolvedByDistance.get(offsetKey) || 0) + (overflowEntry.blockDataBlocks?.length || 0));
        for (const block of (overflowEntry.blockDataBlocks || [])) {
          unresolvedCoords.add(encodeCoord(block.x, block.y, block.z));
        }
        continue;
      }

      const targetResult = regionChunks[overflowEntry.chunkKey];
      if (!targetResult) continue;

      for (const block of (overflowEntry.blockDataBlocks || [])) {
        const code = encodeCoord(block.x, block.y, block.z);
        if (targetResult.blockData[code] === undefined) {
          // 将 overflow 方块追加到目标 chunk 的 routing.ownChunk.blockDataBlocks
          targetResult.routing.ownChunk.blockDataBlocks.push({
            x: block.x,
            y: block.y,
            z: block.z,
            type: block.type,
            orientation: block.orientation || 0
          });
          resolved++;
        }
      }
    }
  }

  return {
    resolved,
    unresolved,
    uniqueUnresolvedCoords: unresolvedCoords.size,
    topDistanceBuckets: Array.from(unresolvedByDistance.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([offset, blocks]) => ({ offset, blocks }))
  };
}
```

**Step 3: 在 `onmessage` 入口添加 type 分发**

修改 `WorldWorker.js` line 477 附近的 `onmessage` 入口：

```javascript
onmessage = async function(e) {
  const { type = 'generateChunk', ... } = e.data;

  if (type === 'generateRegion') {
    await handleRegionGeneration(e.data);
    return;
  }

  // ... 现有 generateChunk 逻辑保持不变 ...
};
```

需要从 `e.data` 中解构时加上 `type`：

```javascript
// 原代码:
const {
  cx, cz, seed, snapshot, structureCenters: incomingStructureCenters,
  callbackKey, taskId, isOptimization = false,
  _consolidationRequestSentAt = 0, textureGroups = {},
  skipTerrainGeneration = false
} = e.data;

// 改为:
const {
  type = 'generateChunk',
  cx, cz, seed, snapshot, structureCenters: incomingStructureCenters,
  callbackKey, taskId, isOptimization = false,
  _consolidationRequestSentAt = 0, textureGroups = {},
  skipTerrainGeneration = false
} = e.data;
```

**Step 4: 验证**

```bash
npm run lint
```

---

### Task 3: 主线程 — 精简 `WorldGenerationService._generateRegion`

**Files:**
- Modify: `src/world/WorldGenerationService.js`

**目标:** 将 `_generateRegion` 从循环 100+ 次 `_generateChunkWithRouting` + `_mergeOverflowBlocks` 简化为单次 worker 调用。

**Step 1: 重写 `_generateRegion` 方法**

替换 `WorldGenerationService.js` 中 `_generateRegion` 方法（约 line 213-270）：

```javascript
/**
 * 生成单个 region（8x8 chunk）
 *
 * 策略：一次 worker 调用完成整个 region 的生成，
 * worker 内部共享候选索引和去重集合，完成 overflow routing。
 */
async _generateRegion(rx, rz) {
  const regionKey = this._regionKey(rx, rz);

  return new Promise((resolve) => {
    const taskId = `pregen-region:${rx},${rz}:${Date.now()}`;

    workerCallbacks.set(taskId, (data) => {
      // 构建 RegionRecord：直接使用 worker 返回的 chunks
      const chunks = {};
      const chunkKeys = [];

      for (const [chunkKey, result] of Object.entries(data.chunks)) {
        const [cx, cz] = chunkKey.split(',').map(Number);
        if (!this._isChunkInRegion(cx, cz, rx, rz)) continue;

        chunkKeys.push(chunkKey);
        chunks[chunkKey] = {
          blockData: this._buildBlockDataFromRouting(result),
          staticEntities: this._buildStaticEntities(result),
          runtimeSeedData: {
            structureCenters: result.structureCenters || []
          }
        };
      }

      const regionRecord = {
        regionKey,
        rx,
        rz,
        chunkKeys,
        chunks,
        generatedAt: Date.now(),
        generatorVersion: '1.0',
        routingDiagnostics: data.routingDiagnostics
      };

      getWorldStore().saveRegionRecord(rx, rz, regionRecord);

      if (data.routingDiagnostics?.unresolved > 0) {
        console.warn('[WorldGenerationService] Region generation had unresolved overflow blocks', {
          regionKey,
          ...data.routingDiagnostics
        });
      }

      resolve(regionRecord);
    });

    getWorldWorker().postMessage({
      type: 'generateRegion',
      rx,
      rz,
      taskId,
      seed: this._seed
    });
  });
}
```

**Step 2: 添加 `_buildBlockDataFromRouting` 辅助方法**

```javascript
/**
 * 从 chunk 结果中提取 blockData（优先使用 routing.ownChunk + 已路由的 overflow）。
 */
_buildBlockDataFromRouting(result) {
  const blockData = {};

  // 优先使用 routing.ownChunk 的 blockDataBlocks
  const blocks = result.routing?.ownChunk?.blockDataBlocks || result.blockDataBlocks || [];
  for (const block of blocks) {
    const code = encodeCoord(block.x, block.y, block.z);
    const entry = block.orientation ? { type: block.type, orientation: block.orientation } : block.type;
    blockData[code] = entry;
  }

  return blockData;
}
```

**Step 3: 保留但不使用的旧方法**

以下方法保留（未来扩图路径或运行时路径可能使用），但 `_generateRegion` 不再调用：
- `_generateChunkWithRouting` — 保留注释标记 `@deprecated 仅用于兼容，预生成已改用 region 级路径`
- `_mergeOverflowBlocks` — 同上

**Step 4: 验证**

```bash
npm run lint
```

---

### Task 4: 冒烟测试与提交

**Files:**
- 无文件变更

**Step 1: 启动开发服务器**

```bash
npm run start
```

**Step 2: 浏览器内测试**

1. 打开浏览器，访问 `http://localhost:8080`
2. 创建一个新存档（触发预生成）
3. 在浏览器控制台观察日志：
   - 应该看到 `[WorldGenerationService] Region X,Y done` 格式的日志
   - 不应该看到大结构重复生成的警告
   - 检查 `routingDiagnostics.unresolved` 是否为 0 或接近 0
4. 确认玩家出生在世界中心附近，周围地形正常生成
5. 向各个方向移动，确认地形加载正常

**Step 3: 提交**

```bash
git add src/workers/WorldWorker.js src/world/WorldGenerationService.js
git commit -m "feat(world): region-level worker pre-generation

Refactor pre-generation from chunk-level independent calls to
region-level unified worker calls. This eliminates duplicate
large structure generation caused by multiple chunk tasks
executing the same candidate.

- Extract generateChunkWithSharedState() in WorldWorker.js
- Add handleRegionGeneration() with shared candidate index
  and cross-chunk dedup set
- Add resolveOverflowWithinRegion() for in-worker routing
- Simplify WorldGenerationService._generateRegion() to
  single worker.postMessage call
- Backward compatible: runtime chunk loading path unchanged"
```

---

## 风险清单

| 风险 | 应对 |
|------|------|
| `generateChunkWithSharedState` 提取时遗漏某些变量引用 | 仔细对比 onmessage 中所有被引用的局部变量 |
| Region 生成耗时过长导致 worker pool 阻塞 | 第一期仅预生成（阻塞流程），不影响运行时 |
| Overflow 方块落到 region 外 | 记录 diagnostics 统计，二期处理 |
| `structureCandidateIndex` 在 region 生成时 tile cache 不够大 | tile 扫描范围是自动计算的，覆盖整个 region 没问题 |
