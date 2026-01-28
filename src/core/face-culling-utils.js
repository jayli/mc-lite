// src/core/face-culling-utils.js
/**
 * 隐藏面剔除算法工具函数
 * 提供位掩码操作、方向计算等工具函数
 */

import * as THREE from 'three';

/**
 * 面方向位掩码常量
 */
export const faceMask = {
  // 单个面
  TOP:    0b00000001,    // 1 - 上面 (Y+)
  BOTTOM: 0b00000010,    // 2 - 下面 (Y-)
  NORTH:  0b00000100,    // 4 - 北面 (Z-)
  SOUTH:  0b00001000,    // 8 - 南面 (Z+)
  WEST:   0b00010000,    // 16 - 西面 (X-)
  EAST:   0b00100000,    // 32 - 东面 (X+)

  // 组合面
  ALL:    0b00111111,    // 63 - 所有面
  NONE:   0b00000000,    // 0 - 无面
  SIDES:  0b00111100,    // 60 - 所有侧面（上下除外）
  VERTICAL: 0b00000011,  // 3 - 上下两面
  HORIZONTAL: 0b00111100 // 60 - 所有水平面
};

/**
 * 面方向名称映射
 */
export const faceNames = {
  [faceMask.TOP]: 'top',
  [faceMask.BOTTOM]: 'bottom',
  [faceMask.NORTH]: 'north',
  [faceMask.SOUTH]: 'south',
  [faceMask.WEST]: 'west',
  [faceMask.EAST]: 'east'
};

/**
 * 面方向索引映射
 */
export const faceIndex = {
  top: 0,
  bottom: 1,
  north: 2,
  south: 3,
  west: 4,
  east: 5
};

/**
 * 方向向量映射
 */
export const directionVectors = {
  top:    new THREE.Vector3(0, 1, 0),     // Y+
  bottom: new THREE.Vector3(0, -1, 0),    // Y-
  north:  new THREE.Vector3(0, 0, -1),    // Z-
  south:  new THREE.Vector3(0, 0, 1),     // Z+
  west:   new THREE.Vector3(-1, 0, 0),    // X-
  east:   new THREE.Vector3(1, 0, 0)      // X+
};

/**
 * 对面方向映射
 */
export const oppositeFaces = {
  [faceMask.TOP]: faceMask.BOTTOM,
  [faceMask.BOTTOM]: faceMask.TOP,
  [faceMask.NORTH]: faceMask.SOUTH,
  [faceMask.SOUTH]: faceMask.NORTH,
  [faceMask.WEST]: faceMask.EAST,
  [faceMask.EAST]: faceMask.WEST
};

/**
 * 检查位掩码中是否包含特定面
 * @param {number} mask - 位掩码
 * @param {number} face - 面位掩码
 * @returns {boolean}
 */
export function hasFace(mask, face) {
  return (mask & face) !== 0;
}

/**
 * 添加面到位掩码
 * @param {number} mask - 原始位掩码
 * @param {number} face - 要添加的面位掩码
 * @returns {number} 新位掩码
 */
export function addFace(mask, face) {
  return mask | face;
}

/**
 * 从位掩码中移除面
 * @param {number} mask - 原始位掩码
 * @param {number} face - 要移除的面位掩码
 * @returns {number} 新位掩码
 */
export function removeFace(mask, face) {
  return mask & ~face;
}

/**
 * 切换面的可见性
 * @param {number} mask - 原始位掩码
 * @param {number} face - 要切换的面位掩码
 * @returns {number} 新位掩码
 */
export function toggleFace(mask, face) {
  return hasFace(mask, face) ? removeFace(mask, face) : addFace(mask, face);
}

/**
 * 获取位掩码中可见面的数量
 * @param {number} mask - 位掩码
 * @returns {number} 可见面数量
 */
export function countVisibleFaces(mask) {
  // 使用位操作计算1的数量
  let count = 0;
  let temp = mask;
  while (temp) {
    count += temp & 1;
    temp >>= 1;
  }
  return count;
}

/**
 * 获取位掩码中隐藏面的数量
 * @param {number} mask - 位掩码
 * @returns {number} 隐藏面数量
 */
export function countHiddenFaces(mask) {
  return 6 - countVisibleFaces(mask);
}

/**
 * 将位掩码转换为面名称数组
 * @param {number} mask - 位掩码
 * @returns {string[]} 面名称数组
 */
export function maskToFaceNames(mask) {
  const faces = [];
  for (const [faceMaskValue, name] of Object.entries(faceNames)) {
    if (hasFace(mask, parseInt(faceMaskValue))) {
      faces.push(name);
    }
  }
  return faces;
}

/**
 * 将面名称数组转换为位掩码
 * @param {string[]} faceNames - 面名称数组
 * @returns {number} 位掩码
 */
export function faceNamesToMask(faceNamesArray) {
  let mask = faceMask.NONE;
  for (const name of faceNamesArray) {
    const faceValue = Object.entries(faceNames).find(([_, n]) => n === name);
    if (faceValue) {
      mask = addFace(mask, parseInt(faceValue[0]));
    }
  }
  return mask;
}

