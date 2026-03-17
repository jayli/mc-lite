// src/workers/maps/IslandMap.js
// 海岛生成器模块 - 不依赖 Tree，树木生成在 WorldWorker 中处理

import { getFrozenMountainCenterInRegion } from './FrozenMountain.js';
import { getRegionSeededCenter } from './RegionCenterUtils.js';
import {
  REGION_SIZE,
  REGION_MIN_MARGIN,
  ISLAND_SIZE,
  TRANSITION_SIZE,
  LANDMARK_MIN_DISTANCE,
  ISLAND_SEA_LEVEL,
  ISLAND_SHAPE_NOISE_SCALE,
  ISLAND_EDGE_NOISE_SCALE,
  ISLAND_SAND_PATCH_COUNT,
  ISLAND_STONE_PATCH_COUNT,
  ISLAND_PATCH_NOISE_SCALE,
  CENTER_OFFSET
} from '../../constants/RegionMapConfig.js';

/**
 * 确定性随机函数
 * @param {number} x - X 坐标
 * @param {number} z - Z 坐标
 * @param {number} seed - 种子
 * @returns {number} 0-1 之间的随机数
 */
const seededRandom = (x, z, seed) => {
  const val = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453123;
  return val - Math.floor(val);
};

/**
 * 获取指定区域内海岛的中心位置
 * @param {number} regionX - 区域 X 坐标
 * @param {number} regionZ - 区域 Z 坐标
 * @param {number} seed - 世界种子
 * @returns {Object} 海岛中心位置和其他地标位置 { islandCx, islandCz, pyramidCx, pyramidCz, frozenMountainCx, frozenMountainCz }
 */
export function getIslandCenterInRegion(regionX, regionZ, seed) {
  const { centerX: pyramidCx, centerZ: pyramidCz } = getRegionSeededCenter(regionX, regionZ, seed, {
    offsetScaleX: CENTER_OFFSET.SCALE_X,
    offsetScaleZ: CENTER_OFFSET.SCALE_Z,
    offsetBaseX: CENTER_OFFSET.BASE_X,
    offsetBaseZ: CENTER_OFFSET.BASE_Z
  });

  // 获取冰封山峰位置（复用 FrozenMountain 的函数）
  const { cx: frozenMountainCx, cz: frozenMountainCz } =
    getFrozenMountainCenterInRegion(regionX, regionZ, seed);

  // 计算海岛中心位置
  const { centerX: initialIslandCx, centerZ: initialIslandCz } = getRegionSeededCenter(regionX, regionZ, seed, {
    offsetScaleX: REGION_SIZE - 100,
    offsetScaleZ: REGION_SIZE - 100,
    offsetBaseX: 50,
    offsetBaseZ: 50
  });

  let islandCx = initialIslandCx;
  let islandCz = initialIslandCz;

  // 距离检查：远离冰封山峰
  const minMountainDistance = LANDMARK_MIN_DISTANCE.ISLAND_FROM_MOUNTAIN;
  const distMountainX = Math.abs(islandCx - frozenMountainCx);
  const distMountainZ = Math.abs(islandCz - frozenMountainCz);
  const distFromMountain = Math.max(distMountainX, distMountainZ);

  if (distFromMountain < minMountainDistance) {
    islandCx = frozenMountainCx + (islandCx > frozenMountainCx ? -minMountainDistance : minMountainDistance);
    islandCz = frozenMountainCz + (islandCz > frozenMountainCz ? -minMountainDistance : minMountainDistance);
  }

  // 距离检查：远离金字塔
  const minPyramidDistance = LANDMARK_MIN_DISTANCE.ISLAND_FROM_PYRAMID;
  const distPyramidX = Math.abs(islandCx - pyramidCx);
  const distPyramidZ = Math.abs(islandCz - pyramidCz);
  const distFromPyramid = Math.max(distPyramidX, distPyramidZ);

  if (distFromPyramid < minPyramidDistance) {
    islandCx = pyramidCx + (islandCx > pyramidCx ? -minPyramidDistance : minPyramidDistance);
    islandCz = pyramidCz + (islandCz > pyramidCz ? -minPyramidDistance : minPyramidDistance);
  }

  // 边界检查
  const halfSize = Math.floor(ISLAND_SIZE / 2);
  const transitionSize = TRANSITION_SIZE.ISLAND;
  const totalHalfSize = halfSize + transitionSize;
  const minMargin = totalHalfSize + REGION_MIN_MARGIN;

  const regionLeft = regionX * REGION_SIZE;
  const regionRight = (regionX + 1) * REGION_SIZE;
  const regionTop = regionZ * REGION_SIZE;
  const regionBottom = (regionZ + 1) * REGION_SIZE;

  if (islandCx - minMargin < regionLeft) {
    islandCx = regionLeft + minMargin;
  } else if (islandCx + minMargin > regionRight) {
    islandCx = regionRight - minMargin;
  }
  if (islandCz - minMargin < regionTop) {
    islandCz = regionTop + minMargin;
  } else if (islandCz + minMargin > regionBottom) {
    islandCz = regionBottom - minMargin;
  }

  // 边界调整后，再次确保海岛远离冰封山峰
  const distMountainX2 = Math.abs(islandCx - frozenMountainCx);
  const distMountainZ2 = Math.abs(islandCz - frozenMountainCz);
  const distFromMountain2 = Math.max(distMountainX2, distMountainZ2);

  if (distFromMountain2 < minMountainDistance) {
    const candidates = [
      { x: regionLeft + minMargin, z: regionTop + minMargin },
      { x: regionLeft + minMargin, z: regionBottom - minMargin },
      { x: regionRight - minMargin, z: regionTop + minMargin },
      { x: regionRight - minMargin, z: regionBottom - minMargin }
    ];
    let bestCandidate = null;
    let bestDist = 0;
    for (const candidate of candidates) {
      const dX = Math.abs(candidate.x - frozenMountainCx);
      const dZ = Math.abs(candidate.z - frozenMountainCz);
      const d = Math.max(dX, dZ);
      if (d > bestDist) {
        bestDist = d;
        bestCandidate = candidate;
      }
    }
    if (bestCandidate && bestDist >= minMountainDistance) {
      islandCx = bestCandidate.x;
      islandCz = bestCandidate.z;
    }
  }

  // 边界和距离调整后，再次检查金字塔距离
  const distPyramidX2 = Math.abs(islandCx - pyramidCx);
  const distPyramidZ2 = Math.abs(islandCz - pyramidCz);
  const distFromPyramid2 = Math.max(distPyramidX2, distPyramidZ2);

  if (distFromPyramid2 < minPyramidDistance) {
    if (islandCx > pyramidCx) {
      islandCx = Math.min(regionRight - minMargin, pyramidCx + minPyramidDistance);
    } else {
      islandCx = Math.max(regionLeft + minMargin, pyramidCx - minPyramidDistance);
    }
    if (islandCz > pyramidCz) {
      islandCz = Math.min(regionBottom - minMargin, pyramidCz + minPyramidDistance);
    } else {
      islandCz = Math.max(regionTop + minMargin, pyramidCz - minPyramidDistance);
    }
  }

  return { islandCx, islandCz, pyramidCx, pyramidCz, frozenMountainCx, frozenMountainCz };
}

