# Runtime Entities Persistence Design

**日期**: 2026-04-28  
**状态**: 修订版  
**范围**: `turret`、`minecart`、`zombieNest` 在 `worldStore / IndexedDB` 权威存储机制下的持久化、恢复、卸载与渲染协同

## 1. 这次失败暴露出的根因

上一次方案失败，不是因为少改了几行，而是因为设计抽象层级错了。它把三类“特殊实体”都当成了同一种 `runtimeEntities` 数据迁移问题，但真实代码里三者的渲染形态、与 `blockData` 的关系、卸载语义、恢复入口都不同。

失败点主要有四类：

1. **把特殊实体错误地视为纯元数据对象**
   - `zombieNest` 没有独立视觉模型，视觉主体是结构方块，实体实例只负责刷怪与完整性检查。
   - `minecart` 没有落地到 `blockData`，完全是运行时对象，由独立 Instanced Renderer 渲染。
   - `turret` 是混合体：底座/柱子是方块，炮塔头部是独立 Three.js 对象。

2. **只考虑了 `Chunk.loadFromRecord()`，没考虑另一条真实装载链路**
   - 当前项目至少有两条恢复路径：
     - `WorldRuntime.ensureChunkData()` -> `Chunk.loadFromRecord()`
     - `Chunk.gen()` / `assembleEntityPhase()` 通过 `persistenceService.cache` 合并快照
   - 只改第一条路径，第二条路径仍然读旧数据，会导致行为不一致。

3. **直接让各 Manager 自己 `getChunkRecord -> 改对象 -> putChunkRecord`，没有解决并发覆盖**
   - `WorldRuntime.flushChunk()`、`flushAllDirty()`、Manager 写入、chunk 卸载前写回，都会碰同一个 `chunkRecord`。
   - 没有一个“按 chunk 串行化”的更新接口，读改写天然存在竞态。

4. **没有定义实体“激活态”和“持久态”的边界**
   - 当前代码里，特殊实体大多是全局 manager 持有的活动实例；chunk 卸载并不天然等于实体实例销毁。
   - 方案没有明确：远离后是“继续活着但不可见”，还是“按 chunk 停用，靠近再恢复”。

本次修订要先把这四个问题讲清楚，再谈实现计划。

---

## 2. 现状澄清：三类特殊实体并不等价

### 2.1 `turret`

代码事实：
- 放置时先往世界写入底座与柱子方块，再创建 `Turret` 实例。见 [TurretPlacementHandler.js](/Users/bachi/jaylli/mc-lite/src/actors/turret/TurretPlacementHandler.js) 。
- `Turret` 自己再创建炮塔头部、炮管等独立 `Three.js` 对象，直接挂到 `scene`，不属于 chunk mesh。见 [Turret.js](/Users/bachi/jaylli/mc-lite/src/actors/turret/Turret.js) 。
- 完整性校验依赖世界中的关键方块是否仍存在。

结论：
- `turret` 不是“只要恢复一条 runtimeEntities 记录就够了”。
- 它同时依赖两套数据：
  - `blockData`：底座/柱子，是视觉与物理的一部分
  - `runtimeEntities`：炮塔头部逻辑、朝向、生命周期

### 2.2 `zombieNest`

代码事实：
- 放置时先生成并落地方块结构，再创建 `ZombieNest` 实例。见 [ZombieNestPlacementHandler.js](/Users/bachi/jaylli/mc-lite/src/actors/zombie-nest/ZombieNestPlacementHandler.js) 。
- `ZombieNest` 本身没有独立 mesh；它只是逻辑体，依赖 `criticalBlock` 做完整性校验，并定时刷怪。见 [ZombieNest.js](/Users/bachi/jaylli/mc-lite/src/actors/zombie-nest/ZombieNest.js) 。

结论：
- `zombieNest` 的“渲染恢复”主要是结构方块通过 chunk 正常加载、consolidation、AO 刷新后重新显示。
- `runtimeEntities` 里保存的是逻辑实体，而不是视觉主体。

### 2.3 `minecart`

代码事实：
- 矿车不写结构方块，只依赖轨道方块存在。
- 渲染完全由 `MinecartInstancedRenderer` 负责；`Minecart` 只是数据对象。见 [Minecart.js](/Users/bachi/jaylli/mc-lite/src/actors/minecart/Minecart.js) 与 [MinecartManager.js](/Users/bachi/jaylli/mc-lite/src/actors/minecart/MinecartManager.js) 。
- 卸载 chunk 前已有 `stopMinecartsForChunk()` 逻辑，会停止运动并写快照。

