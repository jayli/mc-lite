// src/workers/FaceCullingWorker.js
// 专门处理隐藏面剔除计算的Worker

import { getBlockProperties } from '../constants/BlockData.js';
import { encodeCoord, decodeCoord } from '../utils/CoordEncoding.js';
import {
  computeFaceVisibilityMask,
  createBlockDataNeighborQuery,
  createCrossChunkNeighborQuery
} from '../utils/FaceCullingCore.js';

const isTransparent = (type) => {
  if (!type) return false;
  const props = getBlockProperties(type);
  return props.isTransparent;
};

/**
 * 构建跨区块查询的 isOccluding 函数
 * 注意：此函数支持跨区块查询，与 AOUtils.createBlockDataOcclusionChecker 不同
 * 后者仅支持单 blockData，适用于不跨区块的场景
 * @param {Object} blockData - 当前区块数据
 * @param {Array} worldChunks - 相邻区块数据
 * @param {number} currentCx - 当前区块 X 坐标
 * @param {number} currentCz - 当前区块 Z 坐标
 * @returns {Function} isOccluding(x, y, z) => boolean
 */
function createOccludingChecker(blockData, worldChunks, currentCx, currentCz) {
  return function isOccluding(x, y, z) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const code = encodeCoord(fx, fy, fz);

    // 检查是否在当前区块内
    const xChunk = Math.floor(x / 16);
    const zChunk = Math.floor(z / 16);

    let type = null;
    if (xChunk === currentCx && zChunk === currentCz) {
      type = blockData[code];
    } else {
      // 从相邻区块查找
      const chunk = worldChunks?.find(c => c.cx === xChunk && c.cz === zChunk);
      if (chunk && chunk.blockData) {
        type = chunk.blockData[code];
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
  const getNeighborType = createBlockDataNeighborQuery(blockData, block.x, block.y, block.z);
  return computeFaceVisibilityMask(
    block.type,
    getNeighborType,
    isTransparent,
    (type) => type === 'chest' || type === 'collider'
  );
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
  const allBlocksToCheck = new Map(); // code -> {x, y, z}

  for (const update of blockUpdates) {
    // 添加更新的方块
    const key = `${Math.floor(update.x)},${Math.floor(update.y)},${Math.floor(update.z)}`;
    const code = encodeCoord(Math.floor(update.x), Math.floor(update.y), Math.floor(update.z));
    allBlocksToCheck.set(code, { x: Math.floor(update.x), y: Math.floor(update.y), z: Math.floor(update.z), strKey: key });

    // 添加邻居方块
    const { x, y, z } = update;
    const neighbors = [
      [x+1, y, z], [x-1, y, z], [x, y+1, z], [x, y-1, z], [x, y, z+1], [x, y, z-1]
    ];

    for (const [nx, ny, nz] of neighbors) {
      const nCode = encodeCoord(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      const nKey = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
      allBlocksToCheck.set(nCode, { x: Math.floor(nx), y: Math.floor(ny), z: Math.floor(nz), strKey: nKey });
    }
  }

  // 计算所有相关方块的可见性
  for (const [code, pos] of allBlocksToCheck) {
    const type = blockData[code];

    if (type) { // 如果方块存在
      const block = { x: pos.x, y: pos.y, z: pos.z, type };
      const visibility = calculateFaceVisibility(block, blockData);

      // 创建方块对象
      const blockInfo = {
        x: pos.x, y: pos.y, z: pos.z, type, visibility
      };

      // 如果是更新的方块，添加到updatedBlocks
      const isUpdatedBlock = blockUpdates.some(update =>
        Math.floor(update.x) === pos.x &&
        Math.floor(update.y) === pos.y &&
        Math.floor(update.z) === pos.z
      );

      if (isUpdatedBlock) {
        results.updatedBlocks.push(blockInfo);
      } else {
        results.affectedNeighbors.push(blockInfo);
      }

      // 如果方块可见，添加到visibleKeys（使用字符串 key 保持向后兼容）
      if (visibility > 0) {
        results.visibleKeys.add(pos.strKey);
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

  for (const codeStr in blockData) {
    const code = Number(codeStr);
    const { x, y, z } = decodeCoord(code);
    const type = blockData[code];

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

    // 添加到结果（使用字符串 key 保持向后兼容）
    const key = `${x},${y},${z}`;
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
 * @param {Object} block - 方块信息 {x, y, z, type}
 * @param {Object} blockData - 当前区块的完整方块数据
 * @param {Map} worldChunks - 世界区块映射
 * @param {number} currentCx - 当前区块 X 坐标
 * @param {number} currentCz - 当前区块 Z 坐标
 * @returns {number} 面掩码
 */
function calculateFaceVisibilityWithWorld(block, blockData, worldChunks, currentCx, currentCz) {
  const getNeighborType = createCrossChunkNeighborQuery(
    blockData, worldChunks, currentCx, currentCz, block.x, block.y, block.z
  );
  return computeFaceVisibilityMask(
    block.type,
    getNeighborType,
    isTransparent,
    (type) => type === 'chest' || type === 'collider'
  );
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
