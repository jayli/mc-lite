# Quickstart: Island Generation

**Feature**: Island Generation
**Branch**: `021-island-generation`
**Date**: 2026-03-15

## Overview

快速开始指南，帮助开发者在海岛生成功能的上下手。

## 项目结构

```
src/
├── workers/
│   ├── maps/
│   │   ├── Pyramid.js         # 金字塔生成器 (参考)
│   │   ├── SnowLand.js        # 雪地生成器 (参考)
│   │   ├── FrozenMountain.js  # 冰封山峰生成器 (参考)
│   │   └── IslandMap.js       # 海岛生成器 (新增)
│   └── WorldWorker.js         # 主地形生成 Worker (修改)
└── core/
    └── Game.js                # 游戏主循环 (修改：出生点)
```

## 核心概念

### 1. 地图生成器模式

项目使用统一的地图生成器模式：

```javascript
// 每个地图类型模块导出两个函数
export function getXxxInfo(wx, wz, seed, terrainGen) {
  // 判断坐标是否在地图范围内
  // 返回地图信息对象或 null
}

export function generate(wx, wz, h, xxxInfo, fakeChunk, dPlaceholder) {
  // 生成具体方块
}

export const Xxx = { getIslandInfo, generate };
```

### 2. 区域和过渡带

- **主体区域 (core)**: 完整的海岛形态，不进行混合
- **过渡带 (transition)**: 海岛边缘与原地形的平滑过渡
- **transitionFactor**: 0-1 的值，表示过渡程度

### 3. 方块分布

海岛表面使用分片聚集分布：
- **sand**: 集中在海岸边缘
- **stone**: 分布在海岛内部

## 快速上手

### 步骤 1: 创建海岛生成器文件

```bash
# 在项目中创建新文件
mkdir -p src/workers/maps
touch src/workers/maps/IslandMap.js
```

### 步骤 2: 实现 getIslandInfo 函数

```javascript
// src/workers/maps/IslandMap.js
export function getIslandInfo(wx, wz, seed, terrainGen) {
  const regionSize = 400;
  const islandSize = 30;
  const halfSize = Math.floor(islandSize / 2);
  const transitionSize = 4;

  // 计算区域
  const regionX = Math.floor(wx / regionSize);
  const regionZ = Math.floor(wz / regionSize);

  // 计算海岛中心（确定性随机）
  const randX = Math.abs(Math.sin(seed * 1.5 + regionX * 0.1));
  const randZ = Math.abs(Math.sin(seed * 2.5 + regionZ * 0.1));
  const offsetX = Math.floor(randX * 300) + 100;
  const offsetZ = Math.floor(randZ * 300) + 100;

  const islandCx = regionX * regionSize + offsetX;
  const islandCz = regionZ * regionSize + offsetZ;

  // 计算距离
  const dx = Math.abs(wx - islandCx);
  const dz = Math.abs(wz - islandCz);
  const distFromCenter = Math.max(dx, dz);

  const totalHalfSize = halfSize + transitionSize;

  // 检查是否在范围内
  if (dx > totalHalfSize || dz > totalHalfSize) {
    return null;
  }

  // 判断区域
  const zone = distFromCenter <= halfSize ? 'core' : 'transition';
  const transitionFactor = zone === 'core' ? 0 : (distFromCenter - halfSize) / transitionSize;

  return {
    centerX: islandCx,
    centerZ: islandCz,
    zone,
    transitionFactor
  };
}
```

### 步骤 3: 实现 generateIsland 函数

```javascript
export function generateIsland(wx, wz, h, islandInfo, fakeChunk, dPlaceholder) {
  const seaLevel = -2;

  // 计算地表高度
  const surfaceY = h + (islandInfo.zone === 'core' ? 1 : 0);

  // 判断是否在海平面以下
  const isBelowSeaLevel = surfaceY <= seaLevel - 1;

  // 确定方块类型（简化版：边缘是 sand，内部是 stone）
  const distFromCenter = Math.max(
    Math.abs(wx - islandInfo.centerX),
    Math.abs(wz - islandInfo.centerZ)
  );
  const blockType = distFromCenter > 10 ? 'sand' : 'stone';

  // 生成地表方块
  fakeChunk.add(wx, surfaceY, wz, blockType, dPlaceholder);

  // 生成地下填充
  for (let y = surfaceY - 1; y >= h - 10; y--) {
    const type = y < surfaceY - 3 ? 'stone' : 'dirt';
    fakeChunk.add(wx, y, wz, type, dPlaceholder);
  }

  return { surfaceY, isBelowSeaLevel };
}
```

### 步骤 4: 导出模块

```javascript
export const IslandMap = {
  getIslandInfo,
  generate: generateIsland
};
```

### 步骤 5: 集成到 WorldWorker

```javascript
// src/workers/WorldWorker.js
import { IslandMap } from './maps/IslandMap.js';

// 在主生成循环中（约第 160 行）
const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
const inIsland = islandInfo !== null;

if (inIsland) {
  IslandMap.generate(wx, wz, h, islandInfo, fakeChunk, dPlaceholder);
}
```

## 测试验证

### 手动测试

1. **启动开发服务器**
   ```bash
   npm run start
   ```

2. **打开浏览器**
   ```
   http://localhost:8080
   ```

3. **探索世界**
   - 向一个方向移动约 200-400 格
   - 寻找四周环海的海岛

4. **验证要点**
   - [ ] 海岛大小约 30x30
   - [ ] 四周环海，与大陆距离约 20 格
   - [ ] 表面有 sand 和 stone 方块
   - [ ] sand 和 stone 各自成片分布
   - [ ] 岛上有 1-2 棵树
   - [ ] 海岛高度起伏不超过 2 格

### 调试技巧

```javascript
// 在浏览器控制台中
window.game.world;  // 访问世界对象
window.game.player; // 访问玩家对象

// 查看当前区块
console.log(window.game.world.currentChunk);
```

## 常见问题

### Q1: 海岛不生成？

**检查**:
1. 确认 `WorldWorker.js` 中导入了 `IslandMap`
2. 确认在正确的生成循环位置调用了 `getIslandInfo`
3. 检查生成概率设置（默认 8%）

### Q2: 海岛形状太规则？

**调整**:
```javascript
// 增加噪声尺度
const shapeNoiseScale = 0.15; // 原 0.1

// 或者使用多层噪声叠加
const noise1 = Math.sin(wx * 0.1) * Math.cos(wz * 0.1);
const noise2 = Math.sin(wx * 0.2) * Math.cos(wz * 0.2) * 0.5;
const combinedNoise = noise1 + noise2;
```

### Q3: sand 和 stone 分布太细碎？

**调整**:
```javascript
// 使用 Voronoi 区域方法
// 增加种子点之间的距离
// 或者使用更低频的噪声来决定分布
```

## 参考资源

- [spec.md](./spec.md) - 功能规格说明
- [plan.md](./plan.md) - 实现计划
- [data-model.md](./data-model.md) - 数据模型
- `src/workers/maps/FrozenMountain.js` - 参考实现
- `src/workers/maps/Pyramid.js` - 参考实现
