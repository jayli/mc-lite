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

// --- 依赖注入 ---
const getWorldStore = () => globalThis._worldStore || worldStore;

const REGION_SIZE_IN_CHUNKS = 8;

export class WorldRuntime {
  constructor(options = {}) {
    this._regionCache = new RegionCache(options.regionCache || {});
    this._dirtyChunks = new Map(); // "cx,cz" -> { cx, cz, dirty: true, pendingFlush: false }
    this._flushTimers = new Map(); // "cx,cz" -> timeout id
    this._world = null; // World 实例引用，在 World 初始化后注入
    this._regionSizeInChunks = REGION_SIZE_IN_CHUNKS;
    this._flushing = false;
  }

  /**
   * 注入 World 实例引用
   */
  setWorld(world) {
    this._world = world;
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
    const regionKey = this._regionKey(rx, rz);

    // 1. 尝试从 RegionCache 获取
    let region = this._regionCache.get(regionKey);

    // 2. 缓存未命中，从 WorldStore 读取
    if (!region) {
      region = await getWorldStore().getRegionRecord(rx, rz);
      if (region) {
        this._regionCache.set(regionKey, region);
      }
    }

    // 3. 从 RegionRecord 中切出目标 chunk
    if (!region || !region.chunks) {
      return { status: 'missing-region' };
    }
    const chunkKey = this._chunkKey(cx, cz);
    const chunkData = region.chunks[chunkKey];
    if (!chunkData) {
      return { status: 'missing-chunk' };
    }

    return {
      status: 'ready',
      chunkRecord: {
        cx,
        cz,
        blockData: chunkData.blockData || {},
        staticEntities: chunkData.staticEntities || [],
        runtimeSeedData: chunkData.runtimeSeedData || {}
      }
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
    return entry && entry.dirty;
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
  async flushChunk(cx, cz) {
    const key = this._chunkKey(cx, cz);
    const dirtyEntry = this._dirtyChunks.get(key);
    if (!dirtyEntry) return;
    this._clearScheduledFlush(cx, cz);

    // 获取当前 chunk 的 runtime blockData
    const chunk = this._world?.chunks?.get(key);
    if (!chunk || !chunk.blockData) return;

    try {
      dirtyEntry.pendingFlush = true;
      await getWorldStore().putChunkRecord(cx, cz, {
        blockData: this._serializeBlockData(chunk.blockData),
        staticEntities: chunk.staticEntities || [],
        runtimeSeedData: chunk.runtimeSeedData || {}
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
        group.chunks.set(key, {
          blockData: this._serializeBlockData(chunk.blockData),
          staticEntities: chunk.staticEntities || [],
          runtimeSeedData: chunk.runtimeSeedData || {}
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
          await getWorldStore().saveRegionRecord(group.rx, group.rz, region);
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
          await getWorldStore().saveRegionRecord(group.rx, group.rz, newRegion);
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
   */
  async flushBeforeUnload(cx, cz) {
    this._clearScheduledFlush(cx, cz);
    if (this.isChunkDirty(cx, cz)) {
      await this.flushChunk(cx, cz);
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
    let region = this._regionCache.get(regionKey);
    if (!region) {
      region = await getWorldStore().getRegionRecord(rx, rz);
      if (region) {
        this._regionCache.set(regionKey, region);
      }
    }
    return region;
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
