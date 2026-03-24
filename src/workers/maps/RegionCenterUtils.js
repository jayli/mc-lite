// src/workers/maps/RegionCenterUtils.js
// 区域内地标随机中心计算工具

import {
  REGION_SIZE,
  CENTER_OFFSET,
  RANDOM_SEED_MULTIPLIERS
} from '../../constants/RegionMapConfig.js';

/**
 * 计算区域内确定性随机中心
 * @param {number} regionX - 区域 X 坐标
 * @param {number} regionZ - 区域 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} options - 可选配置，覆盖默认参数
 * @param {number} options.offsetScaleX - X 偏移缩放
 * @param {number} options.offsetScaleZ - Z 偏移缩放
 * @param {number} options.offsetBaseX - X 偏移基值
 * @param {number} options.offsetBaseZ - Z 偏移基值
 * @returns {Object} 中心点 { centerX, centerZ }
 */
export function getRegionSeededCenter(
  regionX,
  regionZ,
  seed,
  {
    offsetScaleX = CENTER_OFFSET.SCALE_X,
    offsetScaleZ = CENTER_OFFSET.SCALE_Z,
    offsetBaseX = CENTER_OFFSET.BASE_X,
    offsetBaseZ = CENTER_OFFSET.BASE_Z
  } = {}
) {
  const randX = Math.abs(Math.sin(seed * RANDOM_SEED_MULTIPLIERS.X + regionX * RANDOM_SEED_MULTIPLIERS.REGION));
  const randZ = Math.abs(Math.sin(seed * RANDOM_SEED_MULTIPLIERS.Z + regionZ * RANDOM_SEED_MULTIPLIERS.REGION));
  const offsetX = Math.floor(randX * offsetScaleX) + offsetBaseX;
  const offsetZ = Math.floor(randZ * offsetScaleZ) + offsetBaseZ;

  return {
    centerX: regionX * REGION_SIZE + offsetX,
    centerZ: regionZ * REGION_SIZE + offsetZ
  };
}

/**
 * 将中心点裁剪到区域边界内，保证与边界至少保留 minMargin 距离
 * @param {number} regionX - 区域 X 坐标
 * @param {number} regionZ - 区域 Z 坐标
 * @param {number} centerX - 原始中心点 X
 * @param {number} centerZ - 原始中心点 Z
 * @param {number} minMargin - 与区域边界的最小间距
 * @param {Object} [options] - 可选配置
 * @param {number} [options.regionSize=REGION_SIZE] - 区域尺寸
 * @returns {{cx:number, cz:number}} 裁剪后的中心点
 */
export function clampCenterToRegion(
  regionX,
  regionZ,
  centerX,
  centerZ,
  minMargin,
  { regionSize = REGION_SIZE } = {}
) {
  let cx = centerX;
  let cz = centerZ;

  const regionLeft = regionX * regionSize;
  const regionRight = (regionX + 1) * regionSize;
  const regionTop = regionZ * regionSize;
  const regionBottom = (regionZ + 1) * regionSize;

  if (cx - minMargin < regionLeft) {
    cx = regionLeft + minMargin;
  } else if (cx + minMargin > regionRight) {
    cx = regionRight - minMargin;
  }

  if (cz - minMargin < regionTop) {
    cz = regionTop + minMargin;
  } else if (cz + minMargin > regionBottom) {
    cz = regionBottom - minMargin;
  }

  return { cx, cz };
}
