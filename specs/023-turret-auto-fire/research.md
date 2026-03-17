# Research: 炮塔自动射击系统技术决策

**Date**: 2026-03-17
**Feature**: 023-turret-auto-fire

## 技术决策摘要

### 1. 炮塔旋转机制

**Decision**: 使用 Three.js 的 Object3D 嵌套层次结构实现炮塔旋转

**Rationale**:
- 炮塔顶部的4个方块需要作为整体旋转
- Object3D 的父子关系可以自然地实现"围绕指定方块中心旋转"的需求
- 将4个方块 Mesh 作为子对象添加到 pivot Object3D，旋转 pivot 即可实现整体旋转
- 与现有 Chunk 的 InstancedMesh 系统兼容

**Implementation**:
```javascript
// 伪代码
const turretPivot = new THREE.Object3D();
turretPivot.position.set(pivotBlockX, pivotBlockY, pivotBlockZ); // 重心位置
// 4个方块作为子对象，位置相对于 pivot
const block1 = new THREE.Mesh(geometry, material);
block1.position.set(localX, localY, localZ);
turretPivot.add(block1);
// 旋转时只需旋转 pivot
turretPivot.rotation.y = targetAngle;
```

**Alternatives considered**:
- 手动计算每个方块的位置：代码复杂，容易出错
- 使用骨骼动画：过度设计，炮塔结构固定且简单

### 2. 炮弹管理方式

**Decision**: 使用对象池（Object Pool）管理炮弹实例

**Rationale**:
- 符合宪法 II（内存效率与垃圾回收）原则
- 避免频繁创建/销毁 Mesh 导致的 GC 压力
- 炮弹生命周期短（最大2.5秒），适合池化
- 预计同时存在的炮弹数量有限（< 50个）

**Implementation**:
```javascript
class ProjectilePool {
  constructor(maxSize = 100) {
    this.available = [];
    this.active = [];
    // 预创建炮弹对象
  }
  acquire() { /* 从池中获取或创建 */ }
  release(projectile) { /* 回收回池 */ }
}
```

**Alternatives considered**:
- 动态创建/销毁：违反内存效率原则
- 永久保留所有炮弹：不必要的内存占用

### 3. 目标检测算法

**Decision**: 每座炮塔独立遍历 EnemyManager 中的丧尸列表

**Rationale**:
- 实现简单，符合澄清阶段确定的"独立计算"方案
- 丧尸数量通常有限（< 50个），遍历开销可接受
- 无需复杂的空间索引结构
- 支持每座炮塔独立选择最近目标

**Algorithm**:
```javascript
findNearestEnemy(turretPosition, range) {
  let nearest = null;
  let minDistance = range;
  for (const enemy of enemies) {
    const dist = distance(turretPosition, enemy.position);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = enemy;
    }
  }
  return nearest;
}
```

**Alternatives considered**:
- 空间哈希/八叉树：过度优化，当前规模不需要
- 全局炮塔管理器统一分配目标：增加复杂性，失去独立性

### 4. 结构完整性检查

**Decision**: 在炮塔 update 循环中检查组成方块是否存在

**Rationale**:
- World 已有方块查询接口
- 每帧检查4个方块的开销可忽略
- 发现缺失后立即标记为损坏并清理资源

**Implementation**:
```javascript
update() {
  if (!this.checkIntegrity()) {
    this.destroy();
    return;
  }
  // 正常更新逻辑
}

checkIntegrity() {
  for (const blockPos of this.structureBlocks) {
    if (this.world.getBlock(blockPos) !== expectedBlockType) {
      return false;
    }
  }
  return true;
}
```

### 5. 旋转插值方式

**Decision**: 使用最短路径角度插值（Shortest Angle Interpolation）

**Rationale**:
- 规格要求旋转速度 90度/秒
- 需要处理角度环绕（如从 350度 转到 10度 应该顺时针转 20度，而不是逆时针转 340度）
- 平滑的旋转提升游戏体验

**Implementation**:
```javascript
// 计算最短旋转路径
function lerpAngle(current, target, delta) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * delta;
}
```

### 6. 碰撞检测

**Decision**: 使用简单的距离检测（球体碰撞）

**Rationale**:
- 炮弹体积小，近似为点
- 丧尸有大致的碰撞半径
- 计算简单高效
- 游戏精度要求不高

**Implementation**:
```javascript
checkCollision(projectile, enemy) {
  const dist = projectile.position.distanceTo(enemy.position);
  return dist < enemy.hitRadius + projectile.radius;
}
```

## 技术风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 多炮塔同时更新性能问题 | 中 | 限制单场景炮塔数量 < 20，update 使用 deltaTime |
| 炮弹穿墙问题 | 低 | 当前实现不检测方块碰撞，击中第一个碰到的丧尸即消失 |
| 旋转卡顿 | 低 | 使用 requestAnimationFrame，旋转更新与渲染同步 |

## 依赖项

- **Three.js**: r128+（已有）
- **World.getBlock()**: 用于完整性检查
- **EnemyManager**: 获取丧尸列表
- **EntityManager**: 炮塔实体注册和创建
- **MaterialManager**: 复用现有方块材质

## 参考资源

- 现有 Entity System: `src/world/entity-system/`
- 丧尸实现: `src/core/EnemyManager.js`, `src/actors/enemy/`
- 方块数据: `src/constants/BlockData.js`
- 材质管理: `src/core/MaterialManager.js`