/**
 * 获取海岛信息
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器
 * @returns {Object|null} 海岛信息对象或 null
 */
export function getIslandInfo(wx, wz, seed, terrainGen) {
  const seaLevel = ISLAND_SEA_LEVEL;
  const islandSize = ISLAND_SIZE;
  const transitionSize = TRANSITION_SIZE.ISLAND;
  const halfSize = Math.floor(islandSize / 2);
  const totalHalfSize = halfSize + transitionSize;

  // 计算区域
  const regionX = Math.floor(wx / REGION_SIZE);
  const regionZ = Math.floor(wz / REGION_SIZE);

  // 使用共享函数获取海岛中心位置
  const { islandCx, islandCz } = getIslandCenterInRegion(regionX, regionZ, seed);

  // 计算距离（使用 Max 距离判断方形范围）
  const dx = Math.abs(wx - islandCx);
  const dz = Math.abs(wz - islandCz);
  const distFromCenter = Math.max(dx, dz);

  // 检查是否在范围内
  if (dx > totalHalfSize || dz > totalHalfSize) {
    return null;
  }

  // 检查基础地形高度：海岛只生成在海里（基础地形高度低于海平面）
  // 使用海岛中心位置的高度作为参考
  const centerBiome = terrainGen ? terrainGen.getBiome(islandCx, islandCz) : 'OCEAN';
  const centerHeight = terrainGen ? terrainGen.generateHeight(islandCx, islandCz, centerBiome) : -10;

  // 如果中心位置的基础地形高度高于或等于海平面，说明这里不是海洋，不生成海岛
  if (centerHeight >= seaLevel) {
    return null;
  }

  // 判断区域
  const zone = distFromCenter <= halfSize ? 'core' : 'transition';
  const transitionFactor = zone === 'core' ? 0 : (distFromCenter - halfSize) / transitionSize;

  return {
    centerX: islandCx,
    centerZ: islandCz,
    zone,
    transitionFactor,
    distFromCenter
  };
}

/**
 * 海岛形状噪声算法 - 生成不规则海岸线
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} _islandInfo - 海岛信息（预留）
 * @returns {number} 形状噪声值
 */
