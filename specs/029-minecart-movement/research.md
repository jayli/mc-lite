# Research: Minecart Movement (矿车移动功能)

**Feature**: 029-minecart-movement
**Date**: 2026-03-29
**Status**: Complete

## 概述

本文档记录矿车移动功能的技术决策研究，解决实现过程中的关键技术问题。

---

## Decision 1: 移动驱动方式

**Question**: 矿车移动应该使用物理引擎驱动还是帧更新驱动？

**Decision**: 帧更新驱动 (deltaTime-based update)

**Rationale**:
1. 矿车移动速度固定 (1 方块/秒)，不需要物理引擎的复杂计算
2. 现有代码架构使用帧更新驱动 (Game.update -> MinecartManager.update -> Minecart.update)
3. 铁轨移动是离散的 (方块级别)，物理引擎的连续移动反而增加复杂性
4. 避免引入额外依赖 (如 Cannon.js)，保持简洁性

**Alternatives Considered**:
- 物理引擎驱动: 可模拟真实碰撞，但增加复杂性，与离散铁轨移动不适配
- Web Worker 驱动: 可并行计算，但主线程/Worker 同步增加复杂性

---

## Decision 2: 铁轨方向映射

**Question**: 如何从 orientation (0-3) 映射到移动方向向量？

**Decision**: 使用 OrientationUtils.BlockOrientation 映射

**Mapping**:
```
orientation 0 (EAST)  -> direction (+X, 0, +Z) 前进向量 (1, 0, 0)
orientation 1 (SOUTH) -> direction (0, 0, 1)   前进向量 (0, 0, 1)
orientation 2 (WEST)  -> direction (-1, 0, 0)  前进向量 (-1, 0, 0)
orientation 3 (NORTH) -> direction (0, 0, -1)  前进向量 (0, 0, -1)
```

**Rationale**:
1. 现有 OrientationUtils.js 已定义 BlockOrientation 枚举
2. orientation 与 Y 轴旋转角度对应: angle = orientation * (PI/2)
3. 铁轨放置时已正确设置 orientation，可直接复用

**Implementation Note**:
- 前进方向 = orientation 对应的正方向向量
- 后退方向 = orientation 对应的负方向向量 (反转)

---

## Decision 3: 转弯方向检测

**Question**: 如何判断左转/右转方向？

**Decision**: 基于当前方向计算左右侧方向向量

**Algorithm**:
```javascript
// 当前方向向量
const forward = { x: dx, z: dz }; // 基于 orientation
// 左侧方向 (顺时针旋转90度)
const left = { x: -dz, z: dx };
// 右侧方向 (逆时针旋转90度)
const right = { x: dz, z: -dx };

// 示例: orientation 0 (EAST), forward = (1, 0)
// left = (0, 1) = SOUTH
// right = (0, -1) = NORTH
```

**Rationale**:
1. 矿车在 2D 平面移动 (XZ 轴)，方向旋转是 90 度整数
2. 向量旋转公式简单可靠
3. 不依赖弯轨的特殊 orientation 值

---

## Decision 4: 链接检测方式

**Question**: 如何检测相邻矿车形成链接？

**Decision**: 基于铁轨位置检测前后相邻矿车

**Algorithm**:
```javascript
// 给定矿车位置 (x, y, z) 和方向 (orientation)
// 前方相邻位置 = (x + dx, y, z + dz)
// 后方相邻位置 = (x - dx, y, z - dz)
// 检查相邻位置是否有矿车 (通过 MinecartManager.getMinecartAt)
```

**Link Formation Rules**:
1. 两矿车必须在相邻铁轨上 (前后相邻，距离 1 方块)
2. 两矿车朝向必须一致 (同方向)
3. 最多链接 10 节

**Rationale**:
1. 简单的位置检测，不引入复杂图结构
2. 链接关系是临时的 (矿车移动时动态维护)
3. MinecartManager 已有 positionIndex 可快速查询

---

## Decision 5: 碰撞检测时机

**Question**: 碰撞检测应该在移动前还是移动中？

**Decision**: 移动中检测 (每帧检测碰撞)

**Algorithm**:
```javascript
// 每帧更新时:
// 1. 计算新位置 (currentPos + velocity * deltaTime)
// 2. 检测新位置是否有其他矿车
// 3. 如果碰撞:
//    - 相向碰撞: 双方停止，回弹
//    - 推动碰撞: 静止矿车开始同向运动
```

**Rationale**:
1. 矿车移动速度慢 (1 方块/秒)，帧内位移小
2. 可以在移动过程中精确检测碰撞点
3. 避免预计算带来的复杂性

---

## Decision 6: 回弹位置计算

**Question**: 碰撞后如何计算回弹位置？

**Decision**: 回弹到最近经过的铁轨方块上方

**Algorithm**:
```javascript
// 矿车记录 lastTrackPosition (最近经过的铁轨位置)
// 碰撞时:
// 1. 计算碰撞位置是否为标准方块坐标 (整数)
// 2. 如果不是，回弹到 lastTrackPosition
// 3. 如果是，保持在碰撞位置
```

