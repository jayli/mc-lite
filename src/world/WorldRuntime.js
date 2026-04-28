// src/world/WorldRuntime.js
/**
 * WorldRuntime — 运行时工作集层
 *
 * 职责：
 * - 管理 RegionCache（活动 region 缓存）
 * - 创建/释放 runtime chunk 视图
 * - 从 WorldStore 加载 chunk 数据（纯装载，不生成）
 * - 维护脏 chunk 写回队列
 * - 协调扩图与边界状态
 *
 * 关键设计：
 * - runtime blockData 是内存工作集视图，不是世界真相
 * - 玩家交互立即命中内存数据，不等待 IndexedDB
 * - 底层异步写回由 WorldRuntime 协调
 */
import { RegionCache } from './RegionCache.js';
import { worldStore } from './WorldStore.js';
import { persistenceService } from '../services/PersistenceService.js';
import { specialEntitiesShadowStore } from './SpecialEntitiesShadowStore.js';

// --- 依赖注入 ---
const getWorldStore = () => globalThis._worldStore || worldStore;

const REGION_SIZE_IN_CHUNKS = 8;

export class WorldRuntime {
  constructor(options = {}) {
    this._regionCache = new RegionCache(options.regionCache || {});
    this._dirtyChunks = new Map(); // "cx,cz" -> { cx, cz, dirty: true, pendingFlush: false }
    this._flushTimers = new Map(); // "cx,cz" -> timeout id
    this._world = null; // World 实例引用，在 World 初始化后注入
    this._game = null; // Game 实例引用，用于访问特殊实体管理器
    this._regionSizeInChunks = REGION_SIZE_IN_CHUNKS;
    this._flushing = false;
    this._worldStore = options.worldStore || getWorldStore();
    this._regionLoadPromises = new Map(); // regionKey -> Promise，用于并发请求去重
  }

  /**
   * 注入 World 和 Game 实例引用
   */
  setWorld(world, game) {
    this._world = world;
    this._game = game;
  }

  /**
   * 将 chunk 坐标投影到 region 坐标
   */
  _chunkToRegion(cx, cz) {
    const rx = Math.floor(cx / this._regionSizeInChunks);
    const rz = Math.floor(cz / this._regionSizeInChunks);
    return { rx, rz };
  }

  _regionKey(rx, rz) {
    return `${rx},${rz}`;
  }

  _chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  // ============================================================
  // Chunk 数据加载（纯装载路径）
  // ============================================================

