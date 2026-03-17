# 丧尸 S 路线移动系统实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为丧尸 AI 添加 S 路线移动逻辑，使丧尸在朝向玩家移动时以平滑的 S 形路线摇摆前进，增加游戏趣味性。

**Architecture:** 在 EnemyWorker.js 中实现概率触发的平滑偏移系统，为每个丧尸添加 `offsetAngle` 和 `targetOffsetAngle` 状态参数，通过线性插值实现平滑转向。

**Tech Stack:** JavaScript ES6+, Web Worker

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/workers/EnemyWorker.js` | 修改 | 添加 S 路线移动逻辑 |

---

## Task 1: 添加 S 路线状态参数初始化

**Files:**
- 修改: `src/workers/EnemyWorker.js:33-46`

- [ ] **Step 1: 在 `initEnemy` 函数中添加 S 路线参数**

在 `enemies[id]` 对象中添加两个新属性：

```javascript
function initEnemy(id, data) {
  enemies[id] = {
    id: id,
    position: {...data.position},
    velocity: {x: 0, y: 0, z: 0},
    target: data.target || null,
    state: data.state || 'idle',
    health: data.health || 100,
    maxHealth: data.health || 100,
    speed: data.speed || 0.02,
    perceptionRange: data.perceptionRange || 10,
    lastUpdated: Date.now(),
    // S路线新增参数
    offsetAngle: 0,           // 当前偏移角度（弧度）
    targetOffsetAngle: 0      // 目标偏移角度（弧度）
  };
}
```

- [ ] **Step 2: 验证修改**

确认代码可以正常启动游戏，生成丧尸不会报错。

- [ ] **Step 3: Commit**

```bash
git add src/workers/EnemyWorker.js
git commit -m "feat(turret): 为丧尸添加 S 路线状态参数"
```

---

## Task 2: 实现 S 路线移动逻辑

**Files:**
- 修改: `src/workers/EnemyWorker.js:161-196`

- [ ] **Step 1: 修改 `updateAI` 函数，替换原有的直线移动逻辑**

将原有的速度计算逻辑（第 179-183 行）替换为 S 路线逻辑：

```javascript
function updateAI(enemy, playerPosition, allEnemies) {
  if (!playerPosition) return;

  const dx = playerPosition.x - enemy.position.x;
  const dy = playerPosition.y - enemy.position.y;
  const dz = playerPosition.z - enemy.position.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 基础AI速度
  let aiVelocityX = 0;
  let aiVelocityZ = 0;

  // 检查玩家是否在感知范围内
  if (distance <= enemy.perceptionRange) {
    // 进入追逐状态
    enemy.state = 'chasing';
    enemy.target = {...playerPosition};

    // 计算移动方向（S路线逻辑）
    if (distance > 0.5) { // 避免除零
      // 近距离时（< 2格）取消偏移，确保能准确接近玩家
      if (distance < 2) {
        enemy.targetOffsetAngle = 0;
      } else {
        // 概率更新目标偏移角度（2% 概率每帧）
        if (Math.random() < 0.02) {
          // 随机生成 -45° 到 +45° 的偏移角度
          enemy.targetOffsetAngle = (Math.random() - 0.5) * Math.PI / 2;
        }
      }

      // 平滑过渡当前偏移角度（lerpFactor = 0.03，约1秒完成转向）
      const lerpFactor = 0.03;
      enemy.offsetAngle += (enemy.targetOffsetAngle - enemy.offsetAngle) * lerpFactor;

      // 计算基础方向角度（朝向玩家）
      const baseAngle = Math.atan2(dz, dx);

      // 应用偏移后的最终方向
      const finalAngle = baseAngle + enemy.offsetAngle;

      // 计算最终速度
      aiVelocityX = Math.cos(finalAngle) * enemy.speed;
      aiVelocityZ = Math.sin(finalAngle) * enemy.speed;
    }
  } else if (distance > enemy.perceptionRange + 2) {
    // 距离太远，回到闲置状态
    enemy.state = 'idle';
    enemy.target = null;
    // 重置偏移角度
    enemy.offsetAngle = 0;
    enemy.targetOffsetAngle = 0;
  }

  // 计算排斥力（在Worker中批量计算）
  const separationForce = calculateSeparationForce(enemy, allEnemies);

  // 最终期望速度 = AI速度 + 排斥力
  enemy.velocity.x = aiVelocityX + separationForce.x;
  enemy.velocity.z = aiVelocityZ + separationForce.z;
}
```

- [ ] **Step 2: 运行游戏验证**

1. 启动开发服务器：`npm run start`
2. 打开浏览器访问游戏
3. 生成多个丧尸（按 X 键多次）
4. 观察丧尸移动：
   - 丧尸应该走出不同的 S 路线
   - 丧尸群应该分散而不是整齐排列
   - 转向应该是平滑的，没有瞬间跳变
   - 当丧尸接近玩家时应该恢复正常追踪

- [ ] **Step 3: 代码检查**

```bash
npm run lint
```

如有警告，根据情况修复或记录。

- [ ] **Step 4: Commit**

```bash
git add src/workers/EnemyWorker.js
git commit -m "feat(turret): 实现丧尸 S 路线移动逻辑

- 添加概率触发的随机偏移（2%概率/帧，±45°范围）
- 使用线性插值实现平滑转向（lerpFactor=0.03）
- 近距离时（<2格）自动取消偏移
- 闲置状态时重置偏移角度"
```

---

## Task 3: 验证与测试

**Files:**
- 测试: 浏览器运行游戏

- [ ] **Step 1: 功能验证**

启动游戏，测试以下场景：

1. **基础 S 路线测试**：
   - 生成 10-20 个丧尸
   - 观察它们是否各自走出不同的 S 路线
   - 确认丧尸群整体朝向玩家移动

2. **平滑度测试**：
   - 观察丧尸转向是否自然，无抽搐感
   - 确认不同丧尸的摇摆节奏不同

3. **近距离行为测试**：
   - 让丧尸接近玩家（< 2格）
   - 确认此时丧尸改为直线走向玩家

4. **闲置状态测试**：
   - 远离丧尸（> 感知范围 + 2格）
   - 确认丧尸进入闲置状态后，再次进入追逐时从直线开始

- [ ] **Step 2: 性能验证**

1. 生成 50+ 个丧尸
2. 打开浏览器开发者工具（F12），切换到 Performance 或 FPS 计数器
3. 确认帧率保持稳定（无明显下降）

- [ ] **Step 3: 完成验证报告**

在下方记录验证结果：

```markdown
## 验证结果

- [ ] 基础 S 路线：通过 / 未通过
- [ ] 平滑度：通过 / 未通过
- [ ] 近距离行为：通过 / 未通过
- [ ] 闲置状态：通过 / 未通过
- [ ] 性能（50+丧尸）：通过 / 未通过

备注：
```

---

## 实现要点总结

1. **状态参数**：每个丧尸新增 `offsetAngle`（当前偏移）和 `targetOffsetAngle`（目标偏移）

2. **触发机制**：每帧 2% 概率随机生成新的目标偏移角度（±45°）

3. **平滑过渡**：使用 lerp（线性插值）实现平滑转向，lerpFactor = 0.03

4. **边界处理**：
   - 距离玩家 < 2 格时取消偏移
   - 进入闲置状态时重置偏移

5. **性能**：所有计算在 Web Worker 中进行，不影响主线程渲染
