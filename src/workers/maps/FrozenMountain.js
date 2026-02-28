// src/workers/maps/FrozenMountain.js
/**
 * 冰封山峰地图生成模块
 * 负责冰封山峰的位置计算和方块生成
 */

/**
 * 简单的噪声函数，用于生成自然的地形起伏
 * @param {number} x - X 坐标
 * @param {number} z - Z 坐标
 * @param {number} seed - 种子
 * @param {number} scale - 噪声尺度
 * @returns {number} 噪声值
 */
function mountainNoise(x, z, seed, scale) {
  const nx = x + seed * 0.1;
  const nz = z + seed * 0.2;
  return Math.sin(nx * scale) * Math.cos(nz * scale * 0.8) +
         Math.sin(nx * scale * 2.3 + 1.3) * Math.cos(nz * scale * 1.7 + 0.5) * 0.5;
}

/**
 * 检查坐标是否在冰封山峰范围内，并返回山峰相关信息
 * 每 400x400 的区域生成一个冰封山峰，位置在金字塔对面偏移 -160 格
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器依赖
 * @returns {Object|null} 冰封山峰信息对象或 null
 */
export function getFrozenMountainInfo(wx, wz, seed, terrainGen) {
  const mountainSize = 60;  // 冰封山峰主体边长 60 格
  const halfSize = Math.floor(mountainSize / 2);
  const transitionSize = 8; // 过渡带大小 8 格
  const regionSize = 400;  // 每 400x400 区域生成一个冰封山峰

  // 计算当前坐标所在的区域
  const regionX = Math.floor(wx / regionSize);
  const regionZ = Math.floor(wz / regionSize);

  // 首先计算该区域内金字塔的位置（使用与 Pyramid.js 相同的算法）
  const randX = Math.abs(Math.sin(seed * 1.5 + regionX * 0.1));
  const randZ = Math.abs(Math.sin(seed * 2.5 + regionZ * 0.1));
  const offsetX = Math.floor(randX * 300) + 100;
  const offsetZ = Math.floor(randZ * 300) + 100;

  const pyramidCx = regionX * regionSize + offsetX;
  const pyramidCz = regionZ * regionSize + offsetZ;

  // 冰封山峰位移 = 金字塔位置 + (-160, 0) 偏移（与 SnowLand 相反的一侧）
  let mountainCx = pyramidCx - 160;
  let mountainCz = pyramidCz;

  // 扩展后的冰封山峰总区域（包含过渡带）
  const totalHalfSize = halfSize + transitionSize;

  // 确保山峰中心不会太靠近区域边界（至少保留 totalHalfSize + 5 的缓冲）
  const minMargin = totalHalfSize + 5;
  const regionLeft = regionX * regionSize;
  const regionRight = (regionX + 1) * regionSize;
  const regionTop = regionZ * regionSize;
  const regionBottom = (regionZ + 1) * regionSize;

  // 调整 X 坐标
  if (mountainCx - minMargin < regionLeft) {
    mountainCx = regionLeft + minMargin;
  } else if (mountainCx + minMargin > regionRight) {
    mountainCx = regionRight - minMargin;
  }

  // 调整 Z 坐标
  if (mountainCz - minMargin < regionTop) {
    mountainCz = regionTop + minMargin;
  } else if (mountainCz + minMargin > regionBottom) {
    mountainCz = regionBottom - minMargin;
  }

  const mountainMinX = mountainCx - totalHalfSize;
  const mountainMaxX = mountainCx + totalHalfSize;
  const mountainMinZ = mountainCz - totalHalfSize;
  const mountainMaxZ = mountainCz + totalHalfSize;

  // 检查是否在扩展范围内
  if (wx < mountainMinX || wx > mountainMaxX || wz < mountainMinZ || wz > mountainMaxZ) {
    return null;
  }

  // 计算相对于冰封山峰中心的距离
  const dx = wx - mountainCx;
  const dz = wz - mountainCz;
  const distFromCenter = Math.max(Math.abs(dx), Math.abs(dz));
  const euclidDist = Math.sqrt(dx * dx + dz * dz);

  // 计算冰封山峰基准高度（中心处的地形高度）
  const centerBiome = terrainGen.getBiome(mountainCx, mountainCz);
  const mountainBaseHeight = terrainGen.generateHeight(mountainCx, mountainCz, centerBiome);

  // 判断区域类型
  let zone, transitionFactor;

  if (distFromCenter <= halfSize) {
    // 冰封山峰主体：完整山峰形态，不进行混合
    zone = 'core';
    transitionFactor = 0;
  } else {
    // 过渡带：在冰封山峰主体边缘外进行平滑混合
    zone = 'transition';
    const t = (distFromCenter - halfSize) / transitionSize;
    transitionFactor = t;
  }

  // 基础高度：降低整体高度，使用更平缓的坡度
  // 平顶效果：在中心区域保持相对平坦
  const flatRadius = 10; // 平顶半径
  let baseHeight;

  if (euclidDist < flatRadius) {
    // 平顶区域：高度基本一致
    baseHeight = Math.floor((halfSize - flatRadius) / 1.3);
  } else {
    // 从平顶边缘开始下降
    const distFromFlat = euclidDist - flatRadius;
    baseHeight = Math.floor((halfSize - flatRadius - distFromFlat) / 1.3);
  }

  // 添加噪声起伏，让山坡更自然
  // 使用多种频率的噪声叠加
  const noise1 = mountainNoise(wx, wz, seed, 0.08) * 3;
  const noise2 = mountainNoise(wx, wz, seed + 100, 0.15) * 1.5;
  const noise3 = mountainNoise(wx, wz, seed + 200, 0.25) * 0.8;

  // 山脊效果：沿 X 轴和 Z 轴创建一些起伏的山脊
  const ridgeX = Math.sin(dz * 0.25) * 2;
  const ridgeZ = Math.sin(dx * 0.25) * 2;

  const noiseOffset = Math.floor(noise1 + noise2 + noise3 + ridgeX + ridgeZ);

  // 最终高度
  const mountainLayerHeight = Math.max(0, baseHeight + noiseOffset);

  return {
    centerX: mountainCx,
    centerZ: mountainCz,
    layerHeight: mountainLayerHeight,
    isBaseLayer: mountainLayerHeight === 0,
    transitionFactor: transitionFactor,
    zone: zone,
    mountainBaseHeight: mountainBaseHeight
  };
}


