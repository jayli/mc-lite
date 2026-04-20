/**
 * 大型静态结构候选收集器
 *
 * 从 WorldWorker.js 的逐格扫描循环中提取的只读逻辑。
 * 遍历给定矩形区域，返回所有应生成大型静态结构的候选中心点。
 *
 * 只负责"发现"候选，不负责生成方块。
 */

import { seededRandom, getBiome } from '../../utils/MathUtils.js';
import { CityMap } from '../maps/CityMap.js';
import { Pyramid } from '../maps/Pyramid.js';
import { IslandMap } from '../maps/IslandMap.js';
import { PlainLand } from '../maps/PlainLand.js';
import { SnowLand } from '../maps/SnowLand.js';
import { FrozenMountain } from '../maps/FrozenMountain.js';
import { makeCandidate, candidateKey, CANDIDATE_SOURCE } from './StructureCandidateTypes.js';

// ---- 从 WorldWorker.js 迁移的纯函数 ----

function isSafeForStructureAt(wx, wz) {
  const lx = ((wx % 16) + 16) % 16;
  const lz = ((wz % 16) + 16) % 16;
  return lx >= 3 && lx <= 12 && lz >= 3 && lz <= 12;
}

function getSurfaceTypeByBiome(biome) {
  if (biome === 'DESERT') return 'sand';
  if (biome === 'CITY') return 'sand';
  if (biome === 'AZALEA') return 'moss';
  if (biome === 'SWAMP') return 'swamp_grass';
  return 'grass';
}

function isOccupiedForLargeStaticNonDesert(wx, wz, seed) {
  const occupiedByGunman = seededRandom(wx, wz, seed) < 0.0005;
  const occupiedByTree = !occupiedByGunman && seededRandom(wx, wz, seed + 1) < 0.005;
  return occupiedByGunman || occupiedByTree;
}

function isOccupiedForLargeStaticDesert(wx, wz, seed) {
  return seededRandom(wx, wz, seed + 24) < 0.005;
}

function resolveLargeStaticStructureType(params) {
  const { wx, wz, seed, biome, surfaceType, safeForStructure, occupied } = params;
  if (!safeForStructure || occupied) return null;

  if (biome === 'DESERT') {
    if (seededRandom(wx, wz, seed + 25) < 0.00016) return 'desertPyramid';
    if (seededRandom(wx, wz, seed + 26) < 0.00016) return 'desertVillage';
    if (seededRandom(wx, wz, seed + 23) < 0.00008) return 'uglyHouse';
    return null;
  }

  if (surfaceType === 'grass' && seededRandom(wx, wz, seed + 5) < 0.0001) {
    return 'tank';
  }

  return null;
}

/**
 * 获取 chunk 所属 biome（以其所在 chunk 的中心点为基准）
 */
function getChunkBiomeByWorld(wx, wz, terrainGen) {
  const ownerCx = Math.floor(wx / 16);
  const ownerCz = Math.floor(wz / 16);
  return terrainGen.getBiome(ownerCx * 16, ownerCz * 16);
}

/**
 * 收集指定矩形区域内的所有大型静态结构候选。
 *
 * @param {Object} rect - { minX, maxX, minZ, maxZ }
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器
 * @returns {Array<Object>} 候选数组，每个元素 { type, x, y, z, source }
 */
export function collectLargeStaticCandidatesInRect(rect, seed, terrainGen) {
  const candidates = [];
  const seen = new Set();
  const push = (candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const wLvl = -2;

  // 获取 City layout（用于城市区域建筑候选）
  const cityLayout = CityMap.getCityLayout(seed, terrainGen);

  // -- 1. 先处理 City placementMap 和 fillerPlacementMap --
  // 只遍历 rect 范围内的 city placement key，避免逐格扫描整个城市
  const addCityCandidates = (placementMap, source) => {
    for (const [keyStr, placement] of placementMap) {
      const [px, pz] = keyStr.split(',').map(Number);
      if (px < rect.minX || px >= rect.maxX || pz < rect.minZ || pz >= rect.maxZ) continue;
      const cityCenterHeight = CityMap.getCitySurfaceY(px, pz, seed, terrainGen);
      if (cityCenterHeight === null) continue;
      push(makeCandidate(placement.type, placement.x, cityCenterHeight + 1, placement.z, source));
    }
  };
  addCityCandidates(cityLayout.placementMap, CANDIDATE_SOURCE.CITY);
  addCityCandidates(cityLayout.fillerPlacementMap, CANDIDATE_SOURCE.CITY);

  // -- 2. 逐格扫描矩形（非城市区域的概率类结构 + 地标中心）--
  for (let wx = rect.minX; wx < rect.maxX; wx++) {
    for (let wz = rect.minZ; wz < rect.maxZ; wz++) {
      // 跳过 City 内的点（已由 placementMap 覆盖）
      if (CityMap.isPointInCity(wx, wz, seed, terrainGen)) continue;

      // Pyramid 区域：跳过（不放置大型结构）
      const pyInfo = Pyramid.getPyramidInfo(wx, wz, seed, terrainGen);
      if (pyInfo) continue;

      // Island 区域：仅当是中心点时添加 tower
      const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
      if (islandInfo) {
        if (wx === islandInfo.centerX && wz === islandInfo.centerZ) {
          push(makeCandidate('tower', islandInfo.centerX, -1, islandInfo.centerZ, CANDIDATE_SOURCE.ISLAND));
        }
        continue;
      }

      // PlainLand 区域：仅当是中心点时添加 pyramidIsland
      const plainLandInfo = PlainLand.getPlainLandInfo(wx, wz, seed, terrainGen);
      if (plainLandInfo) {
        if (wx === plainLandInfo.centerX && wz === plainLandInfo.centerZ) {
          push(makeCandidate('pyramidIsland', plainLandInfo.centerX, plainLandInfo.baseHeight + 1, plainLandInfo.centerZ, CANDIDATE_SOURCE.PLAIN_LAND));
        }
        continue;
      }

      // SnowLand 和 FrozenMountain 区域：跳过
      const slInfo = SnowLand.getSnowLandInfo(wx, wz, seed, terrainGen);
      if (slInfo) continue;

      const fmInfo = FrozenMountain.getFrozenMountainInfo(wx, wz, seed, terrainGen);
      if (fmInfo) continue;

      // 高度检查
      const centerBiomeAtPos = getChunkBiomeByWorld(wx, wz, terrainGen);
      const heightAtPos = terrainGen.generateHeight(wx, wz, centerBiomeAtPos);
      if (heightAtPos < wLvl) continue;

      // 安全检查
      const safeForStructure = isSafeForStructureAt(wx, wz);
      if (!safeForStructure) continue;

      // 占用检查
      const surfaceType = getSurfaceTypeByBiome(centerBiomeAtPos);
      const occupied = centerBiomeAtPos === 'DESERT'
        ? isOccupiedForLargeStaticDesert(wx, wz, seed)
        : isOccupiedForLargeStaticNonDesert(wx, wz, seed);

      const largeStaticType = resolveLargeStaticStructureType({
        wx, wz, seed,
        biome: centerBiomeAtPos,
        surfaceType,
        safeForStructure,
        occupied
      });
      if (largeStaticType) {
        push(makeCandidate(largeStaticType, wx, heightAtPos + 1, wz, CANDIDATE_SOURCE.PROBABILISTIC_LARGE_STATIC));
      }
    }
  }

  return candidates;
}
