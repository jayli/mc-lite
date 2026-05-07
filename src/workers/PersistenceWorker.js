// src/workers/PersistenceWorker.js
/* global structuredClone */
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';
import { openDatabase, performTransaction } from '../utils/IndexedDBUtils.js';

let db = null;

// WorldStore 专用 object store 名称
const WORLD_META_STORE = 'world_meta';
const WORLD_REGION_STORE = 'world_regions';
const WORLD_OVERFLOW_STORE = 'world_overflow';

// Worker 侧 RegionRecord 缓存：避免重复 IndexedDB 读取
const regionCache = new Map(); // regionKey -> regionRecord
const REGION_CACHE_MAX_SIZE = 6;

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
  if (db && !db.objectStoreNames.contains(WORLD_OVERFLOW_STORE)) {
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
      if (!dbInstance.objectStoreNames.contains(WORLD_OVERFLOW_STORE)) {
        dbInstance.createObjectStore(WORLD_OVERFLOW_STORE, { keyPath: 'regionKey' });
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

function touchRegionCache(regionKey, region) {
  if (!regionKey || !region) return;
  if (regionCache.has(regionKey)) {
    regionCache.delete(regionKey);
  }
  regionCache.set(regionKey, region);
  while (regionCache.size > REGION_CACHE_MAX_SIZE) {
    const oldestKey = regionCache.keys().next().value;
    regionCache.delete(oldestKey);
  }
}

function getCachedRegion(regionKey) {
  const region = regionCache.get(regionKey);
  if (!region) return null;
  touchRegionCache(regionKey, region);
  return region;
}

function clearRegionCache() {
  regionCache.clear();
}

/**
 * 读取单个 ChunkRecord。
 * 命中 Worker 缓存时直接裁剪，未命中时读取完整 RegionRecord 后缓存。
 * @param {string} regionKey
 * @param {string} chunkKey
 * @param {number} cx
 * @param {number} cz
 * @returns {Promise<object|null>}
 */
async function getChunkRecord(regionKey, chunkKey, cx, cz) {
  let region = getCachedRegion(regionKey);
  if (!region) {
    region = await getRegionRecord(regionKey);
    if (!region) return null;
    touchRegionCache(regionKey, region);
  }

  const chunkData = region.chunks?.[chunkKey];
  if (!chunkData) return null;

  return {
    cx,
    cz,
    blockData: chunkData.blockData || {},
    staticEntities: chunkData.staticEntities || [],
    runtimeSeedData: chunkData.runtimeSeedData || {},
    runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] },
    __runtimeEntitiesWasDefault: !chunkData.runtimeEntities
  };
}

/**
 * 保存 RegionRecord
 * @param {string} regionKey - "rx,rz"
 * @param {object} record - RegionRecord 数据
 */
async function saveRegionRecord(regionKey, record) {
  await performTransaction(db, WORLD_REGION_STORE, 'readwrite', (store) =>
    store.put({
      regionKey,
      data: record,
      lastModified: Date.now()
    })
  );
  touchRegionCache(regionKey, record);
}

function applyChunkPatchToRegion(region, chunkPatch) {
  const {
    chunkKey,
    preserveStoredBlockData = false,
    chunkRecord
  } = chunkPatch;

  if (!region.chunks) region.chunks = {};
  if (!Array.isArray(region.chunkKeys)) region.chunkKeys = [];

  const currentChunk = region.chunks[chunkKey] || {};
  const nextChunk = {
    ...currentChunk,
    ...chunkRecord
  };

  if (preserveStoredBlockData) {
    nextChunk.blockData = currentChunk.blockData || nextChunk.blockData || {};
  }

  region.chunks[chunkKey] = nextChunk;
  if (!region.chunkKeys.includes(chunkKey)) {
    region.chunkKeys.push(chunkKey);
  }
}

async function applyRegionPatch(regionKey, rx, rz, patch) {
  let region = getCachedRegion(regionKey);
  if (!region) {
    region = await getRegionRecord(regionKey);
  }
  // 深 clone 避免原地修改，写失败时不污染缓存
  region = region ? structuredClone(region) : {
    regionKey,
    rx,
    rz,
    chunkKeys: [],
    chunks: {},
    generatedAt: Date.now(),
    generatorVersion: '1.0'
  };

  for (const chunkPatch of patch?.chunkPatches || []) {
    applyChunkPatchToRegion(region, chunkPatch);
  }

  return saveRegionRecord(regionKey, region);
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
    tx.oncomplete = () => {
      for (const { regionKey, record } of records) {
        touchRegionCache(regionKey, record);
      }
      resolve(true);
    };
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
 * 保存跨 region 的 overflow 方块数据
 * @param {string} regionKey - "rx,rz"
 * @param {object} overflowData - overflow 方块数据
 */
function saveOverflowBlocks(regionKey, overflowData) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readwrite', (store) =>
    store.put({
      regionKey,
      data: overflowData,
      lastModified: Date.now()
    })
  );
}

/**
 * 获取跨 region 的 overflow 方块数据
 * @param {string} regionKey - "rx,rz"
 * @returns {Promise<object|null>}
 */
function getOverflowBlocks(regionKey) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readonly', (store) =>
    store.get(regionKey)
  ).then((result) => result ? result.data : null);
}

/**
 * 删除跨 region 的 overflow 方块数据
 * @param {string} regionKey - "rx,rz"
 */
function removeOverflowBlocks(regionKey) {
  return performTransaction(db, WORLD_OVERFLOW_STORE, 'readwrite', (store) =>
    store.delete(regionKey)
  );
}

/**
 * 清除世界数据（WorldMeta + RegionRecord + world_deltas + world_overflow）
 */
function clearWorld() {
  if (!db) {
    return Promise.reject(new Error('DB not initialized'));
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction([WORLD_META_STORE, WORLD_REGION_STORE, PERSISTENCE_CONFIG.STORE_NAME, WORLD_OVERFLOW_STORE], 'readwrite');
    tx.objectStore(WORLD_META_STORE).clear();
    tx.objectStore(WORLD_REGION_STORE).clear();
    tx.objectStore(PERSISTENCE_CONFIG.STORE_NAME).clear();
    tx.objectStore(WORLD_OVERFLOW_STORE).clear();
    tx.oncomplete = () => {
      clearRegionCache();
      resolve(true);
    };
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
      case 'getChunkRecord':
        result = await getChunkRecord(payload.regionKey, payload.chunkKey, payload.cx, payload.cz);
        break;
      case 'saveRegionRecord':
        await saveRegionRecord(payload.regionKey, payload.record);
        result = true;
        break;
      case 'applyRegionPatch':
        await applyRegionPatch(payload.regionKey, payload.rx, payload.rz, payload.patch);
        result = true;
        break;
      case 'saveRegionRecordsBatch':
        await saveRegionRecordsBatch(payload.records);
        result = true;
        break;
      case 'getAllRegionKeys':
        result = await getAllRegionKeys();
        break;
      case 'saveOverflowBlocks':
        await saveOverflowBlocks(payload.regionKey, payload.overflowData);
        result = true;
        break;
      case 'getOverflowBlocks':
        result = await getOverflowBlocks(payload.regionKey);
        break;
      case 'removeOverflowBlocks':
        await removeOverflowBlocks(payload.regionKey);
        result = true;
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
