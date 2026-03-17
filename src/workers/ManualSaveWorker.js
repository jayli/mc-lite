import { SAVE_CONFIG } from '../constants/SaveConfig.js';
import { openDatabase, performTransaction } from '../utils/IndexedDBUtils.js';

let db = null;

/**
 * 初始化 IndexedDB 数据库
 */
async function init() {
  if (db) return;

  db = await openDatabase(
    SAVE_CONFIG.DB_NAME,
    SAVE_CONFIG.DB_VERSION,
    (dbInstance) => {
      if (!dbInstance.objectStoreNames.contains(SAVE_CONFIG.STORE_NAME)) {
        dbInstance.createObjectStore(SAVE_CONFIG.STORE_NAME, { keyPath: 'id' });
      }
    }
  );
}

/**
 * 检查是否存在存档
 */
function checkSave() {
  return performTransaction(db, SAVE_CONFIG.STORE_NAME, 'readonly', (store) =>
    store.count(SAVE_CONFIG.SAVE_KEY)
  ).then((count) => count > 0);
}

/**
 * 保存存档快照
 */
function saveSnapshot(payload) {
  return performTransaction(db, SAVE_CONFIG.STORE_NAME, 'readwrite', (store) =>
    store.put({
      id: SAVE_CONFIG.SAVE_KEY,
      timestamp: Date.now(),
      player: payload.player,
      worldDeltas: payload.worldDeltas,
      seed: payload.seed,
      settings: payload.settings
    })
  );
}

/**
 * 加载存档快照
 */
function loadSnapshot() {
  return performTransaction(db, SAVE_CONFIG.STORE_NAME, 'readonly', (store) =>
    store.get(SAVE_CONFIG.SAVE_KEY)
  );
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
