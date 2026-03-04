// src/core/WorkerManager.js
/**
 * Worker 管理器
 * 统一管理 Web Worker 实例和 AOSystem
 * 避免在多个模块中重复创建 Worker
 */

import { AOSystem } from './AOSystem.js';

// 创建 FaceCullingWorker 单例
export const faceCullingWorker = new Worker(
  new URL('../workers/FaceCullingWorker.js', import.meta.url),
  { type: 'module' }
);

// 回调映射（兼容 Chunk.js 的旧逻辑）
export const faceCullingCallbacks = new Map();

// 创建 AO 系统 - 先不设置 worker
const aoSys = new AOSystem(null);

// 唯一的消息处理器
faceCullingWorker.onmessage = (e) => {
  const { type, messageType, data, error, id } = e.data;

  // 1. 优先处理旧风格的 Chunk.js 回调
  if (type === 'RESULT' && faceCullingCallbacks.has(id)) {
    const callback = faceCullingCallbacks.get(id);
    faceCullingCallbacks.delete(id);
    callback(null, data);
    return;
  }

  if (type === 'ERROR' && faceCullingCallbacks.has(id)) {
    const callback = faceCullingCallbacks.get(id);
    faceCullingCallbacks.delete(id);
    callback(new Error(error), null);
    return;
  }

  // 2. 处理 AOSystem 的 pendingMeshCallbacks (动态 Mesh AO 更新)
  if (aoSys.pendingMeshCallbacks && aoSys.pendingMeshCallbacks.has(id)) {
    const callbackObj = aoSys.pendingMeshCallbacks.get(id);
    aoSys.pendingMeshCallbacks.delete(id);
    if (error) {
      console.warn('AO computation failed:', error);
      return;
    }
    if (data.aoData && data.aoData.length > 0) {
      callbackObj.callback(data.aoData[0]);
    }
    return;
  }

  // 3. 处理 AOSystem 的 pendingRequests (批量计算)
  if (type === 'RESULT' || messageType === 'COMPUTE_AO_BATCH' || messageType === 'COMPUTE_AO_INCREMENTAL') {
    const request = aoSys.pendingRequests?.get(id);
    if (request) {
      const duration = performance.now() - request.startTime;
      aoSys.stats.totalComputed += (data.aoData?.length || 0);
      aoSys.stats.totalDuration += duration;
      aoSys.stats.averageDuration = aoSys.stats.totalDuration / (aoSys.stats.batchRequests + aoSys.stats.incrementalRequests);

      request.resolve({ ...data, duration });
      aoSys.pendingRequests.delete(id);
      aoSys.stats.pendingRequests = aoSys.pendingRequests.size;
    }
    return;
  }

  if (type === 'ERROR' || error) {
    const request = aoSys.pendingRequests?.get(id);
    if (request) {
      request.reject(new Error(error?.message || 'AO computation failed'));
      aoSys.pendingRequests.delete(id);
      aoSys.stats.errors++;
      aoSys.stats.pendingRequests = aoSys.pendingRequests.size;
    }
  }
};

// 错误处理
faceCullingWorker.onerror = (e) => {
  console.error('FaceCullingWorker Error:', e);
  console.error('Error details:', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: e.error
  });
};

// 设置 worker 引用
aoSys.worker = faceCullingWorker;

export const aoSystem = aoSys;

// 全局访问（用于调试）
if (typeof window !== 'undefined') {
  window.faceCullingWorker = faceCullingWorker;
  window.aoSystem = aoSystem;
}
