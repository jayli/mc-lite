# Optimize Structure Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `WorldWorker` 中每个 chunk 都重复执行的大范围结构扫描，改为可缓存的结构候选索引查询，显著降低 chunk 生成耗时。

**Architecture:** 新增一个 worker 侧 `StructureCandidateIndex`，按世界区域生成并缓存结构中心候选；chunk 生成时只查询与当前 chunk 责任范围相交的候选结构，再生成结构切片。保留现有地形和结构生成语义，先迁移大型静态结构扫描，再迁移 static_tree 补扫，最后加性能和一致性验证。

**Tech Stack:** JavaScript ES Modules、Web Worker、Three.js 项目现有浏览器测试页、ESLint。

---

## 背景与问题

当前 `src/workers/WorldWorker.js` 在每个 chunk 任务中执行两段重复扫描：

- 大型静态结构邻域扫描：`scannedMinX..scannedMaxX` 与 `scannedMinZ..scannedMaxZ`，在 `LARGE_STATIC_SCAN_PADDING` 最大为 `castle=36` 时约扫描 `88*88=7744` 个 XZ 点。
- static_tree 邻域补扫：约扫描 `32*32=1024` 个 XZ 点。

这些扫描对相邻 chunk 高度重叠。即使已经有 3 个 `WorldWorker` 并行，每个 worker 任务仍然重复调用 City、Pyramid、Island、PlainLand、SnowLand、FrozenMountain、height、biome、seededRandom 等判定，CPU 总量没有下降。

本计划的核心不是“并行更多 worker”，而是减少单个 chunk 生成任务所需的重复计算量。

## 文件结构

- Create: `src/workers/structure-index/StructureCandidateIndex.js`
  - worker 内结构候选索引入口。
  - 提供 `getStructureCandidatesForChunk(cx, cz, seed, terrainGen)`。
  - 缓存区域级候选，避免相邻 chunk 重复扫描。

- Create: `src/workers/structure-index/StructureCandidateTypes.js`
  - 候选结构的轻量数据格式和常量。
  - 定义 candidate schema、cache key、scan padding helper。

- Create: `src/workers/structure-index/LargeStaticCandidateCollector.js`
  - 收集大型静态结构候选，包括 City placement、Island tower、PlainLand pyramidIsland、普通大结构概率点。
  - 不生成方块，只返回 `{ type, x, y, z, source }`。

- Create: `src/workers/structure-index/StaticTreeCandidateCollector.js`
  - 收集 static_tree 候选，第一阶段只覆盖当前补扫逻辑中的 AZALEA static_tree。
  - 后续可扩展到普通树，但本计划不扩大行为面。

- Modify: `src/workers/WorldWorker.js`
  - 删除或旁路 `scannedMinX/scannedMaxX` 逐格扫描循环。
  - 改为调用 `StructureCandidateIndex` 返回候选。
  - 复用现有 `appendLargeStaticTask`、`appendStaticTreeTask`、`structureQueueWithCenters` 执行结构生成。

- Modify: `src/workers/maps/CityMap.js`
  - 必要时导出只读 layout helper，避免外部直接依赖内部 map 细节。
  - 优先复用现有 `getCityLayout()`，不要重复计算 city placements。

- Create: `src/tests/test-structure-candidate-index.js`
  - 浏览器测试，用小范围 sample 验证新索引与旧扫描候选一致。

- Modify: `src/tests/index.html`
  - 注册新测试文件。

## 关键设计

### Candidate Schema

```js
// src/workers/structure-index/StructureCandidateTypes.js
export const CANDIDATE_SOURCE = Object.freeze({
  CITY: 'city',
  ISLAND: 'island',
  PLAIN_LAND: 'plain_land',
  PROBABILISTIC_LARGE_STATIC: 'probabilistic_large_static',
  STATIC_TREE: 'static_tree'
});

export function makeCandidate(type, x, y, z, source) {
  return {
    type,
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    source
  };
}
```

### 查询边界

对 chunk `(cx, cz)`，需要查询所有可能影响该 chunk 坐标归属的结构中心。查询范围应与旧逻辑等价：

