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
import { specialEntitiesShadowStore } from './SpecialEntitiesShadowStore.js';
import { encodeCoord } from '../utils/CoordEncoding.js';
import { isChunkPerfDebugEnabled, recordChunkPerf } from '../utils/ChunkPerfMonitor.js';

// --- 依赖注入 ---
const getWorldStore = () => globalThis._worldStore || worldStore;

const REGION_SIZE_IN_CHUNKS = 8;

export class WorldRuntime {
  constructor(options = {}) {
    this._regionCache = new RegionCache(options.regionCache || {});
    this._dirtyChunks = new Map(); // "cx,cz" -> { cx, cz, dirty: true, pendingFlush: false }
    this._flushTimers = new Map(); // "cx,cz" -> timeout id
    this.pendingUnloadFlushQueue = new Map(); // "cx,cz" -> stable chunkRecord snapshot
    this._world = null; // World 实例引用，在 World 初始化后注入
    this._game = null; // Game 实例引用，用于访问特殊实体管理器
    this._regionSizeInChunks = REGION_SIZE_IN_CHUNKS;
    this._flushing = false;
    this._worldStore = options.worldStore || getWorldStore();
    this._regionLoadPromises = new Map(); // regionKey -> Promise，用于并发请求去重
    this._pendingUnloadFlushVersion = 0;
    this._pendingUnloadFlushInFlight = null;
    this._pendingUnloadFlushStats = {
      lastProcessedChunks: 0,
      lastProcessedRegions: 0,
      lastElapsedMs: 0,
      lastProcessedAt: 0
    };
    // 迁移期调用点统计：追踪 authority mutation / deprecated shell / fallback 路径命中次数
    this._callStats = {
      recordBlockMutation: 0,    // block 变更记录（标记 runtime dirty）
      flushChunk: 0,             // deprecated flush 单 chunk 调用
      flushAllDirty: 0,          // deprecated flush 全量调用
      flushBeforeUnload: 0,      // deprecated flush unload 前调用
      scheduleFlush: 0,          // deprecated _scheduleFlush 调度次数
      regionCacheFallback: 0     // RegionCache 作为 live truth fallback 的命中次数
    };
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

  /**
   * 将单个 chunkRecord 注入运行时 _regionCache，维持 flush/unload 所需的最小基线数据。
   * 允许 _regionCache 保存部分 region（不要求完整 region 已加载）。
   */
  _upsertRegionCacheChunkRecord(cx, cz, chunkRecord) {
    const { rx, rz } = this._chunkToRegion(cx, cz);
    const regionKey = this._regionKey(rx, rz);
    const existingRegion = this._regionCache.get(regionKey) || {
      regionKey,
      rx,
      rz,
      chunkKeys: [],
      chunks: {},
      __partial: true
    };

    if (!existingRegion.chunks) existingRegion.chunks = {};
    if (!Array.isArray(existingRegion.chunkKeys)) existingRegion.chunkKeys = [];

    const chunkKey = this._chunkKey(cx, cz);
    const newRegion = this._stripBlockDataFromRegionRecord({
      ...existingRegion,
      chunks: { ...existingRegion.chunks, [chunkKey]: chunkRecord },
      chunkKeys: existingRegion.chunkKeys.includes(chunkKey)
        ? existingRegion.chunkKeys
        : [...existingRegion.chunkKeys, chunkKey]
    });
    this._regionCache.set(regionKey, newRegion);
  }

  // ============================================================
  // Chunk 数据加载（纯装载路径）
  // ============================================================

  /**
   * 确保 chunk 数据已加载到内存
   * 通过 Worker 侧 getChunkRecord 读取，仅传输目标 chunk 数据
   *
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<object>} { status, chunkRecord? }
   */
  async ensureChunkData(cx, cz) {
    const chunkRecord = await this._worldStore.getChunkRecord(cx, cz);

    if (!chunkRecord) {
      return { status: 'missing-chunk' };
    }

    // 渐进式迁移：如果 chunk record 中不含 runtimeEntities，通过 WorldStore 读取旧档
    if (chunkRecord.__runtimeEntitiesWasDefault) {
      delete chunkRecord.__runtimeEntitiesWasDefault;
      await this._hydrateLegacyRuntimeEntities(cx, cz, chunkRecord);
    }

    this._upsertRegionCacheChunkRecord(cx, cz, chunkRecord);

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
   * runtime dirty 仅用于观测和导出标记，不再自动调度 flush/save
   * @param {number} cx
   * @param {number} cz
   */
  markChunkDirty(cx, cz) {
    this._ensureDirtyChunkEntry(cx, cz).dirty = true;
    // flush 已退出 runtime 热路径，不再自动调度
  }

  /**
   * 记录方块变更为 runtime dirty（不再构造 blockDataSnapshot）
   * authority 由 WorldBlockDataStore 统一持有，此处仅标记 runtime dirty
   * blockDataSnapshot 语义已退出 runtime 正确性主链路
   * @param {number} cx
   * @param {number} cz
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string|object|null} typeOrEntry
   */
  recordBlockMutation(cx, cz, x, y, z, typeOrEntry) {
    this._callStats.recordBlockMutation++;
    const dirtyEntry = this._ensureDirtyChunkEntry(cx, cz);
    dirtyEntry.dirty = true;
    // blockDataSnapshot 已不再构造，authority 由 WorldBlockDataStore 持有
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
   * 统一清理 chunk 卸载后的 runtime 残留
   */
  clearChunkRuntimeResidue(cx, cz) {
    const key = this._chunkKey(cx, cz);
    this._dirtyChunks.delete(key);
    this.pendingUnloadFlushQueue.delete(key);
    const timer = this._flushTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._flushTimers.delete(key);
    }
  }

  /**
   * 从 region record 的各 chunk 中剥离 blockData 冗余副本。
   * 返回可安全放入 _regionCache 的浅克隆，不修改原始对象。
   */
  _stripBlockDataFromRegionRecord(region) {
    if (!region?.chunks) return region;
    const cleaned = { ...region, chunks: {} };
    for (const [ck, rec] of Object.entries(region.chunks)) {
      if (rec && rec.blockData !== undefined) {
        const { blockData: _dropped, ...rest } = rec;
        cleaned.chunks[ck] = rest;
      } else {
        cleaned.chunks[ck] = rec;
      }
    }
    return cleaned;
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
   * @deprecated 运行期已旁路，内存权威层接管正确性。
   * 保留此方法仅供未来手动保存时导出到 IndexedDB。
   */
  async flushChunk(cx, cz, blockDataSnapshot = null) {
    this._callStats.flushChunk++;
    const key = this._chunkKey(cx, cz);
    const dirtyEntry = this._dirtyChunks.get(key);
    if (!dirtyEntry) return;
    this._clearScheduledFlush(cx, cz);
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const chunk = this._world?.chunks?.get(key) || null;
    const cachedChunkRecord = this._getCachedChunkRecord(cx, cz);
    const blockDataResolution = this._resolveSerializedBlockData({
      explicitSnapshot: blockDataSnapshot,
      dirtyEntry,
      chunk,
      cachedChunkRecord
    });
    if (!blockDataResolution.blockData && !chunk?.blockData) return;

    try {
      dirtyEntry.pendingFlush = true;
      const entities = this._game ? this._collectEntitiesForChunk(cx, cz) : { turrets: [], zombieNests: [], minecarts: [] };
      const chunkRecord = {
        blockData: blockDataResolution.blockData || {},
        staticEntities: this._resolveStaticEntities(chunk, cachedChunkRecord),
        runtimeSeedData: this._resolveRuntimeSeedData(chunk, cachedChunkRecord),
        runtimeEntities: entities
      };
      await this._commitChunkRecord(cx, cz, chunkRecord);
      this._updateRegionCacheChunkRecord(cx, cz, chunkRecord);
      this._recordFlushPerf('world-runtime.flush-chunk', startedAt, {
        chunkKey: key,
        blockDataSource: blockDataResolution.source,
        blockData: chunkRecord.blockData
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
   * @deprecated 运行期已旁路，内存权威层接管正确性。
   * 保留此方法仅供未来手动保存时导出到 IndexedDB。
   */
  async flushAllDirty() {
    this._callStats.flushAllDirty++;
    const dirtyKeys = this.getDirtyChunkKeys();
    const pendingUnloadKeys = Array.from(this.pendingUnloadFlushQueue.keys());
    if (dirtyKeys.length === 0 && pendingUnloadKeys.length === 0) return;
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    let totalBlockCount = 0;
    let totalSerializedBytes = 0;

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
      const dirtyEntry = this._dirtyChunks.get(key);
      const chunk = this._world?.chunks?.get(key) || null;
      const cachedChunkRecord = this._getCachedChunkRecord(cx, cz);
      const blockDataResolution = this._resolveSerializedBlockData({
        explicitSnapshot: null,
        dirtyEntry,
        chunk,
        cachedChunkRecord
      });
      const blockData = blockDataResolution.blockData || null;
      if (blockData) {
        const entities = this._game ? this._collectEntitiesForChunk(cx, cz) : { turrets: [], zombieNests: [], minecarts: [] };
        const chunkRecord = {
          blockData,
          staticEntities: this._resolveStaticEntities(chunk, cachedChunkRecord),
          runtimeSeedData: this._resolveRuntimeSeedData(chunk, cachedChunkRecord),
          runtimeEntities: entities
        };
        group.chunks.set(key, chunkRecord);
        const metrics = this._getSerializedBlockMetrics(blockData);
        totalBlockCount += metrics.blockCount;
        totalSerializedBytes += metrics.serializedBytes;
      }
    }

    for (const key of pendingUnloadKeys) {
      const queueRecord = this.pendingUnloadFlushQueue.get(key);
      if (!queueRecord?.chunkRecord) continue;
      const { rx, rz } = this._chunkToRegion(queueRecord.cx, queueRecord.cz);
      const rKey = this._regionKey(rx, rz);
      if (!regionGroups.has(rKey)) {
        regionGroups.set(rKey, { rx, rz, chunks: new Map() });
      }
      const group = regionGroups.get(rKey);
      const chunkRecord = this._cloneSerializable(queueRecord.chunkRecord, null);
      if (queueRecord.preserveStoredBlockData === true) {
        // RegionCache 已剥离 blockData，不再从 cache 读取。
        // 删除 chunkRecord 的 blockData，让写盘路径自然保留 IndexedDB 中已有数据：
        // - patch 路径：chunkRecord 不含 blockData，已有数据不受影响
        // - full-save 路径：从 getRegionRecord() 重读完整 region，merge 时无 blockData 属性不会覆盖
        delete chunkRecord.blockData;
      }
      group.chunks.set(key, chunkRecord);
      const metrics = this._getSerializedBlockMetrics(chunkRecord.blockData);
      totalBlockCount += metrics.blockCount;
      totalSerializedBytes += metrics.serializedBytes;
    }

    for (const [rKey, group] of regionGroups) {
      try {
        const region = this._regionCache.get(rKey);
        if (region?.__partial && typeof this._worldStore.applyRegionPatch === 'function') {
          const chunkPatches = Array.from(group.chunks.entries()).map(([chunkKey, chunkRecord]) => ({
            chunkKey,
            chunkRecord: this._cloneSerializable(chunkRecord, null)
          }));
          await this._worldStore.applyRegionPatch(group.rx, group.rz, { chunkPatches });
          for (const [chunkKey, chunkRecord] of group.chunks) {
            const [cx, cz] = chunkKey.split(',').map(Number);
            this._updateRegionCacheChunkRecord(cx, cz, chunkRecord);
          }
          this._regionCache.set(rKey, this._stripBlockDataFromRegionRecord(region));
        } else if (region) {
          const chunkPatches = Array.from(group.chunks.entries()).map(([chunkKey, chunkRecord]) => ({
            chunkKey,
            chunkRecord: this._cloneSerializable(chunkRecord, null)
          }));
          if (typeof this._worldStore.applyRegionPatch === 'function') {
            await this._worldStore.applyRegionPatch(group.rx, group.rz, { chunkPatches });
          } else {
            // 无 patch API — 从 worldStore 重读完整 region 再 merge，不用 stripped cache 做基底
            const fullRegion = (typeof this._worldStore.getRegionRecord === 'function'
              ? await this._worldStore.getRegionRecord(group.rx, group.rz)
              : null) || region;
            for (const [chunkKey, chunkRecord] of group.chunks) {
              fullRegion.chunks[chunkKey] = { ...fullRegion.chunks[chunkKey], ...chunkRecord };
            }
            await this._worldStore.saveRegionRecord(group.rx, group.rz, fullRegion);
          }
          // merge 新 chunkRecord 到 region cache（更新 staticEntities/runtimeSeedData 等元数据）
          for (const [chunkKey, chunkRecord] of group.chunks) {
            region.chunks[chunkKey] = { ...region.chunks[chunkKey], ...chunkRecord };
          }
          this._regionCache.set(rKey, this._stripBlockDataFromRegionRecord(region));
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
          this._regionCache.set(rKey, this._stripBlockDataFromRegionRecord(newRegion));
        }

        // 清除已写回的脏标记
        for (const chunkKey of group.chunks.keys()) {
          this._dirtyChunks.delete(chunkKey);
          this.pendingUnloadFlushQueue.delete(chunkKey);
        }
      } catch (error) {
        console.error(`[WorldRuntime] Failed to flush region ${rKey}:`, error);
      }
    }

    this._recordFlushPerf('world-runtime.flush-all-dirty', startedAt, {
      dirtyChunkCount: dirtyKeys.length,
      pendingUnloadChunkCount: pendingUnloadKeys.length,
      regionCount: regionGroups.size,
      blockCount: totalBlockCount,
      serializedBytes: totalSerializedBytes
    }, { metricsReady: true });
    this._updatePendingUnloadFlushStats({
      processedChunks: pendingUnloadKeys.length,
      processedRegions: regionGroups.size,
      elapsedMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt
    });
  }

  /**
   * @deprecated 运行期已旁路，内存权威层接管正确性。
   * chunk 卸载不再触发保存，仅释放渲染资源。
   * 保留此方法仅供未来手动保存时导出到 IndexedDB。
   * @param {number} cx
   * @param {number} cz
   * @param {object|null} blockDataSnapshot
   * @param {object|null} entitiesSnapshot
   */
  async flushBeforeUnload(cx, cz, blockDataSnapshot, entitiesSnapshot) {
    this._callStats.flushBeforeUnload++;
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const key = this._chunkKey(cx, cz);
    const chunk = this._world?.chunks?.get(key) || null;
    const dirtyEntry = this._dirtyChunks.get(key);
    const cachedChunkRecord = this._getCachedChunkRecord(cx, cz);

    const buildResult = this._buildChunkRecordForBackgroundFlush(cx, cz, {
      explicitSnapshot: blockDataSnapshot,
      entitiesSnapshot,
      dirtyEntry,
      chunk,
      cachedChunkRecord
    });

    if (!buildResult) {
      this._recordFlushPerf('world-runtime.unload-enqueue', startedAt, {
        chunkKey: key,
        blockDataSource: 'skipped-no-stable-snapshot',
        blockData: null,
        queueSize: this.pendingUnloadFlushQueue.size
      }, { allowObjectMetrics: false });
      this._dirtyChunks.delete(key);
      return { enqueued: false, reason: 'missing-stable-snapshot' };
    }

    this._updateRegionCacheChunkRecord(cx, cz, buildResult.regionCacheChunkRecord);
    const queuedRecord = this._enqueuePendingChunkFlushRecord(cx, cz, buildResult.chunkRecord, {
      blockDataSource: buildResult.blockDataSource,
      preserveStoredBlockData: buildResult.preserveStoredBlockData
    });
    this._recordFlushPerf('world-runtime.unload-enqueue', startedAt, {
      chunkKey: key,
      blockDataSource: buildResult.blockDataSource,
      queueSize: this.pendingUnloadFlushQueue.size,
      queueVersion: queuedRecord.version
    }, { allowObjectMetrics: false });
    this._dirtyChunks.delete(key);
    return { enqueued: true, queueSize: this.pendingUnloadFlushQueue.size };
  }

  _buildChunkRecordForBackgroundFlush(cx, cz, options = {}) {
    const {
      explicitSnapshot = null,
      entitiesSnapshot = null,
      dirtyEntry = null,
      chunk = null,
      cachedChunkRecord = null
    } = options;

    const entities = entitiesSnapshot
      || (this._game ? this._collectEntitiesForChunk(cx, cz) : null)
      || { turrets: [], zombieNests: [], minecarts: [] };

    const blockDataResolution = this._resolveSerializedBlockData({
      explicitSnapshot,
      dirtyEntry,
      chunk,
      cachedChunkRecord,
      allowLiveChunk: false
    });

    if (!blockDataResolution.blockData) {
      return null;
    }

    const preserveStoredBlockData = (
      blockDataResolution.source === 'region-cache' &&
      !explicitSnapshot &&
      !dirtyEntry?.blockDataSnapshot
    );
    const staticEntities = this._cloneSerializable(this._resolveStaticEntities(chunk, cachedChunkRecord), []);
    const runtimeSeedData = this._cloneSerializable(this._resolveRuntimeSeedData(chunk, cachedChunkRecord), { structureCenters: [] });
    const runtimeEntities = this._cloneSerializable(entities, { turrets: [], zombieNests: [], minecarts: [] });
    const chunkRecord = {
      blockData: preserveStoredBlockData ? null : this._cloneSerializedBlockData(blockDataResolution.blockData),
      staticEntities,
      runtimeSeedData,
      runtimeEntities
    };

    return {
      blockDataSource: blockDataResolution.source,
      preserveStoredBlockData,
      chunkRecord,
      regionCacheChunkRecord: {
        blockData: preserveStoredBlockData
          ? (cachedChunkRecord?.blockData || blockDataResolution.blockData)
          : chunkRecord.blockData,
        staticEntities,
        runtimeSeedData,
        runtimeEntities
      }
    };
  }

  _enqueuePendingChunkFlushRecord(cx, cz, chunkRecord, metadata = {}) {
    const chunkKey = this._chunkKey(cx, cz);
    const now = globalThis.performance?.now?.() ?? Date.now();
    const previous = this.pendingUnloadFlushQueue.get(chunkKey);
    const record = {
      cx,
      cz,
      chunkKey,
      chunkRecord: this._cloneSerializable(chunkRecord, null),
      blockDataSource: metadata.blockDataSource || 'unknown',
      preserveStoredBlockData: metadata.preserveStoredBlockData === true,
      version: (previous?.version || 0) + 1,
      createdAt: previous?.createdAt || now,
      lastUpdatedAt: now
    };
    this.pendingUnloadFlushQueue.set(chunkKey, record);
    this._pendingUnloadFlushVersion += 1;
    return record;
  }

  /**
   * 更新 region cache 中的 chunkRecord。
   * 与 _upsertRegionCacheChunkRecord 功能类似但来源不同：此方法用于写路径（flush/migration），
   * 后者用于读路径（ensureChunkData）。两者都是幂等的，后写入者覆盖同 chunk key。
   */
  _updateRegionCacheChunkRecord(cx, cz, chunkRecord) {
    const { rx, rz } = this._chunkToRegion(cx, cz);
    const regionKey = this._regionKey(rx, rz);
    const cachedRegion = this._regionCache.get(regionKey);
    if (!cachedRegion) return;

    if (!cachedRegion.chunks) {
      cachedRegion.chunks = {};
    }

    const key = this._chunkKey(cx, cz);
    const { blockData: _dropped, ...cleanRecord } = chunkRecord;
    cachedRegion.chunks[key] = cleanRecord;

    if (!Array.isArray(cachedRegion.chunkKeys)) {
      cachedRegion.chunkKeys = [];
    }
    if (!cachedRegion.chunkKeys.includes(key)) {
      cachedRegion.chunkKeys.push(key);
    }
  }

  /**
   * 从 ShadowStore 读取指定 chunk 的实体快照。
   */
  _collectEntitiesForChunk(cx, cz) {
    return specialEntitiesShadowStore.getAllEntitiesInChunk(cx, cz);
  }

  async _hydrateLegacyRuntimeEntities(cx, cz, chunkRecord) {
    const legacyData = await this._worldStore.getLegacyChunkDelta?.(cx, cz);
    const legacyEntities = legacyData?.entities;

    if (legacyEntities) {
      chunkRecord.runtimeEntities = legacyEntities;
      try {
        await this._commitChunkRecord(cx, cz, chunkRecord);
        this._updateRegionCacheChunkRecord(cx, cz, chunkRecord);
      } catch (err) {
        console.warn(`[WorldRuntime] Failed to backfill migrated entities for chunk ${cx},${cz}:`, err);
      }
      return;
    }

    chunkRecord.runtimeEntities = { turrets: [], zombieNests: [], minecarts: [] };
  }

  async _commitChunkRecord(cx, cz, chunkRecord) {
    if (typeof this._worldStore.commitChunkRecord === 'function') {
      return this._worldStore.commitChunkRecord(cx, cz, chunkRecord);
    }
    return this._worldStore.putChunkRecord(cx, cz, chunkRecord);
  }

  /**
   * @deprecated 运行期已旁路，内存权威层接管正确性。
   * 保留此方法仅供未来手动保存时批量导出。
   */
  flushPendingUnloadQueueWithinBudget(options = {}) {
    if (this._pendingUnloadFlushInFlight) {
      return this._pendingUnloadFlushInFlight;
    }

    const promise = this._flushPendingUnloadQueueWithinBudgetInternal(options)
      .finally(() => {
        if (this._pendingUnloadFlushInFlight === promise) {
          this._pendingUnloadFlushInFlight = null;
        }
      });
    this._pendingUnloadFlushInFlight = promise;
    return promise;
  }

  async _flushPendingUnloadQueueWithinBudgetInternal(options = {}) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const maxRegions = Number.isFinite(options.maxRegions) ? options.maxRegions : 1;
    const maxChunks = Number.isFinite(options.maxChunks) ? options.maxChunks : 2;
    const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : 2;
    if (maxRegions <= 0 || maxChunks <= 0 || this.pendingUnloadFlushQueue.size === 0) {
      const emptyResult = {
        processedChunks: 0,
        processedRegions: 0,
        remainingQueueSize: this.pendingUnloadFlushQueue.size,
        elapsedMs: 0
      };
      this._updatePendingUnloadFlushStats(emptyResult);
      return emptyResult;
    }

    let processedChunks = 0;
    let processedRegions = 0;
    const sortedEntries = [...this.pendingUnloadFlushQueue.values()].sort((a, b) => {
      if (a.lastUpdatedAt !== b.lastUpdatedAt) {
        return a.lastUpdatedAt - b.lastUpdatedAt;
      }
      return a.chunkKey.localeCompare(b.chunkKey);
    });

    const consumedRegionKeys = new Set();
    while (sortedEntries.length > 0 && processedRegions < maxRegions && processedChunks < maxChunks) {
      const currentElapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
      if (currentElapsedMs >= maxMs) break;

      const first = sortedEntries.shift();
      if (!first) break;
      if (!this.pendingUnloadFlushQueue.has(first.chunkKey)) continue;

      const { rx, rz } = this._chunkToRegion(first.cx, first.cz);
      const regionKey = this._regionKey(rx, rz);
      if (consumedRegionKeys.has(regionKey)) continue;

      const regionEntries = [first];
      for (const entry of sortedEntries) {
        if (regionEntries.length >= (maxChunks - processedChunks)) break;
        if (!this.pendingUnloadFlushQueue.has(entry.chunkKey)) continue;
        const regionCoords = this._chunkToRegion(entry.cx, entry.cz);
        if (this._regionKey(regionCoords.rx, regionCoords.rz) === regionKey) {
          regionEntries.push(entry);
        }
      }

      // Step 14.5: preserveStoredBlockData — 删除 blockData，让写盘路径自然保留已有数据
      for (const entry of regionEntries) {
        if (entry.preserveStoredBlockData) {
          delete entry.chunkRecord.blockData;
        }
      }

      const chunkPatches = regionEntries.map((entry) => ({
        chunkKey: entry.chunkKey,
        preserveStoredBlockData: entry.preserveStoredBlockData === true,
        chunkRecord: this._cloneSerializable(entry.chunkRecord, null)
      }));

      if (typeof this._worldStore.applyRegionPatch === 'function') {
        await this._worldStore.applyRegionPatch(rx, rz, { chunkPatches });
      } else {
        // 无 patch API — 从 worldStore 重读完整 region，不用 stripped cache 做基底
        const fullRegion = (typeof this._worldStore.getRegionRecord === 'function'
          ? await this._worldStore.getRegionRecord(rx, rz)
          : null) || {
          regionKey,
          rx,
          rz,
          chunkKeys: [],
          chunks: {},
          generatedAt: Date.now(),
          generatorVersion: '1.0'
        };
        if (!fullRegion.chunks) fullRegion.chunks = {};
        if (!Array.isArray(fullRegion.chunkKeys)) fullRegion.chunkKeys = [];

        for (const entry of regionEntries) {
          const currentChunk = fullRegion.chunks[entry.chunkKey] || {};
          // 纯属性 merge：preserveStoredBlockData 下 chunkRecord 已无 blockData，
          // spread 自然保留 currentChunk 的 blockData
          fullRegion.chunks[entry.chunkKey] = { ...currentChunk, ...entry.chunkRecord };
          if (!fullRegion.chunkKeys.includes(entry.chunkKey)) {
            fullRegion.chunkKeys.push(entry.chunkKey);
          }
        }

        await this._worldStore.saveRegionRecord(rx, rz, fullRegion);
        this._regionCache.set(regionKey, this._stripBlockDataFromRegionRecord(fullRegion));
      }

      for (const entry of regionEntries) {
        this.pendingUnloadFlushQueue.delete(entry.chunkKey);
      }

      consumedRegionKeys.add(regionKey);
      processedRegions += 1;
      processedChunks += regionEntries.length;
    }

    const elapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
    const result = {
      processedChunks,
      processedRegions,
      remainingQueueSize: this.pendingUnloadFlushQueue.size,
      elapsedMs
    };
    this._updatePendingUnloadFlushStats(result);

    if (processedChunks > 0) {
      this._recordFlushPerf('world-runtime.background-flush', startedAt, {
        processedChunks,
        processedRegions,
        remainingQueueSize: this.pendingUnloadFlushQueue.size
      }, { allowObjectMetrics: false });
    }

    return result;
  }

  async flushAllPendingWork() {
    if (this._pendingUnloadFlushInFlight) {
      await this._pendingUnloadFlushInFlight;
    }
    return this.flushAllDirty();
  }

  getPendingUnloadFlushStats() {
    return {
      pendingUnloadFlushQueueSize: this.pendingUnloadFlushQueue.size,
      pendingUnloadFlushLastProcessedChunks: this._pendingUnloadFlushStats.lastProcessedChunks,
      pendingUnloadFlushLastProcessedRegions: this._pendingUnloadFlushStats.lastProcessedRegions,
      pendingUnloadFlushLastElapsedMs: this._pendingUnloadFlushStats.lastElapsedMs,
      pendingUnloadFlushLastProcessedAt: this._pendingUnloadFlushStats.lastProcessedAt
    };
  }

  // ============================================================
  // Region 缓存管理
  // ============================================================

  /**
   * 确保 region 已加载到缓存。
   * 注意：ensureChunkData() 已改为 chunk 级热路径，不再调用此方法。
   * ensureRegion() 仍服务于 region 级预取/完整缓存场景（如 expandWorld、flushAllDirty）。
   * _regionCache 可能同时包含完整 region（来自 ensureRegion）与部分 region（来自 ensureChunkData）。
   *
   * @param {number} rx
   * @param {number} rz
   * @returns {Promise<object|null>}
   */
  async ensureRegion(rx, rz) {
    const regionKey = this._regionKey(rx, rz);

    // 1. 缓存命中
    const cached = this._regionCache.get(regionKey);
    if (cached && !cached.__partial) return cached;

    // 2. 检查是否已有正在进行的请求
    const existingPromise = this._regionLoadPromises.get(regionKey);
    if (existingPromise) return existingPromise;

    // 3. 发起新请求
    const loadPromise = this._worldStore.getRegionRecord(rx, rz)
      .then((record) => {
        const cleaned = record ? this._stripBlockDataFromRegionRecord(record) : record;
        if (cleaned) {
          this._regionCache.set(regionKey, cleaned);
        }
        this._regionLoadPromises.delete(regionKey);
        return cleaned;
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

  _getCachedChunkRecord(cx, cz) {
    return this.getLoadedChunkData(cx, cz);
  }

  _resolveSerializedBlockData({
    explicitSnapshot = null,
    dirtyEntry = null,
    chunk = null,
    cachedChunkRecord = null,
    allowLiveChunk = true
  } = {}) {
    if (explicitSnapshot) {
      return {
        blockData: this._serializeBlockData(explicitSnapshot),
        source: explicitSnapshot instanceof Map ? 'explicit-map' : 'explicit-snapshot'
      };
    }

    // blockDataSnapshot 已退出 runtime 正确性链路
    // 旧 dirtyEntry.blockDataSnapshot 路径保留为 deferred compatibility fallback
    if (dirtyEntry?.blockDataSnapshot) {
      return {
        blockData: dirtyEntry.blockDataSnapshot,
        source: 'dirty-snapshot'
      };
    }

    if (dirtyEntry && cachedChunkRecord?.blockData) {
      return {
        blockData: cachedChunkRecord.blockData,
        source: 'region-cache'
      };
    }

    if (allowLiveChunk && chunk?.blockData) {
      return {
        blockData: this._serializeBlockData(chunk.blockData),
        source: 'live-chunk'
      };
    }

    if (cachedChunkRecord?.blockData) {
      return {
        blockData: cachedChunkRecord.blockData,
        source: 'region-cache'
      };
    }

    return {
      blockData: allowLiveChunk ? {} : null,
      source: allowLiveChunk ? 'empty' : 'missing-stable-snapshot'
    };
  }

  _resolveStaticEntities(chunk, cachedChunkRecord) {
    if (chunk?.staticEntities) {
      return [...chunk.staticEntities];
    }
    if (Array.isArray(cachedChunkRecord?.staticEntities)) {
      return [...cachedChunkRecord.staticEntities];
    }
    return [];
  }

  _resolveRuntimeSeedData(chunk, cachedChunkRecord) {
    if (chunk?.runtimeSeedData) {
      return chunk.runtimeSeedData;
    }
    if (chunk?.structureCenters) {
      return { structureCenters: chunk.structureCenters };
    }
    if (cachedChunkRecord?.runtimeSeedData) {
      return cachedChunkRecord.runtimeSeedData;
    }
    return { structureCenters: [] };
  }

  _getSerializedBlockMetrics(blockData) {
    if (!blockData) {
      return { blockCount: 0, serializedBytes: 2 };
    }

    const blockCount = Object.keys(blockData).length;
    if (!isChunkPerfDebugEnabled(globalThis)) {
      return { blockCount, serializedBytes: -1 };
    }

    let serializedBytes = -1;
    try {
      serializedBytes = JSON.stringify(blockData).length;
    } catch {
      serializedBytes = -1;
    }
    return { blockCount, serializedBytes };
  }

  _recordFlushPerf(label, startedAt, details = {}, options = {}) {
    const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
    const { blockData, ...restDetails } = details;
    let metrics = null;
    if (options.metricsReady) {
      metrics = {
        blockCount: restDetails.blockCount ?? 0,
        serializedBytes: restDetails.serializedBytes ?? -1
      };
    } else if (options.allowObjectMetrics === false) {
      metrics = {
        blockCount: Number.isFinite(restDetails.blockCount) ? restDetails.blockCount : -1,
        serializedBytes: -1
      };
    } else {
      metrics = this._getSerializedBlockMetrics(blockData);
    }

    recordChunkPerf(label, durationMs, {
      ...restDetails,
      blockCount: metrics.blockCount,
      serializedBytes: metrics.serializedBytes
    });
  }

  _ensureDirtyChunkEntry(cx, cz) {
    const key = this._chunkKey(cx, cz);
    if (!this._dirtyChunks.has(key)) {
      this._dirtyChunks.set(key, {
        cx,
        cz,
        dirty: true,
        pendingFlush: false,
        blockDataSnapshot: null
      });
    }
    return this._dirtyChunks.get(key);
  }

  _createChunkSnapshotFromWorld(cx, cz) {
    const chunk = this._world?.chunks?.get(this._chunkKey(cx, cz));
    return chunk?.blockData ? this._serializeBlockData(chunk.blockData) : {};
  }

  _cloneSerializedBlockData(blockData) {
    if (!blockData || typeof blockData !== 'object') return {};
    const clone = {};
    for (const [key, value] of Object.entries(blockData)) {
      if (value && typeof value === 'object') {
        clone[key] = { ...value };
      } else {
        clone[key] = value;
      }
    }
    return clone;
  }

  _cloneSerializable(value, fallback = null) {
    if (value === undefined || value === null) return fallback;
    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(value);
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  _updatePendingUnloadFlushStats(result = {}) {
    this._pendingUnloadFlushStats.lastProcessedChunks = Number.isFinite(result.processedChunks) ? result.processedChunks : 0;
    this._pendingUnloadFlushStats.lastProcessedRegions = Number.isFinite(result.processedRegions) ? result.processedRegions : 0;
    this._pendingUnloadFlushStats.lastElapsedMs = Number.isFinite(result.elapsedMs) ? result.elapsedMs : 0;
    this._pendingUnloadFlushStats.lastProcessedAt = globalThis.performance?.now?.() ?? Date.now();
  }

  _normalizeSerializedEntry(typeOrEntry) {
    if (!typeOrEntry) return null;
    if (typeof typeOrEntry === 'string') {
      return typeOrEntry === 'air' ? null : typeOrEntry;
    }
    if (typeof typeOrEntry === 'object') {
      return typeOrEntry.type === 'air'
        ? null
        : { type: typeOrEntry.type, orientation: typeOrEntry.orientation || 0 };
    }
    return null;
  }

  /**
   * @deprecated 已从 runtime 热路径解绑，仅保留供显式调用场景（retry on error、future manual save）。
   * markChunkDirty() 不再自动调度此方法。
   */
  _scheduleFlush(cx, cz, delayMs = 500) {
    this._callStats.scheduleFlush++;
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

      // 跳过已缓存或正在加载的（跳过完整缓存，部分缓存仍需预取）
      const cached = this._regionCache.get(regionKey);
      if (cached && !cached.__partial) continue;
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
      maxRegions: this._regionCache._maxRegions,
      callStats: { ...this._callStats }
    };
  }
}
