// src/services/PersistenceService.js
/**
 * PersistenceService - 负责地图增量修改的存储与检索
 * 使用 Worker 线程处理 IndexedDB 操作，避免阻塞主线程
 *
 * 内部缓存格式：blocks 使用数字编码 key（与 Chunk.blockData 一致）
 * 存储/导出格式：blocks 使用数字编码 key（新格式），兼容旧存档的字符串 key
 */
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';
import { serializeBlockEntry } from '../utils/OrientationUtils.js';
import { encodeCoord, normalizeBlocksToNumberKeys } from '../utils/CoordEncoding.js';
import { WorkerRpcClient } from './WorkerRpcClient.js';

/**
 * 判断 blocks 对象的 key 格式
 * @param {Object} blocks - blocks 对象
 * @returns {boolean} true 表示数字编码格式，false 表示字符串 key 格式
 */
function isNumberKeyFormat(blocks) {
  if (!blocks || typeof blocks !== 'object') return false;
  const firstKey = Object.keys(blocks)[0];
  if (!firstKey) return true; // 空对象视为新格式
  return typeof firstKey === 'number' || (!firstKey.includes(','));
}

/**
 * 标准化区块数据：确保 blocks 使用数字编码格式
 * 兼容旧存档的字符串 key 格式，自动转换为数字编码
 * @param {Object} data - 区块数据 { blocks, entities, meta? }
 * @returns {Object} 标准化后的数据
 */
function normalizeChunkData(data) {
  if (!data) return data;
  if (!data.blocks) return data;

  if (!isNumberKeyFormat(data.blocks)) {
    // 旧格式：字符串 key → 新格式：数字编码
    return {
      ...data,
      blocks: normalizeBlocksToNumberKeys(data.blocks)
    };
  }
  return data;
}

export class PersistenceService {
  constructor() {
    this.rpc = new WorkerRpcClient(new URL('../workers/PersistenceWorker.js', import.meta.url));
    this.worker = this.rpc.worker;
    this.cache = new Map(); // Key: "cx,cz" -> { blocks: {number: entry}, entities: {} }
    this.initPromise = this.init();
  }

  /**
   * 向 Worker 发送消息并返回一个 Promise
   * @param {string} action - The action to perform in the worker
   * @param {object} payload - The data to send to the worker
   * @returns {Promise<any>}
   */
  postMessage(action, payload) {
    return this.rpc.postMessage(action, payload);
  }

  /**
   * 初始化与 Worker 的连接 (现在为空，因为 Worker 会自动初始化)
   */
  async init() {
    // Worker 会在收到第一条消息时自动初始化 IndexedDB
    // 我们可以发送一个空操作或特定 init 消息来预热
    return Promise.resolve();
  }

  /**
   * 获取指定区块的全量快照数据
   * @param {number} cx - 区块X坐标
   * @param {number} cz - 区块Z坐标
   * @returns {Promise<object|null>} 返回 { blocks, entities } 或 null（blocks 使用数字编码）
   */
  async getChunkData(cx, cz) {
    await this.initPromise;
    const key = `${cx},${cz}`;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    try {
      const data = await this.postMessage('getChunkData', { key });
      // 标准化为数字编码格式（仅缓存有效数据）
      const normalized = normalizeChunkData(data);
      if (normalized) {
        this.cache.set(key, normalized);
      }
      return normalized;
    } catch (error) {
      console.error(`Failed to get data for chunk ${key}:`, error);
      return null;
    }
  }

  /**
   * 记录一个方块的变更 (直接更新内存快照)
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string|object} typeOrEntry - 方块类型 ('air' 表示删除) 或完整条目对象 { type, orientation }
   * @param {number} [orientation] - 朝向（当第一个参数为字符串时使用）
   */
  recordChange(x, y, z, typeOrEntry, orientation) {
    const cx = Math.floor(x / PERSISTENCE_CONFIG.CHUNK_SIZE);
    const cz = Math.floor(z / PERSISTENCE_CONFIG.CHUNK_SIZE);
    this.recordChangeForChunk(cx, cz, x, y, z, typeOrEntry, orientation);
  }

