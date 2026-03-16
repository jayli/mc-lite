// src/workers/FaceCullingWorker.js
// 专门处理隐藏面剔除计算的Worker

import { getBlockProperties } from '../constants/BlockData.js';
import { buildAODataForBlocks, calculateAOForBlock, isAOApplicable } from '../utils/AOUtils.js';

// 用于隐藏面剔除的辅助函数
const getBlockType = (x, y, z, blockData) => {
  const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  return blockData[key] || null;
};

const isTransparent = (type) => {
  if (!type) return false;
  const props = getBlockProperties(type);
  return props.isTransparent;
};

/**
 * 构建跨区块查询的 isOccluding 函数
 * @param {Object} blockData - 当前区块数据
 * @param {Array} worldChunks - 相邻区块数据
 * @param {number} currentCx - 当前区块 X 坐标
 * @param {number} currentCz - 当前区块 Z 坐标
 * @returns {Function} isOccluding(x, y, z) => boolean
 */
function createOccludingChecker(blockData, worldChunks, currentCx, currentCz) {
  return function isOccluding(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

    // 检查是否在当前区块内
    const xChunk = Math.floor(x / 16);
    const zChunk = Math.floor(z / 16);

    let type = null;
    if (xChunk === currentCx && zChunk === currentCz) {
      type = blockData[key];
    } else {
      // 从相邻区块查找
      const chunkKey = `${xChunk},${zChunk}`;
      const chunk = worldChunks?.find(c => c.cx === xChunk && c.cz === zChunk);
      if (chunk && chunk.blockData) {
        type = chunk.blockData[key];
      }
    }

    if (!type) return false;
    const props = getBlockProperties(type);
    return !props.isTransparent;
  };
}

/**
 * 计算单个方块的可见面掩码
 * @param {Object} block - 方块信息 {x, y, z, type}
 * @param {Object} blockData - 当前区块的完整方块数据
 * @returns {number} 面掩码
 */
function calculateFaceVisibility(block, blockData) {
  if (block.type === 'chest' || block.type === 'collider') {
    return 63; // 宝箱和碰撞体的所有面都可见
  }

  if (isTransparent(block.type)) {
    return 63; // 透明方块所有面可见
  }

  let mask = 0;
  const { x, y, z } = block;

  // 检查六个方向
  if (!getBlockType(x, y + 1, z, blockData) || isTransparent(getBlockType(x, y + 1, z, blockData))) mask |= 1; // TOP
  if (!getBlockType(x, y - 1, z, blockData) || isTransparent(getBlockType(x, y - 1, z, blockData))) mask |= 2; // BOTTOM
  if (!getBlockType(x, y, z - 1, blockData) || isTransparent(getBlockType(x, y, z - 1, blockData))) mask |= 4; // NORTH
  if (!getBlockType(x, y, z + 1, blockData) || isTransparent(getBlockType(x, y, z + 1, blockData))) mask |= 8; // SOUTH
  if (!getBlockType(x - 1, y, z, blockData) || isTransparent(getBlockType(x - 1, y, z, blockData))) mask |= 16; // WEST
  if (!getBlockType(x + 1, y, z, blockData) || isTransparent(getBlockType(x + 1, y, z, blockData))) mask |= 32; // EAST

  return mask;
}

/**
 * 批量更新方块可见面状态
 * @param {Array} blockUpdates - 需要更新的方块列表
 * @param {Object} blockData - 当前区块的完整方块数据
 * @returns {Object} 更新结果
 */
