// src/workers/maps/IslandMap.js
// 海岛生成器模块 - 不依赖 Tree，树木生成在 WorldWorker 中处理

// 海岛配置常量
const ISLAND_CONFIG = {
  regionSize: 400,         // 每 400x400 区域生成一座海岛
  islandSize: 30,          // 海岛主体边长
  transitionSize: 4,       // 过渡带大小
  spawnProbability: 0.08,  // 生成概率 (8%)
  seaLevel: -2,            // 海平面高度
  minDistanceFromLand: 20, // 与大陆的最小距离
  shapeNoiseScale: 0.1,    // 形状噪声尺度
  edgeNoiseScale: 0.2,     // 边缘噪声尺度
  sandPatchCount: 4,       // sand 区域种子点数量
  stonePatchCount: 3,      // stone 区域种子点数量
  patchNoiseScale: 0.15,   // 分布噪声尺度
  minTrees: 1,             // 最小树木数量
  maxTrees: 2,             // 最大树木数量
  treeSpawnYOffset: 1      // 树木生成 Y 偏移
};

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
 * 获取海岛信息
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器
 * @returns {Object|null} 海岛信息对象或 null
 */
export function getIslandInfo(wx, wz, seed, terrainGen) {
  const { regionSize, islandSize, transitionSize, minDistanceFromLand } = ISLAND_CONFIG;
  const halfSize = Math.floor(islandSize / 2);
  const totalHalfSize = halfSize + transitionSize;

  // 计算区域
  const regionX = Math.floor(wx / regionSize);
  const regionZ = Math.floor(wz / regionSize);

  // 计算海岛中心（确定性随机）
  // 确保海岛中心距离区域边界至少 minDistanceFromLand + islandSize/2
  // 这样海岛边缘距离区域边界至少有 minDistanceFromLand 的距离
  const minOffset = minDistanceFromLand + halfSize;
  const maxOffset = regionSize - minOffset;
  const randX = Math.abs(Math.sin(seed * 1.5 + regionX * 0.1));
  const randZ = Math.abs(Math.sin(seed * 2.5 + regionZ * 0.1));
  const offsetX = Math.floor(randX * (maxOffset - minOffset)) + minOffset;
  const offsetZ = Math.floor(randZ * (maxOffset - minOffset)) + minOffset;

  const islandCx = regionX * regionSize + offsetX;
  const islandCz = regionZ * regionSize + offsetZ;

  // 计算距离（使用 Max 距离判断方形范围）
  const dx = Math.abs(wx - islandCx);
  const dz = Math.abs(wz - islandCz);
  const distFromCenter = Math.max(dx, dz);

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
    transitionFactor,
    distFromCenter
  };
}

/**
 * 海岛形状噪声算法 - 生成不规则海岸线
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} islandInfo - 海岛信息
 * @returns {number} 形状噪声值
 */
function getIslandShapeNoise(wx, wz, seed, islandInfo) {
  const { shapeNoiseScale, edgeNoiseScale } = ISLAND_CONFIG;

  // 主噪声：决定海岛主体轮廓
  const baseNoise = Math.sin(wx * shapeNoiseScale + seed) * Math.cos(wz * shapeNoiseScale + seed);

  // 细节噪声：添加海岸线不规则性
  const detailNoise = Math.sin(wx * edgeNoiseScale + seed * 2) * Math.cos(wz * edgeNoiseScale + seed * 2) * 0.5;

  // 组合噪声
  return baseNoise * shapeNoiseScale + detailNoise * edgeNoiseScale;
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
  const effectiveDist = islandInfo.distFromCenter - shapeNoise * 5;
  const { islandSize, transitionSize } = ISLAND_CONFIG;
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
  const { sandPatchCount, stonePatchCount, patchNoiseScale } = ISLAND_CONFIG;
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
  const beachThreshold = ISLAND_CONFIG.islandSize / 2 - 3;

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
 * @param {number} h - 基础地形高度
 * @param {Object} islandInfo - 海岛信息
 * @param {Object} fakeChunk - 模拟 Chunk 对象
 * @param {Object} dPlaceholder - 占位符对象
 * @returns {Object} 生成结果 { surfaceY, isBelowSeaLevel }
 */
export function generateIsland(wx, wz, h, islandInfo, fakeChunk, dPlaceholder, seed) {
  const { seaLevel, islandSize } = ISLAND_CONFIG;
  const halfSize = Math.floor(islandSize / 2);

  // 检查是否在海岛范围内
  if (!isInIsland(wx, wz, islandInfo, seed)) {
    return null;
  }

  // 海岛表面高度完全固定（海平面以上 1 格），确保绝对平整
  const surfaceY = seaLevel + 1;

  // 判断是否在海平面以下
  const isBelowSeaLevel = surfaceY <= seaLevel - 1;

  // 计算到中心的距离，决定方块类型
  // 边缘是 sand（沙滩），内部是 stone
  const distFromCenter = islandInfo.distFromCenter;
  const beachThreshold = halfSize - 2; // 边缘 2 格是沙滩

  // 表面方块：边缘是 sand，内部是 stone
  const surfaceBlock = distFromCenter > beachThreshold ? 'sand' : 'stone';

  // 生成地表方块
  fakeChunk.add(wx, surfaceY, wz, surfaceBlock, dPlaceholder);

  // 地下填充：表面下方 2 层 dirt，再下面是 stone
  for (let y = surfaceY - 1; y >= seaLevel - 4; y--) {
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
  const { regionSize, islandSize, transitionSize, seaLevel } = ISLAND_CONFIG;
  const halfSize = Math.floor(islandSize / 2);
  const totalHalfSize = halfSize + transitionSize;
  const beachRadius = halfSize - 1; // 沙滩边缘半径（靠近核心区域边缘）

  // 遍历几个区域，找到第一个可用的海岛
  for (let regionX = -2; regionX <= 2; regionX++) {
    for (let regionZ = -2; regionZ <= 2; regionZ++) {
      // 计算海岛中心
      const randX = Math.abs(Math.sin(seed * 1.5 + regionX * 0.1));
      const randZ = Math.abs(Math.sin(seed * 2.5 + regionZ * 0.1));
      const offsetX = Math.floor(randX * (regionSize - islandSize * 2)) + islandSize;
      const offsetZ = Math.floor(randZ * (regionSize - islandSize * 2)) + islandSize;

      const islandCx = regionX * regionSize + offsetX;
      const islandCz = regionZ * regionSize + offsetZ;

      // 在海滩边缘找出生点（四个方向尝试）
      const directions = [
        { x: 1, z: 0, yaw: 0 },      // 东
        { x: -1, z: 0, yaw: Math.PI }, // 西
        { x: 0, z: 1, yaw: Math.PI / 2 }, // 南
        { x: 0, z: -1, yaw: -Math.PI / 2 }  // 北
      ];

      for (const dir of directions) {
        const spawnX = islandCx + dir.x * beachRadius;
        const spawnZ = islandCz + dir.z * beachRadius;

        // 检查这个位置是否在海岛范围内
        const islandInfo = getIslandInfo(spawnX, spawnZ, seed, terrainGen);
        if (islandInfo) {
          // 返回出生点（可以是 core 或 transition 区域）
          return {
            x: spawnX,
            y: seaLevel + 2, // 默认海平面以上
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
  generate: generateIsland,
  getIslandSpawnPoint
};