结论：
- `minecart` 是最接近“纯 runtime entity”的对象。
- 但它又依赖轨道方块这一外部支撑条件，不能脱离 `blockData` 单独看。

---

## 3. 修订后的权威模型

### 3.1 三层真相来源

在新的 `worldStore` 机制下，必须严格区分三层：

1. **IndexedDB / RegionRecord**
   - 唯一权威持久化数据源
   - 保存 `blockData`、`staticEntities`、`runtimeSeedData`、`runtimeEntities`

2. **Chunk runtime working set**
   - 当前已加载 chunk 的内存工作集
   - `blockData Map`、可见面、AO、consolidation 状态属于这一层
   - 不是权威，只是权威数据的活动投影

3. **Manager active instances**
   - `turretManager.turrets`
   - `minecartManager.minecarts`
   - `zombieNestManager.nests`
   - 这些实例是“活动态对象”，不是权威数据源

### 3.2 `persistenceService.cache` 的新定位

`persistenceService.cache` 不能再被视为权威来源。

修订后它只能有两个用途：

1. **旧装载路径兼容桥**
   - 仍在 `Chunk.gen()` / `assembleEntityPhase()` 中存在时，可作为临时桥接层

2. **会话级工作缓存**
   - 用于旧代码尚未清理前避免大范围重构

必须禁止的事情：
- 新业务状态继续只写 `cache` 不写 `worldStore`
- `cache` 覆盖 `worldStore` 权威值
- 不经统一合并策略直接从多个入口并发写 `cache` 和 `worldStore`

---

## 4. 新的数据模型

### 4.1 `ChunkRecord.runtimeEntities`

不再继续沿用“若干松散数组 + Manager 自己拼字段”的做法。修订后统一成带版本号的结构。

```js
chunkRecord.runtimeEntities = {
  version: 1,
  byType: {
    turrets: [
      {
        id: 'turret_xxx',
        ownerChunk: 'cx,cz',
        anchor: { x, y, z },
        renderState: {
          yaw: number,
          pitch: number
        },
        support: {
          kind: 'turret_base',
          criticalBlocks: [
            { x, y, z, type: 'obsidian' },
            { x, y, z, type: 'obsidian' }
          ]
        }
      }
    ],
    minecarts: [
      {
        id: 'minecart_xxx',
        ownerChunk: 'cx,cz',
        anchor: { x, y, z },
        motionState: {
          orientation: number,
          movementState: 'IDLE' | 'MOVING_FORWARD' | 'MOVING_BACKWARD',
          lastTrackPosition: { x, y, z } | null
        },
        linkState: {
          linkedMinecartIds: []
        },
        support: {
          kind: 'track',
          trackBlock: { x, y, z }
        }
      }
    ],
    zombieNests: [
      {
        id: 'zombie_nest_xxx',
        ownerChunk: 'cx,cz',
        anchor: { x, y, z },
        criticalBlock: { x, y, z, type },
        spawnState: {
          lastSpawnAt: number
        }
      }
    ]
  }
}
```

### 4.2 为什么需要 `id`

旧方案里 `turret` / `zombieNest` 用位置去重，`minecart` 才有稳定 `id`。这不够。

必须统一要求三类实体都有稳定 `id`，原因：
- 支持 chunk 卸载/恢复时识别“同一个实体”
- 避免位置微调、朝向变化、特殊交互导致误判为新对象
- 为未来支持跨 chunk 迁移、调试追踪、链路日志打基础

### 4.3 为什么要保存比“位置+朝向”更多的状态

上次设计要求“只保存基础属性（位置+朝向）”，这个结论对当前系统不成立。

至少要保留：
- `minecart.lastTrackPosition`：否则回弹与停止位置会漂
- `minecart.linkedMinecartIds`：否则重载后联动车组关系丢失
- `zombieNest.lastSpawnAt`：否则玩家可以通过卸载/加载重置刷怪节奏
- `turret.yaw / pitch`：否则恢复时炮塔头部突兀跳回默认朝向

不必保存的状态：
- `turret` 炮弹对象
- `zombieNest` 当前已生成的敌人引用
- `minecart` 临时速度向量（可选，第一期可以不保）

---

## 5. 统一生命周期设计

### 5.1 持久态 vs 激活态

修订后，所有特殊实体都遵循同一个生命周期：

