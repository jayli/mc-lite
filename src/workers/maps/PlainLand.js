// src/workers/maps/PlainLand.js
/**
 * 平地地图生成模块（用于城堡地基）
 * 特性：
 * 1. 在沙漠生物群系内生成规则正方形平地
 * 2. 表层统一为沙块，边缘无噪声扰动
 * 3. 每个区域最多一个平地，可作为城堡唯一生成点
 */

import { getRegionSeededCenter } from './RegionCenterUtils.js';
import {
  REGION_SIZE,
  PLAIN_LAND_SIZE,
  REGION_MIN_MARGIN,
  LANDMARK_OFFSET,
  CENTER_OFFSET
} from '../../constants/RegionMapConfig.js';

/**
 * 获取指定区域内平地中心位置
 * @param {number} regionX 区域 X 坐标
 * @param {number} regionZ 区域 Z 坐标
 * @param {number} seed 世界种子
 * @returns {{cx:number, cz:number}}
 */
export function getPlainLandCenterInRegion(regionX, regionZ, seed) {
  const regionSize = REGION_SIZE;

  const { centerX: pyramidCx, centerZ: pyramidCz } = getRegionSeededCenter(regionX, regionZ, seed, {
    regionSize,
    offsetScaleX: CENTER_OFFSET.SCALE_X,
    offsetScaleZ: CENTER_OFFSET.SCALE_Z,
    offsetBaseX: CENTER_OFFSET.BASE_X,
    offsetBaseZ: CENTER_OFFSET.BASE_Z
  });

  let plainLandCx = pyramidCx + LANDMARK_OFFSET.PLAIN_LAND_X;
  let plainLandCz = pyramidCz + LANDMARK_OFFSET.PLAIN_LAND_Z;

  const halfSize = Math.floor(PLAIN_LAND_SIZE / 2);
  const minMargin = halfSize + REGION_MIN_MARGIN;

  const regionLeft = regionX * regionSize;
  const regionRight = (regionX + 1) * regionSize;
  const regionTop = regionZ * regionSize;
  const regionBottom = (regionZ + 1) * regionSize;

  if (plainLandCx - minMargin < regionLeft) {
    plainLandCx = regionLeft + minMargin;
  } else if (plainLandCx + minMargin > regionRight) {
    plainLandCx = regionRight - minMargin;
  }

  if (plainLandCz - minMargin < regionTop) {
    plainLandCz = regionTop + minMargin;
  } else if (plainLandCz + minMargin > regionBottom) {
    plainLandCz = regionBottom - minMargin;
  }

  return { cx: plainLandCx, cz: plainLandCz };
}

/**
 * 估算平地基准高度：取中心与边界采样点的最低值
 * 这样可以保证平地不悬空，且与周边最低地势齐平
 */
function estimatePlainLandBaseHeight(centerX, centerZ, seed, terrainGen) {
  const halfSize = Math.floor(PLAIN_LAND_SIZE / 2);
  const sampleOffsets = [
    [0, 0],
    [halfSize, 0],
    [-halfSize, 0],
    [0, halfSize],
    [0, -halfSize],
    [halfSize, halfSize],
    [halfSize, -halfSize],
    [-halfSize, halfSize],
    [-halfSize, -halfSize]
  ];

  let minHeight = Infinity;

  for (const [ox, oz] of sampleOffsets) {
    const sx = centerX + ox;
    const sz = centerZ + oz;
    const biome = terrainGen.getBiome(sx, sz);
    const h = terrainGen.generateHeight(sx, sz, biome);
    if (h < minHeight) minHeight = h;
  }

  // 稳定扰动，避免不同区域高度过于一致；同时保持“最低点对齐”的主规则
  const stableOffset = Math.floor(Math.abs(Math.sin(seed * 0.17 + centerX * 0.01 + centerZ * 0.013)) * 0.5);
  return minHeight + stableOffset;
}

