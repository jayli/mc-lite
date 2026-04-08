# AO 系统重构实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 AO 阴影计算从主线程迁移到专用 AOWorker，使用脏集机制最小化计算范围，防抖保证时序正确。

**Architecture:** 每个 Chunk 维护 `dirtyAOPositions` 集合记录需要重新计算 AO 的方块坐标。方块操作后标记脏位置，consolidation 完成后 100ms 防抖触发 AO 刷新：收集脏集 + blockData 快照 + 邻居 chunk 快照发送给 AOWorker，Worker 返回结果后直接覆写 InstancedMesh attribute。

**Tech Stack:** JavaScript (ES6+), Three.js InstancedMesh BufferAttribute, Web Worker, AOUtils

**Design Doc:** `docs/plans/2026-04-06-ao-system-redesign.md`

---

### Task 1: 创建 AOWorker

**Files:**
- Create: `src/workers/AOWorker.js`

**Step 1: 创建 AOWorker 文件**

AOWorker 接收脏位置 + blockData 快照，计算 AO 值，返回结果。

```javascript
// src/workers/AOWorker.js
// 专用 AO（环境光遮蔽）计算 Worker
// 接收脏位置和方块数据快照，异步计算 AO 值并返回结果

import { calculateAOForBlock } from '../utils/AOUtils.js';
import { getBlockProperties, isFullCubeOccluder } from '../constants/BlockData.js';

/**
 * 从合并的 blockData 中检查指定坐标是否为遮挡体
 * @param {Object} mergedData - 合并后的方块数据
 * @returns {Function} isOccluding(x, y, z) => boolean
 */
function createOcclusionChecker(mergedData) {
  return function isOccluding(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const entry = mergedData[key];
    if (!entry) return false;
    const type = typeof entry === 'string' ? entry : entry.type;
    if (!type) return false;
    const props = getBlockProperties(type);
    return isFullCubeOccluder(props);
  };
}

/**
 * 合并当前 chunk 和邻居 chunk 的 blockData
 * @param {Object} blockData - 当前 chunk 的方块数据
 * @param {Array} neighborChunks - 邻居 chunk 快照
 * @returns {Object} 合并后的方块数据
 */
function mergeBlockData(blockData, neighborChunks = []) {
  const merged = { ...blockData };
  for (const nc of neighborChunks) {
    if (!nc.blockData) continue;
    for (const [key, val] of Object.entries(nc.blockData)) {
      if (!(key in merged)) {
        merged[key] = val;
      }
    }
  }
  return merged;
}

/**
 * 判断方块是否适用于 AO 计算
 * @param {string} type - 方块类型
 * @returns {boolean}
 */
function isAOApplicable(type) {
  if (!type) return false;
  const props = getBlockProperties(type);
  return props.isSolid && !props.isTransparent;
}

self.onmessage = function(e) {
  const { requestId, chunkKey, positions, blockData, neighborChunks } = e.data;

  if (!positions || positions.length === 0) {
    self.postMessage({ requestId, chunkKey, results: [] });
    return;
  }

  // 合并 blockData 为统一查找表
  const mergedData = mergeBlockData(blockData, neighborChunks);
  const isOccluding = createOcclusionChecker(mergedData);

  const results = [];

  for (const pos of positions) {
    const { x, y, z } = pos;
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const entry = blockData[key];

    if (!entry) continue;

    const type = typeof entry === 'string' ? entry : entry.type;
    if (!type || !isAOApplicable(type)) continue;

    const { aoLow, aoHigh } = calculateAOForBlock(
      Math.floor(x), Math.floor(y), Math.floor(z), isOccluding
    );
    results.push({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), aoLow, aoHigh });
  }

  self.postMessage({ requestId, chunkKey, results });
};
```

**Step 2: 验证 Worker 文件可被导入**

Run: `node -e "import('./src/workers/AOWorker.js').catch(e => console.log('Expected: worker context missing'))"`
Expected: Worker 文件语法正确（可能会因为 self 上下文缺失而报错，这是正常的）

**Step 3: Commit**

```bash
git add src/workers/AOWorker.js
git commit -m "feat(ao): 创建专用 AOWorker 用于异步 AO 计算"
```

