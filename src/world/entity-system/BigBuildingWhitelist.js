// src/world/entity-system/BigBuildingWhitelist.js
/**
 * 大型建筑白名单
 * 约定：在白名单中的结构类型，按“方块坐标归属 Chunk”进行渲染与存储；
 * 不在白名单中的结构类型，继续沿用原有跨 Chunk 逻辑。
 */

export const BIG_BUILDING_WHITELIST = Object.freeze([
  'castle',
  'gate',
  'tank',
  'tower',
  'uglyHouse',
  'desertVillage',
  'desertPyramid'
]);

const BIG_BUILDING_SET = new Set(BIG_BUILDING_WHITELIST);

/**
 * 判断结构类型是否在大型建筑白名单内
 * @param {string} type - 结构类型
 * @returns {boolean}
 */
export function isBigBuildingType(type) {
  return BIG_BUILDING_SET.has(type);
}
