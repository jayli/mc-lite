# Runtime Entities Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `turret`、`minecart`、`zombieNest` 从旧的 `persistenceService.cache.entities` 机制迁移到 `worldStore / IndexedDB` 权威模型，并补齐 chunk 卸载/恢复、渲染恢复、旧路径兼容、并发写入保护。

**Architecture:** 不再让各 Manager 直接 `getChunkRecord -> 改对象 -> putChunkRecord`。新增统一的 `RuntimeEntityRepository` 作为 `runtimeEntities` 的唯一写入入口；`blockData` 与 `runtimeEntities` 分层管理；活动实例采用“按 chunk 激活/停用”的显式生命周期。

**Tech Stack:** JavaScript (ES Modules), `WorldStore`, `WorldRuntime`, IndexedDB Worker RPC, Three.js, 现有 Chunk 装配与 Instanced 渲染体系

---

## 先决原则

### 必须遵守
- `worldStore / IndexedDB` 是权威源，`persistenceService.cache` 只是兼容桥和工作缓存。
- 任何新逻辑不得只写旧 `cache.entities`。
- 不能直接在三个 Manager 内部分散实现 chunkRecord 读改写。
- 必须同时验证两条装载链路：
  - `WorldRuntime.ensureChunkData()` -> `Chunk.loadFromRecord()`
  - `Chunk.gen()` / `assembleEntityPhase()` 的旧快照路径

### 本计划不接受的“伪完成”
- 仅修改 `Chunk.loadFromRecord()`
- 仅给 `WorldStore.getChunkRecord()` 加字段
- 只让实体“刷新页面能恢复”，但 chunk 卸载/恢复仍异常
- 只验证 minecart，不验证 turret / zombieNest

---

### Task 1: 代码路径盘点与契约冻结

**Files:**
- Modify: `docs/plans/2026-04-28-runtime-entities-persistence-design.md`
- Modify: `docs/plans/2026-04-28-runtime-entities-persistence-plan.md`
- Reference: `src/world/Chunk.js`
- Reference: `src/world/WorldRuntime.js`
- Reference: `src/world/WorldStore.js`
- Reference: `src/actors/turret/TurretManager.js`
- Reference: `src/actors/minecart/MinecartManager.js`
- Reference: `src/actors/zombie-nest/ZombieNestManager.js`

- [ ] **Step 1: 冻结数据职责边界**

确认并记录：
- `blockData` 管结构方块、普通方块、轨道、consolidation、AO
- `runtimeEntities` 管逻辑实体元数据与最小行为状态
- manager 活动实例不是权威持久化数据

- [ ] **Step 2: 冻结三类实体的最小持久化字段**

整理为最终契约：
- `turret`: `id`、`ownerChunk`、`anchor`、`renderState.yaw/pitch`、关键支撑块
- `minecart`: `id`、`ownerChunk`、`anchor`、`orientation`、`movementState`、`lastTrackPosition`、`linkedMinecartIds`
- `zombieNest`: `id`、`ownerChunk`、`anchor`、`criticalBlock`、`lastSpawnAt`

- [ ] **Step 3: 明确本次兼容策略**

确认采用：
- 写：只写 `worldStore.runtimeEntities`
- 读：优先 `worldStore.runtimeEntities`，必要时迁移旧 `cache.entities`

- [ ] **Step 4: 人工检查设计文档与计划文档是否一致**

检查目标、边界、字段与生命周期是否完全一致，不允许文档内部互相矛盾。

---

### Task 2: 建立统一仓储层，禁止 Manager 直接改 WorldStore

**Files:**
- Create: `src/world/runtime-entities/RuntimeEntityRepository.js`
- Modify: `src/world/WorldStore.js`
- Modify: `src/world/WorldRuntime.js`

- [ ] **Step 1: 新建 `RuntimeEntityRepository` 骨架**

提供最少接口：

```js
loadChunkRuntimeEntities(cx, cz)
updateChunkRuntimeEntities(cx, cz, updater)
upsertEntity(cx, cz, type, entityRecord)
removeEntity(cx, cz, type, entityId)
moveEntity(fromCx, fromCz, toCx, toCz, type, entityRecord)
migrateLegacyEntitiesIfNeeded(cx, cz, legacyEntities)
```

