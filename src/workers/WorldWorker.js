// src/workers/WorldWorker.js
// Worker 中不使用 import map，需要完整 URL
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { setSeed, seededRandom, getBiome as getBaseBiome } from '../utils/MathUtils.js';
import { parseBlockEntry, getRotationAngle } from '../utils/OrientationUtils.js';
import { encodeCoord, decodeCoord } from '../utils/CoordEncoding.js';
import { terrainGen } from '../world/TerrainGen.js';
import { Tree } from '../world/entities/Tree.js';
import { Cloud } from '../world/entities/Cloud.js';
import { Island } from '../world/entities/Island.js';
import { getBlockProperties, BLOCK_DATA, isFullCubeOccluder } from '../constants/BlockData.js';
import { structureLoaders } from '../world/entity-system/StructureLoader.js';
import { Pyramid } from './maps/Pyramid.js';
import { SnowLand } from './maps/SnowLand.js';
import { FrozenMountain } from './maps/FrozenMountain.js';
import { IslandMap } from './maps/IslandMap.js';
import { PlainLand } from './maps/PlainLand.js';
import { CityMap } from './maps/CityMap.js';
import { calculateAOForBlock } from '../utils/AOUtils.js';
import { StructureCandidateIndex } from './structure-index/StructureCandidateIndex.js';

console.log('WorldWorker.js loaded');

// 全局错误处理
self.onerror = (e) => {
  console.error('WorldWorker internal error:', e.message, 'at', e.filename, ':', e.lineno);
};

// 结构数据加载器实例
const {
  bigHouse,
  regularHouse1,
  boxHouse,
  doubleTower,
  treeTower,
  junglePyramid,
  pyramidIsland,
  smallHouse,
  treeHouse,
  uglyHouse,
  whiteTower,
  woodHouse,
  desertVillage,
  desertPyramid,
  birchTree,
  birchTreeWithSnow,
  tank,
  tower,
  castle,
  gate,
  flowerBed,
  pavilion,
  tallWell,
  desertTempleTube
} = structureLoaders;

// 模块级预加载：每个 Worker 实例只执行一次，所有 onmessage 共享此 Promise
const structuresPreload = Promise.all([
  bigHouse.load(),
  regularHouse1.load(),
  boxHouse.load(),
  doubleTower.load(),
  treeTower.load(),
  junglePyramid.load(),
  pyramidIsland.load(),
  smallHouse.load(),
  treeHouse.load(),
  uglyHouse.load(),
  whiteTower.load(),
  woodHouse.load(),
  desertVillage.load(),
  desertPyramid.load(),
  birchTree.load(),
  birchTreeWithSnow.load(),
  tank.load(),
  tower.load(),
  castle.load(),
  gate.load(),
  flowerBed.load(),
  pavilion.load(),
  tallWell.load(),
  desertTempleTube.load()
]).catch(err => console.error('Failed to load structure data:', err));

// 结构候选索引（每个 Worker 实例独立缓存）
const structureCandidateIndex = new StructureCandidateIndex();

const CHUNK_SIZE = 16;
const ROOMS_PER_CHUNK = 2;
const MAX_ROOM_SIZE = 5;
const CITY_FLOWER_BED_CHANCE = 0.0005;
const CITY_PAVILION_CHANCE = CITY_FLOWER_BED_CHANCE * 6;
const CITY_TALL_WELL_CHANCE = CITY_FLOWER_BED_CHANCE * 3; // 与 pavilion 相同概率
// 方块归属机制版本号（用于存档兼容性判断）
const OWNERSHIP_SCHEMA_VERSION = 2;
// 旧档归属迁移调试开关（默认关闭）
const DEBUG_OWNERSHIP_MIGRATION = false;

/**
 * 根据生物群系推导地表材质类型（与主生成逻辑保持一致）
 * @param {string} biome
 * @returns {string}
 */
function getSurfaceTypeByBiome(biome) {
  if (biome === 'DESERT') return 'sand';
  if (biome === 'CITY') return 'sand';
  if (biome === 'AZALEA') return 'moss';
  if (biome === 'SWAMP') return 'swamp_grass';
  return 'grass';
}

/**
 * 沙漠地块中，是否已被 dead_bush 占位（会阻止大型结构）
 * @param {number} wx
 * @param {number} wz
 * @param {number} seed
 * @returns {boolean}
 */
function isOccupiedForLargeStaticDesert(wx, wz, seed) {
  return seededRandom(wx, wz, seed + 24) < 0.005;
}

/**
 * 统一的大型静态结构判定规则
 * 返回值为结构类型或 null；不做任何副作用
 * @param {Object} params
 * @param {number} params.wx
 * @param {number} params.wz
 * @param {number} params.seed
 * @param {string} params.biome
 * @param {string} params.surfaceType
 * @param {boolean} params.safeForStructure
 * @param {boolean} params.occupied
 * @returns {'desertPyramid'|'desertVillage'|'uglyHouse'|'tank'|null}
 */
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
 * 构建 Mesh 数据（用于 Worker 中预计算）
 * @param {Object} fakeChunk - 模拟的 chunk 对象
 * @param {Object} d - 渲染数据 {type: [positions]}
 * @param {number} _cx - chunk X
 * @param {number} _cz - chunk Z
 * @returns {Array} meshDataArray
 */
function buildMeshData(fakeChunk, d, _cx, _cz) {
  const meshDataArray = [];
  const dummy = new THREE.Object3D();

  for (const type in d) {
    const positions = d[type];
    if (positions.length === 0) continue;

    const count = positions.length;
    const matrices = new Float32Array(count * 16);
    const aoLow = new Float32Array(count);
    const aoHigh = new Float32Array(count);
    const orientation = new Float32Array(count);
    const instanceIndexMap = {};

    for (let i = 0; i < count; i++) {
      const pos = positions[i];

      // 计算矩阵
      dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      dummy.rotation.set(0, getRotationAngle(pos.orientation || 0), 0);
      dummy.updateMatrix();

      // 存储矩阵（16 个元素）
      matrices.set(dummy.matrix.elements, i * 16);

      // AO 和朝向
      aoLow[i] = pos.aoLow || 0;
      aoHigh[i] = pos.aoHigh || 0;
      orientation[i] = pos.orientation || 0;

      // 索引映射使用数字编码，避免在 Worker 回包中携带 "x,y,z" key。
      const posKey = encodeCoord(pos.x, pos.y, pos.z);
      instanceIndexMap[posKey] = i;
    }

    meshDataArray.push({
      type, count, matrices, aoLow, aoHigh, orientation,
      instanceIndexMap
    });
  }

  return meshDataArray;
}

function buildMeshDataForChunk(fakeChunk, d, targetCx, targetCz) {
  const filtered = {};
  for (const type in d) {
    const positions = d[type];
    if (!Array.isArray(positions) || positions.length === 0) continue;

    const ownPositions = positions.filter((pos) =>
      Math.floor(pos.x / CHUNK_SIZE) === targetCx && Math.floor(pos.z / CHUNK_SIZE) === targetCz
    );
    if (ownPositions.length > 0) {
      filtered[type] = ownPositions;
    }
  }
  return buildMeshData(fakeChunk, filtered, targetCx, targetCz);
}

/**
 * 构建逻辑方块列表。
 * 这条数据用于主线程恢复 blockData，不携带矩阵和 AO，避免把隐藏方块也做成重渲染载荷。
 * @param {Map} blockMap - 所有方块的 Map (key -> {x, y, z, type, solid, orientation})
 * @returns {Array} blockDataBlocks 数组
 */
function buildBlockDataBlocks(blockMap) {
  const blocks = [];
  for (const [, block] of blockMap) {
    const { x, y, z, type, orientation } = block;
    if (type === 'air') continue;
    blocks.push({
      x, y, z,
      type,
      orientation: orientation || 0
    });
  }
  return blocks;
}

/**
 * 构建可见打散方块列表 — 替代 buildMeshData
 * 只返回首帧/合并渲染需要的可见方块，不再为每个方块创建 matrix buffer。
 * @param {Map} blockMap - 所有方块的 Map (key -> {x, y, z, type, solid, orientation})
 * @param {Set} visibleKeysSet - 可见方块 keys Set（用于渲染路径）
 * @param {Map} aoMap - AO 数据 Map (key -> {aoLow, aoHigh})
 * @returns {Array} scatteredBlocks 数组
 */
function buildScatteredBlocks(blockMap, visibleKeysSet, aoMap) {
  const blocks = [];

  for (const [key, block] of blockMap) {
    const { x, y, z, type, orientation } = block;

    // 跳过空气方块
    if (type === 'air') continue;
    if (visibleKeysSet?.size > 0 && !visibleKeysSet.has(key)) continue;

    // 跳过不可渲染的方块（如 collider）
    const props = getBlockProperties(type);
    if (props.isRendered === false) continue;

    const ao = aoMap.get(key) || { aoLow: 1, aoHigh: 1 };

    blocks.push({
      x, y, z,
      type,
      orientation: orientation || 0,
      aoLow: ao.aoLow,
      aoHigh: ao.aoHigh
    });
  }

  return blocks;
}

function buildChunkRouting(blockDataBlocks, visibleBlocks, cx, cz, meshData) {
  const ownChunkKey = `${cx},${cz}`;
  const ownChunk = {
    chunkKey: ownChunkKey,
    blockDataBlocks: [],
    visibleBlocks: [],
    meshData: Array.isArray(meshData) ? meshData : []
  };
  const overflowMap = new Map();

  const getOrCreateOverflowBucket = (chunkKey) => {
    let bucket = overflowMap.get(chunkKey);
    if (!bucket) {
      bucket = {
        chunkKey,
        blockDataBlocks: [],
        visibleBlocks: []
      };
      overflowMap.set(chunkKey, bucket);
    }
    return bucket;
  };
  const ownBlockCodes = new Set();
  const overflowBlockCodes = new Map();

  const appendLogicalBlock = (targetKey, block) => {
    const code = encodeCoord(block.x, block.y, block.z);
    if (targetKey === ownChunkKey) {
      if (ownBlockCodes.has(code)) return;
      ownBlockCodes.add(code);
      ownChunk.blockDataBlocks.push({
        x: block.x,
        y: block.y,
        z: block.z,
        type: block.type,
        orientation: block.orientation || 0
      });
      return;
    }

    const bucket = getOrCreateOverflowBucket(targetKey);
    let codes = overflowBlockCodes.get(targetKey);
    if (!codes) {
      codes = new Set();
      overflowBlockCodes.set(targetKey, codes);
    }
    if (codes.has(code)) return;
    codes.add(code);
    bucket.blockDataBlocks.push({
      x: block.x,
      y: block.y,
      z: block.z,
      type: block.type,
      orientation: block.orientation || 0
    });
  };

  for (const block of blockDataBlocks || []) {
    const targetCx = Math.floor(block.x / CHUNK_SIZE);
    const targetCz = Math.floor(block.z / CHUNK_SIZE);
    const targetKey = `${targetCx},${targetCz}`;
    appendLogicalBlock(targetKey, block);
  }

  for (const block of visibleBlocks || []) {
    const targetCx = Math.floor(block.x / CHUNK_SIZE);
    const targetCz = Math.floor(block.z / CHUNK_SIZE);
    const targetKey = `${targetCx},${targetCz}`;
    appendLogicalBlock(targetKey, block);
    if (targetKey === ownChunkKey) {
      ownChunk.visibleBlocks.push(block);
    } else {
      getOrCreateOverflowBucket(targetKey).visibleBlocks.push(block);
    }
  }

  return {
    schemaVersion: 1,
    ownChunk,
    overflowChunks: Array.from(overflowMap.values())
  };
}

/**
 * 按纹理分组构建 meshData — 材质合批优化
 * @param {Object} fakeChunk - 模拟 chunk（提供 getBlock 方法）
 * @param {Object} d - 渲染数据 {type: [positions]}
 * @param {Object} textureGroups - 纹理分组配置
 * @returns {Array} meshDataArray
 */
function buildBatchedMeshData(fakeChunk, d, textureGroups) {
  const meshDataArray = [];
  const dummy = new THREE.Object3D();

  // 为每种纹理创建逆映射：方块类型 → 纹理索引
  const typeToTextureIndex = {};
  const textureUrls = Object.keys(textureGroups);

  for (let i = 0; i < textureUrls.length; i++) {
    const textureUrl = textureUrls[i];
    for (const type of textureGroups[textureUrl]) {
      typeToTextureIndex[type] = i;
    }
  }

  // 按纹理组处理
  for (const [textureUrl, types] of Object.entries(textureGroups)) {
    const allPositions = [];

    // 收集该组内所有类型的 positions
    for (const type of types) {
      const positions = d[type];
      if (!positions) continue;

      for (const pos of positions) {
        allPositions.push({
          ...pos,
          type,
          textureIndex: typeToTextureIndex[type]
        });
      }
    }

    if (allPositions.length === 0) continue;

    // 构建该纹理组的 meshData
    const count = allPositions.length;
    const matrices = new Float32Array(count * 16);
    const aoLow = new Float32Array(count);
    const aoHigh = new Float32Array(count);
    const orientation = new Float32Array(count);
    const textureIndexAttr = new Float32Array(count);
    const instanceIndexMap = {};

    for (let i = 0; i < count; i++) {
      const pos = allPositions[i];

      dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      dummy.rotation.set(0, getRotationAngle(pos.orientation || 0), 0);
      dummy.updateMatrix();

      matrices.set(dummy.matrix.elements, i * 16);
      aoLow[i] = pos.aoLow || 0;
      aoHigh[i] = pos.aoHigh || 0;
      orientation[i] = pos.orientation || 0;
      textureIndexAttr[i] = pos.textureIndex;

      const posKey = encodeCoord(pos.x, pos.y, pos.z);
      instanceIndexMap[posKey] = { index: i, type: pos.type };
    }

    meshDataArray.push({
      type: textureUrl,  // 使用纹理 URL 作为"类型"
      count, matrices, aoLow, aoHigh, orientation,
      textureIndex: textureIndexAttr,
      instanceIndexMap,
      blockTypes: types  // 记录该组包含的方块类型
    });
  }

  // 处理不在任何组中的方块（回退到旧逻辑）
  const batchedTypes = new Set(Object.values(textureGroups).flat());
  for (const type in d) {
    if (batchedTypes.has(type)) continue;

    const positions = d[type];
    if (positions.length === 0) continue;

    // 使用原始 buildMeshData 逻辑处理
    const count = positions.length;
    const matrices = new Float32Array(count * 16);
    const aoLow = new Float32Array(count);
    const aoHigh = new Float32Array(count);
    const orientation = new Float32Array(count);
    const instanceIndexMap = {};

    for (let i = 0; i < count; i++) {
      const pos = positions[i];
      dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      dummy.rotation.set(0, getRotationAngle(pos.orientation || 0), 0);
      dummy.updateMatrix();
      matrices.set(dummy.matrix.elements, i * 16);
      aoLow[i] = pos.aoLow || 0;
      aoHigh[i] = pos.aoHigh || 0;
      orientation[i] = pos.orientation || 0;
      const posKey = encodeCoord(pos.x, pos.y, pos.z);
      instanceIndexMap[posKey] = i;
    }

    meshDataArray.push({
      type, count, matrices, aoLow, aoHigh, orientation,
      instanceIndexMap
    });
  }

  return meshDataArray;
}

/**
 * 生成单个 chunk，使用外部注入的共享状态（region 级生成路径）。
 *
 * @param {Object} params
 * @param {number} params.cx - Chunk X
 * @param {number} params.cz - Chunk Z
 * @param {number} params.seed - 世界种子
 * @param {StructureCandidateIndex} params.candidateIndex - 共享的候选索引
 * @param {Set} params.largeStructureTaskKeySet - 共享的大结构去重集合
 * @param {Array} [params.structureQueueWithCenters] - 共享的结构生成队列（可选，region 路径传入）
 * @param {Array} [params.structureCenters] - 共享的结构中心列表（可选，region 路径传入）
 * @param {Array} [params.modGunMan] - 共享的 gun_man 实体列表（可选，region 路径传入）
 * @param {Array} [params.rovers] - 共享的 rover 实体列表（可选，region 路径传入）
 * @returns {Object} chunk 结果 { blockDataBlocks, scatteredBlocks, routing, meshData, ... }
 */
