# Data Model: 炮塔与丧尸巢穴实体封装重构

**Feature**: 026-turret-nest-encapsulation
**Date**: 2026-03-21

## Entity Registry

### EntityRegistry

管理所有实体放置处理器的注册表。

| Field | Type | Description |
|-------|------|-------------|
| handlers | Map<string, EntityPlacementHandler> | 方块类型到处理器的映射 |

### Methods

- `register(blockType: string, handler: EntityPlacementHandler): void` - 注册处理器
- `getHandler(blockType: string): EntityPlacementHandler | undefined` - 获取处理器
- `isSpecialBlock(blockType: string): boolean` - 检查是否为特殊方块
- `unregister(blockType: string): void` - 注销处理器

## Entity Placement Handlers

### EntityPlacementHandler (Base Class)

所有实体放置处理器的基类。

| Field | Type | Description |
|-------|------|-------------|
| player | Player | 玩家实例引用 |
| world | World | 世界实例引用 |
| game | Game | 游戏实例引用 |

### Methods

- `canPlace(x: number, y: number, z: number): boolean` - 检查是否可以放置
- `place(x: number, y: number, z: number): boolean` - 执行放置操作
- `getRequiredSpace(): Array<{dx: number, dy: number, dz: number}>` - 获取所需空间

### TurretPlacementHandler

炮塔放置处理器。

**依赖**:
- TurretManager

**放置逻辑**:
1. 检查炮塔数量限制
2. 检查底座 3x3 空间
3. 检查 obsidian 柱子上方空间
4. 放置 iron_ore 底座
5. 放置 obsidian 柱子
6. 创建 Turret 实例

### ZombieNestPlacementHandler

丧尸巢穴放置处理器。

**依赖**:
- ZombieNestManager
- StructureLoader

**放置逻辑**:
1. 检查巢穴数量限制
2. 从 StructureLoader 获取结构方块
3. 检查所有位置是否可用
4. 放置结构方块
5. 创建 ZombieNest 实例

## Modified Classes

### PlayerInteraction (Modified)

**移除的字段**: N/A

**修改的方法**:
- `tryPlaceBlock(x, y, z, type): boolean`
  - 移除硬编码的 `turret_alias_block` 和 `zombie_nest_alias_block` 检查
  - 改为查询 EntityRegistry

**移除的方法**:
- `tryPlaceTurret(x, y, z): boolean` - 移至 TurretPlacementHandler
- `getZombieNestStructureBlocks(x, y, z): Array | null` - 移至 ZombieNestPlacementHandler
- `canPlaceZombieNestAt(structureBlocks): boolean` - 移至 ZombieNestPlacementHandler
- `applyStructureBlocks(blocks): void` - 移至 ZombieNestPlacementHandler

### Game (Modified)

**新增字段**:
- `entityRegistry: EntityRegistry` - 实体注册表

**修改的方法**:
- `init()`: 初始化 EntityRegistry 并注册处理器
- `update(dt)`: 保持直接调用 turretManager.update

**保留的字段**:
- `turretManager: TurretManager` - 保持不变
- `zombieNestManager: ZombieNestManager` - 保持不变

## Relationships

```
Game
├── entityRegistry: EntityRegistry
│   ├── handlers: Map
│   │   ├── "turret_alias_block" -> TurretPlacementHandler
│   │   └── "zombie_nest_alias_block" -> ZombieNestPlacementHandler
├── turretManager: TurretManager
├── zombieNestManager: ZombieNestManager
└── player: Player
    └── playerInteraction: PlayerInteraction
        └── entityRegistry (via game)

TurretPlacementHandler
├── turretManager (dependency)
└── player (via constructor)

ZombieNestPlacementHandler
├── zombieNestManager (dependency)
├── structureLoader (via import)
└── player (via constructor)
```

## State Transitions

### Entity Placement Flow

```
PlayerInteraction.tryPlaceBlock(x, y, z, type)
    │
    ▼
EntityRegistry.isSpecialBlock(type)?
    │
    ├─ Yes ──▶ handler = EntityRegistry.getHandler(type)
    │          │
    │          ▼
    │          handler.canPlace(x, y, z)?
    │              │
    │              ├─ Yes ──▶ handler.place(x, y, z)
    │              │              │
    │              │              ▼
    │              │              Return boolean result
    │              │
    │              └─ No ────▶ Return false
    │
    └─ No ───▶ Regular block placement
```

## Validation Rules

### TurretPlacementHandler.canPlace

1. TurretManager 必须可用
2. 当前炮塔数量 < maxTurrets
3. 底座 3x3 空间可用
4. obsidian 柱子上方空间可用
5. 不与玩家碰撞

### ZombieNestPlacementHandler.canPlace

1. ZombieNestManager 必须可用
2. 当前巢穴数量 < maxNests
3. 所有结构方块位置可用
4. 不与玩家碰撞
5. StructureLoader 已加载数据
