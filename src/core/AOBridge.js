/**
 * AO Worker 桥接层 — 主线程侧
 *
 * 职责：
 * 1. 收集 blockData 的变更（delta），按发送时序排队
 * 2. 在 AO 计算请求前先 flush delta，确保 Worker 副本与权威数据一致
 * 3. 管理 chunk 全量同步（fullSync）和卸载通知（unloadChunk）
 *
 * 时序保证：
 * - 同一发送方的 postMessage 在 Worker 端按 FIFO 到达
 * - delta 消息一定在 computeAO 之前发送（_executeAORefresh 先调用 flush）
 * - Worker 端 deltaQueue 优先于 computeQueue 处理（双重保险）
 */

import { blockDataToNumberKeys } from '../utils/CoordEncoding.js';

class AOBridge {
  constructor() {
    this._worker = null;
    this._pendingDeltas = [];
    this._flushTimer = null;
    this._isWorkerReady = false;
  }

  /**
   * 初始化桥接层，绑定 Worker 引用
   * @param {Worker} worker - AO Worker 实例
   */
  init(worker) {
    this._worker = worker;
    this._isWorkerReady = true;
  }

  /**
   * 入队一个 blockData 变更（set 操作）
   * @param {string} chunkKey - chunk 标识 "cx,cz"
   * @param {number} code - 编码后的方块坐标
   * @param {*} entry - 方块条目
   */
  enqueueSet(chunkKey, code, entry) {
    if (!this._isWorkerReady) return;
    this._pendingDeltas.push({ chunkKey, code, op: 'set', entry });
    this._scheduleFlush();
  }

  /**
   * 入队一个 blockData 变更（delete 操作）
   * @param {string} chunkKey - chunk 标识 "cx,cz"
   * @param {number} code - 编码后的方块坐标
   */
  enqueueDelete(chunkKey, code) {
    if (!this._isWorkerReady) return;
    this._pendingDeltas.push({ chunkKey, code, op: 'delete', entry: null });
    this._scheduleFlush();
  }

  /**
   * 批量入队变更（removeBlocksBatch 等批量操作）
   * @param {Array<{chunkKey, code, op, entry}>} deltas
   */
  enqueueBatch(deltas) {
    if (!this._isWorkerReady || deltas.length === 0) return;
    this._pendingDeltas.push(...deltas);
    this._scheduleFlush();
  }

  /**
   * 全量同步 chunk 的 blockData（chunk 初次加载 / consolidation 后）
   * @param {string} chunkKey - chunk 标识 "cx,cz"
   * @param {Map} blockDataMap - blockData Map（权威数据源）
   */
  fullSync(chunkKey, blockDataMap) {
    if (!this._isWorkerReady) return;

    // 先 flush 积压的 delta，避免 fullSync 后残留旧 delta
    this._flush();

    const blockDataObj = blockDataToNumberKeys(blockDataMap);
    this._worker.postMessage({
      type: 'fullSync',
      chunkKey,
      blockData: blockDataObj
    });
  }

  /**
   * 通知 Worker 卸载 chunk（清理副本缓存）
   * @param {string} chunkKey - chunk 标识 "cx,cz"
   */
  unloadChunk(chunkKey) {
    if (!this._isWorkerReady) return;

    // 先 flush 积压的 delta，确保该 chunk 的最后变更已发送
    this._flush();

    this._worker.postMessage({
      type: 'unloadChunk',
      chunkKey
    });
  }

  /**
   * 立即 flush 所有积压的 delta 到 Worker
   * 在发送 computeAO 请求之前必须调用，确保 Worker 副本是最新的
   */
  flush() {
    this._flush();
  }

  // --- 内部方法 ---

  _flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }

    if (this._pendingDeltas.length === 0) return;

    const batch = this._pendingDeltas;
    this._pendingDeltas = [];

    this._worker.postMessage({
      type: 'syncDelta',
      batch
    });
  }

  _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flush();
    }, 16); // 1 帧后合并发送，避免高频单条 postMessage
  }

  /**
   * 销毁桥接层，清理定时器
   */
  destroy() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._pendingDeltas = [];
    this._worker = null;
    this._isWorkerReady = false;
  }
}

// 单例导出
export const aoBridge = new AOBridge();