function generateChunkWithSharedState(params) {
  const {
    cx, cz, seed,
    candidateIndex,
    largeStructureTaskKeySet,
    structureQueueWithCenters: injectedStructureQueueWithCenters,
    structureCenters: injectedStructureCenters,
    modGunMan: injectedModGunMan,
    rovers: injectedRovers
  } = params;

  const CHUNK_SIZE_LOCAL = 16;
  const minX = cx * CHUNK_SIZE_LOCAL;
  const maxX = (cx + 1) * CHUNK_SIZE_LOCAL;
  const minZ = cz * CHUNK_SIZE_LOCAL;
  const maxZ = (cz + 1) * CHUNK_SIZE_LOCAL;

  const blockMap = new Map();
  const modGunMan = injectedModGunMan || [];
  const rovers = injectedRovers || [];
  const structureQueue = [];
  const structureCenters = injectedStructureCenters || [];
  const islandTowerCenters = new Set();
  const plainLandCastleCenters = new Set();
  const cityStructureCenters = new Set();
  const cityFillerHouseCenters = new Set();
  const cityTreeCenters = new Set();
  const cityTallTreeCenters = new Set();
  const citySwampTreeCenters = new Set();
  const cityYellowTreeCenters = new Set();
  const cityBirchTreeCenters = new Set();
  const cityFlowerBedCenters = new Set();
  const cityPavilionFootprintCells = new Set();
  const cityTallWellFootprintCells = new Set();
  const cityCoreCandidates = [];

  // 在 region 路径下，injectedStructureQueueWithCenters 已存在，直接复用；
  // 独立 chunk 路径下创建局部队列（最终会丢弃，因为结果只看 blockDataBlocks）。
  const structureQueueWithCenters = injectedStructureQueueWithCenters || [];

  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true, orientation = 0) => {
      const key = encodeCoord(x, y, z);
      const existing = blockMap.get(key);
      if (existing && existing.type !== 'air' && type !== 'air') return;
      blockMap.set(key, { x, y, z, type, solid, orientation });
    },
    getBlockType: (x, y, z) => {
      const key = encodeCoord(x, y, z);
      return blockMap.get(key)?.type || null;
    }
  };

  // --- 以下为完整的地形生成逻辑，复制自 onmessage ---

  const rooms = [];
  const roomSeed = Math.abs((cx * 73856093) ^ (cz * 19349663) ^ seed);
  let rRand = roomSeed;
  const nextRand = () => {
    rRand = (rRand * 1103515245 + 12345) & 0x7fffffff;
    return rRand / 0x7fffffff;
  };

  for (let i = 0; i < ROOMS_PER_CHUNK; i++) {
    const rx = Math.floor(nextRand() * CHUNK_SIZE_LOCAL);
    const rz = Math.floor(nextRand() * CHUNK_SIZE_LOCAL);
    const ry = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    const rw = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    const rh = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    const rd = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    rooms.push({
      minX: cx * CHUNK_SIZE_LOCAL + rx - Math.floor(rw / 2),
      maxX: cx * CHUNK_SIZE_LOCAL + rx + Math.floor(rw / 2),
      minY: ry,
      maxY: ry + rh,
      minZ: cz * CHUNK_SIZE_LOCAL + rz - Math.floor(rd / 2),
      maxZ: cz * CHUNK_SIZE_LOCAL + rz + Math.floor(rd / 2)
    });
  }

  const centerBiome = terrainGen.getBiome(cx * CHUNK_SIZE_LOCAL, cz * CHUNK_SIZE_LOCAL);
  const cityLayout = CityMap.getCityLayout(seed, terrainGen);
  const cityPlacementMap = cityLayout?.placementMap || new Map();
  const cityFillerPlacementMap = cityLayout?.fillerPlacementMap || new Map();
  const dPlaceholder = {};

  function createStructureTask(taskFn, centerX, centerY, centerZ, type, centers = null, centerKey = null) {
    taskFn.centerX = centerX;
    taskFn.centerY = centerY;
    taskFn.centerZ = centerZ;
    taskFn.type = type;
    structureQueue.push(taskFn);
    if (centers && centerKey) {
      centers.add(centerKey);
    }
    return taskFn;
  }

  function isNearRecordedCenter(centerSet, x, z, minDist) {
    for (const key of centerSet) {
      const [cxVal, czVal] = key.split(',').map(Number);
      if (Math.max(Math.abs(cxVal - x), Math.abs(czVal - z)) < minDist) {
        return true;
      }
    }
    return false;
  }

  function getLoaderBottomFootprint(loader) {
    const data = loader?.getData?.();
    if (!data || !Array.isArray(data.blocks) || data.blocks.length === 0) return null;
    let minY = Infinity;
    for (const block of data.blocks) {
      if (block.y < minY) minY = block.y;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let count = 0;
    for (const block of data.blocks) {
      if (block.y !== minY) continue;
      if (block.x < minX) minX = block.x;
      if (block.x > maxX) maxX = block.x;
      if (block.z < minZ) minZ = block.z;
      if (block.z > maxZ) maxZ = block.z;
      count++;
    }
    if (count === 0) return null;
    return { minX, maxX, minZ, maxZ };
  }

  const pavilionFootprint = getLoaderBottomFootprint(pavilion) || { minX: -5, maxX: 5, minZ: -3, maxZ: 3 };
  const pavilionHalfX = Math.ceil(Math.max(Math.abs(pavilionFootprint.minX), Math.abs(pavilionFootprint.maxX)));
  const pavilionHalfZ = Math.ceil(Math.max(Math.abs(pavilionFootprint.minZ), Math.abs(pavilionFootprint.maxZ)));
  const tallWellFootprint = getLoaderBottomFootprint(tallWell) || { minX: -5, maxX: 5, minZ: -3, maxZ: 3 };
  const tallWellHalfX = Math.ceil(Math.max(Math.abs(tallWellFootprint.minX), Math.abs(tallWellFootprint.maxX)));
  const tallWellHalfZ = Math.ceil(Math.max(Math.abs(tallWellFootprint.minZ), Math.abs(tallWellFootprint.maxZ)));

  function collectPavilionFootprintCells(centerX, centerZ) {
    const cells = [];
    for (let ox = pavilionFootprint.minX; ox <= pavilionFootprint.maxX; ox++) {
      for (let oz = pavilionFootprint.minZ; oz <= pavilionFootprint.maxZ; oz++) {
        cells.push(`${centerX + ox},${centerZ + oz}`);
      }
    }
    return cells;
  }

  function isPavilionFootprintReserved(centerX, centerZ) {
    const cells = collectPavilionFootprintCells(centerX, centerZ);
    for (const key of cells) {
      if (cityPavilionFootprintCells.has(key)) return true;
    }
    return false;
  }

  function reservePavilionFootprint(centerX, centerZ) {
    const cells = collectPavilionFootprintCells(centerX, centerZ);
    for (const key of cells) {
      cityPavilionFootprintCells.add(key);
    }
  }

  function isPavilionSpaceClear(centerX, centerY, centerZ) {
    for (let ox = pavilionFootprint.minX; ox <= pavilionFootprint.maxX; ox++) {
      for (let oz = pavilionFootprint.minZ; oz <= pavilionFootprint.maxZ; oz++) {
        const wx = centerX + ox;
        const wz = centerZ + oz;
        const cellInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
        if (!cellInfo || cellInfo.transitionFactor > 0) return false;
        const surfaceY = CityMap.getCitySurfaceY(wx, wz, seed, terrainGen);
        if (surfaceY === null || Math.abs(surfaceY + 1 - centerY) > 1) return false;
        for (let y = centerY; y <= centerY + 2; y++) {
          if (fakeChunk.getBlockType(wx, y, wz)) return false;
        }
      }
    }
    return true;
  }

  function canPlaceCityPavilion(centerX, centerY, centerZ) {
    const pavilionRadius = Math.max(pavilionHalfX, pavilionHalfZ);
    const nearMajorBuilding = CityMap.isPointNearCityStructure(centerX, centerZ, seed, terrainGen, pavilionRadius + 1);
    const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, centerX, centerZ, pavilionRadius + 3);
    const nearFlowerBed = isNearRecordedCenter(cityFlowerBedCenters, centerX, centerZ, pavilionRadius + 5);
    const nearTree = isNearRecordedCenter(cityTreeCenters, centerX, centerZ, pavilionRadius + 4) ||
      isNearRecordedCenter(cityTallTreeCenters, centerX, centerZ, pavilionRadius + 5) ||
      isNearRecordedCenter(citySwampTreeCenters, centerX, centerZ, pavilionRadius + 4) ||
      isNearRecordedCenter(cityYellowTreeCenters, centerX, centerZ, pavilionRadius + 4) ||
      isNearRecordedCenter(cityBirchTreeCenters, centerX, centerZ, pavilionRadius + 4);
    if (nearMajorBuilding || nearFillerHouse || nearFlowerBed || nearTree) return false;
    if (isPavilionFootprintReserved(centerX, centerZ)) return false;
    return isPavilionSpaceClear(centerX, centerY, centerZ);
  }

  let hasQueuedCityPavilion = false;
  function queueCityPavilion(centerX, centerY, centerZ) {
    if (!canPlaceCityPavilion(centerX, centerY, centerZ)) return false;
    createStructureTask(
      generatePavilion.bind(null, centerX, centerY, centerZ, fakeChunk, dPlaceholder),
      centerX, centerY, centerZ, 'pavilion'
    );
    reservePavilionFootprint(centerX, centerZ);
    hasQueuedCityPavilion = true;
    return true;
  }

  function collectTallWellFootprintCells(centerX, centerZ) {
    const cells = [];
    for (let ox = tallWellFootprint.minX; ox <= tallWellFootprint.maxX; ox++) {
      for (let oz = tallWellFootprint.minZ; oz <= tallWellFootprint.maxZ; oz++) {
        cells.push(`${centerX + ox},${centerZ + oz}`);
      }
    }
    return cells;
  }

  function isTallWellFootprintReserved(centerX, centerZ) {
    const cells = collectTallWellFootprintCells(centerX, centerZ);
    for (const key of cells) {
      if (cityTallWellFootprintCells.has(key)) return true;
    }
    return false;
  }

  function reserveTallWellFootprint(centerX, centerZ) {
    const cells = collectTallWellFootprintCells(centerX, centerZ);
    for (const key of cells) {
      cityTallWellFootprintCells.add(key);
    }
  }

  function isTallWellSpaceClear(centerX, centerY, centerZ) {
    for (let ox = tallWellFootprint.minX; ox <= tallWellFootprint.maxX; ox++) {
      for (let oz = tallWellFootprint.minZ; oz <= tallWellFootprint.maxZ; oz++) {
        const wx = centerX + ox;
        const wz = centerZ + oz;
        const cellInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
        if (!cellInfo || cellInfo.transitionFactor > 0) return false;
        const surfaceY = CityMap.getCitySurfaceY(wx, wz, seed, terrainGen);
        if (surfaceY === null || Math.abs(surfaceY + 1 - centerY) > 1) return false;
        for (let y = centerY; y <= centerY + 2; y++) {
          if (fakeChunk.getBlockType(wx, y, wz)) return false;
        }
      }
    }
    return true;
  }

  function canPlaceCityTallWell(centerX, centerY, centerZ) {
    const tallWellRadius = Math.max(tallWellHalfX, tallWellHalfZ);
    const nearMajorBuilding = CityMap.isPointNearCityStructure(centerX, centerZ, seed, terrainGen, tallWellRadius);
    const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, centerX, centerZ, tallWellRadius + 1);
    const nearFlowerBed = isNearRecordedCenter(cityFlowerBedCenters, centerX, centerZ, tallWellRadius + 2);
    const nearTree = isNearRecordedCenter(cityTreeCenters, centerX, centerZ, tallWellRadius + 2) ||
      isNearRecordedCenter(cityTallTreeCenters, centerX, centerZ, tallWellRadius + 3) ||
      isNearRecordedCenter(citySwampTreeCenters, centerX, centerZ, tallWellRadius + 2) ||
      isNearRecordedCenter(cityYellowTreeCenters, centerX, centerZ, tallWellRadius + 2) ||
      isNearRecordedCenter(cityBirchTreeCenters, centerX, centerZ, tallWellRadius + 2);
    if (nearMajorBuilding || nearFillerHouse || nearFlowerBed || nearTree) return false;
    if (isTallWellFootprintReserved(centerX, centerZ)) return false;
    return isTallWellSpaceClear(centerX, centerY, centerZ);
  }

  let hasQueuedCityTallWell = false;
  function queueCityTallWell(centerX, centerY, centerZ) {
    if (!canPlaceCityTallWell(centerX, centerY, centerZ)) return false;
    createStructureTask(
      generateTallWell.bind(null, centerX, centerY, centerZ, fakeChunk, dPlaceholder),
      centerX, centerY, centerZ, 'tall_well'
    );
    reserveTallWellFootprint(centerX, centerZ);
    hasQueuedCityTallWell = true;
    return true;
  }

  function generateTallWell(x, y, z, chunk, dObj) {
    tallWell.generate(x, y, z, chunk, dObj, true);
  }

  for (let x = 0; x < CHUNK_SIZE_LOCAL; x++) {
    for (let z = 0; z < CHUNK_SIZE_LOCAL; z++) {
      const wx = cx * CHUNK_SIZE_LOCAL + x;
      const wz = cz * CHUNK_SIZE_LOCAL + z;
      const wLvl = -2;
      const safeForStructure = x >= 3 && x <= 12 && z >= 3 && z <= 12;

      const pyInfo = Pyramid.getPyramidInfo(wx, wz, seed, terrainGen);
      const inPyramid = pyInfo !== null;
      const slInfo = SnowLand.getSnowLandInfo(wx, wz, seed, terrainGen);
      const inSnowLand = slInfo !== null;
      const fmInfo = FrozenMountain.getFrozenMountainInfo(wx, wz, seed, terrainGen);
      const inFrozenMountain = fmInfo !== null;
      const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
      const inIsland = islandInfo !== null;
      const plainLandInfo = PlainLand.getPlainLandInfo(wx, wz, seed, terrainGen);
      const inPlainLand = plainLandInfo !== null;
      const cityInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
      const inCity = cityInfo !== null;
      const baseBiomeAtPos = getBaseBiome(wx, wz);
      const activeBiome = (centerBiome === 'CITY' && !inCity) ? baseBiomeAtPos : centerBiome;
      const h = terrainGen.generateHeight(wx, wz, activeBiome);

      if (inCity) {
        const cityResult = CityMap.generate(wx, wz, h, cityInfo, fakeChunk, dPlaceholder, seed, terrainGen);
        if (cityInfo.transitionFactor === 0) {
          cityCoreCandidates.push({ x: wx, y: cityResult.surfaceY + 1, z: wz });
        }
        const cityStructure = cityPlacementMap.get(`${wx},${wz}`) || cityFillerPlacementMap.get(`${wx},${wz}`) || null;
        if (cityStructure && !cityStructureCenters.has(cityStructure.id)) {
          const centerY = cityResult.surfaceY + 1;
          const centerKey = cityStructure.id;
          const taskFactories = {
            castle: generateCastle, bigHouse: generateBigHouse, regularHouse1: generateRegularHouse1,
            desertTempleTube: generateDesertTempleTube, boxHouse: generateBoxHouse, desertVillage: generateDesertVillage,
            doubleTower: generateDoubleTower, treeTower: generateTreeTower, junglePyramid: generateJunglePyramid,
            tank: generateTank, gate: generateGate, pyramidIsland: generatePyramidIsland,
            smallHouse: generateSmallHouse, tower: generateTower, treeHouse: generateTreeHouse,
            uglyHouse: generateUglyHouse, whiteTower: generateWhiteTower, woodHouse: generateWoodHouse
          };
          const factory = taskFactories[cityStructure.type];
          if (factory) {
            createStructureTask(
              factory.bind(null, cityStructure.x, centerY, cityStructure.z, fakeChunk, dPlaceholder),
              cityStructure.x, centerY, cityStructure.z,
              cityStructure.type, cityStructureCenters, centerKey
            );
          }
        }

        if (seededRandom(wx, wz, seed + 800) < 0.0044) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherTree = isNearRecordedCenter(cityTreeCenters, wx, wz, 6);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherTree) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'default', dPlaceholder),
              wx, cityResult.surfaceY + 1, wz, 'static_tree', cityTreeCenters, treeKey
            );
          }
        }
        if (seededRandom(wx, wz, seed + 801) < 0.0017) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 3);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 10);
          const nearOtherTree = isNearRecordedCenter(cityTreeCenters, wx, wz, 7);
          const nearOtherTallTree = isNearRecordedCenter(cityTallTreeCenters, wx, wz, 10);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherTree && !nearOtherTallTree) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'big', dPlaceholder),
              wx, cityResult.surfaceY + 1, wz, 'static_tree', cityTallTreeCenters, treeKey
            );
          }
        }
        if (seededRandom(wx, wz, seed + 803) < 0.0044) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherSwamp = isNearRecordedCenter(citySwampTreeCenters, wx, wz, 7);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherSwamp) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'swamp', dPlaceholder),
              wx, cityResult.surfaceY + 1, wz, 'static_tree', citySwampTreeCenters, treeKey
            );
          }
        }
        if (seededRandom(wx, wz, seed + 804) < 0.0022) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherYellow = isNearRecordedCenter(cityYellowTreeCenters, wx, wz, 7);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherYellow) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'big', dPlaceholder, null, 'yellow_leaves'),
              wx, cityResult.surfaceY + 1, wz, 'static_tree', cityYellowTreeCenters, treeKey
            );
          }
        }
        if (seededRandom(wx, wz, seed + 805) < 0.00147) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherBirch = isNearRecordedCenter(cityBirchTreeCenters, wx, wz, 7);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherBirch) {
            createStructureTask(
              generateBirchTree.bind(null, wx, cityResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
              wx, cityResult.surfaceY + 1, wz, 'static_tree', cityBirchTreeCenters, treeKey
            );
          }
        }
        if (cityInfo.transitionFactor === 0 && seededRandom(wx, wz, seed + 823) < CITY_FLOWER_BED_CHANCE) {
          const flowerBedKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 1);
          if (!nearMajorBuilding) {
            createStructureTask(
              generateFlowerBed.bind(null, wx, cityResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
              wx, cityResult.surfaceY + 1, wz, 'flower_bed', cityFlowerBedCenters, flowerBedKey
            );
          }
        }
        if (seededRandom(wx, wz, seed + 812) < 0.0007) {
          const houseKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 4);
          const nearOtherHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 12);
          const nearTree = isNearRecordedCenter(cityTreeCenters, wx, wz, 8);
          const nearTallTree = isNearRecordedCenter(cityTallTreeCenters, wx, wz, 10);
          if (!nearMajorBuilding && !nearOtherHouse && !nearTree && !nearTallTree) {
            createStructureTask(
              generateStructure.bind(null, 'house', wx, cityResult.surfaceY + 1, wz, fakeChunk, dPlaceholder, rovers),
              wx, cityResult.surfaceY + 1, wz, 'house', cityFillerHouseCenters, houseKey
            );
          }
        }
      } else if (inPyramid) {
        Pyramid.generate(wx, wz, h, pyInfo, fakeChunk, dPlaceholder);
      } else if (inIsland) {
        const islandResult = IslandMap.generate(wx, wz, h, islandInfo, fakeChunk, dPlaceholder, seed);
        const distanceFromCenter = islandInfo.distFromCenter;
        const towerExclusionRadius = 5;
        const waterRingMax = 15 + 4 + 20;
        if (distanceFromCenter > 15 + 4 && distanceFromCenter < waterRingMax) {
          const seaY = -2;
          const bedrockY = seaY - 11;
          for (let y = seaY - 1; y >= bedrockY; y--) {
            fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
          }
        }
        if (!islandResult && distanceFromCenter <= 15 + 4) {
          const seaY = -2;
          const bedrockY = seaY - 11;
          for (let y = seaY - 1; y >= bedrockY; y--) {
            fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
          }
        }
        if (islandResult && islandInfo.zone === 'core' && !islandResult.isBelowSeaLevel) {
          const isTowerCenter = wx === islandInfo.centerX && wz === islandInfo.centerZ;
          const towerCenterKey = `${islandInfo.centerX},${islandInfo.centerZ}`;
          if (isTowerCenter && !islandTowerCenters.has(towerCenterKey)) {
            createStructureTask(
              generateTower.bind(null, islandInfo.centerX, islandResult.surfaceY + 1, islandInfo.centerZ, fakeChunk, dPlaceholder),
              islandInfo.centerX, islandResult.surfaceY + 1, islandInfo.centerZ,
              'tower', islandTowerCenters, towerCenterKey
            );
          }
          const treeChance = seededRandom(wx, wz, seed + 100);
          const treeCount = islandInfo.transitionFactor === 0 ? (treeChance < 0.0015 ? 2 : treeChance < 0.003 ? 1 : 0) : 0;
          if (treeCount > 0) {
            for (let i = 0; i < treeCount; i++) {
              const treeOffsetX = Math.floor(seededRandom(i, i + 10, seed + 200) * 10) - 5;
              const treeOffsetZ = Math.floor(seededRandom(i + 5, i + 15, seed + 201) * 10) - 5;
              const treeX = wx + treeOffsetX;
              const treeZ = wz + treeOffsetZ;
              const treeY = islandResult.surfaceY + 1;
              const treeIslandInfo = IslandMap.getIslandInfo(treeX, treeZ, seed, terrainGen);
              const distFromTowerCenter = Math.max(Math.abs(treeX - islandInfo.centerX), Math.abs(treeZ - islandInfo.centerZ));
              if (treeIslandInfo && treeIslandInfo.zone === 'core' && distFromTowerCenter > towerExclusionRadius) {
                createStructureTask(
                  Tree.generate.bind(Tree, treeX, treeY, treeZ, fakeChunk, 'default', dPlaceholder),
                  treeX, treeY, treeZ, 'static_tree'
                );
              }
            }
          }
        }
      } else if (inPlainLand) {
        PlainLand.generate(wx, wz, h, plainLandInfo, fakeChunk, dPlaceholder);
        const isPyramidIslandCenter = wx === plainLandInfo.centerX && wz === plainLandInfo.centerZ;
        const pyramidIslandCenterKey = `${plainLandInfo.centerX},${plainLandInfo.centerZ}`;
        if (isPyramidIslandCenter && !plainLandCastleCenters.has(pyramidIslandCenterKey)) {
          createStructureTask(
            generatePyramidIsland.bind(null, plainLandInfo.centerX, plainLandInfo.centerY ? h + 1 : h + 1, plainLandInfo.centerZ, fakeChunk, dPlaceholder),
            plainLandInfo.centerX, h + 1, plainLandInfo.centerZ,
            'pyramidIsland', plainLandCastleCenters, pyramidIslandCenterKey
          );
        }
      } else if (inSnowLand) {
        const snowResult = SnowLand.generate(wx, wz, h, slInfo, fakeChunk, dPlaceholder);
        if (slInfo.transitionFactor === 0 && !snowResult.isBelowSeaLevel && seededRandom(wx, wz, seed + 10) < 0.002) {
          createStructureTask(
            generateBirchTreeWithSnow.bind(null, wx, snowResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
            wx, snowResult.surfaceY + 1, wz, 'static_tree'
          );
        }
      } else if (inFrozenMountain) {
        const fmResult = FrozenMountain.generate(wx, wz, h, fmInfo, fakeChunk, dPlaceholder);
        if (fmInfo.transitionFactor === 0 && !fmResult.isBelowSeaLevel && seededRandom(wx, wz, seed + 11) < 0.0010) {
          createStructureTask(
            generateBirchTreeWithSnow.bind(null, wx, fmResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
            wx, fmResult.surfaceY + 1, wz, 'static_tree'
          );
        }
      } else if (h < wLvl) {
        fakeChunk.add(wx, h, wz, 'sand', dPlaceholder);
        fakeChunk.add(wx, h - 1, wz, 'end_stone', dPlaceholder);
        if (activeBiome === 'SWAMP' && seededRandom(wx, wz, seed + 12) < 0.08) {
          fakeChunk.add(wx, wLvl + 0.5, wz, 'lilypad', dPlaceholder, false);
        }
        if (h < -6 && seededRandom(wx, wz, seed + 13) < 0.001 && safeForStructure) {
          structureQueue.push(() => generateStructure('ship', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers));
        }
      } else {
        let surf = 'grass', sub = 'dirt';
        if (activeBiome === 'DESERT') { surf = 'sand'; sub = 'sand'; }
        if (activeBiome === 'CITY') { surf = 'sand'; sub = 'sand'; }
        if (activeBiome === 'AZALEA') { surf = 'moss'; sub = 'dirt'; }
        if (activeBiome === 'SWAMP') { surf = 'swamp_grass'; sub = 'dirt'; }

        fakeChunk.add(wx, h, wz, surf, dPlaceholder);
        fakeChunk.add(wx, h - 1, wz, sub, dPlaceholder);

        for (let k = 2; k <= 12; k++) {
          if (k === 12) { fakeChunk.add(wx, h - k, wz, 'end_stone', dPlaceholder); continue; }
          if (k === 11) { fakeChunk.add(wx, h - k, wz, 'stone', dPlaceholder); continue; }
          let inRoom = false;
          for (const r of rooms) {
            if (wx >= r.minX && wx <= r.maxX && wz >= r.minZ && wz <= r.maxZ && k >= r.minY && k <= r.maxY) {
              inRoom = true;
              break;
            }
          }
          if (inRoom) continue;
          const blockRand = seededRandom(wx, wz, seed + 100 + k);
          const blockType = blockRand < 0.01 ? 'gold_ore' : 'stone';
          fakeChunk.add(wx, h - k, wz, blockType, dPlaceholder);
        }

        if (activeBiome === 'FOREST') {
          const forestRand = seededRandom(wx, wz, seed + 14);
          if (forestRand < 0.04) {
            if (seededRandom(wx, wz, seed + 15) < 0.15) {
              createStructureTask(generateYellowTree.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder), wx, h + 1, wz, 'static_tree');
            } else {
              if (seededRandom(wx, wz, seed + 16) < 0.1) {
                createStructureTask(generateBirchTree.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder), wx, h + 1, wz, 'static_tree');
              } else {
                const leafRand = seededRandom(wx, wz, seed + 17);
                const isYellow = leafRand < 0.1;
                const leafType = isYellow ? 'yellow_leaves' : null;
                const logRand = seededRandom(wx, wz, seed + 18);
                const isBirch = logRand < 0.1;
                const logType = isBirch ? 'birch_log' : null;
                createStructureTask(
                  Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'big', dPlaceholder, logType, leafType),
                  wx, h + 1, wz, 'static_tree'
                );
              }
            }
          } else if (forestRand < 0.10) {
            const plantRand = seededRandom(wx, wz, seed + 19);
            if (plantRand < 0.25) fakeChunk.add(wx, h + 1, wz, 'azure_bluet', dPlaceholder, false);
            else if (plantRand < 0.40) fakeChunk.add(wx, h + 1, wz, 'oxeye_daisy', dPlaceholder, false);
            else if (plantRand < 0.55) fakeChunk.add(wx, h + 1, wz, 'red_mushroom', dPlaceholder, false);
            else if (plantRand < 0.70) fakeChunk.add(wx, h + 1, wz, 'dead_bush', dPlaceholder, false);
          }
        } else if (activeBiome === 'AZALEA') {
          if (seededRandom(wx, wz, seed + 19) < 0.045) {
            createStructureTask(Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'azalea', dPlaceholder), wx, h + 1, wz, 'static_tree');
          }
        } else if (activeBiome === 'SWAMP') {
          if (seededRandom(wx, wz, seed + 20) < 0.03) {
            createStructureTask(Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'swamp', dPlaceholder), wx, h + 1, wz, 'static_tree');
          }
        } else if (activeBiome === 'DESERT') {
          let occupied = false;
          if (seededRandom(wx, wz, seed + 21) < 0.01) fakeChunk.add(wx, h + 1, wz, 'cactus', dPlaceholder);
          if (!occupied && isOccupiedForLargeStaticDesert(wx, wz, seed)) {
            fakeChunk.add(wx, h + 1, wz, 'dead_bush', dPlaceholder, false);
            occupied = true;
          }
          if (seededRandom(wx, wz, seed + 22) < 0.0005 && safeForStructure) {
            createStructureTask(
              generateStructure.bind(null, 'rover', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers),
              wx, h + 1, wz, 'rover'
            );
          }
          const largeStaticType = resolveLargeStaticStructureType({
            wx, wz, seed, biome: activeBiome,
            surfaceType: getSurfaceTypeByBiome(activeBiome),
            safeForStructure, occupied
          });
          if (largeStaticType === 'desertPyramid') {
            createStructureTask(generateDesertPyramid.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder), wx, h + 1, wz, 'desertPyramid');
            occupied = true;
          } else if (largeStaticType === 'desertVillage') {
            createStructureTask(generateDesertVillage.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder), wx, h + 1, wz, 'desertVillage');
            occupied = true;
          } else if (largeStaticType === 'uglyHouse') {
            createStructureTask(generateUglyHouse.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder), wx, h + 1, wz, 'uglyHouse');
            occupied = true;
          } else if (largeStaticType === 'whiteTower') {
            createStructureTask(generateWhiteTower.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder), wx, h + 1, wz, 'whiteTower');
            occupied = true;
          }
        } else if (activeBiome === 'CITY') {
          // City 区块边缘不额外生成装饰
        } else {
          let occupied = false;
          const spawnRand = seededRandom(wx, wz, seed);
          if (surf === 'grass' && spawnRand < 0.0005) {
            modGunMan.push({ x: wx, y: h + 1, z: wz });
            occupied = true;
          }
          if (!occupied && seededRandom(wx, wz, seed + 1) < 0.005) {
            createStructureTask(Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'default', dPlaceholder), wx, h + 1, wz, 'static_tree');
            occupied = true;
          }
          if (!occupied) {
            const randPlant = seededRandom(wx, wz, seed + 2);
            if (randPlant < 0.05) fakeChunk.add(wx, h + 1, wz, 'short_grass', dPlaceholder, false);
            else if (randPlant < 0.10) {
              const flowerRand = seededRandom(wx, wz, seed + 3);
              let flowerType = flowerRand < 0.33 ? 'allium' : flowerRand < 0.66 ? 'flower' : 'azure_bluet';
              fakeChunk.add(wx, h + 1, wz, flowerType, dPlaceholder, false);
            } else if (randPlant < 0.11) fakeChunk.add(wx, h + 1, wz, 'oxeye_daisy', dPlaceholder, false);
            else if (randPlant < 0.115) fakeChunk.add(wx, h + 1, wz, 'red_mushroom', dPlaceholder, false);
            else if (randPlant < 0.13) fakeChunk.add(wx, h + 1, wz, 'dead_bush', dPlaceholder, false);
          }
          if (seededRandom(wx, wz, seed + 4) < 0.001 && safeForStructure) {
            createStructureTask(
              generateStructure.bind(null, 'house', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers),
              wx, h + 1, wz, 'house'
            );
          }
          const largeStaticType = resolveLargeStaticStructureType({
            wx, wz, seed, biome: centerBiome,
            surfaceType: surf, safeForStructure, occupied
          });
          if (largeStaticType === 'tank') {
            createStructureTask(generateTank.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder), wx, h + 1, wz, 'tank');
            occupied = true;
          }
        }
      }

      if (terrainGen.shouldGenerateCloud(wx, wz)) {
        Cloud.generate(wx, 55, wz, fakeChunk, dPlaceholder);
      }
    }
  }

  // City 后置填充
  for (const candidate of cityCoreCandidates) {
    if (seededRandom(candidate.x, candidate.z, seed + 826) >= CITY_TALL_WELL_CHANCE) continue;
    queueCityTallWell(candidate.x, candidate.y, candidate.z);
  }
  for (const candidate of cityCoreCandidates) {
    if (seededRandom(candidate.x, candidate.z, seed + 824) >= CITY_PAVILION_CHANCE) continue;
    queueCityPavilion(candidate.x, candidate.y, candidate.z);
  }

  const cityCenterChunkX = cityLayout ? Math.floor(cityLayout.centerX / CHUNK_SIZE_LOCAL) : null;
  const cityCenterChunkZ = cityLayout ? Math.floor(cityLayout.centerZ / CHUNK_SIZE_LOCAL) : null;
  const shouldRunCityFallback = cityCenterChunkX === cx && cityCenterChunkZ === cz;
  if (!hasQueuedCityPavilion && cityCoreCandidates.length > 0 && shouldRunCityFallback) {
    const fallbackCandidates = cityCoreCandidates
      .map((c) => ({ ...c, score: seededRandom(c.x, c.z, seed + 825) }))
      .sort((a, b) => a.score - b.score);
    for (const candidate of fallbackCandidates) {
      if (queueCityPavilion(candidate.x, candidate.y, candidate.z)) break;
    }
  }
  if (!hasQueuedCityTallWell && cityCoreCandidates.length > 0 && seededRandom(cx, cz, seed + 828) < CITY_TALL_WELL_CHANCE) {
    const fallbackCandidates = cityCoreCandidates
      .map((c) => ({ ...c, score: seededRandom(c.x, c.z, seed + 827) }))
      .sort((a, b) => a.score - b.score);
    for (const candidate of fallbackCandidates) {
      if (queueCityTallWell(candidate.x, candidate.y, candidate.z)) break;
    }
  }

  const chunkRandom = (cx, cz, s) => {
    const val = Math.sin(cx * 12.9898 + cz * 78.233 + s) * 43758.5453123;
    return val - Math.floor(val);
  };

  if (chunkRandom(cx, cz, seed + 50) < 0.08) {
    const islandY = 40 + Math.floor(chunkRandom(cx, cz, seed + 51) * 30);
    const centerWx = cx * CHUNK_SIZE_LOCAL + 8;
    const centerWz = cz * CHUNK_SIZE_LOCAL + 8;
    Island.generate(centerWx, islandY, centerWz, fakeChunk, dPlaceholder);
    structureCenters.push({ type: 'island', x: centerWx, y: islandY, z: centerWz });
  }
  if (chunkRandom(cx, cz, seed + 52) < 0.20) {
    const startX = cx * CHUNK_SIZE_LOCAL + Math.floor(chunkRandom(cx, cz, seed + 53) * CHUNK_SIZE_LOCAL);
    const startZ = cz * CHUNK_SIZE_LOCAL + Math.floor(chunkRandom(cx, cz, seed + 54) * CHUNK_SIZE_LOCAL);
    const size = 30 + Math.floor(chunkRandom(cx, cz, seed + 55) * 21);
    Cloud.generateCluster(startX, 35, startZ, size, fakeChunk, dPlaceholder);
    structureCenters.push({ type: 'cloud', x: startX, y: 35, z: startZ });
  }

  // 执行结构生成队列
  structureQueueWithCenters.length = 0;
  for (const task of structureQueue) {
    structureQueueWithCenters.push({
      task,
      centerX: task.centerX, centerY: task.centerY, centerZ: task.centerZ, type: task.type
    });
  }

  const largeStaticTaskFactories = {
    bigHouse: (x, y, z) => () => generateBigHouse(x, y, z, fakeChunk, dPlaceholder),
    regularHouse1: (x, y, z) => () => generateRegularHouse1(x, y, z, fakeChunk, dPlaceholder),
    desertTempleTube: (x, y, z) => () => generateDesertTempleTube(x, y, z, fakeChunk, dPlaceholder),
    boxHouse: (x, y, z) => () => generateBoxHouse(x, y, z, fakeChunk, dPlaceholder),
    castle: (x, y, z) => () => generateCastle(x, y, z, fakeChunk, dPlaceholder),
    doubleTower: (x, y, z) => () => generateDoubleTower(x, y, z, fakeChunk, dPlaceholder),
    treeTower: (x, y, z) => () => generateTreeTower(x, y, z, fakeChunk, dPlaceholder),
    junglePyramid: (x, y, z) => () => generateJunglePyramid(x, y, z, fakeChunk, dPlaceholder),
    gate: (x, y, z) => () => generateGate(x, y, z, fakeChunk, dPlaceholder),
    pyramidIsland: (x, y, z) => () => generatePyramidIsland(x, y, z, fakeChunk, dPlaceholder),
    smallHouse: (x, y, z) => () => generateSmallHouse(x, y, z, fakeChunk, dPlaceholder),
    tank: (x, y, z) => () => generateTank(x, y, z, fakeChunk, dPlaceholder),
    tower: (x, y, z) => () => generateTower(x, y, z, fakeChunk, dPlaceholder),
    treeHouse: (x, y, z) => () => generateTreeHouse(x, y, z, fakeChunk, dPlaceholder),
    whiteTower: (x, y, z) => () => generateWhiteTower(x, y, z, fakeChunk, dPlaceholder),
    woodHouse: (x, y, z) => () => generateWoodHouse(x, y, z, fakeChunk, dPlaceholder),
    uglyHouse: (x, y, z) => () => generateUglyHouse(x, y, z, fakeChunk, dPlaceholder),
    desertVillage: (x, y, z) => () => generateDesertVillage(x, y, z, fakeChunk, dPlaceholder),
    desertPyramid: (x, y, z) => () => generateDesertPyramid(x, y, z, fakeChunk, dPlaceholder)
  };
  const appendLargeStaticTask = (type, centerX, centerY, centerZ) => {
    const dedupeKey = `${type}:${centerX},${centerY},${centerZ}`;
    if (largeStructureTaskKeySet.has(dedupeKey)) return;
    largeStructureTaskKeySet.add(dedupeKey);
    const createTask = largeStaticTaskFactories[type];
    if (!createTask) return;
    const task = createTask(centerX, centerY, centerZ);
    if (!task) return;
    task.centerX = centerX;
    task.centerY = centerY;
    task.centerZ = centerZ;
    task.type = type;
    structureQueueWithCenters.push({ task, centerX, centerY, centerZ, type });
  };
  const appendStaticTreeTask = (centerX, centerY, centerZ, treeType = 'default') => {
    const dedupeKey = `static_tree:${centerX},${centerY},${centerZ}`;
    if (largeStructureTaskKeySet.has(dedupeKey)) return;
    largeStructureTaskKeySet.add(dedupeKey);
    let task = null;
    if (treeType === 'azalea') {
      task = () => Tree.generate(centerX, centerY, centerZ, fakeChunk, 'azalea', dPlaceholder);
    } else if (treeType === 'swamp') {
      task = () => Tree.generate(centerX, centerY, centerZ, fakeChunk, 'swamp', dPlaceholder);
    } else {
      task = () => Tree.generate(centerX, centerY, centerZ, fakeChunk, 'default', dPlaceholder);
    }
    task.centerX = centerX;
    task.centerY = centerY;
    task.centerZ = centerZ;
    task.type = 'static_tree';
    structureQueueWithCenters.push({ task, centerX, centerY, centerZ, type: 'static_tree' });
  };

  // 使用结构候选索引查询大型静态结构
  const largeCandidates = candidateIndex.getCandidatesForChunk(cx, cz, seed, terrainGen);
  for (const candidate of largeCandidates) {
    appendLargeStaticTask(candidate.type, candidate.x, candidate.y, candidate.z);
  }
  const staticTreeCandidates = candidateIndex.getStaticTreeCandidatesForChunk(cx, cz, seed, terrainGen);
  for (const candidate of staticTreeCandidates) {
    appendStaticTreeTask(candidate.x, candidate.y, candidate.z, 'azalea');
  }

  structureQueueWithCenters.forEach(({ task }) => {
    task();
  });

  // --- 后处理（结构中心去重、方块数据构建、路由）---

  const structureCenterKeySet = new Set();
  const pushStructureCenter = (center) => {
    if (!center || !center.type || center.x === undefined || center.y === undefined || center.z === undefined) return;
    const centerKey = `${center.type}:${center.x},${center.y},${center.z}`;
    if (structureCenterKeySet.has(centerKey)) return;
    structureCenterKeySet.add(centerKey);
    structureCenters.push(center);
  };

  structureCenters.length = 0;
  structureQueueWithCenters.forEach(({ centerX, centerY, centerZ, type }) => {
    if (!type || centerX === undefined) return;
    pushStructureCenter({ type, x: centerX, y: centerY, z: centerZ });
  });

  // region 生成路径没有 snapshot，直接构建方块数据
  const blockDataBlocks = buildBlockDataBlocks(blockMap);
  const routing = buildChunkRouting(blockDataBlocks, [], cx, cz, []);

  return {
    blockDataBlocks,
    routing,
    modGunMan: [...modGunMan],
    rovers: [...rovers],
    structureCenters: [...structureCenters],
    entities: { modGunMan: [...modGunMan], rovers: [...rovers] }
  };
}

