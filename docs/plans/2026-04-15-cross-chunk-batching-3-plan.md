# Cross-Chunk Batching 3 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `355857bf37e76018761be54c48607873811cbafa` 基线之上，先实现一个高性能、可扩容、可验证、但暂不接管现有渲染主路径的 `GlobalBlockMeshManager` 底层算法，为后续真正的跨 chunk / 跨实体全局合批提供稳定内核。

**Architecture:** 第一阶段只做“算法内核”和“测试/自检闭环”，不改 `Chunk`、`ChunkConsolidation`、`PlayerInteraction`、`World` 的运行时主路径，不让现有 chunk 级 InstancedMesh 渲染逻辑下线。新管理器以 `TypePool` 为单位维护同类型方块的全局槽位池，使用 `swap-and-pop` 保持活跃实例连续、删除 O(1)、命中反查 O(1)、扩容按倍增进行，并显式维护 worldKey、slot、chunkKey 三类索引的不变量。

**Tech Stack:** Three.js v0.160.0, ES Modules, 浏览器内测试页 `src/tests/index.html`

---

## 计划 Review 结论

下面是对上一版计划的正式 review。不是方向错，而是分期不对。

### 发现 1：第一阶段范围过大

上一版计划在第一阶段同时修改了：

- `src/world/World.js`
- `src/world/Chunk.js`
- `src/world/ChunkGenerator.js`
- `src/world/ChunkConsolidation.js`
- `src/world/ChunkRenderUtils.js`
- `src/actors/player/PlayerInteraction.js`

这等于把“底层存储算法”“全局 mesh 接管”“射线命中恢复坐标”“AO 回写”“consolidation 回包幂等”“chunk 卸载回收”六条链路同时改掉。前几次失败恰恰说明，这种改法会把 bug 混在一起，出现“删不掉”“删后复活”“重叠闪现”“owner 混乱”时，很难判断是算法错、索引错、还是接入时序错。

### 发现 2：上一版 `free list + tailSlot` 不够适合作为第一阶段核心算法

上一版计划的核心池结构是 `freeSlots + tailSlot`。它能做到均摊 O(1)，但有两个问题：

- `mesh.count` 会长期停留在 `tailSlot`，中间空洞依靠零缩放实例隐藏，射线、draw range、缓存局部性都更复杂。
- 删除后不做交换压缩，`instanceId -> worldKey` 的命中映射虽然仍可做，但长期空洞会让后续调试和验证更难。

第一阶段更合适的内核是 `swap-and-pop`：

- 新增：放到 `count`
- 删除：把最后一个活跃槽位交换到被删除槽位，再 `count--`
- 命中：`instanceId` 始终只落在 `[0, count)` 的活跃区间
- 渲染：`mesh.count = count`

这比“空洞 + 隐藏矩阵”的模型更适合作为全局管理器的底层真相源。

### 发现 3：上一版把“底层算法文件”和“现有渲染几何来源”绑死了

上一版建议在 `GlobalBlockMeshManager.js` 中直接依赖 `ChunkConsolidation.js` 的 `geomMap`。这在真正接入时未必一定错，但第一阶段不应把新算法核心和现有 chunk/consolidation 模块形成强耦合，更不应提前制造潜在循环依赖。

第一阶段应把几何体/材质获取抽成注入式依赖：

- `geometryResolver(blockType) -> BufferGeometry`
- `materialResolver(blockType) -> Material`
- `attributePolicy(blockType) -> { usesAO, usesOrientation, castsShadow, receivesShadow }`

这样第一阶段先验证算法，不把现有渲染管线的历史包袱带进核心模块。

### 发现 4：上一版缺少“真正确保不影响现有行为”的隔离策略

你这次明确要求：

- 先不修改基于 chunk 的 InstancedMesh 归一管理
- 渲染管线尽量不要动
- 不要影响渲染、碰撞、AO 等逻辑

上一版计划虽然口头上说“最小改动”，但任务拆分仍然直接改了主链路。这和要求不一致。

### 发现 5：上一版缺少可验证的不变量与压力测试任务

