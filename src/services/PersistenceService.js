// src/services/PersistenceService.js
/**
 * PersistenceService - 负责地图增量修改的存储与检索
 * 使用 Worker 线程处理 IndexedDB 操作，避免阻塞主线程
 */
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

export class PersistenceService {
  constructor() {
    this.worker = new Worker(new URL('../workers/PersistenceWorker.js', import.meta.url), { type: 'module' });
    this.cache = new Map(); // Key: "cx,cz" -> { blocks: {}, entities: {} }
    this.messageId = 0;
    this.callbacks = new Map();
    this.initPromise = this.init();

    this.worker.onmessage = (event) => {
      const { success, result, error, messageId } = event.data;
      if (this.callbacks.has(messageId)) {
        const { resolve, reject } = this.callbacks.get(messageId);
        if (success) {
          resolve(result);
        } else {
          reject(new Error(error));
        }
        this.callbacks.delete(messageId);
      }
    };
  }

  /**
   * 向 Worker 发送消息并返回一个 Promise
   * @param {string} action - The action to perform in the worker
   * @param {object} payload - The data to send to the worker
   * @returns {Promise<any>}
   */
  postMessage(action, payload) {
    return new Promise((resolve, reject) => {
      const messageId = this.messageId++;
      this.callbacks.set(messageId, { resolve, reject });
      this.worker.postMessage({ action, payload, messageId });
    });
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
   * @returns {Promise<object|null>} 返回 { blocks, entities } 或 null
   */
  async getChunkData(cx, cz) {
    await this.initPromise;
    const key = `${cx},${cz}`;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    try {
      const data = await this.postMessage('getChunkData', { key });
      this.cache.set(key, data);
      return data;
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
   * @param {string} type - 方块类型 ('air' 表示删除)
   */
  recordChange(x, y, z, type) {
    const cx = Math.floor(x / PERSISTENCE_CONFIG.CHUNK_SIZE);
    const cz = Math.floor(z / PERSISTENCE_CONFIG.CHUNK_SIZE);
    const chunkKey = `${cx},${cz}`;
    const blockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

    const chunkData = this.cache.get(chunkKey);
    if (chunkData && chunkData.blocks) {
      if (type === 'air') {
        delete chunkData.blocks[blockKey];
      } else {
        chunkData.blocks[blockKey] = type;
      }
    }
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
      // 如果是传入的新数据，更新缓存
      if (data) this.cache.set(key, data);
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
}

// 导出单例
export const persistenceService = new PersistenceService();
