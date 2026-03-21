# Quickstart: 炮塔与丧尸巢穴实体封装重构

**Feature**: 026-turret-nest-encapsulation
**Date**: 2026-03-21

## Overview

本次重构引入实体注册表模式，将散落在各模块的炮塔和丧尸巢穴特殊处理逻辑集中到统一的注册表和放置处理器中。

## Key Changes

### 1. PlayerInteraction.js

**Before**:
```javascript
tryPlaceBlock(x, y, z, type) {
  // 特殊处理：炮塔方块放置时生成炮塔而非放置方块
  if (type === 'turret_alias_block') {
    return this.tryPlaceTurret(x, y, z);
  }

  // 特殊处理：丧尸巢穴方块放置时生成完整结构
  if (type === 'zombie_nest_alias_block') {
    return this.tryPlaceZombieNest(x, y, z);
  }
  // ...
}
```

**After**:
```javascript
tryPlaceBlock(x, y, z, type) {
  // 检查是否为注册的特殊方块
  if (this.game.entityRegistry.isSpecialBlock(type)) {
    const handler = this.game.entityRegistry.getHandler(type);
    if (!handler.canPlace(x, y, z)) return false;
    return handler.place(x, y, z);
  }
  // ...
}
```

### 2. Game.js

**Before**:
```javascript
init() {
  this.turretManager = new TurretManager(...);
  this.zombieNestManager = new ZombieNestManager(...);
}
```

**After**:
```javascript
init() {
  this.turretManager = new TurretManager(...);
  this.zombieNestManager = new ZombieNestManager(...);

  // 初始化实体注册表
  this.entityRegistry = new EntityRegistry();
  this.entityRegistry.register('turret_alias_block',
    new TurretPlacementHandler(this.player, this.world, this.turretManager));
  this.entityRegistry.register('zombie_nest_alias_block',
    new ZombieNestPlacementHandler(this.player, this.world, this.zombieNestManager));
}
```

## New Files

### src/actors/entity-registry/EntityRegistry.js

实体注册表，管理所有特殊方块类型的放置处理器。

### src/actors/entity-registry/EntityPlacementHandler.js

放置处理器基类，定义统一接口。

### src/actors/turret/TurretPlacementHandler.js

炮塔放置处理器，封装炮塔放置逻辑。

### src/actors/zombie-nest/ZombieNestPlacementHandler.js

丧尸巢穴放置处理器，封装巢穴放置逻辑。

## Testing

### 功能测试

1. 放置炮塔 - 验证方块正确放置，炮塔实例创建
2. 放置丧尸巢穴 - 验证结构正确放置，巢穴实例创建
3. 数量限制 - 验证达到上限后无法继续放置
4. 空间检查 - 验证占用位置无法放置

### 性能测试

1. 交互延迟 - 放置操作响应时间 < 50ms
2. 内存使用 - 无内存泄漏
3. FPS - 保持 60 FPS

## Adding New Entity Type

To add a new complex entity (e.g., Trap):

1. **Create Placement Handler**:
```javascript
// src/actors/trap/TrapPlacementHandler.js
import { EntityPlacementHandler } from '../entity-registry/EntityPlacementHandler.js';

export class TrapPlacementHandler extends EntityPlacementHandler {
  canPlace(x, y, z) {
    // Check placement conditions
  }

  place(x, y, z) {
    // Place blocks and create entity
  }
}
```

2. **Register in Game.js**:
```javascript
// In Game.init()
this.entityRegistry.register('trap_alias_block',
  new TrapPlacementHandler(this.player, this.world, this.trapManager));
```

3. **Done!** No changes needed to PlayerInteraction.js