  /**
   * 记录一个方块的变更到指定归属区块（用于跨 Chunk 结构）
   * 使用数字编码 key 存储，与 Chunk.blockData 格式一致
   * @param {number} ownerCx - 归属区块X坐标
   * @param {number} ownerCz - 归属区块Z坐标
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string|object} typeOrEntry - 方块类型 ('air' 表示删除) 或完整条目对象 { type, orientation }
   * @param {number} [orientation] - 朝向（当第一个参数为字符串时使用）
   */
  recordChangeForChunk(ownerCx, ownerCz, x, y, z, typeOrEntry, orientation) {
    const chunkKey = `${ownerCx},${ownerCz}`;
    const blockCode = encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));

    let chunkData = this.cache.get(chunkKey);
    if (!chunkData || !chunkData.blocks) {
      // runtime-streaming 下自动创建会话快照
      chunkData = { blocks: {}, entities: {} };
      this.cache.set(chunkKey, chunkData);
    }

    // 解析输入参数
    let entry;
    if (typeof typeOrEntry === 'string') {
      if (typeOrEntry === 'air') {
        delete chunkData.blocks[blockCode];
        return;
      }
      entry = serializeBlockEntry(typeOrEntry, orientation);
    } else if (typeof typeOrEntry === 'object' && typeOrEntry !== null) {
      if (typeOrEntry.type === 'air') {
        delete chunkData.blocks[blockCode];
        return;
      }
      entry = typeOrEntry;
    } else {
      return;
    }
    chunkData.blocks[blockCode] = entry;
  }

  /**
   * 将缓存中的区块快照数据持久化到 IndexedDB
   * @param {number} cx - 区块X坐标
   * @param {number} cz - 区块Z坐标
   * @param {object} data - (可选) 要保存的完整数据
   */
  async saveChunkData(cx, cz, data = null) {
    await this.initPromise;
    const key = `${cx},${cz}`;

    const chunkData = data || this.cache.get(key);
    if (!chunkData) return;

    try {
      await this.postMessage('saveChunkData', { key, data: chunkData });
      // 如果是传入的新数据，合并到缓存（不覆盖已有 entities/blocks）
      if (data) {
        const existing = this.cache.get(key);
        if (existing) {
          // 合并：传入的 data 补充到现有缓存，不抹掉已有数据
          existing.blocks = data.blocks ? { ...existing.blocks, ...data.blocks } : existing.blocks;
          existing.entities = data.entities ? { ...existing.entities, ...data.entities } : existing.entities;
        } else {
          this.cache.set(key, { blocks: data.blocks || {}, entities: data.entities || {} });
        }
      }
    } catch (error) {
      console.error(`Failed to save chunk ${key}:`, error);
    }
  }

  /**
   * 清空所有数据 (用于会话重置)
   */
  async clearSession() {
    await this.initPromise;
    try {
      await this.postMessage('clearSession');
      this.cache.clear();
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }

  /**
   * 确保指定 chunk 的快照存在
   * 若不存在，用 seed 初始化 { blocks, entities }
   * @param {string} chunkKey - "cx,cz"
   * @param {object} seed - 初始数据
   * @returns {object} 快照对象 { blocks, entities }
   */
  ensureChunkSnapshot(chunkKey, seed = {}) {
    if (!this.cache.has(chunkKey)) {
      this.cache.set(chunkKey, {
        blocks: seed.blocks || {},
        entities: seed.entities || {}
      });
    }
    return this.cache.get(chunkKey);
  }

  /**
   * 同步快照 chunk 的 blockData 到会话缓存
   * 用于 chunk 卸载前的同步写回（不依赖异步 flush）
   * @param {string} chunkKey - "cx,cz"
   * @param {Map|object} blockData - blockData Map 或普通对象
   */
  snapshotChunkBlocks(chunkKey, blockData) {
    const snapshot = this.ensureChunkSnapshot(chunkKey);
    const blocks = {};
    if (blockData instanceof Map) {
      for (const [key, value] of blockData) {
        blocks[key] = typeof value === 'string' ? value : { ...value };
      }
    } else if (blockData && typeof blockData === 'object') {
      for (const [key, value] of Object.entries(blockData)) {
        blocks[key] = typeof value === 'string' ? value : { ...value };
      }
    }
    snapshot.blocks = blocks;
    return snapshot;
  }

  /**
   * 用外部 blockData 填充/合并到会话缓存
   * 若 cache 还没有 blocks，用 blockData 种进去
   * 若已有 blocks，以 cache 为准（overlay 语义）
   * @param {string} chunkKey - "cx,cz"
   * @param {object} blockData - 普通对象格式的 blockData
   */
  hydrateChunkBlocks(chunkKey, blockData) {
    const snapshot = this.ensureChunkSnapshot(chunkKey);
    if (!snapshot.blocks || Object.keys(snapshot.blocks).length === 0) {
      // cache 为空，用外部数据填充
      snapshot.blocks = blockData ? { ...blockData } : {};
    }
    // 若 cache 已有数据，保持 cache 优先（overlay 语义）
    return snapshot;
  }

  /**
   * 用外部数据替换会话缓存中的 blocks
   * 注意：不会覆盖已有 entities
   * @param {string} chunkKey - "cx,cz"
   * @param {object} blockData - 普通对象格式的 blockData
   */
  replaceChunkBlocks(chunkKey, blockData) {
    const snapshot = this.ensureChunkSnapshot(chunkKey);
    const existingEntities = snapshot.entities;
    snapshot.blocks = blockData ? { ...blockData } : {};
    snapshot.entities = existingEntities;
    return snapshot;
  }

  /**
   * 注入存档数据到缓存中 (供加载存档使用)
   * 兼容旧格式（字符串 key）和新格式（数字编码）
   * @param {Array} worldDeltas - 存档中的区块增量数组
   */
  injectSaveData(worldDeltas) {
    this.cache.clear();
    for (const chunk of worldDeltas) {
      const { key, ...data } = chunk;
      // 标准化为数字编码格式
      this.cache.set(key, normalizeChunkData(data));
    }
  }
}

// 导出单例
export const persistenceService = new PersistenceService();
