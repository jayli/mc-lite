# Runtime Special Entities Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复炮塔、丧尸巢穴、铁轨和矿车在单次 runtime 会话内的 chunk 卸载/重载正确性，先恢复旧机制在新 `worldStore` 架构下的可用性。

**Architecture:** 本阶段不把特殊实体正式迁入 `worldStore / IndexedDB`。继续使用 `persistenceService.cache.entities` 作为特殊实体 runtime 权威快照，并把 `cache.blocks` 重新接回 `worldStore` 读取路径，形成“活动 chunk.blockData + 会话级 cache overlay + worldStore 异步镜像”的三层闭环。

**Tech Stack:** JavaScript (ES Modules), Three.js, `World`, `Chunk`, `WorldRuntime`, `PersistenceService`, 现有炮塔/丧尸巢穴/矿车 manager

---

## 先决原则

### 本阶段必须坚持

1. 不新建 `worldStore.runtimeEntities`
2. 不引入 `RuntimeEntityRepository`
3. 不重写炮塔/丧尸巢穴为“按 chunk 激活/停用”的新生命周期
4. 先修通 runtime 会话内存期正确性，再谈 IndexedDB 权威化

### 本阶段真正的修复目标

1. 结构方块不能在 chunk 卸载时丢失
2. `persistenceService.cache.entities` 不能在新读取链路里失联
3. chunk 回来后要能重新看到铁轨、炮塔结构、巢穴结构
4. 炮塔和巢穴不能因为结构方块丢失而误自毁

### 本计划明确不接受的“伪完成”

1. 只修 `turretManager` / `zombieNestManager` 恢复入口
2. 只给 `worldStore` 加 `runtimeEntities`
3. 不修卸载写回竞态
4. 手工验证只看矿车，不看铁轨/炮塔/巢穴结构

---

### Task 1: 写出最小失败用例，锁定根因

**Files:**
- Create: `src/tests/test-runtime-session-persistence.js`
- Modify: `src/tests/index.html`
- Reference: `src/world/World.js`
- Reference: `src/world/WorldRuntime.js`
- Reference: `src/world/Chunk.js`

- [ ] **Step 1: 为“chunk 卸载前 blockData 丢失”写失败测试**

测试目标：

1. 构造一个 runtime-streaming chunk
2. 修改 `chunk.blockData`
3. 标记 dirty
4. 触发 unload 路径
5. 断言卸载后仍能从会话快照读回这些 block

- [ ] **Step 2: 为“loadFromRecord 需要合并 cache.entities”写失败测试**

测试目标：

1. 预置 `persistenceService.cache[chunkKey].entities`
2. 用只含 `blockData` 的 `chunkRecord` 调 `chunk.loadFromRecord()`
3. 断言 `pendingRuntimeEntities` 被正确提取

- [ ] **Step 3: 为“炮塔/巢穴因结构丢失而自毁”写失败测试**

测试目标：

1. 模拟炮塔/巢穴已存在于 manager
2. 模拟 chunk 卸载后再加载
3. 若结构方块恢复正常，则实例不应被误销毁

- [ ] **Step 4: 运行浏览器测试，确认至少一项失败**

Run: 启动 `npm run start`，打开 `http://localhost:8080/src/tests/index.html`，点击“运行所有测试”  
Expected: 新增测试先失败，证明问题被准确捕获

---

### Task 2: 把 `persistenceService.cache` 明确恢复为 session overlay

**Files:**
- Modify: `src/services/PersistenceService.js`

- [ ] **Step 1: 增加“确保 chunk 快照存在”的公共方法**

建议新增：

```js
ensureChunkSnapshot(chunkKey, seed = {})
```

职责：

1. 保证 `cache.get(chunkKey)` 一定有 `{ blocks, entities }`
2. 不再让调用方自己散落地拼空对象

- [ ] **Step 2: 增加“用外部记录填充/合并 blocks”的公共方法**

建议新增：

```js
hydrateChunkBlocks(chunkKey, blockData)
replaceChunkBlocks(chunkKey, blockData)
snapshotChunkBlocks(chunkKey, blockData)
```

至少需要一个统一入口，避免 `Chunk` / `WorldRuntime` / manager 各自手写。

- [ ] **Step 3: 修正 `recordChangeForChunk()` 的缺口**

