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
  CITY_SIZE_MAX,
  CITY_TRANSITION_SIZE,
  CITY_TERRACE_WIDTH,
  CITY_CORE_BUILD_MARGIN,
  CITY_GROUND_VARIANCE_MAX,
  CITY_REGION,
  CITY_STRUCTURE_FOOTPRINT,
  CITY_STRUCTURE_CONFIGS,
  CITY_PLACEMENT
} from '../../constants/RegionMapConfig.js';
import {
  hash01,
  getStructureCount,
  getGapRequirement,
  getStructureBounds,
  isPointInBounds,
  isNearPlacement,
  buildCandidates,
  scoreDirectionalBalance
} from '../../utils/CityPlacementUtils.js';

const CITY_MIN_SURFACE_Y = ISLAND_SEA_LEVEL + 1;

const layoutCache = new Map();

function getCityCenter(seed) {
  const { centerX: pyramidCx, centerZ: pyramidCz } = getRegionSeededCenter(
    CITY_REGION.X,
    CITY_REGION.Z,
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
    CITY_REGION.X,
    CITY_REGION.Z,
    cityCx,
    cityCz,
    minMargin,
    { regionSize: REGION_SIZE }
  );

  return { cityCx: clamped.cx, cityCz: clamped.cz };
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
  const { BASE_HEIGHT_SEED, BASE_HEIGHT_OFFSET_X, BASE_HEIGHT_OFFSET_Z } = CITY_PLACEMENT;
  const stableOffset = Math.floor(hash01(seed * BASE_HEIGHT_SEED + centerX * BASE_HEIGHT_OFFSET_X + centerZ * BASE_HEIGHT_OFFSET_Z) * 2);
  return Math.max(CITY_MIN_SURFACE_Y, avg + stableOffset);
}

function isPlacementValid(candidate, existing, seed, bounds = null, requireTransitionZone = true) {
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

function findPlacementWithFallback(state, type, index, k, seed, minR, maxR, bounds) {
  const salt = index + k * 17 + type.length * 13;

  // 阶段 1: 正常放置（要求完全在过渡带内）
  const candidates = buildCandidates(state.cityCx, state.cityCz, minR, maxR, seed, salt);
  const { TARGET_SPACING_BASE, TARGET_SPACING_DIVISOR } = CITY_PLACEMENT;
  const targetSpacing = Math.max(TARGET_SPACING_BASE, (minR + maxR) / TARGET_SPACING_DIVISOR);

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const candidate = { ...c, type, index };
    if (!isPlacementValid(candidate, state.placements, seed, bounds, true)) continue;
    const score = scoreDirectionalBalance(candidate, state.placements, targetSpacing);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best) return best;

  // 阶段 2-5: 扩圈搜索（放宽边界要求）
  const expansions = [
    { min: maxR + CITY_PLACEMENT.FALLBACK_RING_EXPAND_1, max: maxR + CITY_PLACEMENT.FALLBACK_RING_EXPAND_2, saltAdd: 29 },
    { min: maxR + CITY_PLACEMENT.FALLBACK_RING_EXPAND_3, max: maxR + CITY_PLACEMENT.FALLBACK_RING_EXPAND_4, saltAdd: 53 },
    { min: maxR + CITY_PLACEMENT.FALLBACK_RING_EXPAND_4, max: maxR + 180, saltAdd: 71 },
    { min: maxR + 180, max: maxR + 420, saltAdd: 97 }
  ];

  for (const exp of expansions) {
    const expCandidates = buildCandidates(state.cityCx, state.cityCz, exp.min, exp.max, seed, salt + exp.saltAdd);
    for (const c of expCandidates) {
      const candidate = { ...c, type, index };
      if (isPlacementValid(candidate, state.placements, seed, bounds, false)) {
        return candidate;
      }
    }
  }

  return null;
}

