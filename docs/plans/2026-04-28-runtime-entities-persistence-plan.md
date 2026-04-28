# Runtime Entities Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate turret, minecart, and zombie nest persistence from the old `persistenceService.cache` to WorldStore `RegionRecord.runtimeEntities`, ensuring entities survive chunk unload/reload cycles.

**Architecture:** Add a `runtimeEntities` field to `RegionRecord.chunks[cx,cz]`. Entity managers write via `worldStore.putChunkRecord()`. Chunk reads via `getChunkRecord()` → `pendingRuntimeEntities` → `finalizeNonDeferredPhase()` restores instances.

**Tech Stack:** JavaScript (ES Modules), IndexedDB via PersistenceWorker, WorldStore/RegionRecord architecture

---

### Task 1: WorldStore — 在 getChunkRecord/putChunkRecord 中支持 runtimeEntities

**Files:**
- Modify: `src/world/WorldStore.js:124-165`
- Test: 浏览器中验证

**Step 1: 修改 getChunkRecord 返回值**

在 `src/world/WorldStore.js` 的 `getChunkRecord` 方法（约第124行）中，返回对象增加 `runtimeEntities` 字段：

```javascript
// 当前返回：
return {
  cx,
  cz,
  blockData: chunkData.blockData || {},
  staticEntities: chunkData.staticEntities || [],
  runtimeSeedData: chunkData.runtimeSeedData || {}
};

// 修改为：
return {
  cx,
  cz,
  blockData: chunkData.blockData || {},
  staticEntities: chunkData.staticEntities || [],
  runtimeEntities: chunkData.runtimeEntities || null,
  runtimeSeedData: chunkData.runtimeSeedData || {}
};
```

同样修改 `getChunkRecordsInRegion` 方法（约第147行）中对应的返回对象，也增加 `runtimeEntities` 字段。

**Step 2: 修改 putChunkRecord 接受 runtimeEntities**

`putChunkRecord` 方法（约第178行）直接接收 `chunkRecord` 对象并写入 `region.chunks[key] = chunkRecord`。由于是全对象覆盖写入，只要调用方传入 `runtimeEntities` 字段，自动就会被保存。**无需修改代码**，只需要在文档中确认该字段会被透传。

**Step 3: 确认无需改动**

- `saveRegionRecord` 和 `saveRegionRecordsBatch` 是直接序列化整个 region 对象，`runtimeEntities` 自动包含
- PersistenceWorker 的 `saveRegionRecord` handler 也是直接 `store.put({ regionKey, data: record })`，自动序列化所有字段

**Step 4: Commit**

```bash
git add src/world/WorldStore.js
git commit -m "feat(worldstore): add runtimeEntities field to getChunkRecord projection"
```

---

### Task 2: Chunk — 从 worldStore 读取 runtimeEntities 替代旧 cache 路径

**Files:**
- Modify: `src/world/Chunk.js:282-346` (loadFromRecord 方法)

**Step 1: 修改 loadFromRecord 中的 runtimeEntities 读取逻辑**

在 `src/world/Chunk.js` 的 `loadFromRecord` 方法中（约第315-336行），将旧 cache 路径替换为从 `chunkRecord.runtimeEntities` 读取：

```javascript
// 当前代码（第315-336行）：
// 从持久化缓存中恢复运行时实体数据（炮塔、矿车、丧尸巢穴）
const persistence = getPersistenceService();
const chunkKey = `${this.cx},${this.cz}`;
const existingData = persistence?.cache?.get?.(chunkKey);
if (existingData?.entities) {
  this.pendingSnapshot.entities = {
    ...this.pendingSnapshot.entities,
    ...existingData.entities
  };
  const entities = this.pendingSnapshot.entities;
  if (
    (Array.isArray(entities.zombieNests) && entities.zombieNests.length > 0) ||
    (Array.isArray(entities.turrets) && entities.turrets.length > 0) ||
    (Array.isArray(entities.minecarts) && entities.minecarts.length > 0)
  ) {
    this.pendingRuntimeEntities = {
      zombieNests: entities.zombieNests || [],
      turrets: entities.turrets || [],
      minecarts: entities.minecarts || []
    };
  }
}

// 替换为：
// 从 WorldStore runtimeEntities 恢复运行时实体数据
const runtimeEntities = chunkRecord.runtimeEntities;
if (runtimeEntities && typeof runtimeEntities === 'object') {
  const zombieNests = Array.isArray(runtimeEntities.zombieNests) ? runtimeEntities.zombieNests : [];
  const turrets = Array.isArray(runtimeEntities.turrets) ? runtimeEntities.turrets : [];
  const minecarts = Array.isArray(runtimeEntities.minecarts) ? runtimeEntities.minecarts : [];
  if (zombieNests.length > 0 || turrets.length > 0 || minecarts.length > 0) {
    this.pendingRuntimeEntities = { zombieNests, turrets, minecarts };
  }
}
```