全局 InstancedMesh 管理器如果没有以下验证，后面很容易再次重演“看起来能跑，实际会复活/重叠/丢失”：

- `worldKey -> slot -> worldKey` 一致性
- `chunkKey -> keys` 与 `worldKey -> meta.chunkKey` 一致性
- 扩容后矩阵、AO、自定义 attribute 数据不丢失
- 删除后被交换过来的最后一个实例索引被正确回写
- 重复 upsert 同一 worldKey 不会生成重复实例
- 跨类型迁移时旧池与新池索引都正确清理

---

## 本次修订后的范围

第一阶段只做底层算法，不做运行时接管。

### 本阶段明确会做

- 新增 `src/world/GlobalBlockMeshManager.js`
- 新增浏览器测试文件，覆盖核心不变量和扩容/删除场景
- 在测试页注册这些新测试
- 提供可选的调试自检接口，便于后续运行时集成前先验证内部一致性

### 本阶段明确不会做

- 不让 `Chunk` 停止创建或持有自己的 InstancedMesh
- 不改 `PlayerInteraction.getInteractionTargets()`
- 不改 `PlayerInteraction.removeBlock()` 的主路径
- 不改 `ChunkGenerator.buildMeshes()`
- 不改 `ChunkConsolidation._applyConsolidateResult()`
- 不改 `World.removeBlock()` / `World.setBlock()` 的现有行为
- 不让 `static_tree`、`house`、`modGunMan`、`rover`、矿车、丧尸、炮弹进入新管理器

### 为什么这样分期

因为你现在最缺的不是“又一次接管运行时”的方案，而是一个可以证明自己不会乱的底层真相源。先把这个模块做成：

- 独立
- 可测
- 可压测
- 可证明不变量成立

后面的接入才有意义。

---

## 第一阶段推荐算法

推荐采用 `swap-and-pop`，不采用 `free list + 零缩放空洞` 作为核心真相结构。

### 推荐方案：`swap-and-pop` 紧凑活跃区

每个 `TypePool` 维护：

- `mesh`
- `count`
- `capacity`
- `slotToWorldKey`
- `worldKeyToSlot`

删除流程：

1. 找到待删 `slot`
2. 取最后一个活跃槽位 `lastSlot = count - 1`
3. 如果 `slot !== lastSlot`，把 `lastSlot` 的矩阵与 attribute 拷到 `slot`
4. 更新被交换 worldKey 的 `worldKeyToSlot`
5. 清空 `lastSlot`
6. `count--`
7. `mesh.count = count`

优点：

- 活跃槽位连续
- 删除稳定 O(1)
- 命中只处理有效实例区间
- 更适合后续射线命中与实例索引恢复

### 备选方案：`free list + tailSlot`

优点是实现直观，但第一阶段不推荐作为主方案。它更适合“少删多增”的对象池，不适合这里这个需要强一致性、后续还要支撑命中反查和批量替换的全局块管理器。

### 拒绝方案：第一阶段直接接管现有 chunk 渲染

当前阶段不做。原因不是做不到，而是你前面三次失败已经说明：把算法、索引、接入、时序一起改，风险过高。

---

## 模块边界

### 新文件

| 文件 | 职责 |
|------|------|
| `src/world/GlobalBlockMeshManager.js` | 全局实例池算法内核，不接入现有 World/Chunk 主路径 |
| `src/tests/test-global-block-mesh-manager.js` | 覆盖新增、删除、扩容、跨类型迁移、批量替换、自检 |

### 需要修改的已有文件

| 文件 | 修改内容 |
|------|----------|
| `src/tests/index.html` | 注册新测试模块 |

### 本阶段不修改的核心运行时文件

- `src/world/World.js`
- `src/world/Chunk.js`
- `src/world/ChunkGenerator.js`
- `src/world/ChunkConsolidation.js`
- `src/world/ChunkRenderUtils.js`
- `src/actors/player/PlayerInteraction.js`

---

## 数据结构设计

### `GlobalBlockMeshManager`

