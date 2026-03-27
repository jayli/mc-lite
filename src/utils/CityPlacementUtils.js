/**
 * City 放置算法工具模块
 * 提供放置计算、边界检查、距离判定等通用功能
 */

import { CITY_PLACEMENT, CITY_STRUCTURE_FOOTPRINT, CITY_TRANSITION_SIZE } from '../constants/RegionMapConfig.js';

const { HASH_MULTIPLIER } = CITY_PLACEMENT;

/**
 * 确定性随机哈希函数
 * @param {number} v - 输入值
 * @returns {number} 0-1 之间的随机值
 */
export function hash01(v) {
  const s = Math.sin(v) * HASH_MULTIPLIER;
  return s - Math.floor(s);
}

/**
 * 计算两点间平方距离
 * @param {number} x1 - 点1 X 坐标
 * @param {number} z1 - 点1 Z 坐标
 * @param {number} x2 - 点2 X 坐标
 * @param {number} z2 - 点2 Z 坐标
 * @returns {number} 平方距离
 */
export function distanceSquared(x1, z1, x2, z2) {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return dx * dx + dz * dz;
}

/**
 * 计算两点间曼哈顿距离
 * @param {number} x1 - 点1 X 坐标
 * @param {number} z1 - 点1 Z 坐标
 * @param {number} x2 - 点2 X 坐标
 * @param {number} z2 - 点2 Z 坐标
 * @returns {number} 曼哈顿距离
 */
export function manhattanDistance(x1, z1, x2, z2) {
  return Math.abs(x1 - x2) + Math.abs(z1 - z2);
}

/**
 * 计算建筑 footprint 的边界框
 * @param {number} x - 中心 X 坐标
 * @param {number} z - 中心 Z 坐标
 * @param {string} type - 建筑类型
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}|null} 边界框
 */
export function getStructureBounds(x, z, type) {
  const fp = CITY_STRUCTURE_FOOTPRINT[type];
  if (!fp) return null;
  return {
    minX: x - fp.halfX,
    maxX: x + fp.halfX,
    minZ: z - fp.halfZ,
    maxZ: z + fp.halfZ
  };
}

/**
 * 扩展边界框（添加 padding）
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - 原始边界框
 * @param {number} padding - 扩展距离
 * @returns {{minX: number, maxX: number, minZ: number, maxZ: number}} 扩展后的边界框
 */
export function expandBounds(bounds, padding) {
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minZ: bounds.minZ - padding,
    maxZ: bounds.maxZ + padding
  };
}

/**
 * 检查点是否在边界框内
 * @param {number} x - 点 X 坐标
 * @param {number} z - 点 Z 坐标
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds - 边界框
 * @returns {boolean} 是否在边界框内
 */