---

### Task 2: 在 ChunkConsolidation.js 中创建 AOWorker 实例和消息处理

**Files:**
- Modify: `src/world/ChunkConsolidation.js:21-23` (替换旧的 aoWorker/aoCallbacks)
- Modify: `src/world/ChunkConsolidation.js:275-286` (更新消息处理)

**Step 1: 替换 aoWorker 创建和消息处理**

在 ChunkConsolidation.js 中，将现有的 aoWorker（基于 FaceCullingWorker）替换为新的 AOWorker。

找到旧的 aoWorker 创建（约第 21-23 行）：
```javascript
// AO Worker 实例（基于 FaceCullingWorker，专用于动态交互 AO 计算）
export const aoWorker = new Worker(new URL('../workers/FaceCullingWorker.js', import.meta.url), { type: 'module' });
export const aoCallbacks = new Map(); // AO Worker 回调映射
```

替换为：
```javascript
// 专用 AO Worker — 只做 AO 计算，不复用 FaceCullingWorker
export const aoWorker = new Worker(new URL('../workers/AOWorker.js', import.meta.url), { type: 'module' });
export const aoCallbacks = new Map(); // AO Worker 回调映射
```

找到旧的消息处理（约第 275-286 行）：
```javascript
  // 注册 AO Worker 消息处理器
  aoWorker.onmessage = (e) => {
    const { id, data } = e.data;
    if (id && aoCallbacks.has(id)) {
      aoCallbacks.get(id)(data);
      aoCallbacks.delete(id);
    }
  };

  aoWorker.onerror = (e) => {
    console.error('AOWorker Error:', e.message, 'at', e.filename, ':', e.lineno);
  };
```

替换为：
```javascript
  // 注册 AO Worker 消息处理器
  aoWorker.onmessage = (e) => {
    const { requestId, chunkKey, results } = e.data;
    if (requestId && aoCallbacks.has(requestId)) {
      aoCallbacks.get(requestId)({ chunkKey, results });
      aoCallbacks.delete(requestId);
    }
  };

  aoWorker.onerror = (e) => {
    console.error('AOWorker Error:', e.message, 'at', e.filename, ':', e.lineno);
  };
```

**Step 2: 在 consolidation 完成回调中触发 AO 刷新**

在 `_applyConsolidateResult` 方法中（约第 398 行），将：
```javascript
    this.world?._enqueueChunkAndNeighborsForAORefresh?.(`${this.cx},${this.cz}`, {
      includeNeighbors: true,
      delayMs: 80,
      reason: 'consolidation'
    });
```

替换为：
```javascript
    // Consolidation 完成后调度 AO 刷新（防抖 100ms）
    this._scheduleAORefresh();
```

**Step 3: 运行 lint 检查**

Run: `npm run lint`
Expected: 无新增错误

**Step 4: Commit**

```bash
git add src/world/ChunkConsolidation.js
git commit -m "refactor(ao): 替换 aoWorker 为专用 AOWorker，consolidation 后触发 AO 刷新"
```

---

### Task 3: 在 Chunk.js 中添加脏集管理和 AO 调度方法

**Files:**
- Modify: `src/world/Chunk.js` (构造函数 + 新方法)

**Step 1: 在构造函数中添加 AO 相关状态**

在 Chunk 构造函数的 `// 批量 Face Culling 更新系统` 注释块之后添加：

```javascript
    // AO 脏集管理系统
    this.dirtyAOPositions = new Set();  // 需要重新计算 AO 的方块坐标集合
    this.aoRefreshTimer = null;         // AO 刷新防抖定时器
```

**Step 2: 添加 `_markDirtyAO` 方法**

在 `_revealNeighbors` 方法之后添加以下方法：

