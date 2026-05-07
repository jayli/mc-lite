# Runtime Entities Unified Persistence — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将运行时特殊实体（炮塔、丧尸巢穴、矿车）的持久化路径从 `persistenceService.cache.entities` + `world_deltas` 表统一迁入 `worldStore` 的 `ChunkRecord.runtimeEntities`（`world_regions` 表），实现跨页面重启的持久化恢复。

**Architecture:** 扩展 ChunkRecord 格式新增 `runtimeEntities` 字段，修改 `flushBeforeUnload` 写入 entities，`loadFromRecord` 优先读取 runtimeEntities 并支持从 `world_deltas` 渐进迁移，`collectSnapshot` 改为从 worldStore 读取。

**Tech Stack:** JavaScript (ES Modules), IndexedDB, Three.js v0.160.0

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/world/WorldRuntime.js` | Modify | `flushBeforeUnload` 新增 entities 参数 + `_collectEntitiesForChunk` + `_ensureChunkEntitiesMigrated` |
| `src/world/World.js` | Modify | unload 路径传入 entities 参数 + `_collectRuntimeEntitiesForChunk` |
| `src/world/Chunk.js` | Modify | `loadFromRecord` 读取 runtimeEntities + `_needsEntityMigration` + `finalizeNonDeferredPhase` 触发迁移 |
| `src/core/Game.js` | Modify | `collectSnapshot` 改为从 worldStore 读取 |
| `src/services/PersistenceService.js` | Modify | 新增 `workerGetChunkData` 方法（渐进迁移用） |
| `src/actors/turret/TurretManager.js` | Modify | 新增 `getEntitiesForChunk` |
| `src/actors/zombie-nest/ZombieNestManager.js` | Modify | 新增 `getEntitiesForChunk` |
| `src/actors/minecart/MinecartManager.js` | Modify | 新增 `getEntitiesForChunk` |
| `src/tests/test-runtime-session-persistence.js` | Modify | 新增渐进迁移相关测试 |

---

### Task 1: 三个 Manager 新增 `getEntitiesForChunk` 方法

**Files:**
- Modify: `src/actors/turret/TurretManager.js`
- Modify: `src/actors/zombie-nest/ZombieNestManager.js`
- Modify: `src/actors/minecart/MinecartManager.js`

每个 manager 新增一个方法，用于按 chunk 坐标收集该 chunk 内的所有实体快照数据。

- [ ] **Step 1: TurretManager 添加 `getEntitiesForChunk`**

在 `TurretManager.js` 中添加 `getEntitiesForChunk(cx, cz)` 方法。放在 `clearAll()` 方法之前（约 line 425 附近）。

```js
// src/actors/turret/TurretManager.js — 添加在 clearAll() 之前

/**
 * 收集指定 chunk 内的所有炮塔快照数据。
 * @param {number} cx - chunk X 坐标
 * @param {number} cz - chunk Z 坐标
 * @returns {Array<{id: string, position: {x:number,y:number,z:number}, rotation: {yaw:number,pitch:number}}>}
 */
getEntitiesForChunk(cx, cz) {
  const result = [];
  for (const turret of this.turrets.values()) {
    const tcx = Math.floor(turret.position.x / CHUNK_SIZE);
    const tcz = Math.floor(turret.position.z / CHUNK_SIZE);
    if (tcx === cx && tcz === cz) {
      result.push(this.toTurretSnapshot(turret));
    }
  }
  return result;
}
```

需要确认 `CHUNK_SIZE` 常量在该文件中是否已导入。检查文件顶部 import 部分，如果没有，添加：

```js
import { CHUNK_SIZE } from '../../constants/GameConfig.js';
```

- [ ] **Step 2: ZombieNestManager 添加 `getEntitiesForChunk`**

在 `ZombieNestManager.js` 中添加 `getEntitiesForChunk(cx, cz)` 方法。放在 `destroy()` 方法之前（约 line 316 附近）。

```js
// src/actors/zombie-nest/ZombieNestManager.js — 添加在 destroy() 之前

