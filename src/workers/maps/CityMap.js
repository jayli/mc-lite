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

const CITY_REGION_X = 0;
const CITY_REGION_Z = 0;
const CITY_GROUND_VARIANCE_MAX = 3;
const CITY_TRANSITION_SIZE = 32;
const CITY_TERRACE_WIDTH = 3;
const CITY_AREA_SHRINK_SCALE = 0.82; // 面积约缩减 1/3（边长乘 sqrt(2/3)）
const CITY_MIN_SURFACE_Y = ISLAND_SEA_LEVEL + 1;
const CITY_INNER_SAFE_MARGIN = CITY_TRANSITION_SIZE + 8; // 建筑群与边缘的最小内侧缓冲
const CITY_EDGE_BUFFER_MIN = CITY_TRANSITION_SIZE + 1; // 所有主建筑必须位于过渡带内侧

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
  { type: 'whiteTower', countRange: [2, 3] },
  { type: 'bigHouse', count: 2 },
  { type: 'boxHouse', count: 2 },
  { type: 'desertVillage', countRange: [2, 3] },
  { type: 'doubleTower', count: 1 },
  { type: 'pyramidIsland', count: 1 },
  { type: 'smallHouse', count: 2 },
  { type: 'tower', count: 1 },
  { type: 'treeHouse', count: 2 },
  { type: 'uglyHouse', count: 2 },
  { type: 'woodHouse', count: 1 }
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

function isPlacementValid(candidate, existing, seed) {
  const fpA = CITY_STRUCTURE_FOOTPRINT[candidate.type];
  if (!fpA) return false;

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

function scorePlacement(candidate, existing) {
  if (existing.length === 0) return 1e6;
  let minCenterDistSq = Infinity;
  for (const p of existing) {
    const dx = candidate.x - p.x;
    const dz = candidate.z - p.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < minCenterDistSq) minCenterDistSq = distSq;
  }
  const centerDistSq = candidate.localX * candidate.localX + candidate.localZ * candidate.localZ;
  return minCenterDistSq - centerDistSq * 0.08;
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

function placeType(state, type, count, seed, minR, maxR) {
  for (let k = 0; k < count; k++) {
    const index = state.placements.length;
    const salt = index + k * 17 + type.length * 13;
    const candidates = buildCandidates(state.cityCx, state.cityCz, minR, maxR, seed, salt);
    let best = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      const candidate = { ...c, type, index };
      if (!isPlacementValid(candidate, state.placements, seed)) continue;
      const score = scorePlacement(candidate, state.placements);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (!best) {
      // 二次扩圈，避免布局失败
      const fallbackCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 6, maxR + 28, seed, salt + 29);
      for (const c of fallbackCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) {
      // 三次兜底：大范围搜索，防止只剩中心城堡
      const emergencyCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 18, maxR + 96, seed, salt + 53);
      for (const c of emergencyCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) {
      // 四次兜底：继续扩圈，但仍使用统一间距规则（不放宽，不强塞）
      const lastCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 96, maxR + 180, seed, salt + 71);
      for (const c of lastCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) {
      // 最终兜底：极大范围严格搜索，确保配额不丢失
      const hardCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 180, maxR + 420, seed, salt + 97);
      for (const c of hardCandidates) {
        const candidate = { ...c, type, index };
        if (!isPlacementValid(candidate, state.placements, seed)) continue;
        best = candidate;
        break;
      }
    }

    if (!best) continue;
    state.placements.push(best);
  }
}

function computeBounds(placements, cityCx, cityCz) {
  let minX = cityCx;
  let maxX = cityCx;
  let minZ = cityCz;
  let maxZ = cityCz;

  for (const p of placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;
    minX = Math.min(minX, p.x - fp.halfX);
    maxX = Math.max(maxX, p.x + fp.halfX);
    minZ = Math.min(minZ, p.z - fp.halfZ);
    maxZ = Math.max(maxZ, p.z + fp.halfZ);
  }

  return { minX, maxX, minZ, maxZ };
}

