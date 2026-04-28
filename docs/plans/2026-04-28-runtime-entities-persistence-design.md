# Runtime Special Entities Session Persistence Design

**日期**: 2026-04-28  
**状态**: 修订版 v2  
**本阶段目标**: 先修复 runtime 会话期内的特殊实体与相关结构方块在 chunk 卸载/重载后的正确性；暂不把特殊实体正式纳入 `worldStore / IndexedDB` 权威链路。

---

## 1. 结论先行

这次失败，核心不是“特殊实体恢复代码少写了几行”，而是阶段目标和真实架构被混淆了。

当前分支里，特殊实体并没有真正迁移到 `worldStore`：

1. `worldStore / WorldRuntime` 当前只承接 `blockData / staticEntities / runtimeSeedData`
2. 炮塔、丧尸巢穴、矿车的 runtime 快照仍然主要保存在 `persistenceService.cache.get(chunkKey).entities`
3. `Chunk.loadFromRecord()` 恢复运行时实体时，实际仍然要去合并 `persistenceService.cache.entities`

因此，第一阶段不应该继续硬推“特殊实体 -> IndexedDB 权威化”。正确收敛方式是：

1. `worldStore` 继续负责普通方块和结构方块的持久化镜像
2. 特殊实体 runtime 数据先继续以 **内存会话级快照** 为权威
3. 先把 chunk 卸载/重载期间的内存正确性、方块正确性、交互正确性修通
4. 后续再单独做“特殊实体正式入库”的第二阶段设计

---

## 2. 本次失败的真实根因

### 2.1 方块侧状态在 chunk 卸载时丢失

你复现里“铁轨方块消失、炮塔底座/巢穴结构不回来、矿车还在”这一组现象，已经说明第一根因在 **结构方块没有正确保住**。

当前 `runtime-streaming` 路径里：

1. 玩家放置/删除方块时，`World.setBlock()` / `World.removeBlock()` 只标记 `worldRuntime.markChunkDirty()`
2. 真正写回 `worldStore` 依赖 `WorldRuntime.flushChunk()`
3. chunk 卸载时，`World.update()` 里调用了 `this.worldRuntime.flushBeforeUnload(chunk.cx, chunk.cz).catch(() => {})`
4. 但这一步 **没有 await**
5. 紧接着就 `scene.remove(chunk.group)`、`chunk.dispose()`、`this.chunks.delete(key)`
6. `flushChunk()` 内部又要从 `this._world.chunks.get(key)` 重新取活动 chunk

结果就是：

1. 卸载流程先把活动 chunk 销毁了
2. 异步 flush 再执行时，活动 chunk 可能已经不存在
3. `blockData` 没有成功写回
4. 重新回来时，铁轨、炮塔底座、巢穴结构方块丢失

这正好解释了为什么：

1. `minecart` 还能出现，因为它走的是独立 runtime 快照
2. `sand_train_track`、`turret` 底座、`zombieNest` 结构没回来，因为它们本质上是方块侧状态

### 2.2 炮塔/巢穴“看起来像恢复失败”，实际上是结构先丢，再自毁

当前炮塔和丧尸巢穴都还是旧模型：

1. manager 全局持有活动实例
2. chunk 卸载时并不会显式停用它们
3. 远离时完整性检查会跳过未加载 chunk，避免误杀
4. 玩家跑回来后，如果结构方块不存在，它们会在完整性检查中判定失效并自毁

所以现象不是“恢复入口单点失效”，而是：

1. 结构方块先丢
2. chunk 重新加载后可查询
3. 炮塔/巢穴发现关键方块没了
4. 实例自毁

### 2.3 计划边界错了：第一阶段不该把特殊实体权威源直接切到 IndexedDB

当前代码现实是：

1. `WorldStore.getChunkRecord()` 不返回 `runtimeEntities`
2. `WorldStore.putChunkRecord()` 也不处理 `runtimeEntities`
3. `WorldRuntime.ensureChunkData()` 只返回 `blockData / staticEntities / runtimeSeedData`
4. `Chunk.loadFromRecord()` 仍然要回头去看 `persistenceService.cache.entities`

这说明“特殊实体已迁入 worldStore”并不成立。

