# Data Model: 海岛炮塔实体

**Feature**: 海岛炮塔实体 (022-island-battery)
**Date**: 2026-03-17

## 实体定义

### Battery (炮塔)

| 属性 | 类型 | 说明 |
|------|------|------|
| id | string | 实体标识符: `"battery"` |
| type | string | 实体类型: `"json"` (使用 JsonEntity) |
| biomes | string[] | 适用生物群系: `["OCEAN"]` (海岛属于海洋区域) |
| probability | number | 生成概率: `1.0` (每个海岛必生成) |
| loader | StructureLoader | 结构加载器引用 |
| crossChunkDist | number | 跨区块渲染距离: `8` (根据结构大小调整) |
| categories | string[] | 分类标签: `["structure", "island", "battery"]` |

### 生成位置约束

| 约束 | 值 | 说明 |
|------|-----|------|
| minDistFromCenter | 3 | 距离海岛中心最小格数 |
| maxDistFromCenter | 8 | 距离海岛中心最大格数 |
| surfaceY | ISLAND_SEA_LEVEL | 生成高度（海平面）|

### Battery 结构方块组成

基于 `battery.json` 定义：

| 部位 | 方块类型 | 数量 | 说明 |
|------|----------|------|------|
| 基座 | iron_ore | 9 | 3x3 底部平台 |
| 支柱 | obsidian | 2 | 垂直支柱 |
| 顶部核心 | iron | 2 | 顶部结构 |
| 炮管 | horizontal_pillar | 2 | 水平延伸炮管 |

**总方块数**: 15

## 数据流

```
WorldWorker (海岛生成)
    ↓
IslandMap.generateIsland() 完成地形生成
    ↓
calculateBatteryPosition(islandCx, islandCz, seed)
    ↓ 确定性随机计算位置
StructureLoader.battery.generate(x, y, z, chunk, dObj)
    ↓
JsonEntity 将方块写入 Chunk
    ↓
渲染系统使用 InstancedMesh 渲染
```

## 接口契约

### 新增 StructureLoader

```javascript
// StructureLoader.js
export const structureLoaders = {
  // ... existing loaders
  battery: new StructureLoader('battery', new URL('../structures/battery.json', moduleBase).href)
};
```

### 新增 Entity 注册

```javascript
// EntityManager.initStructures()
this.register('battery', new JsonEntity({
  id: 'battery',
  biomes: ['OCEAN'],
  probability: 1.0,  // 每个符合条件的位置都生成
  condition: (wx, wy, wz, biome, seed) => {
    // 只在海岛石头区域生成
    return isBatterySpawnLocation(wx, wz, seed);
  },
  loader: null,  // 将在 initSpecial 中设置
  crossChunkDist: 8,
  categories: ['structure', 'island', 'battery']
}));
```

### 海岛生成集成

```javascript
// IslandMap.js - generateIsland 函数后
export function generateBatteryForIsland(islandCx, islandCz, seed, fakeChunk, dPlaceholder) {
  const position = calculateBatteryPosition(islandCx, islandCz, seed);
  if (position) {
    const { x, z } = position;
    const y = ISLAND_SEA_LEVEL + 1;  // 海平面上一格
    // 使用 EntityManager 或 StructureLoader 直接生成
  }
}
```

## 状态说明

炮塔为**纯静态结构**，无运行时状态：
- **初始状态**: 世界生成时创建
- **破坏后**: 永久消失（不重生）
- **加载时**: 作为普通方块从区块数据恢复

无状态转换图（stateless）。
