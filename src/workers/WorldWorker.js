// src/workers/WorldWorker.js
import { setSeed, seededRandom, getBiome as getBaseBiome } from '../utils/MathUtils.js';
import { parseBlockEntry } from '../utils/OrientationUtils.js';
import { terrainGen } from '../world/TerrainGen.js';
import { Tree } from '../world/entities/Tree.js';
import { Cloud } from '../world/entities/Cloud.js';
import { Island } from '../world/entities/Island.js';
import { getBlockProperties, BLOCK_DATA } from '../constants/BlockData.js';
import { structureLoaders } from '../world/entity-system/StructureLoader.js';
import { Pyramid } from './maps/Pyramid.js';
import { SnowLand } from './maps/SnowLand.js';
import { FrozenMountain } from './maps/FrozenMountain.js';
import { IslandMap } from './maps/IslandMap.js';
import { PlainLand } from './maps/PlainLand.js';
import { CityMap } from './maps/CityMap.js';
import {
  belongsToCrossChunkStructure as checkBelongsToCrossChunkStructure,
  belongsToLargeStaticStructure as checkBelongsToLargeStaticStructure
} from '../utils/StructureUtils.js';
import { getAOForFace } from '../utils/AOUtils.js';

console.log('WorldWorker.js loaded');

// 全局错误处理
self.onerror = (e) => {
  console.error('WorldWorker internal error:', e.message, 'at', e.filename, ':', e.lineno);
};

// 结构数据加载器实例
const {
  bigHouse,
  boxHouse,
  doubleTower,
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
  flowerBed
} = structureLoaders;

const CHUNK_SIZE = 16;
const ROOMS_PER_CHUNK = 2;
const MAX_ROOM_SIZE = 5;
const LARGE_STATIC_SCAN_PADDING = 36; // 与 castle/tank 最大渲染半径一致

/**
 * 将世界坐标转换为 Chunk 内局部坐标（0-15）
 * @param {number} value
 * @returns {number}
 */
function toLocalCoord(value) {
  const mod = value % CHUNK_SIZE;
  return mod >= 0 ? mod : mod + CHUNK_SIZE;
}

/**
 * 判断指定世界坐标是否满足结构安全生成范围（对应 local 3..12）
 * @param {number} wx
 * @param {number} wz
 * @returns {boolean}
 */
function isSafeForStructureAt(wx, wz) {
  const lx = toLocalCoord(wx);
  const lz = toLocalCoord(wz);
  return lx >= 3 && lx <= 12 && lz >= 3 && lz <= 12;
}

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
 * 非沙漠地块中，是否已被“会阻止大型结构生成”的对象占用
 * 与主流程 else 分支保持一致：先 gunman，再 tree
 * @param {number} wx
 * @param {number} wz
 * @param {number} seed
 * @returns {boolean}
 */
function isOccupiedForLargeStaticNonDesert(wx, wz, seed) {
  const occupiedByGunman = seededRandom(wx, wz, seed) < 0.0005;
  const occupiedByTree = !occupiedByGunman && seededRandom(wx, wz, seed + 1) < 0.005;
  return occupiedByGunman || occupiedByTree;
}

/**
 * 沙漠地块中，是否已被 dead_bush 占位（会阻止大型结构）
 * 与主流程 DESERT 分支保持一致
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
 * @returns {'desertPyramid'|'desertVillage'|'uglyHouse'|'whiteTower'|'gate'|'tank'|null}
 */
function resolveLargeStaticStructureType(params) {
  const { wx, wz, seed, biome, surfaceType, safeForStructure, occupied } = params;
  if (!safeForStructure || occupied) return null;

  if (biome === 'DESERT') {
    // gate 概率与 uglyHouse 一致（0.00008）
    if (seededRandom(wx, wz, seed + 27) < 0.00008) return 'gate';
    if (seededRandom(wx, wz, seed + 25) < 0.00016) return 'desertPyramid';
    if (seededRandom(wx, wz, seed + 26) < 0.00016) return 'desertVillage';
    if (seededRandom(wx, wz, seed + 28) < 0.00016) return 'whiteTower';
    if (seededRandom(wx, wz, seed + 23) < 0.00008) return 'uglyHouse';
    return null;
  }

  if (surfaceType === 'grass' && seededRandom(wx, wz, seed + 5) < 0.0001) {
    return 'tank';
  }

  return null;
}

