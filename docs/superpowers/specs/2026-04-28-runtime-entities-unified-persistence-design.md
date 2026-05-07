# Runtime Entities Unified Persistence — Phase 2 Design Spec

**Date:** 2026-04-28
**Author:** Claude Code
**Status:** Draft
**Predecessors:** [Runtime Entities Persistence Design (Phase 1)](../../plans/2026-04-28-runtime-entities-persistence-design.md), [WorldStore Runtime Streaming Design](./2026-04-26-worldstore-runtime-streaming-design.md)

---

## 1. Goal

统一运行时特殊实体（炮塔、丧尸巢穴、矿车）的持久化路径，将其从 `persistenceService.cache.entities`（内存 + `world_deltas` 表）迁入 `worldStore` 的 `ChunkRecord.runtimeEntities`（`world_regions` 表），实现跨页面重启的持久化恢复。

## 2. Scope

### In Scope
- 扩展 `ChunkRecord` 格式，新增 `runtimeEntities` 字段
- 修改 `WorldRuntime.flushBeforeUnload` 写入 entities
- 修改 `Chunk.loadFromRecord` 读取 runtimeEntities
- 实现渐进式迁移（旧存档读取时自动从 `world_deltas` 迁移到 `world_regions`）
- 修改 `Game.collectSnapshot` 从 `worldStore` 读取（手动存档路径统一）
- 修改 `ManualSaveWorker` 兼容新格式

### Out of Scope
- `RuntimeEntityRepository` 抽象层（独立职责拆分）
- Chunk 级 `activate/deactivate` 生命周期钩子
- `world_deltas` 表的彻底删除（保留作为降级保护）
- Worker 端 entity 处理（entities 始终在主线程收集和写入）
- Region 级 entity 聚合（保持 chunk 级粒度）

## 3. Architecture

### 3.1 ChunkRecord 格式扩展

```js
// src/world/WorldStore.js — ChunkRecord 格式
{
  blockData: { '12345': 1, ... },              // 编码的方块数据
  staticEntities: [{ type: 'tree', ... }],      // 地形生成实体
  runtimeSeedData: { structureCenters: [...] }, // 结构种子数据
  runtimeEntities: {                             // 【新增】运行时实体快照
    turrets: [{ id, position: {x,y,z}, rotation }],
    zombieNests: [{ id, position: {x,y,z}, criticalBlock: {x,y,z,type}, lastSpawnTime }],
    minecarts: [{ id, position: {x,y,z}, movementState: 'IDLE'|'MOVING', ... }]
  }
}
```

`runtimeEntities` 是可选字段。不含此字段的旧存档在读取时触发渐进式迁移。

### 3.2 数据流

#### 写入路径（Chunk Unload）

```
World.update() — chunk unload 路径:
1. persistence.snapshotChunkBlocks(key, chunk.blockData)    // 同步
2. minecartManager.stopMinecartsForChunk(cx, cz)            // 停止移动矿车
3. worldRuntime.flushBeforeUnload(cx, cz, blockData, entities)  // 新增 entities 参数
   → WorldRuntime._collectEntitiesForChunk(cx, cz):
     - turretManager.getEntitiesForChunk(cx, cz)
     - zombieNestManager.getEntitiesForChunk(cx, cz)
     - minecartManager.getEntitiesForChunk(cx, cz)
   → putChunkRecord(cx, cz, { ..., runtimeEntities: entities })
   → WorldStore.saveRegionRecord(rx, rz, region)            // IndexedDB
4. chunk.dispose()
5. this.chunks.delete(key)
```

#### 读取路径（Chunk Load）

```
Chunk.loadFromRecord(chunkRecord):
1. persistence.ensureChunkSnapshot(chunkKey)                // 确保 cache 存在
2. persistence.hydrateChunkBlocks(chunkRecord.blockData)    // cache.blocks 优先
3. _injectBlockData(effectiveBlockData)
4. _injectStaticEntities(chunkRecord.staticEntities)
5. structureCenters = chunkRecord.runtimeSeedData
6. 读取 runtimeEntities:
   if chunkRecord.runtimeEntities:
     → 使用 chunkRecord.runtimeEntities（新格式）
   else:
     → 从 persistence.cache.get(chunkKey)?.entities 读取（旧格式）
     → this._needsEntityMigration = true
7. _buildMeshFromExistingBlockData()
8. finalizeNonDeferredPhase()
   → restoreNestsForChunk() / restoreTurretsForChunk() / restoreMinecartsForChunk()
```

#### 渐进式迁移路径