/**
 * 收集指定 chunk 内的所有丧尸巢穴快照数据。
 * @param {number} cx - chunk X 坐标
 * @param {number} cz - chunk Z 坐标
 * @returns {Array<{id: string, position: {x:number,y:number,z:number}, criticalBlock: {x:number,y:number,z:number,type:number}, lastSpawnTime: number}>}
 */
getEntitiesForChunk(cx, cz) {
  const result = [];
  for (const nest of this.nests.values()) {
    const ncx = Math.floor(nest.position.x / CHUNK_SIZE);
    const ncz = Math.floor(nest.position.z / CHUNK_SIZE);
    if (ncx === cx && ncz === cz) {
      result.push(this.toNestSnapshot(nest));
    }
  }
  return result;
}
```

同样需要确认 `CHUNK_SIZE` 是否已导入。如没有，添加：

```js
import { CHUNK_SIZE } from '../../constants/GameConfig.js';
```

- [ ] **Step 3: MinecartManager 添加 `getEntitiesForChunk`**

在 `MinecartManager.js` 中添加 `getEntitiesForChunk(cx, cz)` 方法。放在 `clearAll()` 方法之前（约 line 455 附近）。

```js
// src/actors/minecart/MinecartManager.js — 添加在 clearAll() 之前

/**
 * 收集指定 chunk 内的所有矿车快照数据。
 * @param {number} cx - chunk X 坐标
 * @param {number} cz - chunk Z 坐标
 * @returns {Array<object>} — minecart.toJSON() 返回的完整序列化数据
 */
getEntitiesForChunk(cx, cz) {
  const result = [];
  for (const minecart of this.minecarts.values()) {
    const mcx = Math.floor(minecart.position.x / CHUNK_SIZE);
    const mcz = Math.floor(minecart.position.z / CHUNK_SIZE);
    if (mcx === cx && mcz === cz) {
      result.push(minecart.toJSON());
    }
  }
  return result;
}
```

同样需要确认 `CHUNK_SIZE` 是否已导入。如没有，添加：

```js
import { CHUNK_SIZE } from '../../constants/GameConfig.js';
```

- [ ] **Step 4: 验证 CHUNK_SIZE 导入**

在三个文件中分别确认 `CHUNK_SIZE` 已正确导入。如果某个文件已有该导入（可能来自 `../../constants/GameConfig.js`），则不要重复添加。

运行 lint 检查：

```bash
npm run lint
```

确认新增代码无 lint 错误。

- [ ] **Step 5: Commit**

```bash
git add src/actors/turret/TurretManager.js src/actors/zombie-nest/ZombieNestManager.js src/actors/minecart/MinecartManager.js
git commit -m "feat(runtime-entities): add getEntitiesForChunk to turret, zombie nest, and minecart managers

Phase 2: unified persistence path — each manager can now serialize
its entities scoped to a specific chunk for flushBeforeUnload."
```

---

### Task 2: PersistenceService 新增 `workerGetChunkData` 方法

**Files:**
- Modify: `src/services/PersistenceService.js`

为渐进式迁移提供从 `world_deltas` 表读取数据的能力。当前 `getChunkData` 方法已存在（line 79），但它是通过 Worker 调用的。新增一个明确用于渐进迁移的方法。

- [ ] **Step 1: 添加 `workerGetChunkData` 方法**

在 `PersistenceService.js` 的 `injectSaveData` 方法之前（约 line 270 附近）添加：

```js
// src/services/PersistenceService.js — 添加在 injectSaveData 之前

/**
 * 从 world_deltas 表读取指定 chunk 的完整数据（包含 blocks 和 entities）。
 * 仅用于渐进式迁移：当 chunkRecord 不含 runtimeEntities 时，从此方法
 * 获取旧格式的 entities 数据。
 * @param {number} cx
 * {number} cz
 * @returns {Promise<{blocks?: object, entities?: {turrets?: Array, zombieNests?: Array, minecarts?: Array}}|null>}
 */
