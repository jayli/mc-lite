# Research: Minecart (矿车系统)

**Branch**: `001-minecart-feature` | **Date**: 2026-03-28

## 研究任务与结论

### 1. 实体系统实现模式

**任务**: 研究现有 Turret/ZombieNest 实体的实现模式

**Decision**: 采用 Turret 的实体模式作为 Minecart 实现参考

**Rationale**:
- Turret 是独立 3D 实体，不参与 instancedMesh，与矿车需求一致
- TurretManager 提供完整的生命周期管理（创建、更新、销毁、持久化）
- TurretPlacementHandler 展示了放置约束检查和执行流程

**Alternatives considered**:
- ZombieNest 模式：需要 chunk 方块配合，不适合矿车的独立实体特性
- JSON Entity 模式：需要预先定义方块结构，矿车是动态实体不适合

**关键代码参考**:
- `src/actors/turret/Turret.js`: 实体类结构、3D模型构建、销毁逻辑
- `src/actors/turret/TurretManager.js`: 实体管理、位置索引、持久化
- `src/actors/turret/TurretPlacementHandler.js`: 放置检查、方向同步

### 2. 矿车3D模型构建

**任务**: 确定矿车模型的几何构建方式

**Decision**: 使用 Three.js BoxGeometry + CylinderGeometry 组合

**Rationale**:
- 车斗：BoxGeometry(0.8, 0.4, 0.8)，上开口箱形（移除顶面或使用 LineSegments 绘制边框）
- 车轮：CylinderGeometry(0.1, 0.1, 0.1, 8) × 4，轴距 0.8 方块
- 参考 Turret.createTurretTopBlocks() 的组合 Mesh 模式

**尺寸规格**:
```
车斗: 0.8 × 0.4 × 0.8 (宽×高×深)
车轮: 直径 0.2，厚度 0.1
轴距: 前后轮间距 0.8 方块宽度
轮距: 左右轮间距 约 0.6 方块宽度
整体边界盒: 1.0 × 0.6 × 1.0 (在 1x1x1 方块内)
```

**Alternatives considered**:
- GLTF 模型加载：增加资源依赖，不符合宪法 VI（JS 重实现原则）
- 单一合并几何：不利于后续动画（车轮旋转）

### 3. EntityRegistry 注册机制

**任务**: 确定矿车物品如何注册到实体系统

**Decision**: 创建 MinecartPlacementHandler 并注册到 EntityRegistry

**Rationale**:
- 现有系统已支持通过 EntityRegistry 注册特殊方块处理器
- `mine_cart` 方块类型触发 MinecartPlacementHandler
- 放置时检查目标位置是否为铁轨方块

**注册流程**:
```javascript
// 在 Game.js 初始化时
const minecartPlacementHandler = new MinecartPlacementHandler({
  player, world, game, minecartManager
});
entityRegistry.register('mine_cart', minecartPlacementHandler);
```

### 4. 持久化策略

**任务**: 确定矿车如何与现有持久化系统集成

**Decision**: 扩展 PersistenceService 支持 minecarts 实体存储

**Rationale**:
- 矿车绑定到所在铁轨的 chunk
- chunk 快照结构扩展: `{ blocks, entities, minecarts }`
- chunk 加载时恢复矿车，卸载时销毁矿车

**存储格式**:
```javascript
// chunkKey: "cx,cz"
{
  blocks: { "x,y,z": { type, orientation } },
  entities: [],
  minecarts: [
    { id, x, y, z, orientation }
  ]
}
```

**Alternatives considered**:
- 独立 minecarts 表：增加查询复杂度，不符合 chunk 绑定需求
- 不持久化：用户重新进入游戏后矿车丢失，不可接受

### 5. 铁轨方向获取

**任务**: 确定如何获取铁轨方块的 orientation

**Decision**: 使用 World.getBlockWithOrientation() 或解析方块条目

**Rationale**:
- 铁轨方块 `sand_train_track` 和 `sand_train_track_corner` 已有 orientation 属性
- OrientationUtils.parseBlockEntry() 可解析方向值
- 矿车方向直接同步铁轨 orientation

**方向映射**:
```
orientation 0 (EAST)  → 矿车朝东
orientation 1 (SOUTH) → 矿车朝南
orientation 2 (WEST)  → 矿车朝西
orientation 3 (NORTH) → 矿车朝北
```

## 未解决问题

> 无。所有 NEEDS CLARIFICATION 已在本阶段解决。

## 依赖与风险

### 依赖项
- OrientationUtils.js (方向解析)
- EntityRegistry.js (实体注册)
- PersistenceService.js (持久化扩展)
- MaterialManager.js (材质加载)

### 风险项
- **低**: 弯轨 orientation 定义可能与预期不同，需要实际测试验证
- **低**: 多矿车场景下的碰撞检测性能，建议限制单 chunk 矿车数量

## 下一步

Phase 1 将生成:
1. `data-model.md` - 矿车实体数据模型
2. `quickstart.md` - 快速启动指南