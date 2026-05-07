# AO Refresh Hot Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 chunk 稳定阶段的 AO 刷新从主线程全量标脏改为基于 face culling 后可见实例和边界影响带的异步 Worker 刷新，降低 `non-deferred-finalize` / deferred finalize 峰值耗时。

**Architecture:** 主线程只维护 AO dirty 候选和 attribute 应用，真实 AO 计算继续由 `AOWorker` 执行。`Chunk` 侧 full refresh 改为遍历 `instanceIndexMap` / `visibleKeys`，边界刷新改为坐标生成；`AOWorker` 侧用坐标直接查 `chunkCache`，避免每次请求合并大对象。

**Tech Stack:** JavaScript ES Modules, Three.js InstancedMesh, Web Workers, browser test runner

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `src/world/Chunk.js` | 修改 | AO dirty 候选收集、边界标记、AO 刷新计时、回包应用计时 |
| `src/world/World.js` | 小改或不改 | 保持 `onChunkAOSourceStable()` 语义，必要时只传递原因字段 |
| `src/workers/AOWorker.js` | 修改 | AO 遮挡查询直接按世界坐标定位 chunk cache |
| `src/utils/ChunkPerfMonitor.js` | 不改或只使用 | 复用 `recordChunkPerf()` |
| `src/tests/index.html` 相关测试 | 视现有覆盖补充 | 浏览器内测试验证 chunk / AO 行为 |

> 仓库指令要求不能自动提交代码。下面保留检查点，但实现者必须等用户明确要求后才能执行 `git commit`。

---

### Task 1: 增加 AO 热路径计时

**Files:**
- Modify: `src/world/Chunk.js`

- [ ] **Step 1: 引入性能记录依赖**

检查 `Chunk.js` 是否已经导入 `recordChunkPerf`。如果没有，在现有 imports 中添加：

```js
import { recordChunkPerf } from '../utils/ChunkPerfMonitor.js';
```

- [ ] **Step 2: 在 `_refreshAOFromStableSource()` 中记录 full refresh 和 fullSync 成本**

将结构调整为：

```js
_refreshAOFromStableSource(options = {}) {
  const startedAt = performance.now();
  let markMs = 0;
  let fullSyncMs = 0;

  if (options.fullRefresh) {
    const markStartedAt = performance.now();
    this._markAllBlocksDirtyAO();
    markMs = performance.now() - markStartedAt;
  }

  const syncStartedAt = performance.now();
  aoBridge.fullSync(`${this.cx},${this.cz}`, this.blockData);
  fullSyncMs = performance.now() - syncStartedAt;

  if (this.aoRefreshTimer) {
    clearTimeout(this.aoRefreshTimer);
    this.aoRefreshTimer = null;
  }

  this._executeAORefresh();

  recordChunkPerf('chunk.ao-refresh.source-stable', performance.now() - startedAt, {
    chunkKey: `${this.cx},${this.cz}`,
    fullRefresh: options.fullRefresh === true,
    dirtyAO: this.dirtyAOPositions?.size || 0,
    markMs,
    fullSyncMs,
    reason: options.reason || 'unknown'
  });
}
```

- [ ] **Step 3: 在 `_executeAORefresh()` 中记录 positions 收集成本**

围绕 `new Set(this.dirtyAOPositions)` 和 `map(code => Chunk.decodeCoord(code))` 添加计时：

```js
const collectStartedAt = performance.now();
const sentCodes = new Set(this.dirtyAOPositions);
const positions = [...sentCodes].map(code => Chunk.decodeCoord(code));
const collectPositionsMs = performance.now() - collectStartedAt;
```

在 postMessage 前记录：

```js
recordChunkPerf('chunk.ao-refresh.request', collectPositionsMs, {
  chunkKey: `${this.cx},${this.cz}`,
  positions: positions.length,
  collectPositionsMs
});
```

- [ ] **Step 4: 在 `_applyAOResults()` 中记录应用成本**