如果在这个基础上继续设计 `RuntimeEntityRepository + IndexedDB authority`，会把第一阶段问题复杂化，甚至把真正 bug 淹没掉。

---

## 3. 现状下，特殊实体到底怎么存、怎么取

这一节只描述当前代码事实。

### 3.1 炮塔 `turret`

**存储方式**

1. 放置时，`TurretPlacementHandler.place()` 先调用 `world.setBlock()` 放置 3x3 `iron_ore` 底座和 2 格 `obsidian` 柱子
2. 然后调用 `turretManager.createTurret()`
3. `TurretManager.saveTurretToSnapshot()` 把炮塔快照写进 `persistenceService.cache.get(chunkKey).entities.turrets`

**取回方式**

1. chunk 重载时，`Chunk.loadFromRecord()` 先从 `worldStore` 读回 `blockData`
2. 然后再从 `persistenceService.cache.get(chunkKey).entities` 合并 `turrets`
3. `finalizeNonDeferredPhase()` 调 `turretManager.restoreTurretsForChunk()`
4. manager 直接重新 `createTurret(..., persist:false)`

**关键事实**

1. 炮塔头部渲染是独立 Three.js 对象，不属于 chunk mesh
2. 炮塔完整性依赖 `obsidian` 柱子仍然存在
3. 结构方块丢失时，炮塔会在完整性检查中销毁自己

### 3.2 丧尸巢穴 `zombieNest`

**存储方式**

1. `ZombieNestPlacementHandler.place()` 先把整套结构方块写进世界
2. 然后 `zombieNestManager.createNest()`
3. `ZombieNestManager.saveNestToSnapshot()` 把逻辑快照写进 `persistenceService.cache.get(chunkKey).entities.zombieNests`

**取回方式**

1. chunk 重载时，结构方块先从 `blockData` 恢复
2. `Chunk.loadFromRecord()` 再从 `persistenceService.cache.entities` 提取 `zombieNests`
3. `finalizeNonDeferredPhase()` 调 `zombieNestManager.restoreNestsForChunk()`

**关键事实**

1. 巢穴没有独立 mesh
2. 真正“看得见”的部分是结构方块
3. runtime 快照只保存逻辑实体
4. 关键方块缺失时，巢穴会在完整性检查中自毁

### 3.3 矿车 `minecart`

**存储方式**

1. 矿车本身不写结构方块
2. `MinecartManager.saveMinecartToSnapshot()` 把矿车数据写进 `persistenceService.cache.get(chunkKey).entities.minecarts`
3. chunk 卸载前 `stopMinecartsForChunk()` 会停止运动并再次保存

**取回方式**

1. chunk 重载时，`Chunk.loadFromRecord()` 从 `persistenceService.cache.entities.minecarts` 取出快照
2. `finalizeNonDeferredPhase()` 调 `minecartManager.restoreMinecartsForChunk()`

**关键事实**

1. 矿车是独立 runtime 对象
2. 它依赖轨道存在，但当前没有像炮塔/巢穴那样的完整性自毁链路
3. 所以轨道丢失时，矿车仍可能“还在”

---

## 4. 第一阶段修正后的权威模型

### 4.1 本阶段明确放弃的目标

以下内容全部推迟到第二阶段，不纳入当前方案：

1. 把 `turret / zombieNest / minecart` 正式持久化进 IndexedDB
2. 为特殊实体新建 `worldStore.runtimeEntities`
3. 用 `RuntimeEntityRepository` 统一所有持久态实体读写
4. 把所有特殊实体都改成“按 chunk 激活/停用”的新生命周期

这些都不是当前 bug 的最短修复路径。

### 4.2 本阶段的三层数据职责

修正后，本阶段应该采用下面这套职责边界：

1. **活动 chunk 内方块权威**
   - `chunk.blockData`
   - 玩家放置、删除、结构生成、consolidation、AO 都围绕它工作

2. **会话级 chunk 快照权威**
   - `persistenceService.cache`
   - `cache.blocks` 保存运行期内存中的 chunk 方块快照
   - `cache.entities` 保存特殊实体 runtime 快照
   - 这是“chunk 卸载后，再回来还能恢复”的第一权威