/**
 * 在 Worker 内部完成 region 内的 overflow 方块路由。
 * 替代主线程的 _mergeOverflowBlocks。
 */
function resolveOverflowWithinRegion(regionChunks, rx, rz, regionChunkSize) {
  let resolved = 0;
  let unresolved = 0;
  const unresolvedCoords = new Set();
  const unresolvedByDistance = new Map();

  const regionMinCx = rx * regionChunkSize;
  const regionMaxCx = regionMinCx + regionChunkSize - 1;
  const regionMinCz = rz * regionChunkSize;
  const regionMaxCz = regionMinCz + regionChunkSize - 1;

  // 为每个 chunk 建立 O(1) 查找表，避免 O(n²) 的 .find()
  const chunkBlockCodeSets = new Map();
  for (const [key, result] of Object.entries(regionChunks)) {
    if (!result.blockDataBlocks) continue;
    const codeSet = new Set();
    for (const block of result.blockDataBlocks) {
      codeSet.add(encodeCoord(block.x, block.y, block.z));
    }
    chunkBlockCodeSets.set(key, codeSet);
  }

  for (const [sourceKey, result] of Object.entries(regionChunks)) {
    if (!result.routing?.overflowChunks) continue;

    for (const overflowEntry of result.routing.overflowChunks) {
      const [targetCx, targetCz] = overflowEntry.chunkKey.split(',').map(Number);
      const isInRegion = (
        targetCx >= regionMinCx && targetCx <= regionMaxCx &&
        targetCz >= regionMinCz && targetCz <= regionMaxCz
      );

      if (!isInRegion) {
        const blockCount = overflowEntry.blockDataBlocks?.length || 0;
        unresolved += blockCount;
        const [sourceCx, sourceCz] = sourceKey.split(',').map(Number);
        const offsetKey = `${targetCx - sourceCx},${targetCz - sourceCz}`;
        unresolvedByDistance.set(offsetKey, (unresolvedByDistance.get(offsetKey) || 0) + blockCount);
        for (const block of (overflowEntry.blockDataBlocks || [])) {
          unresolvedCoords.add(encodeCoord(block.x, block.y, block.z));
        }
        continue;
      }

      const targetResult = regionChunks[overflowEntry.chunkKey];
      if (!targetResult) continue;

      const targetCodeSet = chunkBlockCodeSets.get(overflowEntry.chunkKey);
      if (!targetCodeSet) continue;

      for (const block of (overflowEntry.blockDataBlocks || [])) {
        const code = encodeCoord(block.x, block.y, block.z);
        if (targetCodeSet.has(code)) continue;

        targetResult.blockDataBlocks.push({
          x: block.x,
          y: block.y,
          z: block.z,
          type: block.type,
          orientation: block.orientation || 0
        });
        targetCodeSet.add(code);
        resolved++;
      }
    }
  }

  return {
    resolved,
    unresolved,
    uniqueUnresolvedCoords: unresolvedCoords.size,
    topDistanceBuckets: Array.from(unresolvedByDistance.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([offset, blocks]) => ({ offset, blocks }))
  };
}