函数开头：

```js
const applyStartedAt = performance.now();
```

函数结束前：

```js
recordChunkPerf('chunk.ao-refresh.apply-results', performance.now() - applyStartedAt, {
  chunkKey: `${this.cx},${this.cz}`,
  results: results?.length || 0,
  sentKeys: sentKeys?.size || 0
});
```

- [ ] **Step 5: 运行 lint**

Run:

```bash
npm run lint
```

Expected: 无新增 lint 错误。

---

### Task 2: 修复 deferred finalize 重复 AO 刷新

**Files:**
- Modify: `src/world/Chunk.js`

- [ ] **Step 1: 在 `runDeferredFinalizePhase()` 中加入本轮 AO 触发标记**

在函数开始、早返回之后添加：

```js
let aoRefreshTriggeredThisPass = false;
```

- [ ] **Step 2: `_needsDeferredAOStabilization` 分支传递 reason 并设置标记**

将 AO 分支改为：

```js
if (this._needsDeferredAOStabilization) {
  this.world?.onChunkAOSourceStable?.(this, {
    fullRefresh: true,
    markNeighborBoundaries: true,
    reason: 'deferred-finalize-ao-stable'
  });
  aoRefreshTriggeredThisPass = true;
  this._needsDeferredAOStabilization = false;
}
```

- [ ] **Step 3: 避免同一轮 `deferred-finalize-done` 再次全量刷新**

将最终分支改为：

```js
if (!this.hasDeferredFinalizeWork && !aoRefreshTriggeredThisPass) {
  this.world?.onChunkAOSourceStable?.(this, {
    fullRefresh: true,
    markNeighborBoundaries: true,
    reason: 'deferred-finalize-done'
  });
}
```

- [ ] **Step 4: 运行 lint**

Run:

```bash
npm run lint
```

Expected: 无新增 lint 错误。

---

### Task 3: fullRefresh 只标记可见 AO 实例

**Files:**
- Modify: `src/world/Chunk.js`

- [ ] **Step 1: 新增 AO 类型判定 helper**

在 AO 相关方法附近新增：

```js
_isAOApplicableEntry(entry) {
  if (!entry) return false;
  const type = typeof entry === 'string' ? entry : entry.type;
  if (!type) return false;
  const props = getBlockProps(type);
  return props.isSolid && !props.isTransparent;
}
```

- [ ] **Step 2: 新增可见实例坐标收集 helper**

```js
_collectVisibleAOInstanceCodes() {
  const codes = new Set();

  const collectFromTypeMap = (typeMap) => {
    if (!typeMap) return;
    const entries = typeMap instanceof Map
      ? typeMap.keys()
      : Object.keys(typeMap);
    for (const codeLike of entries) {
      codes.add(Number(codeLike));
    }
  };

  if (this.instanceIndexMap instanceof Map) {
    for (const typeMap of this.instanceIndexMap.values()) {
      collectFromTypeMap(typeMap);
    }
  } else if (this.instanceIndexMap && typeof this.instanceIndexMap === 'object') {
    for (const typeMap of Object.values(this.instanceIndexMap)) {
      if (!typeMap) continue;
      collectFromTypeMap(typeMap);
    }
  }

  if (codes.size === 0 && this.visibleKeys?.size > 0) {
    for (const code of this.visibleKeys) {
      codes.add(Number(code));
    }
  }

  return codes;
}
```

- [ ] **Step 3: 将 `_markAllBlocksDirtyAO()` 改为优先遍历可见实例**

目标实现：

```js
_markAllBlocksDirtyAO() {
  const visibleCodes = this._collectVisibleAOInstanceCodes();

  if (visibleCodes.size > 0) {
    for (const code of visibleCodes) {
      const entry = this.blockData.get(code);
      if (this._isAOApplicableEntry(entry)) {
        this.dirtyAOPositions.add(code);
      }
    }
    return;
  }

  // 兼容回退：没有可见索引时保留旧行为，优先保证正确性。
  for (const [code, entry] of this.blockData) {
    if (this._isAOApplicableEntry(entry)) {
      this.dirtyAOPositions.add(code);
    }
  }
}
```

