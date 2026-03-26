// src/workers/maps/CityMap.js
/**
 * City 主城地图生成模块
 * 目标：
 * 1. 生成单主城（区域 [0,0]）
 * 2. 建筑配额固定/半固定，确定性排布，避免重叠
 * 3. 地形整体平缓，起伏不超过 3 格
 * 4. 地表使用 sand/clay 成片交错
 */

import { getBiome as getBaseBiome } from '../../utils/MathUtils.js';
import { getRegionSeededCenter, clampCenterToRegion } from './RegionCenterUtils.js';
import {
  REGION_SIZE,
  REGION_MIN_MARGIN,
  LANDMARK_OFFSET,
  CENTER_OFFSET,
  ISLAND_SEA_LEVEL,
  CITY_SIZE_MIN,
  CITY_SIZE_MAX
} from '../../constants/RegionMapConfig.js';

// 延迟导入以避免循环依赖
let PyramidModule = null;
let FrozenMountainModule = null;

function getPyramidModule() {
  if (!PyramidModule) {
    PyramidModule = import('./Pyramid.js').then(m => m.Pyramid || m);
  }
  return PyramidModule;
}

function getFrozenMountainModule() {
  if (!FrozenMountainModule) {
    FrozenMountainModule = import('./FrozenMountain.js').then(m => m.FrozenMountain || m);
  }
  return FrozenMountainModule;
}

const CITY_REGION_X = 0;
const CITY_REGION_Z = 0;
const CITY_GROUND_VARIANCE_MAX = 3;
const CITY_TRANSITION_SIZE = 32;
const CITY_TERRACE_WIDTH = 3;
const CITY_MIN_SURFACE_Y = ISLAND_SEA_LEVEL + 1;
const CITY_CORE_BUILD_MARGIN = 30; // 建筑群外 30 格即为过渡带内边缘

// 结构占地半径（按 JSON 实测边界配置）
const CITY_STRUCTURE_FOOTPRINT = Object.freeze({
  castle: { halfX: 23, halfZ: 26, minGap: 10 },
  whiteTower: { halfX: 15, halfZ: 6, minGap: 12 },
  bigHouse: { halfX: 18, halfZ: 20, minGap: 10 },
  boxHouse: { halfX: 9, halfZ: 5, minGap: 10 },
  desertVillage: { halfX: 13, halfZ: 14, minGap: 10 },
  doubleTower: { halfX: 18, halfZ: 7, minGap: 10 },
  gate: { halfX: 13, halfZ: 5, minGap: 10 },
  pyramidIsland: { halfX: 17, halfZ: 20, minGap: 12 },
  smallHouse: { halfX: 16, halfZ: 16, minGap: 10 },
  tower: { halfX: 4, halfZ: 5, minGap: 10 },
  treeHouse: { halfX: 8, halfZ: 7, minGap: 10 },
  uglyHouse: { halfX: 20, halfZ: 20, minGap: 10 },
  woodHouse: { halfX: 8, halfZ: 9, minGap: 10 }
});

const CITY_STRUCTURE_CONFIGS = Object.freeze([
  { type: 'castle', count: 1, fixedCenter: true },
  // 大尺寸结构优先放置
  { type: 'pyramidIsland', count: 1 },
  { type: 'bigHouse', count: 2 },
  { type: 'whiteTower', countRange: [2, 3] },
  { type: 'desertVillage', countRange: [3, 5] },
  { type: 'doubleTower', count: 1 },
  { type: 'boxHouse', count: 2 },
  { type: 'smallHouse', count: 2 },
  { type: 'tower', count: 1 },
  { type: 'treeHouse', count: 3 },
  { type: 'uglyHouse', count: 3 },
  { type: 'woodHouse', count: 4 }
]);

const layoutCache = new Map();

function hash01(v) {
  const s = Math.sin(v) * 43758.5453123;
  return s - Math.floor(s);
}

function getCountByConfig(config, seed, salt) {
  if (config.count != null) return config.count;
  if (!config.countRange) return 1;
  const [min, max] = config.countRange;
  if (min === max) return min;
  const r = hash01(seed * 1.213 + salt * 13.11);
  return min + Math.floor(r * (max - min + 1));
}

function getCityCenter(seed) {
  const { centerX: pyramidCx, centerZ: pyramidCz } = getRegionSeededCenter(
    CITY_REGION_X,
    CITY_REGION_Z,
    seed,
    {
      offsetScaleX: CENTER_OFFSET.SCALE_X,
      offsetScaleZ: CENTER_OFFSET.SCALE_Z,
      offsetBaseX: CENTER_OFFSET.BASE_X,
      offsetBaseZ: CENTER_OFFSET.BASE_Z
    }
  );

  let cityCx = pyramidCx + LANDMARK_OFFSET.CITY_X;
  let cityCz = pyramidCz + LANDMARK_OFFSET.CITY_Z;

  const minMargin = Math.floor(CITY_SIZE_MAX / 2) + REGION_MIN_MARGIN;
  const clamped = clampCenterToRegion(
    CITY_REGION_X,
    CITY_REGION_Z,
    cityCx,
    cityCz,
    minMargin,
    { regionSize: REGION_SIZE }
  );

  cityCx = clamped.cx;
  cityCz = clamped.cz;

  return { cityCx, cityCz };
}

function estimateCityBaseHeight(centerX, centerZ, seed, terrainGen) {
  const sampleRadius = 28;
  const sampleOffsets = [
    [0, 0],
    [sampleRadius, 0],
    [-sampleRadius, 0],
    [0, sampleRadius],
    [0, -sampleRadius],
    [sampleRadius, sampleRadius],
    [sampleRadius, -sampleRadius],
    [-sampleRadius, sampleRadius],
    [-sampleRadius, -sampleRadius]
  ];

  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (const [ox, oz] of sampleOffsets) {
    const sx = centerX + ox;
    const sz = centerZ + oz;
    const biome = getBaseBiome(sx, sz);
    const h = terrainGen.generateHeight(sx, sz, biome);
    if (h < minHeight) minHeight = h;
    if (h > maxHeight) maxHeight = h;
  }

  const avg = Math.floor((minHeight + maxHeight) * 0.5);
  const stableOffset = Math.floor(hash01(seed * 0.311 + centerX * 0.019 + centerZ * 0.023) * 2);
  return Math.max(CITY_MIN_SURFACE_Y, avg + stableOffset);
}

