// src/services/PersistenceService.js
/**
 * PersistenceService - 负责地图增量修改的存储与检索
 * 使用 IndexedDB 作为持久化后端，并维护内存缓存以保证游戏性能
 */
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

export class PersistenceService {
  constructor() {
    this.db = null;
    this.cache = new Map(); // Key: "cx,cz" -> Map<blockKey, {type}>
    this.initPromise = this.init();
  }

  /**
   * 初始化 IndexedDB 数据库
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PERSISTENCE_CONFIG.DB_NAME, PERSISTENCE_CONFIG.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(PERSISTENCE_CONFIG.STORE_NAME)) {
          db.createObjectStore(PERSISTENCE_CONFIG.STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        if (PERSISTENCE_CONFIG.SESSION_ONLY) {
          // 直接执行清理逻辑，不使用 await initPromise 以避免死锁
          const transaction = this.db.transaction([PERSISTENCE_CONFIG.STORE_NAME], 'readwrite');
          const store = transaction.objectStore(PERSISTENCE_CONFIG.STORE_NAME);
          const clearRequest = store.clear();
          clearRequest.onsuccess = () => {
            this.cache.clear();
            resolve();
          };
          clearRequest.onerror = (e) => reject(e.target.error);
        } else {
          resolve();
        }
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
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

    // 1. 检查内存缓存
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // 2. 从 IndexedDB 加载
    return new Promise((resolve) => {
      const transaction = this.db.transaction([PERSISTENCE_CONFIG.STORE_NAME], 'readonly');
      const store = transaction.objectStore(PERSISTENCE_CONFIG.STORE_NAME);
      const request = store.get(key);

      request.onsuccess = (event) => {
        const data = event.target.result ? event.target.result.changes : {};
        const changesMap = new Map(Object.entries(data));
        this.cache.set(key, changesMap);
        resolve(changesMap);
      };

      request.onerror = () => {
        const emptyMap = new Map();
        this.cache.set(key, emptyMap);
        resolve(emptyMap);
      };
    });
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
    const blockKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;

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

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([PERSISTENCE_CONFIG.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(PERSISTENCE_CONFIG.STORE_NAME);
      const request = store.put({
        id: key,
        changes: changes,
        lastModified: Date.now()
      });

      request.onsuccess = () => {
        // 从内存缓存中移除已刷新的数据以释放内存
        this.cache.delete(key);
        resolve();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * 清空所有数据 (用于会话重置)
   */
  async clearSession() {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([PERSISTENCE_CONFIG.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(PERSISTENCE_CONFIG.STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        this.cache.clear();
        resolve();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }
}

// 导出单例
export const persistenceService = new PersistenceService();
