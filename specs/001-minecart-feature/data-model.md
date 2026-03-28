# Data Model: Minecart (矿车系统)

**Branch**: `001-minecart-feature` | **Date**: 2026-03-28

## 实体定义

### Minecart (矿车实体)

```javascript
{
  // === 标识 ===
  id: string,              // 唯一标识符 (UUID)

  // === 位置与方向 ===
  position: {              // 方块坐标
    x: number,
    y: number,
    z: number
  },
  orientation: number,     // 朝向 (0-3: EAST/SOUTH/WEST/NORTH)

  // === 状态 ===
  state: 'PLACED' | 'PICKED_UP' | 'DESTROYED',

  // === 运行时引用 (不持久化) ===
  mesh: THREE.Group,       // 3D模型组 (车斗+四轮)
  chunkKey: string,        // 归属 chunk 键 "cx,cz"
}
```

**状态转换图**:
```
         place()
[无] ────────────► [PLACED] ────────────► [DESTROYED]
                        │   pickUp()          ▲
                        └─────────────────────┘
                          爆炸/破坏时直接消失
```

### MinecartManager (矿车管理器)

```javascript
{
  // === 存储结构 ===
  minecarts: Map<string, Minecart>,     // id → Minecart
  positionIndex: Map<string, string>,   // "x,y,z" → minecartId

  // === 配置 ===
  maxMinecarts: number,                 // 最大矿车数量 (默认 50)

  // === 引用 ===
  scene: THREE.Scene,
  world: World,
}
```

### MinecartPlacementHandler (放置处理器)

```javascript
{
  // === 依赖注入 ===
  player: Player,
  world: World,
  game: Game,
  minecartManager: MinecartManager,

  // === 方法 ===
  canPlace(x, y, z): boolean,    // 检查放置条件
  place(x, y, z): boolean,       // 执行放置
}
```

## 方块数据扩展

### mine_cart (物品方块)

```javascript
// BlockData.js 新增
'mine_cart': {
  isSolid: false,           // 物品形式不参与碰撞
  isTransparent: true,
  isRendered: false,        // 物品不渲染方块网格
  isShadowEnabled: false,
  orientationEnabled: false  // 物品不需要方向
}
```

### 背包注册

```javascript
// Inventory.js 或初始化配置中
{
  type: 'mine_cart',
  name: '矿车',
  icon: 'src/assets/textures/Invicon_Minecart.png',
  maxStack: 1,              // 不支持堆叠
  category: 'tools'         // 分类
}
```

### 铁轨方块 (现有)

```javascript
'sand_train_track': { orientationEnabled: true },
'sand_train_track_corner': { orientationEnabled: true }
```

## 持久化数据格式

### Chunk 快照扩展

```javascript
// 原: { blocks: {}, entities: [] }
// 新: { blocks: {}, entities: [], minecarts: [] }

{
  "cx,cz": {
    blocks: {
      "0,64,0": { type: "sand_train_track", orientation: 0 }
    },
    entities: [],
    minecarts: [
      {
        id: "uuid-xxx",
        x: 0, y: 65, z: 0,  // 矿车在铁轨上方
        orientation: 0
      }
    ]
  }
}
```

## 验证规则

### 放置验证
| 条件 | 验证 | 错误提示 |
|------|------|----------|
| 目标方块是铁轨 | `type in ['sand_train_track', 'sand_train_track_corner']` | "只能在铁轨上放置" |
| 铁轨未被占用 | `!positionIndex.has(posKey)` | "该铁轨已有矿车" |
| 矿车数量未超限 | `minecarts.size < maxMinecarts` | "矿车数量已达上限" |

### 拾取验证
| 条件 | 验证 |
|------|------|
| 点击位置有矿车 | `positionIndex.has(posKey)` |
| 玩家背包有空位 | `inventory.canAdd('mine_cart')` |

## 关系图

```
┌─────────────────────────────────────────────────────────┐
│                      Game.js                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │    World    │  │ EntityRegistry│  │MinecartManager │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                   │           │
│         ▼                ▼                   ▼           │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Chunk     │  │MinecartPlacement│  │  Minecart   │  │
│  │ (铁轨方块)  │  │    Handler      │  │  (实体)     │  │
│  └─────────────┘  └─────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 内存管理

### 矿车销毁流程
1. 从 scene 移除 mesh
2. 递归 dispose 所有 geometry
3. dispose 所有 material
4. 从 minecarts Map 删除
5. 从 positionIndex 删除
6. 从持久化快照移除