function placeGates(state, seed, cityBounds) {
  const gateCount = 2;
  const gates = [];
  const fp = CITY_STRUCTURE_FOOTPRINT.gate;
  const gateInset = Math.max(2, Math.floor(CITY_TRANSITION_SIZE * 0.35));
  const innerMinX = cityBounds.minX + gateInset + fp.halfX;
  const innerMaxX = cityBounds.maxX - gateInset - fp.halfX;
  const northZ = cityBounds.minZ + gateInset + fp.halfZ;
  const southZ = cityBounds.maxZ - gateInset - fp.halfZ;

  const sideConfigs = [
    { side: 'north', preferredZ: northZ, zStep: 1, zDir: 1 },
    { side: 'south', preferredZ: southZ, zStep: 1, zDir: -1 }
  ];

  for (let i = 0; i < gateCount; i++) {
    const cfg = sideConfigs[i];
    let placed = null;
    const zBand = Math.max(4, Math.floor(CITY_TRANSITION_SIZE * 0.6));

    // 阶段1：优先在贴边内侧带搜索
    for (let dz = 0; dz <= zBand; dz += cfg.zStep) {
      const candidateZ = cfg.preferredZ + dz * cfg.zDir;
      for (let scanX = innerMinX; scanX <= innerMaxX; scanX += 2) {
        const candidate = {
          type: 'gate',
          x: scanX,
          z: candidateZ,
          localX: scanX - state.cityCx,
          localZ: candidateZ - state.cityCz,
          index: state.placements.length + i
        };
        if (!isPlacementValid(candidate, state.placements, seed)) continue;
        placed = candidate;
        break;
      }
      if (placed) break;
    }

    // 阶段2：仍然找不到则扩大 x 扫描密度（保持当前侧）
    if (!placed) {
      for (let dz = 0; dz <= zBand + 10; dz += cfg.zStep) {
        const candidateZ = cfg.preferredZ + dz * cfg.zDir;
        for (let scanX = innerMinX; scanX <= innerMaxX; scanX += 1) {
          const candidate = {
            type: 'gate',
            x: scanX,
            z: candidateZ,
            localX: scanX - state.cityCx,
            localZ: candidateZ - state.cityCz,
            index: state.placements.length + i
          };
          if (!isPlacementValid(candidate, state.placements, seed)) continue;
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

  const state = {
    cityCx,
    cityCz,
    placements: []
  };

  state.placements.push({
    type: 'castle',
    x: cityCx,
    z: cityCz,
    localX: 0,
    localZ: 0,
    index: 0
  });

  let salt = 1;
  for (const config of CITY_STRUCTURE_CONFIGS) {
    if (config.fixedCenter) continue;
    const count = getCountByConfig(config, seed, salt++);
    if (count <= 0) continue;
    // 仍然偏向中心，但必须留出足够空间承载完整建筑配额
    const minR = config.type === 'whiteTower' ? 18 : 12;
    const maxR = config.type === 'whiteTower' ? 56 : 62;
    placeType(state, config.type, count, seed, minR, maxR);
  }
  const preGateBounds = computeBounds(state.placements, cityCx, cityCz);
  const width = preGateBounds.maxX - preGateBounds.minX + 1;
  const depth = preGateBounds.maxZ - preGateBounds.minZ + 1;
  const maxSize = Math.max(width, depth);
  const targetSize = Math.floor((maxSize + 24) * CITY_AREA_SHRINK_SCALE);
  const minRequiredBySafeMargin = maxSize + CITY_INNER_SAFE_MARGIN * 2;

  let requiredHalfByEdgeBuffer = 0;
  for (const p of state.placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;
    const reqHalfX = Math.abs(p.x - cityCx) + fp.halfX + CITY_EDGE_BUFFER_MIN;
    const reqHalfZ = Math.abs(p.z - cityCz) + fp.halfZ + CITY_EDGE_BUFFER_MIN;
    requiredHalfByEdgeBuffer = Math.max(requiredHalfByEdgeBuffer, reqHalfX, reqHalfZ);
  }

  const baseHalf = Math.floor(Math.max(CITY_SIZE_MIN, Math.min(CITY_SIZE_MAX, Math.max(targetSize, minRequiredBySafeMargin))) / 2);
  const halfSize = Math.max(baseHalf, Math.ceil(requiredHalfByEdgeBuffer));

  const finalMinX = cityCx - halfSize;
  const finalMaxX = cityCx + halfSize;
  const finalMinZ = cityCz - halfSize;
  const finalMaxZ = cityCz + halfSize;
  placeGates(state, seed, {
    minX: finalMinX,
    maxX: finalMaxX,
    minZ: finalMinZ,
    maxZ: finalMaxZ
  });

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

  if (cityInfo.isTransition) {
    // 边缘采用“阶梯过渡”：
    // 距边界每 3 格（宽台阶）才升/降 1 格，过渡更缓，不会形成 45 度斜坡
    const naturalBiome = getBaseBiome(wx, wz);
    const naturalH = terrainGen.generateHeight(wx, wz, naturalBiome);
    const delta = citySurfaceY - naturalH;
    const terraceNoise = Math.sin((wx + seed * 0.23) * 0.08) + Math.cos((wz - seed * 0.29) * 0.075);
    const terraceBias = terraceNoise > 0.75 ? 1 : (terraceNoise < -0.75 ? -1 : 0);
    const effectiveEdgeDistance = cityInfo.edgeDistance <= 0
      ? 0
      : Math.max(0, cityInfo.edgeDistance + terraceBias);
    const maxDelta = Math.max(0, Math.floor(effectiveEdgeDistance / CITY_TERRACE_WIDTH));
    const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
    surfaceY = naturalH + clampedDelta;

    // 防止边界形成 1 格窄沟：过渡地表不低于 City 与自然地表中的较低值
    surfaceY = Math.max(surfaceY, Math.min(citySurfaceY, naturalH));
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
      // City 区域（含过渡带）地下尽量延续沙/黏土，不使用碎石/石头，避免边缘裸露“碎石块”
      fakeChunk.add(wx, rockY, wz, subType, dPlaceholder);
    }
  }
  fakeChunk.add(wx, rockBaseY - 12, wz, 'end_stone', dPlaceholder);

  return { surfaceY };
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