/**
 * Region 级生成入口函数。
 * 在单个 worker 调用内同步循环生成整个 region 的所有 chunk，
 * 共享候选索引和去重集合，内部完成 overflow routing。
 */
async function handleRegionGeneration(data) {
  const { rx, rz, seed, taskId } = data;
  const REGION_CHUNK_SIZE = 8;

  // 1. Region 级共享状态
  const regionCandidateIndex = new StructureCandidateIndex();
  const regionLargeStructureTaskKeySet = new Set();
  const regionStructureQueueWithCenters = [];
  const regionStructureCenters = [];
  const regionModGunMan = [];
  const regionRovers = [];

  // 2. 逐个 chunk 同步生成
  const regionChunks = {};
  for (let localCx = 0; localCx < REGION_CHUNK_SIZE; localCx++) {
    for (let localCz = 0; localCz < REGION_CHUNK_SIZE; localCz++) {
      const cx = rx * REGION_CHUNK_SIZE + localCx;
      const cz = rz * REGION_CHUNK_SIZE + localCz;

      const chunkResult = generateChunkWithSharedState({
        cx, cz, seed,
        candidateIndex: regionCandidateIndex,
        largeStructureTaskKeySet: regionLargeStructureTaskKeySet,
        structureQueueWithCenters: regionStructureQueueWithCenters,
        structureCenters: regionStructureCenters,
        modGunMan: regionModGunMan,
        rovers: regionRovers
      });

      regionChunks[`${cx},${cz}`] = chunkResult;
    }
  }

  // 3. Worker 内部 overflow routing
  const routingDiagnostics = resolveOverflowWithinRegion(
    regionChunks, rx, rz, REGION_CHUNK_SIZE
  );

  // 4. 返回完整 region 结果
  postMessage({
    type: 'regionGenerated',
    rx, rz,
    chunks: regionChunks,
    routingDiagnostics,
    taskId
  });
}

