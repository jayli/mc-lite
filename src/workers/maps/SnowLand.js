// src/workers/maps/SnowLand.js
/**
 * 雪地地图生成模块
 * 负责雪地的位置计算和方块生成
 */

import { getRegionSeededCenter } from './RegionCenterUtils.js';

/**
 * 检查坐标是否在雪地范围内，并返回雪地相关信息
 * 每 400x400 的区域生成一个雪地，位置在金字塔附近偏移 100 格
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器依赖
 * @returns {Object|null} 雪地信息对象或 null
 */
export function getSnowLandInfo(wx, wz, seed, terrainGen) {
  const snowLandSize = 40;  // 雪地主体边长 40 格
  const halfSize = Math.floor(snowLandSize / 2);
  const transitionSize = 8; // 过渡带大小 8 格
  const regionSize = 400;  // 每 400x400 区域生成一个雪地

  // 计算当前坐标所在的区域
  const regionX = Math.floor(wx / regionSize);
  const regionZ = Math.floor(wz / regionSize);

  const { centerX: pyramidCx, centerZ: pyramidCz } = getRegionSeededCenter(regionX, regionZ, seed, {
    regionSize,
    offsetScaleX: 300,
    offsetScaleZ: 300,
    offsetBaseX: 100,
    offsetBaseZ: 100
  });

  // 雪地位移 = 金字塔位置 + (160, 0) 偏移
  // 金字塔半宽 28 + 间隔 100 + 雪地半宽 28 = 156，使用 160 确保有足够间隔
  const snowLandCx = pyramidCx + 160;
  const snowLandCz = pyramidCz;

  // 扩展后的雪地总区域（包含过渡带）
  const totalHalfSize = halfSize + transitionSize;
  const snowLandMinX = snowLandCx - totalHalfSize;
  const snowLandMaxX = snowLandCx + totalHalfSize;
  const snowLandMinZ = snowLandCz - totalHalfSize;
  const snowLandMaxZ = snowLandCz + totalHalfSize;

  // 检查是否在扩展范围内
  if (wx < snowLandMinX || wx > snowLandMaxX || wz < snowLandMinZ || wz > snowLandMaxZ) {
    return null;
  }

  // 计算相对于雪地中心的距离（用于区域判断）
  const dx = Math.abs(wx - snowLandCx);
  const dz = Math.abs(wz - snowLandCz);
  const distFromCenterMax = Math.max(dx, dz);

  // 计算距离中心的欧几里得距离（用于高度计算）
  const distFromCenterEuclid = Math.sqrt((wx - snowLandCx) ** 2 + (wz - snowLandCz) ** 2);

  // 计算雪地基准高度（中心处的地形高度）
  const centerBiome = terrainGen.getBiome(snowLandCx, snowLandCz);
  const snowLandBaseHeight = terrainGen.generateHeight(snowLandCx, snowLandCz, centerBiome);

  // 判断区域类型
  let zone, transitionFactor;

  if (distFromCenterMax <= halfSize) {
    // 雪地主体：完整雪地形态，不进行混合
    zone = 'core';
    transitionFactor = 0;
  } else {
    // 过渡带：在雪地主体边缘外进行平滑混合
    zone = 'transition';
    const t = (distFromCenterMax - halfSize) / transitionSize;
    transitionFactor = t;
  }

  // 使用噪声函数生成平缓的高度变化（高低差不超过 2）
  // 使用多种频率叠加让地形更自然
  const noise1 = Math.sin(wx * 0.08 + seed * 0.5) * Math.cos(wz * 0.08 + seed * 0.3);
  const noise2 = Math.sin(wx * 0.15 + seed * 1.2) * Math.cos(wz * 0.15 + seed * 0.7) * 0.5;

  // 中心区域升高
  const centerBoost = Math.max(0, 2 - distFromCenterEuclid / 15); // 中心最高+2，向外逐渐衰减

  const heightOffset = Math.floor((noise1 + noise2) * 1.5 + centerBoost); // 限制在 -2 到 +2 之间

  return {
    centerX: snowLandCx,
    centerZ: snowLandCz,
    heightOffset: heightOffset,
    transitionFactor: transitionFactor,
    zone: zone,
    snowLandBaseHeight: snowLandBaseHeight
  };
}

/**
 * 生成雪地方块
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} h - 地形高度
 * @param {Object} slInfo - 雪地信息对象
 * @param {Object} fakeChunk - 模拟 Chunk 对象
 * @param {Object} dPlaceholder - 数据占位符对象
 */
export function generateSnowLand(wx, wz, h, slInfo, fakeChunk, dPlaceholder) {
  const seaLevel = -2; // 海平面高度

  // 计算最终表面高度
  let finalSurfaceY;

  if (slInfo.transitionFactor === 0) {
    // 雪地主体区域：使用地形高度 + 平缓偏移
    finalSurfaceY = h + slInfo.heightOffset;
  } else {
    // 过渡带区域：平滑混合到周围地形
    const baseHeight = h + slInfo.heightOffset;
    finalSurfaceY = Math.floor(h + (baseHeight - h) * (1 - slInfo.transitionFactor));
  }

  // 确保高低差不超过 2
  const heightDiff = finalSurfaceY - h;
  if (Math.abs(heightDiff) > 2) {
    finalSurfaceY = h + Math.sign(heightDiff) * 2;
  }

  // 计算高度差
  const fillStartY = Math.min(h, finalSurfaceY);
  const fillEndY = Math.max(h, finalSurfaceY);

  // 检查是否在海平面以下
  const isBelowSeaLevel = finalSurfaceY <= seaLevel - 1;

  // 随机决定 dirt 层数（3-5层）
  const dirtLayers = Math.floor(Math.random() * 3) + 3;

  // 生成雪地方块或沙块
  for (let y = fillStartY; y <= fillEndY; y++) {
    const depthFromSurface = fillEndY - y;

    if (isBelowSeaLevel) {
      // 海平面以下：全部用沙块
      fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
    } else {
      if (y === fillEndY) {
        // 最顶层：snow_grass
        fakeChunk.add(wx, y, wz, 'snow_grass', dPlaceholder);
      } else if (depthFromSurface < dirtLayers) {
        // 地下 3-5 层：dirt
        fakeChunk.add(wx, y, wz, 'dirt', dPlaceholder);
      } else {
        // 下方：stone
        fakeChunk.add(wx, y, wz, 'stone', dPlaceholder);
      }
    }
  }

  // 计算岩石基础层的基准高度
  const rockBaseY = Math.min(h, finalSurfaceY);

  // 生成地下层
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
  // 最底层 end_stone
  fakeChunk.add(wx, rockBaseY - 12, wz, 'end_stone', dPlaceholder);

  // 在雪地上低密度生成 short_grass（仅在主体区域且不在海平面以下）
  if (slInfo.transitionFactor === 0 && !isBelowSeaLevel && Math.random() < 0.03) {
    fakeChunk.add(wx, fillEndY + 1, wz, 'short_grass', dPlaceholder, false);
  }

  // 返回地表高度，供 WorldWorker 生成树使用
  return { surfaceY: fillEndY, isBelowSeaLevel };
}

/**
 * 雪地模块统一导出
 */
export const SnowLand = {
  getSnowLandInfo,
  generate: generateSnowLand
};
