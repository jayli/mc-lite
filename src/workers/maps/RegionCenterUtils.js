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
