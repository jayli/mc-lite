// src/core/AOSystem.js
// 统一 AO（环境光遮蔽）计算与管理系统

import { calculateAOForBlock, isAOApplicable, packAOData, unpackAllAO } from '../utils/AOUtils.js';
import { getBlockProperties } from '../constants/BlockData.js';

/**
 * AO 系统类
 * 负责协调主线程与 Worker 之间的 AO 计算
 */
export class AOSystem {
  /**
   * 构造函数
   * @param {Worker} worker - Web Worker 引用（FaceCullingWorker 或 WorldWorker）
   */
  constructor(worker) {
    this.worker = worker;
    this.requestId = 0;
    this.pendingRequests = new Map();

    // 性能统计
    this.stats = {
      totalComputed: 0,           // 累计计算的方块数
      pendingRequests: 0,         // 待处理的请求数
      averageDuration: 0,         // 平均计算耗时 (ms)
      totalDuration: 0,           // 总计算耗时
      batchRequests: 0,           // 批量请求数
      incrementalRequests: 0,     // 增量请求数
      errors: 0                   // 错误计数
    };

    // 请求队列（用于批处理）
    this.batchQueue = [];
    this.batchQueueTimer = null;
    this.BATCH_DELAY_MS = 16; // 等待 16ms（一帧）来批量处理请求

    // 绑定 Worker 消息处理
    this._bindWorkerMessages();

    console.log('AOSystem initialized');
  }

  /**
   * 绑定 Worker 消息响应
   * @private
   */
  _bindWorkerMessages() {
    if (!this.worker) {
      console.warn('AOSystem: No worker provided, AO computation will be disabled');
      return;
    }

    this.worker.onmessage = (e) => {
      const { type, messageType, data, id, error } = e.data;

      if (type === 'AO_RESULT' || messageType === 'COMPUTE_AO_BATCH' || messageType === 'COMPUTE_AO_INCREMENTAL') {
        const request = this.pendingRequests.get(id);
        if (request) {
          const duration = performance.now() - request.startTime;
          this.stats.totalComputed += (data.aoData?.length || 0);
          this.stats.totalDuration += duration;
          this.stats.averageDuration = this.stats.totalDuration / (this.stats.batchRequests + this.stats.incrementalRequests);

          request.resolve({
            ...data,
            duration
          });
          this.pendingRequests.delete(id);
          this.stats.pendingRequests = this.pendingRequests.size;
        }
      } else if (type === 'AO_ERROR' || error) {
        const request = this.pendingRequests.get(id);
        if (request) {
          request.reject(new Error(error?.message || 'AO computation failed'));
          this.pendingRequests.delete(id);
          this.stats.errors++;
          this.stats.pendingRequests = this.pendingRequests.size;
        }
      }
    };
  }