  /**
   * 确保 chunk 数据已加载到内存
   * 优先从 RegionCache 读取，未命中时从 WorldStore 读取整个 RegionRecord
   *
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<object>} { status, chunkRecord? }
   */
  async ensureChunkData(cx, cz) {
    const { rx, rz } = this._chunkToRegion(cx, cz);
    const region = await this.ensureRegion(rx, rz);

    // 从 RegionRecord 中切出目标 chunk
    if (!region || !region.chunks) {
      return { status: 'missing-region' };
    }
    const chunkKey = this._chunkKey(cx, cz);
    const chunkData = region.chunks[chunkKey];
    if (!chunkData) {
      return { status: 'missing-chunk' };
    }

    const chunkRecord = {
      cx,
      cz,
      blockData: chunkData.blockData || {},
      staticEntities: chunkData.staticEntities || [],
      runtimeSeedData: chunkData.runtimeSeedData || {},
      runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] }
    };

    // 渐进式迁移：如果 region record 中不含 runtimeEntities，尝试从 world_deltas 迁移
    if (!chunkData.runtimeEntities) {
      await this._ensureChunkEntitiesMigrated(cx, cz, chunkRecord);
    }

    return {
      status: 'ready',
      chunkRecord
    };
  }

  /**
   * 获取已加载的 chunk 数据（同步，不触发加载）
   * @param {number} cx
   * @param {number} cz
   * @returns {object|null}
   */
  getLoadedChunkData(cx, cz) {
    const { rx, rz } = this._chunkToRegion(cx, cz);
    const regionKey = this._regionKey(rx, rz);
    const region = this._regionCache.get(regionKey);
    if (!region || !region.chunks) return null;
    return region.chunks[this._chunkKey(cx, cz)] || null;
  }

  // ============================================================
  // 脏 chunk 管理
  // ============================================================

  /**
   * 标记 chunk 为脏（玩家放置/破坏方块后调用）
   * @param {number} cx
   * @param {number} cz
   */
  markChunkDirty(cx, cz) {
    const key = this._chunkKey(cx, cz);
    if (!this._dirtyChunks.has(key)) {
      this._dirtyChunks.set(key, { cx, cz, dirty: true, pendingFlush: false });
    }
    this._scheduleFlush(cx, cz);
  }

  /**
   * 检查 chunk 是否为脏
   */
  isChunkDirty(cx, cz) {
    const entry = this._dirtyChunks.get(this._chunkKey(cx, cz));
    return !!(entry && entry.dirty);
  }

  /**
   * 清除 chunk 的脏标记
   */
  clearChunkDirty(cx, cz) {
    this._dirtyChunks.delete(this._chunkKey(cx, cz));
  }

  /**
   * 获取所有脏 chunk keys
   */
  getDirtyChunkKeys() {
    return Array.from(this._dirtyChunks.keys());
  }

  // ============================================================
  // 异步写回
  // ============================================================

  /**
   * 将单个脏 chunk 写回 WorldStore
   * 由 WorldAccessLayer 调用，玩家交互后异步执行
   */
  async flushChunk(cx, cz, blockDataSnapshot = null) {
    const key = this._chunkKey(cx, cz);
    const dirtyEntry = this._dirtyChunks.get(key);
    if (!dirtyEntry) return;
    this._clearScheduledFlush(cx, cz);

    // 获取 blockData：优先使用传入的快照，其次从活动 chunk 读取
    let blockData = blockDataSnapshot;
    let staticEntities = [];
    let runtimeSeedData = {};

    if (!blockData) {
      const chunk = this._world?.chunks?.get(key);
      if (!chunk || !chunk.blockData) return;
      blockData = chunk.blockData;
      staticEntities = chunk.staticEntities || [];
      runtimeSeedData = chunk.runtimeSeedData || {};
    }

    try {
      dirtyEntry.pendingFlush = true;
      const entities = this._game ? this._collectEntitiesForChunk(cx, cz) : { turrets: [], zombieNests: [], minecarts: [] };
      await this._worldStore.putChunkRecord(cx, cz, {
        blockData: this._serializeBlockData(blockData),
        staticEntities,
        runtimeSeedData,
        runtimeEntities: entities
      });
      dirtyEntry.dirty = false;
      dirtyEntry.pendingFlush = false;
      this._dirtyChunks.delete(key);
    } catch (error) {
      console.error(`[WorldRuntime] Failed to flush chunk ${key}:`, error);
      dirtyEntry.pendingFlush = false;
      this._scheduleFlush(cx, cz);
    }
  }

  /**
   * 批量写回所有脏 chunk
   * 在 chunk 卸载或游戏暂停时调用
   */
  async flushAllDirty() {
    const dirtyKeys = this.getDirtyChunkKeys();
    if (dirtyKeys.length === 0) return;

    // 按 region 分组，批量写入
    const regionGroups = new Map();
    for (const key of dirtyKeys) {
      const [cx, cz] = key.split(',').map(Number);
      const { rx, rz } = this._chunkToRegion(cx, cz);
      const rKey = this._regionKey(rx, rz);
      if (!regionGroups.has(rKey)) {
        regionGroups.set(rKey, { rx, rz, chunks: new Map() });
      }
      const group = regionGroups.get(rKey);
      const chunk = this._world?.chunks?.get(key);
      if (chunk && chunk.blockData) {
        const entities = this._game ? this._collectEntitiesForChunk(cx, cz) : { turrets: [], zombieNests: [], minecarts: [] };
        group.chunks.set(key, {
          blockData: this._serializeBlockData(chunk.blockData),
          staticEntities: chunk.staticEntities || [],
          runtimeSeedData: chunk.runtimeSeedData || {},
          runtimeEntities: entities
        });
      }
    }

    for (const [rKey, group] of regionGroups) {
      try {
        const region = this._regionCache.get(rKey);
        if (region) {
          // 更新已有 region
          for (const [chunkKey, chunkRecord] of group.chunks) {
            region.chunks[chunkKey] = chunkRecord;
          }
          await this._worldStore.saveRegionRecord(group.rx, group.rz, region);
        } else {
          // 创建新 region（不应该发生，因为脏 chunk 必然有 region）
          const newRegion = {
            regionKey: rKey,
            rx: group.rx,
            rz: group.rz,
            chunkKeys: Array.from(group.chunks.keys()),
            chunks: Object.fromEntries(group.chunks),
            generatedAt: Date.now(),
            generatorVersion: '1.0'
          };
          await this._worldStore.saveRegionRecord(group.rx, group.rz, newRegion);
        }

        // 清除已写回的脏标记
        for (const chunkKey of group.chunks.keys()) {
          this._dirtyChunks.delete(chunkKey);
        }
      } catch (error) {
        console.error(`[WorldRuntime] Failed to flush region ${rKey}:`, error);
      }
    }
  }

  /**
   * 卸载 chunk 前强制写回
   * @param {number} cx
   * @param {number} cz
   * @param {object|null} blockDataSnapshot
   * @param {object|null} entitiesSnapshot
   */
  async flushBeforeUnload(cx, cz, blockDataSnapshot, entitiesSnapshot) {
    const key = this._chunkKey(cx, cz);
    const chunk = this._world?.chunks?.get(key);

    const entities = entitiesSnapshot
      || (this._game ? this._collectEntitiesForChunk(cx, cz) : null)
      || { turrets: [], zombieNests: [], minecarts: [] };

    const record = {
      blockData: blockDataSnapshot ? this._serializeBlockData(blockDataSnapshot) : (chunk ? this._serializeBlockData(chunk.blockData) : {}),
      staticEntities: chunk?.staticEntities ? [...chunk.staticEntities] : [],
      runtimeSeedData: chunk?.structureCenters
        ? { structureCenters: chunk.structureCenters }
        : { structureCenters: [] },
      runtimeEntities: entities
    };

    await this._worldStore.putChunkRecord(cx, cz, record);
    this._dirtyChunks.delete(key);
  }

  /**
   * 从 ShadowStore 读取指定 chunk 的实体快照。
   */
  _collectEntitiesForChunk(cx, cz) {
    return specialEntitiesShadowStore.getAllEntitiesInChunk(cx, cz);
  }

  /**
   * 渐进式迁移：当 chunkRecord 不含 runtimeEntities 时，从 world_deltas 表读取
   * entities 并回填到 worldStore。
   */
  async _ensureChunkEntitiesMigrated(cx, cz, chunkRecord) {
    const persistence = persistenceService;
    if (!persistence) {
      chunkRecord.runtimeEntities = { turrets: [], zombieNests: [], minecarts: [] };
      return;
    }

    const legacyData = await persistence.workerGetChunkData(cx, cz);

    if (legacyData?.entities) {
      chunkRecord.runtimeEntities = legacyData.entities;
      // 异步回填到 worldStore（不阻塞 chunk 加载）
      this._worldStore.putChunkRecord(cx, cz, chunkRecord).catch((err) => {
        console.warn(`[WorldRuntime] Failed to backfill migrated entities for chunk ${cx},${cz}:`, err);
      });
      console.log(`[WorldRuntime] migrated runtime entities for chunk ${cx},${cz}`);
    } else {
      // world_deltas 中也没有，创建空结构
      chunkRecord.runtimeEntities = { turrets: [], zombieNests: [], minecarts: [] };
    }
  }

  // ============================================================
  // Region 缓存管理
  // ============================================================

  /**
   * 确保 region 已加载到缓存
   * @param {number} rx
   * @param {number} rz
   * @returns {Promise<object|null>}
   */
  async ensureRegion(rx, rz) {
    const regionKey = this._regionKey(rx, rz);

    // 1. 缓存命中
    const cached = this._regionCache.get(regionKey);
    if (cached) return cached;

    // 2. 检查是否已有正在进行的请求
    const existingPromise = this._regionLoadPromises.get(regionKey);
    if (existingPromise) return existingPromise;

    // 3. 发起新请求
    const loadPromise = this._worldStore.getRegionRecord(rx, rz)
      .then((record) => {
        if (record) {
          this._regionCache.set(regionKey, record);
        }
        this._regionLoadPromises.delete(regionKey);
        return record;
      })
      .catch((err) => {
        this._regionLoadPromises.delete(regionKey);
        throw err;
      });

    this._regionLoadPromises.set(regionKey, loadPromise);
    return loadPromise;
  }

  /**
   * 从缓存中移除 region（LRU 淘汰或清理过期区域）
   * @param {number} rx
   * @param {number} rz
   */
  evictRegion(rx, rz) {
    const regionKey = this._regionKey(rx, rz);
    this._regionCache.delete(regionKey);
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 序列化 blockData Map 为普通对象（用于 IndexedDB 存储）
   */
  _serializeBlockData(blockData) {
    if (!blockData) return {};
    if (blockData instanceof Map) {
      const obj = {};
      for (const [key, value] of blockData) {
        obj[key] = typeof value === 'string' ? value : { type: value.type, orientation: value.orientation || 0 };
      }
      return obj;
    }
    return blockData;
  }

  _scheduleFlush(cx, cz, delayMs = 500) {
    const key = this._chunkKey(cx, cz);
    this._clearScheduledFlush(cx, cz);
    const timer = globalThis.setTimeout(() => {
      this._flushTimers.delete(key);
      this.flushChunk(cx, cz).catch((error) => {
        console.error(`[WorldRuntime] Debounced flush failed for ${key}:`, error);
      });
    }, delayMs);
    this._flushTimers.set(key, timer);
  }

  _clearScheduledFlush(cx, cz) {
    const key = this._chunkKey(cx, cz);
    const timer = this._flushTimers.get(key);
    if (timer) {
      globalThis.clearTimeout(timer);
      this._flushTimers.delete(key);
    }
  }

  /**
   * 预取玩家周围的 region（尽力而为，不阻塞）
   * @param {number} playerCx - 玩家所在 chunk X
   * @param {number} playerCz - 玩家所在 chunk Z
   * @param {number} [maxPrefetches=1] - 每轮最多预取数量
   * @returns {number} 实际预取的 region 数量
   */
  prefetchRegions(playerCx, playerCz, maxPrefetches = 1) {
    const playerRx = Math.floor(playerCx / this._regionSizeInChunks);
    const playerRz = Math.floor(playerCz / this._regionSizeInChunks);

    // 相邻 4 个 region（上/下/左/右）
    const neighbors = [
      { rx: playerRx - 1, rz: playerRz },
      { rx: playerRx + 1, rz: playerRz },
      { rx: playerRx, rz: playerRz - 1 },
      { rx: playerRx, rz: playerRz + 1 }
    ];

    let prefetched = 0;
    for (const { rx, rz } of neighbors) {
      if (prefetched >= maxPrefetches) break;
      const regionKey = this._regionKey(rx, rz);

      // 跳过已缓存或正在加载的
      if (this._regionCache.has(regionKey)) continue;
      if (this._regionLoadPromises.has(regionKey)) continue;

      // 静默预取（不 await，不阻塞）
      this.ensureRegion(rx, rz).catch(() => {});
      prefetched++;
    }

    return prefetched;
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      cachedRegions: this._regionCache.size,
      dirtyChunks: this._dirtyChunks.size,
      maxRegions: this._regionCache._maxRegions
    };
  }
}
