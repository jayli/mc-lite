// src/workers/maps/RegionCenterUtils.js
// 区域内地标随机中心计算工具

/**
 * 计算区域内确定性随机中心
 * @param {number} regionX - 区域 X 坐标
 * @param {number} regionZ - 区域 Z 坐标
 * @param {number} seed - 世界种子
 * @param {Object} options - 配置
 * @param {number} options.regionSize - 区域尺寸
 * @param {number} options.seedMulX - X 方向种子乘数
 * @param {number} options.seedMulZ - Z 方向种子乘数
 * @param {number} options.regionMul - 区域坐标乘数
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
    regionSize = 400,
    seedMulX = 1.5,
    seedMulZ = 2.5,
    regionMul = 0.1,
    offsetScaleX = 300,
    offsetScaleZ = 300,
    offsetBaseX = 100,
    offsetBaseZ = 100
  } = {}
) {
  const randX = Math.abs(Math.sin(seed * seedMulX + regionX * regionMul));
  const randZ = Math.abs(Math.sin(seed * seedMulZ + regionZ * regionMul));
  const offsetX = Math.floor(randX * offsetScaleX) + offsetBaseX;
  const offsetZ = Math.floor(randZ * offsetScaleZ) + offsetBaseZ;

  return {
    centerX: regionX * regionSize + offsetX,
    centerZ: regionZ * regionSize + offsetZ
  };
}