```javascript
  /**
   * 标记受方块操作影响的邻居为需要 AO 重算
   * @param {number} x - 方块世界坐标 X
   * @param {number} y - 方块世界坐标 Y
   * @param {number} z - 方块世界坐标 Z
   * @param {boolean} includeSelf - 是否包含自身（放置时 true，删除时 false）
   */
  _markDirtyAO(x, y, z, includeSelf = false) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);

    // 6 个正交方向的邻居
    const offsets = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const [dx, dy, dz] of offsets) {
      this._addDirtyAOPosition(fx + dx, fy + dy, fz + dz);
    }

    // 放置方块时，自身也需要 AO
    if (includeSelf) {
      this._addDirtyAOPosition(fx, fy, fz);
    }

    // 调度 AO 刷新
    this._scheduleAORefresh();
  }

  /**
   * 将单个坐标添加到脏集（自动处理跨 chunk）
   * @private
   */
  _addDirtyAOPosition(x, y, z) {
    const key = `${x},${y},${z}`;
    const ncx = Math.floor(x / CHUNK_SIZE);
    const ncz = Math.floor(z / CHUNK_SIZE);

    if (ncx === this.cx && ncz === this.cz) {
      // 当前 chunk 内：只标记实心不透明方块
      const entry = this.blockData[key];
      if (entry) {
        const type = typeof entry === 'string' ? entry : entry.type;
        if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
          this.dirtyAOPositions.add(key);
        }
      }
    } else {
      // 跨 chunk：标记邻居 chunk 的脏集
      const nChunk = this.world?.chunks?.get(`${ncx},${ncz}`);
      if (nChunk && nChunk.isReady) {
        const entry = nChunk.blockData[key];
        if (entry) {
          const type = typeof entry === 'string' ? entry : entry.type;
          if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
            nChunk.dirtyAOPositions.add(key);
            nChunk._scheduleAORefresh();
          }
        }
      }
    }
  }

  /**
   * 调度 AO 刷新（防抖 100ms）
   * 连续操作时定时器被重置，只有最后一次操作后 100ms 才执行
   */
  _scheduleAORefresh() {
    if (this.aoRefreshTimer) {
      clearTimeout(this.aoRefreshTimer);
    }
    this.aoRefreshTimer = setTimeout(() => {
      this.aoRefreshTimer = null;
      this._executeAORefresh();
    }, 100);
  }

  /**
   * 执行 AO 刷新：收集脏集发送给 AOWorker
   */
  _executeAORefresh() {
    if (this.dirtyAOPositions.size === 0) return;
    if (!this.isReady || this.isConsolidating) {
      // 等待 consolidation 完成后重试
      this._scheduleAORefresh();
      return;
    }

    // 收集脏位置
    const positions = [...this.dirtyAOPositions].map(key => {
      const [x, y, z] = key.split(',').map(Number);
      return { x, y, z };
    });

    // 收集邻居 chunk 快照（跨 chunk AO 计算需要）
    const neighborChunks = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dz] of dirs) {
      const nc = this.world?.chunks?.get(`${this.cx + dx},${this.cz + dz}`);
      if (nc && nc.isReady) {
        neighborChunks.push({
          blockData: nc.blockData,
          cx: nc.cx,
          cz: nc.cz
        });
      }
    }

    // 生成请求 ID
    const requestId = `${this.cx},${this.cz}-${Date.now()}`;

    // 动态导入 Worker 和回调
    import('./ChunkConsolidation.js').then(({ aoWorker, aoCallbacks }) => {
      // 注册回调
      aoCallbacks.set(requestId, (data) => {
        this._applyAOResults(data.results);
      });

      // 发送给 Worker
      aoWorker.postMessage({
        requestId,
        chunkKey: `${this.cx},${this.cz}`,
        positions,
        blockData: { ...this.blockData },
        neighborChunks
      });
    });
  }

  /**
   * 应用 Worker 返回的 AO 结果到 InstancedMesh
   * 直接覆写 attribute 值，无删除-重建中间态
   * @param {Array} results - [{x, y, z, aoLow, aoHigh}]
   */
  _applyAOResults(results) {
    if (!results || results.length === 0) return;

    // 按方块类型分组，减少 InstancedMesh 查找
    const resultsByType = new Map();
    for (const r of results) {
      const key = `${r.x},${r.y},${r.z}`;
      const entry = this.blockData[key];
      if (!entry) continue;
      const type = typeof entry === 'string' ? entry : entry.type;
      if (!type) continue;
      if (!resultsByType.has(type)) resultsByType.set(type, []);
      resultsByType.get(type).push({ ...r, key });
    }

    // 按类型批量更新 InstancedMesh
    for (const [type, typeResults] of resultsByType) {
      const typeMap = this.instanceIndexMap[type];
      if (!typeMap) continue;

      // 查找对应类型的 InstancedMesh
      const mesh = this.group.children.find(
        c => c.isInstancedMesh && c.userData?.type === type
      );
      if (!mesh?.geometry) continue;

      const aoLowAttr = mesh.geometry.getAttribute('aAoLow');
      const aoHighAttr = mesh.geometry.getAttribute('aAoHigh');
      if (!aoLowAttr || !aoHighAttr) continue;

      for (const r of typeResults) {
        const idx = typeMap.get(r.key);
        if (idx === undefined || idx < 0 || idx >= aoLowAttr.array.length) continue;

        // 直接覆写，无中间态
        aoLowAttr.array[idx] = r.aoLow;
        aoHighAttr.array[idx] = r.aoHigh;
      }

      aoLowAttr.needsUpdate = true;
      aoHighAttr.needsUpdate = true;
    }

    // 清除已处理的脏标记
    this.dirtyAOPositions.clear();
  }
```