1. **持久态记录存在于 `worldStore`**
2. **chunk 进入激活范围后，Manager 基于记录创建活动实例**
3. **chunk 卸载时，活动实例被停用/销毁，但持久态记录保留**
4. **再次进入范围时，再从持久态记录恢复活动实例**

这意味着：
- 不能再依赖“实例一直挂在 manager 里，远离也不回收”的隐式行为
- 必须把“按 chunk 激活/停用”设计成显式 API

### 5.2 放置流程

#### `turret`
1. 通过 `world.setBlock()` 写入底座与柱子到 `blockData`
2. 写入或更新 `runtimeEntities.byType.turrets`
3. 若 owner chunk 当前已激活，则创建 `Turret` 实例并挂 scene

#### `zombieNest`
1. 通过结构 loader 落地巢穴方块到 `blockData`
2. 写入 `runtimeEntities.byType.zombieNests`
3. 若 owner chunk 已激活，则创建 `ZombieNest` 逻辑实例

#### `minecart`
1. 校验轨道方块存在
2. 写入 `runtimeEntities.byType.minecarts`
3. 若 owner chunk 已激活，则创建 `Minecart` 实例并让 instanced renderer 纳入渲染

### 5.3 chunk 卸载流程

这是上次方案完全没定义清楚的部分。

修订后要求：

#### `turret`
- 卸载 owner chunk 前，销毁炮塔活动实例的独立视觉对象
- **不得删除 `runtimeEntities` 记录**
- **不得删除底座/柱子 `blockData`**

#### `zombieNest`
- 卸载 owner chunk 前，销毁逻辑实例
- 结构方块会随着 chunk 自身卸载而消失，无需额外清理
- **不得删除 `runtimeEntities` 记录**

#### `minecart`
- 先停止运动、落盘最新状态
- 再销毁活动实例
- **不得删除 `runtimeEntities` 记录**

### 5.4 chunk 恢复流程

恢复必须放在 chunk 地形/方块准备完成之后，否则完整性检查和依赖方块查询会读到不完整状态。

统一顺序：
1. `blockData` 注入
2. 普通方块 mesh / consolidation 基础准备完成
3. `runtimeEntities` 进入 `pendingRuntimeEntities`
4. `finalizeNonDeferredPhase()` 或等价阶段调用 manager 的 `restoreForChunk()`

### 5.5 交互删除 / 结构损坏流程

#### `turret`
- 若关键柱子被破坏，活动实例销毁
- 同步删除其 `runtimeEntities` 记录
- 底座/残余方块是否保留，按当前玩法决定；第一期保持现状，只删除逻辑实体记录

#### `zombieNest`
- 若 `criticalBlock` 被破坏，活动实例销毁
- 同步删除 `runtimeEntities` 记录
- 结构残骸是否自动清理，不属于本次持久化改造范围

#### `minecart`
- 拾取/爆炸/碰撞销毁时，删除 `runtimeEntities` 记录
- 轨道方块仍由普通 `blockData` 自己管理

---

## 6. 渲染与 consolidation 的正确关系

这是本次设计里最容易被说混的一段，必须明确。

### 6.1 哪些进入 chunk consolidation

进入 chunk consolidation / AO / face culling 体系的只有：
- 普通方块
- `turret` 的底座和柱子
- `zombieNest` 的结构方块
- 轨道方块

### 6.2 哪些不进入 chunk consolidation

不进入 chunk consolidation 的有：
- `turret` 的炮塔头、炮管、瞄准器
- `minecart` 整体
- `zombieNest` 的逻辑实体本身

### 6.3 结论

因此，`runtimeEntities` 不负责“把特殊形状塞回 blockData”。

它负责的是：
- 哪些逻辑/运行时实体应该存在
- 这些实体恢复时需要哪些最小状态
- 它们和 `blockData` 的依赖关系是什么

而真正的视觉落地方式分三类：
- **纯 blockData 渲染**：`zombieNest` 结构
- **纯 runtime renderer 渲染**：`minecart`
- **混合渲染**：`turret`

---

## 7. 必须新增的基础设施

### 7.1 不能再让 Manager 直接操作 `WorldStore`

修订后需要一个统一仓储层，例如：
- `src/world/runtime-entities/RuntimeEntityRepository.js`

它负责：
- `loadChunkRuntimeEntities(cx, cz)`
- `upsertEntity(ownerCx, ownerCz, entityRecord)`
- `removeEntity(ownerCx, ownerCz, type, id)`
- `moveEntity(fromCx, fromCz, toCx, toCz, entityRecord)`
- `migrateLegacyEntitiesIfNeeded(cx, cz, legacySnapshot)`