- [ ] **Step 2: 给仓储层实现按 chunk 串行化更新**

要求：
- 内部维护 `Map<chunkKey, Promise>` 或等价队列
- 同一 chunk 的 `updateChunkRuntimeEntities()` 串行执行
- `updater` 总是基于最新值生成新值

- [ ] **Step 3: 统一 `runtimeEntities` 的默认结构**

保证仓储层输出始终是：

```js
{ version: 1, byType: { turrets: [], minecarts: [], zombieNests: [] } }
```

避免调用方自己判空和拼结构。

- [ ] **Step 4: 扩展 `WorldStore` 的投影与合并能力**

修改要求：
- `getChunkRecord()` / `getChunkRecordsInRegion()` 投影出 `runtimeEntities`
- `putChunkRecord()` 明确为字段级合并，而不是全对象覆盖
- 对 `runtimeEntities` 支持“缺省保留、显式覆盖”语义

- [ ] **Step 5: 给 `WorldRuntime.flushChunk()` 留出只写 block 工作集的清晰边界**

确认 `flushChunk()` 只写：
- `blockData`
- `staticEntities`
- `runtimeSeedData`

不得在这里拼装 `runtimeEntities`。

- [ ] **Step 6: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 3: 打通读取链路，统一从 runtimeEntities 恢复

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/WorldRuntime.js`
- Create: `src/world/runtime-entities/RuntimeEntityLoadBridge.js`（如有必要）

- [ ] **Step 1: 修正 `Chunk.loadFromRecord()`**

从 `chunkRecord.runtimeEntities` 读取，并填充 `pendingRuntimeEntities`。

要求：
- 不再依赖旧 `cache.entities` 作为主来源
- 兼容 `runtimeEntities.version` 与 `byType` 结构

- [ ] **Step 2: 修正 `assembleEntityPhase()` 的旧快照逻辑**

这里不能简单删除旧逻辑；要改成兼容桥：
- 若 `pendingRuntimeEntities` 已有 `worldStore` 数据，则直接使用
- 若 `worldStore` 为空但旧 `snapshot.entities` / `cache.entities` 有值，则走迁移流程

- [ ] **Step 3: 提炼统一的 runtime entity hydration 逻辑**

避免 `loadFromRecord()` 和 `assembleEntityPhase()` 各自拷一套解析代码。

推荐：
- 提炼 `extractPendingRuntimeEntities(recordOrLegacySnapshot)`
- 或创建 `RuntimeEntityLoadBridge`

- [ ] **Step 4: 保留旧路径的最小兼容性，不让旧 cache 反向覆盖新权威值**

必须保证：
- 旧 `cache.entities` 只能在 `worldStore.runtimeEntities` 缺失时参与迁移
- 不能再无条件 merge 到新权威值上面

- [ ] **Step 5: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 4: 为三个 Manager 补齐激活/停用生命周期

**Files:**
- Modify: `src/actors/turret/TurretManager.js`
- Modify: `src/actors/minecart/MinecartManager.js`
- Modify: `src/actors/zombie-nest/ZombieNestManager.js`
- Modify: `src/world/World.js`

- [ ] **Step 1: 为三个 Manager 注入统一仓储层访问**

不要再保留“Manager 自己直接操纵 `worldStore`”的实现。统一改为依赖 `RuntimeEntityRepository`。

- [ ] **Step 2: 新增按 chunk 激活接口**

接口示例：

```js
activateChunkEntities(cx, cz, records)
```

要求：
- `restoreXxxForChunk()` 可保留为兼容入口，但内部统一委托到新接口
- 激活时只创建活动实例，不再重复写回持久层

- [ ] **Step 3: 新增按 chunk 停用接口**

接口示例：

```js
deactivateChunkEntities(cx, cz, { persist: true, reason: 'chunk-unload' })
```

要求：
- `turret`：销毁独立视觉对象，但不删除持久记录
- `zombieNest`：销毁逻辑实例，但不删除持久记录
- `minecart`：先停止运动并保存，再销毁实例

- [ ] **Step 4: 修改 `World.update()` 中的 chunk 卸载顺序**

固定顺序：
1. 各 manager 先停用 owner chunk 内活动实例
2. `worldRuntime.flushBeforeUnload()` 落地方块工作集
3. `chunk.dispose()`

- [ ] **Step 5: 给 manager 增加按 chunk 索引**

需要维护例如：
- `Map<chunkKey, Set<entityId>>`

原因：
- 卸载时快速找到归属该 chunk 的活动实体
- 避免全量扫描 manager map

- [ ] **Step 6: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 5: 分实体完成序列化/反序列化与状态延续

**Files:**
- Modify: `src/actors/turret/TurretManager.js`
- Modify: `src/actors/turret/Turret.js`
- Modify: `src/actors/minecart/MinecartManager.js`
- Modify: `src/actors/minecart/Minecart.js`
- Modify: `src/actors/zombie-nest/ZombieNestManager.js`
- Modify: `src/actors/zombie-nest/ZombieNest.js`

- [ ] **Step 1: `turret` 统一稳定 ID 与序列化结构**

要求：
- 放置时创建稳定 `id`
- 恢复时沿用原 `id`
- 序列化 `yaw/pitch` 与关键支撑块信息

- [ ] **Step 2: `minecart` 补全持久化字段**

要求：
- 不再只按位置去重
- 恢复时优先按 `id` 去重
- 序列化 `movementState`、`lastTrackPosition`、`linkedMinecartIds`

- [ ] **Step 3: `zombieNest` 补全刷怪节奏状态**

要求：
- 保存 `lastSpawnAt`
- 恢复时不要把刷怪节奏重置为“刚创建”

- [ ] **Step 4: 明确哪些状态故意不持久化**

代码里加简短注释说明：
- 炮弹对象不持久化
- 当前目标引用不持久化
- 敌人实例不持久化

- [ ] **Step 5: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 6: 处理结构破坏、拾取、跨 chunk 迁移

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/actors/turret/TurretManager.js`
- Modify: `src/actors/minecart/MinecartManager.js`
- Modify: `src/actors/zombie-nest/ZombieNestManager.js`
- Modify: `src/actors/player/PlayerInteraction.js`（如需要）