function getIslandShapeNoise(wx, wz, seed, _islandInfo) {
  const shapeNoiseScale = ISLAND_SHAPE_NOISE_SCALE;
  const edgeNoiseScale = ISLAND_EDGE_NOISE_SCALE;

  // 主噪声：决定海岛主体轮廓（低频大波浪）
  const baseNoise = Math.sin(wx * shapeNoiseScale + seed) * Math.cos(wz * shapeNoiseScale + seed);

  // 中频噪声：添加中等尺度的不规则性
  const midNoise = Math.sin(wx * shapeNoiseScale * 2 + seed * 1.5) * Math.cos(wz * shapeNoiseScale * 2 + seed * 1.5) * 0.5;

  // 细节噪声：添加海岸线破碎感（高频小波浪）
  const detailNoise = Math.sin(wx * edgeNoiseScale + seed * 2) * Math.cos(wz * edgeNoiseScale + seed * 2) * 0.5;

  // 额外的高频噪声：增加更细的破碎感
  const fineNoise = Math.sin(wx * edgeNoiseScale * 2 + seed * 3) * Math.cos(wz * edgeNoiseScale * 2 + seed * 3) * 0.25;

  // 组合噪声：多层叠加产生自然的不规则效果
  return baseNoise * shapeNoiseScale + midNoise * shapeNoiseScale * 0.5 + detailNoise * edgeNoiseScale + fineNoise * edgeNoiseScale * 0.5;
}

/**
 * 判断坐标是否在海岛范围内（考虑形状噪声）
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {Object} islandInfo - 海岛信息
 * @param {number} seed - 世界种子
 * @returns {boolean} 是否在海岛范围内
 */
function isInIsland(wx, wz, islandInfo, seed) {
  const shapeNoise = getIslandShapeNoise(wx, wz, seed, islandInfo);
  // 增加形状噪声的影响力度，让海岸线更不规则
  const effectiveDist = islandInfo.distFromCenter - shapeNoise * 8;
  const islandSize = ISLAND_SIZE;
  const transitionSize = TRANSITION_SIZE.ISLAND;
  const halfSize = Math.floor(islandSize / 2);
  const totalHalfSize = halfSize + transitionSize;

  return effectiveDist <= totalHalfSize;
}

/**
 * 方块分片聚集分布算法 - 使用 Voronoi 区域 + 噪声扰动
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {Object} islandInfo - 海岛信息
 * @param {number} seed - 世界种子
 * @returns {'sand'|'stone'} 方块类型
 */
function getBlockDistribution(wx, wz, islandInfo, seed) {
  const sandPatchCount = ISLAND_SAND_PATCH_COUNT;
  const stonePatchCount = ISLAND_STONE_PATCH_COUNT;
  const patchNoiseScale = ISLAND_PATCH_NOISE_SCALE;
  const { centerX, centerZ, distFromCenter } = islandInfo;

  // 计算相对于海岛中心的坐标
  const localX = wx - centerX;
  const localZ = wz - centerZ;

  // 生成种子点（基于确定性随机）
  const sandSeeds = [];
  const stoneSeeds = [];

  for (let i = 0; i < sandPatchCount; i++) {
    const angle = seededRandom(i, i + 10, seed + 100) * Math.PI * 2;
    const radius = 5 + seededRandom(i + 1, i + 11, seed + 101) * 8;
    sandSeeds.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius
    });
  }

  for (let i = 0; i < stonePatchCount; i++) {
    const angle = seededRandom(i + 5, i + 15, seed + 200) * Math.PI * 2;
    const radius = 3 + seededRandom(i + 6, i + 16, seed + 201) * 5;
    stoneSeeds.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius
    });
  }

  // 找到最近的种子点
  let minSandDist = Infinity;
  let minStoneDist = Infinity;

  for (const s of sandSeeds) {
    const dist = Math.sqrt((localX - s.x) ** 2 + (localZ - s.z) ** 2);
    minSandDist = Math.min(minSandDist, dist);
  }

  for (const s of stoneSeeds) {
    const dist = Math.sqrt((localX - s.x) ** 2 + (localZ - s.z) ** 2);
    minStoneDist = Math.min(minStoneDist, dist);
  }

  // 添加噪声扰动
  const noise = Math.sin(localX * patchNoiseScale) * Math.cos(localZ * patchNoiseScale) * 0.5;

  // 根据距离和噪声决定类型
  // 沙滩区域（边缘）优先是 sand，内部区域优先是 stone
  const beachThreshold = ISLAND_SIZE / 2 - 3;

  if (distFromCenter > beachThreshold) {
    // 沙滩区域：sand 为主
    return 'sand';
  } else {
    // 内部区域：根据 Voronoi 决定
    const adjustedSandDist = minSandDist + noise;
    const adjustedStoneDist = minStoneDist - noise;
    return adjustedSandDist < adjustedStoneDist ? 'sand' : 'stone';
  }
}

