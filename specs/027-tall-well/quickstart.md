# Quickstart: Tall Well 结构生成

**Feature**: 027-tall-well
**Date**: 2026-03-27

## Overview

快速参考指南：如何在 City 地图中集成 tall_well 结构生成。

## Files to Modify

| 文件 | 修改类型 | 描述 |
|------|----------|------|
| `src/world/entity-system/StructureLoader.js` | 修改 | 注册 tall_well 加载器 |
| `src/workers/WorldWorker.js` | 修改 | 集成生成逻辑 |

## Implementation Steps

### Step 1: Register Structure Loader

在 `StructureLoader.js` 中添加：

```javascript
// 在 structureLoaders 对象中
export const structureLoaders = {
  // ... existing loaders
  tallWell: new StructureLoader('tall_well', new URL('../structures/tall_well.json', moduleBase).href)
};

// 在 preloadAllStructures 函数中
await Promise.all([
  // ... existing preloads
  structureLoaders.tallWell.load()
]);
```

### Step 2: Import in WorldWorker

在 `WorldWorker.js` 中导入：

```javascript
const {
  // ... existing loaders
  tallWell
} = structureLoaders;
```

### Step 3: Add Generation Logic

在 `WorldWorker.js` 中添加与 pavilion 类似的生成逻辑：

```javascript
// 常量定义
const CITY_TALL_WELL_CHANCE = CITY_FLOWER_BED_CHANCE * 6;

// 占用记录 Set
const cityTallWellFootprintCells = new Set();

// Footprint 计算
const tallWellFootprint = getLoaderBottomFootprint(tallWell) || { minX: -5, maxX: 5, minZ: -3, maxZ: 3 };
const tallWellHalfX = Math.ceil(Math.max(Math.abs(tallWellFootprint.minX), Math.abs(tallWellFootprint.maxX)));
const tallWellHalfZ = Math.ceil(Math.max(Math.abs(tallWellFootprint.minZ), Math.abs(tallWellFootprint.maxZ)));

// 辅助函数：收集 footprint 单元格
function collectTallWellFootprintCells(centerX, centerZ) {
  const cells = [];
  for (let ox = tallWellFootprint.minX; ox <= tallWellFootprint.maxX; ox++) {
    for (let oz = tallWellFootprint.minZ; oz <= tallWellFootprint.maxZ; oz++) {
      cells.push(`${centerX + ox},${centerZ + oz}`);
    }
  }
  return cells;
}

// 检查是否已预留
function isTallWellFootprintReserved(centerX, centerZ) {
  const cells = collectTallWellFootprintCells(centerX, centerZ);
  for (const key of cells) {
    if (cityTallWellFootprintCells.has(key)) return true;
  }
  return false;
}

// 预留 footprint
function reserveTallWellFootprint(centerX, centerZ) {
  const cells = collectTallWellFootprintCells(centerX, centerZ);
  for (const key of cells) {
    cityTallWellFootprintCells.add(key);
  }
}

// 检查空间清空
function isTallWellSpaceClear(centerX, centerY, centerZ) {
  for (let ox = tallWellFootprint.minX; ox <= tallWellFootprint.maxX; ox++) {
    for (let oz = tallWellFootprint.minZ; oz <= tallWellFootprint.maxZ; oz++) {
      const wx = centerX + ox;
      const wz = centerZ + oz;
      const cellInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
      if (!cellInfo || cellInfo.transitionFactor > 0) return false;

      const surfaceY = CityMap.getCitySurfaceY(wx, wz, seed, terrainGen);
      if (surfaceY === null || Math.abs(surfaceY + 1 - centerY) > 1) return false;

      for (let y = centerY; y <= centerY + 2; y++) {
        if (fakeChunk.getBlockType(wx, y, wz)) return false;
      }
    }
  }
  return true;
}

// 检查是否可以放置
function canPlaceCityTallWell(centerX, centerY, centerZ) {
  const tallWellRadius = Math.max(tallWellHalfX, tallWellHalfZ);
  const nearMajorBuilding = CityMap.isPointNearCityStructure(centerX, centerZ, seed, terrainGen, tallWellRadius + 1);
  const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, centerX, centerZ, tallWellRadius + 3);
  const nearFlowerBed = isNearRecordedCenter(cityFlowerBedCenters, centerX, centerZ, tallWellRadius + 5);
  const nearTree = isNearRecordedCenter(cityTreeCenters, centerX, centerZ, tallWellRadius + 4) ||
    isNearRecordedCenter(cityTallTreeCenters, centerX, centerZ, tallWellRadius + 5) ||
    isNearRecordedCenter(citySwampTreeCenters, centerX, centerZ, tallWellRadius + 4) ||
    isNearRecordedCenter(cityYellowTreeCenters, centerX, centerZ, tallWellRadius + 4) ||
    isNearRecordedCenter(cityBirchTreeCenters, centerX, centerZ, tallWellRadius + 4);

  // 关键：检查 pavilion 占用
  const nearPavilion = isPavilionFootprintReserved(centerX, centerZ);

  if (nearMajorBuilding || nearFillerHouse || nearFlowerBed || nearTree || nearPavilion) return false;
  if (isTallWellFootprintReserved(centerX, centerZ)) return false;

  return isTallWellSpaceClear(centerX, centerY, centerZ);
}

// 加入生成队列
let hasQueuedCityTallWell = false;
function queueCityTallWell(centerX, centerY, centerZ) {
  if (!canPlaceCityTallWell(centerX, centerY, centerZ)) return false;

  createStructureTask(
    generateTallWell.bind(null, centerX, centerY, centerZ, fakeChunk, dPlaceholder),
    centerX,
    centerY,
    centerZ,
    'tall_well'
  );
  reserveTallWellFootprint(centerX, centerZ);
  hasQueuedCityTallWell = true;
  return true;
}

// 生成函数
function generateTallWell(x, y, z, chunk, dObj) {
  tallWell.generate(x, y, z, chunk, dObj, true);
}
```

### Step 4: Integration Points

在 pavilion 生成之后添加 tall_well 生成：

```javascript
// City 后置填充：在 pavilion 之后尝试生成 tall_well
for (const candidate of cityCoreCandidates) {
  if (seededRandom(candidate.x, candidate.z, seed + 826) >= CITY_TALL_WELL_CHANCE) continue;
  queueCityTallWell(candidate.x, candidate.y, candidate.z);
}

// 兜底：若本 Chunk 未成功生成 tall_well，强制尝试一次
if (!hasQueuedCityTallWell && cityCoreCandidates.length > 0 && shouldRunCityFallback) {
  // ... 类似 pavilion 的兜底逻辑
}
```

## Testing

1. 启动开发服务器: `npm run start`
2. 访问 http://localhost:8080
3. 传送到 City 地图观察 tall_well 生成
4. 验证 tall_well 与 pavilion 不重叠

## Key Considerations

- **避免重叠**: tall_well 必须检查 pavilion 的 footprint 占用
- **概率相同**: CITY_TALL_WELL_CHANCE = CITY_FLOWER_BED_CHANCE * 6
- **顺序**: pavilion 先生成，tall_well 后生成