- [ ] **Step 4: 运行 lint**

Run:

```bash
npm run lint
```

Expected: 无新增 lint 错误。

---

### Task 4: 边界 AO 标记改为边界带生成

**Files:**
- Modify: `src/world/Chunk.js`

- [ ] **Step 1: 新增边界候选加入 helper**

```js
_addDirtyAOIfRenderable(code) {
  const entry = this.blockData.get(code);
  if (!this._isAOApplicableEntry(entry)) return false;

  if (this.visibleKeys?.size > 0 && !this.visibleKeys.has(code)) {
    return false;
  }

  this.dirtyAOPositions.add(code);
  return true;
}
```

如果发现 `visibleKeys` 在某些路径不完整，则放宽为：优先查 `instanceIndexMap`，只有两者都存在且都不包含时才过滤。

- [ ] **Step 2: 替换 `_markBoundaryDirtyAO()` 的全数组扫描**

将 `blockDataArray` 遍历改为根据方向生成边界带：

```js
_markBoundaryDirtyAO(neighborCx, neighborCz) {
  const startedAt = performance.now();
  const dx = neighborCx - this.cx;
  const dz = neighborCz - this.cz;

  const minX = this.cx * CHUNK_SIZE;
  const maxX = minX + CHUNK_SIZE - 1;
  const minZ = this.cz * CHUNK_SIZE;
  const maxZ = minZ + CHUNK_SIZE - 1;
  const minY = this.worldY;
  const maxY = this.worldY + CHUNK_SIZE - 1;

  const xValues = [];
  const zValues = [];

  if (dx === 1) xValues.push(maxX, maxX - 1);
  else if (dx === -1) xValues.push(minX, minX + 1);

  if (dz === 1) zValues.push(maxZ, maxZ - 1);
  else if (dz === -1) zValues.push(minZ, minZ + 1);

  let marked = 0;

  if (xValues.length > 0) {
    for (const x of xValues) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this._addDirtyAOIfRenderable(Chunk.encodeCoord(x, y, z))) marked++;
        }
      }
    }
  }

  if (zValues.length > 0) {
    for (const z of zValues) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (this._addDirtyAOIfRenderable(Chunk.encodeCoord(x, y, z))) marked++;
        }
      }
    }
  }

  recordChunkPerf('chunk.ao-refresh.mark-boundary', performance.now() - startedAt, {
    chunkKey: `${this.cx},${this.cz}`,
    neighborKey: `${neighborCx},${neighborCz}`,
    marked
  });
}
```

- [ ] **Step 3: 处理 Y 范围风险**

如果本项目中可见实例可能存在 `worldY + 15` 之外的实体结构方块，则不要只扫 `worldY..worldY+15`。改为从 `visibleKeys` 过滤边界：

```js
for (const code of this.visibleKeys) {
  const { x, z } = Chunk.decodeCoord(code);
  const nearX = dx === 1 ? x >= maxX - 1 : dx === -1 ? x <= minX + 1 : false;
  const nearZ = dz === 1 ? z >= maxZ - 1 : dz === -1 ? z <= minZ + 1 : false;
  if ((nearX || nearZ) && this._addDirtyAOIfRenderable(code)) marked++;
}
```

优先选择能覆盖现有结构高度的实现。

- [ ] **Step 4: 运行 lint**

Run:

```bash
npm run lint
```

Expected: 无新增 lint 错误。

---

### Task 5: AOWorker 避免 per request 合并 chunk cache

**Files:**
- Modify: `src/workers/AOWorker.js`

- [ ] **Step 1: 定义 AOWorker 局部 CHUNK_SIZE**