function getGapRequirement(typeA, typeB, seed, indexA, indexB) {
  let gap = 10 + Math.floor(hash01(seed * 0.77 + indexA * 7.1 + indexB * 11.3) * 4);
  const minGapA = CITY_STRUCTURE_FOOTPRINT[typeA]?.minGap || 10;
  const minGapB = CITY_STRUCTURE_FOOTPRINT[typeB]?.minGap || 10;
  gap = Math.max(gap, minGapA, minGapB);
  if (typeA === 'whiteTower' || typeB === 'whiteTower') {
    gap = Math.max(gap, 12);
  }
  return gap;
}

function isPlacementValid(candidate, existing, seed, bounds = null, requireTransitionZone = true) {
  const fpA = CITY_STRUCTURE_FOOTPRINT[candidate.type];
  if (!fpA) return false;

  // 边界检查：确保建筑占地完全在 City 边界内，且在过渡带内边界内
  if (bounds) {
    // 计算建筑 footprint 的边界
    const buildMinX = candidate.x - fpA.halfX;
    const buildMaxX = candidate.x + fpA.halfX;
    const buildMinZ = candidate.z - fpA.halfZ;
    const buildMaxZ = candidate.z + fpA.halfZ;

    // 检查是否完全在 City 边界内
    if (buildMinX < bounds.minX || buildMaxX > bounds.maxX ||
        buildMinZ < bounds.minZ || buildMaxZ > bounds.maxZ) {
      return false;
    }

    // 检查是否在过渡带内边界内（距离边界至少32格）
    if (requireTransitionZone) {
      const innerMinX = bounds.minX + CITY_TRANSITION_SIZE;
      const innerMaxX = bounds.maxX - CITY_TRANSITION_SIZE;
      const innerMinZ = bounds.minZ + CITY_TRANSITION_SIZE;
      const innerMaxZ = bounds.maxZ - CITY_TRANSITION_SIZE;

      if (buildMinX < innerMinX || buildMaxX > innerMaxX ||
          buildMinZ < innerMinZ || buildMaxZ > innerMaxZ) {
        return false;
      }
    }
  }

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

function scorePlacement(candidate, existing, targetSpacing = 20) {
  if (existing.length === 0) return 1e6;

  // 计算8个方向上的最近建筑距离
  const sectorAngle = Math.PI / 4; // 45度一个扇区

  const dirDistances = [];

  for (let i = 0; i < 8; i++) {
    const angleStart = i * sectorAngle - sectorAngle / 2;
    const angleEnd = i * sectorAngle + sectorAngle / 2;

    let minDistInSector = Infinity;
    for (const p of existing) {
      const dx = p.x - candidate.x;
      const dz = p.z - candidate.z;
      const angle = Math.atan2(dz, dx);

      // 检查是否在该扇区内
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

  // 计算方向距离的统计值
  const avgDist = dirDistances.reduce((a, b) => a + b, 0) / dirDistances.length;
  const maxDist = Math.max(...dirDistances);

  // 计算标准差（衡量方向均衡性）
  const variance = dirDistances.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / dirDistances.length;
  const stdDev = Math.sqrt(variance);

  // 综合评分：
  // 1. 基础分：距离最近建筑的远近（避免太近）
  let minCenterDistSq = Infinity;
  for (const p of existing) {
    const dx = candidate.x - p.x;
    const dz = candidate.z - p.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < minCenterDistSq) minCenterDistSq = distSq;
  }

  // 2. 均衡性奖励：标准差越小越好（各方向距离均匀）
  // 使用变异系数 (CV = stdDev / avg) 来归一化
  const cv = avgDist > 0 ? stdDev / avgDist : 0;
  const balanceBonus = (1 - Math.min(cv, 1)) * targetSpacing * targetSpacing * 2;

  // 3. 填补空缺奖励：如果这个位置能填补某个方向的远距离空缺，给予奖励
  // 当最大方向距离远大于平均距离时，说明这个位置可以填补空缺
  const gapFillBonus = maxDist > targetSpacing * 1.5 ? (maxDist - targetSpacing) * 10 : 0;

  // 4. 中心距离惩罚：避免离中心太远（轻微）
  const centerDistSq = candidate.localX * candidate.localX + candidate.localZ * candidate.localZ;
  const centerPenalty = centerDistSq * 0.02;

  // 最终评分：基础距离分 + 均衡奖励 + 填补奖励 - 中心惩罚
  return minCenterDistSq + balanceBonus + gapFillBonus - centerPenalty;
}

function buildCandidates(cityCx, cityCz, minR, maxR, seed, salt) {
  const candidates = [];
  const angleStep = 12;
  const ringStep = 6;
  for (let r = minR; r <= maxR; r += ringStep) {
    for (let angle = 0; angle < 360; angle += angleStep) {
      const rad = (angle / 180) * Math.PI;
      const jitterX = Math.floor((hash01(seed * 1.13 + salt * 0.71 + r * 0.21 + angle * 0.39) - 0.5) * 5);
      const jitterZ = Math.floor((hash01(seed * 1.37 + salt * 0.67 + r * 0.27 + angle * 0.33) - 0.5) * 5);
      const localX = Math.round(Math.cos(rad) * r) + jitterX;
      const localZ = Math.round(Math.sin(rad) * r) + jitterZ;
      candidates.push({
        x: cityCx + localX,
        z: cityCz + localZ,
        localX,
        localZ
      });
    }
  }
  return candidates;
}

function placeType(state, type, count, seed, minR, maxR, bounds = null) {
  let placed = 0;
  for (let k = 0; k < count; k++) {
    const index = state.placements.length;
    const salt = index + k * 17 + type.length * 13;
    const candidates = buildCandidates(state.cityCx, state.cityCz, minR, maxR, seed, salt);
    let best = null;
    let bestScore = -Infinity;

    // 目标间距用于方向均衡性计算
    const targetSpacing = Math.max(15, (minR + maxR) / 8);

    for (const c of candidates) {
      const candidate = { ...c, type, index };
      if (!isPlacementValid(candidate, state.placements, seed, bounds, true)) continue;
      const score = scorePlacement(candidate, state.placements, targetSpacing);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (!best) {
      // 二次扩圈，使用放宽的边界检查
      const fallbackCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 6, maxR + 28, seed, salt + 29);
      for (const c of fallbackCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed, bounds, false)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) {
      // 三次兜底：大范围搜索
      const emergencyCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 18, maxR + 96, seed, salt + 53);
      for (const c of emergencyCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed, bounds, false)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) {
      // 四次兜底：继续扩圈
      const lastCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 96, maxR + 180, seed, salt + 71);
      for (const c of lastCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed, bounds, false)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) {
      // 最终兜底：极大范围搜索，确保配额不丢失
      const hardCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 180, maxR + 420, seed, salt + 97);
      for (const c of hardCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed, bounds, false)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) {
      // 强制放置：缩小间距到10，确保建筑一定生成
      const forcedCandidates = buildCandidates(state.cityCx, state.cityCz, 10, maxR + 200, seed, salt + 137);
      for (const c of forcedCandidates) {
        const candidate = { ...c, type, index };
        // 只检查与其他建筑的距离（缩小间距到10），忽略边界
        let tooClose = false;
        for (let i = 0; i < state.placements.length; i++) {
          const p = state.placements[i];
          const fpA = CITY_STRUCTURE_FOOTPRINT[candidate.type];
          const fpB = CITY_STRUCTURE_FOOTPRINT[p.type];
          if (!fpA || !fpB) continue;
          const dx = Math.abs(candidate.x - p.x);
          const dz = Math.abs(candidate.z - p.z);
          // 间距缩小到10
          if (dx <= fpA.halfX + fpB.halfX + 10 && dz <= fpA.halfZ + fpB.halfZ + 10) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          best = candidate;
          break;
        }
      }
    }

    if (!best) {
      // 终极强制：间距缩小到5
      const finalCandidates = buildCandidates(state.cityCx, state.cityCz, 10, maxR + 300, seed, salt + 197);
      for (const c of finalCandidates) {
        const candidate = { ...c, type, index };
        let tooClose = false;
        for (let i = 0; i < state.placements.length; i++) {
          const p = state.placements[i];
          const fpA = CITY_STRUCTURE_FOOTPRINT[candidate.type];
          const fpB = CITY_STRUCTURE_FOOTPRINT[p.type];
          if (!fpA || !fpB) continue;
          const dx = Math.abs(candidate.x - p.x);
          const dz = Math.abs(candidate.z - p.z);
          // 间距缩小到5
          if (dx <= fpA.halfX + fpB.halfX + 5 && dz <= fpA.halfZ + fpB.halfZ + 5) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          best = candidate;
          break;
        }
      }
    }

    if (!best) {
      // 绝对强制：只要求不重叠，间距为0
      const absoluteCandidates = buildCandidates(state.cityCx, state.cityCz, 10, maxR + 500, seed, salt + 257);
      for (const c of absoluteCandidates) {
        const candidate = { ...c, type, index };
        let overlaps = false;
        for (let i = 0; i < state.placements.length; i++) {
          const p = state.placements[i];
          const fpA = CITY_STRUCTURE_FOOTPRINT[candidate.type];
          const fpB = CITY_STRUCTURE_FOOTPRINT[p.type];
          if (!fpA || !fpB) continue;
          const dx = Math.abs(candidate.x - p.x);
          const dz = Math.abs(candidate.z - p.z);
          // 只检查是否重叠（间距为0）
          if (dx < fpA.halfX + fpB.halfX && dz < fpA.halfZ + fpB.halfZ) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) {
          best = candidate;
          break;
        }
      }
    }

    if (!best) {
      // 如果连不重叠都做不到，随机选择一个位置（可能会重叠，但确保生成）
      const randomCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 100, maxR + 600, seed, salt + 317);
      if (randomCandidates.length > 0) {
        best = { ...randomCandidates[0], type, index };
      }
    }

    // 强制放置：如果所有尝试都失败，直接在随机位置生成
    if (!best) {
      const angle = hash01(seed * 0.5 + salt * 0.3) * Math.PI * 2;
      const dist = maxR + 50 + hash01(seed * 0.7 + salt * 0.5) * 200;
      best = {
        x: Math.floor(state.cityCx + Math.cos(angle) * dist),
        z: Math.floor(state.cityCz + Math.sin(angle) * dist),
        localX: Math.floor(Math.cos(angle) * dist),
        localZ: Math.floor(Math.sin(angle) * dist),
        type,
        index
      };
    }

    if (best) {
      state.placements.push(best);
      placed++;
    }
  }
  return placed;
}

