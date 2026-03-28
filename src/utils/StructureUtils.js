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
  bigHouse: 22,       // big_house 约 37x39
  boxHouse: 12,       // box_house 约 18x11
  uglyHouse: 24,      // UglyHouse 最大约 40x40
  desertVillage: 10,  // DesertVillage 约 17x17，含前方台阶和平台
  desertPyramid: 16,  // DesertPyramid 约 25x25，含台阶外扩
  doubleTower: 20,    // double_tower 约 26x15
  pyramidIsland: 22,  // pyramid_island 约 34x39
  smallHouse: 18,     // small_house 约 33x29
  treeHouse: 10,      // tree_house 约 16x15
  woodHouse: 10,      // wood_house 约 17x16
  tree: 8,            // RealisticTree 树木
  static_tree: 8,     // 静态树（白桦树、普通树等）
  house: 5,           // 普通小屋约 5x5
  tank: 20,           // Tank 尺寸约 35x70x40 (X/Z: ±20, Y: 根据实际结构调整)
  tower: 8,           // 海岛高塔尺寸约 9x28x10
  whiteTower: 24,     // white_tower 结构尺寸约 22x39x11（含侧边树冠）
  castle: 36,         // 城堡尺寸约 70x70，含外墙与塔楼
  gate: 20,           // 拱门尺寸约 24x22x11（含两侧塔楼与连桥）
  pavilion: 24,       // pavilion 顶部云结构跨度较大
  tall_well: 12,      // tall_well 底座约 11x7，保守按 12 处理
  rover: 3,           // 火星车
  gunman: 3,          // 模型人
  island: 16          // 空岛跨Chunk渲染距离
};

/**
 * 特殊结构的 Y 轴高度范围配置
 */
export const STRUCTURE_HEIGHT_RANGE_SPECIAL = {
  bigHouse: 14,
  boxHouse: 48,
  tank: 35,       // tank 结构 Y 方向±35（共 71 格），覆盖 1-70 的范围
  doubleTower: 48,
  pyramidIsland: 26,
  smallHouse: 14,
  treeHouse: 24,
  woodHouse: 18,
  uglyHouse: 22,  // uglyHouse 结构 Y 方向±22（共 45 格），覆盖 1-44 的范围
  desertVillage: 12, // DesertVillage 最高约 11 层，预留一定容差
  desertPyramid: 20, // DesertPyramid 最高约 16 层，预留一定容差
  tower: 28,      // tower 结构 Y 方向±28，覆盖塔身与屋顶
  whiteTower: 40, // white_tower 结构 Y 方向±40，覆盖尖顶和树冠
  castle: 36,     // castle 结构 Y 方向±36，覆盖主楼与塔顶
  gate: 24,       // gate 结构 Y 方向±24，覆盖拱顶与塔楼
  pavilion: 64,   // pavilion 最高约 61 层，预留容差
  tall_well: 64   // tall_well 为高竖向结构，放宽 Y 范围防止上半截切割
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
 * 保留跨 Chunk owner 的非标准实体类型
 * 说明：
 * - 这些类型存在运行时特殊生命周期或非纯方块语义，仍使用结构中心兜底
 * - 其余结构统一采用“方块坐标归属 Chunk”
 */
export const CROSS_CHUNK_OWNER_TYPES = Object.freeze([
  'tree',       // RealisticTree
  'static_tree',// 静态树（普通树/白桦树等）
  'house',      // 普通小屋（代码生成）
  'tall_well',  // 高井（JSON 结构）
  'pavilion',   // 亭子（JSON 结构）
  'gunman',     // 模型人
  'rover',      // 火星车
  'zombieNest', // 丧尸巢穴
  'turret'      // 炮塔（预留）
]);

const CROSS_CHUNK_OWNER_SET = new Set(CROSS_CHUNK_OWNER_TYPES);

/**
 * 禁止跨 Chunk owner 的结构类型（即使自动检测到越界也不启用）
 * 这些结构依赖“按坐标归属 + 邻域重建”策略，启用跨 Chunk owner 会重引入重复 owner 风险
 */
export const CROSS_CHUNK_OWNER_BLOCKED_TYPES = Object.freeze([
  'bigHouse',
  'boxHouse',
  'castle',
  'doubleTower',
  'gate',
  'pyramidIsland',
  'smallHouse',
  'tank',
  'tower',
  'treeHouse',
  'whiteTower',
  'woodHouse',
  'uglyHouse',
  'desertVillage',
  'desertPyramid'
]);

const CROSS_CHUNK_OWNER_BLOCKED_SET = new Set(CROSS_CHUNK_OWNER_BLOCKED_TYPES);

/**
 * 判断结构类型是否允许跨 Chunk owner
 * @param {string} type - 结构类型
 * @returns {boolean}
 */
export function isCrossChunkOwnerType(type, extraAllowedTypes = null) {
  if (CROSS_CHUNK_OWNER_BLOCKED_SET.has(type)) return false;
  if (CROSS_CHUNK_OWNER_SET.has(type)) return true;
  if (extraAllowedTypes && typeof extraAllowedTypes.has === 'function') {
    return extraAllowedTypes.has(type);
  }
  return false;
}

/**
 * 判断结构类型是否属于大型静态结构
 * @param {string} type - 结构类型
 * @returns {boolean}
 */
export function isLargeStaticStructureType(type) {
  return !isCrossChunkOwnerType(type);
}

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
 * 判断一个方块位置是否属于可跨 Chunk 渲染的结构中心
 * 仅保留非大型静态结构的跨 Chunk 行为（如 tree/gunman/rover/zombieNest）
 * @param {number} x - 方块 X 坐标
 * @param {number} y - 方块 Y 坐标
 * @param {number} z - 方块 Z 坐标
 * @param {Array<{type: string, x: number, y: number, z: number}>} structureCenters - 结构中心列表
 * @returns {boolean}
 */
export function belongsToCrossChunkStructure(x, y, z, structureCenters, extraAllowedTypes = null) {
  if (!structureCenters || structureCenters.length === 0) {
    return false;
  }

  for (const center of structureCenters) {
    if (!isCrossChunkOwnerType(center.type, extraAllowedTypes)) continue;

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
 * 判断一个方块位置是否属于大型静态结构范围
 * @param {number} x - 方块 X 坐标
 * @param {number} y - 方块 Y 坐标
 * @param {number} z - 方块 Z 坐标
 * @param {Array<{type: string, x: number, y: number, z: number}>} structureCenters - 结构中心列表
 * @returns {boolean}
 */
export function belongsToLargeStaticStructure(x, y, z, structureCenters) {
  if (!structureCenters || structureCenters.length === 0) {
    return false;
  }

  for (const center of structureCenters) {
    if (isCrossChunkOwnerType(center.type)) continue;

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
  },

  isLargeStaticStructureType(type) {
    return isLargeStaticStructureType(type);
  },

  isCrossChunkOwnerType(type) {
    return isCrossChunkOwnerType(type);
  },

  belongsToCrossChunkStructure(x, y, z, structureCenters, extraAllowedTypes = null) {
    return belongsToCrossChunkStructure(x, y, z, structureCenters, extraAllowedTypes);
  },

  belongsToLargeStaticStructure(x, y, z, structureCenters) {
    return belongsToLargeStaticStructure(x, y, z, structureCenters);
  }
};

export default StructureUtils;
