# Research: 炮塔与丧尸巢穴实体封装重构

**Feature**: 026-turret-nest-encapsulation
**Date**: 2026-03-21

## Research Tasks Completed

### 1. 现有代码耦合分析

#### PlayerInteraction.js 耦合点

**位置**: `src/actors/player/PlayerInteraction.js`

- **Line 249-258**: `tryPlaceBlock` 中硬编码检查 `turret_alias_block` 和 `zombie_nest_alias_block`
- **Line 289-378**: `tryPlaceTurret` 直接处理：
  - 检查炮塔数量限制
  - 检查底座和上方空间占用
  - 放置 iron_ore 底座和 obsidian 柱子
  - 计算玩家朝向确定炮塔初始旋转
  - 调用 `game.turretManager.createTurret`
  - 消耗物品和播放音效
- **Line 387-436**: `tryPlaceZombieNest` 直接处理：
  - 检查巢穴数量限制
  - 调用 `getZombieNestStructureBlocks` 获取结构方块
  - 检查放置位置是否可用
  - 调用 `applyStructureBlocks` 放置方块
  - 调用 `game.zombieNestManager.createNest`

#### Game.js 耦合点

**位置**: `src/core/Game.js`

- **Line 42-43**: 直接实例化 TurretManager 和 ZombieNestManager
- **Line 46**: `this.world.turretManager = this.turretManager` - 将 manager 暴露给 world
- **Line 336-337**: `update` 循环中直接调用 `this.turretManager.update(dt)`
- **Line 420-421, 546-548**: 直接处理炮塔数据的保存和恢复

### 2. 放置处理器模式设计

#### 决策: 使用策略模式（Strategy Pattern）

**Rationale**:
- 每种实体类型有不同的放置逻辑
- 需要统一的接口供 PlayerInteraction 调用
- 便于后续添加新实体类型

**设计**:
```javascript
// 基类
class EntityPlacementHandler {
  canPlace(x, y, z) { }
  place(x, y, z) { }
}

// 具体实现
class TurretPlacementHandler extends EntityPlacementHandler { }
class ZombieNestPlacementHandler extends EntityPlacementHandler { }
```

### 3. 注册表模式实现策略

#### 决策: 使用 Map 存储注册信息

**Rationale**:
- JavaScript Map 提供 O(1) 查找
- 支持任意类型的 key
- 符合 ES2020+ 标准

**设计**:
```javascript
class EntityRegistry {
  constructor() {
    this.handlers = new Map(); // blockType -> PlacementHandler
  }

  register(blockType, handler) {
    this.handlers.set(blockType, handler);
  }

  getHandler(blockType) {
    return this.handlers.get(blockType);
  }

  isSpecialBlock(blockType) {
    return this.handlers.has(blockType);
  }
}
```

### 4. 替代方案评估

#### 方案 A: 简单条件判断（当前）
- **优点**: 直接，易于理解
- **缺点**: 新增实体类型需要修改 PlayerInteraction

#### 方案 B: 注册表模式（选择）
- **优点**: 新增实体只需注册，无需修改 PlayerInteraction
- **缺点**: 需要额外的基础设施代码

#### 方案 C: 事件驱动
- **优点**: 完全解耦
- **缺点**: 过度设计，增加复杂度

**结论**: 选择方案 B（注册表模式），符合"合理适度的抽象"原则。

## Key Findings

1. **PlayerInteraction 是主要耦合点**: 约 200 行代码与特定实体类型相关
2. **Game.js 是次要耦合点**: manager 实例化和更新逻辑
3. **重构范围**: 主要集中在 PlayerInteraction、Game 和新添加的 Registry 模块
4. **不影响**: Turret.js、TurretManager.js、ZombieNest.js、ZombieNestManager.js 保持现状

## Implementation Notes

1. **注册时机**: 在 Game.js 初始化时注册所有实体处理器
2. **Handler 依赖**: TurretPlacementHandler 依赖 TurretManager，ZombieNestPlacementHandler 依赖 ZombieNestManager
3. **PlayerInteraction 修改**: 将特殊方块检查替换为注册表查询
