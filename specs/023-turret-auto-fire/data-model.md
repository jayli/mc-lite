# Data Model: 炮塔自动射击系统

**Feature**: 023-turret-auto-fire
**Date**: 2026-03-17

## 实体定义

### 1. Turret (炮塔)

表示世界中的一座炮塔，管理自身的检测、瞄准、射击逻辑。

**Attributes**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | string | 唯一标识符 | UUID 格式 |
| `position` | Vector3 | 炮塔中心位置（方块坐标） | 整数坐标 |
| `pivotPosition` | Vector3 | 旋转中心（连接枪管的 iron 方块中心） | 相对于 position |
| `state` | enum | 当前状态 | `ACTIVE`, `DESTROYED` |
| `structureBlocks` | Array<Vector3> | 组成炮塔的所有方块坐标 | 相对坐标列表 |
| `targetEnemy` | Zombie/null | 当前瞄准的目标 | 可为 null |
| `currentRotation` | number | 当前 Y 轴旋转角度（弧度） | [0, 2π) |
| `targetRotation` | number | 目标 Y 轴旋转角度（弧度） | [0, 2π) |
| `lastFireTime` | number | 上次射击时间戳（毫秒） | 用于冷却计算 |
| `pivotObject` | THREE.Object3D | Three.js 旋转节点 | 包含4个方块 Mesh |
| `detectionRange` | number | 检测范围 | 固定值 50 |
| `rotationSpeed` | number | 旋转速度 | 固定值 π/2 (90度/秒) |
| `fireCooldown` | number | 射击冷却时间 | 固定值 500 (毫秒) |
| `fireAngleThreshold` | number | 射击角度阈值 | 固定值 0.26 (15度) |

**State Transitions**:

```
ACTIVE --[integrity check fails]--> DESTROYED
ACTIVE --[all blocks removed]--> DESTROYED
```

**Validation Rules**:

- VR-001: `position` 必须是整数方块坐标
- VR-002: `structureBlocks` 必须包含至少底座+塔顶的所有方块
- VR-003: `state` 为 `DESTROYED` 时，所有行为必须停止
- VR-004: `targetEnemy` 必须是在检测范围内的丧尸

---

### 2. Projectile (炮弹)

表示炮塔发射的飞行炮弹。

**Attributes**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `id` | string | 唯一标识符 | UUID 格式 |
| `position` | Vector3 | 当前位置（世界坐标） | 实时更新 |
| `direction` | Vector3 | 飞行方向（单位向量） | 发射时确定 |
| `speed` | number | 飞行速度 | 固定值 20 (格/秒) |
| `maxDistance` | number | 最大飞行距离 | 固定值 50 (格) |
| `distanceTraveled` | number | 已飞行距离 | [0, maxDistance] |
| `isActive` | boolean | 是否处于飞行状态 | true/false |
| `mesh` | THREE.Mesh | 视觉表现 | 简单球体/方块 |
| `damage` | number | 伤害值 | 固定值 1 (1/3生命值) |

**State Transitions**:

```
INACTIVE --[fire]--> ACTIVE
ACTIVE --[hit enemy]--> INACTIVE (回收)
ACTIVE --[max distance reached]--> INACTIVE (回收)
```

**Validation Rules**:

- VR-005: `direction` 必须是单位向量
- VR-006: `distanceTraveled` 超过 `maxDistance` 时必须回收
- VR-007: 碰撞检测命中后必须标记为 inactive

---

### 3. Zombie (丧尸扩展)

扩展现有丧尸实体，添加受击计数。

**New Attributes**:

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `hitCount` | number | 已受击次数 | [0, 3]，默认 0 |
| `maxHits` | number | 最大承受次数 | 固定值 3 |
| `isDead` | boolean | 是否已死亡 | computed: hitCount >= maxHits |

**State Transitions**:

```
ALIVE (hitCount=0) --[hit]--> WOUNDED (hitCount=1)
WOUNDED (hitCount=1) --[hit]--> CRITICAL (hitCount=2)
CRITICAL (hitCount=2) --[hit]--> DEAD (hitCount=3)
```

**Validation Rules**:

- VR-008: `hitCount` 不能超过 `maxHits`
- VR-009: `hitCount` 达到 `maxHits` 时丧尸必须被移除

---

## 关系图

```
┌─────────┐       detects       ┌─────────┐
│ Turret  │◄──────────────────►│  Zombie │
│  (1)    │   (targetEnemy)     │  (*)    │
└────┬────┘                     └─────────┘
     │
     │ creates
     │
     ▼
┌─────────┐
│Projectile│
│  (*)    │
└─────────┘
```

**关系说明**:

- **Turret → Zombie**: 一对多（一座炮塔可检测范围内多个丧尸，但只瞄准一个）
- **Turret → Projectile**: 一对多（一座炮塔可发射多个炮弹）
- **Projectile → Zombie**: 一对一碰撞（炮弹命中特定丧尸）

---

## 数据流

### 检测与瞄准流程

```
Turret.update()
  ├── checkIntegrity() ──► DESTROYED? ──► cleanup()
  ├── findNearestEnemy() ──► targetEnemy
  ├── calculateTargetRotation() ──► targetRotation
  └── rotateTowardsTarget() ──► currentRotation
```

### 射击流程

```
Turret.update()
  ├── canFire()? (cooldown + angle check)
  ├── fire()
  │   ├── createProjectile()
  │   ├── set direction = currentRotation
  │   └── reset lastFireTime
  └── ProjectileManager.add(projectile)
```

### 炮弹更新流程

```
Projectile.update(deltaTime)
  ├── update position
  ├── checkCollisionWithEnemies()
  │   └── hit? ──► enemy.hitCount++ ──► remove projectile
  └── checkMaxDistance()
      └── exceeded? ──► recycle projectile
```

---

## JSON 实体定义 (Structure)

炮塔结构将在 `src/world/structures/` 中定义为 JSON 文件。

### Turret Structure Schema

```json
{
  "name": "turret",
  "type": "entity",
  "dimensions": [3, 4, 3],
  "layers": [
    // Layer 0 (底座)
    [["stone", "stone", "stone"],
     ["stone", "stone", "stone"],
     ["stone", "stone", "stone"]],
    // Layer 1 (中部)
    [["stone", "stone", "stone"],
     ["stone", "stone", "stone"],
     ["stone", "stone", "stone"]],
    // Layer 2 (塔顶下部)
    [[null, "iron", null],
     [null, "iron", null],
     [null, null, null]],
    // Layer 3 (塔顶上部 - 枪管)
    [[null, "horizontal_pillar", null],
     [null, "horizontal_pillar", null],
     [null, null, null]]
  ],
  "metadata": {
    "entityType": "TURRET",
    "pivotBlock": {"x": 1, "y": 2, "z": 1},
    "barrelBlocks": [{"x": 1, "y": 3, "z": 1}]
  }
}
```

---

## 约束总结

| 约束 | 说明 |
|------|------|
| 炮塔最大数量 | 单场景 < 20 座 |
| 炮弹最大数量 | 对象池大小 100 |
| 检测范围 | 50 格半径 |
| 射击冷却 | 500 毫秒 |
| 旋转速度 | 90 度/秒 |
| 炮弹速度 | 20 格/秒 |
| 炮弹最大距离 | 50 格 |
| 丧尸受击上限 | 3 次 |
