# 派生数据清理与增量更新优化设计

> **前置依赖**：blockData authority unification（已完成）
>
> **核心原则**：`WorldBlockDataStore._slices` 是全量永驻的权威数据源，永不淘汰。所有为渲染和运行时服务的派生数据只需在玩家坐标附近有效，chunk unload 时应释放。

## 1. 问题概述

blockData authority 统一后，runtime 权威闭环已稳定。但以下非权威的派生数据在 chunk unload 时未释放，随玩家持续探索而无限增长；同时部分派生索引的重建策略过于粗暴，产生不必要的 CPU 开销。

### 1.1 内存问题

| 数据 | 位置 | 本质 | 释放机制 |
|------|------|------|---------|
| RegionCache 中的 blockData plain object | `WorldRuntime._regionCache` | **冗余副本** — 与 authority 重复 | LRU 淘汰（32 region），但 blockData 本身不删 |
| `_dirtyChunks` 条目 | `WorldRuntime._dirtyChunks` | **已废弃的状态残留** — flush 已旁路 | 从不清理 |
| `_staticTreeTerrainBoostChunkKeys` | `World._staticTreeTerrainBoostChunkKeys` | **派生标记** — 可重新计算，但来源是"源 chunk 的 structureCenters"而非"目标 chunk 自身" | 只 add 不 delete |
| ~~`WorldChunkPayloadRegistry._payloads`~~ | ~~`WorldChunkPayloadRegistry`~~ | ~~派生数据~~ **实为独立权威数据** — 保存 runtimeSeedData/staticEntities，authority 命中路径从此恢复，不会回读 IndexedDB | `removeChunkPayload` 已定义但从未调用（**不应 unload 时删除**） |

### 1.2 CPU 问题

| 场景 | 位置 | 问题 |
|------|------|------|
| `appendScatteredBlocks` | Chunk.js:3968 | 追加 5-20 个方块后全量重建 `blockDataArray`（遍历 500-2000 条目） |
| `_applyConsolidateResult` | ChunkConsolidation.js:461 | consolidation 不改 authority，但回包后仍全量重建 `blockDataArray` |

## 2. 不做的事

- 不清理废弃 flush 代码（`flushChunk` / `flushBeforeUnload` / `flushAllDirty` 等）
- 不优化 Consolidation 的 postMessage 双重序列化
- 不清理 `SpecialEntitiesShadowStore`（特殊实体数量极少，永驻合理）
- 不清理 `WorldChunkRegistry._entries`（条目极小，且是权威元数据）
- 不清理 `WorldChunkPayloadRegistry._payloads`（独立权威数据，authority 命中路径依赖此恢复 staticEntities / structureCenters，unload 时删除会丢实体）。**已知限制**：`_payloads` 会随 `WorldGenerationService` 为每个生成的 chunk 写入 runtimeSeedData/staticEntities 而全量增长。后续可拆分 payload 权威性——最小不可推导的 seed/结构中心长期保存，staticEntities 若能从 blockData/seed 确定性重建则按距离释放——但需先实现重建逻辑和测试，本轮不做
- 不改 `WorldBlockDataStore._slices` 的生命周期（全量永驻是设计原则）
- 不清理 `PersistenceWorker` 端的 `regionCache`（max 6 region，独立 Worker 线程，与主线程 RegionCache 无关，本轮只聚焦主线程内存）
- 不优化 `ensureRegion()` 从 Worker 传入完整 region 后再剥离 blockData 造成的**峰值内存拷贝**（region 在 postMessage 反序列化时带完整 blockData 进入主线程，strip 后才释放）。后续可在 Worker 侧预剥离或改用 `getRegionMetadata` 只传元数据
- 不重命名性能计量字段（如 `initArrayStorageMs`），保持与已有日志/监控一致

## 3. 改动清单

### M1: RegionCache 去除 blockData 冗余副本

**目标**：消除 RegionCache 中与 `WorldBlockDataStore` 重复的 blockData plain object 副本。