- [ ] **Step 1: 明确结构破坏时谁负责删除 runtime entity 记录**

要求：
- `turret` 支撑柱被破坏后，删除其权威记录
- `zombieNest` `criticalBlock` 被破坏后，删除其权威记录

不能只依赖“活动实例自己消失”，否则持久层会残留脏记录。

- [ ] **Step 2: 统一 minecart 的拾取/爆炸/碰撞删除路径**

要求：
- 所有删除路径都通过仓储层移除权威记录
- 不能出现只删内存实例、不删 `runtimeEntities` 的分叉逻辑

- [ ] **Step 3: 支持 minecart 跨 chunk owner 迁移**

要求：
- 以 `moveEntity()` 形式原子化表达“从旧 owner chunk 移除 + 新 owner chunk 添加”
- 第一版可以内部串行做两次更新，但必须封装在仓储层，不能散落在 manager

- [ ] **Step 4: 检查 `Chunk._handleEntityRemoval()` 与特殊实体逻辑是否有冲突**

当前 `_handleEntityRemoval()` 只处理 `collider` 类实体；确认不会误以为它已覆盖 turret / nest / minecart。

- [ ] **Step 5: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 7: 兼容迁移旧 `cache.entities` / 旧存档数据

**Files:**
- Modify: `src/world/runtime-entities/RuntimeEntityRepository.js`
- Modify: `src/services/PersistenceService.js`（如需要迁移辅助）
- Modify: `src/world/Chunk.js`
- Modify: `src/core/Game.js`（若旧手动存档恢复逻辑需要桥接）

- [ ] **Step 1: 实现旧 `entities` 结构到新 `runtimeEntities` 的转换器**

输入示例：
```js
{ turrets: [...], minecarts: [...], zombieNests: [...] }
```

输出示例：
```js
{ version: 1, byType: { turrets: [...], minecarts: [...], zombieNests: [...] } }
```

- [ ] **Step 2: 只在新权威记录缺失时触发迁移**

避免旧数据覆盖新数据。

