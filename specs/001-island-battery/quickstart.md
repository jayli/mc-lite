# Quickstart: 海岛炮塔实体

**Feature**: 海岛炮塔实体 (001-island-battery)
**Date**: 2026-03-17

## 快速验证步骤

### 1. 启动开发服务器

```bash
npm run start
```

访问 http://localhost:8080

### 2. 创建新世界并前往海岛

1. 游戏启动后，选择 "海岛地图" 或包含海岛的地图类型
2. 玩家出生点通常在海岛海滩附近
3. 在海岛中心区域寻找炮塔建筑

### 3. 验证炮塔生成

**视觉验证**:
- 炮塔应有明显的基座（铁方块）、支柱（黑曜石）和炮管
- 位置应在海岛内部（石头区域），而非沙滩边缘

**控制台验证**:
```javascript
// 检查已加载的结构中心
window.game.world.chunkManager.structures

// 查看当前区块的 structureCenters
```

### 4. 测试可破坏性

1. 使用左键点击炮塔方块进行破坏
2. 破坏后重新加载页面
3. 验证炮塔未重生（保持破坏状态）

## 调试技巧

### 查看生成日志

在浏览器控制台过滤关键词:
- `battery` - 炮塔加载和生成日志
- `StructureLoader` - 结构加载日志
- `EntityManager` - 实体注册日志

### 快速测试不同种子

修改 URL 参数:
```
http://localhost:8080?seed=12345
```

相同种子应生成相同位置的炮塔。

### 检查海岛中心位置

```javascript
// 在控制台执行
const seed = window.game.world.seed;
console.log('World seed:', seed);

// 查看已加载区块
console.log('Loaded chunks:', window.game.world.chunkManager.chunks);
```

## 常见问题

### 炮塔未生成

1. 检查 `battery.json` 是否存在且格式正确
2. 检查 StructureLoader 是否成功注册
3. 检查 EntityManager 是否正确预加载

### 炮塔位置不一致

1. 确认使用了相同的世界种子
2. 检查 `calculateBatteryPosition` 函数是否正确使用种子

### 炮塔在错误位置生成

1. 检查距离计算是否正确（应避开沙滩区域）
2. 确认使用 `ISLAND_SEA_LEVEL` 作为生成高度