`GameConfig.js` 当前没有导出 `CHUNK_SIZE`，项目内多个 Worker 也使用局部常量。为避免让 AOWorker 依赖 `ChunkConsolidation.js`，在 AOWorker 顶部定义局部常量：

```js
const CHUNK_SIZE = 16;
```

- [ ] **Step 2: 新增世界坐标到 chunkKey 的 helper**

```js
function getChunkKeyForWorldCoord(x, z) {
  const cx = Math.floor(Math.floor(x) / CHUNK_SIZE);
  const cz = Math.floor(Math.floor(z) / CHUNK_SIZE);
  return `${cx},${cz}`;
}
```

- [ ] **Step 3: 新增跨 chunk cache 读取 helper**

```js
function getEntryFromAnyCachedChunk(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const data = chunkCache[getChunkKeyForWorldCoord(ix, iz)];
  if (!data) return null;

  const code = encodeCoord(ix, iy, iz);
  if (data[code] !== undefined) return data[code];

  const strKey = `${ix},${iy},${iz}`;
  return data[strKey] !== undefined ? data[strKey] : null;
}
```

- [ ] **Step 4: 替换 `createOcclusionCheckerFromCache()` 的 merged 构造**

将函数改为：

```js
function createOcclusionCheckerFromCache() {
  return function isOccluding(x, y, z) {
    const entry = getEntryFromAnyCachedChunk(x, y, z);
    if (!entry) return false;
    const type = typeof entry === 'string' ? entry : entry.type;
    if (!type) return false;
    return isFullCubeOccluder(type);
  };
}
```

注意：当前代码里 `isFullCubeOccluder(props)` 传入的是 props，需核对 `BlockData.js` 函数签名。如果签名要求 type，就传 type；如果要求 props，就保留 `getBlockProperties(type)` 后传 props。

- [ ] **Step 5: 简化 `handleComputeAO()` 调用**

将：

```js
const isOccluding = createOcclusionCheckerFromCache(chunkKey, neighborChunks || []);
```

改为：

```js
const isOccluding = createOcclusionCheckerFromCache();
```

保留 `neighborChunks` 参数兼容消息协议，但不再依赖它复制数据。

- [ ] **Step 6: 运行 lint**

Run:

```bash
npm run lint
```

Expected: 无新增 lint 错误。

---

### Task 6: 浏览器测试与手动性能验证

**Files:**
- No code changes unless tests reveal regressions

- [ ] **Step 1: 启动开发服务器**

Run:

```bash
npm run start
```

Expected: 静态服务器在 8080 或可用端口启动。

- [ ] **Step 2: 运行浏览器测试页**

打开：

```text
http://localhost:8080/src/tests/index.html
```

点击“运行所有测试”。

Expected: 所有现有测试通过。

- [ ] **Step 3: 验证 AO 视觉正确性**

手动检查：

- 新加载 chunk 初始可见，随后 AO 正常补齐；
- chunk 边界没有明显黑线、闪烁或 AO 断层；
- 挖掘和放置后 consolidation 收敛时 AO 能刷新；
- Mag7 / TNT 批量删除后 AO 不丢失。

- [ ] **Step 4: 对比 chunk perf 日志**

启用现有 `ChunkPerfMonitor` 日志后观察：

- `chunk.ao-refresh.source-stable.markMs` 明显下降；
- `chunk.ao-refresh.request.positions` 接近可见实例数；
- `chunk.ao-refresh.mark-boundary` 不再出现固定 4096 扫描级成本；
- `non-deferred-finalize` / deferred finalize 不再出现 AO 造成的 30ms 级峰值。

---

## 实施检查点

- [ ] 每个 task 后运行 `npm run lint`。
- [ ] 修改 Worker 查询后重点检查 chunk 边界 AO。
- [ ] 任何提交必须等待用户明确指令。
- [ ] 如果可见实例过滤导致 AO 漏刷，立即回退该过滤条件，保留“只去重重复刷新”和“边界生成”两项低风险优化。