- [ ] **Step 3: 完成一次迁移后写回 worldStore**

并考虑清理旧字段，至少避免下一次再次重复迁移。

- [ ] **Step 4: 检查 `Game` 的旧恢复入口**

[Game.js](/Users/bachi/jaylli/mc-lite/src/core/Game.js) 仍有从 `saveData.worldDeltas[].entities` 恢复特殊实体的逻辑；需要决定：
- 是继续保留为旧存档入口
- 还是统一先转成新 `runtimeEntities` 再恢复

本次推荐后者，避免运行时再维护两套恢复逻辑。

- [ ] **Step 5: Run lint**

Run: `npm run lint`  
Expected: PASS

---

### Task 8: 回归验证矩阵

**Files:**
- Test: 浏览器手工验证
- Test: `src/tests/index.html`（如已有可复用测试）
- Optional Modify: 新增最小测试入口或 debug 命令

- [ ] **Step 1: 验证 turret 完整链路**

手工验证：
1. 放置炮塔
2. 刷新页面后仍存在
3. 跑远触发 chunk 卸载，再回来恢复
4. 破坏关键 obsidian 后权威记录被删除
5. 再次刷新页面不会“复活”幽灵炮塔

- [ ] **Step 2: 验证 zombieNest 完整链路**

手工验证：
1. 放置巢穴
2. 结构方块正常进入 chunk 渲染
3. 跑远卸载后，回来结构方块恢复、逻辑实例恢复
4. 刷怪节奏不因卸载/恢复被重置
5. 破坏关键方块后不会残留幽灵记录

- [ ] **Step 3: 验证 minecart 完整链路**

手工验证：
1. 放置轨道和矿车
2. 运动中跑远卸载，回来后位置和状态合理
3. 拾取/爆炸后记录删除
4. 跨 chunk 运动后不重复、不丢失
5. 联动矿车关系恢复正确

- [ ] **Step 4: 验证双装载路径一致性**

验证以下两种情况下行为一致：
- 纯 runtime-streaming 从 `worldStore` 读回
- 仍经 `Chunk.gen()` / 旧快照桥恢复

- [ ] **Step 5: 执行 lint**

Run: `npm run lint`  
Expected: PASS

- [ ] **Step 6: 浏览器测试**

Run: `npm run start`  
Then open: `http://localhost:8080/src/tests/index.html`  
Expected: 现有测试不回归；若无相关自动测试，至少确认页面可正常加载并进行手工场景验证

---

### Task 9: 清理与文档收口

**Files:**
- Modify: `docs/plans/2026-04-28-runtime-entities-persistence-design.md`
- Modify: `docs/plans/2026-04-28-runtime-entities-persistence-plan.md`
- Optional Modify: 相关模块顶部注释

- [ ] **Step 1: 删除已经被新仓储层替代的误导性注释**

特别是：
- “持久化快照中存在实体列表” 之类只对应旧 `cache` 的描述
- 暗示 manager 是权威数据源的注释

- [ ] **Step 2: 为关键边界补中文注释**

重点写清：
- `blockData` vs `runtimeEntities`
- 激活态 vs 持久态
- chunk 卸载前的调用顺序

- [ ] **Step 3: 最后人工审查一次是否仍残留旧路径单写逻辑**

用全文搜索检查：
- `cache.entities`
- `saveXxxToSnapshot`
- `removeXxxFromSnapshot`
- `restoreXxxForChunk`

确认命名与语义已经收敛。

---

## 完成定义

以下条件同时满足，才算这次改造完成：

1. `turret`、`minecart`、`zombieNest` 全部以 `worldStore.runtimeEntities` 为权威持久化源。
2. chunk 卸载时，特殊实体活动实例会被正确停用；chunk 恢复时会正确重新激活。
3. `blockData` 与 `runtimeEntities` 的边界清晰，没有互相覆盖。
4. `WorldRuntime.flushChunk()` 与实体写入不再互相打架。
5. 旧 `cache.entities` 只作为迁移桥，不再是常规写入路径。
6. 三类实体都通过“刷新页面 + 跑远卸载 + 返回恢复 + 破坏/拾取删除”的手工回归。