function batchCalculateFaceVisibility(blockUpdates, blockData) {
  const results = {
    updatedBlocks: [],
    affectedNeighbors: [],
    visibleKeys: new Set(), // 更新后的可见方块集合
    allBlockTypes: { ...blockData } // 完整的方块类型数据副本
  };

  // 收集所有需要检查的方块（包括更新的方块及其邻居）
  const allBlocksToCheck = new Set();

  for (const update of blockUpdates) {
    // 添加更新的方块
    const key = `${Math.floor(update.x)},${Math.floor(update.y)},${Math.floor(update.z)}`;
    allBlocksToCheck.add(key);

    // 添加邻居方块
    const { x, y, z } = update;
    const neighbors = [
      [x+1, y, z], [x-1, y, z], [x, y+1, z], [x, y-1, z], [x, y, z+1], [x, y, z-1]
    ];

    for (const [nx, ny, nz] of neighbors) {
      const neighborKey = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
      allBlocksToCheck.add(neighborKey);
    }
  }

  // 计算所有相关方块的可见性
  for (const key of allBlocksToCheck) {
    const [bx, by, bz] = key.split(',').map(Number);
    const type = blockData[key];

    if (type) { // 如果方块存在
      const block = { x: bx, y: by, z: bz, type };
      const visibility = calculateFaceVisibility(block, blockData);

      // 创建方块对象
      const blockInfo = {
        x: bx, y: by, z: bz, type, visibility
      };

      // 如果是更新的方块，添加到updatedBlocks
      const isUpdatedBlock = blockUpdates.some(update =>
        Math.floor(update.x) === bx &&
        Math.floor(update.y) === by &&
        Math.floor(update.z) === bz
      );

      if (isUpdatedBlock) {
        results.updatedBlocks.push(blockInfo);
      } else {
        results.affectedNeighbors.push(blockInfo);
      }

      // 如果方块可见，添加到visibleKeys
      if (visibility > 0) {
        results.visibleKeys.add(key);
      }
    }
  }

  // 返回完整的方块类型数据以及更新的可见性信息
  return results;
}

/**
 * 计算整个区块的隐藏面状态
 * @param {Object} blockData - 区块的完整方块数据
 * @param {number} cx - 区块X坐标
 * @param {number} cz - 区块Z坐标
 * @param {Map} worldChunks - 世界区块映射（用于跨区块检查）
 * @returns {Object} 包含可见方块列表和相关数据的对象
 */
function calculateChunkFaceVisibility(blockData, cx, cz, worldChunks = null) {
  const results = {
    visibleKeys: [],
    solidBlocks: [],
    blocksWithVisibility: {}
  };

  for (const key in blockData) {
    const [x, y, z] = key.split(',').map(Number);
    const type = blockData[key];

    // 获取完整方块信息
    const block = { x, y, z, type };

    // 计算可见性，这里需要考虑跨区块邻居
    let mask;
    if (worldChunks) {
      // 更精确的跨区块检查
      mask = calculateFaceVisibilityWithWorld(block, blockData, worldChunks, cx, cz);
    } else {
      // 简单检查
      mask = calculateFaceVisibility(block, blockData);
    }

    // 添加到结果
    results.blocksWithVisibility[key] = {
      x, y, z, type, visibility: mask
    };

    // 如果方块可见，则添加到visibleKeys
    if (mask > 0) {
      results.visibleKeys.push(key);
    }

    // 如果是固体方块，添加到solidBlocks
    const props = getBlockProperties(type);
    if (props.isSolid) {
      results.solidBlocks.push(key);
    }
  }

  return results;
}

/**
 * 带世界边界的方块可见性计算
 */
function calculateFaceVisibilityWithWorld(block, blockData, worldChunks, currentCx, currentCz) {
  if (block.type === 'chest' || block.type === 'collider') {
    return 63; // 宝箱和碰撞体的所有面都可见
  }

  if (isTransparent(block.type)) {
    return 63; // 透明方块所有面可见
  }

  let mask = 0;
  const { x, y, z } = block;

  // 检查六个方向
  const directions = [
    { dx: 0, dy: 1, dz: 0, bit: 1 },   // TOP
    { dx: 0, dy: -1, dz: 0, bit: 2 },  // BOTTOM
    { dx: 0, dy: 0, dz: -1, bit: 4 },  // NORTH
    { dx: 0, dy: 0, dz: 1, bit: 8 },   // SOUTH
    { dx: -1, dy: 0, dz: 0, bit: 16 }, // WEST
    { dx: 1, dy: 0, dz: 0, bit: 32 }   // EAST
  ];

  for (const dir of directions) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    const nz = z + dir.dz;

    // 检查是否在同一区块内
    const nxChunk = Math.floor(nx / 16);
    const nzChunk = Math.floor(nz / 16);

    let neighborType = null;
    if (nxChunk === currentCx && nzChunk === currentCz) {
      // 在同一区块内，直接从blockData获取
      const neighborKey = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
      neighborType = blockData[neighborKey];
    } else {
      // 跨区块，从worldChunks获取
      const chunkKey = `${nxChunk},${nzChunk}`;
      const neighborChunk = worldChunks.get(chunkKey);
      if (neighborChunk && neighborChunk.blockData) {
        const neighborKey = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
        neighborType = neighborChunk.blockData[neighborKey];
      }
    }

    // 如果没有邻居方块（空气）或者邻居是透明的，则该面可见
    if (!neighborType || isTransparent(neighborType)) {
      mask |= dir.bit;
    }
  }

  return mask;
}