function findForcedPlacement(state, type, index, k, seed, maxR, gap) {
  const salt = index + k * 17 + type.length * 13;
  const fpA = CITY_STRUCTURE_FOOTPRINT[type];
  if (!fpA) return null;

  const candidates = buildCandidates(state.cityCx, state.cityCz, 10, maxR + 200, seed, salt + 137);
  for (const c of candidates) {
    const candidate = { ...c, type, index };
    let tooClose = false;
    for (let i = 0; i < state.placements.length; i++) {
      const p = state.placements[i];
      const fpB = CITY_STRUCTURE_FOOTPRINT[p.type];
      if (!fpB) continue;
      const dx = Math.abs(candidate.x - p.x);
      const dz = Math.abs(candidate.z - p.z);
      if (dx <= fpA.halfX + fpB.halfX + gap && dz <= fpA.halfZ + fpB.halfZ + gap) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) return candidate;
  }
  return null;
}

function placeType(state, type, count, seed, minR, maxR, bounds = null) {
  let placed = 0;
  for (let k = 0; k < count; k++) {
    const index = state.placements.length;
    let best = findPlacementWithFallback(state, type, index, k, seed, minR, maxR, bounds);

    // 阶段 6: 强制放置（间距缩小）
    if (!best) {
      best = findForcedPlacement(state, type, index, k, seed, maxR, CITY_PLACEMENT.FORCED_GAP_STRICT);
    }

    // 阶段 7: 终极强制（间距 5）
    if (!best) {
      best = findForcedPlacement(state, type, index, k, seed, maxR + 100, CITY_PLACEMENT.FORCED_GAP_LOOSE);
    }

    // 阶段 8: 绝对强制（只检查不重叠）
    if (!best) {
      best = findForcedPlacement(state, type, index, k, seed, maxR + 300, CITY_PLACEMENT.FORCED_GAP_MINIMAL);
    }

    // 阶段 9: 随机位置
    if (!best) {
      const salt = index + k * 17 + type.length * 13;
      const randomCandidates = buildCandidates(state.cityCx, state.cityCz, maxR + 100, maxR + 600, seed, salt + 317);
      if (randomCandidates.length > 0) {
        best = { ...randomCandidates[0], type, index };
      }
    }

    // 阶段 10: 强制随机位置
    if (!best) {
      const salt = index + k * 17 + type.length * 13;
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
  const { GATE_COUNT } = CITY_PLACEMENT;
  const gates = [];
  const fp = CITY_STRUCTURE_FOOTPRINT.gate;

  const innerMinX = cityBounds.minX + CITY_TRANSITION_SIZE + fp.halfX;
  const innerMaxX = cityBounds.maxX - CITY_TRANSITION_SIZE - fp.halfX;
  const northZ = cityBounds.minZ + CITY_TRANSITION_SIZE + fp.halfZ;
  const southZ = cityBounds.maxZ - CITY_TRANSITION_SIZE - fp.halfZ;

  const sideConfigs = [
    { side: 'north', preferredZ: northZ, zDir: 1 },
    { side: 'south', preferredZ: southZ, zDir: -1 }
  ];

  for (let i = 0; i < GATE_COUNT; i++) {
    const cfg = sideConfigs[i];
    let placed = tryPlaceGate(state, cfg, cityBounds, innerMinX, innerMaxX, fp, i);

    if (!placed) {
      placed = tryPlaceGateFallback(state, cfg, cityBounds, innerMinX, innerMaxX, fp, i);
    }

    if (placed) gates.push(placed);
  }

  for (const g of gates) {
    state.placements.push(g);
  }
}

function tryPlaceGate(state, cfg, cityBounds, innerMinX, innerMaxX, fp, index) {
  const { GATE_Z_OFFSET_MAX, GATE_X_SCAN_STEP } = CITY_PLACEMENT;

  for (let offset = 0; offset <= GATE_Z_OFFSET_MAX; offset++) {
    const candidateZ = cfg.preferredZ + offset * cfg.zDir;

    if (candidateZ - fp.halfZ < cityBounds.minZ ||
        candidateZ + fp.halfZ > cityBounds.maxZ) {
      continue;
    }

    const centerX = state.cityCx;
    const xRange = Math.floor((innerMaxX - innerMinX) / 2);

    for (let xOffset = 0; xOffset <= xRange; xOffset += GATE_X_SCAN_STEP) {
      const scanPositions = xOffset === 0 ? [centerX] : [centerX + xOffset, centerX - xOffset];

      for (const scanX of scanPositions) {
        const safeScanX = Math.max(innerMinX, Math.min(innerMaxX, scanX));

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
          index: state.placements.length + index
        };

        if (isGatePlacementValid(candidate, state.placements, fp)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function tryPlaceGateFallback(state, cfg, cityBounds, innerMinX, innerMaxX, fp, index) {
  for (let offset = 0; offset <= 25; offset++) {
    const candidateZ = cfg.preferredZ + offset * cfg.zDir;

    if (candidateZ - fp.halfZ < cityBounds.minZ ||
        candidateZ + fp.halfZ > cityBounds.maxZ) {
      continue;
    }

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
        index: state.placements.length + index
      };

      if (isGatePlacementValid(candidate, state.placements, fp)) {
        return candidate;
      }
    }
  }
  return null;
}

function isGatePlacementValid(candidate, placements, fp) {
  for (const p of placements) {
    const pFp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!pFp) continue;
    const dx = Math.abs(candidate.x - p.x);
    const dz = Math.abs(candidate.z - p.z);
    const gap = Math.max(fp.minGap, pFp.minGap, 10);
    const minDistanceX = fp.halfX + pFp.halfX + gap;
    const minDistanceZ = fp.halfZ + pFp.halfZ + gap;
    if (dx < minDistanceX && dz < minDistanceZ) {
      return false;
    }
  }
  return true;
}

function buildCityFillerTanks(layout, seed) {
  const tanks = [];
  const { FILLER_TANK_HALF_SIZE, FILLER_TANK_COUNT, FILLER_TANK_MIN_GAP, FILLER_TANK_ATTEMPTS, FILLER_TANK_BUILDING_PADDING } = CITY_PLACEMENT;

  const minX = layout.minX + CITY_TRANSITION_SIZE + FILLER_TANK_HALF_SIZE + 2;
  const maxX = layout.maxX - CITY_TRANSITION_SIZE - FILLER_TANK_HALF_SIZE - 2;
  const minZ = layout.minZ + CITY_TRANSITION_SIZE + FILLER_TANK_HALF_SIZE + 2;
  const maxZ = layout.maxZ - CITY_TRANSITION_SIZE - FILLER_TANK_HALF_SIZE - 2;

  if (minX > maxX || minZ > maxZ) return tanks;

  const rangeX = Math.max(1, maxX - minX + 1);
  const rangeZ = Math.max(1, maxZ - minZ + 1);

  for (let i = 0; i < FILLER_TANK_COUNT; i++) {
    for (let attempt = 0; attempt < FILLER_TANK_ATTEMPTS; attempt++) {
      const rx = Math.floor(hash01(seed * 1.91 + i * 13.7 + attempt * 0.73) * rangeX);
      const rz = Math.floor(hash01(seed * 2.03 + i * 17.1 + attempt * 0.67) * rangeZ);
      const x = minX + rx;
      const z = minZ + rz;

      if (isNearPlacement(layout.placements, x, z, FILLER_TANK_BUILDING_PADDING)) continue;
      const nearOtherTank = tanks.some(t => Math.max(Math.abs(t.x - x), Math.abs(t.z - z)) < FILLER_TANK_MIN_GAP);
      if (nearOtherTank) continue;

      tanks.push({ type: 'tank', x, z, id: `tank_fill_${i}` });
      break;
    }
  }

  return tanks;
}

function calculateCityBoundsFromPlacements(placements, cityCx, cityCz) {
  let buildMinX = cityCx;
  let buildMaxX = cityCx;
  let buildMinZ = cityCz;
  let buildMaxZ = cityCz;

  for (const p of placements) {
    if (p.type === 'gate') continue;
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;
    buildMinX = Math.min(buildMinX, p.x - fp.halfX);
    buildMaxX = Math.max(buildMaxX, p.x + fp.halfX);
    buildMinZ = Math.min(buildMinZ, p.z - fp.halfZ);
    buildMaxZ = Math.max(buildMaxZ, p.z + fp.halfZ);
  }

  const requiredMinX = buildMinX - CITY_CORE_BUILD_MARGIN - CITY_TRANSITION_SIZE;
  const requiredMaxX = buildMaxX + CITY_CORE_BUILD_MARGIN + CITY_TRANSITION_SIZE;
  const requiredMinZ = buildMinZ - CITY_CORE_BUILD_MARGIN - CITY_TRANSITION_SIZE;
  const requiredMaxZ = buildMaxZ + CITY_CORE_BUILD_MARGIN + CITY_TRANSITION_SIZE;

  const requiredHalfX = Math.max(Math.abs(requiredMaxX - cityCx), Math.abs(cityCx - requiredMinX));
  const requiredHalfZ = Math.max(Math.abs(requiredMaxZ - cityCz), Math.abs(cityCz - requiredMinZ));
  const requiredHalfSize = Math.max(requiredHalfX, requiredHalfZ);
  const minHalfSize = Math.floor(CITY_SIZE_MIN / 2);
  const cityMaxHalfSize = Math.floor(CITY_SIZE_MAX / 2);
  const halfSize = Math.max(minHalfSize, Math.min(cityMaxHalfSize, requiredHalfSize));

  return {
    minX: cityCx - halfSize,
    maxX: cityCx + halfSize,
    minZ: cityCz - halfSize,
    maxZ: cityCz + halfSize,
    halfSize
  };
}

function expandBoundsIfNeeded(placements, bounds, cityCx, cityCz) {
  let { minX, maxX, minZ, maxZ } = bounds;
  const safeMinX = minX + CITY_TRANSITION_SIZE;
  const safeMaxX = maxX - CITY_TRANSITION_SIZE;
  const safeMinZ = minZ + CITY_TRANSITION_SIZE;
  const safeMaxZ = maxZ - CITY_TRANSITION_SIZE;

  let needExpand = false;
  for (const p of placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;

    const pMinX = p.x - fp.halfX;
    const pMaxX = p.x + fp.halfX;
    const pMinZ = p.z - fp.halfZ;
    const pMaxZ = p.z + fp.halfZ;

    if (pMinX < safeMinX || pMaxX > safeMaxX || pMinZ < safeMinZ || pMaxZ > safeMaxZ) {
      needExpand = true;
      if (pMinX < safeMinX) minX -= (safeMinX - pMinX) + 2;
      if (pMaxX > safeMaxX) maxX += (pMaxX - safeMaxX) + 2;
      if (pMinZ < safeMinZ) minZ -= (safeMinZ - pMinZ) + 2;
      if (pMaxZ > safeMaxZ) maxZ += (pMaxZ - safeMaxZ) + 2;
    }
  }

  if (needExpand) {
    const maxSize = Math.max(maxX - minX, maxZ - minZ);
    return {
      minX: cityCx - Math.floor(maxSize / 2),
      maxX: cityCx + Math.floor(maxSize / 2),
      minZ: cityCz - Math.floor(maxSize / 2),
      maxZ: cityCz + Math.floor(maxSize / 2),
      halfSize: Math.floor(maxSize / 2)
    };
  }

  return bounds;
}

function clampPlacementsToBounds(placements, bounds) {
  const safeMinX = bounds.minX + CITY_TRANSITION_SIZE;
  const safeMaxX = bounds.maxX - CITY_TRANSITION_SIZE;
  const safeMinZ = bounds.minZ + CITY_TRANSITION_SIZE;
  const safeMaxZ = bounds.maxZ - CITY_TRANSITION_SIZE;

  for (const p of placements) {
    const fp = CITY_STRUCTURE_FOOTPRINT[p.type];
    if (!fp) continue;

    const pMinX = p.x - fp.halfX;
    const pMaxX = p.x + fp.halfX;
    const pMinZ = p.z - fp.halfZ;
    const pMaxZ = p.z + fp.halfZ;

    if (pMinX < safeMinX) p.x = safeMinX + fp.halfX + 2;
    if (pMaxX > safeMaxX) p.x = safeMaxX - fp.halfX - 2;
    if (pMinZ < safeMinZ) p.z = safeMinZ + fp.halfZ + 2;
    if (pMaxZ > safeMaxZ) p.z = safeMaxZ - fp.halfZ - 2;
  }
}

function buildCityLayout(seed, terrainGen) {
  const { cityCx, cityCz } = getCityCenter(seed);
  const baseHeight = estimateCityBaseHeight(cityCx, cityCz, seed, terrainGen);

  // 第一步：放置所有建筑
  const state = { cityCx, cityCz, placements: [] };
  const globalMaxHalfSize = Math.floor(CITY_SIZE_MAX / 2);
  const maxBounds = {
    minX: cityCx - globalMaxHalfSize,
    maxX: cityCx + globalMaxHalfSize,
    minZ: cityCz - globalMaxHalfSize,
    maxZ: cityCz + globalMaxHalfSize
  };

  state.placements.push({ type: 'castle', x: cityCx, z: cityCz, localX: 0, localZ: 0, index: 0 });

  let salt = 1;
  for (const config of CITY_STRUCTURE_CONFIGS) {
    if (config.fixedCenter) continue;
    const count = getStructureCount(config, seed, salt++);
    if (count <= 0) continue;

    const isLarge = config.type === 'whiteTower' || config.type === 'pyramidIsland';
    const minR = isLarge ? CITY_PLACEMENT.LARGE_STRUCT_MIN_RADIUS : CITY_PLACEMENT.NORMAL_STRUCT_MIN_RADIUS;
    const maxR = isLarge ? CITY_PLACEMENT.LARGE_STRUCT_MAX_RADIUS : CITY_PLACEMENT.NORMAL_STRUCT_MAX_RADIUS;

    const placed = placeType(state, config.type, count, seed, minR, maxR, maxBounds);
    if (placed < count) {
      console.warn(`CityMap: ${config.type} 只放置了 ${placed}/${count} 个`);
    }
  }

  // 第二步：计算 City 边界
  let bounds = calculateCityBoundsFromPlacements(state.placements, cityCx, cityCz);

  // 第三步：验证并扩展边界
  bounds = expandBoundsIfNeeded(state.placements, bounds, cityCx, cityCz);

  // 第四步：强制移动越界建筑
  clampPlacementsToBounds(state.placements, bounds);

  // 第五步：放置门
  placeGates(state, seed, bounds);

  // 第六步：生成 placementMap 和填充实体
  const placementMap = new Map();
  const placements = state.placements.map((p, idx) => {
    const withId = { ...p, id: `${p.type}_${idx}` };
    placementMap.set(`${withId.x},${withId.z}`, withId);
    return withId;
  });

  const fillerPlacements = buildCityFillerTanks(
    { centerX: cityCx, centerZ: cityCz, ...bounds, placements },
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
    halfSize: bounds.halfSize,
    minX: bounds.minX,
    maxX: bounds.maxX,
    minZ: bounds.minZ,
    maxZ: bounds.maxZ,
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

  const nearbyLandmark = detectNearbyLandmark(wx, wz, seed, terrainGen);

  if (cityInfo.isTransition) {
    const naturalBiome = getBaseBiome(wx, wz);
    const naturalH = terrainGen.generateHeight(wx, wz, naturalBiome);

    let targetHeight = citySurfaceY;
    let blendFactor = 0;

    if (nearbyLandmark) {
      const distFactor = Math.max(0, Math.min(1, nearbyLandmark.distance / nearbyLandmark.maxDistance));
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
      const rawDelta = targetHeight - naturalH;
      clampedDelta = Math.max(-2, Math.min(2, rawDelta));
      const naturalDelta = Math.max(-maxDelta, Math.min(maxDelta, citySurfaceY - naturalH));
      clampedDelta = naturalDelta * (1 - blendFactor) + clampedDelta * blendFactor;
    } else {
      clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
    }

    surfaceY = naturalH + Math.round(clampedDelta);
    surfaceY = Math.max(surfaceY, Math.min(citySurfaceY, naturalH));

    if (nearbyLandmark) {
      const heightDiff = surfaceY - nearbyLandmark.height;
      if (Math.abs(heightDiff) > 3) {
        surfaceY = nearbyLandmark.height + Math.sign(heightDiff) * 3;
      }
    }
  }

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
      fakeChunk.add(wx, rockY, wz, subType, dPlaceholder);
    }
  }
  fakeChunk.add(wx, rockBaseY - 12, wz, 'end_stone', dPlaceholder);

  return { surfaceY };
}

function detectNearbyLandmark(wx, wz, _seed, terrainGen) {
  const regionX = Math.floor(wx / REGION_SIZE);
  const regionZ = Math.floor(wz / REGION_SIZE);

  const pyramidOffsetX = LANDMARK_OFFSET.FROZEN_MOUNTAIN_X + 160;
  const pyramidOffsetZ = LANDMARK_OFFSET.FROZEN_MOUNTAIN_Z;

  const regionCenterX = regionX * REGION_SIZE + REGION_SIZE / 2;
  const regionCenterZ = regionZ * REGION_SIZE + REGION_SIZE / 2;

  const pyramidCx = regionCenterX + pyramidOffsetX;
  const pyramidCz = regionCenterZ + pyramidOffsetZ;
  const fmCx = regionCenterX + LANDMARK_OFFSET.FROZEN_MOUNTAIN_X;
  const fmCz = regionCenterZ + LANDMARK_OFFSET.FROZEN_MOUNTAIN_Z;

  const distToPyramid = Math.sqrt((wx - pyramidCx) ** 2 + (wz - pyramidCz) ** 2);
  const distToFM = Math.sqrt((wx - fmCx) ** 2 + (wz - fmCz) ** 2);

  const PYRAMID_SIZE = 40;
  const PYRAMID_HALF_SIZE = PYRAMID_SIZE / 2;
  const PYRAMID_TRANSITION_SIZE = 8;
  const PYRAMID_TOTAL_HALF = PYRAMID_HALF_SIZE + PYRAMID_TRANSITION_SIZE;

  const FM_SIZE = 80;
  const FM_HALF_SIZE = FM_SIZE / 2;
  const FM_TRANSITION_SIZE = 8;
  const FM_TOTAL_HALF = FM_HALF_SIZE + FM_TRANSITION_SIZE;

  const inPyramidRange = distToPyramid <= PYRAMID_TOTAL_HALF + 32;
  const inFMRange = distToFM <= FM_TOTAL_HALF + 32;

  if (!inPyramidRange && !inFMRange) return null;

  if (inPyramidRange) {
    const pyramidDist = Math.max(Math.abs(wx - pyramidCx), Math.abs(wz - pyramidCz));
    if (pyramidDist <= PYRAMID_TOTAL_HALF) {
      const layerHeight = Math.floor((PYRAMID_HALF_SIZE - pyramidDist) / 2);
      if (layerHeight > 0) {
        const pyramidBiome = terrainGen.getBiome(pyramidCx, pyramidCz);
        const pyramidBaseHeight = terrainGen.generateHeight(pyramidCx, pyramidCz, pyramidBiome);
        return {
          type: 'pyramid',
          height: pyramidBaseHeight + layerHeight,
          distance: Math.max(0, pyramidDist - PYRAMID_HALF_SIZE),
          maxDistance: PYRAMID_TRANSITION_SIZE + 32
        };
      }
    }
  }

  if (inFMRange) {
    const fmDx = wx - fmCx;
    const fmDz = wz - fmCz;
    const fmDist = Math.sqrt(fmDx * fmDx + fmDz * fmDz);

    if (fmDist <= FM_TOTAL_HALF) {
      const fmBiome = terrainGen.getBiome(fmCx, fmCz);
      const fmBaseHeight = terrainGen.generateHeight(fmCx, fmCz, fmBiome);

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
