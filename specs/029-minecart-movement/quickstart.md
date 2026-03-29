# Quickstart: Minecart Movement (矿车移动功能)

**Feature**: 029-minecart-movement
**Date**: 2026-03-29

## 概述

本指南帮助开发者快速理解和实现矿车移动功能。

---

## 核心概念

### 1. 移动激发

玩家通过按键组合激发矿车移动：
- **ctrl + 左键**: 矿车向前移动
- **ctrl + shift + 左键**: 矿车向后移动

### 2. 铁轨检测

矿车只能在铁轨方块上移动：
- `sand_train_track` - 直轨
- `sand_train_track_corner` - 弯轨

### 3. 方向系统

矿车方向由 `orientation` (0-3) 决定：
```
0 = EAST  (朝东)
1 = SOUTH (朝南)
2 = WEST  (朝西)
3 = NORTH (朝北)
```

### 4. 链接机制

相邻矿车自动形成链接：
- 同向相邻的矿车形成链接
- 激发任一矿车，所有链接矿车同步移动
- 最多链接 10 节

---

## 快速实现路径

### Phase 1: 基础移动 (P1)

**目标**: 实现 ctrl+左键激发矿车向前移动

**步骤**:
1. 扩展 `Minecart.js` 添加 `movementState` 属性
2. 创建 `MinecartMovementSystem.js` 实现移动逻辑
3. 扩展 `PlayerInteraction.js` 添加 ctrl+左键检测
4. 在 `GameConfig.js` 添加移动速度常量

**关键代码**:
```javascript
// MinecartMovementSystem.js
update(minecart, deltaTime) {
  if (minecart.movementState === 'IDLE') return;

  const speed = MINECART_SPEED; // 1 方块/秒
  const direction = this.getDirection(minecart.orientation, minecart.movementState);
  const newPos = minecart.position.clone().add(direction.multiplyScalar(speed * deltaTime));

  // 检测前方铁轨
  if (this.hasTrackAhead(newPos, minecart.world)) {
    minecart.position.copy(newPos);
  } else {
    minecart.movementState = 'IDLE';
  }
}
```

### Phase 2: 转弯逻辑 (P2)

**目标**: 矿车在交叉点自动转弯

**步骤**:
1. 在 `MinecartMovementSystem.js` 添加转弯检测
2. 实现左/右方向计算
3. 实现随机转弯选择

**关键代码**:
```javascript
// 转弯检测
checkTurn(minecart, trackPos) {
  const forward = this.getForward(minecart.orientation);
  const left = { x: -forward.z, z: forward.x };
  const right = { x: forward.z, z: -forward.x };

  const hasLeftTrack = this.hasTrackAt(trackPos, left);
  const hasRightTrack = this.hasTrackAt(trackPos, right);

  if (hasLeftTrack && hasRightTrack) {
    return Math.random() < 0.5 ? 'left' : 'right';
  }
  return hasLeftTrack ? 'left' : (hasRightTrack ? 'right' : null);
}
```

### Phase 3: 链接联动 (P3)

**目标**: 多矿车同步移动

**步骤**:
1. 创建 `MinecartLinkDetector.js` 实现链接检测
2. 扩展 `MinecartManager.js` 添加链接管理
3. 实现同步移动逻辑

**关键代码**:
```javascript
// MinecartLinkDetector.js
detectLinks(minecart) {
  const links = new Set();
  const forward = this.getForward(minecart.orientation);
  const frontPos = minecart.position.clone().add(forward);
  const backPos = minecart.position.clone().sub(forward);

  const frontMinecart = this.manager.getMinecartAt(frontPos.x, frontPos.y, frontPos.z);
  const backMinecart = this.manager.getMinecartAt(backPos.x, backPos.y, backPos.z);

  if (frontMinecart && frontMinecart.orientation === minecart.orientation) {
    links.add(frontMinecart.id);
  }
  if (backMinecart && backMinecart.orientation === minecart.orientation) {
    links.add(backMinecart.id);
  }

  return links;
}
```

### Phase 4: 碰撞处理 (P4)

**目标**: 碰撞检测和回弹

**步骤**:
1. 创建 `MinecartCollisionSystem.js` 实现碰撞检测
2. 实现相向碰撞停止逻辑
3. 实现推动碰撞逻辑
4. 实现回弹位置计算

