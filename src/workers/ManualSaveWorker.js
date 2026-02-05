import { SAVE_CONFIG } from '../constants/SaveConfig.js';

let db = null;

/**
 * 初始化 IndexedDB 数据库
 */
function init() {
  return new Promise((resolve, reject) => {
    if (db) return resolve();

    const request = indexedDB.open(SAVE_CONFIG.DB_NAME, SAVE_CONFIG.DB_VERSION);

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (!dbInstance.objectStoreNames.contains(SAVE_CONFIG.STORE_NAME)) {
        dbInstance.createObjectStore(SAVE_CONFIG.STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve();
    };

    request.onerror = (event) => {
      console.error('ManualSave IndexedDB error:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * 检查是否存在存档
 */
function checkSave() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SAVE_CONFIG.STORE_NAME], 'readonly');
    const store = transaction.objectStore(SAVE_CONFIG.STORE_NAME);
    const request = store.count(SAVE_CONFIG.SAVE_KEY);

    request.onsuccess = () => resolve(request.result > 0);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * 保存存档快照
 */
function saveSnapshot(payload) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SAVE_CONFIG.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(SAVE_CONFIG.STORE_NAME);
    const request = store.put({
      id: SAVE_CONFIG.SAVE_KEY,
      timestamp: Date.now(),
      player: payload.player,
      worldDeltas: payload.worldDeltas
    });

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * 加载存档快照
 */
function loadSnapshot() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SAVE_CONFIG.STORE_NAME], 'readonly');
    const store = transaction.objectStore(SAVE_CONFIG.STORE_NAME);
    const request = store.get(SAVE_CONFIG.SAVE_KEY);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Worker 消息处理器
self.onmessage = async (event) => {
  const { action, payload, messageId } = event.data;

  try {
    await init();
    let result;

    switch (action) {
      case 'CHECK_SAVE':
        result = await checkSave();
        break;
      case 'SAVE_SNAPSHOT':
        await saveSnapshot(payload);
        result = true;
        break;
      case 'LOAD_SNAPSHOT':
        result = await loadSnapshot();
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    self.postMessage({ success: true, result, messageId });
  } catch (error) {
    self.postMessage({ success: false, error: error.message, messageId });
  }
};