**背景**：cold import 路径从 IndexedDB 读出 `chunkRecord`（含 plain object 格式 blockData），存入 RegionCache，再 `deserializeBlockData` 写入 `WorldBlockDataStore`。之后 RegionCache 里的 plain object 副本再无人读，但始终占据内存。最多 32 region × 64 chunk = 2048 chunk 的冗余 blockData。

**改动**：

采用统一 helper 而非逐点修改，避免遗漏：

1. 在 `WorldRuntime` 中新增 `_stripBlockDataFromRegionRecord(region)` 方法，遍历 `region.chunks` 删除每个 chunk 的 `blockData` 字段，返回浅克隆（不修改原始对象）
2. 所有 `this._regionCache.set(...)` 调用处，对 region 调用此 helper。涉及 **6 个 `_regionCache.set` 调用**：
   - `_upsertRegionCacheChunkRecord`（L109）— 构建新 region 对象（不修改旧缓存引用）后使用 helper 写入 cache
   - `ensureRegion`（L761）— 在 `_regionCache.set` 处使用 helper
   - `flushAllDirty`（L346、L353、L366）— 在 3 个 `_regionCache.set` 处使用 helper
   - `flushPendingUnloadQueueWithinBudget`（L683）— 在 `_regionCache.set` 处使用 helper
3. `_updateRegionCacheChunkRecord`（L535）— 无 `_regionCache.set`（原地修改缓存引用），对单条 chunkRecord per-record 剥离 blockData
4. `World.js` cold import 路径（约 L392-401）：成功写入 authority 后，将 `result.chunkRecord.blockData` 置为 `null`

**关键约束 — full-save 路径不能用 stripped cache 做基底**：M1 剥离 RegionCache blockData 后，所有从 `_regionCache.get()` 取 region 再做 `saveRegionRecord` 的路径都不安全 — stripped region 中未被 flush 的其他 chunk 的 blockData 会随整包写盘丢失。涉及 `flushAllDirty` 的 `else if (region)` 分支和 `flushPendingUnloadQueueWithinBudget` 的 `else` fallback。**缓解措施**：(1) 这些分支优先使用 `applyRegionPatch`（patch-only，不影响其他 chunk）；(2) 无 patch API 时从 `worldStore.getRegionRecord()` 重读完整 region 再属性 merge（`{ ...existing, ...chunkRecord }`），不用 stripped cache 做整包 save 基底；(3) 写盘成功后将 `group.chunks` 新数据 merge 回 region cache 再 strip，确保 cache 元数据（staticEntities 等）不陈旧；(4) `preserveStoredBlockData` 路径改为 `delete chunkRecord.blockData`，让 patch 路径自然保留 IndexedDB 中已有数据，full-save 路径通过属性 merge 保留重读 region 的 blockData，不用 `continue` 跳过以避免 entry 永久残留或静默丢数据。

**影响**：`_resolveSerializedBlockData` 中从 RegionCache 读 blockData 的 fallback 路径本轮不改代码，但实际会读到 undefined，等价于走其他 fallback。这些 fallback 路径属于已废弃的 flush 链路，本轮不影响 runtime 正确性。

**测试**：需同步更新 `src/tests/test-world-runtime.js` 中断言 RegionCache 保留 blockData 的用例（L46 等处）。

### M2: chunk unload 时清理 runtime 残留（`_dirtyChunks` + `pendingUnloadFlushQueue` + `_flushTimers`）

**目标**：chunk 卸载时清除 `WorldRuntime` 中与该 chunk 关联的所有 deprecated 运行时残留。

**背景**：`recordBlockMutation` 每次编辑都追加条目到 `_dirtyChunks`。flush 已旁路不再消费这些条目，chunk unload 也不调用 `clearChunkDirty`（该方法已存在于 WorldRuntime.js:203）。此外 `pendingUnloadFlushQueue` 和 `_flushTimers` 也属于 deprecated flush 链路残留，在热路径中可能缓慢增长。