### 7.2 仓储层必须提供“按 chunk 串行化更新”

必须新增类似接口：

```js
await runtimeEntityRepository.updateChunkRuntimeEntities(cx, cz, updater)
```

要求：
- 同一 chunk 的更新在仓储层串行化
- `updater` 以最新 `runtimeEntities` 为输入
- 返回新的 `runtimeEntities`
- 避免 Manager 自己读改写造成覆盖

### 7.3 必须新增活动实例生命周期 API

三个 manager 都要补齐：
- `activateChunkEntities(cx, cz, records)`
- `deactivateChunkEntities(cx, cz, options)`
- `serializeActiveEntity(instance)`
- `deserializeEntity(record)`

当前 `restoreXxxForChunk()` 只覆盖了“恢复”，没有对称的“卸载停用”语义，不够。

---

## 8. 旧机制兼容与迁移策略

### 8.1 为什么不能直接删掉旧 `cache.entities`

因为当前项目还存在 `Chunk.gen()` / `assembleEntityPhase()` 这条旧快照路径。只动 runtime-streaming 路径会导致：
- 新生成 chunk 与纯加载 chunk 行为不一致
- 旧存档、旧会话缓存无法被一次性迁移

### 8.2 兼容原则

第一阶段采取“双读单写”兼容：
- **写入**：只写 `worldStore.runtimeEntities`
- **读取**：优先读 `worldStore.runtimeEntities`，若为空，再读旧 `snapshot.entities` / `cache.entities` 做一次迁移

### 8.3 迁移落点

迁移动作必须集中在一个位置，不能散落在三个 manager 里。

推荐：
- 在 `RuntimeEntityRepository.migrateLegacyEntitiesIfNeeded()` 内完成
- 完成后回写 `worldStore`
- 再把旧 `cache.entities` 标记为已迁移或清空对应字段

---

## 9. WorldRuntime / WorldStore 协同规则

### 9.1 `putChunkRecord` 必须改成字段级合并语义

旧的全对象覆盖语义不再可接受。必须支持：
- `blockData` 只更新 `blockData`
- `runtimeEntities` 只更新 `runtimeEntities`
- 两者互不覆盖

### 9.2 `flushChunk` 只负责块工作集，不负责拼装实体状态

`WorldRuntime.flushChunk()` 的职责应收敛为：
- 把当前 chunk 的 `blockData / staticEntities / runtimeSeedData` 写回
- 不直接拼接特殊实体运行时数据

特殊实体状态由各自 manager 在以下时机独立更新：
- 创建
- 销毁
- 跨 chunk 移动
- 卸载前停用

### 9.3 chunk 卸载前的顺序

必须固定顺序：
1. `minecartManager.deactivateChunkEntities()` 先停止并落盘
2. 其他特殊实体 manager 执行停用
3. `worldRuntime.flushBeforeUnload()` 写回方块工作集
4. `chunk.dispose()`

如果顺序反过来，就会再次出现“chunk 已经删了，flush 才开始读”的问题。

---

## 10. 本次设计的推荐边界

### 10.1 本次必须完成

1. 三类实体统一迁移到 `worldStore.runtimeEntities`
2. 新增统一仓储层，避免 Manager 直接改 `WorldStore`
3. 明确激活/停用语义，补齐 chunk 卸载回收与恢复
4. 打通 runtime-streaming 与旧 snapshot 路径的兼容桥
5. 明确 `blockData` 与 `runtimeEntities` 的职责边界

### 10.2 本次不做

1. 把所有特殊实体都抽成通用 ECS
2. 完全删除 `persistenceService.cache`
3. 重写 `Chunk.gen()` 整条旧路径
4. 把敌人、炮弹、掉落物也一起迁移到 runtimeEntities

---

## 11. 设计结论

修订后的核心原则只有三条：

1. **`IndexedDB / worldStore` 是唯一权威源，Manager 活动实例只是投影。**
2. **特殊实体不能再按一种类型统一对待，必须区分“纯逻辑、纯渲染、混合渲染”。**
3. **这个改造不是只改保存位置，而是要补齐 lifecycle、merge 语义、兼容桥和卸载恢复机制。**

如果不先补这四个基础能力，继续按上一次的计划去 patch，只会反复掉进“局部看起来对，跑起来还是错”的循环。
