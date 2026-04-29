// src/world/ShadowSyncDispatcher.js
/**
 * ShadowSyncDispatcher — 主线程变更收集器。
 *
 * 收集 ShadowStore 的变更，防抖后批量发送给 ShadowSyncWorker。
 * chunk 卸载时不触发即时 flush，ShadowStore 常驻内存。
 */

import { WorkerRpcClient } from '../services/WorkerRpcClient.js';
import { specialEntitiesShadowStore } from './SpecialEntitiesShadowStore.js';

const FLUSH_DELAY_MS = 500;

export class ShadowSyncDispatcher {
  constructor() {
    this._pending = new Set();
    this._flushTimer = null;
    this._rpc = null;
  }

  _ensureWorker() {
    if (this._rpc) return;
    this._rpc = new WorkerRpcClient(new URL('../workers/ShadowSyncWorker.js', import.meta.url));
  }

  /**
   * 标记 chunk 为脏，安排异步同步。
   */
  markDirty(cx, cz) {
    this._pending.add(`${cx},${cz}`);
    this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this._flush(), FLUSH_DELAY_MS);
  }

  async _flush() {
    if (this._pending.size === 0) return;
    const keys = [...this._pending];
    this._pending.clear();

    this._ensureWorker();

    const payloads = keys.map((key) => {
      const [cx, cz] = key.split(',').map(Number);
      return {
        key,
        data: specialEntitiesShadowStore.serializeChunk(cx, cz)
      };
    });

    try {
      const result = await this._rpc.postMessage('batchSync', { payloads });
      const failedKeys = result?.failedKeys || [];
      if (failedKeys.length > 0) {
        console.warn(`[ShadowSyncDispatcher] ${failedKeys.length} chunk(s) failed to sync:`, failedKeys);
        for (const key of failedKeys) {
          this._pending.add(key);
        }
        this._scheduleFlush();
      }
    } catch (error) {
      console.error('[ShadowSyncDispatcher] Flush failed:', error);
      // RPC 级别失败，所有 key 重入队
      for (const key of keys) {
        this._pending.add(key);
      }
      this._scheduleFlush();
    }
  }

  /**
   * 全量 flush（游戏退出时调用）。
   */
  async flushAll() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }

    // 先把 pending 的也 flush 掉
    if (this._pending.size > 0) {
      await this._flush();
    }

    this._ensureWorker();
    const allData = specialEntitiesShadowStore.getAllData();
    // 转换为普通对象
    const plainData = {};
    for (const [key, value] of allData) {
      plainData[key] = value;
    }

    try {
      const result = await this._rpc.postMessage('flushAll', { allData: plainData });
      const failedKeys = result?.failedKeys || [];
      if (failedKeys.length > 0) {
        console.error(`[ShadowSyncDispatcher] flushAll: ${failedKeys.length} chunk(s) failed to persist:`, failedKeys);
      }
    } catch (error) {
      console.error('[ShadowSyncDispatcher] flushAll failed:', error);
    }
  }

  /**
   * 启动时一次性迁移旧格式数据。
   */
  async startMigration() {
    this._ensureWorker();
    try {
      const result = await this._rpc.postMessage('migrateAll', {});
      console.log(`[ShadowSyncDispatcher] Migration complete: ${result?.migratedCount || 0} chunks migrated`);
    } catch (error) {
      console.error('[ShadowSyncDispatcher] Migration failed:', error);
    }
  }

  /**
   * 从 IndexedDB 加载指定 chunk 的实体数据。
   * @returns {Promise<{turrets:[], zombieNests:[], minecarts:[]}|null>}
   */
  async loadChunkEntities(cx, cz) {
    this._ensureWorker();
    const key = `${cx},${cz}`;
    try {
      const result = await this._rpc.postMessage('loadChunkEntities', { key });
      return result || null;
    } catch (error) {
      console.error(`[ShadowSyncDispatcher] Failed to load entities for chunk ${key}:`, error);
      return null;
    }
  }

  async dispose() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    // 退出前全量 flush，确保最后脏数据落盘
    if (this._pending.size > 0 || this._rpc) {
      await this.flushAll();
    }
    if (this._rpc) {
      this._rpc.worker?.terminate();
      this._rpc = null;
    }
  }
}

export const shadowSyncDispatcher = new ShadowSyncDispatcher();
