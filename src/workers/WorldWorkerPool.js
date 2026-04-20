/**
 * WorldWorkerPool — 多 Worker 池化管理
 *
 * 将原本单个 WorldWorker 替换为可配置的 Worker 池，支持：
 * - 空闲优先分配 + 轮询 fallback
 * - FIFO 排队（所有 Worker 忙时）
 * - 按 taskId 路由回调，支持回包乱序
 *
 * 对外 API 与单 Worker 兼容：postMessage(message)、onmessage、onerror。
 * 额外提供 registerCallback / unregisterCallback 用于回调注册。
 */

import { WorldWorkerPool } from './WorldWorkerPoolImpl.js';

// 默认池大小，可通过 globalThis.WORLD_WORKER_POOL_SIZE 覆盖
const DEFAULT_POOL_SIZE = typeof globalThis.WORLD_WORKER_POOL_SIZE === 'number'
  ? globalThis.WORLD_WORKER_POOL_SIZE
  : 3;

export const worldWorkerPool = new WorldWorkerPool(DEFAULT_POOL_SIZE);
export const worldWorker = worldWorkerPool;

/**
 * workerCallbacks 代理对象 — 对外保持 Map 接口
 *
 * 消费者通过 .set(key, fn) / .get(key) / .has(key) / .delete(key) 操作，
 * 实际转发到 pool 内部的 callbacks Map。这样 ChunkGenerator、ChunkConsolidation、
 * PlaygroundService 等文件无需改动 import 语句。
 */
export const workerCallbacks = {
  set(taskId, fn) { worldWorkerPool.registerCallback(taskId, fn); },
  get(taskId) { return worldWorkerPool.getCallback(taskId); },
  has(taskId) { return worldWorkerPool.hasCallback(taskId); },
  delete(taskId) { worldWorkerPool.unregisterCallback(taskId); return true; },
  clear() { worldWorkerPool.callbacks.clear(); },
  get size() { return worldWorkerPool.callbacks.size; },
  entries() { return worldWorkerPool.callbacks.entries(); },
  keys() { return worldWorkerPool.callbacks.keys(); },
  values() { return worldWorkerPool.callbacks.values(); },
  [Symbol.iterator]() { return worldWorkerPool.callbacks[Symbol.iterator](); },
  forEach(cb, thisArg) { worldWorkerPool.callbacks.forEach(cb, thisArg); }
};