**改动**：
1. 在 `WorldRuntime` 中新增 `clearChunkRuntimeResidue(cx, cz)` 方法，统一清理 `_dirtyChunks`、`pendingUnloadFlushQueue`、`_flushTimers` 中的对应条目
2. `World.js` chunk unload 循环中，`chunk.dispose()` 前调用 `this.worldRuntime?.clearChunkRuntimeResidue(chunk.cx, chunk.cz)`

**语义决策**：`_dirtyChunks` 的注释称"仅用于观测和导出标记"（WorldRuntime.js:165），chunk unload 时清理会丢失这一标记。本轮认为这是可接受的：authority unification 后，`WorldBlockDataStore` 是写入权威，持久化/导出脏判断应由 store 层面承担（如 `_versions` + baseline version 或独立 export-dirty 集合），不应依赖 runtime dirty set。本轮不实现 store 层面的 dirty 追踪，但明确 `_dirtyChunks` 仅保留当前 loaded chunk 的派生状态。

### M3: chunk topology 变化后重建 `_staticTreeTerrainBoostChunkKeys`

**目标**：chunk 卸载后清理过期的 boost key，避免 Set 无限增长。

**背景**：该 Set 记录"包含静态树的 chunk 周围需要地形增强的**目标** chunk key"。同一个目标 key 可能由**多个不同源 chunk** 的 structureCenters 标记。逐 chunk 直接 delete 语义不安全 — 可能删除仍被其他已加载源 chunk 标记的 key，导致返回该 chunk 时失去有效的 boost 优先级。

**改动**：提取 `_rebuildStaticTreeTerrainBoostChunkKeys()` helper 方法封装重建逻辑（清空 Set + 遍历已加载 chunk 的 structureCenters 重新 add），在 `chunkTopologyChanged` 分支中调用。提取 helper 使测试可以直接调用生产代码路径验证，避免测试重复实现而失去回归防护能力。

```javascript
_rebuildStaticTreeTerrainBoostChunkKeys() {
  this._staticTreeTerrainBoostChunkKeys.clear();
  for (const [, ch] of this.chunks) {
    this._markStaticTreeTerrainBoostFromChunk(ch);
  }
}

// 在 chunkTopologyChanged 分支中（已有 clearBlockLookupCaches 调用之后）
this._rebuildStaticTreeTerrainBoostChunkKeys();
```

**代价**：每次 topology 变化时遍历已加载 chunk 的 structureCenters（通常 50-80 个 chunk，每个 0-5 个 center），开销极小。

### ~~M4: chunk unload 时释放 `WorldChunkPayloadRegistry` payload~~ [已撤回]

**撤回原因**：`WorldChunkPayloadRegistry` 实为独立权威数据，不是"可从 blockData 反推"的派生数据。authority 命中路径（World.js:323-355）直接从 payload registry 恢复 `staticEntities` 和 `structureCenters`，命中后不再回读 IndexedDB。如果 unload 时删除 payload，返回该 chunk 时只能恢复 blockData，modGunMan、rovers、structureCenters 会丢失。

除非先实现"从 blockData/seed 确定性重建 payload"的代码和测试，否则 `WorldChunkPayloadRegistry` 仍应被视为独立权威数据，不应在 unload 时清理。

### M5: `appendScatteredBlocks` 增量更新 `blockDataArray`

**目标**：将追加跨 chunk 方块后的 `blockDataArray` 重建从 O(n) 降为 O(k)（k = 追加方块数）。

**背景**：`appendScatteredBlocks`（Chunk.js:3886）已在 L3936-3946 对 `solidBlocks` 和 `lightSourceCoords` 做了增量更新，但 L3968 调用 `_initArrayStorageFromBlockData()` 全量重建 `blockDataArray`/`blockPalette`/`solidBlockIds`。追加通常只有 5-20 个方块，全量遍历 500-2000 条目不合理。

**改动**：将 L3968 的 `this._initArrayStorageFromBlockData()` 替换为增量更新逻辑：