/**
 * 获取面的对面方向
 * @param {number} face - 面位掩码
 * @returns {number} 对面位掩码
 */
export function getOppositeFace(face) {
  return oppositeFaces[face] || faceMask.NONE;
}

/**
 * 获取面的方向向量
 * @param {number} face - 面位掩码
 * @returns {THREE.Vector3} 方向向量
 */
export function getFaceDirection(face) {
  const name = faceNames[face];
  return name ? directionVectors[name].clone() : new THREE.Vector3(0, 0, 0);
}

/**
 * 根据方向向量获取面位掩码
 * @param {THREE.Vector3} direction - 方向向量
 * @returns {number} 面位掩码
 */
export function getFaceFromDirection(direction) {
  const dir = direction.clone().normalize();

  // 检查六个方向
  if (dir.y > 0.5) return faceMask.TOP;
  if (dir.y < -0.5) return faceMask.BOTTOM;
  if (dir.z < -0.5) return faceMask.NORTH;
  if (dir.z > 0.5) return faceMask.SOUTH;
  if (dir.x < -0.5) return faceMask.WEST;
  if (dir.x > 0.5) return faceMask.EAST;

  return faceMask.NONE;
}

/**
 * 获取相邻位置
 * @param {THREE.Vector3} position - 原始位置
 * @param {number} face - 面位掩码
 * @returns {THREE.Vector3} 相邻位置
 */
export function getNeighborPosition(position, face) {
  const direction = getFaceDirection(face);
  return new THREE.Vector3(
    position.x + direction.x,
    position.y + direction.y,
    position.z + direction.z
  );
}

/**
 * 获取所有相邻位置
 * @param {THREE.Vector3} position - 原始位置
 * @returns {Object} 六个方向的相邻位置
 */
export function getAllNeighborPositions(position) {
  return {
    top: getNeighborPosition(position, faceMask.TOP),
    bottom: getNeighborPosition(position, faceMask.BOTTOM),
    north: getNeighborPosition(position, faceMask.NORTH),
    south: getNeighborPosition(position, faceMask.SOUTH),
    west: getNeighborPosition(position, faceMask.WEST),
    east: getNeighborPosition(position, faceMask.EAST)
  };
}

/**
 * 计算优化率
 * @param {number} facesCulled - 剔除的面数
 * @param {number} facesRendered - 渲染的面数
 * @returns {number} 优化率 (0-1)
 */
export function calculateOptimizationRate(facesCulled, facesRendered) {
  const total = facesCulled + facesRendered;
  return total > 0 ? facesCulled / total : 0;
}

/**
 * 格式化优化率为百分比字符串
 * @param {number} rate - 优化率 (0-1)
 * @returns {string} 百分比字符串
 */
export function formatOptimizationRate(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * 验证位掩码有效性
 * @param {number} mask - 位掩码
 * @returns {boolean} 是否有效
 */
export function isValidMask(mask) {
  return Number.isInteger(mask) && mask >= 0 && mask <= faceMask.ALL;
}

/**
 * 生成随机测试位掩码
 * @param {number} visibleCount - 可见面数量 (0-6)
 * @returns {number} 随机位掩码
 */
export function generateRandomMask(visibleCount = 3) {
  const faces = Object.values(faceMask).filter(v => v !== faceMask.ALL && v !== faceMask.NONE);
  const shuffled = [...faces].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(visibleCount, 6));

  let mask = faceMask.NONE;
  for (const face of selected) {
    mask = addFace(mask, face);
  }
  return mask;
}

/**
 * 调试：将位掩码可视化字符串
 * @param {number} mask - 位掩码
 * @returns {string} 可视化字符串
 */
export function visualizeMask(mask) {
  const symbols = {
    [faceMask.TOP]: '↑',
    [faceMask.BOTTOM]: '↓',
    [faceMask.NORTH]: '←',
    [faceMask.SOUTH]: '→',
    [faceMask.WEST]: '↙',
    [faceMask.EAST]: '↘'
  };

  let result = '';
  for (const [faceValue, symbol] of Object.entries(symbols)) {
    result += hasFace(mask, parseInt(faceValue)) ? symbol : '·';
  }

  return result;
}

/**
 * 性能测量工具
 */
export class PerformanceTimer {
  constructor() {
    this.startTime = 0;
    this.endTime = 0;
  }

  start() {
    this.startTime = performance.now();
  }

  stop() {
    this.endTime = performance.now();
    return this.endTime - this.startTime;
  }

  measure(callback) {
    this.start();
    const result = callback();
    const duration = this.stop();
    return { result, duration };
  }
}

// 导出工具函数集合
export default {
  faceMask,
  faceNames,
  faceIndex,
  directionVectors,
  oppositeFaces,
  hasFace,
  addFace,
  removeFace,
  toggleFace,
  countVisibleFaces,
  countHiddenFaces,
  maskToFaceNames,
  faceNamesToMask,
  getOppositeFace,
  getFaceDirection,
  getFaceFromDirection,
  getNeighborPosition,
  getAllNeighborPositions,
  calculateOptimizationRate,
  formatOptimizationRate,
  isValidMask,
  generateRandomMask,
  visualizeMask,
  PerformanceTimer
};
