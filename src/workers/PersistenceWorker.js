// src/workers/PersistenceWorker.js
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';
import { openDatabase, performTransaction } from '../utils/IndexedDBUtils.js';

let db = null;

// WorldStore 专用 object store 名称
const WORLD_META_STORE = 'world_meta';
const WORLD_REGION_STORE = 'world_regions';

/**
 * 初始化 IndexedDB 数据库
 * 升级：新增 world_meta 和 world_regions 两个 object store
 */
async function init() {
  // 如果旧连接版本过低（缺少新 stores），关闭后重新打开以触发升级
  if (db && !db.objectStoreNames.contains(WORLD_META_STORE)) {
    db.close();
    db = null;
  }
  if (db) return;

  db = await openDatabase(
    PERSISTENCE_CONFIG.DB_NAME,
    PERSISTENCE_CONFIG.DB_VERSION,
    (dbInstance) => {
      if (!dbInstance.objectStoreNames.contains(PERSISTENCE_CONFIG.STORE_NAME)) {
        dbInstance.createObjectStore(PERSISTENCE_CONFIG.STORE_NAME, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(WORLD_META_STORE)) {
        dbInstance.createObjectStore(WORLD_META_STORE, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(WORLD_REGION_STORE)) {
        dbInstance.createObjectStore(WORLD_REGION_STORE, { keyPath: 'regionKey' });
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

// ============================================================
// WorldStore 专用：WorldMeta / RegionRecord 读写
// ============================================================

/**
 * 获取 WorldMeta
 * @returns {Promise<object|null>}
 */
function getWorldMeta() {
  return performTransaction(db, WORLD_META_STORE, 'readonly', (store) =>
    store.get('meta')
  ).then((result) => result ? result.data : null);
}

/**
 * 保存 WorldMeta
 * @param {object} meta - WorldMeta 数据
 */
function saveWorldMeta(meta) {
  return performTransaction(db, WORLD_META_STORE, 'readwrite', (store) =>
    store.put({
      id: 'meta',
      data: meta,
      lastModified: Date.now()
    })
  );
}

/**
 * 获取 RegionRecord
 * @param {string} regionKey - "rx,rz"
 * @returns {Promise<object|null>}
 */
function getRegionRecord(regionKey) {
  return performTransaction(db, WORLD_REGION_STORE, 'readonly', (store) =>
    store.get(regionKey)
  ).then((result) => result ? result.data : null);
}

/**
 * 保存 RegionRecord
 * @param {string} regionKey - "rx,rz"
 * @param {object} record - RegionRecord 数据
 */
function saveRegionRecord(regionKey, record) {
  return performTransaction(db, WORLD_REGION_STORE, 'readwrite', (store) =>
    store.put({
      regionKey,
      data: record,
      lastModified: Date.now()
    })
  );
}

/**
 * 批量保存多个 RegionRecord（用于预生成场景）
 * @param {Array<{regionKey: string, record: object}>} records
 */
function saveRegionRecordsBatch(records) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('DB not initialized'));
    const tx = db.transaction(WORLD_REGION_STORE, 'readwrite');
    const store = tx.objectStore(WORLD_REGION_STORE);
    const now = Date.now();
    for (const { regionKey, record } of records) {
      store.put({ regionKey, data: record, lastModified: now });
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 获取所有已生成的 region keys
 * @returns {Promise<string[]>}
 */
function getAllRegionKeys() {
  return performTransaction(db, WORLD_REGION_STORE, 'readonly', (store) =>
    store.getAllKeys()
  );
}

/**
 * 清除世界数据（WorldMeta + RegionRecord + world_deltas）
 */
function clearWorld() {
  if (!db) {
    return Promise.reject(new Error('DB not initialized'));
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction([WORLD_META_STORE, WORLD_REGION_STORE, PERSISTENCE_CONFIG.STORE_NAME], 'readwrite');
    tx.objectStore(WORLD_META_STORE).clear();
    tx.objectStore(WORLD_REGION_STORE).clear();
    tx.objectStore(PERSISTENCE_CONFIG.STORE_NAME).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
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
      // WorldStore actions
      case 'getWorldMeta':
        result = await getWorldMeta();
        break;
      case 'saveWorldMeta':
        await saveWorldMeta(payload.meta);
        result = true;
        break;
      case 'getRegionRecord':
        result = await getRegionRecord(payload.regionKey);
        break;
      case 'saveRegionRecord':
        await saveRegionRecord(payload.regionKey, payload.record);
        result = true;
        break;
      case 'saveRegionRecordsBatch':
        await saveRegionRecordsBatch(payload.records);
        result = true;
        break;
      case 'getAllRegionKeys':
        result = await getAllRegionKeys();
        break;
      case 'clearWorld':
        await clearWorld();
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