```javascript
class GlobalBlockMeshManager {
  constructor({
    scene,
    geometryResolver,
    materialResolver,
    attributePolicy,
    initialCapacity = 64
  }) {
    this.scene = scene;
    this.geometryResolver = geometryResolver;
    this.materialResolver = materialResolver;
    this.attributePolicy = attributePolicy;
    this.initialCapacity = initialCapacity;

    this.typePools = new Map();      // blockType -> TypePool
    this.worldIndex = new Map();     // worldKey -> { blockType, chunkKey }
    this.chunkIndex = new Map();     // chunkKey -> Set<worldKey>
  }
}
```

### `TypePool`

```javascript
class TypePool {
  constructor({ blockType, mesh, capacity, usesAO, usesOrientation }) {
    this.blockType = blockType;
    this.mesh = mesh;
    this.capacity = capacity;
    this.count = 0;
    this.usesAO = usesAO;
    this.usesOrientation = usesOrientation;
    this.slotToWorldKey = new Array(capacity).fill(null);
    this.worldKeyToSlot = new Map();
  }
}
```

### 关键公开接口

- `upsertBlock(record)`
- `removeBlock(worldKey)`
- `replaceChunkBlocks(chunkKey, records)`
- `unregisterChunk(chunkKey)`
- `updateBlockMatrix(worldKey, matrix)`
- `updateBlockAttributes(worldKey, attrs)`
- `getWorldKeyFromInstance(blockType, instanceId)`
- `getMeshes()`
- `getStats()`
- `validateInvariants()`
- `dispose()`

### `record` 结构

```javascript
{
  worldKey: 'x,y,z',
  chunkKey: 'cx,cz',
  blockType: 'stone',
  matrix: THREE.Matrix4,
  aoLow: 0,
  aoHigh: 0,
  orientation: 0
}
```

### 必须成立的不变量

1. `worldIndex.has(worldKey)` 时，目标池中必须存在同一 `worldKey`
2. `slotToWorldKey[slot] = key` 时，`worldKeyToSlot.get(key) === slot`
3. 每个池都满足 `0 <= count <= capacity`
4. `mesh.count === count`
5. 活跃实例只存在于 `[0, count)`，该区间内 `slotToWorldKey` 不允许为空
6. `[count, capacity)` 必须视为无效区间
7. `chunkIndex` 中每个 `worldKey` 都必须在 `worldIndex` 中存在
8. `upsertBlock` 对同一 `worldKey` 幂等，不允许制造重复实例

---

## 实现细节约束

### 依赖注入

不要在第一阶段把管理器直接绑定到 `ChunkConsolidation.geomMap` 或 `MaterialManager` 的具体历史实现。改为构造参数注入。

这样做的好处：

- 算法层不依赖 chunk/consolidation 文件
- 测试可使用假 geometry / 假 material
- 后续接入时可由 `World` 或专门装配器统一提供 resolver

### Attribute 复制策略

池在扩容和交换时需要统一处理：

- `instanceMatrix`
- `aAoLow`
- `aAoHigh`
- `aOrientation`

不要在每个 API 里散落拷贝逻辑，必须抽成内部辅助方法：

- `_copyInstanceData(fromSlot, toSlot)`
- `_clearSlot(slot)`
- `_ensureCapacity(nextCount)`

### 调试自检

管理器需要暴露：

- `validateInvariants()`：返回 `{ ok, errors }`
- `getStats()`：返回每类方块的 `count/capacity`

后续一旦接入运行时，这两个接口会非常关键。

---

## Task 1: 实现全局实例池核心模块

**Files:**
- Create: `src/world/GlobalBlockMeshManager.js`

- [ ] **Step 1: 定义公开接口和内部数据结构**

在 `src/world/GlobalBlockMeshManager.js` 中创建 `GlobalBlockMeshManager` 和 `TypePool`，先只实现构造、字段、辅助方法占位，不接入现有 World/Chunk。

- [ ] **Step 2: 实现池创建与扩容**

实现按 `blockType` 创建池、按倍增策略扩容、拷贝矩阵与自定义 attribute 的逻辑。

Run: 先不运行测试  
Expected: 模块可被导入，无语法错误

- [ ] **Step 3: 实现 `upsertBlock(record)`**

要求支持：