**Step 3: 在方块操作中调用 `_markDirtyAO`**

在 `addBlockDynamic` 方法中（约第 376 行 `this.visibleKeys.add(key);` 之后）添加：
```javascript
    // 标记 AO 脏位置
    this._markDirtyAO(x, y, z, true);
```

在 `_revealNeighbors` 方法中（约第 481 行 `_refreshBlockRenderLightweight` 调用之后）添加：
```javascript
    // 标记 AO 脏位置（删除方块后邻居需要刷新 AO）
    this._markDirtyAO(x, y, z, false);
```

在 `removeBlocksBatch` 方法的邻居更新循环中（约第 1519 行 `this._scheduleBatchFaceCullingUpdate();` 之后）添加：
```javascript
      // 标记 AO 脏位置
      this._markDirtyAO(nx, ny, nz, false);
```

**Step 4: 运行 lint 检查**

Run: `npm run lint`
Expected: 无新增错误（可能有 unused import 警告，后续清理）

**Step 5: Commit**

```bash
git add src/world/Chunk.js
git commit -m "feat(ao): 添加脏集管理、AO 调度和结果应用方法到 Chunk"
```

---

### Task 4: 简化 World.js — 移除旧 AO 队列系统

**Files:**
- Modify: `src/world/World.js`

**Step 1: 移除旧 AO 相关常量**

删除以下常量（约第 23-29 行）：
```javascript
const RUNTIME_FINALIZE_AO_DELAY_MS = 900;
const CONSOLIDATION_AO_DELAY_MS = 120;
const RUNTIME_AO_BUDGET_MS = 0.5;
const RUNTIME_AO_MAX_CHUNKS = 1;
const RUNTIME_AO_IDLE_GRACE_MS = 1500;
```

**Step 2: 移除旧 AO 队列状态初始化**

在构造函数中删除（约第 105-106 行）：
```javascript
    this._pendingAORefreshChunkKeys = new Set();
    this._pendingAORefreshMeta = new Map();
```

**Step 3: 移除旧 AO 入队方法调用**

在 `onChunkConsolidationComplete` 方法中（约第 222 行），删除：
```javascript
    this._enqueueChunkAndNeighborsForAORefresh(`${chunk.cx},${chunk.cz}`, {
      includeNeighbors: true,
      delayMs: CONSOLIDATION_AO_DELAY_MS,
      reason: 'consolidation'
    });
```

在 `onChunkFinalized` 方法中（约第 237 行），删除：
```javascript
      this._enqueueChunkAndNeighborsForAORefresh(key, {
        includeNeighbors: false,
        delayMs: RUNTIME_FINALIZE_AO_DELAY_MS,
        reason: 'runtime-finalize'
      });
```

**Step 4: 移除旧 AO 队列处理方法**

