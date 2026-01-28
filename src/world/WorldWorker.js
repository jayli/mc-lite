// src/world/WorldWorker.js
import { setSeed } from '../utils/MathUtils.js';
import { terrainGen } from './TerrainGen.js';
import { Tree } from './entities/Tree.js';
import { Cloud } from './entities/Cloud.js';
import { Island } from './entities/Island.js';

const CHUNK_SIZE = 16;
const ROOMS_PER_CHUNK = 2;
const MAX_ROOM_SIZE = 5;

onmessage = function(e) {
  const { cx, cz, seed, deltas } = e.data;

  // 同步种子
  setSeed(seed);

  // 预先计算该区块的房间种子（基于区块坐标的确定性随机）
  // 使用简单的线性同余或哈希来确保每个区块的房间位置固定
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
    const ry = 2 + Math.floor(nextRand() * 8); // 在 k=2 到 k=10 之间
    const rw = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    const rh = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    const rd = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1));
    rooms.push({
      minX: cx * CHUNK_SIZE + rx - Math.floor(rw/2),
      maxX: cx * CHUNK_SIZE + rx + Math.floor(rw/2),
      minY: ry, // 这里暂时记录相对高度偏移 k
      maxY: ry + rh,
      minZ: cz * CHUNK_SIZE + rz - Math.floor(rd/2),
      maxZ: cz * CHUNK_SIZE + rz + Math.floor(rd/2)
    });
  }

  const d = {};
  const solidBlocks = []; // 传递数组更高效
  const realisticTrees = []; // 记录真实树木的位置

  // 初始化所有可能的类型数组
  const allTypes = [
    'grass', 'dirt', 'stone', 'sand', 'wood', 'birch_log', 'planks', 'oak_planks', 'white_planks',
    'obsidian', 'leaves', 'water', 'cactus', 'flower', 'short_grass', 'allium', 'chest', 'bookbox',
    'carBody', 'wheel', 'cloud', 'sky_stone', 'sky_grass', 'sky_wood', 'sky_leaves', 'moss',
    'azalea_log', 'azalea_leaves', 'azalea_flowers', 'swamp_water', 'swamp_grass', 'vine',
    'lilypad', 'diamond', 'gold', 'apple', 'gold_apple', 'god_sword', 'glass_block', 'glass_blink',
    'gold_ore', 'calcite', 'bricks', 'chimney', 'gold_block', 'emerald', 'amethyst', 'debris', 'iron', 'iron_ore', 'end_stone'
  ];
  for(const type of allTypes) {
    d[type] = [];
  }

  // 模拟 Chunk 类的 add 方法
  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true) => {
      const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
      // 检查持久化增量覆盖
      if (deltas && deltas[key]) return;

      if (dObj) {
        if (!dObj[type]) dObj[type] = [];
        dObj[type].push({ x, y, z });
      }
      if (solid) {
        solidBlocks.push(key);
      }
    }
  };

  // 获取区块中心生物群系
  const centerBiome = terrainGen.getBiome(cx * CHUNK_SIZE, cz * CHUNK_SIZE);

  // 核心生成逻辑 (从 Chunk.js 迁移)
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;

      const h = terrainGen.generateHeight(wx, wz, centerBiome);
      const wLvl = -2;

      if (h < wLvl) {
        fakeChunk.add(wx, h, wz, 'sand', d);
        fakeChunk.add(wx, h - 1, wz, 'end_stone', d);

        if (centerBiome === 'SWAMP' && Math.random() < 0.08) {
          fakeChunk.add(wx, wLvl + 0.1, wz, 'lilypad', d, false);
        }
        // 结构生成 (简化处理)
        if (h < -6 && Math.random() < 0.001) {
          // ship 结构可以在这里生成，或者标记位置
          generateStructure('ship', wx, h + 1, wz, fakeChunk, d);
        }
      } else {
        let surf = 'grass', sub = 'dirt';
        if (centerBiome === 'DESERT') { surf = 'sand'; sub = 'sand'; }
        if (centerBiome === 'AZALEA') { surf = 'moss'; sub = 'dirt'; }
        if (centerBiome === 'SWAMP') { surf = 'swamp_grass'; sub = 'dirt'; }

        fakeChunk.add(wx, h, wz, surf, d);
        fakeChunk.add(wx, h - 1, wz, sub, d);

        for (let k = 2; k <= 12; k++) {
          if (k === 12) {
            // 基岩层
            fakeChunk.add(wx, h - k, wz, 'end_stone', d);
            continue;
          }
          if (k === 11) {
            // 实体保护层（防止穿透基岩）
            fakeChunk.add(wx, h - k, wz, 'stone', d);
            continue;
          }

          // 检查是否处于预生成的房间（矿洞）内
          let inRoom = false;
          for (const r of rooms) {
            if (wx >= r.minX && wx <= r.maxX && wz >= r.minZ && wz <= r.maxZ && k >= r.minY && k <= r.maxY) {
              inRoom = true;
              break;
            }
          }

          if (inRoom) continue; // 如果在房间内，则生成空气（跳过添加方块）

          const blockType = Math.random() < 0.1 ? 'gold_ore' : 'stone';
          fakeChunk.add(wx, h - k, wz, blockType, d);
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
              Tree.generate(wx, h + 1, wz, fakeChunk, 'big', d, logType, leafType);
            }
          }
        } else if (centerBiome === 'AZALEA') {
          if (Math.random() < 0.045) Tree.generate(wx, h + 1, wz, fakeChunk, 'azalea', d);
        } else if (centerBiome === 'SWAMP') {
          if (Math.random() < 0.03) Tree.generate(wx, h + 1, wz, fakeChunk, 'swamp', d);
        } else if (centerBiome === 'DESERT') {
          if (Math.random() < 0.01) fakeChunk.add(wx, h + 1, wz, 'cactus', d);
          if (Math.random() < 0.001) generateStructure('rover', wx, h + 1, wz, fakeChunk, d);
        } else {
          if (Math.random() < 0.005) {
            Tree.generate(wx, h + 1, wz, fakeChunk, 'default', d);
          }
          const randPlant = Math.random();
          if (randPlant < 0.05) {
            fakeChunk.add(wx, h + 1, wz, 'short_grass', d, false);
          } else if (randPlant < 0.10) {
            const flowerType = Math.random() < 0.33 ? 'allium' : 'flower';
            fakeChunk.add(wx, h + 1, wz, flowerType, d, false);
          }
          if (Math.random() < 0.001) generateStructure('house', wx, h + 1, wz, fakeChunk, d);
        }
      }

      if (terrainGen.shouldGenerateCloud(wx, wz)) {
        Cloud.generate(wx, 55, wz, fakeChunk, d);
      }
    }
  }

  // 天空岛生成
  if (Math.random() < 0.08) {
    const islandY = 40 + Math.floor(Math.random() * 30);
    const centerWx = cx * CHUNK_SIZE + 8;
    const centerWz = cz * CHUNK_SIZE + 8;
    Island.generate(centerWx, islandY, centerWz, fakeChunk, d);
  }

  // 低空簇状云
  if (Math.random() < 0.10) {
    const startX = cx * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
    const startZ = cz * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
    const size = 20 + Math.floor(Math.random() * 21);
    Cloud.generateCluster(startX, 45, startZ, size, fakeChunk, d);
  }

  // 叠加持久化修改
  for (const blockKey in deltas) {
    const delta = deltas[blockKey];
    if (delta.type !== 'air') {
      const [bx, by, bz] = blockKey.split(',').map(Number);
      if (!d[delta.type]) d[delta.type] = [];
      d[delta.type].push({ x: bx, y: by, z: bz });

      // 简单逻辑：部分方块非实心
      if (!['water', 'swamp_water', 'cloud', 'vine', 'lilypad', 'flower', 'short_grass'].includes(delta.type)) {
        solidBlocks.push(blockKey);
      }
    }
  }

  // 返回数据
  postMessage({ cx, cz, d, solidBlocks, realisticTrees });
};

// 复制结构生成逻辑 (避免依赖 Chunk.js 的循环引用)
function generateStructure(type, x, y, z, chunk, dObj) {
    if (type === 'house') {
      const wallMat = Math.random() < 0.33 ? 'bricks' : 'planks';
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) chunk.add(x + i, y - 1, z + j, 'stone', dObj);
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        if (Math.abs(i) === 2 || Math.abs(j) === 2) {
          if (i === 0 && j === 2) continue;
          if ((i === -2 || i === 2) && j === 0) {
            chunk.add(x + i, y, z + j, wallMat, dObj);
            chunk.add(x + i, y + 1, z + j, 'glass_block', dObj, false);
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
      chunk.add(x - 1, y, z - 1, 'wheel', dObj);
      chunk.add(x + 1, y, z - 1, 'wheel', dObj);
      chunk.add(x - 1, y, z + 1, 'wheel', dObj);
      chunk.add(x + 1, y, z + 1, 'wheel', dObj);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 2; dz++) chunk.add(x + dx, y + 1, z + dz, 'carBody', dObj);
      chunk.add(x, y + 2, z, 'chest', dObj);
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
