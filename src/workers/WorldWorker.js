// src/workers/WorldWorker.js
import { setSeed } from '../utils/MathUtils.js';
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
import { belongsToStructure as checkBelongsToStructure } from '../utils/StructureUtils.js';

console.log('WorldWorker.js loaded');

// 全局错误处理
self.onerror = (e) => {
  console.error('WorldWorker internal error:', e.message, 'at', e.filename, ':', e.lineno);
};

// 结构数据加载器实例
const { uglyHouse, birchTree, birchTreeWithSnow, tank } = structureLoaders;

// 线性插值
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smoothstep 平滑插值
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 解析方块数据条目，兼容新旧格式
 * @param {string|object} value - 存储值
 * @returns {{ type: string, orientation: number }} 标准化条目
 */
function parseBlockEntry(value) {
  if (typeof value === 'string') {
    return { type: value, orientation: 0 };
  }
  if (typeof value === 'object' && value !== null) {
    return {
      type: value.type || 'air',
      orientation: value.orientation ?? value.direction ?? 0
    };
  }
  return { type: 'air', orientation: 0 };
}

const CHUNK_SIZE = 16;
const ROOMS_PER_CHUNK = 2;
const MAX_ROOM_SIZE = 5;

onmessage = async function(e) {
  const { cx, cz, seed, snapshot, structureCenters: incomingStructureCenters } = e.data;

  // 同步种子
  setSeed(seed);

  // 预加载所有结构数据（等待完成后再生成地形）
  await Promise.all([
    uglyHouse.load(),
    birchTree.load(),
    birchTreeWithSnow.load(),
    tank.load()
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

  // 模拟 Chunk 类的 add 方法 - 改为写入 blockMap
  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true, orientation = 0) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      blockMap.set(key, { x, y, z, type, solid, orientation });
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
        rovers: snapshot.entities.rovers || []
      } : { realisticTrees: [], modGunMan: [], rovers: [] }
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
  const dPlaceholder = {};

  // 确定性随机函数
  const seededRandom = (x, z, s) => {
    const val = Math.sin(x * 12.9898 + z * 78.233 + s) * 43758.5453123;
    return val - Math.floor(val);
  };

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      const h = terrainGen.generateHeight(wx, wz, centerBiome);
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

      if (inPyramid) {
        Pyramid.generate(wx, wz, h, pyInfo, fakeChunk, dPlaceholder);

        // 金字塔区域不生成其他结构（树、房屋等），但云需要正常生成
        // 跳过后续的地表装饰生成，继续执行云生成逻辑
      } else if (inIsland) {
        // 海岛生成逻辑
        const islandResult = IslandMap.generate(wx, wz, h, islandInfo, fakeChunk, dPlaceholder, seed);
        const distanceFromCenter = islandInfo.distFromCenter;
        const waterRingMax = 15 + 4 + 20; // 海岛半径 + 过渡带 + 海水环

        // 在海岛四周强制生成沙块填充（确保与大陆隔离至少 20 格）
        // 海水是用大平面模拟的，水下需要沙块填充来避免虚空裂缝
        if (distanceFromCenter > 15 + 4 && distanceFromCenter < waterRingMax) {
          // 海水环区域：从海平面下方一直填充沙块到基岩层
          const seaY = -2; // 海平面
          const bedrockY = -64; // 基岩层高度
          for (let y = seaY - 1; y >= bedrockY; y--) {
            fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
          }
        }

        // 如果海岛生成失败（由于形状噪声排除），但在过渡带内，用沙块填充
        if (!islandResult && distanceFromCenter <= 15 + 4) {
          // 过渡带区域：从海平面下方用沙块填充到基岩层
          const seaY = -2;
          const bedrockY = -64;
          for (let y = seaY - 1; y >= bedrockY; y--) {
            fakeChunk.add(wx, y, wz, 'sand', dPlaceholder);
          }
        }

        // 在海岛主体区域生成树木（1-2 棵）
        if (islandResult && islandInfo.zone === 'core' && !islandResult.isBelowSeaLevel) {
          // 使用区块级别的确定性随机来决定是否生成树木
          const treeChance = seededRandom(wx, wz, seed + 100);
          const treeCount = islandInfo.transitionFactor === 0 ? (treeChance < 0.003 ? 2 : treeChance < 0.006 ? 1 : 0) : 0;

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
              if (treeIslandInfo && treeIslandInfo.zone === 'core') {
                const task = () => Tree.generate(treeX, treeY, treeZ, fakeChunk, 'default', dPlaceholder);
                task.centerX = treeX;
                task.centerY = treeY;
                task.centerZ = treeZ;
                task.type = 'static_tree';
                structureQueue.push(task);
              }
            }
          }
        }
      } else if (inSnowLand) {
        const snowResult = SnowLand.generate(wx, wz, h, slInfo, fakeChunk, dPlaceholder);
        // 在雪地以 0.002 概率生成带雪白桦树（仅在主体区域且不在海平面以下）
        if (slInfo.transitionFactor === 0 && !snowResult.isBelowSeaLevel && seededRandom(wx, wz, seed + 10) < 0.002) {
          const task = () => generateBirchTreeWithSnow(wx, snowResult.surfaceY + 1, wz, fakeChunk, dPlaceholder);
          task.centerX = wx;
          task.centerY = snowResult.surfaceY + 1;
          task.centerZ = wz;
          task.type = 'static_tree';
          structureQueue.push(task);
        }
      } else if (inFrozenMountain) {
        const fmResult = FrozenMountain.generate(wx, wz, h, fmInfo, fakeChunk, dPlaceholder);
        // 在冰封山峰以 0.0010 概率生成带雪白桦树（仅在主体区域且不在海平面以下）
        if (fmInfo.transitionFactor === 0 && !fmResult.isBelowSeaLevel && seededRandom(wx, wz, seed + 11) < 0.0010) {
          const task = () => generateBirchTreeWithSnow(wx, fmResult.surfaceY + 1, wz, fakeChunk, dPlaceholder);
          task.centerX = wx;
          task.centerY = fmResult.surfaceY + 1;
          task.centerZ = wz;
          task.type = 'static_tree';
          structureQueue.push(task);
        }
      } else if (h < wLvl) {
        fakeChunk.add(wx, h, wz, 'sand', dPlaceholder);
        fakeChunk.add(wx, h - 1, wz, 'end_stone', dPlaceholder);
        if (centerBiome === 'SWAMP' && seededRandom(wx, wz, seed + 12) < 0.08) {
          fakeChunk.add(wx, wLvl + 0.5, wz, 'lilypad', dPlaceholder, false);
        }
        if (h < -6 && seededRandom(wx, wz, seed + 13) < 0.001 && safeForStructure) {
          structureQueue.push(() => generateStructure('ship', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers));
        }
      } else {
        let surf = 'grass', sub = 'dirt';
        if (centerBiome === 'DESERT') { surf = 'sand'; sub = 'sand'; }
        if (centerBiome === 'AZALEA') { surf = 'moss'; sub = 'dirt'; }
        if (centerBiome === 'SWAMP') { surf = 'swamp_grass'; sub = 'dirt'; }

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

        if (centerBiome === 'FOREST') {
          const forestRand = seededRandom(wx, wz, seed + 14);
          if (forestRand < 0.04) {
            if (seededRandom(wx, wz, seed + 15) < 0.15) {
              realisticTrees.push({ x: wx, y: h + 1, z: wz });
            } else {
              // 10% 概率生成白桦树，90% 概率生成普通大树
              if (seededRandom(wx, wz, seed + 16) < 0.1) {
                // 放入队列，确保在地形生成完成后执行，避免方块重叠
                const task = () => generateBirchTree(wx, h + 1, wz, fakeChunk, dPlaceholder);
                task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'static_tree';
                structureQueue.push(task);
              } else {
                const leafRand = seededRandom(wx, wz, seed + 17);
                const isYellow = leafRand < 0.1;
                const leafType = isYellow ? 'yellow_leaves' : null;
                const logRand = seededRandom(wx, wz, seed + 18);
                const isBirch = logRand < 0.1;
                const logType = isBirch ? 'birch_log' : null;
                // 放入队列，确保在地形生成完成后执行，避免方块重叠
                const task = () => Tree.generate(wx, h + 1, wz, fakeChunk, 'big', dPlaceholder, logType, leafType);
                task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'static_tree';
                structureQueue.push(task);
              }
            }
          }
        } else if (centerBiome === 'AZALEA') {
          if (seededRandom(wx, wz, seed + 19) < 0.045) {
            // 放入队列，确保在地形生成完成后执行，避免方块重叠
            const task = () => Tree.generate(wx, h + 1, wz, fakeChunk, 'azalea', dPlaceholder);
            task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'static_tree';
            structureQueue.push(task);
          }
        } else if (centerBiome === 'SWAMP') {
          if (seededRandom(wx, wz, seed + 20) < 0.03) {
            // 放入队列，确保在地形生成完成后执行，避免方块重叠
            const task = () => Tree.generate(wx, h + 1, wz, fakeChunk, 'swamp', dPlaceholder);
            task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'static_tree';
            structureQueue.push(task);
          }
        } else if (centerBiome === 'DESERT') {
          let occupied = false;
          if (seededRandom(wx, wz, seed + 21) < 0.01) fakeChunk.add(wx, h + 1, wz, 'cactus', dPlaceholder);
          if (seededRandom(wx, wz, seed + 22) < 0.0005 && safeForStructure) {
            const task = () => generateStructure('rover', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers);
            task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'rover';
            structureQueue.push(task);
          }
          // 在沙漠地形中生成丑陋小屋（概率 0.00008）
          if (!occupied && seededRandom(wx, wz, seed + 23) < 0.00008 && safeForStructure) {
            const task = () => generateUglyHouse(wx, h + 1, wz, fakeChunk, dPlaceholder);
            task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'uglyHouse';
            structureQueue.push(task);
            occupied = true;
          }
        } else {
          let occupied = false;
          const spawnRand = seededRandom(wx, wz, seed);
          if (surf === 'grass' && spawnRand < 0.0005) {
            modGunMan.push({ x: wx, y: h + 1, z: wz });
            occupied = true;
          }
          if (!occupied && seededRandom(wx, wz, seed + 1) < 0.005) {
            // 放入队列，确保在地形生成完成后执行，避免方块重叠
            const task = () => Tree.generate(wx, h + 1, wz, fakeChunk, 'default', dPlaceholder);
            task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'static_tree';
            structureQueue.push(task);
            occupied = true;
          }
          if (!occupied) {
            const randPlant = seededRandom(wx, wz, seed + 2);
            if (randPlant < 0.05) {
              fakeChunk.add(wx, h + 1, wz, 'short_grass', dPlaceholder, false);
            } else if (randPlant < 0.10) {
              const flowerRand = seededRandom(wx, wz, seed + 3);
              const flowerType = flowerRand < 0.33 ? 'allium' : 'flower';
              fakeChunk.add(wx, h + 1, wz, flowerType, dPlaceholder, false);
            }
          }
          if (seededRandom(wx, wz, seed + 4) < 0.001 && safeForStructure) {
            const task = () => generateStructure('house', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers);
            task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'house';
            structureQueue.push(task);
          }
          // 在草地上生成坦克（低概率，确保不与其他物体重叠）
          if (surf === 'grass' && !occupied && seededRandom(wx, wz, seed + 5) < 0.0001 && safeForStructure) {
            const task = () => generateTank(wx, h + 1, wz, fakeChunk, dPlaceholder);
            task.centerX = wx; task.centerY = h + 1; task.centerZ = wz; task.type = 'tank';
            structureQueue.push(task);
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

  structureQueueWithCenters.forEach(({ task, centerX, centerY, centerZ, type }) => {
    task();
    // 如果是大型结构，添加到结构中心列表
    // 关键修复：只添加中心点在当前 Chunk 内的结构
    if (type && centerX !== undefined) {
      if (centerX >= minX && centerX < maxX && centerZ >= minZ && centerZ < maxZ) {
        structureCenters.push({ type, x: centerX, y: centerY, z: centerZ });
      }
    }
  });

  // 如果有 snapshot，用 snapshot 中的方块覆盖 blockMap（保留玩家修改）
  if (savedSnapshot) {
    // 从 snapshot 恢复实体列表
    realisticTrees = savedSnapshot.entities.realisticTrees || [];
    modGunMan = savedSnapshot.entities.modGunMan || [];
    rovers = savedSnapshot.entities.rovers || [];

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

    // 用 snapshot 中的方块覆盖 blockMap（保留玩家修改）
    if (savedSnapshot.blocks) {
      // 在 snapshot 模式下，需要根据 snapshot 清理“当前 Chunk 负责渲染/存储范围”的被删除方块
      // 注意：跨 Chunk 结构方块也可能归属当前 Chunk，仅清理 chunk 内坐标会导致读档后复显
      for (const [key, b] of blockMap) {
        const inCurrentChunk = b.x >= minX && b.x < maxX && b.z >= minZ && b.z < maxZ;
        const isCrossChunkStructureBlock = !inCurrentChunk &&
          checkBelongsToStructure(b.x, b.y, b.z, structureCenters);
        const isInResponsibility = inCurrentChunk || isCrossChunkStructureBlock;

        // 只清理当前 Chunk 责任范围内的方块
        if (isInResponsibility) {
          // 如果该坐标不在 snapshot 中，说明玩家已删除该方块（或该坐标原本就是空气）
          if (!savedSnapshot.blocks[key]) {
            blockMap.delete(key);
          }
        }
      }

      for (const key in savedSnapshot.blocks) {
        const entry = parseBlockEntry(savedSnapshot.blocks[key]);
        const [bx, by, bz] = key.split(',').map(Number);
        const solid = getBlockProperties(entry.type).isSolid;
        blockMap.set(key, { x: bx, y: by, z: bz, type: entry.type, solid, orientation: entry.orientation });
      }
    }
  }

  // 统一后处理：AO 计算、隐藏面剔除，并返回渲染数据
  const blocksForSnapshot = {};
  for (const [key, b] of blockMap) {
    // 保存新格式（包含朝向）
    blocksForSnapshot[key] = { type: b.type, orientation: b.orientation || 0 };
  }

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

  /**
   * 计算指定角落的 AO 值 (0-3)
   * AO = 3 - (side1 + side2 + corner)
   * 如果 side1 和 side2 都是空气，则忽略 corner (Minecraft 优化逻辑)
   */
  const getAOValue = (side1, side2, corner) => {
    const s1 = side1 ? 1 : 0;
    const s2 = side2 ? 1 : 0;
    const c = (side1 || side2) ? (corner ? 1 : 0) : 0; // Minecraft 逻辑：只有当侧边存在时才考虑对角

    if (s1 && s2) return 0; // 两个侧面都遮挡，AO 为 0 (最暗)
    return 3 - (s1 + s2 + c);
  };

  const getAO = (x, y, z, faceIdx) => {
    // 强制坐标整数化，确保 Map 查找准确
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    // faceIdx: 0:px, 1:nx, 2:py, 3:ny, 4:pz, 5:nz
    const aos = new Uint8Array(4).fill(3);

    if (faceIdx === 0) { // px (+X side)
      // V0: (1, 1, 1) [Top, PZ]
      aos[0] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix+1, iy, iz+1), isOccluding(ix+1, iy+1, iz+1));
      // V1: (1, 1, -1) [Top, NZ]
      aos[1] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix+1, iy, iz-1), isOccluding(ix+1, iy+1, iz-1));
      // V2: (1, -1, 1) [Bottom, PZ]
      aos[2] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix+1, iy, iz+1), isOccluding(ix+1, iy-1, iz+1));
      // V3: (1, -1, -1) [Bottom, NZ]
      aos[3] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix+1, iy, iz-1), isOccluding(ix+1, iy-1, iz-1));
    } else if (faceIdx === 1) { // nx (-X side)
      // V4: (-1, 1, -1) [Top, NZ]
      aos[0] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix-1, iy, iz-1), isOccluding(ix-1, iy+1, iz-1));
      // V5: (-1, 1, 1) [Top, PZ]
      aos[1] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix-1, iy, iz+1), isOccluding(ix-1, iy+1, iz+1));
      // V6: (-1, -1, -1) [Bottom, NZ]
      aos[2] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix-1, iy, iz-1), isOccluding(ix-1, iy-1, iz-1));
      // V7: (-1, -1, 1) [Bottom, PZ]
      aos[3] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix-1, iy, iz+1), isOccluding(ix-1, iy-1, iz+1));
    } else if (faceIdx === 2) { // py (+Y top)
      // V8: (-1, 1, -1) [NX, NZ]
      aos[0] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix, iy+1, iz-1), isOccluding(ix-1, iy+1, iz-1));
      // V9: (1, 1, -1) [PX, NZ]
      aos[1] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix, iy+1, iz-1), isOccluding(ix+1, iy+1, iz-1));
      // V10: (-1, 1, 1) [NX, PZ]
      aos[2] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix, iy+1, iz+1), isOccluding(ix-1, iy+1, iz+1));
      // V11: (1, 1, 1) [PX, PZ]
      aos[3] = getAOValue(ix+1, iy+1, iz+1) ? 0 : getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix, iy+1, iz+1), isOccluding(ix+1, iy+1, iz+1));
      // 修正 V11 的写法统一
      aos[3] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix, iy+1, iz+1), isOccluding(ix+1, iy+1, iz+1));
    } else if (faceIdx === 3) { // ny (-Y bottom)
      // V12: (-1, -1, 1) [NX, PZ]
      aos[0] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix, iy-1, iz+1), isOccluding(ix-1, iy-1, iz+1));
      // V13: (1, -1, 1) [PX, PZ]
      aos[1] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix, iy-1, iz+1), isOccluding(ix+1, iy-1, iz+1));
      // V14: (-1, -1, -1) [NX, NZ]
      aos[2] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix, iy-1, iz-1), isOccluding(ix-1, iy-1, iz-1));
      // V15: (1, -1, -1) [PX, NZ]
      aos[3] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix, iy-1, iz-1), isOccluding(ix+1, iy-1, iz-1));
    } else if (faceIdx === 4) { // pz (+Z side)
      // V16: (-1, 1, 1) [NX, Top]
      aos[0] = getAOValue(isOccluding(ix-1, iy, iz+1), isOccluding(ix, iy+1, iz+1), isOccluding(ix-1, iy+1, iz+1));
      // V17: (1, 1, 1) [PX, Top]
      aos[1] = getAOValue(isOccluding(ix+1, iy, iz+1), isOccluding(ix, iy+1, iz+1), isOccluding(ix+1, iy+1, iz+1));
      // V18: (-1, -1, 1) [NX, Bottom]
      aos[2] = getAOValue(isOccluding(ix-1, iy, iz+1), isOccluding(ix, iy-1, iz+1), isOccluding(ix-1, iy-1, iz+1));
      // V19: (1, -1, 1) [PX, Bottom]
      aos[3] = getAOValue(isOccluding(ix+1, iy, iz+1), isOccluding(ix, iy-1, iz+1), isOccluding(ix+1, iy-1, iz+1));
    } else if (faceIdx === 5) { // nz (-Z side)
      // V20: (1, 1, -1) [PX, Top]
      aos[0] = getAOValue(isOccluding(ix+1, iy, iz-1), isOccluding(ix, iy+1, iz-1), isOccluding(ix+1, iy+1, iz-1));
      // V21: (-1, 1, -1) [NX, Top]
      aos[1] = getAOValue(isOccluding(ix-1, iy, iz-1), isOccluding(ix, iy+1, iz-1), isOccluding(ix-1, iy+1, iz-1));
      // V22: (1, -1, -1) [PX, Bottom]
      aos[2] = getAOValue(isOccluding(ix+1, iy, iz-1), isOccluding(ix, iy-1, iz-1), isOccluding(ix+1, iy-1, iz-1));
      // V23: (-1, -1, -1) [NX, Bottom]
      aos[3] = getAOValue(isOccluding(ix-1, iy, iz-1), isOccluding(ix, iy-1, iz-1), isOccluding(ix-1, iy-1, iz-1));
    }
    return aos;
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

  // 辅助函数：判断一个方块是否属于某个结构中心（使用统一的工具函数）
  const belongsToStructure = (bx, by, bz) => checkBelongsToStructure(bx, by, bz, structureCenters);

  for (const [key, block] of blockMap) {
    const inCurrentChunk = block.x >= minX && block.x < maxX && block.z >= minZ && block.z < maxZ;
    const isCrossChunkStructureBlock = !inCurrentChunk && belongsToStructure(block.x, block.y, block.z);

    // 固体方块：只要在 Chunk 内或者是跨区结构方块，都添加到 solidBlocks
    if (block.solid && (inCurrentChunk || isCrossChunkStructureBlock)) solidBlocks.push(key);
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

    allBlockTypes[key] = { type: block.type, orientation: block.orientation || 0 };

    // 渲染条件：在当前 Chunk 内，或者属于当前 Chunk 的跨区结构
    const shouldRender = inCurrentChunk || isCrossChunkStructureBlock;

    if (shouldRender && visible) {
      if (!d[block.type]) d[block.type] = [];
      let aoLow = 0;
      let aoHigh = 0;
      // 简化AO逻辑：非透明且实心的方块自动启用AO
      const props = getBlockProperties(block.type);
      const isAOEnabled = !props.isTransparent && props.isSolid;
      if (isAOEnabled) {
        for (let f = 0; f < 6; f++) {
          const aos = getAO(block.x, block.y, block.z, f);
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
    cx, cz, d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys,
    structureCenters, // 新增：当前 Chunk 负责渲染的结构中心列表
    snapshot: {
      blocks: blocksForSnapshot,
      entities: { realisticTrees, modGunMan, rovers }
    }
  });
};

// 用于隐藏面剔除的辅助函数
const getBlockType = (x, y, z, blockMap) => {
  const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const block = blockMap.get(key);
  return block ? block.type : null;
};

const isTransparent = (type) => {
  if (!type) return false;
  // 根据BLOCK_DATA判断透明性
  const props = BLOCK_DATA[type];
  if (props) return props.isTransparent;
  // 默认情况：'air', 'water'等为透明
  return type === 'air' || type === 'water' || type === 'glass_block' ||
         type === 'glass_blink' || type === 'flower' || type === 'short_grass' ||
         type === 'allium' || type === 'vine' || type === 'lilypad';
};

/**
 * 计算单个方块的可见面掩码
 * @param {Object} block - 方块信息 {x, y, z, type}
 * @param {Map} blockMap - 方块映射表
 * @returns {number} 面掩码
 */
function calculateFaceVisibility(block, blockMap) {
  if (block.type === 'chest' || block.type === 'collider') {
    return 63; // 所有面都可见
  }

  if (isTransparent(block.type)) {
    return 63; // 透明方块所有面可见
  }

  let mask = 0;
  const { x, y, z } = block;

  // 检查六个方向
  if (!getBlockType(x, y + 1, z, blockMap) || isTransparent(getBlockType(x, y + 1, z, blockMap))) mask |= 1; // TOP
  if (!getBlockType(x, y - 1, z, blockMap) || isTransparent(getBlockType(x, y - 1, z, blockMap))) mask |= 2; // BOTTOM
  if (!getBlockType(x, y, z - 1, blockMap) || isTransparent(getBlockType(x, y, z - 1, blockMap))) mask |= 4; // NORTH
  if (!getBlockType(x, y, z + 1, blockMap) || isTransparent(getBlockType(x, y, z + 1, blockMap))) mask |= 8; // SOUTH
  if (!getBlockType(x - 1, y, z, blockMap) || isTransparent(getBlockType(x - 1, y, z, blockMap))) mask |= 16; // WEST
  if (!getBlockType(x + 1, y, z, blockMap) || isTransparent(getBlockType(x + 1, y, z, blockMap))) mask |= 32; // EAST

  return mask;
}

/**
 * 批量更新方块可见面状态
 * @param {Array} blockUpdates - 需要更新的方块列表
 * @param {Map} blockMap - 当前方块映射表
 * @returns {Object} 更新结果
 */
function batchCalculateFaceVisibility(blockUpdates, blockMap) {
  const results = [];

  // 也更新受影响的邻居方块
  const allBlocksToCheck = new Set();

  for (const update of blockUpdates) {
    // 添加更新的方块
    allBlocksToCheck.add(`${Math.floor(update.x)},${Math.floor(update.y)},${Math.floor(update.z)}`);

    // 添加邻居方块
    const { x, y, z } = update;
    const neighbors = [
      [x+1, y, z], [x-1, y, z], [x, y+1, z], [x, y-1, z], [x, y, z+1], [x, y, z-1]
    ];

    for (const [nx, ny, nz] of neighbors) {
      allBlocksToCheck.add(`${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`);
    }
  }

  for (const key of allBlocksToCheck) {
    const [bx, by, bz] = key.split(',').map(Number);
    const block = blockMap.get(key);
    if (block) {
      const visibility = calculateFaceVisibility(block, blockMap);
      results.push({
        x: bx, y: by, z: bz, type: block.type, visibility
      });
    }
  }

  return results;
}

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
 * 生成丑陋小屋（从 JSON 数据）
 * @param {number} x - X 坐标（小屋中心点）
 * @param {number} y - Y 坐标（地面高度）
 * @param {number} z - Z 坐标（小屋中心点）
 * @param {Object} chunk - 区块对象
 * @param {Object} dObj - 数据收集对象
 */
function generateUglyHouse(x, y, z, chunk, dObj) {
  uglyHouse.generate(x, y, z, chunk, dObj, true);
}