删除以下方法：
- `_enqueueChunkAndNeighborsForAORefresh`（约第 292-315 行）
- `_processPendingAORefreshQueue`（约第 317-354 行，但注意 `_processPendingAORefreshQueue` 已改名为 `_processPendingAORefreshQueue`，请按实际代码删除）

**Step 5: 移除 update 方法中的 AO 队列调用**

在 `update` 方法中（约第 455-457 行），删除：
```javascript
    this._processPendingAORefreshQueue(this.bootstrapState.phase === 'runtime-streaming'
      ? { maxChunks: RUNTIME_AO_MAX_CHUNKS, budgetMs: RUNTIME_AO_BUDGET_MS }
      : { maxChunks: 0, budgetMs: 0 });
```

**Step 6: 运行 lint 检查**

Run: `npm run lint`
Expected: 无新增错误

**Step 7: Commit**

```bash
git add src/world/World.js
git commit -m "refactor(ao): 移除 World.js 中的旧 AO 队列系统"
```

---

### Task 5: 清理 Chunk.js 中旧的 AO 方法

**Files:**
- Modify: `src/world/Chunk.js`

**Step 1: 删除 `rebuildInstancedAOFromWorld` 方法**

删除整个 `rebuildInstancedAOFromWorld` 方法（约第 575-643 行）。此方法被新的 `_applyAOResults` 替代。

**Step 2: 删除 `_updateInstancedBlockAO` 方法**

删除整个 `_updateInstancedBlockAO` 方法（约第 411-456 行）。此方法在主线程同步计算 AO，被 AOWorker 替代。

**Step 3: 清理 AOUtils 导入**

在 Chunk.js 顶部，将：
```javascript
import { createOcclusionChecker, computeBlockAOPacked, packAOData } from '../utils/AOUtils.js';
```

检查 `createOcclusionChecker` 是否还有其他使用。如果 `_createDynamicBlockMesh` 中还有使用（applyAO 路径），保留。如果 `computeBlockAOPacked` 还有使用，保留。

最终导入可能变为：
```javascript
import { createOcclusionChecker, computeBlockAOPacked, packAOData } from '../utils/AOUtils.js';
```
（保持不变，因为 `_createDynamicBlockMesh` 中仍需要）

**Step 4: 运行 lint 检查**

Run: `npm run lint`
Expected: 无新增错误

**Step 5: Commit**

```bash
git add src/world/Chunk.js
git commit -m "refactor(ao): 删除旧的 rebuildInstancedAOFromWorld 和 _updateInstancedBlockAO 方法"
```

---

### Task 6: 清理 FaceCullingWorker.js 中的 AO 代码

**Files:**
- Modify: `src/workers/FaceCullingWorker.js`

**Step 1: 移除 AO 相关导入**

删除或注释掉（约第 5 行）：
```javascript
import { buildAODataForBlocks, computeIncrementalAO, calculateAOForBlock, isAOApplicable } from '../utils/AOUtils.js';
```

如果 FaceCullingWorker 中还有非 AO 用途使用这些函数，则保留需要的部分。

**Step 2: 移除 AO 相关函数**

删除以下函数：
- `computeBatchAO`（约第 223-234 行）
- `computeIncrementalAOWorker`（约第 251-253 行）
- `computePositionsAO`（约第 262-287 行）

**Step 3: 移除 AO 相关消息处理 case**

在消息处理 switch 中删除（约第 316-338 行）：
```javascript
      case 'COMPUTE_AO_BATCH':
        result = computeBatchAO(
      case 'COMPUTE_AO_INCREMENTAL':
        result = computeIncrementalAOWorker(
      case 'COMPUTE_POSITIONS_AO':
        result = computePositionsAO(
```

**Step 4: 运行 lint 检查**

Run: `npm run lint`
Expected: 无新增错误

**Step 5: Commit**

```bash
git add src/workers/FaceCullingWorker.js
git commit -m "refactor(ao): 移除 FaceCullingWorker 中的 AO 计算代码"
```

---

### Task 7: 清理 AOSystem.js

**Files:**
- Modify: `src/core/AOSystem.js` (清空或标记为废弃)

**Step 1: 检查 AOSystem 是否被其他文件引用**

Run: `grep -r "AOSystem" src/ --include="*.js" | grep -v "AOSystem.js"`
Expected: 无引用（之前调研已确认）

