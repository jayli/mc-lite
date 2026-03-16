// src/workers/maps/Pyramid.js
/**
 * 金字塔地图生成模块
 * 负责金字塔的位置计算和方块生成
 */

import { getRegionSeededCenter } from './RegionCenterUtils.js';

/**
 * 获取指定区域内金字塔中心位置（含边界约束）
 * @param {number} regionX - 区域 X 坐标
 * @param {number} regionZ - 区域 Z 坐标
 * @param {number} seed - 世界种子
 * @returns {Object} 金字塔中心位置 {cx, cz}
 */
export function getPyramidCenterInRegion(regionX, regionZ, seed) {
  const regionSize = 400;
  const pyramidSize = 40;
  const transitionSize = 8;
  const halfSize = Math.floor(pyramidSize / 2);
  const totalHalfSize = halfSize + transitionSize;
  const minMargin = totalHalfSize + 5;

  const { centerX, centerZ } = getRegionSeededCenter(regionX, regionZ, seed, {
    regionSize,
    offsetScaleX: 300,
    offsetScaleZ: 300,
    offsetBaseX: 100,
    offsetBaseZ: 100
  });

  let pyramidCx = centerX;
  let pyramidCz = centerZ;

  const regionLeft = regionX * regionSize;
  const regionRight = (regionX + 1) * regionSize;
  const regionTop = regionZ * regionSize;
  const regionBottom = (regionZ + 1) * regionSize;

  if (pyramidCx - minMargin < regionLeft) {
    pyramidCx = regionLeft + minMargin;
  } else if (pyramidCx + minMargin > regionRight) {
    pyramidCx = regionRight - minMargin;
  }

  if (pyramidCz - minMargin < regionTop) {
    pyramidCz = regionTop + minMargin;
  } else if (pyramidCz + minMargin > regionBottom) {
    pyramidCz = regionBottom - minMargin;
  }

  return { cx: pyramidCx, cz: pyramidCz };
}

/**
 * 检查坐标是否在金字塔范围内，并返回金字塔相关信息
 * 每 500x500 的区域生成一个金字塔
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器依赖
 * @returns {Object|null} 金字塔信息对象或 null
 */
export function getPyramidInfo(wx, wz, seed, terrainGen) {
  const pyramidSize = 40;  // 金字塔主体边长 40 格
  const halfSize = Math.floor(pyramidSize / 2);
  const coreSize = 20;     // 核心保护区边长 20 格
  const halfCore = Math.floor(coreSize / 2);
  const transitionSize = 8; // 过渡带大小 8 格
  const regionSize = 400;  // 每 400x400 区域生成一个金字塔

  // 计算当前坐标所在的区域
  const regionX = Math.floor(wx / regionSize);
  const regionZ = Math.floor(wz / regionSize);

  const { cx: pyramidCx, cz: pyramidCz } = getPyramidCenterInRegion(regionX, regionZ, seed);
  const totalHalfSize = halfSize + transitionSize;

  const pyramidMinX = pyramidCx - totalHalfSize;
  const pyramidMaxX = pyramidCx + totalHalfSize;
  const pyramidMinZ = pyramidCz - totalHalfSize;
  const pyramidMaxZ = pyramidCz + totalHalfSize;

  // 检查是否在扩展范围内
  if (wx < pyramidMinX || wx > pyramidMaxX || wz < pyramidMinZ || wz > pyramidMaxZ) {
    return null;
  }

  // 计算相对于金字塔中心的距离
  const dx = Math.abs(wx - pyramidCx);
  const dz = Math.abs(wz - pyramidCz);
  const distFromCenter = Math.max(dx, dz);

  // 计算金字塔基准高度（中心处的地形高度）
  const centerBiome = terrainGen.getBiome(pyramidCx, pyramidCz);
  const pyramidBaseHeight = terrainGen.generateHeight(pyramidCx, pyramidCz, centerBiome);

  // 判断区域类型
  let zone, transitionFactor;

  if (distFromCenter <= halfSize) {
    // 金字塔主体（核心 + 中间区域）：完整金字塔形态，不进行混合
    zone = 'core';
    transitionFactor = 0;
  } else {
    // 过渡带：在金字塔主体边缘外进行平滑混合
    zone = 'transition';
    // 从主体边缘 (halfSize) 到总边缘 (totalHalfSize) 过渡因子从 0 到 1
    const t = (distFromCenter - halfSize) / transitionSize;
    transitionFactor = t;
  }

  // 金字塔坡度：每 2 个单位水平距离，高度下降 1 个单位
  // 恢复原来的坡度计算，过渡带内也继续降低高度以保持金字塔形态
  const pyramidLayerHeight = Math.floor((halfSize - distFromCenter) / 2);

  return {
    centerX: pyramidCx,
    centerZ: pyramidCz,
    layerHeight: Math.max(0, pyramidLayerHeight),
    isBaseLayer: pyramidLayerHeight === 0,
    transitionFactor: transitionFactor,
    zone: zone,
    pyramidBaseHeight: pyramidBaseHeight
  };
}

