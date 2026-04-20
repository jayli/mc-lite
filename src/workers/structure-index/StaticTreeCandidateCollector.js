/**
 * StaticTree 候选收集器
 *
 * 从 WorldWorker.js 的 static_tree 补扫循环中提取的只读逻辑。
 * 当前只覆盖 AZALEA 区域的 static_tree（概率 0.045）。
 */

import { seededRandom, getBiome } from '../../utils/MathUtils.js';
import { CityMap } from '../maps/CityMap.js';
import { Pyramid } from '../maps/Pyramid.js';
import { IslandMap } from '../maps/IslandMap.js';
import { PlainLand } from '../maps/PlainLand.js';
import { SnowLand } from '../maps/SnowLand.js';
import { FrozenMountain } from '../maps/FrozenMountain.js';
import { makeCandidate, candidateKey, CANDIDATE_SOURCE } from './StructureCandidateTypes.js';

const CHUNK_SIZE = 16;

/**
 * 获取 active biome（考虑城市覆盖）
 */
function getActiveBiomeByWorld(wx, wz, seed, terrainGen) {
  const ownerCx = Math.floor(wx / CHUNK_SIZE);
  const ownerCz = Math.floor(wz / CHUNK_SIZE);
  const ownerCenterBiome = terrainGen.getBiome(ownerCx * CHUNK_SIZE, ownerCz * CHUNK_SIZE);
  const cityInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
  const inCity = cityInfo !== null;
  const baseBiome = getBiome(wx, wz);
  return (ownerCenterBiome === 'CITY' && !inCity) ? baseBiome : ownerCenterBiome;
}

/**
 * 收集指定矩形区域内的 static_tree 候选。
 *
 * @param {Object} rect - { minX, maxX, minZ, maxZ }
 * @param {number} seed - 世界种子
 * @param {Object} terrainGen - 地形生成器
 * @returns {Array<Object>} 候选数组
 */
export function collectStaticTreeCandidatesInRect(rect, seed, terrainGen) {
  const candidates = [];
  const seen = new Set();
  const push = (candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const wLvl = -2;

  for (let wx = rect.minX; wx < rect.maxX; wx++) {
    for (let wz = rect.minZ; wz < rect.maxZ; wz++) {
      // 跳过特殊区域（与旧逻辑一致）
      if (Pyramid.getPyramidInfo(wx, wz, seed, terrainGen)) continue;
      if (IslandMap.getIslandInfo(wx, wz, seed, terrainGen)) continue;
      if (PlainLand.getPlainLandInfo(wx, wz, seed, terrainGen)) continue;
      if (SnowLand.getSnowLandInfo(wx, wz, seed, terrainGen)) continue;
      if (FrozenMountain.getFrozenMountainInfo(wx, wz, seed, terrainGen)) continue;

      const activeBiomeAtPos = getActiveBiomeByWorld(wx, wz, seed, terrainGen);
      const heightAtPos = terrainGen.generateHeight(wx, wz, activeBiomeAtPos);
      if (heightAtPos < wLvl) continue;

      if (activeBiomeAtPos === 'AZALEA' && seededRandom(wx, wz, seed + 19) < 0.045) {
        push(makeCandidate('static_tree', wx, heightAtPos + 1, wz, CANDIDATE_SOURCE.STATIC_TREE));
      }
    }
  }

  return candidates;
}