- 大型静态结构：`chunk bounds ± LARGE_STATIC_SCAN_PADDING`
- static_tree：`chunk bounds ± STATIC_TREE_SCAN_PADDING`

索引层可以按“结构中心所在 tile”缓存，但对外仍按精确矩形过滤，确保结果不多不少。

### 缓存粒度

推荐先用固定 tile 缓存，`INDEX_TILE_SIZE = 64`：

- 一个 tile 覆盖 64x64 世界坐标。
- chunk 查询范围会覆盖若干 tile。
- 每个 tile 的候选只生成一次，缓存 key 为 `${seed}:${tileX},${tileZ}`。

这比按 chunk 缓存更有效，因为相邻 chunk 查询的 tile 大量重叠。

### 兼容策略

第一阶段不改变结构生成函数，不改变方块归属，不改变 `structureCenters` 格式。只把“发现要生成哪些结构中心”的方式从逐 chunk 扫描替换为索引查询。

---

## Task 1: 提取旧扫描的候选生成逻辑为可测试函数

**Files:**
- Create: `src/workers/structure-index/StructureCandidateTypes.js`
- Create: `src/workers/structure-index/LargeStaticCandidateCollector.js`
- Test: `src/tests/test-structure-candidate-index.js`
- Modify: `src/tests/index.html`

- [ ] **Step 1: 写失败测试，验证候选去重与格式**

在 `src/tests/test-structure-candidate-index.js` 添加：

```js
import { assert, assertEqual } from './assert.js';
import { makeCandidate } from '../workers/structure-index/StructureCandidateTypes.js';

export async function testStructureCandidateShape() {
  const c = makeCandidate('tank', 1.8, 2.2, -3.7, 'probabilistic_large_static');
  assertEqual(c.type, 'tank');
  assertEqual(c.x, 1);
  assertEqual(c.y, 2);
  assertEqual(c.z, -4);
  assertEqual(c.source, 'probabilistic_large_static');
}
```

- [ ] **Step 2: 注册测试并确认失败**

修改 `src/tests/index.html`，加入 `test-structure-candidate-index.js`。

运行：启动 `npm run start`，访问 `http://localhost:8080/src/tests/index.html`，点击“运行所有测试”。

Expected: 新测试因模块不存在失败。

- [ ] **Step 3: 实现 candidate types**

创建 `src/workers/structure-index/StructureCandidateTypes.js`，内容包含 `CANDIDATE_SOURCE`、`makeCandidate()`、`candidateKey()`：

```js
export const CANDIDATE_SOURCE = Object.freeze({
  CITY: 'city',
  ISLAND: 'island',
  PLAIN_LAND: 'plain_land',
  PROBABILISTIC_LARGE_STATIC: 'probabilistic_large_static',
  STATIC_TREE: 'static_tree'
});

export function makeCandidate(type, x, y, z, source) {
  return {
    type,
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    source
  };
}

export function candidateKey(candidate) {
  return `${candidate.type}:${candidate.x},${candidate.y},${candidate.z}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run lint`

Expected: 0 errors，允许既有 warnings。

浏览器测试 Expected: `testStructureCandidateShape` PASS。

- [ ] **Step 5: 提交**

```bash
git add src/workers/structure-index/StructureCandidateTypes.js src/tests/test-structure-candidate-index.js src/tests/index.html
git commit -m "test(world): add structure candidate test scaffold"
```

## Task 2: 实现大型静态结构 tile 级候选收集器

**Files:**
- Create: `src/workers/structure-index/LargeStaticCandidateCollector.js`
- Modify: `src/tests/test-structure-candidate-index.js`

- [ ] **Step 1: 写失败测试，验证固定矩形内候选稳定**

测试使用真实 `terrainGen` 和固定 seed，调用 collector 两次，结果 key 完全一致：

```js
import { collectLargeStaticCandidatesInRect } from '../workers/structure-index/LargeStaticCandidateCollector.js';
import { terrainGen } from '../world/TerrainGen.js';
import { candidateKey } from '../workers/structure-index/StructureCandidateTypes.js';