```
Chunk.finalizeNonDeferredPhase() — 若 _needsEntityMigration 为 true:
1. 从 world_deltas 读取 legacyData = persistence.workerGetChunkData(cx, cz)
2. if legacyData?.entities:
   → chunkRecord.runtimeEntities = legacyData.entities
   → worldStore.putChunkRecord(cx, cz, chunkRecord)          // 回填
   → log: "migrated runtime entities for chunkKey"
3. else:
   → chunkRecord.runtimeEntities = { turrets: [], zombieNests: [], minecarts: [] }
```

### 3.3 手动存档路径统一

#### collectSnapshot（Game.js）

```js
// before: 从 persistenceService.cache 读取
// after: 从 worldStore 读取已加载 chunk 的完整数据
collectSnapshot() {
  const worldDeltas = [];
  for (const [key, chunk] of this.world.chunks.entries()) {
    const record = this.world.worldStore.getChunkRecord(chunk.cx, chunk.cz);
    worldDeltas.push({
      key,
      blocks: record.blockData,
      entities: record.runtimeEntities || {}
    });
  }
  return { player: {...}, worldDeltas, seed: this.seed, settings: {...} };
}
```

#### loadSnapshot（ManualSaveWorker）

`ManualSaveWorker` 的 `load` 路径兼容两种格式的 `worldDeltas`：
- 新格式：`{ key, blocks, entities }` 其中 `entities` 包含 `turrets/zombieNests/minecarts`
- 旧格式：`{ key, blocks, entities }` 结构相同但来自 `world_deltas` 表

两者格式一致，无需额外兼容代码。

## 4. Detailed Changes

### 4.1 WorldRuntime.js

#### `flushBeforeUnload(cx, cz, blockDataSnapshot, entitiesSnapshot)`

- 新增第四个参数 `entitiesSnapshot`（可选）
- 若无传入，调用 `_collectEntitiesForChunk(cx, cz)` 收集
- 构建包含 `runtimeEntities` 的完整 `ChunkRecord`

#### `_collectEntitiesForChunk(cx, cz)`

- 新方法，从三个 manager 收集实体：
  ```js
  {
    turrets: this.game.turretManager.getEntitiesForChunk(cx, cz),
    zombieNests: this.game.zombieNestManager.getEntitiesForChunk(cx, cz),
    minecarts: this.game.minecartManager.getEntitiesForChunk(cx, cz)
  }
  ```

#### `_ensureChunkEntitiesMigrated(cx, cz, chunkRecord)`

- 新方法，检查 `chunkRecord.runtimeEntities` 是否存在
- 若不存在，从 `world_deltas` 读取 entities 并回填
- 回填后调用 `putChunkRecord` 持久化

### 4.2 World.js

#### `World.update()` — chunk unload 路径

```js
// before
this.worldRuntime.flushBeforeUnload(cx, cz, chunk.blockData);

// after
const entities = this._collectRuntimeEntitiesForChunk(chunk);
this.worldRuntime.flushBeforeUnload(cx, cz, chunk.blockData, entities);
```

#### `_collectRuntimeEntitiesForChunk(chunk)`

- 新方法，在 `World.js` 中收集当前 chunk 的 runtime entities
- 通过 `turretManager.getEntitiesForChunk()` / `zombieNestManager.getEntitiesForChunk()` / `minecartManager.getEntitiesForChunk()` 获取
- 需要在三个 manager 中新增 `getEntitiesForChunk(cx, cz)` 方法

### 4.3 Chunk.js

#### `loadFromRecord(chunkRecord)`

- 修改 runtime entities 读取逻辑，优先使用 `chunkRecord.runtimeEntities`
- 若不存在，回退 `persistence.cache.get(chunkKey)?.entities`
- 标记 `this._needsEntityMigration = true` 触发渐进迁移

#### `finalizeNonDeferredPhase()`

- 若 `_needsEntityMigration` 为 true，调用 `WorldRuntime._ensureChunkEntitiesMigrated()`
- 迁移完成后清除标记

### 4.4 Game.js

#### `collectSnapshot()`

- 改为从 `worldStore` 读取已加载 chunk 的完整数据
- `worldDeltas` 中 `entities` 字段来自 `chunkRecord.runtimeEntities`

#### `restoreSnapshot(saveData)`

- 加载时 `worldDeltas` 包含 `{ key, blocks, entities }`
- 注入时通过 `injectSaveData` 写入 `persistenceService.cache`
- `Chunk.loadFromRecord` 从 `cache.entities` 读取并恢复实体

### 4.5 PersistenceService.js

- `cache.entities` 保留为临时层，渐进迁移后不再作为权威数据源
- 保留所有 Phase 1 添加的方法（`ensureChunkSnapshot`, `snapshotChunkBlocks`, `hydrateChunkBlocks`, `replaceChunkBlocks`）
- 新增 `workerGetChunkData(cx, cz)` 方法：向 PersistenceWorker 请求读取 `world_deltas` 表的数据（仅用于渐进迁移）

