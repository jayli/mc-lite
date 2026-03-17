# 丧尸 S 路线移动系统设计文档

## 概述

为丧尸 AI 添加 S 路线移动逻辑，使丧尸群体不再整齐划一地直线走向玩家，而是各自走出独特的摇摆路线，增加游戏趣味性和挑战性。

## 设计目标

1. **微动作效果**：丧尸有自然的左右摇摆，不再僵硬地直线行走
2. **保持方向感**：虽然有偏移，但总体仍然朝向玩家移动
3. **平滑自然**：转向有过渡动画，不生硬
4. **个体独立**：每个丧尸的 S 路线相互独立，增加多样性
5. **性能友好**：所有计算在 Web Worker 中完成，不增加主线程负担

## 核心机制

### 1. 新增丧尸状态参数

在 `EnemyWorker.js` 的每个丧尸对象中新增：

```javascript
{
  // 现有参数...
  offsetAngle: 0,           // 当前偏移角度（弧度，-π/4 到 +π/4）
  targetOffsetAngle: 0      // 目标偏移角度
}
```

### 2. 概率触发机制

每帧更新时，有 **2% 概率** 触发新的偏移目标：

```javascript
if (Math.random() < 0.02) {
  enemy.targetOffsetAngle = (Math.random() - 0.5) * Math.PI / 2; // ±45°
}
```

触发概率设为 2% 的理由：
- 约每 50 帧（约 0.8 秒 @ 60fps）触发一次
- 既不会过于频繁导致乱转，也不会间隔太长显得机械

### 3. 平滑过渡

使用线性插值（lerp）实现平滑转向：

```javascript
const lerpFactor = 0.03; // 每帧过渡 3%，约 1 秒完成大部分转向
enemy.offsetAngle += (enemy.targetOffsetAngle - enemy.offsetAngle) * lerpFactor;
```

### 4. 速度计算

将原直线方向应用偏移角度：

```javascript
// 基础方向（指向玩家）
const baseAngle = Math.atan2(dz, dx);

// 应用偏移后的方向
const finalAngle = baseAngle + enemy.offsetAngle;

// 计算最终速度
aiVelocityX = Math.cos(finalAngle) * enemy.speed;
aiVelocityZ = Math.sin(finalAngle) * enemy.speed;
```

## 实现细节

### 修改文件

**`src/workers/EnemyWorker.js`**

1. 在 `initEnemy` 函数中初始化新参数：
```javascript
function initEnemy(id, data) {
  enemies[id] = {
    // ... 现有参数
    offsetAngle: 0,
    targetOffsetAngle: 0
  };
}
```

2. 在 `updateAI` 函数中添加 S 路线逻辑：
```javascript
function updateAI(enemy, playerPosition, allEnemies) {
  // ... 现有距离检测代码

  if (distance > 0.5) {
    // 计算基础方向角度
    const baseAngle = Math.atan2(dz, dx);

    // 概率更新目标偏移角度
    if (Math.random() < 0.02) {
      enemy.targetOffsetAngle = (Math.random() - 0.5) * Math.PI / 2;
    }

    // 平滑过渡当前偏移角度
    const lerpFactor = 0.03;
    enemy.offsetAngle += (enemy.targetOffsetAngle - enemy.offsetAngle) * lerpFactor;

    // 应用偏移计算最终速度
    const finalAngle = baseAngle + enemy.offsetAngle;
    aiVelocityX = Math.cos(finalAngle) * enemy.speed;
    aiVelocityZ = Math.sin(finalAngle) * enemy.speed;
  }

  // ... 排斥力计算和速度合成
}
```

### 边界情况处理

1. **近距离时**：当距离玩家 < 2 格时，保持当前逻辑（不添加偏移），确保丧尸能准确接近玩家

2. **闲置状态**：当丧尸处于 idle 状态时，重置偏移角度为 0

3. **新丧尸生成**：新生成的丧尸 `offsetAngle` 和 `targetOffsetAngle` 初始化为 0，从直线开始

## 预期效果

### 行为变化

- 丧尸群从整齐的一列变成分散的扇形
- 每个丧尸以不同的节奏摇摆前进
- 整体仍保持向玩家移动的态势
- 玩家需要更灵活地应对来自不同角度的攻击

### 性能影响

- 新增计算均为简单的三角函数和浮点运算
- 所有计算在 Web Worker 中进行，不影响渲染帧率
- 无需额外的内存分配

## 验证方式

1. **功能验证**：
   - 生成多个丧尸，观察它们是否走出不同的 S 路线
   - 确认丧尸总体仍朝向玩家移动
   - 检查转向是否平滑，无瞬间跳变

2. **性能验证**：
   - 生成 50+ 丧尸，观察帧率是否稳定
   - 检查 Worker 通信是否正常

3. **边界验证**：
   - 测试丧尸接近玩家时的行为
   - 测试闲置状态下的行为

## 后续扩展（可选）

1. **丧尸个性系统**：为每个丧尸添加不同的摇摆幅度、频率参数
2. **群体包抄**：根据丧尸相对玩家的位置，调整偏移偏好（左侧丧尸倾向左偏）
3. **障碍物感知**：在接近障碍物时临时减少偏移，专注于绕过障碍
