// src/workers/PersistenceWorker.js
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

let db = null;

/**
 * 初始化 IndexedDB 数据库
 */
function init() {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve();
    }

    const request = indexedDB.open(PERSISTENCE_CONFIG.DB_NAME, PERSISTENCE_CONFIG.DB_VERSION);

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (!dbInstance.objectStoreNames.contains(PERSISTENCE_CONFIG.STORE_NAME)) {
        dbInstance.createObjectStore(PERSISTENCE_CONFIG.STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      if (PERSISTENCE_CONFIG.SESSION_ONLY) {
        clearAllData().then(resolve).catch(reject);
      } else {
        resolve();
      }
    };

    request.onerror = (event) => {
      console.error('IndexedDB error in worker:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * 获取指定区块的全量数据 (快照)
 * @param {string} key - "cx,cz"
 */
function getChunkData(key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PERSISTENCE_CONFIG.STORE_NAME], 'readonly');
    const store = transaction.objectStore(PERSISTENCE_CONFIG.STORE_NAME);
    const request = store.get(key);

    request.onsuccess = (event) => {
      const data = event.target.result ? event.target.result.data : null;
      resolve(data);
    };

    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * 将区块全量数据持久化到 IndexedDB
 * @param {string} key - "cx,cz"
 * @param {object} data - { blocks: {}, entities: {} }
 */
function saveChunkData(key, data) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PERSISTENCE_CONFIG.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PERSISTENCE_CONFIG.STORE_NAME);
    const request = store.put({
      id: key,
      data: data,
      lastModified: Date.now()
    });

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * 清空所有数据
 */
function clearAllData() {
  return new Promise((resolve, reject) => {
    if (!db) {
        // 如果数据库还没初始化，就没有东西可清除
        return resolve();
    }
    const transaction = db.transaction([PERSISTENCE_CONFIG.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PERSISTENCE_CONFIG.STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

// Worker 消息处理器
self.onmessage = async (event) => {
  const { action, payload, messageId } = event.data;

  try {
    await init(); // 确保数据库已初始化
    let result;

    switch (action) {
      case 'getChunkData':
        result = await getChunkData(payload.key);
        break;
      case 'saveChunkData':
        await saveChunkData(payload.key, payload.data);
        result = true;
        break;
      case 'clearSession':
        await clearAllData();
        result = true;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    self.postMessage({ success: true, result, messageId });
  } catch (error) {
    self.postMessage({ success: false, error: error.message, messageId });
  }
};