3. **worldStore / IndexedDB**
   - 本阶段只作为普通方块和结构方块的异步镜像
   - 它很重要，但不能成为 runtime 卸载/回流的唯一立即依赖

### 4.3 第一阶段的关键原则

#### 原则 A：特殊实体 runtime 权威仍然是 `persistenceService.cache.entities`

也就是继续复用旧机制，只做兼容修补，不做架构跳跃。

#### 原则 B：chunk 卸载前必须先把当前 `blockData` 同步成会话快照

哪怕 `worldStore` 异步 flush 失败，只要内存会话还活着，重新回来也必须能从快照恢复。

#### 原则 C：`worldStore` 在本阶段只负责“块级镜像”，不是特殊实体的立即权威源

特殊实体后续是否持久化到 IndexedDB，可以下一阶段再决定。

#### 原则 D：第一阶段不强行改炮塔/巢穴生命周期

保持旧行为：

1. 炮塔、巢穴实例仍由 manager 全局持有
2. 远离 chunk 时不主动销毁
3. 近处 chunk 恢复后依靠结构方块继续保持正确性

只有矿车保留现有 `stopMinecartsForChunk()` 行为。

---

## 5. 第一阶段推荐设计

### 5.1 引入“会话快照桥”，而不是“runtimeEntities 入库”

需要新增一个很轻量的会话桥接层，职责只有两件事：

1. 把 `worldStore` 读出的 `blockData` 注入到 `persistenceService.cache.blocks`
2. 把活动 chunk 当前的 `blockData` 回写到 `persistenceService.cache.blocks`

它不应该承担：

1. 新的实体仓储抽象
2. region 级并发调度
3. IndexedDB 事务性 runtime entity 写入

### 5.2 `persistenceService.cache` 需要重新被视为“runtime session overlay”

本阶段要明确：

1. `cache.blocks` 不再只是旧时代遗留
2. 它是 runtime-streaming 阶段 **chunk 卸载后再恢复** 的会话级数据源
3. `cache.entities` 继续承担炮塔、巢穴、矿车的 runtime 快照

### 5.3 `Chunk.loadFromRecord()` 的正确行为

从现在起，`Chunk.loadFromRecord()` 的职责应该变成：

1. 先拿 `worldStore` 提供的基础 `chunkRecord`
2. 立即确保 `persistenceService.cache[chunkKey]` 存在
3. 若 cache 里已经有更新过的 `blocks`，则以 cache 为准覆盖基础 `blockData`
4. `entities` 仍然只从 cache 读取
5. 把最终结果注入 chunk，再走现有 finalize 恢复逻辑

这一步的关键不是“把特殊实体搬到 worldStore”，而是“让旧的 session 快照机制在新 worldStore 路径上继续工作”。

### 5.4 chunk 卸载的正确顺序

当前顺序不安全，应该改成：

1. 先把当前 `chunk.blockData` 同步到 `persistenceService.cache.blocks`
2. 再处理矿车 `stopMinecartsForChunk()`
3. 再触发 `worldRuntime.flushBeforeUnload()` 或等价 flush
4. flush 至少要保证“内存会话快照已完成”
5. 然后才允许 `chunk.dispose()` 和 `this.chunks.delete(key)`

如果需要继续异步写 `worldStore`，也必须在“会话快照已完成”之后。

### 5.5 特殊实体恢复仍然沿用旧入口

本阶段不改恢复总线：

1. `Chunk.finalizeNonDeferredPhase()`
2. `restoreNestsForChunk()`
3. `restoreTurretsForChunk()`
4. `restoreMinecartsForChunk()`

真正要修的是：

1. 它们读到的结构方块必须还在
2. 它们读到的 `cache.entities` 必须没丢

### 5.6 结构方块与特殊形状的边界

这次必须明确：

1. 炮塔底座、柱子、巢穴结构、铁轨，都是 **普通方块侧数据**
2. 它们应该继续走 `blockData`
3. consolidation、AO、面剔除也继续只围绕 `blockData`
4. 不要为这些结构额外再造一套“特殊形状权威”

也就是说：

1. 特殊实体的“特殊”主要体现在 **逻辑实例**
2. 它们的结构主体依旧是块世界的一部分

---

