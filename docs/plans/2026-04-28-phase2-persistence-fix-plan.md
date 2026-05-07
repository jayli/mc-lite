# Phase 2 统一持久化路径 — 修复闭环

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 phase 2 实现中 6 个读取/写入链路的 bug，使 runtimeEntities 读写完整闭环。

**Architecture:** 最小闭环方案。只修复具体的 6 个代码缺陷，不改变整体架构。保留 phase 1 的 cache 双写现状。

**Tech Stack:** JavaScript, IndexedDB (worldStore), WorldRuntime, WorldStore

---

### Task 1: `WorldRuntime.ensureChunkData` 读取链路补上 runtimeEntities

**Files:**
- Modify: `src/world/WorldRuntime.js:90-101`

**Step 1: 修改 ensureChunkData 的 chunkRecord 构造**

将第 90-96 行的 `chunkRecord` 构造改为：

```js
const chunkRecord = {
  cx,
  cz,
  blockData: chunkData.blockData || {},
  staticEntities: chunkData.staticEntities || [],
  runtimeSeedData: chunkData.runtimeSeedData || {},
  runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] }
};
```

**Step 2: 简化迁移逻辑**

因为 `chunkRecord` 已经直接带上了 `runtimeEntities`，第 98-101 行的渐进迁移逻辑仍保留（当 `chunkData.runtimeEntities` 不存在时会触发），但需要在 chunkRecord 构造时就加上这个字段，所以迁移判断改为：

```js
// 渐进式迁移：如果 region record 中不含 runtimeEntities，尝试从 world_deltas 迁移
if (!chunkData.runtimeEntities) {
  await this._ensureChunkEntitiesMigrated(cx, cz, chunkRecord);
}
```

注意：判断条件从 `!chunkRecord.runtimeEntities` 改为 `!chunkData.runtimeEntities`，因为 `chunkRecord` 已经被赋了默认空对象。

**Step 3: 运行 lint**

Run: `npm run lint`

Expected: No errors.

---

### Task 2: `WorldStore.getChunkRecord` 和 `getChunkRecordsInRegion` 读取链路补上 runtimeEntities

**Files:**
- Modify: `src/world/WorldStore.js:131-137`
- Modify: `src/world/WorldStore.js:155-161`

**Step 1: 修改 getChunkRecord**

将第 131-137 行改为：

```js
return {
  cx,
  cz,
  blockData: chunkData.blockData || {},
  staticEntities: chunkData.staticEntities || [],
  runtimeSeedData: chunkData.runtimeSeedData || {},
  runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] }
};
```

**Step 2: 修改 getChunkRecordsInRegion**

将第 155-161 行改为：

```js
result.set(key, {
  cx,
  cz,
  blockData: chunkData.blockData || {},
  staticEntities: chunkData.staticEntities || [],
  runtimeSeedData: chunkData.runtimeSeedData || {},
  runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] }
});
```

**Step 3: 运行 lint**

Run: `npm run lint`

Expected: No errors.

---

### Task 3: `flushBeforeUnload` blockData 序列化修复

**Files:**
- Modify: `src/world/WorldRuntime.js:282-283`

**Step 1: 修改 flushBeforeUnload 中的 blockData 序列化**

将第 283 行：

```js
blockData: blockDataSnapshot || (chunk ? this._serializeBlockData(chunk.blockData) : {}),
```

改为：

```js
blockData: blockDataSnapshot ? this._serializeBlockData(blockDataSnapshot) : (chunk ? this._serializeBlockData(chunk.blockData) : {}),
```

确保无论哪种来源，写入 worldStore 的 blockData 都是 plain object。

**Step 2: 运行 lint**

Run: `npm run lint`

Expected: No errors.

---

### Task 4: `flushChunk` 定时 flush 路径补上 runtimeEntities

**Files:**
- Modify: `src/world/WorldRuntime.js:170-204`

**Step 1: 修改 flushChunk 方法**

将第 189-195 行的 putChunkRecord 调用改为：

```js
const entities = this._game ? this._collectEntitiesForChunk(cx, cz) : { turrets: [], zombieNests: [], minecarts: [] };

await this._worldStore.putChunkRecord(cx, cz, {
  blockData: this._serializeBlockData(blockData),
  staticEntities,
  runtimeSeedData,
  runtimeEntities: entities
});
```

**Step 2: 运行 lint**

Run: `npm run lint`

Expected: No errors.

---

### Task 5: `flushAllDirty` 批量 flush 路径补上 runtimeEntities

**Files:**
- Modify: `src/world/WorldRuntime.js:223-231`

**Step 1: 修改 flushAllDirty 中的 chunk 记录构造**

将第 226-230 行改为：

```js
const entities = this._game ? this._collectEntitiesForChunk(cx, cz) : { turrets: [], zombieNests: [], minecarts: [] };
group.chunks.set(key, {
  blockData: this._serializeBlockData(chunk.blockData),
  staticEntities: chunk.staticEntities || [],
  runtimeSeedData: chunk.runtimeSeedData || {},
  runtimeEntities: entities
});
```

**Step 2: 运行 lint**

Run: `npm run lint`

Expected: No errors.

---

### Task 6: 运行测试并验证

**Files:**
- Check: `src/tests/test-world.js`
- Check: `src/tests/test-runtime-session-persistence.js`

**Step 1: 启动开发服务器**

Run: `npm run start`

Expected: Server starts on port 8080.

**Step 2: 访问测试页面**

Open: `http://localhost:8080/src/tests/index.html`

Run all tests. Expected: All pass.

**Step 3: 手动验证关键场景**

在浏览器中：
1. 放置炮塔 → 跑远卸载 chunk → 返回确认炮塔仍在且能开火
2. 放置丧尸巢穴 → 跑远卸载 → 返回确认结构完整且刷怪节奏不重置
3. 放置矿车和铁轨 → 跑远卸载 → 返回确认位置正确
4. 手动存档 → 刷新页面 → 加载存档确认特殊实体存在

---

### Task 7: 提交修复

**Step 1: 提交所有改动**

```bash
git add src/world/WorldRuntime.js src/world/WorldStore.js
git commit -m "fix(runtime-entities): phase 2 persistence — close read/write loop for runtimeEntities

- ensureChunkData/getChunkRecord/getChunkRecordsInRegion now project runtimeEntities
- flushBeforeUnload serializes blockDataSnapshot (Map → plain object)
- flushChunk and flushAllDirty carry runtimeEntities to prevent split-brain"
```