**Rationale**:
1. 规格明确要求停止在标准方块坐标
2. lastTrackPosition 在每帧移动时更新
3. 简单可靠，不引入复杂的位置计算

---

## Decision 7: 移动状态管理

**Question**: 矿车移动状态如何存储？

**Decision**: 在 Minecart.js 中扩展状态属性

**Properties**:
```javascript
// Minecart 新增属性
{
  movementState: 'IDLE' | 'MOVING_FORWARD' | 'MOVING_BACKWARD',
  lastTrackPosition: { x, y, z }, // 最近经过的铁轨位置
  velocity: { x, z },              // 当前速度向量
  linkedMinecarts: Set<minecartId> // 链接的矿车 ID
}
```

**Rationale**:
1. 状态直接存储在实体对象中，符合 OO 设计
2. MinecartManager.update 遍历所有矿车时可直接访问状态
3. 持久化时可通过 toJSON 序列化状态

---

## Decision 8: 输入处理扩展

**Question**: ctrl+shift+左键如何检测？

**Decision**: 扩展 PlayerInteraction.onMouseDownLeft 处理

**Implementation**:
```javascript
// PlayerInteraction.onMouseDownLeft 现有逻辑:
if (e.ctrlKey) {
  // TNT 点燃逻辑
}

// 扩展逻辑:
if (e.ctrlKey && e.shiftKey) {
  // 矿车后退激发
  this.tryActivateMinecart(hit, 'backward');
} else if (e.ctrlKey) {
  // 矿车前进激发
  this.tryActivateMinecart(hit, 'forward');
}
```

**Rationale**:
1. PlayerInteraction 已有 ctrlKey 检测逻辑 (TNT)
2. 扩展而非重构，保持代码稳定性
3. shiftKey 作为后退标志，逻辑清晰

---

## References

- Minecart.js: 矿车实体类，已有 state 属性
- MinecartManager.js: 管理器，已有 positionIndex 查询
- PlayerInteraction.js: 输入处理，已有 ctrlKey 检测
- OrientationUtils.js: 方向枚举和计算
- GameConfig.js: 配置常量管理

---

## Decision 9: 矿车渲染方案 (InstancedMesh)

**Question**: 矿车渲染是否应该使用 InstancedMesh 批量渲染？

**Decision**: 是，使用 InstancedMesh 批量渲染，参照 ZombieInstancedRenderer 实现

**Rationale**:
1. **性能优化**: 50 个矿车从 100 个 draw call 减少到 2 个 draw call
2. **内存效率**: 共享几何体和材质，避免每个矿车实例重复创建
3. **成熟模式**: ZombieInstancedRenderer 已验证此方案可行，风险低
4. **矿车结构简单**: 仅 2 个部件（车斗+车轮），比丧尸 6 个部件更简单

**Implementation**:
```javascript
// MinecartInstancedRenderer.js
class MinecartInstancedRenderer {
  constructor(scene, maxCount = 50) {
    // 共享几何体
    this.bodyGeometry = createTrapezoidGeometry(...);  // 车斗倒梯形
    this.wheelGeometry = new THREE.CylinderGeometry(...); // 车轮圆柱

    // 共享材质
    this.bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    this.wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x555555 });

    // InstancedMesh
    this.bodyMesh = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, maxCount);
    this.wheelMesh = new THREE.InstancedMesh(wheelGeometry, wheelMaterial, maxCount * 4);

    // 临时对象（避免帧内创建）
    this.dummy = new THREE.Object3D();
  }

  update(minecarts) {
    let index = 0;
    for (const minecart of minecarts.values()) {
      // 更新车斗矩阵
      this.updateBodyMatrix(minecart, index);

      // 更新4个车轮矩阵
      this.updateWheelMatrices(minecart, index);

      index++;
    }
    this.bodyMesh.count = index;
    this.wheelMesh.count = index * 4;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.wheelMesh.instanceMatrix.needsUpdate = true;
  }
}
```

**Alternatives Considered**:
- 独立 Mesh: 简单但性能差，每个矿车消耗大量内存和 draw call
- Geometry Merging: 静态合并，不适合动态移动的矿车

---

## Decision 10: Minecart.js 职责变更

**Question**: Minecart.js 是否需要保留渲染逻辑？

**Decision**: 否，Minecart.js 仅存储数据状态，渲染逻辑迁移到 MinecartInstancedRenderer

**Rationale**:
1. **职责分离**: 数据实体与渲染逻辑解耦
2. **内存效率**: Minecart 实例更轻量，仅存储位置、朝向、移动状态
3. **一致性**: 与 Zombie.js 设计一致，实体类仅存储数据

**Minecart.js 新职责**:
```javascript
class Minecart {
  constructor(params) {
    this.id = params.id;
    this.position = params.position;
    this.orientation = params.orientation;
    this.movementState = 'IDLE';
    this.lastTrackPosition = null;
    this.velocity = { x: 0, z: 0 };
    this.linkedMinecarts = new Set();
    // 不再包含 this.mesh
  }

  // 不再包含 createVisuals(), updateTransform()
  // 渲染由 MinecartInstancedRenderer 统一处理
}
```