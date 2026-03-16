// src/workers/maps/FrozenMountain.js
/**
 * 冰封山峰地图生成模块
 * 负责冰封山峰的位置计算和方块生成
 */

import { getRegionSeededCenter } from './RegionCenterUtils.js';

/**
 * 获取指定区域内冰封山峰的中心位置
 * @param {number} regionX - 区域 X 坐标
 * @param {number} regionZ - 区域 Z 坐标
 * @param {number} seed - 世界种子
 * @returns {Object} 冰封山峰中心位置 {cx, cz}
 */
export function getFrozenMountainCenterInRegion(regionX, regionZ, seed) {
  const regionSize = 400;

  const { centerX: pyramidCx, centerZ: pyramidCz } = getRegionSeededCenter(regionX, regionZ, seed, {
    regionSize,
    offsetScaleX: 300,
    offsetScaleZ: 300,
    offsetBaseX: 100,
    offsetBaseZ: 100
  });

  // 冰封山峰位移 = 金字塔位置 + (-160, 0) 偏移
  let mountainCx = pyramidCx - 160;
  let mountainCz = pyramidCz;

  // 应用与 FrozenMountain.js 相同的边界检查逻辑
  const fmHalfSize = 40;
  const fmTransitionSize = 4;
  const fmTotalHalfSize = fmHalfSize + fmTransitionSize;
  const fmMinMargin = fmTotalHalfSize + 5;

  const regionLeft = regionX * regionSize;
  const regionRight = (regionX + 1) * regionSize;
  const regionTop = regionZ * regionSize;
  const regionBottom = (regionZ + 1) * regionSize;

  // 调整 X 坐标
  if (mountainCx - fmMinMargin < regionLeft) {
    mountainCx = regionLeft + fmMinMargin;
  } else if (mountainCx + fmMinMargin > regionRight) {
    mountainCx = regionRight - fmMinMargin;
  }

  // 调整 Z 坐标
  if (mountainCz - fmMinMargin < regionTop) {
    mountainCz = regionTop + fmMinMargin;
  } else if (mountainCz + fmMinMargin > regionBottom) {
    mountainCz = regionBottom - fmMinMargin;
  }

  return { cx: mountainCx, cz: mountainCz };
}

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
  const mountainSize = 80;  // 冰封山峰主体边长 80 格
  const halfSize = Math.floor(mountainSize / 2);
  const transitionSize = 4; // 过渡带大小 4 格
  const regionSize = 400;  // 每 400x400 区域生成一个冰封山峰

  // 椭圆形山体参数：让一个方向更陡峭，增加自然感
  const steepAxisFactor = 0.65;  // Z 轴方向压缩系数，<1 表示该方向更陡
  const steepAxis = 'z';          // 陡峭方向：'z' 或 'x'

  // 计算当前坐标所在的区域
  const regionX = Math.floor(wx / regionSize);
  const regionZ = Math.floor(wz / regionSize);

  // 使用共享函数获取冰封山峰中心位置
  const { cx: mountainCx, cz: mountainCz } = getFrozenMountainCenterInRegion(regionX, regionZ, seed);

  // 扩展后的冰封山峰总区域（包含过渡带）
  const totalHalfSize = halfSize + transitionSize;

  const mountainMinX = mountainCx - totalHalfSize;
  const mountainMaxX = mountainCx + totalHalfSize;
  const mountainMinZ = mountainCz - totalHalfSize;
  const mountainMaxZ = mountainCz + totalHalfSize;

  // 检查是否在扩展范围内
  if (wx < mountainMinX || wx > mountainMaxX || wz < mountainMinZ || wz > mountainMaxZ) {
    return null;
  }

  // 计算相对于冰封山峰中心的距离（使用椭圆剖面，让一个方向更陡峭）
  const dx = wx - mountainCx;
  const dz = wz - mountainCz;
  // 根据陡峭方向选择压缩轴，使该方向坡度更陡峭
  const adjustedDx = steepAxis === 'x' ? dx / steepAxisFactor : dx;
  const adjustedDz = steepAxis === 'z' ? dz / steepAxisFactor : dz;
  const distFromCenter = Math.max(Math.abs(dx), Math.abs(dz));
  const euclidDist = Math.sqrt(adjustedDx * adjustedDx + adjustedDz * adjustedDz);

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

  // 基础高度：使用平滑曲线并通过确定性抖动取整，减少“等高线台阶感”
  // 平顶效果：在中心区域保持相对平坦
  const flatRadius = 10; // 平顶半径
  let baseHeightFloat;

  const summitHeight = (halfSize - flatRadius) / 1.3;

  if (euclidDist < flatRadius) {
    // 平顶区域：高度基本一致
    baseHeightFloat = summitHeight;
  } else {
    // 从平顶边缘开始下降
    const slopeRange = Math.max(1, halfSize - flatRadius);
    const t = Math.max(0, Math.min(1, (euclidDist - flatRadius) / slopeRange));

    // 山腰局部陡坡：使用低频噪声选择“更陡区域”，避免整体都像台阶。
    const localSteepNoise =
      mountainNoise(wx, wz, seed + 411, 0.012) * 0.7 +
      mountainNoise(wx, wz, seed + 503, 0.020) * 0.3;
    const localSteep01 = Math.max(0, Math.min(1, localSteepNoise * 0.5 + 0.5));
    const steepZoneMask = Math.sin(Math.PI * t); // 山腰最明显，顶/脚最弱
    // 下调“墙感”强度，避免陡坡变成整面直立墙
    const steepFactor = 1 + steepZoneMask * (0.08 + 0.14 * localSteep01);
    const effectiveT = Math.max(0, Math.min(1, t * steepFactor));

    // 略偏陡的剖面曲线，搭配局部 steepFactor 增加自然陡坡感
    const profile = 1 - Math.pow(effectiveT, 1.18);
    baseHeightFloat = summitHeight * profile;

    // 给陡坡增加“嶙峋感”：中高频噪声形成岩面起伏，不再像一整面直墙
    const ruggedMask = steepZoneMask * Math.max(0, (localSteep01 - 0.35) / 0.65);
    const ruggedSigned =
      mountainNoise(wx, wz, seed + 619, 0.050) * 0.7 +
      mountainNoise(wx, wz, seed + 701, 0.085) * 0.3;
    const ruggedCrag = (Math.abs(mountainNoise(wx, wz, seed + 733, 0.072)) - 0.55) * 1.1;
    const ruggedOffsetRaw = (ruggedSigned * 0.75 + ruggedCrag) * ruggedMask;
    const ruggedOffset = Math.max(-0.6, Math.min(1.1, ruggedOffsetRaw));
    baseHeightFloat += ruggedOffset;
  }

  // 在山腰注入超低频起伏，打散过直的坡线，山顶/山脚影响较小
  const baseSlopeRange = Math.max(1, halfSize - flatRadius);
  const baseSlopeT = Math.max(0, Math.min(1, (euclidDist - flatRadius) / baseSlopeRange));
  const baseSlopeMask = Math.sin(Math.PI * baseSlopeT);
  const broadUndulation = mountainNoise(wx, wz, seed + 151, 0.010) * 1.2 * baseSlopeMask;
  baseHeightFloat += broadUndulation;

  // 确定性抖动取整：避免同一高度线过长形成“人工台阶”
  const baseFloor = Math.floor(baseHeightFloat);
  const frac = Math.max(0, Math.min(1, baseHeightFloat - baseFloor));
  const dither = mountainNoise(wx, wz, seed + 777, 0.09) * 0.5 + 0.5;
  const baseHeight = baseFloor + (dither < frac ? 1 : 0);

  // 低频平滑扰动：去掉高频山脊，避免地表出现“窟窿/毛刺”
  // 使用十字采样平滑噪声，保证相邻列的高度变化更连续。
  const sampleOffsets = [
    [0, 0],
    [1.5, 0],
    [-1.5, 0],
    [0, 1.5],
    [0, -1.5]
  ];
  let smoothNoise = 0;
  for (const [ox, oz] of sampleOffsets) {
    const n1 = mountainNoise(wx + ox, wz + oz, seed + 37, 0.014);
    const n2 = mountainNoise(wx + ox, wz + oz, seed + 91, 0.022) * 0.35;
    smoothNoise += (n1 + n2);
  }
  smoothNoise /= sampleOffsets.length;

  // 山顶与山脚都降低扰动，只在山腰保留轻微变化
  const slopeRange = Math.max(1, halfSize - flatRadius);
  const slopeT = Math.max(0, Math.min(1, (euclidDist - flatRadius) / slopeRange));
  const slopeMask = Math.sin(Math.PI * slopeT);

  // 振幅严格限制在 [-1, 1]，避免相邻列出现突兀的坑
  const noiseOffsetRaw = Math.round(smoothNoise * slopeMask * 1.1);
  const noiseOffset = Math.max(-1, Math.min(1, noiseOffsetRaw));

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
  const dirtLayers = Math.floor(Math.random() * 2) + 1;

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

  // 在冰封山峰上低密度生成 short_grass（仅在主体区域且不在海平面以下）
  if (fmInfo.transitionFactor === 0 && !isBelowSeaLevel && Math.random() < 0.03) {
    fakeChunk.add(wx, fillEndY + 1, wz, 'short_grass', dPlaceholder, false);
  }

  // 返回地表高度，供 WorldWorker 生成树使用
  return { surfaceY: fillEndY, isBelowSeaLevel };
}

/**
 * 冰封山峰模块统一导出
 */
export const FrozenMountain = {
  getFrozenMountainInfo,
  getFrozenMountainCenterInRegion,
  generate: generateFrozenMountain
};
