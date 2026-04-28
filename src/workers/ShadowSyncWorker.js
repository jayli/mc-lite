// src/workers/ShadowSyncWorker.js
/**
 * ShadowSyncWorker — 专用 Worker 处理特殊实体的 IndexedDB 同步。
 *
 * 职责：
 * - 接收主线程的批量变更，写入 world_regions 表的 runtimeEntities 字段
 * - 启动时一次性迁移 world_deltas 表的旧格式数据
 * - 支持 chunk 加载时从 IndexedDB 读取 runtimeEntities 回传主线程
 */

import { openDatabase, performTransaction } from '../utils/IndexedDBUtils.js';
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

const DB_NAME = PERSISTENCE_CONFIG.DB_NAME;
const DB_VERSION = PERSISTENCE_CONFIG.DB_VERSION;
const WORLD_REGION_STORE = 'world_regions';
const WORLD_DELTA_STORE = PERSISTENCE_CONFIG.STORE_NAME;
const CHUNKS_PER_REGION = 8;

let db = null;

async function init() {
  if (db) return;
  // stores 已在 PersistenceWorker 中创建，此处只需打开连接
  db = await openDatabase(DB_NAME, DB_VERSION, () => {});
}

// ---------- 核心操作 ----------

/**
 * 批量同步：将多个 chunk 的 runtimeEntities 写入 world_regions 表。
 * payloads: [{ key: "cx,cz", data: { turrets:[], zombieNests:[], minecarts:[] } }]
 */
async function batchSync(payloads) {
  if (!db || payloads.length === 0) return { successCount: 0, failedKeys: [] };

  // 按 region 分组
  const regionGroups = new Map();
  for (const { key, data } of payloads) {
    const [cx, cz] = key.split(',').map(Number);
    const rx = Math.floor(cx / CHUNKS_PER_REGION);
    const rz = Math.floor(cz / CHUNKS_PER_REGION);
    const rKey = `${rx},${rz}`;
    if (!regionGroups.has(rKey)) regionGroups.set(rKey, new Map());
    regionGroups.get(rKey).set(key, data);
  }

  let successCount = 0;
  const failedKeys = [];

  for (const [rKey, chunkMap] of regionGroups) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([WORLD_REGION_STORE], 'readwrite');
        const store = tx.objectStore(WORLD_REGION_STORE);
        const getReq = store.get(rKey);

        getReq.onsuccess = () => {
          const wrapped = getReq.result;
          if (wrapped?.data?.chunks) {
            for (const [chunkKey, data] of chunkMap) {
              if (wrapped.data.chunks[chunkKey]) {
                wrapped.data.chunks[chunkKey].runtimeEntities = data;
              }
            }
            store.put(wrapped);
            successCount += chunkMap.size;
          } else {
            // region record 不存在，记录失败
            for (const [key] of chunkMap) {
              failedKeys.push(key);
            }
          }
        };
        getReq.onerror = () => reject(getReq.error);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.error(`[ShadowSyncWorker] Failed to sync region ${rKey}:`, error);
      for (const [key] of chunkMap) {
        if (!failedKeys.includes(key)) failedKeys.push(key);
      }
    }
  }

  return { successCount, failedKeys };
}

/**
 * 全量 flush：将 ShadowStore 中的所有数据写入 IndexedDB。
 * allData: { "cx,cz": { turrets:[], zombieNests:[], minecarts:[] }, ... }
 */
async function flushAll(allData) {
  if (!db) return { successCount: 0, failedKeys: [] };

  // 按 region 分组
  const regionGroups = new Map();
  for (const [key, data] of Object.entries(allData)) {
    const [cx, cz] = key.split(',').map(Number);
    const rx = Math.floor(cx / CHUNKS_PER_REGION);
    const rz = Math.floor(cz / CHUNKS_PER_REGION);
    const rKey = `${rx},${rz}`;
    if (!regionGroups.has(rKey)) regionGroups.set(rKey, new Map());
    regionGroups.get(rKey).set(key, data);
  }

  let successCount = 0;
  const failedKeys = [];

  for (const [rKey, chunkMap] of regionGroups) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([WORLD_REGION_STORE], 'readwrite');
        const store = tx.objectStore(WORLD_REGION_STORE);
        const getReq = store.get(rKey);

        getReq.onsuccess = () => {
          const wrapped = getReq.result;
          if (wrapped?.data?.chunks) {
            for (const [chunkKey, data] of chunkMap) {
              if (wrapped.data.chunks[chunkKey]) {
                wrapped.data.chunks[chunkKey].runtimeEntities = data;
              }
            }
            store.put(wrapped);
            successCount += chunkMap.size;
          }
        };
        getReq.onerror = () => reject(getReq.error);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.error(`[ShadowSyncWorker] Failed to flush region ${rKey}:`, error);
      failedKeys.push(rKey);
    }
  }

  return { successCount, failedKeys };
}

