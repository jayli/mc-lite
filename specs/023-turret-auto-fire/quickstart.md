# Quick Start: 炮塔自动射击系统

**Feature**: 023-turret-auto-fire

## 开发环境准备

确保已启动开发服务器：

```bash
npm run start
```

访问 http://localhost:8080 查看游戏

## 快速测试步骤

### 1. 放置炮塔

使用实体系统放置炮塔：

```javascript
// 在浏览器控制台中
const turret = game.world.entityManager.createEntity('turret', x, y, z);
```

或使用方块手动搭建：
- 底层 3x3 石砖底座
- 中层 3x3 石砖
- 塔顶：两个 iron 方块（枪把）+ 两个 horizontal_pillar 方块（枪管）

### 2. 生成丧尸测试

```javascript
// 在炮塔50格范围内生成丧尸
game.enemyManager.spawnZombie(x + 10, y, z + 10);
```

### 3. 观察行为

1. 炮塔塔顶应旋转对准最近的丧尸
2. 枪管对准后应发射炮弹（可见飞行轨迹）
3. 炮弹命中丧尸3次后丧尸死亡

### 4. 测试边界情况

**结构完整性测试**：
```javascript
// 破坏炮塔的一个方块
game.world.setBlock(turretX, turretY, turretZ, 'air');
```
预期结果：炮塔停止射击，塔顶恢复默认位置

**多目标测试**：
```javascript
// 生成多个丧尸
game.enemyManager.spawnZombie(x + 10, y, z, 'zombie1');
game.enemyManager.spawnZombie(x + 20, y, z, 'zombie2');
game.enemyManager.spawnZombie(x + 15, y, z, 'zombie3');
```
预期结果：炮塔始终瞄准距离最近的丧尸

## 调试命令

```javascript
// 查看所有活跃的炮塔
game.turretManager.getActiveTurrets();

// 查看特定炮塔状态
game.turretManager.getTurret(id);

// 强制移除所有炮塔
game.turretManager.clearAll();

// 查看活跃炮弹数量
game.projectilePool.getActiveCount();
```

## 测试检查清单

- [ ] 炮塔能检测50格内的丧尸
- [ ] 多丧尸情况下选择最近的目标
- [ ] 塔顶旋转平滑，速度约90度/秒
- [ ] 枪管对准（夹角<15度）后才射击
- [ ] 射击频率为每0.5秒1发
- [ ] 炮弹沿枪管方向直线飞行
- [ ] 炮弹速度为20格/秒
- [ ] 丧尸被击中3次后死亡
- [ ] 破坏任一组成方块后炮塔失效
- [ ] 失效后塔顶恢复默认朝向

## 性能监控

在浏览器控制台中监控：

```javascript
// 查看 FPS
game.engine.stats.fps

// 查看活跃炮塔数
game.turretManager.turrets.length

// 查看活跃炮弹数
game.projectilePool.active.length
```

## 故障排除

| 问题 | 检查项 |
|------|--------|
| 炮塔不旋转 | 检查结构完整性，确认 pivotBlock 存在 |
| 不发射炮弹 | 检查冷却时间，确认角度<15度 |
| 炮弹不命中 | 检查碰撞检测半径设置 |
| 丧尸不死亡 | 检查 hitCount 是否正确累加 |
