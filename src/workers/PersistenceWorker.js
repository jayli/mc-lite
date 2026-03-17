// src/workers/PersistenceWorker.js
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';
import { openDatabase, performTransaction } from '../utils/IndexedDBUtils.js';

let db = null;

/**
 * 初始化 IndexedDB 数据库
 */
async function init() {
  if (db) return;

  db = await openDatabase(
    PERSISTENCE_CONFIG.DB_NAME,
    PERSISTENCE_CONFIG.DB_VERSION,
    (dbInstance) => {
      if (!dbInstance.objectStoreNames.contains(PERSISTENCE_CONFIG.STORE_NAME)) {
        dbInstance.createObjectStore(PERSISTENCE_CONFIG.STORE_NAME, { keyPath: 'id' });
      }
    }
  );

  if (PERSISTENCE_CONFIG.SESSION_ONLY) {
    await clearAllData();
  }
}

/**
 * 获取指定区块的全量数据 (快照)
 * @param {string} key - "cx,cz"
 */
function getChunkData(key) {
  return performTransaction(db, PERSISTENCE_CONFIG.STORE_NAME, 'readonly', (store) =>
    store.get(key)
  ).then((result) => result ? result.data : null);
}

/**
 * 将区块全量数据持久化到 IndexedDB
 * @param {string} key - "cx,cz"
 * @param {object} data - { blocks: {}, entities: {} }
 */
function saveChunkData(key, data) {
  return performTransaction(db, PERSISTENCE_CONFIG.STORE_NAME, 'readwrite', (store) =>
    store.put({
      id: key,
      data: data,
      lastModified: Date.now()
    })
  );
}

/**
 * 清空所有数据
 */
function clearAllData() {
  if (!db) {
    return Promise.resolve();
  }
  return performTransaction(db, PERSISTENCE_CONFIG.STORE_NAME, 'readwrite', (store) =>
    store.clear()
  );
}

// Worker 消息处理器
self.onmessage = async (event) => {
  const { action, payload, messageId } = event.data;

  try {
    await init();
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