**Step 2: Commit**

```bash
git add src/world/Chunk.js
git commit -m "feat(chunk): read runtimeEntities from worldStore instead of old persistence cache"
```

---

### Task 3: TurretManager — 写入路径迁移到 WorldStore

**Files:**
- Modify: `src/actors/turret/TurretManager.js:80-157` (ensureChunkSnapshot, saveTurretToSnapshot, removeTurretFromSnapshot)
- Test: 浏览器中放置/销毁炮塔，刷新页面验证炮塔保留

**Step 1: 添加 worldStore 注入**

在 TurretManager 的 `getPersistenceService` 方法之后添加 `getWorldStore` 方法：

```javascript
/**
 * 获取 worldStore（优先测试注入）
 * @returns {object|null}
 */
getWorldStore() {
  return globalThis._worldStore || this.world?.worldStore || null;
}
```

**Step 2: 替换 saveTurretToSnapshot**

替换现有 `saveTurretToSnapshot` 方法（约第119-135行）：

```javascript
/**
 * 将炮塔写入 WorldStore
 * @param {Turret} turret
 * @returns {void}
 */
async saveTurretToSnapshot(turret) {
  const worldStore = this.getWorldStore();
  if (!worldStore) return;
  const entry = this.toTurretSnapshot(turret);
  if (!entry) return;

  const cx = Math.floor(entry.position.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
  const cz = Math.floor(entry.position.z / PERSISTENCE_CONFIG.CHUNK_SIZE);

  // 读取当前 chunkRecord（包含已有的 runtimeEntities）
  const chunkRecord = await worldStore.getChunkRecord(cx, cz);
  if (!chunkRecord) return;

  // 初始化 runtimeEntities
  if (!chunkRecord.runtimeEntities) chunkRecord.runtimeEntities = {};
  if (!Array.isArray(chunkRecord.runtimeEntities.turrets)) {
    chunkRecord.runtimeEntities.turrets = [];
  }

  // 更新或添加
  const posKey = this.getPositionKey(entry.position);
  const list = chunkRecord.runtimeEntities.turrets;
  const idx = list.findIndex(item => this.getPositionKey(item.position) === posKey);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  // 写回
  await worldStore.putChunkRecord(cx, cz, chunkRecord);
}
```

**Step 3: 替换 removeTurretFromSnapshot**

替换现有 `removeTurretFromSnapshot` 方法（约第142-157行）：

```javascript
/**
 * 从 WorldStore 中移除炮塔
 * @param {Turret} turret
 * @returns {void}
 */
async removeTurretFromSnapshot(turret) {
  const worldStore = this.getWorldStore();
  if (!worldStore) return;
  const entry = this.toTurretSnapshot(turret);
  if (!entry) return;

  const cx = Math.floor(entry.position.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
  const cz = Math.floor(entry.position.z / PERSISTENCE_CONFIG.CHUNK_SIZE);

  const chunkRecord = await worldStore.getChunkRecord(cx, cz);
  if (!chunkRecord?.runtimeEntities?.turrets) return;

  const posKey = this.getPositionKey(entry.position);
  chunkRecord.runtimeEntities.turrets = chunkRecord.runtimeEntities.turrets.filter(
    item => this.getPositionKey(item.position) !== posKey
  );

  await worldStore.putChunkRecord(cx, cz, chunkRecord);
}
```

**Step 4: 移除 ensureChunkSnapshot 和旧的 cache 相关方法**

删除 `ensureChunkSnapshot` 方法（约第84-98行），不再需要。保留 `getPersistenceService` 方法（可能其他地方还有引用）。

**Step 5: 更新 createTurret 中的 persist 调用**

`createTurret` 方法（约第208行）中 `this.saveTurretToSnapshot(turret)` 现在是 async 方法，但不需要 await（fire-and-forget 异步写入）：

