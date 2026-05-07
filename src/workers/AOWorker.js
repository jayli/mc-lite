// src/workers/AOWorker.js
// 专用 AO（环境光遮蔽）计算 Worker
// 负责异步执行 AO 计算，避免阻塞主线程

import { calculateAOForBlock } from '../utils/AOUtils.js';
import { getBlockProperties, isFullCubeOccluder } from '../constants/BlockData.js';
import { encodeCoord, decodeCoord } from '../utils/CoordEncoding.js';

const CHUNK_SIZE = 16;

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

// =========================================
// Worker 端 blockData 副本缓存
// =========================================

// { chunkKey: { code: entry } }
const chunkCache = {};

// =========================================
// 双队列机制：保证数据更新优先于 AO 计算
// =========================================

const deltaQueue = [];     // 数据变更队列（syncDelta / fullSync / unloadChunk）
const computeQueue = [];   // AO 计算请求队列
let processing = false;    // 防止重入锁

// =========================================
// 消息处理入口
// =========================================

self.onmessage = function(e) {
  const msg = e.data;

  // 分类入队
  if (msg.type === 'syncDelta') {
    deltaQueue.push(msg);
  } else if (msg.type === 'fullSync') {
    deltaQueue.push(msg);
  } else if (msg.type === 'unloadChunk') {
    deltaQueue.push(msg);
  } else if (msg.positions) {
    // 兼容旧协议：没有 type 字段但有 positions → computeAO 请求
    msg.type = 'computeAO';
    computeQueue.push(msg);
  }

  // 触发处理循环
  processQueue();
};

/**
 * 处理队列：delta 永远优先于 compute
 */
function processQueue() {
  if (processing) return;
  processing = true;

  while (deltaQueue.length > 0 || computeQueue.length > 0) {
    // 数据更新永远优先处理
    if (deltaQueue.length > 0) {
      const msg = deltaQueue.shift();
      applyDelta(msg);
      continue;
    }

    // delta 清空后，处理一个计算请求
    const msg = computeQueue.shift();
    const result = handleComputeAO(msg);
    self.postMessage(result);
  }

  processing = false;
}

/**
 * 应用数据变更到 chunk 副本缓存
 */
function applyDelta(msg) {
  if (msg.type === 'fullSync') {
    // 全量替换某个 chunk 的数据
    chunkCache[msg.chunkKey] = msg.blockData;
  } else if (msg.type === 'syncDelta') {
    // 增量更新
    for (const { chunkKey, code, op, entry } of msg.batch) {
      if (!chunkCache[chunkKey]) {
        // 如果 chunk 不存在于缓存中，先创建空对象
        chunkCache[chunkKey] = {};
      }
      if (op === 'set') {
        chunkCache[chunkKey][code] = entry;
      } else if (op === 'delete') {
        delete chunkCache[chunkKey][code];
      }
    }
  } else if (msg.type === 'unloadChunk') {
    // 清理已卸载 chunk 的缓存
    delete chunkCache[msg.chunkKey];
  }
}

// =========================================
// AO 计算
// =========================================

/**
 * 根据世界坐标计算对应的 chunkKey
 * @param {number} x - 世界坐标 X
 * @param {number} z - 世界坐标 Z
 * @returns {string} chunkKey
 */
function getChunkKeyForWorldCoord(x, z) {
  const cx = Math.floor(Math.floor(x) / CHUNK_SIZE);
  const cz = Math.floor(Math.floor(z) / CHUNK_SIZE);
  return `${cx},${cz}`;
}

/**
 * 从任意已缓存 chunk 的副本中读取方块条目（跨 chunk 查询）
 * @param {number} x - 世界坐标 X
 * @param {number} y - 世界坐标 Y
 * @param {number} z - 世界坐标 Z
 * @returns {*} 方块条目或 null
 */
function getEntryFromAnyCachedChunk(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const data = chunkCache[getChunkKeyForWorldCoord(ix, iz)];
  if (!data) return null;

  const code = encodeCoord(ix, iy, iz);
  if (data[code] !== undefined) return data[code];

  const strKey = `${ix},${iy},${iz}`;
  return data[strKey] !== undefined ? data[strKey] : null;
}

/**
 * 创建基于缓存的遮挡检测函数
 * 直接按世界坐标定位 chunkCache，不再每次请求合并大对象
 * @returns {Function} isOccluding(x, y, z) => boolean
 */
function createOcclusionCheckerFromCache() {
  return function isOccluding(x, y, z) {
    const entry = getEntryFromAnyCachedChunk(x, y, z);
    if (!entry) return false;
    const type = typeof entry === 'string' ? entry : entry.type;
    if (!type) return false;
    return isFullCubeOccluder(type);
  };
}

/**
 * 从缓存获取方块条目
 * @param {string} chunkKey - chunk 标识
 * @param {number} code - 编码坐标
 * @returns {*} 方块条目
 */
function getEntryFromCache(chunkKey, code) {
  const data = chunkCache[chunkKey];
  if (!data) return null;

  if (data[code] !== undefined) return data[code];

  // 回退：字符串 key 格式（旧档兼容）
  const { x, y, z } = decodeCoord(code);
  const strKey = `${x},${y},${z}`;
  return data[strKey] !== undefined ? data[strKey] : null;
}

/**
 * 处理 AO 计算请求（使用缓存中的 blockData）
 * @param {Object} data - 请求数据
 * @param {string} data.requestId - 请求唯一标识
 * @param {string} data.chunkKey - 区块键
 * @param {Array} data.positions - 需要计算 AO 的方块坐标 [{x, y, z}]
 * @param {Array} [data.neighborChunks] - 邻居 chunk 快照（兼容旧协议）
 * @returns {Object} 计算结果
 */
function handleComputeAO(data) {
  const { requestId, chunkKey, positions } = data;

  // 空 positions 直接返回空结果
  if (!positions || positions.length === 0) {
    return {
      requestId,
      chunkKey,
      results: []
    };
  }

  // 使用缓存创建遮挡检测函数（直接按坐标查询 chunkCache，不再合并大对象）
  const isOccluding = createOcclusionCheckerFromCache();

  const results = [];

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const ix = Math.floor(pos.x);
    const iy = Math.floor(pos.y);
    const iz = Math.floor(pos.z);

    // 从缓存获取方块类型
    const code = encodeCoord(ix, iy, iz);
    const entry = getEntryFromCache(chunkKey, code);
    const type = entry
      ? (typeof entry === 'string' ? entry : entry.type)
      : null;

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

// Worker error handler
self.onerror = function(e) {
  console.error('AOWorker Error:', e.message, 'at', e.filename, ':', e.lineno);
};
