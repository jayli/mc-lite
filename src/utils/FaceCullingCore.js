// src/utils/FaceCullingCore.js
/**
 * Face Culling 核心算法（纯逻辑，不依赖 Three.js）
 * 此文件可在 Worker 和主线程中共享使用
 */

/**
 * 面方向位掩码常量
 */
export const faceMask = {
  TOP:    0b00000001,    // 1 - 上面 (Y+)
  BOTTOM: 0b00000010,    // 2 - 下面 (Y-)
  NORTH:  0b00000100,    // 4 - 北面 (Z-)
  SOUTH:  0b00001000,    // 8 - 南面 (Z+)
  WEST:   0b00010000,    // 16 - 西面 (X-)
  EAST:   0b00100000,    // 32 - 东面 (X+)
  ALL:    0b00111111,    // 63 - 所有面
  NONE:   0b00000000,    // 0 - 无面
  SIDES:  0b00111100,    // 60 - 所有侧面（上下除外）
  VERTICAL: 0b00000011,  // 3 - 上下两面
  HORIZONTAL: 0b00111100 // 60 - 所有水平面
};

/**
 * 六个方向的位掩码定义
 */
export const FACE_DIRECTIONS = [
  { name: 'top',    dx: 0,  dy: 1,  dz: 0,  bit: 0b000001 },
  { name: 'bottom', dx: 0,  dy: -1, dz: 0,  bit: 0b000010 },
  { name: 'north',  dx: 0,  dy: 0,  dz: -1, bit: 0b000100 },
  { name: 'south',  dx: 0,  dy: 0,  dz: 1,  bit: 0b001000 },
  { name: 'west',   dx: -1, dy: 0,  dz: 0,  bit: 0b010000 },
  { name: 'east',   dx: 1,  dy: 0,  dz: 0,  bit: 0b100000 }
];

/**
 * 计算方块可见面掩码（核心算法）
 * 统一主线程和 Worker 中的 Face Culling 逻辑
 *
 * @param {string} blockType - 方块类型
 * @param {Function} getNeighborType - 获取邻居方块类型的函数 (dx, dy, dz) => type | null
 * @param {Function} isTransparentFn - 检查方块是否透明的函数 (type) => boolean
 * @param {Function} [isAlwaysVisibleFn] - 检查方块是否始终可见 (type) => boolean
 * @returns {number} 面掩码 (0-63)
 */
export function computeFaceVisibilityMask(blockType, getNeighborType, isTransparentFn, isAlwaysVisibleFn = null) {
  // 保留调用方原有语义：不同场景可配置“始终可见”方块类型
  if (isAlwaysVisibleFn && isAlwaysVisibleFn(blockType)) {
    return faceMask.ALL; // 63
  }

  // 透明方块所有面可见
  if (isTransparentFn(blockType)) {
    return faceMask.ALL; // 63
  }

  let mask = faceMask.NONE;

  // 检查六个方向
  for (const dir of FACE_DIRECTIONS) {
    const neighborType = getNeighborType(dir.dx, dir.dy, dir.dz);
    // 如果没有邻居方块（空气）或者邻居是透明的，则该面可见
    if (!neighborType || isTransparentFn(neighborType)) {
      mask |= dir.bit;
    }
  }

  return mask;
}

import { getFromBlockDataObj } from './CoordEncoding.js';

/**
 * 从 plain object 格式的 blockData 中提取方块类型
 * Worker 专用：blockData 是 { code: entry } 格式
 * 兼容字符串 key 回退（旧档数据）
 * @param {Object} blockData - 方块数据对象
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @returns {string|null} 方块类型
 */
function getTypeFromBlockData(blockData, x, y, z) {
  const entry = getFromBlockDataObj(blockData, x, y, z);
  return entry ? (typeof entry === 'string' ? entry : entry.type) : null;
}

/**
 * 创建基于 blockData 对象的邻居查询函数
 * 支持数字编码 key 和字符串 key 两种格式
 * @param {Object} blockData - 方块数据（{code: type} 或 {"x,y,z": type}）
 * @param {number} x - 当前方块 X 坐标
 * @param {number} y - 当前方块 Y 坐标
 * @param {number} z - 当前方块 Z 坐标
 * @returns {Function} (dx, dy, dz) => type | null
 */
export function createBlockDataNeighborQuery(blockData, x, y, z) {
  return function getNeighborType(dx, dy, dz) {
    return getTypeFromBlockData(blockData, x + dx, y + dy, z + dz);
  };
}

/**
 * 创建基于 Map 的邻居查询函数
 * @param {Map} blockMap - Map<"x,y,z", {type: string}> 格式的方块数据
 * @param {number} x - 当前方块 X 坐标
 * @param {number} y - 当前方块 Y 坐标
 * @param {number} z - 当前方块 Z 坐标
 * @returns {Function} (dx, dy, dz) => type | null
 */
export function createBlockMapNeighborQuery(blockMap, x, y, z) {
  return function getNeighborType(dx, dy, dz) {
    const key = `${Math.floor(x + dx)},${Math.floor(y + dy)},${Math.floor(z + dz)}`;
    const block = blockMap.get(key);
    return block ? block.type : null;
  };
}

/**
 * 创建基于 neighbors 对象的邻居查询函数
 * @param {Object} neighbors - {top, bottom, north, south, west, east} 格式的邻居对象
 * @returns {Function} (dx, dy, dz) => type | null
 */
export function createNeighborsObjectQuery(neighbors) {
  const directionMap = {
    '0,1,0': 'top',
    '0,-1,0': 'bottom',
    '0,0,-1': 'north',
    '0,0,1': 'south',
    '-1,0,0': 'west',
    '1,0,0': 'east'
  };

  return function getNeighborType(dx, dy, dz) {
    const key = `${dx},${dy},${dz}`;
    const direction = directionMap[key];
    if (!direction) return null;

    const neighbor = neighbors[direction];
    return neighbor ? neighbor.type : null;
  };
}

/**
 * 创建跨区块邻居查询函数
 * 支持数字编码 key 和字符串 key 两种格式
 * @param {Object} blockData - 当前区块的方块数据
 * @param {Map} worldChunks - 世界区块映射
 * @param {number} currentCx - 当前区块 X 坐标
 * @param {number} currentCz - 当前区块 Z 坐标
 * @param {number} x - 当前方块世界坐标 X
 * @param {number} y - 当前方块世界坐标 Y
 * @param {number} z - 当前方块世界坐标 Z
 * @returns {Function} (dx, dy, dz) => type | null
 */
export function createCrossChunkNeighborQuery(blockData, worldChunks, currentCx, currentCz, x, y, z) {
  return function getNeighborType(dx, dy, dz) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;

    const nxChunk = Math.floor(nx / 16);
    const nzChunk = Math.floor(nz / 16);

    // 如果在当前区块内
    if (nxChunk === currentCx && nzChunk === currentCz) {
      return getTypeFromBlockData(blockData, nx, ny, nz);
    }

    // 跨区块查询
    const chunkKey = `${nxChunk},${nzChunk}`;
    const neighborChunk = worldChunks.get(chunkKey);

    if (neighborChunk && neighborChunk.blockData) {
      return getTypeFromBlockData(neighborChunk.blockData, nx, ny, nz);
    }

    return null;
  };
}