/**
 * 从 IndexedDB 加载指定 chunk 的 runtimeEntities。
 */
async function loadChunkEntities(key) {
  if (!db) return null;
  const [cx, cz] = key.split(',').map(Number);
  const rx = Math.floor(cx / CHUNKS_PER_REGION);
  const rz = Math.floor(cz / CHUNKS_PER_REGION);
  const rKey = `${rx},${rz}`;

  try {
    const wrapped = await performTransaction(
      db,
      WORLD_REGION_STORE,
      'readonly',
      (store) => store.get(rKey)
    );
    return wrapped?.data?.chunks?.[key]?.runtimeEntities || null;
  } catch {
    return null;
  }
}

/**
 * 一次性迁移：从 world_deltas 表读取旧格式 entities，回填到 world_regions。
 */
async function migrateAll() {
  if (!db) return { migratedCount: 0 };

  let migratedCount = 0;

  // 1. 获取所有 world_deltas keys
  let deltaKeys;
  try {
    deltaKeys = await performTransaction(
      db,
      WORLD_DELTA_STORE,
      'readonly',
      (store) => store.getAllKeys()
    );
  } catch {
    return { migratedCount: 0 };
  }

  // 2. 按 region 分组读取和写入
  const regionGroups = new Map(); // rKey -> Map<chunkKey, deltaData>

  for (const key of deltaKeys) {
    try {
      const deltaData = await performTransaction(
        db,
        WORLD_DELTA_STORE,
        'readonly',
        (store) => store.get(key)
      );

      if (deltaData?.data?.entities) {
        const [cx, cz] = key.split(',').map(Number);
        const rx = Math.floor(cx / CHUNKS_PER_REGION);
        const rz = Math.floor(cz / CHUNKS_PER_REGION);
        const rKey = `${rx},${rz}`;
        if (!regionGroups.has(rKey)) regionGroups.set(rKey, new Map());
        regionGroups.get(rKey).set(key, deltaData.data.entities);
      }
    } catch {
      // 跳过读取失败的 key
    }
  }

  // 3. 批量写入 world_regions
  for (const [rKey, entityMap] of regionGroups) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([WORLD_REGION_STORE], 'readwrite');
        const store = tx.objectStore(WORLD_REGION_STORE);
        const getReq = store.get(rKey);

        getReq.onsuccess = () => {
          const wrapped = getReq.result;
          if (wrapped?.data?.chunks) {
            for (const [chunkKey, entities] of entityMap) {
              if (wrapped.data.chunks[chunkKey]) {
                wrapped.data.chunks[chunkKey].runtimeEntities = entities;
                migratedCount++;
              }
            }
            store.put(wrapped);
          }
        };
        getReq.onerror = () => reject(getReq.error);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.error(`[ShadowSyncWorker] Failed to migrate region ${rKey}:`, error);
    }
  }

  return { migratedCount };
}

// ---------- 消息处理（WorkerRpcClient 兼容协议）----------

self.onmessage = async (event) => {
  const { action, payload, messageId } = event.data;
  try {
    await init();
    let result;
    switch (action) {
      case 'batchSync':
        result = await batchSync(payload.payloads);
        break;
      case 'flushAll':
        result = await flushAll(payload.allData);
        break;
      case 'loadChunkEntities':
        result = await loadChunkEntities(payload.key);
        break;
      case 'migrateAll':
        result = await migrateAll();
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    self.postMessage({ success: true, result, messageId });
  } catch (error) {
    self.postMessage({ success: false, error: error.message, messageId });
  }
};