### 4.6 PersistenceWorker.js

- 新增 `getChunkData` action（已有，但此前仅用于 `saveChunkData` 配对）
- 确保 `getChunkData` 返回包含 `{ blocks, entities }` 的完整记录

### 4.7 ManualSaveWorker.js

- `load` 路径中 `worldDeltas` 的格式不变（`{ key, blocks, entities }`）
- `injectSaveData` 接收后写入 `persistenceService.cache`，兼容新格式

### 4.8 Three Managers（TurretManager, ZombieNestManager, MinecartManager）

每个 manager 新增 `getEntitiesForChunk(cx, cz)` 方法：

```js
// TurretManager
getEntitiesForChunk(cx, cz) {
  const chunkKey = `${cx},${cz}`;
  return this.turrets
    .filter(t => {
      const tcx = Math.floor(t.position.x / 16);
      const tcz = Math.floor(t.position.z / 16);
      return tcx === cx && tcz === cz;
    })
    .map(t => ({ id: t.id, position: t.position, rotation: t.rotation }));
}

// ZombieNestManager
getEntitiesForChunk(cx, cz) {
  const chunkKey = `${cx},${cz}`;
  return this.nests
    .filter(n => {
      const ncx = Math.floor(n.position.x / 16);
      const ncz = Math.floor(n.position.z / 16);
      return ncx === cx && ncz === cz;
    })
    .map(n => ({ id: n.id, position: n.position, criticalBlock: n.criticalBlock, lastSpawnTime: n.lastSpawnTime }));
}

// MinecartManager
getEntitiesForChunk(cx, cz) {
  return this.minecarts
    .filter(m => {
      const mcx = Math.floor(m.position.x / 16);
      const mcz = Math.floor(m.position.z / 16);
      return mcx === cx && mcz === cz;
    })
    .map(m => m.toJSON());
}
```

同时，三个 manager 的 `saveXxxToSnapshot` 方法继续保留，用于运行时实时更新 `cache.entities`（作为写入缓冲），但权威数据源切换为 `worldStore`。

## 5. Backward Compatibility

### 5.1 旧存档加载

- `ChunkRecord.runtimeEntities` 不存在时，`Chunk.loadFromRecord` 回退 `cache.entities`
- 触发 `_needsEntityMigration` 标记，从 `world_deltas` 提取并回填
- 回填后旧 chunk 获得完整 `runtimeEntities`，后续加载不再触发迁移

### 5.2 world_deltas 保留

- 迁移后不删除 `world_deltas` 表中的数据
- `world_deltas` 保留作为降级保护（若 `world_regions` 写入失败可回退）
- 后续版本可考虑添加清理工具删除已迁移的旧数据

### 5.3 手动存档兼容

- 手动存档格式不变（`worldDeltas` 仍为 `{ key, blocks, entities }`）
- 新存档：`entities` 来自 `worldStore.runtimeEntities`
- 旧存档：`entities` 来自 `world_deltas`（格式相同）
- 加载路径无需区分新旧格式

## 6. Validation

### 6.1 回归测试
- 放置炮塔 → 跑远卸载 chunk → 返回确认底座/柱子/炮塔头都在且能开火
- 放置丧尸巢穴 → 跑远卸载 → 返回确认结构还在且刷怪节奏不重置
- 放置铁轨和矿车 → 跑远卸载 → 返回确认位置正确

### 6.2 跨重启测试
- 放置实体 → 关闭页面 → 重新打开 → 确认实体存在
- 运动中的矿车 → 关闭页面 → 重新打开 → 确认矿车已停止在正确位置

### 6.3 渐进迁移测试
- 加载包含实体的旧存档（仅有 `world_deltas`）→ 读取包含实体的 chunk → 确认 `runtimeEntities` 已回填到 `world_regions`
- 清除 `world_deltas` → 重新加载 → 确认实体仍可从 `world_regions` 恢复

### 6.4 手动存档测试
- 放置实体 → 手动存档 → 清除 `world_deltas` → 加载存档 → 确认实体正确恢复

## 7. Risks

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `collectSnapshot` 只序列化已加载 chunk | 未探索区域不在存档中 | 用户提示"当前存档仅包含已探索区域" |
| 三个 manager 全局持有实体引用 | 长时间运行可能积累内存 | 与一阶段行为一致，不引入新风险 |
| 渐进迁移时 `world_deltas` 读取失败 | 实体丢失 | `world_deltas` 保留不删除，加载失败时创建空结构 |
| `flushBeforeUnload` 写入 `world_regions` 时 region 较大 | IndexedDB 写入延迟 | 与现有 blockData 写入路径一致，无额外开销 |