```javascript
for (const [code] of patches) {
  const entry = this.blockData.get(code);
  if (!entry) continue;
  const parsed = parseBlockEntry(entry);
  const type = parsed.type;
  if (!type || type === 'air') continue;
  const { x, y, z } = Chunk.decodeCoord(code);
  const lx = x - this.cx * CHUNK_SIZE;
  const ly = y - this.worldY;
  const lz = z - this.cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
  const blockIndex = (ly << 8) | (lz << 4) | lx;
  const blockId = this._getOrCreateBlockId(entry);
  this.blockDataArray[blockIndex] = blockId;
  const props = getBlockProps(type);
  if (props.isSolid) this.solidBlockIds.add(blockId);
}
```

**兼容性**：`_getOrCreateBlockId` 在增量场景下仍正确 — 新方块类型会自动追加到 `blockPalette`/`blockPaletteReverse` 中。

### M6: `_applyConsolidateResult` 去除多余 `_initArrayStorageFromBlockData`

**目标**：consolidation 回包后不再全量重建 `blockDataArray`。

**背景**：consolidation 的设计契约是不改 authority — 它只更新派生层（mesh、visibleKeys、solidBlocks）。`_syncVisibilityAndCollision`（L430）已用 Worker 回包更新了可见性和碰撞索引。既然 blockData 没变，`blockDataArray` 不需要重建。

**改动**：删除 ChunkConsolidation.js:461 的 `this._initArrayStorageFromBlockData()` 调用。

## 4. 统一 chunk unload 清理顺序

M2 改动在 `World.js` chunk unload 循环内执行。M3 改为 topology 变化后批量重建，在循环外执行。M4 已撤回。

```
for (const [key, chunk] of this.chunks) {
  if (超出渲染距离) {
    // 1. 通知 MinecartManager（已有）
    // 2. 清理方块分发 buffer（已有）
    // 3. 从场景移除（已有）
    // 4. 清理 Face Culling 更新队列（已有）
    // 5. [新增] 清理 runtime 残留（dirty + pendingUnload + flushTimer）
    // 6. 释放 GPU 资源、detach authority slice（已有 chunk.dispose()）
    // 7. 从 chunks Map 移除（已有）
  }
}

if (chunkTopologyChanged) {
  // ... 已有：clearBlockLookupCaches, requestShadowMapUpdate
  // [新增] 从已加载 chunks 重建 _staticTreeTerrainBoostChunkKeys
}
```

## 5. 验收标准

1. 玩家持续奔跑 5 分钟后，RegionCache 中不存在任何 chunk 的 blockData plain object 副本（通过统一 helper `_stripBlockDataFromRegionRecord` 覆盖全部 7 个 RegionCache 写入路径：6 个 `_regionCache.set` 调用 — `_upsertRegionCacheChunkRecord`(L109)、`ensureRegion`(L761)、`flushAllDirty`(L346/L353/L366)、`flushPendingUnloadQueueWithinBudget`(L683)；以及 `_updateRegionCacheChunkRecord`(L535) 原地更新路径采用 per-record 剥离）
2. chunk unload 后，`worldRuntime._dirtyChunks`、`pendingUnloadFlushQueue`、`_flushTimers` 中不残留对应条目
3. chunk topology 变化后，`_staticTreeTerrainBoostChunkKeys` 仅包含当前已加载 chunk 产生的 boost key
4. ~~chunk unload 后，`worldChunkPayloadRegistry` 中不残留对应 payload~~ [已撤回 — payload 是独立权威数据]
5. `appendScatteredBlocks` 追加少量方块时，不触发全量 `_initArrayStorageFromBlockData`；追加非实心方块、带 orientation 方块后 blockDataArray 正确
6. consolidation 完成后，不触发 `_initArrayStorageFromBlockData`；consolidation 后 blockDataArray、solidBlockIds 与 blockData 一致
7. 所有现有测试通过（`node command/run-tests.js`），`test-world-runtime.js` 中断言 RegionCache 保留 blockData 的用例已同步更新
8. 手动验证：放置方块 → 离开 chunk → 返回，方块仍在
9. 手动验证：跨 chunk 结构生成正确，AO 和碰撞无回退
10. 控制台验证（跑图 5 分钟后在 DevTools 中检查）：
    - `game.world.worldRuntime._regionCache` 所有 chunk record 无 `blockData` 字段
    - `game.world.worldRuntime._dirtyChunks.size` / `pendingUnloadFlushQueue.size` / `_flushTimers.size` 不随已卸载 chunk 增长
    - `game.world._staticTreeTerrainBoostChunkKeys` 中所有 key 均可由当前已加载 chunk 的 structureCenters 重新推导得到（boost key 是目标 chunk key，不一定已加载）

