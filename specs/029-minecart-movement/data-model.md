# Data Model: Minecart Movement (矿车移动功能)

**Feature**: 029-minecart-movement
**Date**: 2026-03-29

## 概述

本文档定义矿车移动功能涉及的数据实体、状态和关系。

---

## Entity: Minecart (重构)

矿车实体类，**仅存储数据状态，不包含渲染逻辑**。渲染由 MinecartInstancedRenderer 统一处理。

### 属性

| 属性名 | 类型 | 描述 | 默认值 |
|--------|------|------|--------|
| id | string | 唯一标识符 | 自动生成 |
| position | THREE.Vector3 | 当前位置 | - |
| orientation | number | 朝向 (0-3) | 0 |
| state | string | 基础状态 (PLACED/DESTROYED) | 'PLACED' |
| movementState | string | 移动状态 | 'IDLE' |
| lastTrackPosition | object | 最近经过的铁轨位置 | null |
| velocity | object | 当前速度向量 {x, z} | {x: 0, z: 0} |
| linkedMinecarts | Set<string> | 链接的矿车 ID | new Set() |

### 重要变更

| 原属性 | 变更 |
|--------|------|
| mesh (THREE.Group) | **移除** - 渲染迁移到 MinecartInstancedRenderer |
| createVisuals() | **移除** - 渲染迁移到 MinecartInstancedRenderer |
| updateTransform() | **移除** - 渲染迁移到 MinecartInstancedRenderer |

### 状态枚举

**movementState 枚举**:
```
IDLE              - 静止状态
MOVING_FORWARD    - 前进状态
MOVING_BACKWARD   - 后退状态
```

### 状态转换

```
IDLE → MOVING_FORWARD  (ctrl+左键激发)
IDLE → MOVING_BACKWARD (ctrl+shift+左键激发)
MOVING_FORWARD → IDLE  (到达终点/碰撞/拾取)
MOVING_BACKWARD → IDLE (到达终点/碰撞/拾取)
```

### 验证规则

| 规则 | 描述 |
|------|------|
| orientation 有效 | 必须在 0-3 范围内 |
| position 整数坐标 | 停止时必须为标准方块坐标 |
| linkedMinecarts ≤ 10 | 链接矿车数量不超过上限 |

---

## Entity: MinecartInstancedRenderer (新增)

矿车 InstancedMesh 批量渲染器，参照 ZombieInstancedRenderer 设计。

### 属性

| 属性名 | 类型 | 描述 |
|--------|------|------|
| scene | THREE.Scene | 场景引用 |
| maxCount | number | 最大渲染数量 (默认 50) |
| bodyGeometry | THREE.BufferGeometry | 共享车斗几何体 (倒梯形) |
| wheelGeometry | THREE.CylinderGeometry | 共享车轮几何体 |
| bodyMaterial | THREE.MeshLambertMaterial | 共享车斗材质 |
| wheelMaterial | THREE.MeshLambertMaterial | 共享车轮材质 |
| bodyMesh | THREE.InstancedMesh | 车斗实例化网格 |
| wheelMesh | THREE.InstancedMesh | 车轮实例化网格 |
| instanceMap | Array | 索引到矿车对象的映射 |
| dummy | THREE.Object3D | 临时对象（避免帧内创建） |

### 方法

| 方法 | 描述 |
|------|------|
| update(minecarts) | 更新所有矿车的实例化渲染 |
| updateBodyMatrix(minecart, index) | 更新车斗矩阵 |
| updateWheelMatrices(minecart, index) | 更新4个车轮矩阵 |
| dispose() | 释放所有资源 |

---

## Entity: MinecartMovementConfig (新增)

移动配置常量，存储在 GameConfig.js。

### 属性

| 属性名 | 类型 | 描述 | 值 |
|--------|------|------|-----|
| MINECART_SPEED | number | 移动速度 (方块/秒) | 1.0 |
| MAX_LINKED_MINECARTS | number | 最大链接数 | 10 |
| TRACK_BLOCK_TYPES | string[] | 铁轨方块类型 | ['sand_train_track', 'sand_train_track_corner'] |

---

## Entity: TrackDirectionMap

铁轨方向映射表，定义 orientation 到方向向量的映射。

### 映射关系

| orientation | 方向名 | 前进向量 | 后退向量 |
|-------------|--------|----------|----------|
| 0 | EAST | (1, 0, 0) | (-1, 0, 0) |
| 1 | SOUTH | (0, 0, 1) | (0, 0, -1) |
| 2 | WEST | (-1, 0, 0) | (1, 0, 0) |
| 3 | NORTH | (0, 0, -1) | (0, 0, 1) |

---

## Entity: MinecartLink

矿车链接关系，临时的动态关系。

### 属性

| 属性名 | 类型 | 描述 |
|--------|------|------|
| minecartId | string | 矿车 ID |
| frontMinecartId | string \| null | 前方链接矿车 ID |
| backMinecartId | string \| null | 后方链接矿车 ID |

### 关系图

```
[A] ←→ [B] ←→ [C] ←→ [D]

双向链接，任一矿车激发，所有矿车同步移动
```

---

## Entity: MinecartCollision

碰撞检测结果。

### 属性

| 属性名 | 类型 | 描述 |
|--------|------|------|
| minecartA | Minecart | 碰撞方 A |
| minecartB | Minecart | 碰撞方 B |
| collisionType | string | 碰撞类型 |
| collisionPosition | object | 碰撞位置 |
| shouldBounce | boolean | 是否需要回弹 |

### 碰撞类型枚举

```
PUSH        - 推动碰撞 (运动矿车碰撞静止矿车)
HEAD_ON     - 相向碰撞 (两矿车相向运动)
```

---

## Entity Relationships

```
MinecartManager
    │
    ├── manages → Minecart (1:N)
    │               │
    │               ├── has → movementState
    │               ├── has → linkedMinecarts
    │               └── references → lastTrackPosition
    │
    └── uses → MinecartMovementSystem
    │
    └── uses → MinecartLinkDetector
    │
    └── uses → MinecartCollisionSystem

PlayerInteraction
    │
    ├── triggers → Minecart.movementState (ctrl+左键)
    │
    └ uses → MinecartManager (查询矿车)
```

---

## Persistence

矿车移动状态需要持久化，扩展 Minecart.toJSON 方法。

### 序列化格式

```json
{
  "id": "minecart_xxx",
  "x": 10,
  "y": 5,
  "z": 20,
  "orientation": 0,
  "movementState": "IDLE",
  "lastTrackX": 10,
  "lastTrackY": 5,
  "lastTrackZ": 20
}
```

**Note**: linkedMinecarts 不持久化，链接关系在加载时重新检测。