当前行为是：cache 不存在就直接 return。  
这会让 runtime-streaming 下很多块修改根本进不了会话快照。

修正要求：

1. cache 缺失时自动创建快照
2. 后续方块增量必须写入 `cache.blocks`

- [ ] **Step 4: 保持 `entities` 结构不被覆盖**

要求：

1. 更新 `blocks` 时不能把已有 `entities` 抹掉
2. 更新 `entities` 时不能把已有 `blocks` 抹掉

- [ ] **Step 5: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 3: 修正 `Chunk.loadFromRecord()` 的装载职责

**Files:**
- Modify: `src/world/Chunk.js`

- [ ] **Step 1: 把 `worldStore` 读到的 `blockData` 注入 session cache**

要求：

1. `loadFromRecord()` 一进入就确保 `persistenceService.cache[chunkKey]` 存在
2. 若 cache 还没有 `blocks`，用 `chunkRecord.blockData` 种进去

- [ ] **Step 2: 明确 block 读取优先级**

本阶段建议优先级：

1. `cache.blocks` 有值时，用 `cache.blocks`
2. 否则用 `chunkRecord.blockData`

原因：

1. runtime 会话内用户最新修改可能只存在于 session overlay
2. 不能要求每次重新进可见范围都依赖 `worldStore` 已成功 flush

- [ ] **Step 3: 保留 runtime entities 仅从 `cache.entities` 恢复**

要求：

1. `pendingRuntimeEntities` 继续从 `cache.entities` 提取
2. 不要引入 `chunkRecord.runtimeEntities`
3. 不要在这里尝试 IndexedDB 特殊实体迁移

- [ ] **Step 4: 让 finalize 恢复逻辑保持不变**

要求：

1. `finalizeNonDeferredPhase()` 仍然调用三个 manager 的现有 `restoreXxxForChunk()`
2. 本任务只修数据输入，不改恢复总线

- [ ] **Step 5: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 4: 修复 chunk 卸载时的 blockData 写回竞态

**Files:**
- Modify: `src/world/World.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/Chunk.js`
- Modify: `src/services/PersistenceService.js`

- [ ] **Step 1: 在卸载前先同步快照当前 `chunk.blockData` 到 `cache.blocks`**

要求：

1. 这一步必须是同步、立刻可见的内存操作
2. 不能依赖后续异步 flush 成功

- [ ] **Step 2: 调整 `World.update()` 中的卸载顺序**

新的顺序应为：

1. `snapshotChunkBlocks(...)`
2. `minecartManager.stopMinecartsForChunk(...)`
3. 触发 `flushBeforeUnload(...)`
4. 再 `chunk.dispose()`
5. 再 `this.chunks.delete(key)`

- [ ] **Step 3: 修正 `flushBeforeUnload()` / `flushChunk()` 对活动 chunk 的依赖**

二选一即可，但必须明确：

1. 要么卸载路径里 `await flushBeforeUnload()`
2. 要么 `flushChunk()` 改成允许传入已抓取的快照，不再回头从 `world.chunks.get(key)` 取活动 chunk

推荐第二种。因为它更不依赖调用时序。

- [ ] **Step 4: 保证 `worldStore` flush 失败不影响会话内 reload**

要求：

1. 就算 IndexedDB 写失败
2. 只要当前会话没结束
3. 再回来仍能从 `cache.blocks` 看到结构方块

- [ ] **Step 5: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 5: 复用旧特殊实体机制，不重写生命周期

**Files:**
- Modify: `src/actors/turret/TurretManager.js`
- Modify: `src/actors/zombie-nest/ZombieNestManager.js`
- Modify: `src/actors/minecart/MinecartManager.js`
- Modify: `src/actors/zombie-nest/ZombieNest.js`
- Modify: `src/actors/turret/Turret.js`

- [ ] **Step 1: 明确三个 manager 仍然以 `cache.entities` 为快照源**

要求：

1. 不接入 `worldStore.runtimeEntities`
2. 不新增 repository
3. 只把现有快照代码收敛、补齐

- [ ] **Step 2: 给炮塔快照补 `id`**

要求：

1. 新建时生成 `id`
2. 恢复时优先复用快照 `id`
3. position 去重保留为兼容保护，但不再是唯一身份