async workerGetChunkData(cx, cz) {
  await this.initPromise;
  const key = `${cx},${cz}`;
  return this.rpc.getChunkData(key);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/PersistenceService.js
git commit -m "feat(runtime-entities): add workerGetChunkData for progressive migration

Phase 2: allows reading entities from world_deltas store during
chunk load when chunkRecord.runtimeEntities is missing."
```

---

### Task 3: WorldRuntime 修改 `flushBeforeUnload` 并添加 entity 收集方法

**Files:**
- Modify: `src/world/WorldRuntime.js`

- [ ] **Step 1: 修改 `flushBeforeUnload` 方法签名**

打开 `src/world/WorldRuntime.js`，找到 `flushBeforeUnload` 方法（约 line 262）。将方法从：

```js
// src/world/WorldRuntime.js — 修改前（约 line 262-277）
async flushBeforeUnload(cx, cz, blockDataSnapshot) {
  const key = this.worldStore.chunkKey(cx, cz);
  const chunk = this._world?.chunks?.get(key);

  const record = {
    blockData: blockDataSnapshot || (chunk ? this._serializeBlockData(chunk.blockData) : {}),
    staticEntities: chunk?.staticEntities ? [...chunk.staticEntities] : [],
    runtimeSeedData: chunk?.structureCenters
      ? { structureCenters: chunk.structureCenters }
      : { structureCenters: [] }
  };

  await this.worldStore.putChunkRecord(cx, cz, record);
  this.dirtyChunks.delete(key);
}
```

改为：

```js
// src/world/WorldRuntime.js — 修改后
async flushBeforeUnload(cx, cz, blockDataSnapshot, entitiesSnapshot) {
  const key = this.worldStore.chunkKey(cx, cz);
  const chunk = this._world?.chunks?.get(key);

  const entities = entitiesSnapshot
    || (this._game ? this._collectEntitiesForChunk(cx, cz) : null)
    || { turrets: [], zombieNests: [], minecarts: [] };

  const record = {
    blockData: blockDataSnapshot || (chunk ? this._serializeBlockData(chunk.blockData) : {}),
    staticEntities: chunk?.staticEntities ? [...chunk.staticEntities] : [],
    runtimeSeedData: chunk?.structureCenters
      ? { structureCenters: chunk.structureCenters }
      : { structureCenters: [] },
    runtimeEntities: entities
  };

  await this.worldStore.putChunkRecord(cx, cz, record);
  this.dirtyChunks.delete(key);
}
```

- [ ] **Step 2: 添加 `_collectEntitiesForChunk` 方法**

在 `flushBeforeUnload` 方法之后（约 line 278 附近）添加：

```js
// src/world/WorldRuntime.js — 添加在 flushBeforeUnload 之后

/**
 * 从三个特殊实体 manager 收集指定 chunk 的实体快照。
 */
_collectEntitiesForChunk(cx, cz) {
  const game = this._game;
  if (!game) return { turrets: [], zombieNests: [], minecarts: [] };

  return {
    turrets: game.turretManager?.getEntitiesForChunk?.(cx, cz) || [],
    zombieNests: game.zombieNestManager?.getEntitiesForChunk?.(cx, cz) || [],
    minecarts: game.minecartManager?.getEntitiesForChunk?.(cx, cz) || []
  };
}
```

- [ ] **Step 3: 确认 `this._game` 赋值**

检查 `WorldRuntime.js` 的构造函数（约 line 19-25），确认 `this._game` 是否已被赋值。如果没有，需要在构造函数中添加 `this._game = null;` 并在 `WorldRuntime.init(world, game)` 中设置 `this._game = game;`。

查看构造函数的当前实现。如果构造函数接受 `game` 参数或通过 `init` 方法设置，则不需要额外修改。否则添加：

```js
// 在构造函数中添加
this._game = null;

// 在 init(world, game) 方法中设置
this._game = game;
```

- [ ] **Step 4: 修改 `ensureChunkData` 调用渐进迁移**

打开 `ensureChunkData` 方法（约 line 73-120）。在方法末尾、返回 `chunkRecord` 之前，添加渐进迁移检查：

在 `ensureChunkData` 方法的末尾（返回 `chunkRecord` 之前），找到类似这样的代码：

```js
return { status: 'loaded', chunkRecord };
```

在其之前添加：

```js
// 渐进式迁移：如果 chunkRecord 不含 runtimeEntities，尝试从 world_deltas 迁移
if (!chunkRecord.runtimeEntities) {
  await this._ensureChunkEntitiesMigrated(cx, cz, chunkRecord);
}
```

- [ ] **Step 5: 添加 `_ensureChunkEntitiesMigrated` 方法**

在 `_collectEntitiesForChunk` 方法之后添加：

```js
// src/world/WorldRuntime.js — 添加在 _collectEntitiesForChunk 之后

/**
 * 渐进式迁移：当 chunkRecord 不含 runtimeEntities 时，从 world_deltas 表读取
 * entities 并回填到 worldStore。
 */
async _ensureChunkEntitiesMigrated(cx, cz, chunkRecord) {
  const persistence = getPersistenceService();
  if (!persistence) {
    chunkRecord.runtimeEntities = { turrets: [], zombieNests: [], minecarts: [] };
    return;
  }

  const legacyData = await persistence.workerGetChunkData(cx, cz);

  if (legacyData?.entities) {
    chunkRecord.runtimeEntities = legacyData.entities;
    // 回填到 worldStore
    await this.worldStore.putChunkRecord(cx, cz, chunkRecord);
    console.log(`[WorldRuntime] migrated runtime entities for chunk ${cx},${cz}`);
  } else {
    // world_deltas 中也没有，创建空结构
    chunkRecord.runtimeEntities = { turrets: [], zombieNests: [], minecarts: [] };
  }
}
```

确认文件顶部有 `getPersistenceService` 的导入。如果没有，添加：

```js
import { getPersistenceService } from '../services/PersistenceService.js';
```

- [ ] **Step 6: Commit**

```bash
git add src/world/WorldRuntime.js
git commit -m "feat(runtime-entities): WorldRuntime writes runtimeEntities on flush, supports progressive migration

Phase 2: flushBeforeUnload now collects entities from three managers
and includes runtimeEntities in ChunkRecord. ensureChunkData triggers
progressive migration from world_deltas when runtimeEntities is missing."
```

---

### Task 4: Chunk.js 修改 `loadFromRecord` 读取 runtimeEntities

**Files:**
- Modify: `src/world/Chunk.js`

- [ ] **Step 1: 修改 `loadFromRecord` 中的 runtime entities 读取逻辑**

打开 `src/world/Chunk.js`，找到 `loadFromRecord` 方法（约 line 282-355）。定位到读取 runtime entities 的部分（约 lines 327-345），将当前代码：

```js
// src/world/Chunk.js — 修改前（约 lines 327-345）
const persistence = getPersistenceService();
const cacheEntry = persistence?.cache?.get(chunkKey);
const entities = cacheEntry?.entities || {};

this.pendingRuntimeEntities = {
  zombieNests: entities.zombieNests || [],
  turrets: entities.turrets || [],
  minecarts: entities.minecarts || []
};
```

改为：

```js
// src/world/Chunk.js — 修改后
this.pendingRuntimeEntities = {
  zombieNests: [],
  turrets: [],
  minecarts: []
};

this._needsEntityMigration = false;

if (chunkRecord.runtimeEntities) {
  // 新格式：直接从 chunkRecord 读取
  this.pendingRuntimeEntities = {
    zombieNests: chunkRecord.runtimeEntities.zombieNests || [],
    turrets: chunkRecord.runtimeEntities.turrets || [],
    minecarts: chunkRecord.runtimeEntities.minecarts || []
  };
} else {
  // 旧格式兼容：从 cache.entities 读取，标记需要渐进迁移
  const persistence = getPersistenceService();
  const cacheEntry = persistence?.cache?.get(chunkKey);
  const entities = cacheEntry?.entities || {};
  this.pendingRuntimeEntities = {
    zombieNests: entities.zombieNests || [],
    turrets: entities.turrets || [],
    minecarts: entities.minecarts || []
  };
  this._needsEntityMigration = true;
}
```

- [ ] **Step 2: 修改 `finalizeNonDeferredPhase` 触发渐进迁移**

打开 `finalizeNonDeferredPhase` 方法（约 line 1820-1855）。在方法开头、任何实体恢复逻辑之前（约 line 1825 附近），添加：

```js
// src/world/Chunk.js — 在 finalizeNonDeferredPhase 开头添加
if (this._needsEntityMigration) {
  const worldRuntime = this.world?.worldRuntime;
  if (worldRuntime) {
    const chunkRecord = {
      blockData: {},
      staticEntities: [],
      runtimeSeedData: { structureCenters: [] },
      runtimeEntities: null
    };
    await worldRuntime._ensureChunkEntitiesMigrated(this.cx, this.cz, chunkRecord);
    if (chunkRecord.runtimeEntities) {
      this.pendingRuntimeEntities = {
        zombieNests: chunkRecord.runtimeEntities.zombieNests || [],
        turrets: chunkRecord.runtimeEntities.turrets || [],
        minecarts: chunkRecord.runtimeEntities.minecarts || []
      };
    }
  }
  this._needsEntityMigration = false;
}
```

注意：`finalizeNonDeferredPhase` 当前可能是同步方法。由于渐进迁移需要 async 操作，需要将该方法改为 `async`。修改方法签名：

```js
// 修改前
finalizeNonDeferredPhase() {
// 修改后
async finalizeNonDeferredPhase() {
```

同时需要检查所有调用 `finalizeNonDeferredPhase` 的地方，确保它们 `await` 该方法。主要调用点在 `loadFromRecord` 末尾（约 line 354），将：

```js
this.finalizeNonDeferredPhase();
```

改为：

```js
await this.finalizeNonDeferredPhase();
```

- [ ] **Step 3: 运行 lint 检查**

```bash
npm run lint
```

确认无新增 lint 错误。

- [ ] **Step 4: Commit**

```bash
git add src/world/Chunk.js
git commit -m "feat(runtime-entities): Chunk.loadFromRecord reads runtimeEntities with progressive migration

Phase 2: prefers chunkRecord.runtimeEntities (new format), falls back
to cache.entities (old format) and triggers migration. finalizeNonDeferredPhase
is now async to support the migration step."
```

---

### Task 5: World.js 修改 chunk unload 路径传入 entities

**Files:**
- Modify: `src/world/World.js`

- [ ] **Step 1: 修改 `World.update()` 中的 chunk unload 路径**

打开 `src/world/World.js`，找到 chunk unload 部分（约 lines 801-835）。定位到 `flushBeforeUnload` 调用处（约 line 813-817），将：

```js
// src/world/World.js — 修改前
this.worldRuntime.flushBeforeUnload(cx, cz, chunk.blockData);
```

改为：

```js
// src/world/World.js — 修改后
const entities = this._collectRuntimeEntitiesForChunk(chunk);
this.worldRuntime.flushBeforeUnload(cx, cz, chunk.blockData, entities);
```

- [ ] **Step 2: 添加 `_collectRuntimeEntitiesForChunk` 方法**

在 `World.js` 中合适的位置（约 line 840 附近，在 `update` 方法之后）添加：

```js
// src/world/World.js — 添加在 update 方法之后

/**
 * 收集指定 chunk 的 runtime entities 快照，用于 chunk unload 时持久化。
 */
_collectRuntimeEntitiesForChunk(chunk) {
  return {
    turrets: this.turretManager?.getEntitiesForChunk?.(chunk.cx, chunk.cz) || [],
    zombieNests: this.zombieNestManager?.getEntitiesForChunk?.(chunk.cx, chunk.cz) || [],
    minecarts: this.minecartManager?.getEntitiesForChunk?.(chunk.cx, chunk.cz) || []
  };
}
```

- [ ] **Step 3: 运行 lint 检查**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/world/World.js
git commit -m "feat(runtime-entities): World.update collects and passes entities on chunk unload

Phase 2: chunk unload path now includes runtime entities snapshot
in flushBeforeUnload, ensuring they are written to worldStore."
```

---

### Task 6: Game.js 修改 `collectSnapshot` 从 worldStore 读取

**Files:**
- Modify: `src/core/Game.js`

- [ ] **Step 1: 修改 `collectSnapshot` 方法**

打开 `src/core/Game.js`，找到 `collectSnapshot` 方法（约 lines 583-617）。将当前从 `persistenceService.cache` 读取的逻辑：

```js
// src/core/Game.js — 修改前（约 lines 583-617）
collectSnapshot() {
  const playerSnapshot = {
    x: this.player.position.x,
    y: this.player.position.y,
    z: this.player.position.z,
    pitch: this.player.pitch,
    yaw: this.player.yaw
  };

  const worldDeltas = [];
  for (const [key, data] of persistenceService.cache.entries()) {
    if (!data) continue;
    worldDeltas.push({ key, ...data });
  }

  return {
    player: playerSnapshot,
    worldDeltas,
    seed: this.seed,
    settings: { ...this.settings }
  };
}
```

改为：

```js
// src/core/Game.js — 修改后
collectSnapshot() {
  const playerSnapshot = {
    x: this.player.position.x,
    y: this.player.position.y,
    z: this.player.position.z,
    pitch: this.player.pitch,
    yaw: this.player.yaw
  };

  const worldDeltas = [];
  for (const [key, chunk] of this.world.chunks.entries()) {
    const record = this.world.worldStore.getChunkRecord(chunk.cx, chunk.cz);
    if (!record) continue;
    worldDeltas.push({
      key,
      blocks: record.blockData,
      entities: record.runtimeEntities || {}
    });
  }

  return {
    player: playerSnapshot,
    worldDeltas,
    seed: this.seed,
    settings: { ...this.settings }
  };
}
```

注意：`getChunkRecord` 是 async 方法。但 `collectSnapshot` 当前可能是同步的。需要将其改为 async：

```js
// 方法签名改为
async collectSnapshot() {
```

同时修改调用处 `saveToDisk`（约 lines 573-577）：

```js
// 修改前
async saveToDisk() {
  const snapshot = this.collectSnapshot();
  await manualSaveService.save(snapshot);
}

// 修改后
async saveToDisk() {
  const snapshot = await this.collectSnapshot();
  await manualSaveService.save(snapshot);
}
```

- [ ] **Step 2: 运行 lint 检查**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/core/Game.js
git commit -m "feat(runtime-entities): Game.collectSnapshot reads from worldStore instead of cache

Phase 2: manual save now uses worldStore as the authoritative source
for chunk data, including runtimeEntities."
```

---

### Task 7: 更新测试

**Files:**
- Modify: `src/tests/test-runtime-session-persistence.js`

- [ ] **Step 1: 添加渐进迁移测试**

在 `src/tests/test-runtime-session-persistence.js` 文件末尾（约 line 245 之后）添加新的测试：

```js
// src/tests/test-runtime-session-persistence.js — 添加在文件末尾

describe('渐进式迁移: chunkRecord 不含 runtimeEntities 时从 world_deltas 迁移', () => {
  test('loadFromRecord 应从 chunkRecord.runtimeEntities 读取新格式数据', async () => {
    const service = createTestService();
    const chunk = new Chunk(0, 0);

    // 模拟 chunkRecord 包含新格式的 runtimeEntities
    const chunkRecord = {
      blockData: {},
      staticEntities: [],
      runtimeSeedData: { structureCenters: [] },
      runtimeEntities: {
        turrets: [{ id: 't1', position: { x: 8, y: 4, z: 8 }, rotation: { yaw: 0, pitch: 0 } }],
        zombieNests: [],
        minecarts: []
      }
    };

    await chunk.loadFromRecord(chunkRecord);

    assertTrue(chunk.pendingRuntimeEntities.turrets.length === 1, '应从 runtimeEntities 读取炮塔');
    assertTrue(chunk.pendingRuntimeEntities.turrets[0].id === 't1', '炮塔 id 应正确');
    assertTrue(!chunk._needsEntityMigration, '不应标记需要迁移');
  });

  test('loadFromRecord 应回退到 cache.entities 并标记迁移', async () => {
    const service = createTestService();
    const chunk = new Chunk(0, 0);

    // 确保 cache 中有 entities 数据
    service.ensureChunkSnapshot('0,0');
    service.cache.get('0,0').entities = {
      turrets: [{ id: 't2', position: { x: 5, y: 3, z: 5 }, rotation: { yaw: 1, pitch: 0 } }],
      zombieNests: [],
      minecarts: []
    };

    // chunkRecord 不含 runtimeEntities（旧格式）
    const chunkRecord = {
      blockData: {},
      staticEntities: [],
      runtimeSeedData: { structureCenters: [] }
    };

    await chunk.loadFromRecord(chunkRecord);

    assertTrue(chunk.pendingRuntimeEntities.turrets.length === 1, '应从 cache.entities 读取炮塔');
    assertTrue(chunk.pendingRuntimeEntities.turrets[0].id === 't2', '炮塔 id 应正确');
    assertTrue(chunk._needsEntityMigration, '应标记需要迁移');
  });

  test('chunkRecord.runtimeEntities 应优先于 cache.entities', async () => {
    const service = createTestService();
    const chunk = new Chunk(0, 0);

    // cache 中有旧数据
    service.ensureChunkSnapshot('0,0');
    service.cache.get('0,0').entities = {
      turrets: [{ id: 'old', position: { x: 1, y: 1, z: 1 }, rotation: { yaw: 0, pitch: 0 } }],
      zombieNests: [],
      minecarts: []
    };

    // chunkRecord 中有新数据
    const chunkRecord = {
      blockData: {},
      staticEntities: [],
      runtimeSeedData: { structureCenters: [] },
      runtimeEntities: {
        turrets: [{ id: 'new', position: { x: 2, y: 2, z: 2 }, rotation: { yaw: 0, pitch: 0 } }],
        zombieNests: [],
        minecarts: []
      }
    };

    await chunk.loadFromRecord(chunkRecord);

    assertTrue(chunk.pendingRuntimeEntities.turrets.length === 1, '应只读取 runtimeEntities');
    assertTrue(chunk.pendingRuntimeEntities.turrets[0].id === 'new', '应使用 chunkRecord.runtimeEntities 的数据');
    assertTrue(!chunk._needsEntityMigration, '不应标记需要迁移');
  });
});
```

- [ ] **Step 2: 运行测试**

启动开发服务器后访问 `http://localhost:8080/src/tests/index.html`，运行所有测试，确认新增测试通过且现有测试未被破坏。

- [ ] **Step 3: 运行 lint 检查**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/tests/test-runtime-session-persistence.js
git commit -m "test(runtime-entities): add progressive migration tests for loadFromRecord

Phase 2: verify new format reading, old format fallback with migration
flag, and new format priority over cache.entities."
```

---

### Task 8: 手动回归验证

无需代码变更。按以下步骤手动验证：

- [ ] **Step 1: 铁轨回归**

启动开发服务器 `npm run start`，放置直轨/弯轨，跑远卸载 chunk，返回确认铁轨仍在。

- [ ] **Step 2: 炮塔回归**

放置炮塔，跑远卸载 chunk，返回确认底座/柱子/炮塔头都在且能开火。

- [ ] **Step 3: 丧尸巢穴回归**

放置巢穴，跑远卸载，返回确认结构还在且刷怪节奏不重置。

- [ ] **Step 4: 矿车回归**

放置铁轨和矿车（静止/运动各一次），跑远卸载，返回确认位置正确。

- [ ] **Step 5: 跨重启测试**

放置实体 → 关闭页面 → 重新打开 → 确认所有实体存在且功能正常。

- [ ] **Step 6: 手动存档测试**

放置实体 → 手动存档 → 刷新页面 → 加载存档 → 确认实体正确恢复。