export function isPointInBounds(x, z, bounds) {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

/**
 * 检查两个边界框是否重叠
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} a - 边界框 A
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} b - 边界框 B
 * @returns {boolean} 是否重叠
 */
export function doBoundsOverlap(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

/**
 * 检查两个建筑是否重叠（考虑间距）
 * @param {Object} candidate - 候选建筑 { x, z, type }
 * @param {Object} existing - 已有建筑 { x, z, type }
 * @param {number} [gap=0] - 额外间距
 * @returns {boolean} 是否重叠或距离过近
 */
export function isStructureOverlapping(candidate, existing, gap = 0) {
  const fpA = CITY_STRUCTURE_FOOTPRINT[candidate.type];
  const fpB = CITY_STRUCTURE_FOOTPRINT[existing.type];
  if (!fpA || !fpB) return false;

  const dx = Math.abs(candidate.x - existing.x);
  const dz = Math.abs(candidate.z - existing.z);
  const limitX = fpA.halfX + fpB.halfX + gap;
  const limitZ = fpA.halfZ + fpB.halfZ + gap;

  return dx <= limitX && dz <= limitZ;
}

/**
 * 计算两个建筑之间的最小间距要求
 * @param {string} typeA - 建筑 A 类型
 * @param {string} typeB - 建筑 B 类型
 * @param {number} seed - 世界种子
 * @param {number} indexA - 建筑 A 索引
 * @param {number} indexB - 建筑 B 索引
 * @returns {number} 最小间距
 */
export function getGapRequirement(typeA, typeB, seed, indexA, indexB) {
  const mixFactor = hash01(seed * 0.77 + indexA * 7.1 + indexB * 11.3);
  let gap = 10 + Math.floor(mixFactor * 4);

  const minGapA = CITY_STRUCTURE_FOOTPRINT[typeA]?.minGap || 10;
  const minGapB = CITY_STRUCTURE_FOOTPRINT[typeB]?.minGap || 10;
  gap = Math.max(gap, minGapA, minGapB);

  if (typeA === 'whiteTower' || typeB === 'whiteTower') {
    gap = Math.max(gap, 12);
  }

  return gap;
}

/**
 * 检查点是否靠近任何已放置建筑
 * @param {Array} placements - 已放置建筑列表
 * @param {number} x - 点 X 坐标
 * @param {number} z - 点 Z 坐标
 * @param {number} [padding=0] - 额外边距
 * @returns {boolean} 是否靠近
 */
export function isNearPlacement(placements, x, z, padding = 0) {
  for (const p of placements) {
    const bounds = getStructureBounds(p.x, p.z, p.type);
    if (!bounds) continue;
    const expanded = expandBounds(bounds, padding);
    if (isPointInBounds(x, z, expanded)) return true;
  }
  return false;
}

/**
 * 生成候选位置点（环形分布）
 * @param {number} centerX - 中心 X 坐标
 * @param {number} centerZ - 中心 Z 坐标
 * @param {number} minR - 最小半径
 * @param {number} maxR - 最大半径
 * @param {number} seed - 世界种子
 * @param {number} salt - 随机盐值
 * @param {Object} [options] - 可选参数
 * @param {number} [options.angleStep] - 角度步长（度）
 * @param {number} [options.ringStep] - 环距步长（格）
 * @param {number} [options.jitter] - 位置抖动范围（格）
 * @returns {Array<{x: number, z: number, localX: number, localZ: number}>} 候选点列表
 */
export function buildCandidates(centerX, centerZ, minR, maxR, seed, salt, options = {}) {
  const {
    angleStep = CITY_PLACEMENT.CANDIDATE_ANGLE_STEP,
    ringStep = CITY_PLACEMENT.CANDIDATE_RING_STEP,
    jitter = CITY_PLACEMENT.CANDIDATE_JITTER
  } = options;

  const candidates = [];

  for (let r = minR; r <= maxR; r += ringStep) {
    for (let angle = 0; angle < 360; angle += angleStep) {
      const rad = (angle / 180) * Math.PI;
      const jitterX = Math.floor((hash01(seed * 1.13 + salt * 0.71 + r * 0.21 + angle * 0.39) - 0.5) * jitter);
      const jitterZ = Math.floor((hash01(seed * 1.37 + salt * 0.67 + r * 0.27 + angle * 0.33) - 0.5) * jitter);
      const localX = Math.round(Math.cos(rad) * r) + jitterX;
      const localZ = Math.round(Math.sin(rad) * r) + jitterZ;
      candidates.push({
        x: centerX + localX,
        z: centerZ + localZ,
        localX,
        localZ
      });
    }
  }
  return candidates;
}

/**
 * 计算方向均衡性评分
 * 评估候选位置在各个方向上与其他建筑的分布均匀程度
 * @param {Object} candidate - 候选位置 { x, z, localX, localZ }
 * @param {Array} existing - 已放置建筑列表
 * @param {number} [targetSpacing=20] - 目标间距
 * @returns {number} 评分值（越高越好）
 */
export function scoreDirectionalBalance(candidate, existing, targetSpacing = 20) {
  if (existing.length === 0) return 1e6;

  const sectorAngle = Math.PI / 4; // 45度一个扇区
  const dirDistances = [];

  // 计算8个方向上的最近建筑距离
  for (let i = 0; i < 8; i++) {
    const angleStart = i * sectorAngle - sectorAngle / 2;
    const angleEnd = i * sectorAngle + sectorAngle / 2;
    let minDistInSector = Infinity;

    for (const p of existing) {
      const dx = p.x - candidate.x;
      const dz = p.z - candidate.z;
      const angle = Math.atan2(dz, dx);

      // 标准化角度到当前扇区范围
      let normalizedAngle = angle;
      while (normalizedAngle < angleStart) normalizedAngle += Math.PI * 2;
      while (normalizedAngle > angleStart + Math.PI * 2) normalizedAngle -= Math.PI * 2;

      if (normalizedAngle >= angleStart && normalizedAngle <= angleEnd) {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < minDistInSector) minDistInSector = dist;
      }
    }
    dirDistances.push(minDistInSector === Infinity ? targetSpacing * 3 : minDistInSector);
  }

  // 计算统计值
  const avgDist = dirDistances.reduce((a, b) => a + b, 0) / dirDistances.length;
  const maxDist = Math.max(...dirDistances);

  // 计算标准差
  const variance = dirDistances.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / dirDistances.length;
  const stdDev = Math.sqrt(variance);

  // 计算最近建筑距离
  let minCenterDistSq = Infinity;
  for (const p of existing) {
    const distSq = distanceSquared(candidate.x, candidate.z, p.x, p.z);
    if (distSq < minCenterDistSq) minCenterDistSq = distSq;
  }

  // 均衡性奖励
  const cv = avgDist > 0 ? stdDev / avgDist : 0;
  const balanceBonus = (1 - Math.min(cv, 1)) * targetSpacing * targetSpacing * 2;

  // 填补空缺奖励
  const gapFillBonus = maxDist > targetSpacing * 1.5 ? (maxDist - targetSpacing) * 10 : 0;

  // 中心距离惩罚
  const centerDistSq = candidate.localX * candidate.localX + candidate.localZ * candidate.localZ;
  const centerPenalty = centerDistSq * 0.02;

  return minCenterDistSq + balanceBonus + gapFillBonus - centerPenalty;
}

/**
 * 计算结构数量（支持固定值或范围）
 * @param {Object} config - 配置对象 { count, countRange }
 * @param {number} seed - 世界种子
 * @param {number} salt - 随机盐值
 * @returns {number} 计算后的数量
 */
export function getStructureCount(config, seed, salt) {
  if (config.count != null) return config.count;
  if (!config.countRange) return 1;

  const [min, max] = config.countRange;
  if (min === max) return min;

  const r = hash01(seed * CITY_PLACEMENT.SEED_MIX_X + salt * CITY_PLACEMENT.SEED_MIX_Z);
  return min + Math.floor(r * (max - min + 1));
}

/**
 * 放置策略枚举
 */
export const PlacementStrategy = {
  /** 正常放置：要求完全在过渡带内 */
  NORMAL: 'normal',
  /** 宽松放置：只需在 City 边界内 */
  RELAXED: 'relaxed',
  /** 强制放置：缩小间距到指定值 */
  FORCED: 'forced',
  /** 最小重叠：只要求不重叠 */
  MINIMAL: 'minimal',
  /** 随机：任意位置 */
  RANDOM: 'random'
};

/**
 * 检查放置是否有效（CityMap 专用版本）
 * @param {Object} candidate - 候选位置 { x, z, type, index }
 * @param {Array} existing - 已放置建筑列表
 * @param {number} seed - 世界种子
 * @param {Object} [bounds=null] - City 边界
 * @param {boolean} [requireTransitionZone=true] - 是否要求在过渡带内
 * @returns {boolean} 是否有效
 */
export function isPlacementValid(candidate, existing, seed, bounds = null, requireTransitionZone = true) {
  const fpA = CITY_STRUCTURE_FOOTPRINT[candidate.type];
  if (!fpA) return false;

  // 边界检查：确保建筑占地完全在 City 边界内，且在过渡带内边界内
  if (bounds) {
    const boundsA = getStructureBounds(candidate.x, candidate.z, candidate.type);
    if (!boundsA) return false;

    // 检查是否完全在 City 边界内
    if (!isPointInBounds(boundsA.minX, boundsA.minZ, bounds) ||
        !isPointInBounds(boundsA.maxX, boundsA.maxZ, bounds)) {
      return false;
    }

    // 检查是否在过渡带内边界内
    if (requireTransitionZone) {
      const innerBounds = {
        minX: bounds.minX + CITY_TRANSITION_SIZE,
        maxX: bounds.maxX - CITY_TRANSITION_SIZE,
        minZ: bounds.minZ + CITY_TRANSITION_SIZE,
        maxZ: bounds.maxZ - CITY_TRANSITION_SIZE
      };
      if (!isPointInBounds(boundsA.minX, boundsA.minZ, innerBounds) ||
          !isPointInBounds(boundsA.maxX, boundsA.maxZ, innerBounds)) {
        return false;
      }
    }
  }

  // 检查与其他建筑的距离
  for (let i = 0; i < existing.length; i++) {
    const p = existing[i];
    const fpB = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fpB) continue;
    const dx = Math.abs(candidate.x - p.x);
    const dz = Math.abs(candidate.z - p.z);
    const gap = getGapRequirement(candidate.type, p.type, seed, candidate.index, i);
    const limitX = fpA.halfX + fpB.halfX + gap;
    const limitZ = fpA.halfZ + fpB.halfZ + gap;

    if (dx <= limitX && dz <= limitZ) {
      return false;
    }
  }
  return true;
}