onmessage = async function(e) {
  const { cx, cz, seed, snapshot, structureCenters: incomingStructureCenters, callbackKey } = e.data;

  // 同步种子
  setSeed(seed);

  // 预加载所有结构数据（等待完成后再生成地形）
  await Promise.all([
    bigHouse.load(),
    boxHouse.load(),
    doubleTower.load(),
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
    flowerBed.load()
  ]).catch(err => console.error('Failed to load structure data:', err));

  // 计算当前区块的范围 - 提前定义，供 snapshot 模式使用
  const minX = cx * CHUNK_SIZE;
  const maxX = (cx + 1) * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const maxZ = (cz + 1) * CHUNK_SIZE;

  // 使用 Map 暂存方块，确保同一位置后生成的方块覆盖旧方块
  const blockMap = new Map();
  let realisticTrees = []; // 记录真实 tree 的位置
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

  // 模拟 Chunk 类的 add 方法 - 改为写入 blockMap
  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true, orientation = 0) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      blockMap.set(key, { x, y, z, type, solid, orientation });
    },
    getBlockType: (x, y, z) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      return blockMap.get(key)?.type || null;
    }
  };

  // 保存 snapshot 数据（如果有）
  let savedSnapshot = null;
  if (snapshot) {
    savedSnapshot = {
      blocks: snapshot.blocks ? { ...snapshot.blocks } : {},
      entities: snapshot.entities ? {
        realisticTrees: snapshot.entities.realisticTrees || [],
        modGunMan: snapshot.entities.modGunMan || [],
        rovers: snapshot.entities.rovers || [],
        zombieNests: snapshot.entities.zombieNests || []
      } : { realisticTrees: [], modGunMan: [], rovers: [], zombieNests: [] }
    };
  }

  // 无论是否有 snapshot，都执行完整的地形和结构生成
  // 这样可以确保跨 Chunk 的结构方块被正确生成
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
        const cityStructure = cityPlacementMap.get(`${wx},${wz}`) || cityFillerPlacementMap.get(`${wx},${wz}`) || null;
        if (cityStructure && !cityStructureCenters.has(cityStructure.id)) {
          const centerY = cityResult.surfaceY + 1;
          const centerKey = cityStructure.id;
          const taskFactories = {
            castle: generateCastle,
            bigHouse: generateBigHouse,
            boxHouse: generateBoxHouse,
            desertVillage: generateDesertVillage,
            doubleTower: generateDoubleTower,
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
        // 概率 0.0003（原概率的三分之一），padding 减小到 1，只在核心区域生成
        if (cityInfo.transitionFactor === 0 && seededRandom(wx, wz, seed + 823) < 0.0003) {
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

        // 每块平地唯一生成一个城堡，固定在中心
        const isCastleCenter = wx === plainLandInfo.centerX && wz === plainLandInfo.centerZ;
        const castleCenterKey = `${plainLandInfo.centerX},${plainLandInfo.centerZ}`;
        if (isCastleCenter && !plainLandCastleCenters.has(castleCenterKey)) {
          createStructureTask(
            generateCastle.bind(null, plainLandInfo.centerX, plainLandResult.surfaceY + 1, plainLandInfo.centerZ, fakeChunk, dPlaceholder),
            plainLandInfo.centerX,
            plainLandResult.surfaceY + 1,
            plainLandInfo.centerZ,
            'castle',
            plainLandCastleCenters,
            castleCenterKey
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
              realisticTrees.push({ x: wx, y: h + 1, z: wz });
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
  }
  if (chunkRandom(cx, cz, seed + 52) < 0.20) {
    const startX = cx * CHUNK_SIZE + Math.floor(chunkRandom(cx, cz, seed + 53) * CHUNK_SIZE);
    const startZ = cz * CHUNK_SIZE + Math.floor(chunkRandom(cx, cz, seed + 54) * CHUNK_SIZE);
    const size = 30 + Math.floor(chunkRandom(cx, cz, seed + 55) * 21);
    Cloud.generateCluster(startX, 35, startZ, size, fakeChunk, dPlaceholder);
  }

  // 执行结构生成队列，并记录大型结构的中心点
  // structureCenters 需要在生成结构时同步更新
  const structureQueueWithCenters = structureQueue.map(task => {
    // 尝试从任务中提取中心点（通过预存储的方式）
    return { task, centerX: task.centerX, centerY: task.centerY, centerZ: task.centerZ, type: task.type };
  });

  // 大型静态结构邻域重建：
  // 让每个 Chunk 都能拿到“落在自己坐标内”的结构分片，避免中心 Chunk 卸载导致整栋闪灭/切割
  const scannedMinX = minX - LARGE_STATIC_SCAN_PADDING;
  const scannedMaxX = maxX + LARGE_STATIC_SCAN_PADDING;
  const scannedMinZ = minZ - LARGE_STATIC_SCAN_PADDING;
  const scannedMaxZ = maxZ + LARGE_STATIC_SCAN_PADDING;
  const wLvl = -2;
  const getChunkBiomeByWorld = (wx, wz) => {
    const ownerCx = Math.floor(wx / CHUNK_SIZE);
    const ownerCz = Math.floor(wz / CHUNK_SIZE);
    return terrainGen.getBiome(ownerCx * CHUNK_SIZE, ownerCz * CHUNK_SIZE);
  };
  const largeStructureTaskKeySet = new Set(
    structureQueueWithCenters
      .filter(item => item.type)
      .map(item => `${item.type}:${item.centerX},${item.centerY},${item.centerZ}`)
  );
  const largeStaticTaskFactories = {
    bigHouse: (x, y, z) => () => generateBigHouse(x, y, z, fakeChunk, dPlaceholder),
    boxHouse: (x, y, z) => () => generateBoxHouse(x, y, z, fakeChunk, dPlaceholder),
    castle: (x, y, z) => () => generateCastle(x, y, z, fakeChunk, dPlaceholder),
    doubleTower: (x, y, z) => () => generateDoubleTower(x, y, z, fakeChunk, dPlaceholder),
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

  for (let wx = scannedMinX; wx < scannedMaxX; wx++) {
    for (let wz = scannedMinZ; wz < scannedMaxZ; wz++) {
      const cityPlacement = cityPlacementMap.get(`${wx},${wz}`) || null;
      const cityFillerPlacement = cityFillerPlacementMap.get(`${wx},${wz}`) || null;
      const cityAnyPlacement = cityPlacement || cityFillerPlacement;
      if (cityAnyPlacement) {
        const cityCenterHeight = CityMap.getCitySurfaceY(cityAnyPlacement.x, cityAnyPlacement.z, seed, terrainGen);
        appendLargeStaticTask(cityAnyPlacement.type, cityAnyPlacement.x, cityCenterHeight + 1, cityAnyPlacement.z);
        continue;
      }

      const pyInfo = Pyramid.getPyramidInfo(wx, wz, seed, terrainGen);
      if (pyInfo) continue;

      const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
      if (islandInfo) {
        if (wx === islandInfo.centerX && wz === islandInfo.centerZ) {
          appendLargeStaticTask('tower', islandInfo.centerX, -1, islandInfo.centerZ);
        }
        continue;
      }

      const plainLandInfo = PlainLand.getPlainLandInfo(wx, wz, seed, terrainGen);
      if (plainLandInfo) {
        if (wx === plainLandInfo.centerX && wz === plainLandInfo.centerZ) {
          appendLargeStaticTask('castle', plainLandInfo.centerX, plainLandInfo.baseHeight + 1, plainLandInfo.centerZ);
        }
        continue;
      }

      const slInfo = SnowLand.getSnowLandInfo(wx, wz, seed, terrainGen);
      if (slInfo) continue;

      const fmInfo = FrozenMountain.getFrozenMountainInfo(wx, wz, seed, terrainGen);
      if (fmInfo) continue;

      const centerBiomeAtPos = getChunkBiomeByWorld(wx, wz);
      const heightAtPos = terrainGen.generateHeight(wx, wz, centerBiomeAtPos);
      if (heightAtPos < wLvl) continue;

      const safeForStructure = isSafeForStructureAt(wx, wz);
      if (!safeForStructure) continue;

      const surfaceType = getSurfaceTypeByBiome(centerBiomeAtPos);
      const occupiedForLargeStatic = centerBiomeAtPos === 'DESERT'
        ? isOccupiedForLargeStaticDesert(wx, wz, seed)
        : isOccupiedForLargeStaticNonDesert(wx, wz, seed);
      const largeStaticType = resolveLargeStaticStructureType({
        wx,
        wz,
        seed,
        biome: centerBiomeAtPos,
        surfaceType,
        safeForStructure,
        occupied: occupiedForLargeStatic
      });
      if (largeStaticType) {
        appendLargeStaticTask(largeStaticType, wx, heightAtPos + 1, wz);
      }
    }
  }

  structureQueueWithCenters.forEach(({ task, centerX, centerY, centerZ, type }) => {
    task();
    // 记录所有有中心点的结构，不限于当前 Chunk
    // 这是修复跨 Chunk 截断的关键：相邻 Chunk 需要知道这些结构的信息
    if (type && centerX !== undefined) {
      structureCenters.push({ type, x: centerX, y: centerY, z: centerZ });
    }
  });

  // 统一 Chunk 归属判定，避免多处重复实现
  const belongsToCrossChunkStructure = (bx, by, bz) =>
    checkBelongsToCrossChunkStructure(bx, by, bz, structureCenters);
  const isBlockOwnedByCurrentChunk = (block) => {
    const inCurrentChunk = block.x >= minX && block.x < maxX && block.z >= minZ && block.z < maxZ;
    const isCrossChunkStructureBlock = !inCurrentChunk &&
      belongsToCrossChunkStructure(block.x, block.y, block.z);
    return inCurrentChunk || isCrossChunkStructureBlock;
  };
  const isLargeStaticCrossChunkBlock = (x, y, z) => {
    const inCurrentChunk = x >= minX && x < maxX && z >= minZ && z < maxZ;
    if (inCurrentChunk) return false;
    return checkBelongsToLargeStaticStructure(x, y, z, structureCenters);
  };

  // 如果有 snapshot，用 snapshot 中的方块覆盖 blockMap（保留玩家修改）
  if (savedSnapshot) {
    // 从 snapshot 恢复实体列表
    realisticTrees = savedSnapshot.entities.realisticTrees || [];
    modGunMan = savedSnapshot.entities.modGunMan || [];
    rovers = savedSnapshot.entities.rovers || [];
    const zombieNests = savedSnapshot.entities.zombieNests || [];

    // 重建结构中心列表（从实体列表）
    // 修复：保留静态结构（如 tank, house, static_tree），只移除动态实体，避免 reload 后静态结构被截断
    // 动态实体类型：tree (RealisticTree), gunman, rover
    const staticCenters = structureCenters.filter(c =>
      c.type !== 'tree' && c.type !== 'gunman' && c.type !== 'rover'
    );
    structureCenters.length = 0; // 清空
    structureCenters.push(...staticCenters);

    if (realisticTrees) {
      realisticTrees.forEach(pos => {
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          structureCenters.push({ type: 'tree', ...pos });
        }
      });
    }
    if (modGunMan) {
      modGunMan.forEach(pos => {
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          structureCenters.push({ type: 'gunman', ...pos });
        }
      });
    }
    if (rovers) {
      rovers.forEach(pos => {
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          structureCenters.push({ type: 'rover', ...pos });
        }
      });
    }

    if (zombieNests) {
      zombieNests.forEach(nest => {
        const pos = nest?.position;
        if (!pos) return;
        if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
          structureCenters.push({ type: 'zombieNest', x: pos.x, y: pos.y, z: pos.z });
        }
      });
    }

    // 用 snapshot 中的方块覆盖 blockMap（保留玩家修改）
    if (savedSnapshot.blocks) {
      // 在 snapshot 模式下，需要根据 snapshot 清理“当前 Chunk 负责渲染/存储范围”的被删除方块
      // 注意：仅对可跨 Chunk 的小体积结构保留跨 Chunk 责任；大型静态结构按坐标归属
      for (const [key, b] of blockMap) {
        // 只清理当前 Chunk 责任范围内的方块
        if (isBlockOwnedByCurrentChunk(b)) {
          // 如果该坐标不在 snapshot 中，说明玩家已删除该方块（或该坐标原本就是空气）
          if (!savedSnapshot.blocks[key]) {
            blockMap.delete(key);
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
        const [bx, by, bz] = key.split(',').map(Number);

        // 旧存档兼容纠偏：
        // 大型静态结构跨 Chunk 历史残留方块，统一回归到坐标所属 Chunk
        if (isLargeStaticCrossChunkBlock(bx, by, bz)) {
          continue;
        }

        const solid = getBlockProperties(entry.type).isSolid;
        blockMap.set(key, { x: bx, y: by, z: bz, type: entry.type, solid, orientation: entry.orientation });
      }
    }
  }

  // 统一后处理：AO 计算、隐藏面剔除，并返回渲染数据
  // 将 blockMap 转换为 d 和 solidBlocks
  const d = {};
  const solidBlocks = [];

  // 辅助函数：判断指定位置的方块是否遮挡视线（简化版）
  // 简化：只有非透明方块才遮挡，透明方块不遮挡
  const isOccluding = (x, y, z) => {
    const k = `${x},${y},${z}`;
    const b = blockMap.get(k);
    if (!b) return false;
    // 简化：只有非透明方块才遮挡
    return !getBlockProperties(b.type).isTransparent;
  };

  // 初始化所有可能的类型数组
  const allTypes = Object.keys(BLOCK_DATA); // 包含所有定义在 BLOCK_DATA 中的类型
  for(const type of allTypes) {
    d[type] = [];
  }

  // 记录所有方块的类型（包括被剔除的），用于主线程在挖掘时恢复
  const allBlockTypes = {};
  // 记录当前可见（已添加进d）的方块Key
  const visibleKeys = [];

  // --- 跨区块实体渲染支持 ---
  // 当一个结构/实体的中心在当前 Chunk 内时，渲染该结构的所有方块
  // 即使方块位置超出 Chunk 边界
  // structureCenters 已在上面定义

  // 从实体列表中收集结构中心
  if (realisticTrees) {
    realisticTrees.forEach(pos => {
      if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
        structureCenters.push({ type: 'tree', ...pos });
      }
    });
  }
  if (modGunMan) {
    modGunMan.forEach(pos => {
      if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
        structureCenters.push({ type: 'gunman', ...pos });
      }
    });
  }
  if (rovers) {
    rovers.forEach(pos => {
      if (pos.x >= minX && pos.x < maxX && pos.z >= minZ && pos.z < maxZ) {
        structureCenters.push({ type: 'rover', ...pos });
      }
    });
  }

  // 合并从主线程传入的结构中心（用于 consolidate 场景）
  if (incomingStructureCenters && Array.isArray(incomingStructureCenters)) {
    for (const incoming of incomingStructureCenters) {
      // 检查是否已存在，避免重复
      const exists = structureCenters.some(c =>
        c.type === incoming.type && c.x === incoming.x && c.y === incoming.y && c.z === incoming.z
      );
      if (!exists) {
        structureCenters.push(incoming);
      }
    }
  }

  // 仅保存当前 Chunk 负责的数据（地图语义）
  const blocksForSnapshot = {};
  for (const [key, b] of blockMap) {
    if (!isBlockOwnedByCurrentChunk(b)) continue;
    blocksForSnapshot[key] = { type: b.type, orientation: b.orientation || 0 };
  }

  for (const [key, block] of blockMap) {
    const shouldOwnBlock = isBlockOwnedByCurrentChunk(block);

    // 固体方块：只要在 Chunk 内或者是跨区结构方块，都添加到 solidBlocks
    if (block.solid && shouldOwnBlock) solidBlocks.push(key);
    let visible = true;
    if (block.solid) {
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

    // 渲染条件：在当前 Chunk 内，或者属于当前 Chunk 的跨区结构
    const shouldRender = shouldOwnBlock;

    if (shouldRender && visible) {
      if (!d[block.type]) d[block.type] = [];
      let aoLow = 0;
      let aoHigh = 0;
      // 简化AO逻辑：非透明且实心的方块自动启用AO
      const props = getBlockProperties(block.type);
      const isAOEnabled = !props.isTransparent && props.isSolid;
      if (isAOEnabled) {
        for (let f = 0; f < 6; f++) {
          const aos = getAOForFace(block.x, block.y, block.z, f, isOccluding);
          for (let v = 0; v < 4; v++) {
            const vertexIdx = f * 4 + v;
            const aoVal = aos[v];
            if (vertexIdx < 12) aoLow |= (aoVal << (vertexIdx * 2));
            else aoHigh |= (aoVal << ((vertexIdx - 12) * 2));
          }
        }
      }
      d[block.type].push({x: block.x, y: block.y, z: block.z, aoLow, aoHigh, orientation: block.orientation || 0});
      visibleKeys.push(key);
    }
  }

  // 返回数据
  postMessage({
    cx, cz, callbackKey, d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys,
    structureCenters, // 新增：当前 Chunk 负责渲染的结构中心列表
    snapshot: {
      blocks: blocksForSnapshot,
      entities: {
        realisticTrees,
        modGunMan,
        rovers,
        zombieNests: savedSnapshot?.entities?.zombieNests || []
      }
    }
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

function generateBoxHouse(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(boxHouse, x, y, z, chunk, dObj);
}

function generateDoubleTower(x, y, z, chunk, dObj) {
  generateStructureWithGroundSupport(doubleTower, x, y, z, chunk, dObj);
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