- 新 worldKey 新增
- 同类型 worldKey 原地更新
- worldKey 类型变化时从旧池迁移到新池
- `chunkIndex` 与 `worldIndex` 同步

- [ ] **Step 4: 实现 `removeBlock(worldKey)`**

使用 `swap-and-pop` 删除，确保被交换过来的 worldKey 索引被回写。

- [ ] **Step 5: 实现批量 API**

实现：

- `replaceChunkBlocks(chunkKey, records)`
- `unregisterChunk(chunkKey)`

要求二者都基于统一索引，不允许出现残留 worldKey。

- [ ] **Step 6: 实现调试与资源释放接口**

实现：

- `getWorldKeyFromInstance(blockType, instanceId)`
- `getMeshes()`
- `getStats()`
- `validateInvariants()`
- `dispose()`

---

## Task 2: 为核心模块补浏览器测试

**Files:**
- Create: `src/tests/test-global-block-mesh-manager.js`
- Modify: `src/tests/index.html`

- [ ] **Step 1: 参考现有测试风格建立测试文件**

按现有 `src/tests/` 风格创建新测试模块，使用假的 `scene / geometry / material resolver`，不要依赖真实游戏场景。

- [ ] **Step 2: 编写新增与命中反查测试**

覆盖：

- 新增一个实例后 `count === 1`
- `getWorldKeyFromInstance()` 能返回正确 worldKey
- `validateInvariants()` 返回通过

- [ ] **Step 3: 编写删除交换测试**

覆盖：

- 连续添加 3 个实例
- 删除中间实例
- 验证最后一个实例被交换到空位
- 验证双向索引被正确回写

- [ ] **Step 4: 编写扩容测试**

覆盖：

- 初始容量设为较小值，如 `2`
- 插入超过容量的实例触发扩容
- 验证扩容前后的矩阵与 attribute 数据仍可读

- [ ] **Step 5: 编写幂等和跨类型迁移测试**

覆盖：

- 同一 worldKey 重复 `upsert`
- worldKey 从 `stone` 迁移到 `glass`
- 旧池清理正确，新池建立正确

- [ ] **Step 6: 编写 chunk 级批量替换测试**

覆盖：

- `replaceChunkBlocks()` 会删除旧集合并写入新集合
- `unregisterChunk()` 会清空该 chunk 的所有 worldKey

- [ ] **Step 7: 在测试入口注册新测试**

把新测试模块加入 `src/tests/index.html` 的加载列表，确保浏览器测试页可直接执行。

Run: 启动 `npm run start` 后访问 `http://localhost:8080/src/tests/index.html`  
Expected: 新测试可见并可执行

---

## Task 3: 补最小文档，明确第二阶段接入边界

**Files:**
- Modify: `docs/plans/2026-04-15-cross-chunk-batching-3-plan.md`

- [ ] **Step 1: 在实现完成后回填实际状态**

把本计划中已完成的部分勾选，并补一段“第二阶段接入范围”说明：

- 从 `ChunkGenerator.buildMeshes()` 接入
- 从 `PlayerInteraction` 接入全局 mesh 命中
- 从 `ChunkConsolidation` 接入幂等替换

- [ ] **Step 2: 明确第二阶段前置条件**

只有当下面条件全部满足，才允许开始第二阶段：

- 浏览器测试全部通过
- `validateInvariants()` 在压力测试下无错误
- 现有运行时行为未被第一阶段改动

---

## 验证清单

### 必做验证

1. 打开浏览器测试页，执行新增测试
2. 确认新增测试全部通过
3. 确认旧测试未因导入副作用报错

### 本阶段不做的验证

- 不验证真实游戏内跨 chunk 合批效果
- 不验证真实游戏内射线命中全局 mesh
- 不验证真实游戏内 AO 回写到全局池

这些都属于第二阶段。

---

## 执行顺序建议

1. 先实现 `GlobalBlockMeshManager` 的纯算法版本
2. 用测试把 `swap-and-pop`、扩容、迁移、批量替换打稳
3. 再决定是否进入第二阶段运行时接入

这比一开始就全链路接管更符合你这次“从原点重来，但先把底层算法做好”的目标。
