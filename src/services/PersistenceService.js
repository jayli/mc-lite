// src/services/PersistenceService.js
/**
 * PersistenceService - 负责地图增量修改的存储与检索
 * 使用 Worker 线程处理 IndexedDB 操作，避免阻塞主线程
 */
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

export class PersistenceService {
  constructor() {
    this.worker = new Worker(new URL('../workers/PersistenceWorker.js', import.meta.url), { type: 'module' });
    this.cache = new Map(); // Key: "cx,cz" -> Map<blockKey, {type}>
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
   * 获取指定区块的增量修改数据
   * @param {number} cx - 区块X坐标
   * @param {number} cz - 区块Z坐标
   * @returns {Promise<Map<string, object>>} 返回 blockKey -> {type} 的映射
   */
  async getDeltas(cx, cz) {
    await this.initPromise;
    const key = `${cx},${cz}`;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    try {
      const data = await this.postMessage('getDeltas', { key });
      const changesMap = new Map(Object.entries(data));
      this.cache.set(key, changesMap);
      return changesMap;
    } catch (error) {
      console.error(`Failed to get deltas for chunk ${key}:`, error);
      const emptyMap = new Map();
      this.cache.set(key, emptyMap);
      return emptyMap;
    }
  }

  /**
   * 记录一个方块的变更 (内存缓存)
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

    if (!this.cache.has(chunkKey)) {
      this.cache.set(chunkKey, new Map());
    }

    const chunkDeltas = this.cache.get(chunkKey);
    chunkDeltas.set(blockKey, { type });
  }

  /**
   * 将缓存中的区块数据持久化到 IndexedDB
   * @param {number} cx - 区块X坐标
   * @param {number} cz - 区块Z坐标
   */
  async flush(cx, cz) {
    await this.initPromise;
    const key = `${cx},${cz}`;
    if (!this.cache.has(key)) return;

    const changes = Object.fromEntries(this.cache.get(key));
    if (Object.keys(changes).length === 0) return;

    try {
      await this.postMessage('flush', { key, changes });
      this.cache.delete(key);
    } catch (error) {
      console.error(`Failed to flush chunk ${key}:`, error);
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