/**
 * 批量计算 AO 数据（用于区块生成）
 * @param {Array} blocks - 方块数组 [{x, y, z, type}]
 * @param {Object} blockData - 完整方块数据 {"x,y,z": "type"}
 * @param {number} cx - 区块 X 坐标
 * @param {number} cz - 区块 Z 坐标
 * @param {Array} worldChunks - 相邻区块数据
 * @returns {Object} AO 计算结果
 */
function computeBatchAO(blocks, blockData, cx, cz, worldChunks = []) {
  const startTime = performance.now();
  const affectedNeighbors = [];

  // 创建跨区块 occluding 检查器
  const isOccluding = createOccludingChecker(blockData, worldChunks, cx, cz);

  const aoData = buildAODataForBlocks(blocks, isOccluding);

  return {
    aoData,
    affectedNeighbors,
    duration: performance.now() - startTime,
    cx,
    cz
  };
}

/**
 * 增量计算 AO 数据（用于动态方块更新）
 * @param {Object} position - 方块位置 {x, y, z}
 * @param {'PLACE'|'DESTROY'} operation - 操作类型
 * @param {string} blockType - 方块类型
 * @param {Object} blockData - 局部方块数据
 * @param {number} neighborhoodRadius - 邻居半径
 * @returns {Object} AO 计算结果
 */
function computeIncrementalAO(position, operation, blockType, blockData, neighborhoodRadius = 1) {
  const startTime = performance.now();
  const aoData = [];
  const affectedNeighbors = [];

  const isOccluding = (x, y, z) => {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const type = blockData[key];
    if (!type) return false;
    const props = getBlockProperties(type);
    return !props.isTransparent;
  };

  const { x, y, z } = position;
  const affected = new Set();

  // 如果是放置方块，计算该方块的 AO
  if (operation === 'PLACE' && isAOApplicable(blockType)) {
    affected.add(`${x},${y},${z}`);
  }

  // 计算邻居方块的 AO 更新
  for (let dx = -neighborhoodRadius; dx <= neighborhoodRadius; dx++) {
    for (let dy = -neighborhoodRadius; dy <= neighborhoodRadius; dy++) {
      for (let dz = -neighborhoodRadius; dz <= neighborhoodRadius; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;

        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const key = `${nx},${ny},${nz}`;
        const type = blockData[key];

        if (type && isAOApplicable(type)) {
          affected.add(key);
        }
      }
    }
  }

  // 计算 AO
  for (const key of affected) {
    const [bx, by, bz] = key.split(',').map(Number);
    const type = blockData[key];

    if (type && isAOApplicable(type)) {
      const { aoLow, aoHigh } = calculateAOForBlock(bx, by, bz, isOccluding);
      aoData.push({ x: bx, y: by, z: bz, type, aoLow, aoHigh });
      affectedNeighbors.push({ x: bx, y: by, z: bz });
    }
  }

  return {
    aoData,
    affectedNeighbors,
    duration: performance.now() - startTime
  };
}

// Worker 消息处理器
self.onmessage = function(e) {
  const { type, data } = e.data;

  try {
    let result;

    switch (type) {
      case 'CALCULATE_FACE_VISIBILITY':
        result = calculateFaceVisibility(data.block, data.blockData);
        break;

      case 'BATCH_CALCULATE_FACE_VISIBILITY':
        result = batchCalculateFaceVisibility(data.blockUpdates, data.blockData);
        break;

      case 'CALCULATE_CHUNK_VISIBILITY':
        result = calculateChunkFaceVisibility(
          data.blockData,
          data.cx,
          data.cz,
          data.worldChunks || null
        );
        break;

      // AO 计算相关消息
      case 'COMPUTE_AO_BATCH':
        result = computeBatchAO(
          data.blocks,
          data.blockData,
          data.cx,
          data.cz,
          data.worldChunks || []
        );
        break;

      case 'COMPUTE_AO_INCREMENTAL':
        result = computeIncrementalAO(
          data.position,
          data.operation,
          data.blockType,
          data.blockData,
          data.neighborhoodRadius || 1
        );
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // 发送结果回主线程
    self.postMessage({
      type: 'RESULT',
      messageType: type,
      data: result,
      id: e.data.id // 保持请求ID用于匹配
    });
  } catch (error) {
    // 发送错误回主线程
    self.postMessage({
      type: 'ERROR',
      messageType: type,
      error: error.message,
      stack: error.stack,
      id: e.data.id
    });
  }
};
