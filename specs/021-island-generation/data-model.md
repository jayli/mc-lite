# Data Model: Island Generation

**Feature**: Island Generation
**Branch**: `021-island-generation`
**Date**: 2026-03-15

## Overview

本文档描述海岛生成功能的数据结构和关系。

## Core Entities

### 1. IslandInfo (海岛信息对象)

海岛信息对象在 Worker 中生成并传递，包含海岛生成的所有必要数据。

```javascript
{
  // 位置信息
  centerX: number,         // 海岛中心 X 坐标（世界坐标）
  centerZ: number,         // 海岛中心 Z 坐标（世界坐标）

  // 高度信息
  surfaceY: number,        // 地表 Y 坐标
  isBelowSeaLevel: boolean, // 是否在海平面以下（y <= -3）

  // 区域信息
  zone: 'core' | 'transition',  // 所属区域：主体或过渡带
  transitionFactor: number,     // 过渡因子 (0.0-1.0)，0 表示完全主体，1 表示完全过渡

  // 方块类型信息
  blockType: 'sand' | 'stone',  // 当前方块的类型
  isBeach: boolean,             // 是否在沙滩区域（海岸边缘）

  // 树木生成信息
  treeSpawnChance: number,      // 树木生成概率 (0.0-1.0)
  treeType: 'oak'               // 树木类型（固定为橡树）
}
```

**职责**:
- 封装海岛生成的所有上下文信息
- 在主线程和 Worker 之间传递
- 用于跨 Chunk 渲染的结构中心点记录

### 2. IslandConfig (海岛配置对象)

静态配置参数，定义海岛生成的全局行为。

```javascript
{
  // 尺寸参数
  islandSize: number,         // 海岛主体边长 (30)
  sizeVariance: number,       // 大小浮动范围 (±2)
  transitionSize: number,     // 过渡带大小 (4)

  // 区域参数
  regionSize: number,         // 每 400x400 区域生成一座海岛
  spawnProbability: number,   // 生成概率 (0.08 = 8%)

  // 距离参数
  minDistanceFromLand: number, // 与大陆的最小距离 (20)
  seaLevel: number,           // 海平面高度 (-2)

  // 形状参数
  shapeNoiseScale: number,    // 形状噪声尺度 (0.1)
  edgeNoiseScale: number,     // 边缘噪声尺度 (0.2)
  stretchFactor: number,      // 拉伸因子 (1.0-1.5)

  // 方块分布参数
  sandPatchCount: number,     // sand 区域种子点数量 (3-5)
  stonePatchCount: number,    // stone 区域种子点数量 (2-4)
  patchNoiseScale: number,    // 分布噪声尺度 (0.15)

  // 树木参数
  minTrees: number,           // 最小树木数量 (1)
  maxTrees: number,           // 最大树木数量 (2)
  treeSpawnYOffset: number    // 树木生成 Y 偏移 (1)
}
```

**默认配置**:
```javascript
const DEFAULT_ISLAND_CONFIG = {
  islandSize: 30,
  sizeVariance: 2,
  transitionSize: 4,
  regionSize: 400,
  spawnProbability: 0.08,
  minDistanceFromLand: 20,
  seaLevel: -2,
  shapeNoiseScale: 0.1,
  edgeNoiseScale: 0.2,
  stretchFactor: 1.0,
  sandPatchCount: 4,
  stonePatchCount: 3,
  patchNoiseScale: 0.15,
  minTrees: 1,
  maxTrees: 2,
  treeSpawnYOffset: 1
};
```

### 3. IslandSpawnPoint (海岛出生点)

玩家在海岛附近重生时的出生点信息。

```javascript
{
  x: number,          // 出生点 X 坐标
  y: number,          // 出生点 Y 坐标（地表高度 + 1）
  z: number,          // 出生点 Z 坐标
  islandCenterX: number,  // 所属海岛中心 X
  islandCenterZ: number,  // 所属海岛中心 Z
  isBeach: boolean,       // 是否在沙滩边缘
  yaw: number,            // 初始朝向角度
  pitch: number           // 初始俯视角度
}
```

## Data Relationships

```
┌─────────────────┐
│ IslandConfig    │ 静态配置，全局共享
└────────┬────────┘
         │ 被...使用
         ▼
┌─────────────────┐
│ IslandInfo      │ 每个区块生成时动态创建
└────────┬────────┘
         │ 包含
         ▼
┌─────────────────┐
│ IslandSpawnPoint│ 可选，当玩家在海岛出生时
└─────────────────┘
```

## Validation Rules

### IslandInfo 验证

| 规则 | 描述 |
|------|------|
| V-001 | `centerX` 和 `centerZ` 必须是整数 |
| V-002 | `transitionFactor` 必须在 [0, 1] 范围内 |
| V-003 | `zone` 必须是 `'core'` 或 `'transition'` |
| V-004 | `blockType` 必须是 `'sand'` 或 `'stone'` |
| V-005 | `surfaceY` 必须基于地形高度计算，高低差不超过 2 格 |

### 方块分布验证

| 规则 | 描述 |
|------|------|
| V-101 | sand 方块和 stone 方块必须各自成片分布 |
| V-102 | 80% 以上的同类型方块至少与一个同类型方块相邻 |
| V-103 | 沙滩（sand）必须位于海岸边缘（靠近海水） |
| V-104 | stone 主要分布在海岛内部区域 |

## State Transitions

海岛生成是一次性过程，不涉及状态转换。但以下情况需要注意：

### 存档加载时的状态恢复

```
生成状态 → 保存到 snapshot → 读档恢复
   ↓              ↓              ↓
动态计算     方块数据 + 实体    从 snapshot 重建
```

**关键点**:
- 海岛的方块数据通过 snapshot 保存
- 树木等实体通过 `structureCenters` 记录
- 读档时优先使用 snapshot 数据，而不是重新生成

## Integration Points

### 与 WorldWorker 的集成

```javascript
// WorldWorker.js 中的使用模式
import { IslandMap } from './maps/IslandMap.js';

// 主生成循环中
const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
if (islandInfo) {
  IslandMap.generate(wx, wz, h, islandInfo, fakeChunk, dPlaceholder);
}
```

### 与 Game.js 的集成（出生点）

```javascript
// Game.js 中修改玩家初始生成逻辑
import { findIslandSpawnPoint } from './world/World.js';

// 玩家生成时
const spawnPoint = world.findSpawnPoint();
if (spawnPoint.isIsland) {
  // 在海岛出生
  player.setPosition(spawnPoint.x, spawnPoint.y, spawnPoint.z);
}
```

## Memory Management

### IslandInfo 生命周期

1. **创建**: 在 WorldWorker 中为每个区块生成时创建
2. **传递**: 通过 postMessage 发送到主线程
3. **使用**: 主线程用于渲染和实体管理
4. **销毁**: 区块卸载时自动释放（GC 回收）

### 注意事项

- IslandInfo 对象不应长期持有引用
- 避免在 IslandInfo 中存储大型数据结构
- 使用简单的数值和字符串类型
