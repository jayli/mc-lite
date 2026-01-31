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

  // 预先计算该区块的房间种子（基于区块坐标的确定性随机，保证同一个区块每次生成的矿洞位置一致）
  // 73856093 和 19349663 是常用的质数，用于简单的哈希计算
  const rooms = [];
  const roomSeed = Math.abs((cx * 73856093) ^ (cz * 19349663) ^ seed);
  let rRand = roomSeed;
  // 线性同余生成器 (LCG) 参数，用于生成确定性的伪随机数
  const nextRand = () => {
    rRand = (rRand * 1103515245 + 12345) & 0x7fffffff;
    return rRand / 0x7fffffff;
  };

  for (let i = 0; i < ROOMS_PER_CHUNK; i++) {
    const rx = Math.floor(nextRand() * CHUNK_SIZE);
    const rz = Math.floor(nextRand() * CHUNK_SIZE);
    const ry = 2 + Math.floor(nextRand() * 8); // 矿洞垂直位置在 y=2 到 y=10 之间
    const rw = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1)); // 宽度
    const rh = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1)); // 高度
    const rd = 2 + Math.floor(nextRand() * (MAX_ROOM_SIZE - 1)); // 深度
    rooms.push({
      minX: cx * CHUNK_SIZE + rx - Math.floor(rw/2),
      maxX: cx * CHUNK_SIZE + rx + Math.floor(rw/2),
      minY: ry,
      maxY: ry + rh,
      minZ: cz * CHUNK_SIZE + rz - Math.floor(rd/2),
      maxZ: cz * CHUNK_SIZE + rz + Math.floor(rd/2)
    });
  }

  // 使用 Map 暂存方块，确保同一位置后生成的方块覆盖旧方块
  const blockMap = new Map();
  const realisticTrees = []; // 记录真实树木的位置
  const structureQueue = []; // 结构生成队列，确保结构覆盖地形

  // 模拟 Chunk 类的 add 方法 - 改为写入 blockMap
  const fakeChunk = {
    add: (x, y, z, type, dObj, solid = true) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      // 检查持久化增量覆盖
      if (deltas && deltas[key]) return;

      blockMap.set(key, { x, y, z, type, solid });
    }
  };

  // 获取区块中心生物群系
  const centerBiome = terrainGen.getBiome(cx * CHUNK_SIZE, cz * CHUNK_SIZE);
  // 数据收集对象占位符
  const dPlaceholder = {};

  // 核心生成逻辑 (从 Chunk.js 迁移)
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;

      const h = terrainGen.generateHeight(wx, wz, centerBiome);
      const wLvl = -2; // 海平面基准线高度，低于此高度可能生成水或沙滩

      // 结构生成安全检查
      const safeForStructure = x >= 3 && x <= 12 && z >= 3 && z <= 12;

      if (h < wLvl) {
        // 低于海平面：生成沙子和底部的末地石
        fakeChunk.add(wx, h, wz, 'sand', dPlaceholder);
        fakeChunk.add(wx, h - 1, wz, 'end_stone', dPlaceholder);

        if (centerBiome === 'SWAMP' && Math.random() < 0.08) {
          // 沼泽生物群系：8% 概率在水面上生成睡莲 (1.1 偏移量使其浮在水面上方一点点)
          fakeChunk.add(wx, wLvl + 1.1, wz, 'lilypad', dPlaceholder, false);
        }

        // 结构生成 (沉船) - 加入队列
        if (h < -6 && Math.random() < 0.001 && safeForStructure) {
          structureQueue.push(() => generateStructure('ship', wx, h + 1, wz, fakeChunk, dPlaceholder));
        }
      } else {
        // 高于海平面：根据生物群系确定地表和地下材质
        let surf = 'grass', sub = 'dirt';
        if (centerBiome === 'DESERT') { surf = 'sand'; sub = 'sand'; }
        if (centerBiome === 'AZALEA') { surf = 'moss'; sub = 'dirt'; }
        if (centerBiome === 'SWAMP') { surf = 'swamp_grass'; sub = 'dirt'; }

        fakeChunk.add(wx, h, wz, surf, dPlaceholder);     // 地表层
        fakeChunk.add(wx, h - 1, wz, sub, dPlaceholder); // 地表下一层

        // 垂直生成逻辑：处理地下岩层和矿洞
        for (let k = 2; k <= 12; k++) {
          if (k === 12) {
            // 基岩层 (y = h - 12)
            fakeChunk.add(wx, h - k, wz, 'end_stone', dPlaceholder);
            continue;
          }
          if (k === 11) {
            // 实体保护层 (y = h - 11)：防止玩家穿透基岩
            fakeChunk.add(wx, h - k, wz, 'stone', dPlaceholder);
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

          if (inRoom) continue; // 如果在矿洞范围内，则跳过方块生成（即为空气）

          // 10% 概率生成金矿，否则生成石头
          const blockType = Math.random() < 0.1 ? 'gold_ore' : 'stone';
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
          if (Math.random() < 0.001 && safeForStructure) {
            structureQueue.push(() => generateStructure('rover', wx, h + 1, wz, fakeChunk, dPlaceholder));
          }
        } else {
          let occupied = false;
          if (Math.random() < 0.005) {
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
            structureQueue.push(() => generateStructure('house', wx, h + 1, wz, fakeChunk, dPlaceholder));
          }
        }
      }

      if (terrainGen.shouldGenerateCloud(wx, wz)) {
        Cloud.generate(wx, 55, wz, fakeChunk, dPlaceholder);
      }
    }
  }

  // 天空岛生成
  if (Math.random() < 0.08) {
    const islandY = 40 + Math.floor(Math.random() * 30);
    const centerWx = cx * CHUNK_SIZE + 8;
    const centerWz = cz * CHUNK_SIZE + 8;
    Island.generate(centerWx, islandY, centerWz, fakeChunk, dPlaceholder);
  }

  // 低空簇状云，控制低空云生成的密度
  if (Math.random() < 0.20) {
    const startX = cx * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
    const startZ = cz * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
    const size = 30 + Math.floor(Math.random() * 21);
    // 第二个参数，控制地空云生成的高度
    Cloud.generateCluster(startX, 35, startZ, size, fakeChunk, dPlaceholder);
  }

  // 处理结构队列 (房屋、Rover、沉船)，确保它们覆盖地形
  structureQueue.forEach(task => task());

  // 叠加持久化修改
  for (const blockKey in deltas) {
    const delta = deltas[blockKey];
    if (delta.type !== 'air') {
      const [bx, by, bz] = blockKey.split(',').map(Number);

      // 简单逻辑：部分方块非实心
      const solid = !['water', 'swamp_water', 'cloud', 'vine', 'lilypad', 'flower', 'short_grass'].includes(delta.type);
      blockMap.set(blockKey, { x: bx, y: by, z: bz, type: delta.type, solid });
    } else {
      // 如果是空气，确保 Map 里没有东西
      blockMap.delete(blockKey);
    }
  }

  // 将 blockMap 转换为 d 和 solidBlocks
  const d = {};
  const solidBlocks = [];

  // 定义非遮挡方块列表（视线可穿透）
  const nonOccludingTypes = new Set([
    'air',
    'water', 'swamp_water',
    'glass_block', 'glass_blink',
    'cloud',
    'vine', 'lilypad',
    'flower', 'short_grass', 'allium',
    'leaves', 'yellow_leaves', 'azalea_leaves', 'swamp_leaves',
    'cactus'
  ]);

  // 辅助函数：判断指定位置的方块是否遮挡视线
  const isOccluding = (x, y, z) => {
    const k = `${x},${y},${z}`;
    const b = blockMap.get(k);
    if (!b) return false;
    if (!b.solid) return false;
    if (nonOccludingTypes.has(b.type)) return false;
    return true;
  };

  // 初始化所有可能的类型数组
  const allTypes = [
    'grass', 'dirt', 'stone', 'sand', 'wood', 'birch_log', 'planks', 'oak_planks', 'white_planks',
    'obsidian', 'leaves', 'water', 'cactus', 'flower', 'short_grass', 'allium', 'chest', 'bookbox',
    'carBody', 'wheel', 'cloud', 'sky_stone', 'sky_grass', 'sky_wood', 'sky_leaves', 'moss',
    'azalea_log', 'azalea_leaves', 'azalea_flowers', 'swamp_water', 'swamp_grass', 'vine',
    'lilypad', 'diamond', 'gold', 'apple', 'gold_apple', 'god_sword', 'glass_block', 'glass_blink',
    'gold_ore', 'calcite', 'bricks', 'chimney', 'gold_block', 'emerald', 'amethyst', 'debris', 'iron', 'iron_ore', 'end_stone',
    'yellow_leaves'
  ];
  for(const type of allTypes) {
    d[type] = [];
  }

  // 记录所有方块的类型（包括被剔除的），用于主线程在挖掘时恢复
  const allBlockTypes = {};
  // 记录当前可见（已添加进d）的方块Key
  const visibleKeys = [];

  for (const [key, block] of blockMap) {
      // 物理碰撞数据必须包含所有实心方块
      if (block.solid) solidBlocks.push(key);

      // 渲染剔除逻辑
      let visible = true;

      // 只有实心且非透明方块才尝试剔除
      if (block.solid) {
          const { x, y, z } = block;

          // 检查 6 个方向是否都有遮挡
          const covered =
              isOccluding(x + 1, y, z) &&
              isOccluding(x - 1, y, z) &&
              isOccluding(x, y + 1, z) &&
              isOccluding(x, y - 1, z) &&
              isOccluding(x, y, z + 1) &&
              isOccluding(x, y, z - 1);

          if (covered) {
              visible = false;
          }
      }

      if (visible) {
          if (!d[block.type]) d[block.type] = [];
          d[block.type].push({x: block.x, y: block.y, z: block.z});
          visibleKeys.push(key);
      }

      // 无论是否可见，都记录类型
      allBlockTypes[key] = block.type;
  }

  // 返回数据
  postMessage({ cx, cz, d, solidBlocks, realisticTrees, allBlockTypes, visibleKeys });
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