/**
 * 生成冰封山峰方块
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} h - 地形高度
 * @param {Object} fmInfo - 冰封山峰信息对象
 * @param {Object} fakeChunk - 模拟 Chunk 对象
 * @param {Object} dPlaceholder - 数据占位符对象
 */
export function generateFrozenMountain(wx, wz, h, fmInfo, fakeChunk, dPlaceholder) {
  const seaLevel = -2; // 海平面高度

  // 冰封山峰原始高度：当地形高度 + layerHeight
  const originalMountainHeight = h + fmInfo.layerHeight;

  let finalSurfaceY;

  if (fmInfo.transitionFactor === 0) {
    // 冰封山峰主体区域：使用原始高度，保持完整形态
    finalSurfaceY = originalMountainHeight;
  } else {
    // 过渡带区域：使用 transitionFactor 平滑混合，同时限制与地形的高差不超过 2 个方块
    // 先平滑插值
    const smoothHeight = Math.floor(h + (originalMountainHeight - h) * (1 - fmInfo.transitionFactor));
    // 再限制高差
    const maxDiff = 2;
    const heightDiff = smoothHeight - h;
    if (Math.abs(heightDiff) <= maxDiff) {
      finalSurfaceY = smoothHeight;
    } else {
      finalSurfaceY = h + Math.sign(heightDiff) * maxDiff;
    }
  }

  // 计算高度差
  const fillStartY = Math.min(h, finalSurfaceY);
  const fillEndY = Math.max(h, finalSurfaceY);

  // 检查是否在海平面以下
  const isBelowSeaLevel = finalSurfaceY <= seaLevel - 1;

  // 随机决定 dirt 层数（2-3层）
  const dirtLayers = Math.floor(Math.random() * 2) + 2;

  // 生成冰封山峰方块或沙块
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
        // 地下 2-3 层：dirt
        fakeChunk.add(wx, y, wz, 'dirt', dPlaceholder);
      } else {
        // 下方：stone
        fakeChunk.add(wx, y, wz, 'stone', dPlaceholder);
      }
    }
  }

  // 计算岩石基础层的基准高度
  const rockBaseY = Math.min(h, finalSurfaceY);

  // 生成岩石基础层（1-11 层）
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

  // 返回地表高度，供 WorldWorker 生成树使用
  return { surfaceY: fillEndY, isBelowSeaLevel };
}

/**
 * 冰封山峰模块统一导出
 */
export const FrozenMountain = {
  getFrozenMountainInfo,
  generate: generateFrozenMountain
};