onmessage = async function(e) {
  const { type = 'generateChunk' } = e.data;

  // Region 级生成：路由到专用处理函数
  if (type === 'generateRegion') {
    await handleRegionGeneration(e.data);
    return;
  }

  // 以下为现有的 chunk 级生成逻辑（generateChunk / consolidation 路径）
  const workerReceivedAt = performance.now();
  const {
    cx,
    cz,
    seed,
    snapshot,
    structureCenters: incomingStructureCenters,
    callbackKey,
    taskId,
    isOptimization = false,
    _consolidationRequestSentAt = 0,
    textureGroups = {},
    skipTerrainGeneration = false
  } = e.data;

  // 同步种子
  setSeed(seed);

  // 等待结构数据预加载完成（模块级 Promise，首个消息触发，后续消息直接返回）
  await structuresPreload;

  // 计算当前区块的范围 - 提前定义，供 snapshot 模式使用
  const minX = cx * CHUNK_SIZE;
  const maxX = (cx + 1) * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const maxZ = (cz + 1) * CHUNK_SIZE;

  // 使用数字编码 Map 暂存方块，确保同一位置后生成的方块覆盖旧方块
  const blockMap = new Map();
  let modGunMan = []; // 记录模型人 (gun_man.glb) 的位置
  let rovers = []; // 记录火星车的位置
  const structureQueue = []; // 结构生成队列，确保结构覆盖地形
  const structureCenters = []; // 结构中心点列表，用于跨 Chunk 渲染
  const islandTowerCenters = new Set(); // 记录海岛高塔中心，保证每座海岛只生成一次
  const plainLandCastleCenters = new Set(); // 记录平地城堡中心，保证每个平地只生成一次
  const cityStructureCenters = new Set(); // 记录 City 建筑中心，保证每栋建筑只入队一次
  const cityFillerHouseCenters = new Set(); // 记录 City 填充小屋中心
  const cityTreeCenters = new Set(); // 记录 City 普通树中心
  const cityTallTreeCenters = new Set(); // 记录 City 高树中心
  const citySwampTreeCenters = new Set(); // 记录 City 沼泽树中心
  const cityYellowTreeCenters = new Set(); // 记录 City 黄叶树中心
  const cityBirchTreeCenters = new Set(); // 记录 City brich_tree(JSON)中心
  const cityFlowerBedCenters = new Set(); // 记录 City 花坛中心
  const cityPavilionFootprintCells = new Set(); // 记录 City pavilion 预占地，防止重叠
  const cityTallWellFootprintCells = new Set(); // 记录 City tall_well 预占地，防止重叠
  const cityCoreCandidates = []; // 记录 City 核心区候选点（用于后置填充）

  // 模拟 Chunk 类的 add 方法 - 改为写入 blockMap
  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true, orientation = 0) => {
      const key = encodeCoord(x, y, z);

      // 关键修复：严格检查该位置是否已有方块
      // 规则：只要该位置已有任何非空气方块，就不允许再放置任何方块
      // 唯一例外：空气方块（用于挖掘/清除）可以放置
      const existing = blockMap.get(key);
      if (existing && existing.type !== 'air' && type !== 'air') {
        // 跳过，不覆盖已有方块（调试日志）
        // console.log(`[fakeChunk.add] SKIP: ${type} at ${key} (existing: ${existing.type})`);
        return;
      }
      blockMap.set(key, { x, y, z, type, solid, orientation });
    },
    getBlockType: (x, y, z) => {
      const key = encodeCoord(x, y, z);
      return blockMap.get(key)?.type || null;
    }
  };

  // 保存 snapshot 数据（如果有）
  let savedSnapshot = null;
  if (snapshot) {
    savedSnapshot = {
      blocks: snapshot.blocks ? { ...snapshot.blocks } : {},
      meta: snapshot.meta ? { ...snapshot.meta } : {},
      entities: snapshot.entities ? {
        modGunMan: snapshot.entities.modGunMan || [],
        rovers: snapshot.entities.rovers || [],
        zombieNests: snapshot.entities.zombieNests || [],
        staticTrees: snapshot.entities.staticTrees || []
      } : { modGunMan: [], rovers: [], zombieNests: [], staticTrees: [] }
    };
  }

  // P0 优化：consolidation 场景跳过地形重生成，直接用 snapshot.blocks 构建 blockMap。
  // 主线程的 blockData 是权威数据源，包含完整方块集，无需重新跑地形管线。
  // skipTerrainGeneration：存档加载路径，当 snapshot 完整时也跳过地形生成。
  let structureQueueWithCenters = []; // 在 if 块外声明，供后续代码引用
  if (!isOptimization && !skipTerrainGeneration) {
    // 地形生成：房间、CityMap、FrozenMountain、Pyramid 等所有结构放置
    const rooms = [];
    const roomSeed = Math.abs((cx * 73856093) ^ (cz * 19349663) ^ seed);
    let rRand = roomSeed;
    const nextRand = () => {
      rRand = (rRand * 1103515245 + 12345) & 0x7fffffff;
      return rRand / 0x7fffffff;
    };

  for (let i = 0; i < ROOMS_PER_CHUNK; i++) {
    const rx = Math.floor(nextRand() * CHUNK_SIZE);
    const rz = Math.floor(nextRand() * CHUNK_SIZE);
    const ry = 2 + Math.floor(nextRand() * 8);
    const rw = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    const rh = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    const rd = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    rooms.push({
      minX: cx * CHUNK_SIZE + rx - Math.floor(rw/2),
      maxX: cx * CHUNK_SIZE + rx + Math.floor(rw/2),
      minY: ry,
      maxY: ry + rh,
      minZ: cz * CHUNK_SIZE + rz - Math.floor(rd/2),
      maxZ: cz * CHUNK_SIZE + rz + Math.floor(rd/2)
    });
  }

  const centerBiome = terrainGen.getBiome(cx * CHUNK_SIZE, cz * CHUNK_SIZE);
  const cityLayout = CityMap.getCityLayout(seed, terrainGen);
  const cityPlacementMap = cityLayout?.placementMap || new Map();
  const cityFillerPlacementMap = cityLayout?.fillerPlacementMap || new Map();
  const dPlaceholder = {};
  /**
   * 创建结构生成任务并加入队列
   * 仅做入队与元信息挂载，不改变 taskFn 原有调用参数，保证行为不变
   * @param {Function} taskFn - 预先封装好的零参数任务函数
   * @param {number} centerX - 中心 X 坐标
   * @param {number} centerY - 中心 Y 坐标
   * @param {number} centerZ - 中心 Z 坐标
   * @param {string} type - 结构类型
   * @param {Set} [centers] - 可选的中心点集合（用于去重）
   * @param {string} [centerKey] - 可选的中心点键
   * @returns {Function} 创建的任务函数
   */
  function createStructureTask(taskFn, centerX, centerY, centerZ, type, centers = null, centerKey = null) {
    taskFn.centerX = centerX;
    taskFn.centerY = centerY;
    taskFn.centerZ = centerZ;
    taskFn.type = type;
    structureQueue.push(taskFn);

    if (centers && centerKey) {
      centers.add(centerKey);
    }

    return taskFn;
  }

  function isNearRecordedCenter(centerSet, x, z, minDist) {
    for (const key of centerSet) {
      const [cxVal, czVal] = key.split(',').map(Number);
      if (Math.max(Math.abs(cxVal - x), Math.abs(czVal - z)) < minDist) {
        return true;
      }
    }
    return false;
  }

  function getLoaderBottomFootprint(loader) {
    const data = loader?.getData?.();
    if (!data || !Array.isArray(data.blocks) || data.blocks.length === 0) return null;

    let minY = Infinity;
    for (const block of data.blocks) {
      if (block.y < minY) minY = block.y;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let count = 0;
    for (const block of data.blocks) {
      if (block.y !== minY) continue;
      if (block.x < minX) minX = block.x;
      if (block.x > maxX) maxX = block.x;
      if (block.z < minZ) minZ = block.z;
      if (block.z > maxZ) maxZ = block.z;
      count++;
    }

    if (count === 0) return null;
    return { minX, maxX, minZ, maxZ };
  }

  const pavilionFootprint = getLoaderBottomFootprint(pavilion) || { minX: -5, maxX: 5, minZ: -3, maxZ: 3 };
  const pavilionHalfX = Math.ceil(Math.max(Math.abs(pavilionFootprint.minX), Math.abs(pavilionFootprint.maxX)));
  const pavilionHalfZ = Math.ceil(Math.max(Math.abs(pavilionFootprint.minZ), Math.abs(pavilionFootprint.maxZ)));

  const tallWellFootprint = getLoaderBottomFootprint(tallWell) || { minX: -5, maxX: 5, minZ: -3, maxZ: 3 };
  const tallWellHalfX = Math.ceil(Math.max(Math.abs(tallWellFootprint.minX), Math.abs(tallWellFootprint.maxX)));
  const tallWellHalfZ = Math.ceil(Math.max(Math.abs(tallWellFootprint.minZ), Math.abs(tallWellFootprint.maxZ)));

  function collectPavilionFootprintCells(centerX, centerZ) {
    const cells = [];
    for (let ox = pavilionFootprint.minX; ox <= pavilionFootprint.maxX; ox++) {
      for (let oz = pavilionFootprint.minZ; oz <= pavilionFootprint.maxZ; oz++) {
        cells.push(`${centerX + ox},${centerZ + oz}`);
      }
    }
    return cells;
  }

  function isPavilionFootprintReserved(centerX, centerZ) {
    const cells = collectPavilionFootprintCells(centerX, centerZ);
    for (const key of cells) {
      if (cityPavilionFootprintCells.has(key)) return true;
    }
    return false;
  }

  function reservePavilionFootprint(centerX, centerZ) {
    const cells = collectPavilionFootprintCells(centerX, centerZ);
    for (const key of cells) {
      cityPavilionFootprintCells.add(key);
    }
  }

  function isPavilionSpaceClear(centerX, centerY, centerZ) {
    for (let ox = pavilionFootprint.minX; ox <= pavilionFootprint.maxX; ox++) {
      for (let oz = pavilionFootprint.minZ; oz <= pavilionFootprint.maxZ; oz++) {
        const wx = centerX + ox;
        const wz = centerZ + oz;
        const cellInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
        if (!cellInfo || cellInfo.transitionFactor > 0) return false;

        const surfaceY = CityMap.getCitySurfaceY(wx, wz, seed, terrainGen);
        if (surfaceY === null || Math.abs(surfaceY + 1 - centerY) > 1) return false;

        for (let y = centerY; y <= centerY + 2; y++) {
          if (fakeChunk.getBlockType(wx, y, wz)) return false;
        }
      }
    }
    return true;
  }

  function canPlaceCityPavilion(centerX, centerY, centerZ) {
    const pavilionRadius = Math.max(pavilionHalfX, pavilionHalfZ);
    const nearMajorBuilding = CityMap.isPointNearCityStructure(centerX, centerZ, seed, terrainGen, pavilionRadius + 1);
    const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, centerX, centerZ, pavilionRadius + 3);
    const nearFlowerBed = isNearRecordedCenter(cityFlowerBedCenters, centerX, centerZ, pavilionRadius + 5);
    const nearTree = isNearRecordedCenter(cityTreeCenters, centerX, centerZ, pavilionRadius + 4) ||
      isNearRecordedCenter(cityTallTreeCenters, centerX, centerZ, pavilionRadius + 5) ||
      isNearRecordedCenter(citySwampTreeCenters, centerX, centerZ, pavilionRadius + 4) ||
      isNearRecordedCenter(cityYellowTreeCenters, centerX, centerZ, pavilionRadius + 4) ||
      isNearRecordedCenter(cityBirchTreeCenters, centerX, centerZ, pavilionRadius + 4);

    if (nearMajorBuilding || nearFillerHouse || nearFlowerBed || nearTree) return false;
    if (isPavilionFootprintReserved(centerX, centerZ)) return false;

    return isPavilionSpaceClear(centerX, centerY, centerZ);
  }

  let hasQueuedCityPavilion = false;
  function queueCityPavilion(centerX, centerY, centerZ) {
    if (!canPlaceCityPavilion(centerX, centerY, centerZ)) return false;

    createStructureTask(
      generatePavilion.bind(null, centerX, centerY, centerZ, fakeChunk, dPlaceholder),
      centerX,
      centerY,
      centerZ,
      'pavilion'
    );
    reservePavilionFootprint(centerX, centerZ);
    hasQueuedCityPavilion = true;
    return true;
  }

  // Tall Well 辅助函数
  function collectTallWellFootprintCells(centerX, centerZ) {
    const cells = [];
    for (let ox = tallWellFootprint.minX; ox <= tallWellFootprint.maxX; ox++) {
      for (let oz = tallWellFootprint.minZ; oz <= tallWellFootprint.maxZ; oz++) {
        cells.push(`${centerX + ox},${centerZ + oz}`);
      }
    }
    return cells;
  }

  function isTallWellFootprintReserved(centerX, centerZ) {
    const cells = collectTallWellFootprintCells(centerX, centerZ);
    for (const key of cells) {
      if (cityTallWellFootprintCells.has(key)) return true;
    }
    return false;
  }

  function reserveTallWellFootprint(centerX, centerZ) {
    const cells = collectTallWellFootprintCells(centerX, centerZ);
    for (const key of cells) {
      cityTallWellFootprintCells.add(key);
    }
  }

  function isTallWellSpaceClear(centerX, centerY, centerZ) {
    for (let ox = tallWellFootprint.minX; ox <= tallWellFootprint.maxX; ox++) {
      for (let oz = tallWellFootprint.minZ; oz <= tallWellFootprint.maxZ; oz++) {
        const wx = centerX + ox;
        const wz = centerZ + oz;
        const cellInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
        if (!cellInfo || cellInfo.transitionFactor > 0) return false;

        const surfaceY = CityMap.getCitySurfaceY(wx, wz, seed, terrainGen);
        if (surfaceY === null || Math.abs(surfaceY + 1 - centerY) > 1) return false;

        for (let y = centerY; y <= centerY + 2; y++) {
          if (fakeChunk.getBlockType(wx, y, wz)) return false;
        }
      }
    }
    return true;
  }

  function canPlaceCityTallWell(centerX, centerY, centerZ) {
    const tallWellRadius = Math.max(tallWellHalfX, tallWellHalfZ);
    // 放宽距离检查：减小 buffer，允许更靠近其他结构
    const nearMajorBuilding = CityMap.isPointNearCityStructure(centerX, centerZ, seed, terrainGen, tallWellRadius);
    const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, centerX, centerZ, tallWellRadius + 1);
    const nearFlowerBed = isNearRecordedCenter(cityFlowerBedCenters, centerX, centerZ, tallWellRadius + 2);
    const nearTree = isNearRecordedCenter(cityTreeCenters, centerX, centerZ, tallWellRadius + 2) ||
      isNearRecordedCenter(cityTallTreeCenters, centerX, centerZ, tallWellRadius + 3) ||
      isNearRecordedCenter(citySwampTreeCenters, centerX, centerZ, tallWellRadius + 2) ||
      isNearRecordedCenter(cityYellowTreeCenters, centerX, centerZ, tallWellRadius + 2) ||
      isNearRecordedCenter(cityBirchTreeCenters, centerX, centerZ, tallWellRadius + 2);

    // 放宽：不检查 pavilion footprint，允许 tall_well 在 pavilion 附近生成
    // 但检查主要建筑距离避免重叠
    if (nearMajorBuilding || nearFillerHouse || nearFlowerBed || nearTree) return false;
    if (isTallWellFootprintReserved(centerX, centerZ)) return false;

    return isTallWellSpaceClear(centerX, centerY, centerZ);
  }

  let hasQueuedCityTallWell = false;
  function queueCityTallWell(centerX, centerY, centerZ) {
    if (!canPlaceCityTallWell(centerX, centerY, centerZ)) return false;

    createStructureTask(
      generateTallWell.bind(null, centerX, centerY, centerZ, fakeChunk, dPlaceholder),
      centerX,
      centerY,
      centerZ,
      'tall_well'
    );
    reserveTallWellFootprint(centerX, centerZ);
    hasQueuedCityTallWell = true;
    return true;
  }

  function generateTallWell(x, y, z, chunk, dObj) {
    tallWell.generate(x, y, z, chunk, dObj, true);
  }

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const wLvl = -2;
      const safeForStructure = x >= 3 && x <= 12 && z >= 3 && z <= 12;

      // 检查当前坐标是否在金字塔范围内
      const pyInfo = Pyramid.getPyramidInfo(wx, wz, seed, terrainGen);
      const inPyramid = pyInfo !== null;

      // 检查当前坐标是否在雪地范围内
      const slInfo = SnowLand.getSnowLandInfo(wx, wz, seed, terrainGen);
      const inSnowLand = slInfo !== null;

      // 检查当前坐标是否在冰封山峰范围内
      const fmInfo = FrozenMountain.getFrozenMountainInfo(wx, wz, seed, terrainGen);
      const inFrozenMountain = fmInfo !== null;

      // 检查当前坐标是否在海岛范围内
      const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
      const inIsland = islandInfo !== null;

      // 检查当前坐标是否在平地范围内（城堡专用地形）
      const plainLandInfo = PlainLand.getPlainLandInfo(wx, wz, seed, terrainGen);
      const inPlainLand = plainLandInfo !== null;
      const cityInfo = CityMap.getCityInfo(wx, wz, seed, terrainGen);
      const inCity = cityInfo !== null;
      const baseBiomeAtPos = getBaseBiome(wx, wz);
      const activeBiome = (centerBiome === 'CITY' && !inCity) ? baseBiomeAtPos : centerBiome;
      const h = terrainGen.generateHeight(wx, wz, activeBiome);

      if (inCity) {
        const cityResult = CityMap.generate(wx, wz, h, cityInfo, fakeChunk, dPlaceholder, seed, terrainGen);
        if (cityInfo.transitionFactor === 0) {
          cityCoreCandidates.push({ x: wx, y: cityResult.surfaceY + 1, z: wz });
        }
        const cityStructure = cityPlacementMap.get(`${wx},${wz}`) || cityFillerPlacementMap.get(`${wx},${wz}`) || null;
        if (cityStructure && !cityStructureCenters.has(cityStructure.id)) {
          const centerY = cityResult.surfaceY + 1;
          const centerKey = cityStructure.id;
          const taskFactories = {
            castle: generateCastle,
            bigHouse: generateBigHouse,
            regularHouse1: generateRegularHouse1,
            desertTempleTube: generateDesertTempleTube,
            boxHouse: generateBoxHouse,
            desertVillage: generateDesertVillage,
            doubleTower: generateDoubleTower,
            treeTower: generateTreeTower,
            junglePyramid: generateJunglePyramid,
            tank: generateTank,
            gate: generateGate,
            pyramidIsland: generatePyramidIsland,
            smallHouse: generateSmallHouse,
            tower: generateTower,
            treeHouse: generateTreeHouse,
            uglyHouse: generateUglyHouse,
            whiteTower: generateWhiteTower,
            woodHouse: generateWoodHouse
          };
          const factory = taskFactories[cityStructure.type];
          if (factory) {
            createStructureTask(
              factory.bind(null, cityStructure.x, centerY, cityStructure.z, fakeChunk, dPlaceholder),
              cityStructure.x,
              centerY,
              cityStructure.z,
              cityStructure.type,
              cityStructureCenters,
              centerKey
            );
          }
        }

        // City 内新增：普通树（比草地略多，但不过密）
        if (seededRandom(wx, wz, seed + 800) < 0.0044) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherTree = isNearRecordedCenter(cityTreeCenters, wx, wz, 6);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherTree) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'default', dPlaceholder),
              wx,
              cityResult.surfaceY + 1,
              wz,
              'static_tree',
              cityTreeCenters,
              treeKey
            );
          }
        }

        // City 内新增：高树（森林风格大树，密度低于森林）
        if (seededRandom(wx, wz, seed + 801) < 0.0017) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 3);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 10);
          const nearOtherTree = isNearRecordedCenter(cityTreeCenters, wx, wz, 7);
          const nearOtherTallTree = isNearRecordedCenter(cityTallTreeCenters, wx, wz, 10);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherTree && !nearOtherTallTree) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'big', dPlaceholder),
              wx,
              cityResult.surfaceY + 1,
              wz,
              'static_tree',
              cityTallTreeCenters,
              treeKey
            );
          }
        }

        // City 内新增：沼泽树（与普通树同等密度）
        if (seededRandom(wx, wz, seed + 803) < 0.0044) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherSwamp = isNearRecordedCenter(citySwampTreeCenters, wx, wz, 7);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherSwamp) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'swamp', dPlaceholder),
              wx,
              cityResult.surfaceY + 1,
              wz,
              'static_tree',
              citySwampTreeCenters,
              treeKey
            );
          }
        }

        // City 内新增：黄叶树（普通树一半密度）
        if (seededRandom(wx, wz, seed + 804) < 0.0022) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherYellow = isNearRecordedCenter(cityYellowTreeCenters, wx, wz, 7);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherYellow) {
            createStructureTask(
              Tree.generate.bind(Tree, wx, cityResult.surfaceY + 1, wz, fakeChunk, 'big', dPlaceholder, null, 'yellow_leaves'),
              wx,
              cityResult.surfaceY + 1,
              wz,
              'static_tree',
              cityYellowTreeCenters,
              treeKey
            );
          }
        }

        // City 内新增：brich_tree(JSON)（普通树三分之一密度）
        if (seededRandom(wx, wz, seed + 805) < 0.00147) {
          const treeKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 2);
          const nearFillerHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 8);
          const nearOtherBirch = isNearRecordedCenter(cityBirchTreeCenters, wx, wz, 7);
          if (!nearMajorBuilding && !nearFillerHouse && !nearOtherBirch) {
            createStructureTask(
              generateBirchTree.bind(null, wx, cityResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
              wx,
              cityResult.surfaceY + 1,
              wz,
              'static_tree',
              cityBirchTreeCenters,
              treeKey
            );
          }
        }

        // City 内新增：花坛（flower_bed），填充建筑间空白
        // 概率 0.0005，padding 减小到 1，只在核心区域生成
        if (cityInfo.transitionFactor === 0 && seededRandom(wx, wz, seed + 823) < CITY_FLOWER_BED_CHANCE) {
          const flowerBedKey = `${wx},${wz}`;
          // 只检查是否靠近主要建筑（1格缓冲），不与其他任何结构进行距离测算
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 1);
          if (!nearMajorBuilding) {
            createStructureTask(
              generateFlowerBed.bind(null, wx, cityResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
              wx,
              cityResult.surfaceY + 1,
              wz,
              'flower_bed',
              cityFlowerBedCenters,
              flowerBedKey
            );
          }
        }

        // City 内新增：少量普通小屋穿插，增强填充感
        if (seededRandom(wx, wz, seed + 812) < 0.0007) {
          const houseKey = `${wx},${wz}`;
          const nearMajorBuilding = CityMap.isPointNearCityStructure(wx, wz, seed, terrainGen, 4);
          const nearOtherHouse = isNearRecordedCenter(cityFillerHouseCenters, wx, wz, 12);
          const nearTree = isNearRecordedCenter(cityTreeCenters, wx, wz, 8);
          const nearTallTree = isNearRecordedCenter(cityTallTreeCenters, wx, wz, 10);
          if (!nearMajorBuilding && !nearOtherHouse && !nearTree && !nearTallTree) {
            createStructureTask(
              generateStructure.bind(null, 'house', wx, cityResult.surfaceY + 1, wz, fakeChunk, dPlaceholder, rovers),
              wx,
              cityResult.surfaceY + 1,
              wz,
              'house',
              cityFillerHouseCenters,
              houseKey
            );
          }
        }
      } else if (inPyramid) {
        Pyramid.generate(wx, wz, h, pyInfo, fakeChunk, dPlaceholder);

        // 金字塔区域不生成其他结构（树、房屋等），但云需要正常生成
        // 跳过后续的地表装饰生成，继续执行云生成逻辑
      } else if (inIsland) {
        // 海岛生成逻辑
        const islandResult = IslandMap.generate(wx, wz, h, islandInfo, fakeChunk, dPlaceholder, seed);
        const distanceFromCenter = islandInfo.distFromCenter;
        const towerExclusionRadius = 5;
        const waterRingMax = 15 + 4 + 20; // 海岛半径 + 过渡带 + 海水环

        // 在海岛四周强制生成沙块填充（确保与大陆隔离至少 20 格）
        // 海水是用大平面模拟的，水下需要沙块填充来避免虚空裂缝
        if (distanceFromCenter > 15 + 4 && distanceFromCenter < waterRingMax) {
          // 海水环区域：从海平面下方一直填充沙块到基岩层
          const seaY = -2; // 海平面
          const bedrockY = seaY - 11; // 基岩层在海平面下方 11 格（与普通地形一致）
          for (let y = seaY - 1; y >= bedrockY; y--) {
            fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
          }
        }

        // 如果海岛生成失败（由于形状噪声排除），但在过渡带内，用沙块填充
        if (!islandResult && distanceFromCenter <= 15 + 4) {
          // 过渡带区域：从海平面下方用沙块填充到基岩层
          const seaY = -2;
          const bedrockY = seaY - 11; // 基岩层在海平面下方 11 格
          for (let y = seaY - 1; y >= bedrockY; y--) {
            fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
          }
        }

        // 在海岛主体区域生成树木（减少概率，每座海岛约 1 棵）
        if (islandResult && islandInfo.zone === 'core' && !islandResult.isBelowSeaLevel) {
          const isTowerCenter = wx === islandInfo.centerX && wz === islandInfo.centerZ;
          const towerCenterKey = `${islandInfo.centerX},${islandInfo.centerZ}`;

          if (isTowerCenter && !islandTowerCenters.has(towerCenterKey)) {
            createStructureTask(
              generateTower.bind(null, islandInfo.centerX, islandResult.surfaceY + 1, islandInfo.centerZ, fakeChunk, dPlaceholder),
              islandInfo.centerX,
              islandResult.surfaceY + 1,
              islandInfo.centerZ,
              'tower',
              islandTowerCenters,
              towerCenterKey
            );
          }

          // 使用区块级别的确定性随机来决定是否生成树木
          const treeChance = seededRandom(wx, wz, seed + 100);
          const treeCount = islandInfo.transitionFactor === 0 ? (treeChance < 0.0015 ? 2 : treeChance < 0.003 ? 1 : 0) : 0;

          if (treeCount > 0) {
            // 生成树木
            for (let i = 0; i < treeCount; i++) {
              const treeOffsetX = Math.floor(seededRandom(i, i + 10, seed + 200) * 10) - 5;
              const treeOffsetZ = Math.floor(seededRandom(i + 5, i + 15, seed + 201) * 10) - 5;
              const treeX = wx + treeOffsetX;
              const treeZ = wz + treeOffsetZ;
              const treeY = islandResult.surfaceY + 1;

              // 检查树木位置是否在海岛范围内
              const treeIslandInfo = IslandMap.getIslandInfo(treeX, treeZ, seed, terrainGen);
              const distFromTowerCenter = Math.max(
                Math.abs(treeX - islandInfo.centerX),
                Math.abs(treeZ - islandInfo.centerZ)
              );
              if (treeIslandInfo && treeIslandInfo.zone === 'core' && distFromTowerCenter > towerExclusionRadius) {
                createStructureTask(
                  Tree.generate.bind(Tree, treeX, treeY, treeZ, fakeChunk, 'default', dPlaceholder),
                  treeX,
                  treeY,
                  treeZ,
                  'static_tree'
                );
              }
            }
          }

        }
      } else if (inPlainLand) {
        // 平地生成逻辑（规则正方形 + 完全平坦）
        const plainLandResult = PlainLand.generate(wx, wz, h, plainLandInfo, fakeChunk, dPlaceholder);

        // 每块平地唯一生成一个 pyramid_island，固定在中心
        const isPyramidIslandCenter = wx === plainLandInfo.centerX && wz === plainLandInfo.centerZ;
        const pyramidIslandCenterKey = `${plainLandInfo.centerX},${plainLandInfo.centerZ}`;
        if (isPyramidIslandCenter && !plainLandCastleCenters.has(pyramidIslandCenterKey)) {
          createStructureTask(
            generatePyramidIsland.bind(null, plainLandInfo.centerX, plainLandResult.surfaceY + 1, plainLandInfo.centerZ, fakeChunk, dPlaceholder),
            plainLandInfo.centerX,
            plainLandResult.surfaceY + 1,
            plainLandInfo.centerZ,
            'pyramidIsland',
            plainLandCastleCenters,
            pyramidIslandCenterKey
          );
        }
      } else if (inSnowLand) {
        const snowResult = SnowLand.generate(wx, wz, h, slInfo, fakeChunk, dPlaceholder);
        // 在雪地以 0.002 概率生成带雪白桦树（仅在主体区域且不在海平面以下）
        if (slInfo.transitionFactor === 0 && !snowResult.isBelowSeaLevel && seededRandom(wx, wz, seed + 10) < 0.002) {
          createStructureTask(
            generateBirchTreeWithSnow.bind(null, wx, snowResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
            wx,
            snowResult.surfaceY + 1,
            wz,
            'static_tree'
          );
        }
      } else if (inFrozenMountain) {
        const fmResult = FrozenMountain.generate(wx, wz, h, fmInfo, fakeChunk, dPlaceholder);
        // 在冰封山峰以 0.0010 概率生成带雪白桦树（仅在主体区域且不在海平面以下）
        if (fmInfo.transitionFactor === 0 && !fmResult.isBelowSeaLevel && seededRandom(wx, wz, seed + 11) < 0.0010) {
          createStructureTask(
            generateBirchTreeWithSnow.bind(null, wx, fmResult.surfaceY + 1, wz, fakeChunk, dPlaceholder),
            wx,
            fmResult.surfaceY + 1,
            wz,
            'static_tree'
          );
        }
      } else if (h < wLvl) {
        fakeChunk.add(wx, h, wz, 'sand', dPlaceholder);
        fakeChunk.add(wx, h - 1, wz, 'end_stone', dPlaceholder);
        if (activeBiome === 'SWAMP' && seededRandom(wx, wz, seed + 12) < 0.08) {
          fakeChunk.add(wx, wLvl + 0.5, wz, 'lilypad', dPlaceholder, false);
        }
        if (h < -6 && seededRandom(wx, wz, seed + 13) < 0.001 && safeForStructure) {
          structureQueue.push(() => generateStructure('ship', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers));
        }
      } else {
        let surf = 'grass', sub = 'dirt';
        if (activeBiome === 'DESERT') { surf = 'sand'; sub = 'sand'; }
        if (activeBiome === 'CITY') { surf = 'sand'; sub = 'sand'; }
        if (activeBiome === 'AZALEA') { surf = 'moss'; sub = 'dirt'; }
        if (activeBiome === 'SWAMP') { surf = 'swamp_grass'; sub = 'dirt'; }

        fakeChunk.add(wx, h, wz, surf, dPlaceholder);
        fakeChunk.add(wx, h - 1, wz, sub, dPlaceholder);

        for (let k = 2; k <= 12; k++) {
          if (k === 12) {
            fakeChunk.add(wx, h - k, wz, 'end_stone', dPlaceholder);
            continue;
          }
          if (k === 11) {
            fakeChunk.add(wx, h - k, wz, 'stone', dPlaceholder);
            continue;
          }
          let inRoom = false;
          for (const r of rooms) {
            if (wx >= r.minX && wx <= r.maxX && wz >= r.minZ && wz <= r.maxZ && k >= r.minY && k <= r.maxY) {
              inRoom = true;
              break;
            }
          }
          if (inRoom) continue;
          const blockRand = seededRandom(wx, wz, seed + 100 + k);
          const blockType = blockRand < 0.01 ? 'gold_ore' : 'stone';
          fakeChunk.add(wx, h - k, wz, blockType, dPlaceholder);
        }

        if (activeBiome === 'FOREST') {
          const forestRand = seededRandom(wx, wz, seed + 14);
          if (forestRand < 0.04) {
            if (seededRandom(wx, wz, seed + 15) < 0.15) {
              // 黄叶子大树（替代 RealisticTree）
              createStructureTask(
                generateYellowTree.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
                wx, h + 1, wz, 'static_tree'
              );
            } else {
              // 10% 概率生成白桦树，90% 概率生成普通大树
              if (seededRandom(wx, wz, seed + 16) < 0.1) {
                // 放入队列，确保在地形生成完成后执行，避免方块重叠
                createStructureTask(
                  generateBirchTree.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
                  wx,
                  h + 1,
                  wz,
                  'static_tree'
                );
              } else {
                const leafRand = seededRandom(wx, wz, seed + 17);
                const isYellow = leafRand < 0.1;
                const leafType = isYellow ? 'yellow_leaves' : null;
                const logRand = seededRandom(wx, wz, seed + 18);
                const isBirch = logRand < 0.1;
                const logType = isBirch ? 'birch_log' : null;
                // 放入队列，确保在地形生成完成后执行，避免方块重叠
                createStructureTask(
                  Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'big', dPlaceholder, logType, leafType),
                  wx,
                  h + 1,
                  wz,
                  'static_tree'
                );
              }
            }
          } else if (forestRand < 0.10) {
            // 在森林中生成更多的新植物
            const plantRand = seededRandom(wx, wz, seed + 19);
            if (plantRand < 0.25) {
              fakeChunk.add(wx, h + 1, wz, 'azure_bluet', dPlaceholder, false);
            } else if (plantRand < 0.40) {
              fakeChunk.add(wx, h + 1, wz, 'oxeye_daisy', dPlaceholder, false);
            } else if (plantRand < 0.55) {
              fakeChunk.add(wx, h + 1, wz, 'red_mushroom', dPlaceholder, false);
            } else if (plantRand < 0.70) {
              fakeChunk.add(wx, h + 1, wz, 'dead_bush', dPlaceholder, false);
            }
          }
        } else if (activeBiome === 'AZALEA') {
          if (seededRandom(wx, wz, seed + 19) < 0.045) {
            // 放入队列，确保在地形生成完成后执行，避免方块重叠
            createStructureTask(
              Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'azalea', dPlaceholder),
              wx,
              h + 1,
              wz,
              'static_tree'
            );
          }
        } else if (activeBiome === 'SWAMP') {
          if (seededRandom(wx, wz, seed + 20) < 0.03) {
            // 放入队列，确保在地形生成完成后执行，避免方块重叠
            createStructureTask(
              Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'swamp', dPlaceholder),
              wx,
              h + 1,
              wz,
              'static_tree'
            );
          }
        } else if (activeBiome === 'DESERT') {
          let occupied = false;
          if (seededRandom(wx, wz, seed + 21) < 0.01) fakeChunk.add(wx, h + 1, wz, 'cactus', dPlaceholder);
          // 沙漠中生成少量 dead_bush
          if (!occupied && isOccupiedForLargeStaticDesert(wx, wz, seed)) {
            fakeChunk.add(wx, h + 1, wz, 'dead_bush', dPlaceholder, false);
            occupied = true;
          }
          if (seededRandom(wx, wz, seed + 22) < 0.0005 && safeForStructure) {
            createStructureTask(
              generateStructure.bind(null, 'rover', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers),
              wx,
              h + 1,
              wz,
              'rover'
            );
          }
          const largeStaticType = resolveLargeStaticStructureType({
            wx,
            wz,
            seed,
            biome: activeBiome,
            surfaceType: getSurfaceTypeByBiome(activeBiome),
            safeForStructure,
            occupied
          });
          if (largeStaticType === 'desertPyramid') {
            createStructureTask(
              generateDesertPyramid.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
              wx,
              h + 1,
              wz,
              'desertPyramid'
            );
            occupied = true;
          } else if (largeStaticType === 'desertVillage') {
            createStructureTask(
              generateDesertVillage.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
              wx,
              h + 1,
              wz,
              'desertVillage'
            );
            occupied = true;
          } else if (largeStaticType === 'uglyHouse') {
            createStructureTask(
              generateUglyHouse.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
              wx,
              h + 1,
              wz,
              'uglyHouse'
            );
            occupied = true;
          } else if (largeStaticType === 'whiteTower') {
            createStructureTask(
              generateWhiteTower.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
              wx,
              h + 1,
              wz,
              'whiteTower'
            );
            occupied = true;
          }
        } else if (activeBiome === 'CITY') {
          // City 区块边缘（不在 City 主区域时）不额外生成草丛/模型人等装饰
        } else {
          let occupied = false;
          const spawnRand = seededRandom(wx, wz, seed);
          if (surf === 'grass' && spawnRand < 0.0005) {
            modGunMan.push({ x: wx, y: h + 1, z: wz });
            occupied = true;
          }
          if (!occupied && seededRandom(wx, wz, seed + 1) < 0.005) {
            // 放入队列，确保在地形生成完成后执行，避免方块重叠
            createStructureTask(
              Tree.generate.bind(Tree, wx, h + 1, wz, fakeChunk, 'default', dPlaceholder),
              wx,
              h + 1,
              wz,
              'static_tree'
            );
            occupied = true;
          }
          if (!occupied) {
            const randPlant = seededRandom(wx, wz, seed + 2);
            if (randPlant < 0.05) {
              fakeChunk.add(wx, h + 1, wz, 'short_grass', dPlaceholder, false);
            } else if (randPlant < 0.10) {
              // 花朵类型：allium、普通flower、azure_bluet
              const flowerRand = seededRandom(wx, wz, seed + 3);
              let flowerType;
              if (flowerRand < 0.33) {
                flowerType = 'allium';
              } else if (flowerRand < 0.66) {
                flowerType = 'flower';
              } else {
                flowerType = 'azure_bluet';
              }
              fakeChunk.add(wx, h + 1, wz, flowerType, dPlaceholder, false);
            } else if (randPlant < 0.11) {
              // 少量生成 oxeye_daisy（1%概率）
              fakeChunk.add(wx, h + 1, wz, 'oxeye_daisy', dPlaceholder, false);
            } else if (randPlant < 0.115) {
              // 少量生成 red_mushroom（0.5%概率）
              fakeChunk.add(wx, h + 1, wz, 'red_mushroom', dPlaceholder, false);
            } else if (randPlant < 0.13) {
              // 少量生成 dead_bush（1.5%概率）
              fakeChunk.add(wx, h + 1, wz, 'dead_bush', dPlaceholder, false);
            }
          }
          if (seededRandom(wx, wz, seed + 4) < 0.001 && safeForStructure) {
            createStructureTask(
              generateStructure.bind(null, 'house', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers),
              wx,
              h + 1,
              wz,
              'house'
            );
          }
          const largeStaticType = resolveLargeStaticStructureType({
            wx,
            wz,
            seed,
            biome: centerBiome,
            surfaceType: surf,
            safeForStructure,
            occupied
          });
          // 在草地上生成坦克（低概率，确保不与其他物体重叠）
          if (largeStaticType === 'tank') {
            createStructureTask(
              generateTank.bind(null, wx, h + 1, wz, fakeChunk, dPlaceholder),
              wx,
              h + 1,
              wz,
              'tank'
            );
            occupied = true;
          }
        }
      }
      if (terrainGen.shouldGenerateCloud(wx, wz)) {
        Cloud.generate(wx, 55, wz, fakeChunk, dPlaceholder);
      }
    }
  }

  // City 后置填充：在树木/花坛候选完成后，先尝试生成 tall_well（概率更高）
  for (const candidate of cityCoreCandidates) {
    if (seededRandom(candidate.x, candidate.z, seed + 826) >= CITY_TALL_WELL_CHANCE) continue;
    queueCityTallWell(candidate.x, candidate.y, candidate.z);
  }

  // City 后置填充：在 tall_well 之后生成 pavilion
  for (const candidate of cityCoreCandidates) {
    if (seededRandom(candidate.x, candidate.z, seed + 824) >= CITY_PAVILION_CHANCE) continue;
    queueCityPavilion(candidate.x, candidate.y, candidate.z);
  }

  // 兜底：若本 Chunk 未成功生成 pavilion，强制在核心区找一个可放置空地生成一次
  const cityCenterChunkX = cityLayout ? Math.floor(cityLayout.centerX / CHUNK_SIZE) : null;
  const cityCenterChunkZ = cityLayout ? Math.floor(cityLayout.centerZ / CHUNK_SIZE) : null;
  const shouldRunCityFallback = cityCenterChunkX === cx && cityCenterChunkZ === cz;
  if (!hasQueuedCityPavilion && cityCoreCandidates.length > 0 && shouldRunCityFallback) {
    const fallbackCandidates = cityCoreCandidates
      .map((candidate) => ({
        ...candidate,
        score: seededRandom(candidate.x, candidate.z, seed + 825)
      }))
      .sort((a, b) => a.score - b.score);

    for (const candidate of fallbackCandidates) {
      if (queueCityPavilion(candidate.x, candidate.y, candidate.z)) {
        break;
      }
    }
  }

  // 兜底：若本 Chunk 未成功生成 tall_well，在 City 区块中尝试强制生成（需通过概率检查）
  if (!hasQueuedCityTallWell && cityCoreCandidates.length > 0 &&
      seededRandom(cx, cz, seed + 828) < CITY_TALL_WELL_CHANCE) {
    const fallbackCandidates = cityCoreCandidates
      .map((candidate) => ({
        ...candidate,
        score: seededRandom(candidate.x, candidate.z, seed + 827)
      }))
      .sort((a, b) => a.score - b.score);

    for (const candidate of fallbackCandidates) {
      if (queueCityTallWell(candidate.x, candidate.y, candidate.z)) {
        break;
      }
    }
  }

  // 使用基于区块坐标的确定性随机数
  const chunkRandom = (cx, cz, s) => {
    const val = Math.sin(cx * 12.9898 + cz * 78.233 + s) * 43758.5453123;
    return val - Math.floor(val);
  };

  if (chunkRandom(cx, cz, seed + 50) < 0.08) {
    const islandY = 40 + Math.floor(chunkRandom(cx, cz, seed + 51) * 30);
    const centerWx = cx * CHUNK_SIZE + 8;
    const centerWz = cz * CHUNK_SIZE + 8;
    Island.generate(centerWx, islandY, centerWz, fakeChunk, dPlaceholder);
    // 注册空岛结构中心，用于跨Chunk渲染
    structureCenters.push({ type: 'island', x: centerWx, y: islandY, z: centerWz });
  }
  if (chunkRandom(cx, cz, seed + 52) < 0.20) {
    const startX = cx * CHUNK_SIZE + Math.floor(chunkRandom(cx, cz, seed + 53) * CHUNK_SIZE);
    const startZ = cz * CHUNK_SIZE + Math.floor(chunkRandom(cx, cz, seed + 54) * CHUNK_SIZE);
    const size = 30 + Math.floor(chunkRandom(cx, cz, seed + 55) * 21);
    Cloud.generateCluster(startX, 35, startZ, size, fakeChunk, dPlaceholder);
    // 注册云朵结构中心，用于跨Chunk渲染
    structureCenters.push({ type: 'cloud', x: startX, y: 35, z: startZ });
  }

  // 执行结构生成队列，并记录大型结构的中心点
  // structureCenters 需要在生成结构时同步更新
  structureQueueWithCenters = structureQueue.map(task => {
    // 尝试从任务中提取中心点（通过预存储的方式）
    return { task, centerX: task.centerX, centerY: task.centerY, centerZ: task.centerZ, type: task.type };
  });

  // 大型静态结构邻域重建：
  // 让每个 Chunk 都能拿到“落在自己坐标内”的结构分片，避免中心 Chunk 卸载导致整栋闪灭/切割
  const largeStructureTaskKeySet = new Set(
    structureQueueWithCenters
      .filter(item => item.type)
      .map(item => `${item.type}:${item.centerX},${item.centerY},${item.centerZ}`)
  );
  const largeStaticTaskFactories = {
    bigHouse: (x, y, z) => () => generateBigHouse(x, y, z, fakeChunk, dPlaceholder),
    regularHouse1: (x, y, z) => () => generateRegularHouse1(x, y, z, fakeChunk, dPlaceholder),
    desertTempleTube: (x, y, z) => () => generateDesertTempleTube(x, y, z, fakeChunk, dPlaceholder),
    boxHouse: (x, y, z) => () => generateBoxHouse(x, y, z, fakeChunk, dPlaceholder),
    castle: (x, y, z) => () => generateCastle(x, y, z, fakeChunk, dPlaceholder),
    doubleTower: (x, y, z) => () => generateDoubleTower(x, y, z, fakeChunk, dPlaceholder),
    treeTower: (x, y, z) => () => generateTreeTower(x, y, z, fakeChunk, dPlaceholder),
    junglePyramid: (x, y, z) => () => generateJunglePyramid(x, y, z, fakeChunk, dPlaceholder),
    gate: (x, y, z) => () => generateGate(x, y, z, fakeChunk, dPlaceholder),
    pyramidIsland: (x, y, z) => () => generatePyramidIsland(x, y, z, fakeChunk, dPlaceholder),
    smallHouse: (x, y, z) => () => generateSmallHouse(x, y, z, fakeChunk, dPlaceholder),
    tank: (x, y, z) => () => generateTank(x, y, z, fakeChunk, dPlaceholder),
    tower: (x, y, z) => () => generateTower(x, y, z, fakeChunk, dPlaceholder),
    treeHouse: (x, y, z) => () => generateTreeHouse(x, y, z, fakeChunk, dPlaceholder),
    whiteTower: (x, y, z) => () => generateWhiteTower(x, y, z, fakeChunk, dPlaceholder),
    woodHouse: (x, y, z) => () => generateWoodHouse(x, y, z, fakeChunk, dPlaceholder),
    uglyHouse: (x, y, z) => () => generateUglyHouse(x, y, z, fakeChunk, dPlaceholder),
    desertVillage: (x, y, z) => () => generateDesertVillage(x, y, z, fakeChunk, dPlaceholder),
    desertPyramid: (x, y, z) => () => generateDesertPyramid(x, y, z, fakeChunk, dPlaceholder)
  };
  const appendLargeStaticTask = (type, centerX, centerY, centerZ) => {
    const dedupeKey = `${type}:${centerX},${centerY},${centerZ}`;
    if (largeStructureTaskKeySet.has(dedupeKey)) return;
    largeStructureTaskKeySet.add(dedupeKey);

    const createTask = largeStaticTaskFactories[type];
    if (!createTask) return;
    const task = createTask(centerX, centerY, centerZ);
    if (!task) return;
    task.centerX = centerX;
    task.centerY = centerY;
    task.centerZ = centerZ;
    task.type = type;
    structureQueueWithCenters.push({ task, centerX, centerY, centerZ, type });
  };
  const appendStaticTreeTask = (centerX, centerY, centerZ, treeType = 'default') => {
    const dedupeKey = `static_tree:${centerX},${centerY},${centerZ}`;
    if (largeStructureTaskKeySet.has(dedupeKey)) return;
    largeStructureTaskKeySet.add(dedupeKey);

    let task = null;
    if (treeType === 'azalea') {
      task = () => Tree.generate(centerX, centerY, centerZ, fakeChunk, 'azalea', dPlaceholder);
    } else if (treeType === 'swamp') {
      task = () => Tree.generate(centerX, centerY, centerZ, fakeChunk, 'swamp', dPlaceholder);
    } else {
      task = () => Tree.generate(centerX, centerY, centerZ, fakeChunk, 'default', dPlaceholder);
    }

    task.centerX = centerX;
    task.centerY = centerY;
    task.centerZ = centerZ;
    task.type = 'static_tree';
    structureQueueWithCenters.push({ task, centerX, centerY, centerZ, type: 'static_tree' });
  };

  // 使用结构候选索引查询大型静态结构（替代逐格扫描）
  const largeCandidates = structureCandidateIndex.getCandidatesForChunk(cx, cz, seed, terrainGen);
  for (const candidate of largeCandidates) {
    appendLargeStaticTask(candidate.type, candidate.x, candidate.y, candidate.z);
  }

  // static_tree 邻域重建（使用候选索引替代逐格扫描）
  const staticTreeCandidates = structureCandidateIndex.getStaticTreeCandidatesForChunk(cx, cz, seed, terrainGen);
  for (const candidate of staticTreeCandidates) {
    appendStaticTreeTask(candidate.x, candidate.y, candidate.z, 'azalea');
  }

  structureQueueWithCenters.forEach(({ task }) => {
    task();
  });
  } // end if (!isOptimization) — consolidation 跳过地形重生成

  // 结构中心统一去重，避免后续多阶段追加造成重复中心放大判定范围
  const structureCenterKeySet = new Set();
  const pushStructureCenter = (center) => {
    if (!center || !center.type || center.x === undefined || center.y === undefined || center.z === undefined) return;
    const centerKey = `${center.type}:${center.x},${center.y},${center.z}`;
    if (structureCenterKeySet.has(centerKey)) return;
    structureCenterKeySet.add(centerKey);
    structureCenters.push(center);
  };

  // 重建当前队列生成出的结构中心（去重）
  structureCenters.length = 0;
  structureQueueWithCenters.forEach(({ centerX, centerY, centerZ, type }) => {
    if (!type || centerX === undefined) return;
    pushStructureCenter({ type, x: centerX, y: centerY, z: centerZ });
  });

  // consolidate 场景：提前合并主线程传入的结构中心，确保 ownership 判定使用的是完整集合
  if (incomingStructureCenters && Array.isArray(incomingStructureCenters)) {
    for (const incoming of incomingStructureCenters) {
      pushStructureCenter(incoming);
    }
  }

  const isBlockOwnedByCurrentChunk = (block) => {
    return block.x >= minX && block.x < maxX && block.z >= minZ && block.z < maxZ;
  };

  /**
   * 从 snapshot.blocks 中获取指定坐标的方块条目
   * 兼容数字编码和字符串 key 两种格式
   * @param {Object} blocks - snapshot.blocks 对象
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {*} 方块条目或 undefined
   */
  function getBlockFromSnapshot(blocks, x, y, z) {
    // 先尝试数字编码格式
    const code = encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));
    if (blocks[code] !== undefined) return blocks[code];
    // 回退到字符串 key 格式
    const strKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return blocks[strKey];
  }

  // 如果有 snapshot，用 snapshot 中的方块覆盖 blockMap（保留玩家修改）
  if (savedSnapshot) {
    const incomingOwnershipVersion = Number(savedSnapshot.meta?.ownershipVersion || 1);
    let ownershipFilteredSnapshotBlocks = 0;

    // 从 snapshot 恢复实体列表
    modGunMan = savedSnapshot.entities.modGunMan || [];
    rovers = savedSnapshot.entities.rovers || [];
    const zombieNests = savedSnapshot.entities.zombieNests || [];

    // 重建结构中心列表（从实体列表）
    // 修复：保留静态结构（如 tank, house, static_tree），只移除动态实体，避免 reload 后静态结构被截断
    // 动态实体类型：gunman, rover
    const staticCenters = structureCenters.filter(c =>
      c.type !== 'tree' && c.type !== 'gunman' && c.type !== 'rover'
    );
    structureCenters.length = 0; // 清空
    structureCenters.push(...staticCenters);

    if (modGunMan) {
      modGunMan.forEach(pos => {
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          pushStructureCenter({ type: 'gunman', ...pos });
        }
      });
    }
    if (rovers) {
      rovers.forEach(pos => {
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          pushStructureCenter({ type: 'rover', ...pos });
        }
      });
    }

    // 修复：从 staticTrees 恢复 static_tree 结构中心，防止 City 树跨 chunk 切割
    const staticTrees = savedSnapshot.entities.staticTrees || [];
    if (staticTrees) {
      staticTrees.forEach(pos => {
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          pushStructureCenter({ type: 'static_tree', ...pos });
        }
      });
    }

    if (zombieNests) {
      zombieNests.forEach(nest => {
        const pos = nest?.position;
        if (!pos) return;
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          pushStructureCenter({ type: 'zombieNest', x: pos.x, y: pos.y, z: pos.z });
        }
      });
    }

    // 用 snapshot 中的方块覆盖 blockMap（保留玩家修改）
    if (savedSnapshot.blocks) {
      // 非 consolidation / skipTerrainGeneration 路径：需要根据 snapshot 清理当前 Chunk 责任范围内的被删除方块
      // consolidation 路径中 blockMap 为空（地形生成已跳过），无需清理
      if (!isOptimization && !skipTerrainGeneration) {
        for (const [key, b] of blockMap) {
          if (isBlockOwnedByCurrentChunk(b)) {
            if (!getBlockFromSnapshot(savedSnapshot.blocks, b.x, b.y, b.z)) {
              blockMap.delete(key);
            }
          }
        }
      }

      for (const key in savedSnapshot.blocks) {
        const rawEntry = savedSnapshot.blocks[key];
        const entry = parseBlockEntry(rawEntry);
        // 保持 WorldWorker 旧行为：兼容 legacy `direction` 字段。
        if (
          rawEntry &&
          typeof rawEntry === 'object' &&
          entry.orientation === 0 &&
          rawEntry.orientation == null &&
          rawEntry.direction != null
        ) {
          entry.orientation = rawEntry.direction;
        }

        // 兼容两种 key 格式：数字编码 和 字符串 “x,y,z”
        // 注意：postMessage 序列化后数字 key 会转为字符串，所以统一用字符串判断
        let bx, by, bz;
        if (!key.includes(',')) {
          // 数字编码格式（序列化为字符串数字）
          const decoded = decodeCoord(Number(key));
          bx = decoded.x;
          by = decoded.y;
          bz = decoded.z;
        } else {
          // 字符串 key 格式 “x,y,z”
          [bx, by, bz] = key.split(',').map(Number);
        }

        const snapshotBlock = { x: bx, y: by, z: bz, type: entry.type };

        // consolidation 路径：snapshot 中的方块全部在当前 chunk 范围内，跳过 ownership 检查
        // skipTerrainGeneration 路径同理：snapshot 就是权威数据源
        // 非 consolidation 路径：防止历史遗留的跨 Chunk 重复键被再次注入
        if (!isOptimization && !skipTerrainGeneration && !isBlockOwnedByCurrentChunk(snapshotBlock)) {
          ownershipFilteredSnapshotBlocks++;
          continue;
        }

        const solid = getBlockProperties(entry.type).isSolid;
        blockMap.set(encodeCoord(bx, by, bz), { x: bx, y: by, z: bz, type: entry.type, solid, orientation: entry.orientation });
      }
    }

    if (DEBUG_OWNERSHIP_MIGRATION && ownershipFilteredSnapshotBlocks > 0) {
      console.log(
        `[OwnershipMigration] chunk ${cx},${cz} filtered legacy blocks: ${ownershipFilteredSnapshotBlocks} (from v${incomingOwnershipVersion} -> v2)`
      );
    }
  }

  // 统一后处理：AO 计算、隐藏面剔除，并返回渲染数据
  // 将 blockMap 转换为 d 和 solidBlocks
  const d = {};
  const solidBlocks = [];

  // consolidation 路径专用：Uint8Array 遮挡网格，替代 Map 查找
  // x/z 方向各扩展 1 格边界（邻居查询需要），y 动态计算范围
  const GRID_PAD = 1;
  const GRID_SIZE_XZ = CHUNK_SIZE + GRID_PAD * 2; // 18
  let occlusionGrid = null;
  let gridMinY = 0;
  let gridHeight = 0;
  const isFastOcclusion = isOptimization && savedSnapshot && savedSnapshot.blocks;

  if (isFastOcclusion) {
    // 从 snapshot 中提取 y 范围
    let minY = Infinity;
    let maxY = -Infinity;
    for (const key in savedSnapshot.blocks) {
      let y;
      if (!key.includes(',')) {
        const decoded = decodeCoord(Number(key));
        y = decoded.y;
      } else {
        y = key.split(',')[1] | 0;
      }
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minY !== Infinity) {
      gridMinY = minY;
      gridHeight = maxY - minY + 1;
      occlusionGrid = new Uint8Array(GRID_SIZE_XZ * gridHeight * GRID_SIZE_XZ);

      // 填充遮挡网格 — consolidation 路径中 blockMap 的方块全部在当前 chunk 范围内
      for (const [, b] of blockMap) {
        if (isFullCubeOccluder(b.type)) {
          const localX = b.x - minX + GRID_PAD;
          const localZ = b.z - minZ + GRID_PAD;
          const localY = b.y - gridMinY;
          if (localX >= 0 && localX < GRID_SIZE_XZ && localZ >= 0 && localZ < GRID_SIZE_XZ && localY >= 0 && localY < gridHeight) {
            occlusionGrid[localX * gridHeight * GRID_SIZE_XZ + localY * GRID_SIZE_XZ + localZ] = 1;
          }
        }
      }
    }
  }

  /**
   * 快速遮挡查询 — consolidation 路径用 Uint8Array，非 consolidation 路径回退到 blockMap
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {boolean} 该位置是否有遮挡方块
   */
  const isOccluding = (x, y, z) => {
    // consolidation 路径：优先使用 Uint8Array 快速查询
    if (occlusionGrid) {
      const localX = x - minX + GRID_PAD;
      const localZ = z - minZ + GRID_PAD;
      const localY = y - gridMinY;
      if (localX < 0 || localX >= GRID_SIZE_XZ || localZ < 0 || localZ >= GRID_SIZE_XZ || localY < 0 || localY >= gridHeight) {
        return false;
      }
      return occlusionGrid[localX * gridHeight * GRID_SIZE_XZ + localY * GRID_SIZE_XZ + localZ] === 1;
    }

    // 非 consolidation 路径 / 无 snapshot 回退：blockMap 查找
    const k = encodeCoord(x, y, z);
    const b = blockMap.get(k);
    if (!b) return false;
    // 非 consolidation 路径：防止跨 Chunk 历史残留方块误参与遮挡
    if (!isOptimization && savedSnapshot && !isBlockOwnedByCurrentChunk(b)) return false;
    return isFullCubeOccluder(b.type);
  };

  // 初始化所有可能的类型数组
  const allTypes = Object.keys(BLOCK_DATA); // 包含所有定义在 BLOCK_DATA 中的类型
  for(const type of allTypes) {
    d[type] = [];
  }

  // 记录所有方块的类型（包括被剔除的），用于主线程在挖掘时恢复
  const allBlockTypes = {};
  // 记录当前可见（已添加进d）的方块Key
  const visibleKeysSet = new Set();
  // 记录每个方块的 AO 数据，供 buildScatteredBlocks 使用
  const aoMap = new Map();

  // --- 跨区块实体渲染支持 ---
  // structureCenters 已在前面完成去重构建，避免重复追加导致 ownership 判定膨胀

  // 仅保存当前 Chunk 负责的数据（地图语义）
  // 使用数字编码格式，与 Chunk.blockData 一致
  // consolidation / skipTerrainGeneration 路径中所有方块都在 chunk 范围内，无需 ownership 过滤
  const blocksForSnapshot = {};
  for (const [, b] of blockMap) {
    if (!isOptimization && !skipTerrainGeneration && !isBlockOwnedByCurrentChunk(b)) continue;
    const code = encodeCoord(b.x, b.y, b.z);
    blocksForSnapshot[code] = { type: b.type, orientation: b.orientation || 0 };
  }

  for (const [key, block] of blockMap) {
    // consolidation / skipTerrainGeneration 路径中所有方块都在 chunk 范围内，shouldOwnBlock 永远为 true
    const shouldOwnBlock = isOptimization || skipTerrainGeneration || isBlockOwnedByCurrentChunk(block);

    // 固体方块：只要在 Chunk 内或者是跨区结构方块，都添加到 solidBlocks
    if (block.solid && shouldOwnBlock) solidBlocks.push(key);
    let visible = true;
    if (isFullCubeOccluder(block.type)) {
      const { x, y, z } = block;
      const covered =
        isOccluding(x + 1, y, z) &&
        isOccluding(x - 1, y, z) &&
        isOccluding(x, y + 1, z) &&
        isOccluding(x, y - 1, z) &&
        isOccluding(x, y, z + 1) &&
        isOccluding(x, y, z - 1);
      if (covered && block.type !== 'chest') visible = false;
    }

    if (shouldOwnBlock) {
      allBlockTypes[key] = { type: block.type, orientation: block.orientation || 0 };
    }

    // 渲染条件：所有可渲染的方块都进入 scatteredBlocks
    // 不再受 shouldOwnBlock 限制，跨 Chunk 结构方块由主线程 BlockScatterManager 按坐标分发
    const props = getBlockProperties(block.type);
    const shouldRender = props.isRendered !== false;

    if (shouldRender && visible) {
      if (!d[block.type]) d[block.type] = [];
      let aoLow = 0;
      let aoHigh = 0;
      // 简化AO逻辑：非透明且实心的方块自动启用AO
      const isAOEnabled = !props.isTransparent && props.isSolid;
      if (isAOEnabled) {
        ({ aoLow, aoHigh } = calculateAOForBlock(block.x, block.y, block.z, isOccluding));
      }
      d[block.type].push({x: block.x, y: block.y, z: block.z, aoLow, aoHigh, orientation: block.orientation || 0});
      visibleKeysSet.add(key);
      aoMap.set(key, { aoLow, aoHigh });
    }
  }

  // 构建轻量逻辑方块列表和可见渲染方块列表。
  // blockDataBlocks 保留完整逻辑数据；scatteredBlocks 只走渲染路径，避免隐藏块扩大回包。
  const blockDataBlocks = buildBlockDataBlocks(blockMap);
  const scatteredBlocks = buildScatteredBlocks(blockMap, visibleKeysSet, aoMap);
  const meshData = buildMeshDataForChunk(fakeChunk, d, cx, cz);
  const routing = buildChunkRouting(blockDataBlocks, scatteredBlocks, cx, cz, meshData);

  const workerFinishedAt = performance.now();
  const workerComputeMs = workerFinishedAt - workerReceivedAt;
  const transitToWorkerMs = _consolidationRequestSentAt
    ? workerReceivedAt - _consolidationRequestSentAt
    : 0;

  postMessage({
    cx, cz, callbackKey, taskId,
    blockDataBlocks,
    scatteredBlocks,
    routing,
    meshData,
    solidBlocks,
    modGunMan, rovers,
    entities: {
      modGunMan,
      rovers
    },
    visibleKeys: Array.from(visibleKeysSet),
    structureCenters,
    snapshot: {
      meta: {
        ownershipVersion: OWNERSHIP_SCHEMA_VERSION
      },
      blocks: blocksForSnapshot,
      entities: {
        modGunMan,
        rovers,
        zombieNests: savedSnapshot?.entities?.zombieNests || []
      }
    },
    _workerTiming: {
      workerComputeMs,
      transitToWorkerMs,
      workerFinishedAt
    },
    isOptimization
  });
};

