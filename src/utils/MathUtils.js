// src/utils/MathUtils.js
export const WORLD_CONFIG = {
  SEED: Math.random() * 9999
};

export function setSeed(s) {
  // console.log(`[Seed] Setting global seed to: ${s}`);
  WORLD_CONFIG.SEED = s;
}

export function noise(x, z, scale = 0.05) {
  const nx = x + WORLD_CONFIG.SEED, nz = z + WORLD_CONFIG.SEED;
  return Math.sin(nx * scale) * 2 + Math.cos(nz * scale) * 2;
}

// [增强] 群系逻辑
export function getBiome(x, z) {
  const temp = noise(x, z, 0.01); // 温度
  const humidity = noise(x + 1000, z + 1000, 0.015); // 湿度

  if (temp > 1.2) return 'FOREST';
  if (temp > 0.6 && temp <= 1.2 && humidity > 0) return 'AZALEA'; // 杜鹃林
  if (temp < -1.5) return 'DESERT';
  if (temp > -1.5 && temp < -0.8 && humidity > 0.5) return 'SWAMP'; // 沼泽
  return 'PLAINS';
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * 计算两个角度之间的最短差值（处理角度环绕）
 * @param {number} current - 当前角度（弧度）
 * @param {number} target - 目标角度（弧度）
 * @returns {number} 最短差值（弧度，范围 [-π, π]）
 */
export function shortestAngleDiff(current, target) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * 平滑插值角度（使用最短路径）
 * @param {number} current - 当前角度（弧度）
 * @param {number} target - 目标角度（弧度）
 * @param {number} t - 插值因子 [0, 1]
 * @returns {number} 插值后的角度（弧度）
 */
export function lerpAngle(current, target, t) {
  const diff = shortestAngleDiff(current, target);
  return current + diff * t;
}

/**
 * 计算从一点到另一点的角度（Y轴旋转）
 * @param {Object} from - 起点 {x, y, z}
 * @param {Object} to - 终点 {x, y, z}
 * @returns {number} 角度（弧度）
 */
export function angleTo(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.atan2(dx, dz);
}

/**
 * 计算两点之间的距离
 * @param {Object} a - 点A {x, y, z}
 * @param {Object} b - 点B {x, y, z}
 * @returns {number} 距离
 */
export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 将角度归一化到 [0, 2π) 范围
 * @param {number} angle - 角度（弧度）
 * @returns {number} 归一化后的角度（弧度）
 */
export function normalizeAngle(angle) {
  const twoPI = Math.PI * 2;
  angle = angle % twoPI;
  if (angle < 0) angle += twoPI;
  return angle;
}