export async function testLargeStaticCandidatesAreDeterministic() {
  const rect = { minX: -32, maxX: 96, minZ: -32, maxZ: 96 };
  const a = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  const b = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  assertEqual(JSON.stringify(a), JSON.stringify(b));
}
```

- [ ] **Step 2: 运行测试确认失败**

Expected: import 失败或函数不存在。

- [ ] **Step 3: 实现大型静态候选收集**

在 `LargeStaticCandidateCollector.js` 中从 `WorldWorker.js` 迁移以下只读逻辑：

- `getChunkBiomeByWorld(wx, wz)`
- `getSurfaceTypeByBiome(biome)`
- `isOccupiedForLargeStaticNonDesert(wx, wz, seed)`
- `isOccupiedForLargeStaticDesert(wx, wz, seed)`
- `resolveLargeStaticStructureType(params)`
- City placement 查询：复用 `CityMap.getCityLayout(seed, terrainGen)` 的 `placementMap` 与 `fillerPlacementMap`
- Island tower center 查询：通过 `IslandMap.getIslandInfo(wx, wz, seed, terrainGen)`，仅当 `wx === centerX && wz === centerZ`
- PlainLand pyramidIsland 查询：通过 `PlainLand.getPlainLandInfo(...)`

导出：

```js
export function collectLargeStaticCandidatesInRect(rect, seed, terrainGen) {
  const candidates = [];
  const seen = new Set();

  const push = (candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  // 先处理 City placementMap/fillerPlacementMap：遍历 map entries，而不是逐格扫全 rect。
  // 再处理地标中心类和概率类结构。
  return candidates;
}
```

注意：第一版可以保留概率类结构的逐点遍历，但遍历发生在 tile 生成时，tile 可被缓存；后续任务再减少概率类扫描。

- [ ] **Step 4: 运行测试和 lint**

Run: `npm run lint`

Expected: 0 errors。

浏览器测试 Expected: 新 deterministic 测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/workers/structure-index/LargeStaticCandidateCollector.js src/tests/test-structure-candidate-index.js
git commit -m "feat(world): collect large static structure candidates"
```

## Task 3: 实现 StructureCandidateIndex tile 缓存与 chunk 查询

**Files:**
- Create: `src/workers/structure-index/StructureCandidateIndex.js`
- Modify: `src/tests/test-structure-candidate-index.js`

- [ ] **Step 1: 写失败测试，验证相邻 chunk 复用 tile 缓存**

给 index 暴露测试专用统计方法 `getStats()`：

```js
import { StructureCandidateIndex } from '../workers/structure-index/StructureCandidateIndex.js';

export async function testCandidateIndexReusesTiles() {
  const index = new StructureCandidateIndex({ tileSize: 64 });
  index.getCandidatesForChunk(0, 0, 12345, terrainGen);
  const afterFirst = index.getStats();
  index.getCandidatesForChunk(1, 0, 12345, terrainGen);
  const afterSecond = index.getStats();

  assert(afterFirst.generatedTiles > 0, 'first query should generate tiles');
  assert(afterSecond.cacheHits > afterFirst.cacheHits, 'second query should reuse cached tiles');
}
```

- [ ] **Step 2: 运行测试确认失败**

Expected: `StructureCandidateIndex` 不存在。

- [ ] **Step 3: 实现索引**

`StructureCandidateIndex.js`：

```js
import { collectLargeStaticCandidatesInRect } from './LargeStaticCandidateCollector.js';
import { candidateKey } from './StructureCandidateTypes.js';
import { getStructureRenderDist, CROSS_CHUNK_OWNER_BLOCKED_TYPES } from '../../utils/StructureUtils.js';

const DEFAULT_TILE_SIZE = 64;
const CHUNK_SIZE = 16;

function getMaxLargeStaticPadding() {
  let max = 0;
  for (const type of CROSS_CHUNK_OWNER_BLOCKED_TYPES) {
    max = Math.max(max, getStructureRenderDist(type));
  }
  return Math.max(max, CHUNK_SIZE);
}

export class StructureCandidateIndex {
  constructor({ tileSize = DEFAULT_TILE_SIZE } = {}) {
    this.tileSize = tileSize;
    this.tileCache = new Map();
    this.stats = { generatedTiles: 0, cacheHits: 0 };
  }

  getCandidatesForChunk(cx, cz, seed, terrainGen) {
    const padding = getMaxLargeStaticPadding();
    const rect = {
      minX: cx * CHUNK_SIZE - padding,
      maxX: (cx + 1) * CHUNK_SIZE + padding,
      minZ: cz * CHUNK_SIZE - padding,
      maxZ: (cz + 1) * CHUNK_SIZE + padding
    };
    return this.getCandidatesInRect(rect, seed, terrainGen);
  }

  getCandidatesInRect(rect, seed, terrainGen) {
    const candidates = [];
    const seen = new Set();
    for (const tile of this._tilesForRect(rect)) {
      const tileCandidates = this._getTileCandidates(tile.tx, tile.tz, seed, terrainGen);
      for (const c of tileCandidates) {
        if (c.x < rect.minX || c.x >= rect.maxX || c.z < rect.minZ || c.z >= rect.maxZ) continue;
        const key = candidateKey(c);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(c);
      }
    }
    return candidates;
  }

  getStats() {
    return { ...this.stats, cachedTiles: this.tileCache.size };
  }
}
```

实现 `_tilesForRect()` 和 `_getTileCandidates()`。tile rect 必须包含 tile 边界外 padding，以避免中心在邻 tile 但影响当前查询的结构漏掉。简单可靠做法：tile cache 存“中心落在 tile 内”的候选，chunk 查询覆盖所有相交 tile 即可。

- [ ] **Step 4: 运行测试和 lint**

Run: `npm run lint`

Expected: 0 errors。

浏览器测试 Expected: cache reuse 测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/workers/structure-index/StructureCandidateIndex.js src/tests/test-structure-candidate-index.js
git commit -m "feat(world): add cached structure candidate index"
```

## Task 4: 将 WorldWorker 大型静态扫描替换为索引查询

**Files:**
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/tests/test-structure-candidate-index.js`

- [ ] **Step 1: 写候选一致性测试**

在测试中实现一个小范围 reference scanner，复制旧逻辑核心，比较 `collectLargeStaticCandidatesInRect()` 与 reference 在固定 rect 的 key 集合一致。

```js
export async function testLargeStaticCollectorMatchesReferenceScanner() {
  const rect = { minX: -16, maxX: 80, minZ: -16, maxZ: 80 };
  const actual = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  const expected = referenceScanLargeStaticCandidates(rect, 12345, terrainGen).map(candidateKey).sort();
  assertEqual(JSON.stringify(actual), JSON.stringify(expected));
}
```

- [ ] **Step 2: 运行测试确认当前一致性测试失败或跳过原因明确**

Expected: 如果 reference scanner 尚未写完，失败；写完后应在替换前先 PASS，作为保护网。

- [ ] **Step 3: 修改 WorldWorker**

在 `src/workers/WorldWorker.js` 顶部导入：

```js
import { StructureCandidateIndex } from './structure-index/StructureCandidateIndex.js';
```

模块级创建：

```js
const structureCandidateIndex = new StructureCandidateIndex();
```

在原 `appendLargeStaticTask` 定义之后，用：

```js
const largeCandidates = structureCandidateIndex.getCandidatesForChunk(cx, cz, seed, terrainGen);
for (const candidate of largeCandidates) {
  appendLargeStaticTask(candidate.type, candidate.x, candidate.y, candidate.z);
}
```

替换原来的大型静态结构邻域扫描循环：

```js
for (let wx = scannedMinX; wx < scannedMaxX; wx++) {
  for (let wz = scannedMinZ; wz < scannedMaxZ; wz++) {
    ...
  }
}
```

保留 static_tree 补扫循环，留到 Task 5。

- [ ] **Step 4: 运行 lint 和浏览器测试**

Run: `npm run lint`

Expected: 0 errors。

浏览器测试 Expected: world/chunk 相关测试 PASS。

- [ ] **Step 5: 手动验证游戏**

Run: `npm run start`

手动访问：`http://localhost:8080`

验证：

- 初始地图能加载。
- 跑到新 chunk 边缘不出现大型结构截断。
- 城市建筑、海岛塔、plain land pyramidIsland、沙漠大型结构仍可出现。

- [ ] **Step 6: 提交**

```bash
git add src/workers/WorldWorker.js src/tests/test-structure-candidate-index.js
git commit -m "perf(world): replace large static scan with candidate index"
```

## Task 5: 将 static_tree 补扫迁移到索引

**Files:**
- Create: `src/workers/structure-index/StaticTreeCandidateCollector.js`
- Modify: `src/workers/structure-index/StructureCandidateIndex.js`
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/tests/test-structure-candidate-index.js`

- [ ] **Step 1: 写 static_tree 候选测试**

```js
import { collectStaticTreeCandidatesInRect } from '../workers/structure-index/StaticTreeCandidateCollector.js';

export async function testStaticTreeCandidatesAreDeterministic() {
  const rect = { minX: -32, maxX: 96, minZ: -32, maxZ: 96 };
  const a = collectStaticTreeCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  const b = collectStaticTreeCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  assertEqual(JSON.stringify(a), JSON.stringify(b));
}
```

- [ ] **Step 2: 实现 StaticTreeCandidateCollector**

迁移旧逻辑：

- 跳过 Pyramid/Island/PlainLand/SnowLand/FrozenMountain。
- 使用 `getActiveBiomeByWorld(wx, wz)`。
- 当前只在 `activeBiomeAtPos === 'AZALEA' && seededRandom(wx, wz, seed + 19) < 0.045` 时返回 static_tree candidate。

- [ ] **Step 3: 扩展 StructureCandidateIndex**

添加：

```js
getStaticTreeCandidatesForChunk(cx, cz, seed, terrainGen) {}
```

或在 `getCandidatesForChunk()` 中返回大型结构 + static_tree，并用 `candidate.source` 区分。

- [ ] **Step 4: 替换 WorldWorker 中 static_tree 补扫循环**

用：

```js
const staticTreeCandidates = structureCandidateIndex.getStaticTreeCandidatesForChunk(cx, cz, seed, terrainGen);
for (const candidate of staticTreeCandidates) {
  appendStaticTreeTask(candidate.x, candidate.y, candidate.z, candidate.treeType || 'azalea');
}
```

替换原：

```js
for (let wx = scannedTreeMinX; wx < scannedTreeMaxX; wx++) {
  for (let wz = scannedTreeMinZ; wz < scannedTreeMaxZ; wz++) {
    ...
  }
}
```

- [ ] **Step 5: 运行验证**

Run: `npm run lint`

Expected: 0 errors。

浏览器测试 Expected: 新 static_tree 测试 PASS。

手动游戏验证：

- AZALEA 区域树不丢失。
- 跨 chunk 树不切割。

- [ ] **Step 6: 提交**

```bash
git add src/workers/structure-index/StaticTreeCandidateCollector.js src/workers/structure-index/StructureCandidateIndex.js src/workers/WorldWorker.js src/tests/test-structure-candidate-index.js
git commit -m "perf(world): cache static tree structure candidates"
```

## Task 6: 增加性能观测点，确认重复扫描下降

**Files:**
- Modify: `src/workers/structure-index/StructureCandidateIndex.js`
- Modify: `src/workers/WorldWorker.js`

- [ ] **Step 1: 增加 debug stats，不默认刷屏**

在 `WorldWorker.js` 中加入可开关统计：

```js
const DEBUG_STRUCTURE_INDEX = false;
```

每个 worker 任务结束前，如果开启，输出：

```js
if (DEBUG_STRUCTURE_INDEX) {
  console.log('[StructureIndex]', {
    cx,
    cz,
    stats: structureCandidateIndex.getStats()
  });
}
```

- [ ] **Step 2: 添加 worker 内轻量 performance marks**

不要默认依赖 console。可以在回包中仅 debug 模式附带：

```js
debugStats: DEBUG_STRUCTURE_INDEX ? structureCandidateIndex.getStats() : undefined
```

- [ ] **Step 3: 验证 trace**

手动抓一份 Chrome performance trace，比较：

- WorldWorker `HandlePostMessage` p50/p90 是否下降。
- 单任务是否仍出现 6s 级别长任务。
- 主线程回包长任务是否未恶化。

- [ ] **Step 4: 提交**

```bash
git add src/workers/structure-index/StructureCandidateIndex.js src/workers/WorldWorker.js
git commit -m "chore(world): add structure index debug stats"
```

## Task 7: 清理旧扫描代码与文档

**Files:**
- Modify: `src/workers/WorldWorker.js`
- Modify: `docs/superpowers/plans/2026-04-20-optimize-structure-scan.md` 或新增项目文档

- [ ] **Step 1: 删除未使用的扫描变量**

删除不再使用的：

- `scannedMinX`
- `scannedMaxX`
- `scannedMinZ`
- `scannedMaxZ`
- `scannedTreeMinX`
- `scannedTreeMaxX`
- `scannedTreeMinZ`
- `scannedTreeMaxZ`

保留 padding 常量仅在 `StructureCandidateIndex` 中使用。

- [ ] **Step 2: 确认 lint 无新增 warning**

Run: `npm run lint`

Expected: 0 errors；`WorldWorker.js` 中不出现新增 unused warning。

- [ ] **Step 3: 写简短维护说明**

在 `src/workers/structure-index/StructureCandidateIndex.js` 顶部注释说明：

- 候选索引只负责“发现结构中心”。
- 方块生成仍由 `WorldWorker.js` 的现有 generate 函数执行。
- 新增大型结构时必须更新 collector 的候选发现逻辑。

- [ ] **Step 4: 提交**

```bash
git add src/workers/WorldWorker.js src/workers/structure-index/StructureCandidateIndex.js
git commit -m "chore(world): document structure candidate index"
```

## 验收标准

- `npm run lint`：0 errors。
- 浏览器测试页：新增 `test-structure-candidate-index.js` 测试通过。
- 手动跑图：新 chunk 生成正常，大型结构跨 chunk 不丢块、不切割。
- 新 trace 中 `WorldWorker HandlePostMessage` 相比原 trace 显著下降：
  - p50 目标：低于 120ms。
  - p90 目标：低于 250ms。
  - 不再稳定出现 6s 级别首批任务，除非首次结构 JSON fetch 或浏览器冷启动。
- `StructureCandidateIndex.getStats()` 显示相邻 chunk 查询有 cache hits，且 generatedTiles 增速明显低于 chunk 生成数乘以旧扫描范围。

## 风险与回滚

- 风险 1：候选索引漏掉结构中心，导致跨 chunk 结构切割。
  - 缓解：Task 4 的 reference scanner 一致性测试必须先通过。

- 风险 2：City placementMap 是全局 city layout，不适合逐 tile 扫描。
  - 缓解：City 候选从 `getCityLayout()` 的 map 直接按 rect 过滤，不逐格扫描。

- 风险 3：缓存无限增长。
  - 缓解：第一版可接受 worker 生命周期内缓存；若 trace 显示长时间跑图内存上升，再加 LRU。不要提前复杂化。

- 风险 4：并行 worker 各自有缓存，首轮仍会重复生成 tile。
  - 缓解：这是可接受的第一阶段。跨 worker 共享缓存需要 SharedArrayBuffer 或主线程索引，复杂度更高，暂不做。

## 不在本计划范围内

- 不调整 `scatteredBlocks` 输出格式。
- 不实现 chunk 生成任务取消与优先级。
- 不改变结构 JSON 的实际方块生成逻辑。
- 不改变玩家修改、持久化、consolidation 的语义。