## 6. 第一阶段需要补齐的数据契约

虽然本阶段不做正式入库，但 runtime snapshot 仍然应该增强，避免后续再次返工。

### 6.1 `turret`

建议把快照从：

1. `position`
2. `rotation`

增强为：

1. `id`
2. `position`
3. `rotation`

本阶段不强制保存 pitch，因为当前炮塔默认会重新瞄准；但 `id` 最好补上，后续调试和去重都会更稳。

### 6.2 `zombieNest`

建议把快照从：

1. `position`
2. `criticalBlock`

增强为：

1. `id`
2. `position`
3. `criticalBlock`
4. `lastSpawnTime`

否则玩家可以靠卸载/加载刷新刷怪节奏。

### 6.3 `minecart`

矿车当前快照已经最接近可用状态，但仍要确认：

1. `id`
2. `position`
3. `orientation`
4. `movementState`
5. `linkedMinecartIds`
6. `chunkKey`

是否都能稳定 round-trip。

---

## 7. 为什么这次不建议直接上 `RuntimeEntityRepository`

不是说这个方向永远不对，而是它不适合作为当前修复的第一步。

当前最短闭环是：

1. 先修 `blockData` 卸载竞态
2. 让 `cache.blocks + cache.entities` 在 `worldStore` 路径上重新闭环
3. 验证炮塔、巢穴、铁轨、矿车在 runtime 会话内的卸载/重载全部正常
4. 再评估特殊实体是否真的要入 `worldStore`

如果跳过这一步，继续推大仓储抽象，会有三个问题：

1. 先修错层，定位更乱
2. 把当前还能工作的旧机制一起推翻
3. 测试面会瞬间放大

---

## 8. 本阶段完成标准

### 必须成立

1. 放置铁轨后，玩家跑远卸载 chunk，再回来，铁轨仍正确渲染
2. 放置炮塔后，玩家跑远再回来，底座、柱子、炮塔头部都存在，炮塔仍能射击
3. 放置丧尸巢穴后，玩家跑远再回来，结构仍存在，巢穴仍能继续刷怪
4. 放置矿车后，玩家跑远再回来，矿车仍在正确位置
5. 以上能力在 **不依赖重新启动游戏** 的单次 runtime 会话里成立

### 本阶段不要求

1. 关闭页面后特殊实体从 IndexedDB 恢复
2. `worldStore` 持有特殊实体正式权威数据
3. 特殊实体 chunk 级生命周期彻底重写

---

## 9. 第二阶段再做什么

等第一阶段跑稳以后，再单独开第二阶段设计：

1. 是否把 `cache.entities` 正式搬入 `worldStore`
2. 是否需要 `RuntimeEntityRepository`
3. 是否为炮塔/巢穴改成显式 chunk 激活/停用
4. IndexedDB 存档协议

---

## 10. 第一阶段实施状态

**状态**: 已完成（2026-04-28）

### 已完成

1. `persistenceService.cache` 恢复为 session overlay，新增 `ensureChunkSnapshot`、`snapshotChunkBlocks`、`hydrateChunkBlocks`、`replaceChunkBlocks`
2. `recordChangeForChunk` 在 cache 缺失时自动创建快照
3. `Chunk.loadFromRecord` 明确 block 读取优先级：`cache.blocks > chunkRecord.blockData`
4. World.js 卸载顺序修正：`snapshot -> stopMinecarts -> flush -> dispose -> delete`
5. `WorldRuntime.flushChunk/flushBeforeUnload` 支持传入已抓取快照
6. 炮塔快照补 `id`，恢复时优先复用
7. 丧尸巢穴快照补 `id + lastSpawnTime`，恢复时复用
8. 矿车 `saveMinecartToSnapshot` 改用 `id` 去重

### 明确未开始

1. 特殊实体正式入 `worldStore` / IndexedDB
2. `RuntimeEntityRepository` 抽象
3. chunk 级 activate/deactivate 生命周期
4. 跨重启持久化（关闭页面后恢复）
3. 是否要为炮塔/巢穴改成显式 chunk 激活/停用
4. 保存/读档与 IndexedDB 的统一协议

在那之前，不应该再把当前 bug 修复目标继续扩张。