```javascript
// 保持不变，因为 saveTurretToSnapshot 内部已经是异步的
// 不需要添加 await，避免阻塞主线程
if (shouldPersist) {
  this.saveTurretToSnapshot(turret);
}
```

**Step 6: Run lint**

```bash
npm run lint
```

**Step 7: Commit**

```bash
git add src/actors/turret/TurretManager.js
git commit -m "feat(turret): migrate persistence to WorldStore runtimeEntities"
```

---

### Task 4: MinecartManager — 写入路径迁移到 WorldStore

**Files:**
- Modify: `src/actors/minecart/MinecartManager.js:286-350` (ensureChunkSnapshot, saveMinecartToSnapshot, removeMinecartFromSnapshot)
- Test: 浏览器中放置/拾取矿车，刷新页面验证矿车保留

**Step 1: 添加 worldStore 注入**

在 MinecartManager 的 `getPersistenceService` 方法之后添加：

```javascript
/**
 * 获取 worldStore（优先测试注入）
 * @returns {object|null}
 */
getWorldStore() {
  return globalThis._worldStore || this.world?.worldStore || null;
}
```

**Step 2: 替换 saveMinecartToSnapshot**

替换现有方法（约第306-326行）：

```javascript
/**
 * 将矿车写入 WorldStore
 * @param {Minecart} minecart
 */
async saveMinecartToSnapshot(minecart) {
  const worldStore = this.getWorldStore();
  if (!worldStore) return;

  const entry = minecart.toJSON();
  const chunkKey = this.getChunkKeyByPosition(entry);
  const [cx, cz] = chunkKey.split(',').map(Number);

  const chunkRecord = await worldStore.getChunkRecord(cx, cz);
  if (!chunkRecord) return;

  if (!chunkRecord.runtimeEntities) chunkRecord.runtimeEntities = {};
  if (!Array.isArray(chunkRecord.runtimeEntities.minecarts)) {
    chunkRecord.runtimeEntities.minecarts = [];
  }

  const list = chunkRecord.runtimeEntities.minecarts;
  const posKey = this.getPositionKey(entry);
  const idx = list.findIndex(item => this.getPositionKey(item) === posKey);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  await worldStore.putChunkRecord(cx, cz, chunkRecord);
}
```

**Step 3: 替换 removeMinecartFromSnapshot**

替换现有方法（约第332-350行）：

```javascript
/**
 * 从 WorldStore 中移除矿车
 * @param {Minecart} minecart
 */
async removeMinecartFromSnapshot(minecart) {
  const worldStore = this.getWorldStore();
  if (!worldStore) return;

  const entry = minecart.toJSON();
  const chunkKey = this.getChunkKeyByPosition(entry);
  const [cx, cz] = chunkKey.split(',').map(Number);

  const chunkRecord = await worldStore.getChunkRecord(cx, cz);
  if (!chunkRecord?.runtimeEntities?.minecarts) return;

  const posKey = this.getPositionKey(entry);
  chunkRecord.runtimeEntities.minecarts = chunkRecord.runtimeEntities.minecarts.filter(
    item => this.getPositionKey(item) !== posKey
  );

  await worldStore.putChunkRecord(cx, cz, chunkRecord);
}
```

**Step 4: 删除 ensureChunkSnapshot 方法**

删除 `ensureChunkSnapshot` 方法（约第286-300行）。

**Step 5: 在 restoreMinecartsForChunk 中加入 UUID 全局去重**

修改 `restoreMinecartsForChunk` 方法（约第359行），在循环开头增加 `id` 去重检查，防止矿车跨 chunk 移动后重复恢复：

```javascript
for (const item of minecarts) {
  if (!item?.position) continue;

  // UUID 全局去重：跨 chunk 移动时，旧 chunk 和新 chunk 可能同时保有同一矿车记录
  if (item.id && this.minecarts.has(item.id)) continue;

  if (this.getChunkKeyByPosition(item.position) !== currentChunkKey) continue;

  // 原有位置去重保留（防止同一 chunk 内重复记录）
  const posKey = this.getPositionKey(item.position);
  if (this.positionIndex.has(posKey)) continue;

  // ...后续恢复逻辑不变
}
```

**Step 6: Run lint**

```bash
npm run lint
```

**Step 7: Commit**

```bash
git add src/actors/minecart/MinecartManager.js
git commit -m "feat(minecart): migrate persistence to WorldStore runtimeEntities"
```

---

### Task 5: ZombieNestManager — 写入路径迁移到 WorldStore