- [ ] **Step 3: 给丧尸巢穴快照补 `id + lastSpawnTime`**

要求：

1. 避免卸载/重载后刷怪节奏重置
2. 后续如需存档，也能直接沿用

- [ ] **Step 4: 核对矿车 round-trip 字段**

要求：

1. `id`
2. `position`
3. `orientation`
4. `movementState`
5. `linkedMinecartIds`
6. `chunkKey`

至少确认恢复后行为不退化。

- [ ] **Step 5: 不在本任务里做 chunk 级 deactivate/activate**

这是边界要求，不是缺陷。

- [ ] **Step 6: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 6: 校正保存/读取桥，避免两条路径互相打架

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/core/Game.js`
- Modify: `src/services/PersistenceService.js`

- [ ] **Step 1: 保证 `pendingSnapshot` 和 `cache` 的语义一致**

要求：

1. `pendingSnapshot.blocks` 与 `cache.blocks` 不冲突
2. `pendingSnapshot.entities` 与 `cache.entities` 不互相抹写

- [ ] **Step 2: 明确“会话内 chunk 重载”和“整局存档恢复”是两条不同入口**

要求：

1. chunk runtime reload 走 `Chunk.loadFromRecord() + cache overlay`
2. 手动读档恢复仍走 `Game` 里 `worldDeltas -> restoreXxxForChunk()`

- [ ] **Step 3: 避免 `saveChunkData(data)` 把旧结构覆盖新结构**

如果传入的是部分对象，必须检查是否会覆盖掉已有 `entities` 或 `blocks`。必要时先做合并。

- [ ] **Step 4: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 7: 人工回归验证四条主链路

**Files:**
- Reference: `src/actors/turret/*`
- Reference: `src/actors/zombie-nest/*`
- Reference: `src/actors/minecart/*`
- Reference: `src/world/*`

- [ ] **Step 1: 铁轨回归**

手工步骤：

1. 放置直轨和弯轨
2. 跑远卸载 chunk
3. 返回
4. 确认轨道方块仍正确渲染，orientation 不错乱

- [ ] **Step 2: 炮塔回归**

手工步骤：

1. 放置炮塔
2. 跑远卸载 chunk
3. 返回
4. 确认底座、柱子、炮塔头都存在
5. 引一只丧尸测试炮塔仍能开火

- [ ] **Step 3: 丧尸巢穴回归**

手工步骤：

1. 放置巢穴
2. 跑远卸载 chunk
3. 返回
4. 确认结构还在
5. 等待刷怪周期，确认巢穴继续工作

- [ ] **Step 4: 矿车回归**

手工步骤：

1. 放置铁轨和矿车
2. 让矿车静止/运动各测试一次
3. 跑远卸载 chunk
4. 返回
5. 确认矿车位置和轨道关系正确

- [ ] **Step 5: 全量浏览器测试**

Run: 启动 `npm run start`，打开 `http://localhost:8080/src/tests/index.html`，点击“运行所有测试”  
Expected: PASS

---

### Task 8: 第二阶段准备项，只记录不实现

**Files:**
- Modify: `docs/plans/2026-04-28-runtime-entities-persistence-design.md`
- Modify: `docs/plans/2026-04-28-runtime-entities-persistence-plan.md`

- [ ] **Step 1: 在文档尾部补“第二阶段范围”**

列出但不实现：

1. 特殊实体正式入 `worldStore`
2. `RuntimeEntityRepository`
3. chunk 级 activate/deactivate
4. IndexedDB 存档协议

- [ ] **Step 2: 标记第一阶段完成判据**

要求：

1. 明确“runtime 会话正确”已完成
2. 明确“跨重启持久化”尚未开始

---

## 完成判据

### 通过

1. 铁轨在 chunk 卸载/重载后仍存在
2. 炮塔结构与逻辑都能回来，且不会误自毁
3. 丧尸巢穴结构与逻辑都能回来，且刷怪节奏不中断
4. 矿车在轨道场景中继续正确恢复
5. 浏览器测试通过

### 不算通过

1. 只有矿车恢复了
2. 炮塔/巢穴实例回来但结构方块丢了
3. 结构方块回来但炮塔/巢穴误自毁
4. 继续把第一阶段实现扩展成 IndexedDB 特殊实体权威化