// 复制结构生成逻辑
function generateStructure(type, x, y, z, chunk, dObj, rovers = []) {
  if (type === 'house') {
    const wallMat = Math.random() < 0.33 ? 'bricks' : 'planks';
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) chunk.add(x + i, y - 1, z + j, 'stone', dObj);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      if (Math.abs(i) === 2 || Math.abs(j) === 2) {
        if (i === 0 && j === 2) continue;
        if ((i === -2 || i === 2) && j === 0) {
          chunk.add(x + i, y, z + j, wallMat, dObj);
          chunk.add(x + i, y + 1, z + j, 'glass_block', dObj);
          chunk.add(x + i, y + 2, z + j, wallMat, dObj);
        } else {
          for (let h = 0; h < 3; h++) chunk.add(x + i, y + h, z + j, wallMat, dObj);
        }
      }
    }
    const roofMat = Math.random() < 0.5 ? 'dark_planks' : 'oak_planks';
    const roofBlocks = [];
    for (let h = 0; h < 3; h++) {
      for (let i = -2 + h; i <= 2 - h; i++) {
        for (let j = -2 + h; j <= 2 - h; j++) {
          chunk.add(x + i, y + 3 + h, z + j, roofMat, dObj);
          if (h === 2 || Math.abs(i) === 2 - h || Math.abs(j) === 2 - h) {
            roofBlocks.push({ x: x + i, y: y + 3 + h, z: z + j });
          }
        }
      }
    }
    for (let j = -1; j <= 1; j++) {
      chunk.add(x, y + 5, z + j, roofMat, dObj);
      roofBlocks.push({ x: x, y: y + 5, z: z + j });
    }
    if (Math.random() < 0.33) {
      const lowerRoofBlocks = roofBlocks.filter(b => b.y < y + 5);
      const targetPool = lowerRoofBlocks.length > 0 ? lowerRoofBlocks : roofBlocks;
      if (targetPool.length > 0) {
        const pos = targetPool[Math.floor(Math.random() * targetPool.length)];
        chunk.add(pos.x, pos.y + 1, pos.z, 'chimney', dObj, false);
      }
    }
    chunk.add(x - 1, y, z - 1, 'bookbox', dObj, false);
    chunk.add(x + 1, y, z - 1, 'chest', dObj);
  } else if (type === 'rover') {
    rovers.push({ x, y, z });
  } else if (type === 'ship') {
    for (let dz = -3; dz <= 3; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 || Math.abs(dz) === 3) {
        chunk.add(x + dx, y + 1, z + dz, 'wood', dObj);
        chunk.add(x + dx, y + 2, z + dz, 'planks', dObj);
      } else {
        chunk.add(x + dx, y, z + dz, 'planks', dObj);
      }
    }
    for (let i = 0; i < 5; i++) chunk.add(x, y + i, z, 'wood', dObj);
    chunk.add(x, y + 1, z + 2, 'chest', dObj);
  }
}