function placeGates(state, _seed, cityBounds) {
  const gateCount = 2;
  const gates = [];
  const fp = CITY_STRUCTURE_FOOTPRINT.gate;

  // gate 紧贴过渡带内边界：距离边界正好 32 格（过渡带宽度）
  // gate footprint 必须完全在 City 边界内
  const innerMinX = cityBounds.minX + CITY_TRANSITION_SIZE + fp.halfX;
  const innerMaxX = cityBounds.maxX - CITY_TRANSITION_SIZE - fp.halfX;
  const northZ = cityBounds.minZ + CITY_TRANSITION_SIZE + fp.halfZ;
  const southZ = cityBounds.maxZ - CITY_TRANSITION_SIZE - fp.halfZ;

  const sideConfigs = [
    { side: 'north', preferredZ: northZ, zDir: 1 },
    { side: 'south', preferredZ: southZ, zDir: -1 }
  ];

  for (let i = 0; i < gateCount; i++) {
    const cfg = sideConfigs[i];
    let placed = null;

    // 在紧贴过渡带内边界的位置搜索，允许稍微向内偏移（0-15格）以避免与其他建筑冲突
    for (let offset = 0; offset <= 15; offset++) {
      const candidateZ = cfg.preferredZ + offset * cfg.zDir;

      // 检查 Z 是否在 City 边界内
      if (candidateZ - fp.halfZ < cityBounds.minZ ||
          candidateZ + fp.halfZ > cityBounds.maxZ) {
        continue;
      }

      // X 方向扫描，优先中间位置
      const centerX = state.cityCx;
      // 扩大搜索范围
      const xRange = Math.floor((innerMaxX - innerMinX) / 2);

      for (let xOffset = 0; xOffset <= xRange; xOffset += 2) {
        // 从中点向两侧扫描
        const scanPositions = [];
        if (xOffset === 0) {
          scanPositions.push(centerX);
        } else {
          scanPositions.push(centerX + xOffset, centerX - xOffset);
        }

        for (const scanX of scanPositions) {
          // 确保 scanX 在安全区域内
          const safeScanX = Math.max(innerMinX, Math.min(innerMaxX, scanX));

          // 检查 gate footprint 是否完全在边界内
          if (safeScanX - fp.halfX < cityBounds.minX ||
              safeScanX + fp.halfX > cityBounds.maxX ||
              candidateZ - fp.halfZ < cityBounds.minZ ||
              candidateZ + fp.halfZ > cityBounds.maxZ) {
            continue;
          }

          const candidate = {
            type: 'gate',
            x: safeScanX,
            z: candidateZ,
            localX: safeScanX - state.cityCx,
            localZ: candidateZ - state.cityCz,
            index: state.placements.length + i
          };

          // 检查与其他建筑的距离（使用完整的间距检查）
          let tooClose = false;
          for (const p of state.placements) {
            const pFp = CITY_STRUCTURE_FOOTPRINT[p.type];
            if (!pFp) continue;
            const dx = Math.abs(candidate.x - p.x);
            const dz = Math.abs(candidate.z - p.z);
            // 检查间距：需要满足 minGap 要求
            const gap = Math.max(fp.minGap, pFp.minGap, 10);
            const minDistanceX = fp.halfX + pFp.halfX + gap;
            const minDistanceZ = fp.halfZ + pFp.halfZ + gap;
            if (dx < minDistanceX && dz < minDistanceZ) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;

          placed = candidate;
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }

    // 如果还是找不到位置，扩大搜索范围再试一次
    if (!placed) {
      for (let offset = 0; offset <= 25; offset++) {
        const candidateZ = cfg.preferredZ + offset * cfg.zDir;

        if (candidateZ - fp.halfZ < cityBounds.minZ ||
            candidateZ + fp.halfZ > cityBounds.maxZ) {
          continue;
        }

        // 在整个安全区域内随机尝试
        for (let attempt = 0; attempt < 50; attempt++) {
          const randomX = innerMinX + Math.floor(Math.random() * (innerMaxX - innerMinX));
          const safeScanX = Math.max(innerMinX, Math.min(innerMaxX, randomX));

          if (safeScanX - fp.halfX < cityBounds.minX ||
              safeScanX + fp.halfX > cityBounds.maxX) {
            continue;
          }

          const candidate = {
            type: 'gate',
            x: safeScanX,
            z: candidateZ,
            localX: safeScanX - state.cityCx,
            localZ: candidateZ - state.cityCz,
            index: state.placements.length + i
          };

          let tooClose = false;
          for (const p of state.placements) {
            const pFp = CITY_STRUCTURE_FOOTPRINT[p.type];
            if (!pFp) continue;
            const dx = Math.abs(candidate.x - p.x);
            const dz = Math.abs(candidate.z - p.z);
            const gap = Math.max(fp.minGap, pFp.minGap, 10);
            const minDistanceX = fp.halfX + pFp.halfX + gap;
            const minDistanceZ = fp.halfZ + pFp.halfZ + gap;
            if (dx < minDistanceX && dz < minDistanceZ) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;

          placed = candidate;
          break;
        }
        if (placed) break;
      }
    }

    if (placed) gates.push(placed);
  }

  for (const g of gates) {
    state.placements.push(g);
  }
}

function isNearPlacement(placements, x, z, padding = 0) {
  for (const p of placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;
    const minX = p.x - fp.halfX - padding;
    const maxX = p.x + fp.halfX + padding;
    const minZ = p.z - fp.halfZ - padding;
    const maxZ = p.z + fp.halfZ + padding;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
  }
  return false;
}

function buildCityFillerTanks(layout, seed) {
  const tanks = [];
  const tankHalfX = 20;
  const tankHalfZ = 20;
  const targetCount = 2;
  // 确保坦克完全位于过渡带内：距离边界至少 32 + 20 + 2 = 54 格
  const minX = layout.minX + CITY_TRANSITION_SIZE + tankHalfX + 2;
  const maxX = layout.maxX - CITY_TRANSITION_SIZE - tankHalfX - 2;
  const minZ = layout.minZ + CITY_TRANSITION_SIZE + tankHalfZ + 2;
  const maxZ = layout.maxZ - CITY_TRANSITION_SIZE - tankHalfZ - 2;

  if (minX > maxX || minZ > maxZ) return tanks;

  const rangeX = Math.max(1, maxX - minX + 1);
  const rangeZ = Math.max(1, maxZ - minZ + 1);

  for (let i = 0; i < targetCount; i++) {
    let selected = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      const rx = Math.floor(hash01(seed * 1.91 + i * 13.7 + attempt * 0.73) * rangeX);
      const rz = Math.floor(hash01(seed * 2.03 + i * 17.1 + attempt * 0.67) * rangeZ);
      const x = minX + rx;
      const z = minZ + rz;

      if (isNearPlacement(layout.placements, x, z, 4)) continue;
      const nearOtherTank = tanks.some(t => Math.max(Math.abs(t.x - x), Math.abs(t.z - z)) < 18);
      if (nearOtherTank) continue;

      selected = { type: 'tank', x, z, id: `tank_fill_${i}` };
      break;
    }

    if (selected) tanks.push(selected);
  }

  return tanks;
}

function buildCityLayout(seed, terrainGen) {
  const { cityCx, cityCz } = getCityCenter(seed);
  const baseHeight = estimateCityBaseHeight(cityCx, cityCz, seed, terrainGen);

  // ========== 第一步：使用最大边界放置所有建筑，确保配额完整 ==========
  const state = {
    cityCx,
    cityCz,
    placements: []
  };

  // 使用最大可能的边界进行初始布局
  const globalMaxHalfSize = Math.floor(CITY_SIZE_MAX / 2);
  const maxBounds = {
    minX: cityCx - globalMaxHalfSize,
    maxX: cityCx + globalMaxHalfSize,
    minZ: cityCz - globalMaxHalfSize,
    maxZ: cityCz + globalMaxHalfSize
  };

  // 放置中心城堡
  state.placements.push({
    type: 'castle',
    x: cityCx,
    z: cityCz,
    localX: 0,
    localZ: 0,
    index: 0
  });

  // 放置其他建筑，使用最大边界，确保所有配额都能生成
  let salt = 1;
  for (const config of CITY_STRUCTURE_CONFIGS) {
    if (config.fixedCenter) continue;
    const count = getCountByConfig(config, seed, salt++);
    if (count <= 0) continue;

    // 使用较大的搜索半径，确保能找到位置
    // pyramidIsland 尺寸较大，需要更大的搜索范围
    const isLargeStructure = config.type === 'whiteTower' || config.type === 'pyramidIsland';
    const minR = isLargeStructure ? 30 : 15;
    const maxR = isLargeStructure ? 180 : 150;

    const placed = placeType(state, config.type, count, seed, minR, maxR, maxBounds);

    // 如果放置数量不足，记录日志
    if (placed < count) {
      console.warn(`CityMap: ${config.type} 只放置了 ${placed}/${count} 个`);
    }
  }

  // ========== 第二步：根据实际建筑位置计算 City 边界 ==========
  // 计算所有建筑的 footprint 边界
  let buildMinX = cityCx;
  let buildMaxX = cityCx;
  let buildMinZ = cityCz;
  let buildMaxZ = cityCz;

  for (const p of state.placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;
    buildMinX = Math.min(buildMinX, p.x - fp.halfX);
    buildMaxX = Math.max(buildMaxX, p.x + fp.halfX);
    buildMinZ = Math.min(buildMinZ, p.z - fp.halfZ);
    buildMaxZ = Math.max(buildMaxZ, p.z + fp.halfZ);
  }

  // City 边界 = 建筑 footprint 边界 + 30格缓冲 + 32格过渡带
  const buildHalfX = Math.max(
    Math.abs(buildMaxX - cityCx),
    Math.abs(cityCx - buildMinX)
  );
  const buildHalfZ = Math.max(
    Math.abs(buildMaxZ - cityCz),
    Math.abs(cityCz - buildMinZ)
  );

  // 计算所需半尺寸：建筑边界 + 30格缓冲到过渡带 + 32格过渡带
  const requiredHalfX = buildHalfX + CITY_CORE_BUILD_MARGIN + CITY_TRANSITION_SIZE;
  const requiredHalfZ = buildHalfZ + CITY_CORE_BUILD_MARGIN + CITY_TRANSITION_SIZE;

  // 取最大值确保正方形，同时满足最小/最大尺寸约束
  const requiredHalfSize = Math.max(requiredHalfX, requiredHalfZ);
  const minHalfSize = Math.floor(CITY_SIZE_MIN / 2);
  const cityMaxHalfSize = Math.floor(CITY_SIZE_MAX / 2);
  let halfSize = Math.max(minHalfSize, Math.min(cityMaxHalfSize, requiredHalfSize));

  let finalMinX = cityCx - halfSize;
  let finalMaxX = cityCx + halfSize;
  let finalMinZ = cityCz - halfSize;
  let finalMaxZ = cityCz + halfSize;

  // ========== 第三步：验证所有建筑都在过渡带内 ==========
  // 计算安全区域（过渡带内部，距离边界32格）
  const safeMinX = finalMinX + CITY_TRANSITION_SIZE;
  const safeMaxX = finalMaxX - CITY_TRANSITION_SIZE;
  const safeMinZ = finalMinZ + CITY_TRANSITION_SIZE;
  const safeMaxZ = finalMaxZ - CITY_TRANSITION_SIZE;

  // 检查是否有建筑 footprint 超出安全区域
  let needExpand = false;
  for (const p of state.placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;

    // 检查 footprint 是否完全在安全区域内
    const pMinX = p.x - fp.halfX;
    const pMaxX = p.x + fp.halfX;
    const pMinZ = p.z - fp.halfZ;
    const pMaxZ = p.z + fp.halfZ;

    // 如果 footprint 超出安全区域，需要扩展边界
    if (pMinX < safeMinX || pMaxX > safeMaxX ||
        pMinZ < safeMinZ || pMaxZ > safeMaxZ) {
      needExpand = true;
      // 计算需要的额外空间
      const expandLeft = Math.max(0, safeMinX - pMinX);
      const expandRight = Math.max(0, pMaxX - safeMaxX);
      const expandTop = Math.max(0, safeMinZ - pMinZ);
      const expandBottom = Math.max(0, pMaxZ - safeMaxZ);

      if (expandLeft > 0) finalMinX -= expandLeft + 2;
      if (expandRight > 0) finalMaxX += expandRight + 2;
      if (expandTop > 0) finalMinZ -= expandTop + 2;
      if (expandBottom > 0) finalMaxZ += expandBottom + 2;
    }
  }

  // 如果需要扩展，重新计算边界
  if (needExpand) {
    // 保持正方形
    const width = finalMaxX - finalMinX;
    const depth = finalMaxZ - finalMinZ;
    const maxSize = Math.max(width, depth);

    finalMinX = cityCx - Math.floor(maxSize / 2);
    finalMaxX = cityCx + Math.floor(maxSize / 2);
    finalMinZ = cityCz - Math.floor(maxSize / 2);
    finalMaxZ = cityCz + Math.floor(maxSize / 2);
    halfSize = Math.floor(maxSize / 2);
  }

  // 最终验证：如果还有建筑不在安全区域内，强制移动它
  const finalSafeMinX = finalMinX + CITY_TRANSITION_SIZE;
  const finalSafeMaxX = finalMaxX - CITY_TRANSITION_SIZE;
  const finalSafeMinZ = finalMinZ + CITY_TRANSITION_SIZE;
  const finalSafeMaxZ = finalMaxZ - CITY_TRANSITION_SIZE;

  for (const p of state.placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;

    const pMinX = p.x - fp.halfX;
    const pMaxX = p.x + fp.halfX;
    const pMinZ = p.z - fp.halfZ;
    const pMaxZ = p.z + fp.halfZ;

    // 如果 footprint 超出安全区域，强制移动中心点
    if (pMinX < finalSafeMinX) {
      p.x = finalSafeMinX + fp.halfX + 2;
    }
    if (pMaxX > finalSafeMaxX) {
      p.x = finalSafeMaxX - fp.halfX - 2;
    }
    if (pMinZ < finalSafeMinZ) {
      p.z = finalSafeMinZ + fp.halfZ + 2;
    }
    if (pMaxZ > finalSafeMaxZ) {
      p.z = finalSafeMaxZ - fp.halfZ - 2;
    }
  }

  // ========== 第四步：放置门 ==========
  const cityBounds = {
    minX: finalMinX,
    maxX: finalMaxX,
    minZ: finalMinZ,
    maxZ: finalMaxZ
  };

  placeGates(state, seed, cityBounds);

  // ========== 第五步：生成 placementMap 和填充实体 ==========
  const placementMap = new Map();
  const placements = state.placements.map((p, idx) => {
    const withId = { ...p, id: `${p.type}_${idx}` };
    placementMap.set(`${withId.x},${withId.z}`, withId);
    return withId;
  });

  const fillerPlacements = buildCityFillerTanks(
    {
      centerX: cityCx,
      centerZ: cityCz,
      minX: finalMinX,
      maxX: finalMaxX,
      minZ: finalMinZ,
      maxZ: finalMaxZ,
      placements
    },
    seed
  );
  const fillerPlacementMap = new Map();
  for (const p of fillerPlacements) {
    fillerPlacementMap.set(`${p.x},${p.z}`, p);
  }

  return {
    centerX: cityCx,
    centerZ: cityCz,
    baseHeight,
    halfSize,
    minX: finalMinX,
    maxX: finalMaxX,
    minZ: finalMinZ,
    maxZ: finalMaxZ,
    placements,
    placementMap,
    fillerPlacements,
    fillerPlacementMap
  };
}

function getCityLayout(seed, terrainGen) {
  if (layoutCache.has(seed)) return layoutCache.get(seed);
  const layout = buildCityLayout(seed, terrainGen);
  layoutCache.set(seed, layout);
  return layout;
}

function getCityInfo(wx, wz, seed, terrainGen) {
  const layout = getCityLayout(seed, terrainGen);
  if (wx < layout.minX || wx > layout.maxX || wz < layout.minZ || wz > layout.maxZ) {
    return null;
  }

  const edgeDistance = Math.min(
    wx - layout.minX,
    layout.maxX - wx,
    wz - layout.minZ,
    layout.maxZ - wz
  );
  const transitionFactor = edgeDistance >= CITY_TRANSITION_SIZE
    ? 0
    : (CITY_TRANSITION_SIZE - edgeDistance) / CITY_TRANSITION_SIZE;

  return {
    ...layout,
    edgeDistance,
    transitionFactor,
    isTransition: transitionFactor > 0
  };
}

function isPointInCity(wx, wz, seed, terrainGen) {
  return getCityInfo(wx, wz, seed, terrainGen) !== null;
}

function getCityPlacementAt(wx, wz, seed, terrainGen) {
  const layout = getCityLayout(seed, terrainGen);
  return layout.placementMap.get(`${wx},${wz}`) || null;
}

function isPointNearCityStructure(wx, wz, seed, terrainGen, padding = 2) {
  const layout = getCityLayout(seed, terrainGen);
  for (const placement of layout.placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[placement.type];
    if (!fp) continue;
    const minX = placement.x - fp.halfX - padding;
    const maxX = placement.x + fp.halfX + padding;
    const minZ = placement.z - fp.halfZ - padding;
    const maxZ = placement.z + fp.halfZ + padding;
    if (wx >= minX && wx <= maxX && wz >= minZ && wz <= maxZ) {
      return true;
    }
  }
  return false;
}

function getCitySpawnPoint(seed, terrainGen) {
  const layout = getCityLayout(seed, terrainGen);
  return {
    x: layout.centerX,
    y: layout.baseHeight + 3,
    z: layout.centerZ,
    yaw: 0,
    pitch: 0
  };
}

function getCitySurfaceY(wx, wz, seed, terrainGen) {
  const cityInfo = getCityInfo(wx, wz, seed, terrainGen);
  if (!cityInfo) return null;

  // 使用低频、分块的宏观起伏，避免逐格抖动导致“碎石堆”观感
  const dx = wx - cityInfo.centerX;
  const dz = wz - cityInfo.centerZ;
  const dist = Math.max(Math.abs(dx), Math.abs(dz));
  const coreFlatRadius = Math.floor(cityInfo.halfSize * 0.35);
  const midRadius = Math.floor(cityInfo.halfSize * 0.75);

  let amplitude = 0;
  const ampMax = Math.min(2, CITY_GROUND_VARIANCE_MAX);
  if (dist > coreFlatRadius && dist <= midRadius) {
    amplitude = 1;
  } else if (dist > midRadius) {
    amplitude = ampMax;
  }

  // 12x12 粗采样，形成大块缓坡而不是密集锯齿
  const coarseX = Math.floor((wx + seed * 0.37) / 12);
  const coarseZ = Math.floor((wz - seed * 0.41) / 12);
  const macroA = Math.sin((coarseX + seed * 0.013) * 0.8);
  const macroB = Math.cos((coarseZ - seed * 0.017) * 0.75);
  const macroC = Math.sin((coarseX + coarseZ + seed * 0.011) * 0.5);
  const macro = macroA * 0.45 + macroB * 0.35 + macroC * 0.2;

  const variance = Math.round(macro * amplitude);
  return Math.max(CITY_MIN_SURFACE_Y, cityInfo.baseHeight + variance);
}

function generateCity(wx, wz, h, cityInfo, fakeChunk, dPlaceholder, seed, terrainGen) {
  const citySurfaceY = getCitySurfaceY(wx, wz, seed, terrainGen);
  let surfaceY = citySurfaceY;

  // 检测附近的地标（金字塔、FrozenMountain）用于平滑过渡
  const nearbyLandmark = detectNearbyLandmark(wx, wz, seed, terrainGen);

  if (cityInfo.isTransition) {
    // 边缘采用”阶梯过渡”：
    // 距边界每 3 格（宽台阶）才升/降 1 格，过渡更缓，不会形成 45 度斜坡
    const naturalBiome = getBaseBiome(wx, wz);
    const naturalH = terrainGen.generateHeight(wx, wz, naturalBiome);

    // 如果有附近的地标，使用地标高度作为目标进行平滑
    let targetHeight = citySurfaceY;
    let blendFactor = 0;

    if (nearbyLandmark) {
      // 计算到地标的距离因子（0-1，越近越接近地标高度）
      const distFactor = Math.max(0, Math.min(1, nearbyLandmark.distance / nearbyLandmark.maxDistance));
      // 在 City 边缘且靠近地标时，向地标高度混合
      targetHeight = nearbyLandmark.height;
      blendFactor = (1 - distFactor) * cityInfo.transitionFactor;
    }

    const delta = targetHeight - naturalH;
    const terraceNoise = Math.sin((wx + seed * 0.23) * 0.08) + Math.cos((wz - seed * 0.29) * 0.075);
    const terraceBias = terraceNoise > 0.75 ? 1 : (terraceNoise < -0.75 ? -1 : 0);
    const effectiveEdgeDistance = cityInfo.edgeDistance <= 0
      ? 0
      : Math.max(0, cityInfo.edgeDistance + terraceBias);
    const maxDelta = Math.max(0, Math.floor(effectiveEdgeDistance / CITY_TERRACE_WIDTH));

    let clampedDelta;
    if (nearbyLandmark && blendFactor > 0) {
      // 向地标高度平滑过渡，限制每步变化不超过 2 格
      const rawDelta = targetHeight - naturalH;
      const maxStep = 2;
      clampedDelta = Math.max(-maxStep, Math.min(maxStep, rawDelta));
      // 进一步根据 blendFactor 混合
      const naturalDelta = Math.max(-maxDelta, Math.min(maxDelta, citySurfaceY - naturalH));
      clampedDelta = naturalDelta * (1 - blendFactor) + clampedDelta * blendFactor;
    } else {
      clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
    }

    surfaceY = naturalH + Math.round(clampedDelta);

    // 防止边界形成 1 格窄沟：过渡地表不低于 City 与自然地表中的较低值
    surfaceY = Math.max(surfaceY, Math.min(citySurfaceY, naturalH));

    // 如果有地标，确保不会形成过高悬崖（限制与地标高度差不超过 3 格）
    if (nearbyLandmark) {
      const heightDiff = surfaceY - nearbyLandmark.height;
      if (Math.abs(heightDiff) > 3) {
        surfaceY = nearbyLandmark.height + Math.sign(heightDiff) * 3;
      }
    }
  }

  // City 群系地表强制高于海平面
  surfaceY = Math.max(CITY_MIN_SURFACE_Y, surfaceY);

  const fillStartY = Math.min(h, surfaceY);
  const fillEndY = surfaceY;

  const patch = Math.sin((wx + seed * 0.31) * 0.09) + Math.cos((wz - seed * 0.27) * 0.08);
  const patch2 = Math.sin((wx + wz + seed * 0.73) * 0.037);
  const surfaceType = patch + patch2 > 0 ? 'sand' : 'clay';
  const subType = surfaceType === 'sand' ? 'sand' : 'clay';

  for (let y = fillStartY; y <= fillEndY; y++) {
    fakeChunk.add(wx, y, wz, y === fillEndY ? surfaceType : subType, dPlaceholder);
  }

  const rockBaseY = surfaceY;
  for (let k = 1; k <= 11; k++) {
    const rockY = rockBaseY - k;
    if (k === 11) {
      fakeChunk.add(wx, rockY, wz, 'end_stone', dPlaceholder);
    } else {
      // City 区域（含过渡带）地下尽量延续沙/黏土，不使用碎石/石头，避免边缘裸露”碎石块”
      fakeChunk.add(wx, rockY, wz, subType, dPlaceholder);
    }
  }
  fakeChunk.add(wx, rockBaseY - 12, wz, 'end_stone', dPlaceholder);

  return { surfaceY };
}

/**
 * 检测附近是否存在金字塔或 FrozenMountain 等地标
 * 返回地标信息用于平滑过渡
 */
function detectNearbyLandmark(wx, wz, _seed, terrainGen) {
  // 使用确定性方法检测附近地标，避免异步导入问题
  // 基于 RegionMapConfig 中的偏移量计算地标中心位置

  const regionSize = REGION_SIZE;
  const regionX = Math.floor(wx / regionSize);
  const regionZ = Math.floor(wz / regionSize);

  // 获取金字塔中心（相对于区域）
  const pyramidOffsetX = LANDMARK_OFFSET.FROZEN_MOUNTAIN_X + 160; // 金字塔在 FrozenMountain 东侧 160
  const pyramidOffsetZ = LANDMARK_OFFSET.FROZEN_MOUNTAIN_Z;

  // 获取区域中心
  const regionCenterX = regionX * regionSize + regionSize / 2;
  const regionCenterZ = regionZ * regionSize + regionSize / 2;

  // 计算金字塔中心（近似）
  const pyramidCx = regionCenterX + pyramidOffsetX;
  const pyramidCz = regionCenterZ + pyramidOffsetZ;

  // 计算 FrozenMountain 中心（近似）
  const fmCx = regionCenterX + LANDMARK_OFFSET.FROZEN_MOUNTAIN_X;
  const fmCz = regionCenterZ + LANDMARK_OFFSET.FROZEN_MOUNTAIN_Z;

  // 计算到各地标的距离
  const distToPyramid = Math.sqrt((wx - pyramidCx) ** 2 + (wz - pyramidCz) ** 2);
  const distToFM = Math.sqrt((wx - fmCx) ** 2 + (wz - fmCz) ** 2);

  // 金字塔参数
  const PYRAMID_SIZE = 40;
  const PYRAMID_HALF_SIZE = PYRAMID_SIZE / 2;
  const PYRAMID_TRANSITION_SIZE = 8;
  const PYRAMID_TOTAL_HALF = PYRAMID_HALF_SIZE + PYRAMID_TRANSITION_SIZE;

  // FrozenMountain 参数
  const FM_SIZE = 80;
  const FM_HALF_SIZE = FM_SIZE / 2;
  const FM_TRANSITION_SIZE = 8;
  const FM_TOTAL_HALF = FM_HALF_SIZE + FM_TRANSITION_SIZE;

  // 检测是否在金字塔影响范围内
  const inPyramidRange = distToPyramid <= PYRAMID_TOTAL_HALF + 32; // 额外 32 格缓冲
  const inFMRange = distToFM <= FM_TOTAL_HALF + 32;

  if (!inPyramidRange && !inFMRange) {
    return null;
  }

  // 计算金字塔高度
  if (inPyramidRange) {
    const pyramidDist = Math.max(Math.abs(wx - pyramidCx), Math.abs(wz - pyramidCz));
    if (pyramidDist <= PYRAMID_TOTAL_HALF) {
      // 金字塔高度计算：每 2 格水平距离下降 1 格
      const layerHeight = Math.floor((PYRAMID_HALF_SIZE - pyramidDist) / 2);
      if (layerHeight > 0) {
        const pyramidBiome = terrainGen.getBiome(pyramidCx, pyramidCz);
        const pyramidBaseHeight = terrainGen.generateHeight(pyramidCx, pyramidCz, pyramidBiome);
        const pyramidHeight = pyramidBaseHeight + layerHeight;
        return {
          type: 'pyramid',
          height: pyramidHeight,
          distance: Math.max(0, pyramidDist - PYRAMID_HALF_SIZE),
          maxDistance: PYRAMID_TRANSITION_SIZE + 32
        };
      }
    }
  }

  // 计算 FrozenMountain 高度
  if (inFMRange) {
    const fmDx = wx - fmCx;
    const fmDz = wz - fmCz;
    const fmDist = Math.sqrt(fmDx * fmDx + fmDz * fmDz);

    if (fmDist <= FM_TOTAL_HALF) {
      // FrozenMountain 高度计算（简化版）
      const fmBiome = terrainGen.getBiome(fmCx, fmCz);
      const fmBaseHeight = terrainGen.generateHeight(fmCx, fmCz, fmBiome);

      // 如果在主体区域内，计算山峰高度
      if (fmDist <= FM_HALF_SIZE) {
        const summitHeight = (FM_HALF_SIZE - 10) / 1.3;
        const slopeT = fmDist / FM_HALF_SIZE;
        const profile = 1 - Math.pow(slopeT, 1.4);
        const layerHeight = Math.max(0, Math.floor(summitHeight * profile));
        return {
          type: 'frozenMountain',
          height: fmBaseHeight + layerHeight,
          distance: Math.max(0, fmDist - FM_HALF_SIZE * 0.7),
          maxDistance: FM_TRANSITION_SIZE + FM_HALF_SIZE * 0.3 + 32
        };
      } else {
        // 在过渡带内，返回基础高度
        return {
          type: 'frozenMountain',
          height: fmBaseHeight,
          distance: fmDist - FM_HALF_SIZE,
          maxDistance: FM_TRANSITION_SIZE + 32
        };
      }
    }
  }

  return null;
}

export const CityMap = {
  getCityLayout,
  getCityInfo,
  getCityPlacementAt,
  isPointNearCityStructure,
  getCitySpawnPoint,
  getCitySurfaceY,
  isPointInCity,
  generate: generateCity
};

export function getCityLayoutBySeed(seed, terrainGen) {
  return getCityLayout(seed, terrainGen);
}

export function getCityInfoAt(wx, wz, seed, terrainGen) {
  return getCityInfo(wx, wz, seed, terrainGen);
}