**Files:**
- Modify: `src/actors/zombie-nest/ZombieNestManager.js:100-177` (ensureChunkSnapshot, saveNestToSnapshot, removeNestFromSnapshot)
- Test: 浏览器中放置/销毁巢穴，刷新页面验证巢穴保留

**Step 1: 添加 worldStore 注入**

```javascript
/**
 * 获取 worldStore（优先测试注入）
 * @returns {object|null}
 */
getWorldStore() {
  return globalThis._worldStore || this.world?.worldStore || null;
}
```

**Step 2: 替换 saveNestToSnapshot**

替换现有方法（约第139-155行）：

```javascript
/**
 * 将巢穴写入 WorldStore
 * @param {ZombieNest} nest
 * @returns {void}
 */
async saveNestToSnapshot(nest) {
  const worldStore = this.getWorldStore();
  if (!worldStore) return;
  const entry = this.toNestSnapshot(nest);
  if (!entry) return;

  const cx = Math.floor(entry.position.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
  const cz = Math.floor(entry.position.z / PERSISTENCE_CONFIG.CHUNK_SIZE);

  const chunkRecord = await worldStore.getChunkRecord(cx, cz);
  if (!chunkRecord) return;

  if (!chunkRecord.runtimeEntities) chunkRecord.runtimeEntities = {};
  if (!Array.isArray(chunkRecord.runtimeEntities.zombieNests)) {
    chunkRecord.runtimeEntities.zombieNests = [];
  }

  const list = chunkRecord.runtimeEntities.zombieNests;
  const posKey = this.getPositionKey(entry.position);
  const idx = list.findIndex(item => this.getPositionKey(item.position) === posKey);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  await worldStore.putChunkRecord(cx, cz, chunkRecord);
}
```

**Step 3: 替换 removeNestFromSnapshot**

替换现有方法（约第162-177行）：

```javascript
/**
 * 从 WorldStore 中移除巢穴
 * @param {ZombieNest} nest
 * @returns {void}
 */
async removeNestFromSnapshot(nest) {
  const worldStore = this.getWorldStore();
  if (!worldStore) return;
  const entry = this.toNestSnapshot(nest);
  if (!entry) return;

  const cx = Math.floor(entry.position.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
  const cz = Math.floor(entry.position.z / PERSISTENCE_CONFIG.CHUNK_SIZE);

  const chunkRecord = await worldStore.getChunkRecord(cx, cz);
  if (!chunkRecord?.runtimeEntities?.zombieNests) return;

  const posKey = this.getPositionKey(entry.position);
  chunkRecord.runtimeEntities.zombieNests = chunkRecord.runtimeEntities.zombieNests.filter(
    item => this.getPositionKey(item.position) !== posKey
  );

  await worldStore.putChunkRecord(cx, cz, chunkRecord);
}
```

**Step 4: 删除 ensureChunkSnapshot 方法**

删除 `ensureChunkSnapshot` 方法（约第100-114行）。

**Step 5: Run lint**

```bash
npm run lint
```

**Step 6: Commit**

```bash
git add src/actors/zombie-nest/ZombieNestManager.js
git commit -m "feat(zombie-nest): migrate persistence to WorldStore runtimeEntities"
```

---

### Task 6: 验证与收尾

**Files:**
- No code changes
- Test: 浏览器内手动测试

**Step 1: 运行 lint 检查全部文件**

```bash
npm run lint
```

确保无新增警告。如有，简要修复。

**Step 2: 浏览器内验证 — 炮塔**

1. 启动开发服务器: `npm run start`
2. 访问 http://localhost:8080
3. 放置一个炮塔
4. 走远让炮塔所在 chunk 卸载，再走回来
5. 刷新页面，确认炮塔仍然存在
6. 检查 IndexedDB 中 `world_region_records` 表，确认对应 region 的 chunks 下有 `runtimeEntities.turrets` 数据

**Step 3: 浏览器内验证 — 矿车**

1. 放置铁轨和矿车
2. 让矿车移动（或等待它自动移动）
3. 走远再回来
4. 刷新页面，确认矿车保留

**Step 4: 浏览器内验证 — 丧尸巢穴**

1. 放置一个丧尸巢穴
2. 走远再回来
3. 刷新页面，确认巢穴保留且能正常刷怪

**Step 5: Commit (如有小修复)**

```bash
git add .
git commit -m "fix: address lint and minor issues from runtime entities migration"
```