**关键代码**:
```javascript
// MinecartCollisionSystem.js
checkCollision(minecart, newPos) {
  const otherMinecart = this.manager.getMinecartAt(newPos.x, newPos.y, newPos.z);
  if (!otherMinecart) return null;

  if (otherMinecart.movementState !== 'IDLE') {
    // 相向碰撞
    if (this.isHeadOn(minecart, otherMinecart)) {
      return { type: 'HEAD_ON', shouldBounce: true };
    }
  } else {
    // 推动碰撞
    return { type: 'PUSH', shouldBounce: false };
  }
}
```

---

## 测试方法

### 手动测试

1. 启动游戏: `npm run start`
2. 打开浏览器: http://localhost:8080
3. 在控制台执行:
```javascript
// 获取游戏实例
const game = window.game;

// 检查矿车数量
game.minecartManager.getCount();

// 检查矿车状态
game.minecartManager.minecarts.forEach(m => console.log(m.getState()));
```

### 测试场景

| 场景 | 操作 | 预期结果 |
|------|------|----------|
| 基础移动 | 放置矿车在直轨，ctrl+左键 | 矿车向前移动 |
| 弯轨穿越 | 矿车移动经过弯轨 | 方向不变，继续前进 |
| 终点停止 | 矿车到达铁轨终点 | 矿车停止 |
| 转弯 | 矿车到达十字路口 | 随机左转或右转 |
| 链接 | 3矿车相邻，激发中间 | 全部同步移动 |
| 推动碰撞 | 运动矿车撞静止矿车 | 静止矿车开始运动 |
| 相向碰撞 | 两矿车相向运动碰撞 | 双方停止并回弹 |

---

## 文件修改清单

| 文件 | 操作 | 描述 |
|------|------|------|
| Minecart.js | 重构 | 移除渲染逻辑，仅保留数据状态 |
| MinecartManager.js | 修改 | 扩展链接/碰撞逻辑，集成渲染器 |
| MinecartInstancedRenderer.js | 新增 | InstancedMesh 批量渲染器 |
| MinecartMovementSystem.js | 新增 | 移动系统核心 |
| MinecartLinkDetector.js | 新增 | 链接检测 |
| MinecartCollisionSystem.js | 新增 | 碰撞系统 |
| PlayerInteraction.js | 修改 | ctrl+shift 激发逻辑 |
| GameConfig.js | 修改 | 移动配置常量 |

---

## 渲染架构变更

### 原方案 (独立 Mesh)

```
每个 Minecart 实例
├── mesh (THREE.Group)
│   ├── body (独立 geometry + material)
│   └── 4x wheel (独立 geometry + material)
└── 问题：50 矿车 = 100+ draw calls，内存浪费
```

### 新方案 (InstancedMesh)

```
MinecartInstancedRenderer (单例)
├── bodyMesh (InstancedMesh, 共享 geometry + material)
│   └── 50 矿车共享，通过矩阵区分
└── wheelMesh (InstancedMesh, 共享 geometry + material)
    └── 200 车轮共享，通过矩阵区分
└── 优势：50 矿车仅 2 draw calls，内存高效
```

### 关键代码示例

```javascript
// MinecartInstancedRenderer.js - 更新矿车渲染
update(minecarts) {
  let index = 0;
  for (const minecart of minecarts.values()) {
    // 更新车斗
    this.dummy.position.set(
      minecart.position.x + 0.5,
      minecart.position.y,
      minecart.position.z + 0.5
    );
    this.dummy.rotation.y = getRotationAngle(minecart.orientation);
    this.dummy.updateMatrix();
    this.bodyMesh.setMatrixAt(index, this.dummy.matrix);

    // 更新4个车轮
    this.updateWheels(minecart, index);

    index++;
  }
  this.bodyMesh.count = index;
  this.bodyMesh.instanceMatrix.needsUpdate = true;
}
```

---

## 常见问题

### Q1: 矿车移动但车轮不转？

A: 车轮旋转是视觉效果，可在 MinecartMovementSystem 中添加车轮旋转动画。

### Q2: 链接矿车数量超过 10？

A: MinecartLinkDetector 应在检测时限制链接数量，超出时停止链接。

### Q3: 矿车在 chunk 边界停止？

A: 确保前方铁轨所在 chunk 已加载，否则矿车应停止等待 chunk 加载。