/**
 * 生成白桦树（从 JSON 数据）
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateBirchTree(x, y, z, chunk, dObj) {
  birchTree.generate(x, y, z, chunk, dObj, true);
}

/**
 * 生成黄叶子大树（替代 RealisticTree）
 * 使用方块堆叠方式，与 tree_big 一致
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateYellowTree(x, y, z, chunk, dObj) {
  Tree.generate(x, y, z, chunk, 'big', dObj, null, 'yellow_leaves');
}

/**
 * 生成带雪白桦树（从 JSON 数据）
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateBirchTreeWithSnow(x, y, z, chunk, dObj) {
  birchTreeWithSnow.generate(x, y, z, chunk, dObj, true);
}

/**
 * 生成花坛（从 JSON 数据）
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateFlowerBed(x, y, z, chunk, dObj) {
  flowerBed.generate(x, y, z, chunk, dObj, true);
}

/**
 * 生成凉亭（从 JSON 数据）
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generatePavilion(x, y, z, chunk, dObj) {
  pavilion.generate(x, y, z, chunk, dObj, true);
}

/**
 * 生成坦克（从 JSON 数据）
 * @param {number} x - X 坐标（坦克中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（坦克中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateTank(x, y, z, chunk, dObj) {
  tank.generate(x, y, z, chunk, dObj, true);
}

/**
 * 生成沙漠金字塔（从 JSON 数据）
 * @param {number} x - X 坐标（金字塔中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（金字塔中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateDesertPyramid(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(desertPyramid, x, y, z, chunk, dObj);
}

/**
 * 生成沙漠村庄（从 JSON 数据）
 * @param {number} x - X 坐标（村庄中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（村庄中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateDesertVillage(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(desertVillage, x, y, z, chunk, dObj);
}

/**
 * 生成 JSON 结构，并在底部悬空时向下补支撑方块
 * @param {Object} loader - StructureLoader 实例
 * @param {number} x - X 坐标（结构中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（结构中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateStructureWithGroundSupport(loader, x, y, z, chunk, dObj) {
  // 兼容未预加载或无高级接口的场景
  if (!loader || !loader.getData || !loader.addToChunk || !loader.generateBlocks) {
    loader?.generate?.(x, y, z, chunk, dObj, true);
    return;
  }

  const blocks = loader.generateBlocks(x, y, z, y);
  loader.addToChunk(chunk, blocks, dObj, true);

  const minSupportY = -64;
  // 仅补“最多悬空 5 格”的情况：
  // 若 baseY 为底层方块 Y，则允许地面最低出现在 baseY - 6（中间 5 个空气格）
  const maxFloatingBlocks = 5;
  const isSolidType = (type) => {
    if (!type) return false;
    return Boolean(getBlockProperties(type).isSolid);
  };

  // 只对实体“本地 y=1（贴地层）”的方块做支撑补地。
  // 这样可避免对结构内部本应悬空的高层方块进行错误填充。
  const supportColumns = new Map();
  const loaderData = loader.getData?.();
  const localBlocks = loaderData?.blocks || [];
  const bottomY = typeof loader.getBottomY === 'function' ? loader.getBottomY() : 1;

  for (const localBlock of localBlocks) {
    if (Math.floor(localBlock.y) !== 1) continue;

    const worldX = Math.floor(x + localBlock.x);
    const worldY = Math.floor(y + (localBlock.y - bottomY));
    const worldZ = Math.floor(z + localBlock.z);
    const key = `${worldX},${worldZ}`;

    supportColumns.set(key, {
      x: worldX,
      y: worldY,
      z: worldZ,
      type: localBlock.type
    });
  }

  for (const baseBlock of supportColumns.values()) {
    const supportType = baseBlock.type || 'sandstone';
    const supportSolid = isSolidType(supportType);
    const baseY = Math.floor(baseBlock.y);
    const probeMinY = Math.max(minSupportY, baseY - (maxFloatingBlocks + 1));
    let supportGroundY = null;

    for (let probeY = baseY - 1; probeY >= probeMinY; probeY--) {
      const existingType = typeof chunk.getBlockType === 'function'
        ? chunk.getBlockType(baseBlock.x, probeY, baseBlock.z)
        : null;

      if (isSolidType(existingType)) {
        supportGroundY = probeY;
        break;
      }
    }

    // 兜底：跨 Chunk 情况下，blockMap 可能没有该列的地形数据。
    // 这时回退到地形高度估算，避免沙漠台阶边缘出现 1 格悬空漏补。
    if (supportGroundY === null) {
      const worldX = Math.floor(baseBlock.x);
      const worldZ = Math.floor(baseBlock.z);
      const biome = terrainGen.getBiome(worldX, worldZ);
      const terrainY = Math.floor(terrainGen.generateHeight(worldX, worldZ, biome));
      const floatingBlocks = baseY - terrainY - 1;

      if (floatingBlocks >= 1 && floatingBlocks <= maxFloatingBlocks) {
        supportGroundY = terrainY;
      }
    }

    // 仅填补离地较近（5 格以内）的悬空，避免云层/空岛等高空结构被错误拉柱
    if (supportGroundY === null) {
      continue;
    }

    for (let fillY = baseY - 1; fillY > supportGroundY; fillY--) {
      chunk.add(baseBlock.x, fillY, baseBlock.z, supportType, dObj, supportSolid, 0);
    }
  }
}

function generateBigHouse(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(bigHouse, x, y, z, chunk, dObj);
}

function generateRegularHouse1(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(regularHouse1, x, y, z, chunk, dObj);
}

function generateDesertTempleTube(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(desertTempleTube, x, y, z, chunk, dObj);
}

function generateBoxHouse(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(boxHouse, x, y, z, chunk, dObj);
}

function generateDoubleTower(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(doubleTower, x, y, z, chunk, dObj);
}

function generateTreeTower(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(treeTower, x, y, z, chunk, dObj);
}

function generateJunglePyramid(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(junglePyramid, x, y, z, chunk, dObj);
}

function generatePyramidIsland(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(pyramidIsland, x, y, z, chunk, dObj);
}

function generateSmallHouse(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(smallHouse, x, y, z, chunk, dObj);
}

function generateTreeHouse(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(treeHouse, x, y, z, chunk, dObj);
}

function generateWoodHouse(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(woodHouse, x, y, z, chunk, dObj);
}

/**
 * 生成海岛高塔（从 JSON 数据）
 * @param {number} x - X 坐标（高塔中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（高塔中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateTower(x, y, z, chunk, dObj) {
  tower.generate(x, y, z, chunk, dObj, true);
}

/**
 * 生成城堡（从 JSON 数据）
 * @param {number} x - X 坐标（城堡中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（城堡中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateCastle(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(castle, x, y, z, chunk, dObj);
}

/**
 * 生成拱门（从 JSON 数据）
 * @param {number} x - X 坐标（拱门中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（拱门中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateGate(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(gate, x, y, z, chunk, dObj);
}

/**
 * 生成丑陋小屋（从 JSON 数据）
 * @param {number} x - X 坐标（小屋中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（小屋中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateUglyHouse(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(uglyHouse, x, y, z, chunk, dObj);
}

/**
 * 生成白塔（从 JSON 数据）
 * @param {number} x - X 坐标（白塔中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（白塔中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateWhiteTower(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(whiteTower, x, y, z, chunk, dObj);
}