/**
 * 生成金字塔方块
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} h - 地形高度
 * @param {Object} pyInfo - 金字塔信息对象
 * @param {Object} fakeChunk - 模拟 Chunk 对象
 * @param {Object} dPlaceholder - 数据占位符对象
 */
export function generatePyramid(wx, wz, h, pyInfo, fakeChunk, dPlaceholder) {
  // 金字塔原始高度：当地形高度 + layerHeight（保持原来的计算方式）
  const originalPyramidHeight = h + pyInfo.layerHeight;

  let finalSurfaceY;

  if (pyInfo.transitionFactor === 0) {
    // 金字塔主体区域：使用原始高度，保持完整形态
    finalSurfaceY = originalPyramidHeight;
  } else {
    // 过渡带区域：使用 transitionFactor 平滑混合，同时限制与地形的高差不超过 2 个方块
    // 先平滑插值
    const smoothHeight = Math.floor(h + (originalPyramidHeight - h) * (1 - pyInfo.transitionFactor));
    // 再限制高差
    const maxDiff = 2;
    const heightDiff = smoothHeight - h;
    if (Math.abs(heightDiff) <= maxDiff) {
      finalSurfaceY = smoothHeight;
    } else {
      finalSurfaceY = h + Math.sign(heightDiff) * maxDiff;
    }
  }

  // 计算金字塔高度差
  const fillStartY = Math.min(h, finalSurfaceY);
  const fillEndY = Math.max(h, finalSurfaceY);

  // 随机决定沙块层数（3-4层）
  const sandLayers = Math.floor(Math.random() * 2) + 3;

  // 生成金字塔方块
  for (let y = fillStartY; y <= fillEndY; y++) {
    const depthFromSurface = fillEndY - y;

    if (depthFromSurface < sandLayers) {
      // 顶部3-4层：沙块
      fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
    } else {
      // 沙块下面：岩石或鹅卵石
      const rockType = Math.random() < 0.3 ? 'cobblestone' : 'stone';
      fakeChunk.add(wx, y, wz, rockType, dPlaceholder);
    }
  }

  // 计算岩石基础层的基准高度
  const rockBaseY = Math.min(h, finalSurfaceY);

  // 生成岩石基础层（1-11 层，无矿洞）
  for (let k = 1; k <= 11; k++) {
    const rockY = rockBaseY - k;
    if (k === 11) {
      fakeChunk.add(wx, rockY, wz, 'end_stone', dPlaceholder);
    } else if (k === 10) {
      fakeChunk.add(wx, rockY, wz, 'stone', dPlaceholder);
    } else {
      const rockType = Math.random() < 0.3 ? 'cobblestone' : 'stone';
      fakeChunk.add(wx, rockY, wz, rockType, dPlaceholder);
    }
  }
  // 最底层 end_stone
  fakeChunk.add(wx, rockBaseY - 12, wz, 'end_stone', dPlaceholder);
}

/**
 * 金字塔模块统一导出
 */
export const Pyramid = {
  getPyramidInfo,
  getPyramidCenterInRegion,
  generate: generatePyramid
};
