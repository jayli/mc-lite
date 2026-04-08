// src/workers/AOWorker.js
// 专用 AO（环境光遮蔽）计算 Worker
// 负责异步执行 AO 计算，避免阻塞主线程

import { calculateAOForBlock } from '../utils/AOUtils.js';
import { getBlockProperties, isFullCubeOccluder } from '../constants/BlockData.js';

/**
 * 判断方块类型是否适用于 AO 计算
 * 条件：实心且不透明（isSolid && !isTransparent）
 * @param {string} blockType - 方块类型
 * @returns {boolean}
 */
function isAOApplicable(blockType) {
  if (!blockType) return false;
  const props = getBlockProperties(blockType);
  return props.isSolid && !props.isTransparent;
}

/**
 * 创建基于合并数据的遮挡检测函数
 * 将当前 chunk 和邻居 chunk 的 blockData 合并为统一查找表，
 * 这样跨 chunk 边界的 AO 计算才能正确执行。
 *
 * @param {Object} blockData - 当前 chunk 的方块数据 {"x,y,z": type}
 * @param {Array} neighborChunks - 邻居 chunk 快照 [{blockData, cx, cz}]
 * @returns {Function} isOccluding(x, y, z) => boolean
 */
function createOcclusionChecker(blockData, neighborChunks) {
  // 构建合并查找表：当前 chunk 数据 + 邻居 chunk 数据
  const merged = {};
  for (const key in blockData) {
    merged[key] = blockData[key];
  }
  if (neighborChunks && neighborChunks.length > 0) {
    for (const neighbor of neighborChunks) {
      if (neighbor && neighbor.blockData) {
        for (const key in neighbor.blockData) {
          // 不覆盖当前 chunk 已有的数据
          if (!(key in merged)) {
            merged[key] = neighbor.blockData[key];
          }
        }
      }
    }
  }

  return function isOccluding(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const entry = merged[key];
    if (!entry) return false;
    const type = typeof entry === 'string' ? entry : entry.type;
    if (!type) return false;
    const props = getBlockProperties(type);
    return isFullCubeOccluder(props);
  };
}

/**
 * 处理 AO 计算请求
 * @param {Object} data - 请求数据
 * @param {string} data.requestId - 请求唯一标识
 * @param {string} data.chunkKey - 区块键
 * @param {Array} data.positions - 需要计算 AO 的方块坐标 [{x, y, z}]
 * @param {Object} data.blockData - 当前 chunk 方块数据快照
 * @param {Array} data.neighborChunks - 邻居 chunk 快照 [{blockData, cx, cz}]
 * @returns {Object} 计算结果
 */
function handleComputeAO(data) {
  const { requestId, chunkKey, positions, blockData, neighborChunks } = data;

  // 空 positions 直接返回空结果
  if (!positions || positions.length === 0) {
    return {
      requestId,
      chunkKey,
      results: []
    };
  }

  // 创建合并后的遮挡检测函数
  const isOccluding = createOcclusionChecker(blockData, neighborChunks);

  const results = [];

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const ix = Math.floor(pos.x);
    const iy = Math.floor(pos.y);
    const iz = Math.floor(pos.z);

    // 从当前 chunk（非 merged）获取方块类型
    const key = `${ix},${iy},${iz}`;
    const entry = blockData[key];
    const type = typeof entry === 'string' ? entry : entry?.type;

    // 跳过空气、透明、非实心方块
    if (!isAOApplicable(type)) continue;

    // 计算 AO
    const { aoLow, aoHigh } = calculateAOForBlock(ix, iy, iz, isOccluding);

    results.push({ x: ix, y: iy, z: iz, aoLow, aoHigh });
  }

  return {
    requestId,
    chunkKey,
    results
  };
}

// Worker 消息处理
self.onmessage = function (e) {
  const msg = e.data;
  if (msg && msg.positions) {
    const result = handleComputeAO(msg);
    self.postMessage(result);
  }
};