/**
 * 获取平地信息
 * @param {number} wx 世界 X 坐标
 * @param {number} wz 世界 Z 坐标
 * @param {number} seed 世界种子
 * @param {Object} terrainGen 地形生成器
 * @returns {Object|null}
 */
export function getPlainLandInfo(wx, wz, seed, terrainGen) {
  const halfSize = Math.floor(PLAIN_LAND_SIZE / 2);

  const regionX = Math.floor(wx / REGION_SIZE);
  const regionZ = Math.floor(wz / REGION_SIZE);

  const { cx: plainLandCx, cz: plainLandCz } = getPlainLandCenterInRegion(regionX, regionZ, seed);

  // 仅在沙漠中生成平地
  const centerBiome = terrainGen.getBiome(plainLandCx, plainLandCz);
  if (centerBiome !== 'DESERT') {
    return null;
  }

  const dx = Math.abs(wx - plainLandCx);
  const dz = Math.abs(wz - plainLandCz);

  if (dx > halfSize || dz > halfSize) {
    return null;
  }

  const baseHeight = estimatePlainLandBaseHeight(plainLandCx, plainLandCz, seed, terrainGen);

  return {
    centerX: plainLandCx,
    centerZ: plainLandCz,
    baseHeight,
    halfSize
  };
}

/**
 * 生成平地方块
 * @param {number} wx 世界 X 坐标
 * @param {number} wz 世界 Z 坐标
 * @param {number} h 原始地形高度
 * @param {Object} plainInfo 平地信息
 * @param {Object} fakeChunk 模拟 Chunk
 * @param {Object} dPlaceholder 占位对象
 * @returns {{surfaceY:number}}
 */
export function generatePlainLand(wx, wz, h, plainInfo, fakeChunk, dPlaceholder) {
  const surfaceY = plainInfo.baseHeight;

  const fillStartY = Math.min(h, surfaceY);
  const fillEndY = Math.max(h, surfaceY);

  // 平地表层与填充：全部使用沙块，满足“表面普通沙块”与地基稳定性
  for (let y = fillStartY; y <= fillEndY; y++) {
    fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
  }

  // 固定地下层，和主世界保持一致
  const rockBaseY = Math.min(h, surfaceY);
  for (let k = 1; k <= 11; k++) {
    const rockY = rockBaseY - k;
    if (k === 11) {
      fakeChunk.add(wx, rockY, wz, 'end_stone', dPlaceholder);
    } else if (k === 10) {
      fakeChunk.add(wx, rockY, wz, 'stone', dPlaceholder);
    } else {
      fakeChunk.add(wx, rockY, wz, 'stone', dPlaceholder);
    }
  }
  fakeChunk.add(wx, rockBaseY - 12, wz, 'end_stone', dPlaceholder);

  return { surfaceY };
}

/**
 * 获取平地出生点（优先在区域 [0,0] 附近搜索）
 * @param {number} seed 世界种子
 * @param {Object} terrainGen 地形生成器
 * @returns {{x:number,y:number,z:number,plainLandCenterX:number,plainLandCenterZ:number}|null}
 */
export function getPlainLandSpawnPoint(seed, terrainGen) {
  for (let regionX = -6; regionX <= 6; regionX++) {
    for (let regionZ = -6; regionZ <= 6; regionZ++) {
      const { cx, cz } = getPlainLandCenterInRegion(regionX, regionZ, seed);
      const biome = terrainGen.getBiome(cx, cz);
      if (biome !== 'DESERT') continue;

      const baseHeight = estimatePlainLandBaseHeight(cx, cz, seed, terrainGen);

      return {
        x: cx,
        y: baseHeight + 2,
        z: cz,
        plainLandCenterX: cx,
        plainLandCenterZ: cz,
        yaw: 0,
        pitch: 0
      };
    }
  }

  return null;
}

export const PlainLand = {
  getPlainLandInfo,
  getPlainLandCenterInRegion,
  generate: generatePlainLand,
  getPlainLandSpawnPoint
};