/**
 * 生成海岛方块
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} _h - 基础地形高度（预留）
 * @param {Object} islandInfo - 海岛信息
 * @param {Object} fakeChunk - 模拟 Chunk 对象
 * @param {Object} dPlaceholder - 占位符对象
 * @returns {Object} 生成结果 { surfaceY, isBelowSeaLevel }
 */
export function generateIsland(wx, wz, _h, islandInfo, fakeChunk, dPlaceholder, seed) {
  const seaLevel = ISLAND_SEA_LEVEL;
  const islandSize = ISLAND_SIZE;
  const halfSize = Math.floor(islandSize / 2);

  // 检查是否在海岛范围内
  if (!isInIsland(wx, wz, islandInfo, seed)) {
    return null;
  }

  // 海岛表面高度完全固定（海平面以上 0 格，即与海平面齐平）
  const surfaceY = seaLevel;

  // 判断是否在海平面以下
  const isBelowSeaLevel = surfaceY <= seaLevel - 1;

  // 计算到中心的距离，决定方块类型
  // 边缘是 sand（沙滩），内部是 stone
  const distFromCenter = islandInfo.distFromCenter;

  // 使用形状噪声来扰动沙滩边界，让沙滩和石头的分界更自然
  const shapeNoise = getIslandShapeNoise(wx, wz, seed, islandInfo);
  // 沙滩阈值随噪声动态变化，产生不规则的 sand/stone 边界
  const baseBeachThreshold = halfSize - 3;
  const noiseOffset = shapeNoise * 3;
  const beachThreshold = baseBeachThreshold + noiseOffset;

  // 表面方块：边缘是 sand，内部是 stone（边界受噪声影响）
  const surfaceBlock = distFromCenter > beachThreshold ? 'sand' : 'stone';

  // 生成地表方块
  fakeChunk.add(wx, surfaceY, wz, surfaceBlock, dPlaceholder);

  // 地下填充：表面下方 2 层 dirt，再下面是 stone，一直填充到基岩层
  // 基岩层高度 = 表面高度 - 11（与普通地形保持一致）
  const bedrockY = surfaceY - 11; // 基岩层在表面下方 11 格
  for (let y = surfaceY - 1; y >= bedrockY; y--) {
    let fillType;
    if (y >= surfaceY - 2) {
      fillType = 'dirt'; // 表面下方 2 层 dirt
    } else {
      fillType = 'stone'; // 再下面是 stone
    }
    fakeChunk.add(wx, y, wz, fillType, dPlaceholder);
  }

  return { surfaceY, isBelowSeaLevel };
}

/**
 * 计算海岛出生点位置
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器
 * @returns {Object|null} 出生点信息 { x, y, z, islandCenterX, islandCenterZ, isBeach, yaw, pitch } 或 null
 */
export function getIslandSpawnPoint(seed, terrainGen) {
  const islandSize = ISLAND_SIZE;
  const seaLevel = ISLAND_SEA_LEVEL;
  const halfSize = Math.floor(islandSize / 2);
  const beachRadius = halfSize - 1;

  // 遍历几个区域，找到第一个可用的海岛
  for (let regionX = -2; regionX <= 2; regionX++) {
    for (let regionZ = -2; regionZ <= 2; regionZ++) {
      // 使用共享函数获取海岛中心位置
      const { islandCx, islandCz } = getIslandCenterInRegion(regionX, regionZ, seed);

      // 检查基础地形高度：海岛只生成在海里
      const centerBiome = terrainGen ? terrainGen.getBiome(islandCx, islandCz) : 'OCEAN';
      const centerHeight = terrainGen ? terrainGen.generateHeight(islandCx, islandCz, centerBiome) : -10;
      if (centerHeight >= seaLevel) {
        continue; // 不是海洋，跳过这个区域
      }

      // 在海滩边缘找出生点
      const directions = [
        { x: 1, z: 0, yaw: 0 },
        { x: -1, z: 0, yaw: Math.PI },
        { x: 0, z: 1, yaw: Math.PI / 2 },
        { x: 0, z: -1, yaw: -Math.PI / 2 }
      ];

      for (const dir of directions) {
        const spawnX = islandCx + dir.x * beachRadius;
        const spawnZ = islandCz + dir.z * beachRadius;

        const islandInfo = getIslandInfo(spawnX, spawnZ, seed, terrainGen);
        if (islandInfo) {
          return {
            x: spawnX,
            y: seaLevel + 2,
            z: spawnZ,
            islandCenterX: islandCx,
            islandCenterZ: islandCz,
            isBeach: true,
            yaw: dir.yaw,
            pitch: 0,
            zone: islandInfo.zone
          };
        }
      }
    }
  }

  return null;
}

// 模块导出
export const IslandMap = {
  getIslandInfo,
  getIslandCenterInRegion,
  generate: generateIsland,
  getIslandSpawnPoint
};