## 6. 风险

1. **M1 风险 — 导出路径**：未来恢复持久化时需要导出 blockData，不能再从 RegionCache 取。需改为从 `WorldBlockDataStore` 序列化导出。这与 authority unification 设计文档中 `authority-based rewrite` 的方向一致。
2. **M1 风险 — full-save 路径丢 blockData**：M1 剥离 RegionCache blockData 后，所有从 `_regionCache.get()` 取 region 再做 `saveRegionRecord` 的路径都不安全——stripped region 中未被 flush 的其他 chunk 的 blockData 会随整包写盘丢失。涉及 `flushAllDirty` 的 `else if (region)` 分支（WorldRuntime.js:347）和 `flushPendingUnloadQueueWithinBudget` 的 `else` fallback（WorldRuntime.js:652）。**缓解措施**：(1) 这些分支优先使用 `applyRegionPatch`（patch-only，不影响其他 chunk）；(2) 无 patch API 时从 `worldStore.getRegionRecord()` 重读完整 region 再属性 merge（`{ ...existing, ...chunkRecord }`），不用 stripped cache 做整包 save 基底；(3) 写盘成功后将 `group.chunks` 新数据 merge 回 region cache 再 strip，确保 cache 元数据（staticEntities/runtimeSeedData 等）不陈旧；(4) `preserveStoredBlockData` 路径改为 `delete chunkRecord.blockData`，让 patch 路径自然保留已有数据，full-save 路径通过属性 merge 保留重读 region 的 blockData，不用 `continue` 跳过以避免 entry 永久残留或静默丢数据。
3. ~~**M4 风险**~~：[已撤回] `WorldChunkPayloadRegistry` 实为独立权威数据，不能 unload 时清理。
4. **M5 风险**：增量更新 `blockDataArray` 时 `_getOrCreateBlockId` 可能为相同类型创建不同 blockId（如果 palette 在上次全量重建后被清空过）。但在增量场景下 palette 不会被清空，只会追加，所以没有问题。
5. **M6 风险 — solidBlockIds 共享 id 误删**：`_updateBlockState`（Chunk.js:1554）和 `_registerSpecialEntityCollision`（Chunk.js:2629）在删除/替换/覆盖方块时调用 `solidBlockIds.delete(oldId)`，但同一 blockId 可能被多个同类型方块共享。存在三个子问题：(a) **删除场景**（stone → air）：删除一块 stone 会将 stone 的 blockId 从 solidBlockIds 移除，即使其他 stone 方块仍存在；(b) **替换场景**（stone → glass_block）：替换分支中 `blockDataArray.includes(oldId)` 在写入新 id 之前执行，当前位置仍是 oldId，导致 includes 永远返回 true，旧 id 永不被移除；(c) **实体覆盖场景**：`_registerSpecialEntityCollision`（Chunk.js:2629）用 0 覆盖地形方块时直接 delete，没有 includes 检查。当前 consolidation 的全量重建（`_initArrayStorageFromBlockData`）掩盖了这些 bug。M6 移除重建后 bug 暴露。**缓解措施**：M6 实现前，先为 `solidBlockIds` 补充删除、替换、实体覆盖三个场景的测试；修复方案为在 `_updateBlockState` 和 `_registerSpecialEntityCollision` 中先写入新值再扫描 `blockDataArray` 确认旧 id 不再被引用后才 delete。
6. **M6 风险 — 旧 bug 持续不一致**：如果存在某个旧 bug 导致 `blockDataArray` 在 consolidation 前已经和 blockData 不一致，去掉这次重建会让不一致持续。但按当前设计所有写入口都同步更新 `blockDataArray`，除 solidBlockIds 共享 id 问题外不一致不应发生。
