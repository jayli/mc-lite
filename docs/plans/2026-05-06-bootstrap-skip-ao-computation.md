# Bootstrap 阶段跳过 AO 计算 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 WorldWorker 生成阶段跳过不必要的 `calculateAOForBlock()` 调用，将 aoLow/aoHigh 设为常量 1，减少 bootstrap 阶段的 Worker 计算耗时。

**Architecture:** WorldWorker 生成的 AO 数据在 bootstrap finalize 阶段会被 `_refreshAOFromStableSource` → AOWorker 全量重算并覆写 InstancedMesh AO attribute。因此 Worker 侧的 AO 计算是冗余的——它既不会被存入 MemoryWorldStore 权威数据源，也不会被 runtime 路径复用。改动集中在一处：将 AO 计算结果替换为常量，保留数据结构不变以维持下游兼容。

**Tech Stack:** Vanilla JS (ES Modules), Three.js 0.160.0, Web Workers

---

### Task 1: 替换 Worker 侧 AO 计算为常量

**Files:**
- Modify: `src/workers/WorldWorker.js:2863-2872`

**Step 1: 修改 WorldWorker.js 中的 AO 计算逻辑**

将第 2863-2872 行的 AO 计算块：

```js
      let aoLow = 0;
      let aoHigh = 0;
      // 简化AO逻辑：非透明且实心的方块自动启用AO
      const isAOEnabled = !props.isTransparent && props.isSolid;
      if (isAOEnabled) {
        ({ aoLow, aoHigh } = calculateAOForBlock(block.x, block.y, block.z, isOccluding));
      }
      d[block.type].push({x: block.x, y: block.y, z: block.z, aoLow, aoHigh, orientation: block.orientation || 0});
      visibleKeysSet.add(key);
      aoMap.set(key, { aoLow, aoHigh });
```

改为：

```js
      // AO 计算已移至 _refreshAOFromStableSource（AOWorker），bootstrap 阶段跳过
      const aoLow = 1;
      const aoHigh = 1;
      d[block.type].push({x: block.x, y: block.y, z: block.z, aoLow, aoHigh, orientation: block.orientation || 0});
      visibleKeysSet.add(key);
      aoMap.set(key, { aoLow, aoHigh });
```

保留数据结构不变（`aoLow`/`aoHigh` 字段仍然存在，值恒为 1，确保 `buildScatteredBlocks` 和 `buildMeshData` 无需改动）。

**Step 2: 运行 lint 检查**

```bash
npm run lint
```

Expected: 无新增警告（`calculateAOForBlock` import 若变为未使用，则移除该 import）。

**Step 3: 运行全量测试**

```bash
node command/run-tests.js
```

Expected: 所有测试通过（AO 计算变化不影响 blockData 正确性、面剔除结果和碰撞逻辑）。

**Step 4: 手动验证（可选）**

启动 `npm run start`，观察：
- Bootstrap 阶段 chunk 是否能正常显示（flat 光照）
- 进入 runtime 后 AO 阴影是否正确出现
- 控制台有无异常错误

---

### Task 2: 清理未使用的 import（如需要）

**Files:**
- Modify: `src/workers/WorldWorker.js:19`

**Step 1: 检查 `calculateAOForBlock` 是否还有其他调用**

```bash
grep -n "calculateAOForBlock" src/workers/WorldWorker.js
```

如果只剩 import 行而无调用处，则移除：

```js
// 删除这一行
import { calculateAOForBlock } from '../utils/AOUtils.js';
```

**Step 2: 再次运行 lint 和测试确认**

```bash
npm run lint
node command/run-tests.js
```

---

### 改动总结

| 文件 | 改动 | 影响 |
|------|------|------|
| `src/workers/WorldWorker.js` | 替换 AO 计算为常量 `aoLow=1, aoHigh=1` | Worker 回包的 scatteredBlocks/meshData 中 AO 值为常量 1 |
| `src/workers/WorldWorker.js` | 移除 `calculateAOForBlock` import（若无其他调用） | 清理无用依赖 |

**不修改的文件（说明为什么不需要改）：**
- `src/world/Chunk.js` — `_convertScatteredBlocksToMeshData` 已支持 `aoLow ?? 1` 默认值
- `src/world/ChunkConsolidation.js` — consolidation 路径在 runtime，需要 AO，不受影响
- `src/world/MemoryWorldStore.js` — 已只存储 type+orientation，不存 AO
- `src/world/WorldGenerationService.js` — 已只提取 blockData，不存 AO
- `src/utils/AOUtils.js` — `calculateAOForBlock` 仍被 consolidation 和 AOWorker 使用
- `src/core/AOBridge.js` / `src/workers/AOWorker.js` — 不受影响

**正确性保障链：**
> Worker flat AO → bootstrap 显示 flat 光照 → `finalizeNonDeferredPhase` → `onChunkFinalized` → `_refreshAOFromStableSource({ fullRefresh: true })` → AOWorker 计算正确 AO → 覆写 InstancedMesh AO attribute → 显示正确 AO 阴影
