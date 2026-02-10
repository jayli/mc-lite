// src/workers/WorldWorker.js
import { setSeed } from '../utils/MathUtils.js';
import { terrainGen } from '../world/TerrainGen.js';
import { Tree } from '../world/entities/Tree.js';
import { Cloud } from '../world/entities/Cloud.js';
import { Island } from '../world/entities/Island.js';
import { getBlockProperties, BLOCK_DATA } from '../constants/BlockData.js';

const CHUNK_SIZE = 16;
const ROOMS_PER_CHUNK = 2;
const MAX_ROOM_SIZE = 5;

onmessage = function(e) {
  const { cx, cz, seed, snapshot } = e.data;

  // 同步种子
  setSeed(seed);

  // 使用 Map 暂存方块，确保同一位置后生成的方块覆盖旧方块
  const blockMap = new Map();
  let realisticTrees = []; // 记录真实 tree 的位置
  let modGunMan = []; // 记录模型人 (gun_man.glb) 的位置
  let rovers = []; // 记录火星车的位置
  const structureQueue = []; // 结构生成队列，确保结构覆盖地形

  // 模拟 Chunk 类的 add 方法 - 改为写入 blockMap
  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      blockMap.set(key, { x, y, z, type, solid });
    }
  };

  if (snapshot) {
    // 如果存在快照，直接恢复数据
    if (snapshot.blocks) {
      for (const key in snapshot.blocks) {
        const type = snapshot.blocks[key];
        const [bx, by, bz] = key.split(',').map(Number);
        // 从全局配置获取实心属性
        const solid = getBlockProperties(type).isSolid;
        blockMap.set(key, { x: bx, y: by, z: bz, type, solid });
      }
    }
    if (snapshot.entities) {
      realisticTrees = snapshot.entities.realisticTrees || [];
      modGunMan = snapshot.entities.modGunMan || [];
      rovers = snapshot.entities.rovers || [];
    }
  } else {
    // 如果快照不存在，执行原有的地形、生物群系和结构生成逻辑
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

        if (h < wLvl) {
          fakeChunk.add(wx, h, wz, 'sand', dPlaceholder);
          fakeChunk.add(wx, h - 1, wz, 'end_stone', dPlaceholder);
          if (centerBiome === 'SWAMP' && Math.random() < 0.08) {
            fakeChunk.add(wx, wLvl + 0.5, wz, 'lilypad', dPlaceholder, false);
          }
          if (h < -6 && Math.random() < 0.001 && safeForStructure) {
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
            const blockType = Math.random() < 0.05 ? 'gold_ore' : 'stone';
            fakeChunk.add(wx, h - k, wz, blockType, dPlaceholder);
          }

          if (centerBiome === 'FOREST') {
            if (Math.random() < 0.04) {
              if (Math.random() < 0.15) {
                realisticTrees.push({ x: wx, y: h + 1, z: wz });
              } else {
                const isYellow = Math.random() < 0.1;
                const leafType = isYellow ? 'yellow_leaves' : null;
                const isBirch = Math.random() < 0.1;
                const logType = isBirch ? 'birch_log' : null;
                Tree.generate(wx, h + 1, wz, fakeChunk, 'big', dPlaceholder, logType, leafType);
              }
            }
          } else if (centerBiome === 'AZALEA') {
            if (Math.random() < 0.045) Tree.generate(wx, h + 1, wz, fakeChunk, 'azalea', dPlaceholder);
          } else if (centerBiome === 'SWAMP') {
            if (Math.random() < 0.03) Tree.generate(wx, h + 1, wz, fakeChunk, 'swamp', dPlaceholder);
          } else if (centerBiome === 'DESERT') {
            if (Math.random() < 0.01) fakeChunk.add(wx, h + 1, wz, 'cactus', dPlaceholder);
            if (Math.random() < 0.0005 && safeForStructure) {
              structureQueue.push(() => generateStructure('rover', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers));
            }
          } else {
            let occupied = false;
            const spawnRand = seededRandom(wx, wz, seed);
            if (surf === 'grass' && spawnRand < 0.0005) {
              modGunMan.push({ x: wx, y: h + 1, z: wz });
              occupied = true;
            }
            if (!occupied && Math.random() < 0.005) {
              Tree.generate(wx, h + 1, wz, fakeChunk, 'default', dPlaceholder);
              occupied = true;
            }
            if (!occupied) {
              const randPlant = Math.random();
              if (randPlant < 0.05) {
                fakeChunk.add(wx, h + 1, wz, 'short_grass', dPlaceholder, false);
              } else if (randPlant < 0.10) {
                const flowerType = Math.random() < 0.33 ? 'allium' : 'flower';
                fakeChunk.add(wx, h + 1, wz, flowerType, dPlaceholder, false);
              }
            }
            if (Math.random() < 0.001 && safeForStructure) {
              structureQueue.push(() => generateStructure('house', wx, h + 1, wz, fakeChunk, dPlaceholder, rovers));
            }
          }
        }
        if (terrainGen.shouldGenerateCloud(wx, wz)) {
          Cloud.generate(wx, 55, wz, fakeChunk, dPlaceholder);
        }
      }
    }

    if (Math.random() < 0.08) {
      const islandY = 40 + Math.floor(Math.random() * 30);
      const centerWx = cx * CHUNK_SIZE + 8;
      const centerWz = cz * CHUNK_SIZE + 8;
      Island.generate(centerWx, islandY, centerWz, fakeChunk, dPlaceholder);
    }
    if (Math.random() < 0.20) {
      const startX = cx * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
      const startZ = cz * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
      const size = 30 + Math.floor(Math.random() * 21);
      Cloud.generateCluster(startX, 35, startZ, size, fakeChunk, dPlaceholder);
    }
    structureQueue.forEach(task => task());
  }

  // 统一后处理：AO 计算、隐藏面剔除，并返回渲染数据
  const blocksForSnapshot = {};
  for (const [key, b] of blockMap) {
    blocksForSnapshot[key] = b.type;
  }

  // 将 blockMap 转换为 d 和 solidBlocks
  const d = {};
  const solidBlocks = [];

  // 辅助函数：判断指定位置的方块是否遮挡视线
  const isOccluding = (x, y, z) => {
    const k = `${x},${y},${z}`;
    const b = blockMap.get(k);
    if (!b) return false;
    if (!b.solid) return false;
    // 如果方块是透明的，则不遮挡视线
    if (getBlockProperties(b.type).isTransparent) return false;
    return true;
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

  for (const [key, block] of blockMap) {
    // if (block.type === 'air') {
    //     allBlockTypes[key] = 'air';
    //     continue;
    // }
    if (block.solid) solidBlocks.push(key);
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

    if (visible) {
      if (!d[block.type]) d[block.type] = [];
      let aoLow = 0;
      let aoHigh = 0;
      const props = getBlockProperties(block.type);
      if (props.isAOEnabled) {
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
      d[block.type].push({x: block.x, y: block.y, z: block.z, aoLow, aoHigh});
      visibleKeys.push(key);
    }
    allBlockTypes[key] = block.type;
  }

  // 返回数据
  postMessage({
    cx, cz, d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys,
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