如果有引用，先将引用改为使用新的 AOWorker 机制。

**Step 2: 将 AOSystem.js 标记为废弃**

将文件内容替换为：
```javascript
// src/core/AOSystem.js
// 已废弃：AO 计算已迁移到专用 AOWorker (src/workers/AOWorker.js)
// 脏集管理由 Chunk.dirtyAOPositions 处理
// 保留文件以避免潜在的 import 错误，将在后续版本完全移除
export class AOSystem {
  constructor() {
    console.warn('AOSystem is deprecated. AO computation is now handled by AOWorker.');
  }
}
```

**Step 3: Commit**

```bash
git add src/core/AOSystem.js
git commit -m "refactor(ao): 标记 AOSystem 为废弃，功能已迁移到 AOWorker"
```

---

### Task 8: 清理 AOUtils.js

**Files:**
- Modify: `src/utils/AOUtils.js`

**Step 1: 保留核心计算函数**

确认以下函数被 AOWorker.js 使用，保留：
- `calculateAOForBlock` (AOWorker 直接导入)
- `getAOValue` (被 calculateAOForBlock 内部使用)
- `getAOForFace` (被 calculateAOForBlock 内部使用)
- `packAOData` (被 Chunk._createDynamicBlockMesh 使用)
- `isAOApplicable` (被多处使用，但 AOWorker 有自己的副本)

**Step 2: 移除不再需要的导出函数**

检查以下函数是否还有外部引用：
- `createOcclusionChecker` — 被 Chunk.js 的 `_createDynamicBlockMesh` 使用 → 保留
- `computeBlockAOPacked` — 被 Chunk.js 的 `_updateInstancedBlockAO`（已删除）和 `_createDynamicBlockMesh` 使用 → 检查
- `buildAODataForBlocks` — 被 FaceCullingWorker（已清理）使用 → 可移除导出
- `computeIncrementalAO` — 被 AOSystem（已废弃）使用 → 可移除导出
- `createBlockDataOcclusionChecker` — 被 AOSystem 使用 → 可移除导出

保守策略：保留所有函数但添加注释标记不再使用的函数。

**Step 3: Commit**

```bash
git add src/utils/AOUtils.js
git commit -m "refactor(ao): 标记 AOUtils 中不再使用的函数"
```

---

### Task 9: 运行完整 lint 和功能测试

**Step 1: 运行 ESLint**

Run: `npm run lint`
Expected: 0 errors, 可能有少量 warnings

修复所有 errors。

**Step 2: 启动开发服务器**

Run: `npm run start`

**Step 3: 浏览器手动测试**

访问 http://localhost:8080，测试以下场景：

1. **放置方块**: 在已有方块旁边放置方块，确认 AO 阴影正确更新
2. **删除方块**: 删除方块，确认暴露面无黑闪，AO 在 100ms 后正确着色
3. **快速连续操作**: 快速放置/删除多个方块，确认无闪烁、无遗漏
4. **Chunk 边界**: 在 Chunk 边界操作方块，确认跨 Chunk AO 正确
5. **Mag7 工具**: 使用 Mag7 快速消除方块，确认 AO 能跟上
6. **TNT 爆炸**: 引爆 TNT，确认爆炸区域 AO 正确刷新

**Step 4: 修复测试中发现的问题**

根据测试结果修复问题，每次修复后重新测试。

**Step 5: Final Commit**

```bash
git add -A
git commit -m "fix(ao): 修复集成测试中发现的 AO 问题"
```

---

## 关键注意事项

1. **不要破坏及时补面逻辑**：`_revealNeighbors` 和 `_refreshBlockRenderLightweight` 不变
2. **不要引入浮点坐标**：所有坐标使用 `Math.floor()` 确保整数
3. **跨 chunk 标记**：`_addDirtyAOPosition` 自动处理跨 chunk 的脏标记
4. **防抖保证**：连续操作时只有最后一次触发 AO 计算
5. **Shader 不变**：aAoLow/aAoHigh 的解包和使用方式不变
6. **Ownership 不变**：方块只属于一个 chunk，不会双重渲染
