import { assert, assertEqual } from './assert.js';
import { makeCandidate, candidateKey } from '../workers/structure-index/StructureCandidateTypes.js';
import { collectLargeStaticCandidatesInRect } from '../workers/structure-index/LargeStaticCandidateCollector.js';
import { StructureCandidateIndex } from '../workers/structure-index/StructureCandidateIndex.js';
import { terrainGen } from '../world/TerrainGen.js';
import { CityMap } from '../workers/maps/CityMap.js';
import { Pyramid } from '../workers/maps/Pyramid.js';
import { IslandMap } from '../workers/maps/IslandMap.js';
import { PlainLand } from '../workers/maps/PlainLand.js';
import { SnowLand } from '../workers/maps/SnowLand.js';
import { FrozenMountain } from '../workers/maps/FrozenMountain.js';
import { seededRandom, getBiome } from '../utils/MathUtils.js';

export async function testStructureCandidateShape() {
  const c = makeCandidate('tank', 1.8, 2.2, -3.7, 'probabilistic_large_static');
  assertEqual(c.type, 'tank');
  assertEqual(c.x, 1);
  assertEqual(c.y, 2);
  assertEqual(c.z, -4);
  assertEqual(c.source, 'probabilistic_large_static');
}

export async function testCandidateKeyUniqueness() {
  const a = makeCandidate('tank', 10, 20, 30, 'probabilistic_large_static');
  const b = makeCandidate('tank', 10, 20, 30, 'probabilistic_large_static');
  const c = makeCandidate('tower', 10, 20, 30, 'probabilistic_large_static');

  assertEqual(candidateKey(a), candidateKey(b));
  assert(candidateKey(a) !== candidateKey(c), 'different type should produce different key');
}

export async function testLargeStaticCandidatesAreDeterministic() {
  const rect = { minX: -32, maxX: 96, minZ: -32, maxZ: 96 };
  const a = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  const b = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  assertEqual(JSON.stringify(a), JSON.stringify(b));
}

export async function testCandidateIndexReusesTiles() {
  const index = new StructureCandidateIndex({ tileSize: 64 });
  index.getCandidatesForChunk(0, 0, 12345, terrainGen);
  const afterFirst = index.getStats();
  index.getCandidatesForChunk(1, 0, 12345, terrainGen);
  const afterSecond = index.getStats();

  assert(afterFirst.generatedTiles > 0, 'first query should generate tiles');
  assert(afterSecond.cacheHits > afterFirst.cacheHits, 'second query should reuse cached tiles');
}

/**
 * Reference scanner: 复制旧 WorldWorker 逐格扫描逻辑的核心，用于一致性对比。
 */
function referenceScanLargeStaticCandidates(rect, seed, terrainGen) {
  const candidates = [];
  const seen = new Set();
  const CHUNK_SIZE = 16;
  const wLvl = -2;

  const toLocal = (v) => { const m = v % CHUNK_SIZE; return m >= 0 ? m : m + CHUNK_SIZE; };
  const isSafe = (wx, wz) => { const lx = toLocal(wx); const lz = toLocal(wz); return lx >= 3 && lx <= 12 && lz >= 3 && lz <= 12; };
  const surfaceByBiome = (b) => { if (b === 'DESERT' || b === 'CITY') return 'sand'; if (b === 'AZALEA') return 'moss'; if (b === 'SWAMP') return 'swamp_grass'; return 'grass'; };
  const occupiedNonDesert = (wx, wz) => seededRandom(wx, wz, seed) < 0.0005 || (!seededRandom(wx, wz, seed) < 0.0005 && seededRandom(wx, wz, seed + 1) < 0.005);
  const occupiedDesert = (wx, wz) => seededRandom(wx, wz, seed + 24) < 0.005;

  const resolveType = (wx, wz, biome, surface, safe, occupied) => {
    if (!safe || occupied) return null;
    if (biome === 'DESERT') {
      if (seededRandom(wx, wz, seed + 25) < 0.00016) return 'desertPyramid';
      if (seededRandom(wx, wz, seed + 26) < 0.00016) return 'desertVillage';
      if (seededRandom(wx, wz, seed + 23) < 0.00008) return 'uglyHouse';
      return null;
    }
    if (surface === 'grass' && seededRandom(wx, wz, seed + 5) < 0.0001) return 'tank';
    return null;
  };

  const getChunkBiome = (wx, wz) => {
    const ocx = Math.floor(wx / CHUNK_SIZE);
    const ocz = Math.floor(wz / CHUNK_SIZE);
    return terrainGen.getBiome(ocx * CHUNK_SIZE, ocz * CHUNK_SIZE);
  };

  const push = (type, x, y, z) => {
    const key = `${type}:${x},${y},${z}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ type, x, y, z });
  };

  const cityLayout = CityMap.getCityLayout(seed, terrainGen);

  for (const pm of [cityLayout.placementMap, cityLayout.fillerPlacementMap]) {
    for (const [keyStr, p] of pm) {
      const [px, pz] = keyStr.split(',').map(Number);
      if (px < rect.minX || px >= rect.maxX || pz < rect.minZ || pz >= rect.maxZ) continue;
      const cy = CityMap.getCitySurfaceY(px, pz, seed, terrainGen);
      if (cy === null) continue;
      push(p.type, p.x, cy + 1, p.z);
    }
  }

  for (let wx = rect.minX; wx < rect.maxX; wx++) {
    for (let wz = rect.minZ; wz < rect.maxZ; wz++) {
      if (CityMap.isPointInCity(wx, wz, seed, terrainGen)) continue;
      if (Pyramid.getPyramidInfo(wx, wz, seed, terrainGen)) continue;
      const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
      if (islandInfo) {
        if (wx === islandInfo.centerX && wz === islandInfo.centerZ) push('tower', islandInfo.centerX, -1, islandInfo.centerZ);
        continue;
      }
      const plInfo = PlainLand.getPlainLandInfo(wx, wz, seed, terrainGen);
      if (plInfo) {
        if (wx === plInfo.centerX && wz === plInfo.centerZ) push('pyramidIsland', plInfo.centerX, plInfo.baseHeight + 1, plInfo.centerZ);
        continue;
      }
      if (SnowLand.getSnowLandInfo(wx, wz, seed, terrainGen)) continue;
      if (FrozenMountain.getFrozenMountainInfo(wx, wz, seed, terrainGen)) continue;
      const biome = getChunkBiome(wx, wz);
      const h = terrainGen.generateHeight(wx, wz, biome);
      if (h < wLvl) continue;
      if (!isSafe(wx, wz)) continue;
      const surface = surfaceByBiome(biome);
      const occ = biome === 'DESERT' ? occupiedDesert(wx, wz) : occupiedNonDesert(wx, wz);
      const type = resolveType(wx, wz, biome, surface, isSafe(wx, wz), occ);
      if (type) push(type, wx, h + 1, wz);
    }
  }

  return candidates;
}

export async function testLargeStaticCollectorMatchesReferenceScanner() {
  const rect = { minX: -16, maxX: 80, minZ: -16, maxZ: 80 };
  const actual = collectLargeStaticCandidatesInRect(rect, 12345, terrainGen).map(candidateKey).sort();
  const expected = referenceScanLargeStaticCandidates(rect, 12345, terrainGen).map(candidateKey).sort();
  assertEqual(JSON.stringify(actual), JSON.stringify(expected));
}