  /**
   * 计算整个区块的 AO 数据（批量计算）
   * @param {Array} blocks - 方块数组 [{x, y, z, type}]
   * @param {Object} blockData - 完整的方块数据 {"x,y,z": "type"}
   * @param {number} cx - 区块 X 坐标
   * @param {number} cz - 区块 Z 坐标
   * @param {Array} worldChunks - 相邻区块数据（用于跨区块 AO 计算）
   * @returns {Promise<Object>} AO 计算结果
   */
  async computeChunkAO(blocks, blockData, cx, cz, worldChunks = []) {
    const requestId = ++this.requestId;

    // 过滤出需要 AO 计算的方块（仅实心且不透明的方块）
    const aoBlocks = blocks.filter(block => isAOApplicable(block.type));

    if (aoBlocks.length === 0) {
      return {
        aoData: [],
        affectedNeighbors: [],
        duration: 0,
        cx,
        cz
      };
    }

    return new Promise((resolve, reject) => {
      const request = {
        type: 'COMPUTE_AO_BATCH',
        id: requestId,
        data: {
          blocks: aoBlocks,
          blockData,
          cx,
          cz,
          worldChunks
        }
      };

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        startTime: performance.now()
      });

      this.stats.batchRequests++;
      this.stats.pendingRequests = this.pendingRequests.size;

      if (this.worker) {
        this.worker.postMessage(request);
      } else {
        // Fallback: 在主线程计算（仅用于调试或无 Worker 环境）
        const result = this._computeAOInMainThread(aoBlocks, blockData);
        resolve(result);
      }
    });
  }

  /**
   * 计算单个方块的 AO 数据（增量更新）
   * @param {Object} position - 方块位置 {x, y, z}
   * @param {'PLACE'|'DESTROY'} operation - 操作类型
   * @param {string} blockType - 方块类型（PLACE 操作时需要）
   * @param {Object} blockData - 局部方块数据 {"x,y,z": "type"}
   * @param {number} neighborhoodRadius - 邻居半径（默认 1）
   * @returns {Promise<Object>} AO 计算结果
   */
  async computeBlockAO(position, operation, blockType = '', blockData = {}, neighborhoodRadius = 1) {
    const requestId = ++this.requestId;

    return new Promise((resolve, reject) => {
      const request = {
        type: 'COMPUTE_AO_INCREMENTAL',
        id: requestId,
        data: {
          position,
          operation,
          blockType,
          neighborhoodRadius,
          blockData
        }
      };

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        startTime: performance.now()
      });

      this.stats.incrementalRequests++;
      this.stats.pendingRequests = this.pendingRequests.size;

      if (this.worker) {
        this.worker.postMessage(request);
      } else {
        // Fallback: 在主线程计算
        const result = this._computeIncrementalAOInMainThread(position, operation, blockType, blockData, neighborhoodRadius);
        resolve(result);
      }
    });
  }

  /**
   * 将 AO 数据应用到 InstancedMesh
   * @param {THREE.InstancedMesh} mesh - 实例化网格
   * @param {Array} aoData - AO 数据数组 [{x, y, z, aoLow, aoHigh}]
   * @param {Object} chunkData - 区块数据（包含方块位置映射）
   */
  applyToMesh(mesh, aoData, chunkData) {
    if (!mesh || !aoData || aoData.length === 0) return;

    // 获取或创建 AO 属性
    let aoLowAttr = mesh.getAttribute('aAoLow');
    let aoHighAttr = mesh.getAttribute('aAoHigh');
    let vertexIdAttr = mesh.getAttribute('aVertexId');

    const instanceCount = mesh.count;

    // 如果属性不存在，创建它们
    if (!aoLowAttr) {
      aoLowAttr = new THREE.BufferAttribute(new Float32Array(instanceCount), 1);
      mesh.setAttribute('aAoLow', aoLowAttr);
    }
    if (!aoHighAttr) {
      aoHighAttr = new THREE.BufferAttribute(new Float32Array(instanceCount), 1);
      mesh.setAttribute('aAoHigh', aoHighAttr);
    }
    if (!vertexIdAttr) {
      vertexIdAttr = new THREE.BufferAttribute(new Float32Array(instanceCount), 1);
      mesh.setAttribute('aVertexId', vertexIdAttr);
    }

    // 创建位置到 AO 数据的映射
    const aoMap = new Map();
    for (const ao of aoData) {
      const key = `${ao.x},${ao.y},${ao.z}`;
      aoMap.set(key, { aoLow: ao.aoLow, aoHigh: ao.aoHigh });
    }

    // 更新实例属性
    const aoLowArray = aoLowAttr.array;
    const aoHighArray = aoHighAttr.array;
    const vertexIdArray = vertexIdAttr.array;

    let needsUpdate = false;

    for (let i = 0; i < instanceCount; i++) {
      // 获取实例位置
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(i, matrix);
      const position = new THREE.Vector3();
      position.setFromMatrixPosition(matrix);

      // 查找对应的 AO 数据
      const key = `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`;
      const ao = aoMap.get(key);

      if (ao) {
        aoLowArray[i] = ao.aoLow;
        aoHighArray[i] = ao.aoHigh;
        vertexIdArray[i] = i; // 顶点 ID 用于 shader 解包
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      aoLowAttr.needsUpdate = true;
      aoHighAttr.needsUpdate = true;
      vertexIdAttr.needsUpdate = true;
    }
  }

  /**
   * 获取性能统计信息
   * @returns {Object} 性能统计
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置性能统计
   */
  resetStats() {
    this.stats = {
      totalComputed: 0,
      pendingRequests: 0,
      averageDuration: 0,
      totalDuration: 0,
      batchRequests: 0,
      incrementalRequests: 0,
      errors: 0
    };
  }

  /**
   * 清理资源
   */
  dispose() {
    // 取消所有待处理请求
    for (const [id, request] of this.pendingRequests.entries()) {
      request.reject(new Error('AOSystem disposed'));
    }
    this.pendingRequests.clear();

    // 清除批处理队列
    if (this.batchQueueTimer) {
      clearTimeout(this.batchQueueTimer);
      this.batchQueueTimer = null;
    }
    this.batchQueue = [];

    console.log('AOSystem disposed');
  }

  /**
   * 主线程 AO 计算（Fallback 实现）
   * @private
   */
  _computeAOInMainThread(blocks, blockData) {
    const startTime = performance.now();
    const aoData = [];
    const affectedNeighbors = [];

    // 创建 isOccluding 函数
    const isOccluding = (x, y, z) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      const type = blockData[key];
      if (!type) return false;
      const props = getBlockProperties(type);
      return !props.isTransparent;
    };

    for (const block of blocks) {
      if (isAOApplicable(block.type)) {
        const { aoLow, aoHigh } = calculateAOForBlock(block.x, block.y, block.z, isOccluding);
        aoData.push({
          x: block.x,
          y: block.y,
          z: block.z,
          type: block.type,
          aoLow,
          aoHigh
        });
      }
    }

    return {
      aoData,
      affectedNeighbors,
      duration: performance.now() - startTime
    };
  }

  /**
   * 主线程增量 AO 计算（Fallback 实现）
   * @private
   */
  _computeIncrementalAOInMainThread(position, operation, blockType, blockData, radius) {
    const startTime = performance.now();
    const aoData = [];
    const affectedNeighbors = [];

    const isOccluding = (x, y, z) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      const type = blockData[key];
      if (!type) return false;
      const props = getBlockProperties(type);
      return !props.isTransparent;
    };

    // 计算受影响的位置
    const affected = new Set();
    const { x, y, z } = position;

    // 如果是放置方块，计算该方块的 AO
    if (operation === 'PLACE' && isAOApplicable(blockType)) {
      affected.add(`${x},${y},${z}`);
    }

    // 计算邻居方块的 AO 更新
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;

          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          const key = `${nx},${ny},${nz}`;
          const type = blockData[key];

          if (type && isAOApplicable(type)) {
            affected.add(key);
          }
        }
      }
    }

    // 计算 AO
    for (const key of affected) {
      const [bx, by, bz] = key.split(',').map(Number);
      const type = blockData[key];

      if (type && isAOApplicable(type)) {
        const { aoLow, aoHigh } = calculateAOForBlock(bx, by, bz, isOccluding);
        aoData.push({ x: bx, y: by, z: bz, type, aoLow, aoHigh });
        affectedNeighbors.push({ x: bx, y: by, z: bz });
      }
    }

    return {
      aoData,
      affectedNeighbors,
      duration: performance.now() - startTime
    };
  }
}

// 导入 THREE.js（延迟导入，避免循环依赖）
import * as THREE from 'three';

// 导出单例（可选）
export const aoSystem = null; // 需要时由外部初始化
