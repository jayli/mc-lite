// src/utils/StructureUtils.js
/**
 * 结构处理工具模块
 * 统一管理跨 Chunk 结构的渲染距离判断和归属检测
 *
 * 职责边界：
 * - 定义各类结构的渲染距离配置
 * - 提供 belongsToStructure() 方法判断方块是否属于某个结构
 * - 提供 getRenderDist() 方法获取结构类型的渲染距离
 *
 * 使用场景：
 * - WorldWorker: 区块生成时判断跨 Chunk 结构方块
 * - Chunk (主线程): consolidate 和动态方块更新时判断结构归属
 */

/**
 * 结构渲染距离配置
 * 单位：方块数量
 * 定义了各类结构从中心点向各方向延伸的最大渲染距离
 */
export const STRUCTURE_RENDER_DIST = {
  uglyHouse: 24,      // UglyHouse 最大约 40x40
  tree: 8,            // RealisticTree 树木
  static_tree: 8,     // 静态树（白桦树、普通树等）
  house: 5,           // 普通小屋约 5x5
  tank: 20,           // Tank 尺寸约 35x70x40 (X/Z: ±20, Y: 根据实际结构调整)
  rover: 3,           // 火星车
  gunman: 3,          // 模型人
  island: 16          // 空岛跨Chunk渲染距离
};

/**
 * 特殊结构的 Y 轴高度范围配置
 */
export const STRUCTURE_HEIGHT_RANGE_SPECIAL = {
  tank: 35,       // tank 结构 Y 方向±35（共 71 格），覆盖 1-70 的范围
  uglyHouse: 22   // uglyHouse 结构 Y 方向±22（共 45 格），覆盖 1-44 的范围
};

/**
 * 默认渲染距离（当结构类型未在配置中定义时使用）
 */
export const DEFAULT_RENDER_DIST = 8;

/**
 * 默认结构高度范围（Y 轴方向的检查范围）
 */
export const STRUCTURE_HEIGHT_RANGE = 16;

/**
 * 获取结构类型的渲染距离
 * @param {string} type - 结构类型
 * @returns {number} 渲染距离（方块数）
 */
export function getStructureRenderDist(type) {
  return STRUCTURE_RENDER_DIST[type] ?? DEFAULT_RENDER_DIST;
}

/**
 * 判断一个方块位置是否属于某个结构中心
 * @param {number} x - 方块 X 坐标
 * @param {number} y - 方块 Y 坐标
 * @param {number} z - 方块 Z 坐标
 * @param {Array<{type: string, x: number, y: number, z: number}>} structureCenters - 结构中心列表
 * @returns {boolean} 是否属于某个结构
 */
export function belongsToStructure(x, y, z, structureCenters) {
  if (!structureCenters || structureCenters.length === 0) {
    return false;
  }

  for (const center of structureCenters) {
    const maxDist = getStructureRenderDist(center.type);
    const heightRange = STRUCTURE_HEIGHT_RANGE_SPECIAL[center.type] ?? STRUCTURE_HEIGHT_RANGE;
    const dx = Math.abs(x - center.x);
    const dz = Math.abs(z - center.z);
    const dy = Math.abs(y - center.y);

    if (dx <= maxDist && dz <= maxDist && dy <= heightRange) {
      return true;
    }
  }

  return false;
}

/**
 * 结构处理工具对象（兼容旧代码风格）
 */
export const StructureUtils = {
  RENDER_DIST: STRUCTURE_RENDER_DIST,
  DEFAULT_RENDER_DIST,
  HEIGHT_RANGE: STRUCTURE_HEIGHT_RANGE,
  HEIGHT_RANGE_SPECIAL: STRUCTURE_HEIGHT_RANGE_SPECIAL,

  /**
   * 获取结构类型的渲染距离
   * @param {string} type - 结构类型
   * @returns {number} 渲染距离
   */
  getRenderDist(type) {
    return getStructureRenderDist(type);
  },

  /**
   * 判断方块是否属于某个结构
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {Array} structureCenters - 结构中心列表
   * @returns {boolean} 是否属于某个结构
   */
  belongsToStructure(x, y, z, structureCenters) {
    return belongsToStructure(x, y, z, structureCenters);
  }
};

export default StructureUtils;