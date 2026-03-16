// src/core/AOSystem.js
// 统一 AO（环境光遮蔽）计算与管理系统

import * as THREE from 'three';
import { buildAODataForBlocks, calculateAOForBlock, isAOApplicable, packAOData, unpackAllAO } from '../utils/AOUtils.js';
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

    // AO 更新队列（带 debounce）
    this.aoUpdateQueue = [];
    this.aoUpdateTimer = null;
    this.AO_UPDATE_DEBOUNCE_MS = 100; // 100ms 缓冲，避免扎堆
    this.pendingMeshCallbacks = new Map(); // 存储 Mesh 回调 { requestId: { mesh, callback } }

    // 绑定 Worker 消息处理（如果提供了 worker）
    if (this.worker) {
      this._bindWorkerMessages();
    } else {
      console.warn('AOSystem: No worker provided on initialization, will be set later');
    }

    console.log('AOSystem initialized');
  }

  /**
   * 绑定 Worker 消息响应
   * @private
   */
  _bindWorkerMessages() {
    // 注意：WorkerManager 中已经接管了消息处理
    // 这个方法保留用于独立运行 AOSystem 的情况
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
   * 将 AO 数据应用到动态单体 Mesh
   * @param {THREE.Mesh} mesh - 单体网格
   * @param {number} aoLow - 低 12 个顶点的 AO 打包数据
   * @param {number} aoHigh - 高 12 个顶点的 AO 打包数据
   */
  applyToDynamicMesh(mesh, aoLow, aoHigh) {
    if (!mesh || !mesh.geometry) return;

    const count = mesh.geometry.attributes.position?.count || 0;
    if (count === 0) return;

    // 创建或更新 AO 属性
    const aoLowArray = new Float32Array(count);
    const aoHighArray = new Float32Array(count);
    aoLowArray.fill(aoLow);
    aoHighArray.fill(aoHigh);

    let aoLowAttr = mesh.geometry.getAttribute('aAoLow');
    let aoHighAttr = mesh.geometry.getAttribute('aAoHigh');

    if (!aoLowAttr) {
      mesh.geometry.setAttribute('aAoLow', new THREE.BufferAttribute(aoLowArray, 1));
    } else {
      aoLowAttr.array.set(aoLowArray);
      aoLowAttr.needsUpdate = true;
    }

    if (!aoHighAttr) {
      mesh.geometry.setAttribute('aAoHigh', new THREE.BufferAttribute(aoHighArray, 1));
    } else {
      aoHighAttr.array.set(aoHighArray);
      aoHighAttr.needsUpdate = true;
    }
  }

  /**
   * 计算并更新单个动态方块的 AO（直接同步方法）
   * @param {Object} position - 方块位置 {x, y, z}
   * @param {string} blockType - 方块类型
   * @param {Object} blockData - 周围方块数据
   * @param {THREE.Mesh} mesh - 要更新的 Mesh
   */
  updateDynamicMeshAO(position, blockType, blockData, mesh) {
    if (!this.worker || !mesh) return;

    const requestId = ++this.requestId;

    // 注册回调
    if (!this.pendingMeshCallbacks) this.pendingMeshCallbacks = new Map();
    this.pendingMeshCallbacks.set(requestId, {
      mesh: mesh,
      callback: (aoResult) => {
        this.applyToDynamicMesh(mesh, aoResult.aoLow, aoResult.aoHigh);
      }
    });

    const workerRequest = {
      type: 'COMPUTE_AO_INCREMENTAL',
      id: requestId,
      data: {
        position: position,
        operation: 'PLACE',
        blockType: blockType,
        neighborhoodRadius: 1,
        blockData: blockData
      }
    };

    this.stats.incrementalRequests++;
    this.worker.postMessage(workerRequest);
  }

  /**
   * 批量更新邻居 AO（用于批量删除后）
   * @param {Array} positions - 位置数组 [{x, y, z}]
   * @param {Object} blockData - 方块数据
   * @param {Object} chunk - 区块引用
   */
  scheduleNeighborAOUpdates(positions, blockData, chunk) {
    // 收集所有受影响的邻居方块
    const affectedPositions = new Set();

    for (const pos of positions) {
      const { x, y, z } = pos;
      // 添加周围 3x3x3 范围内的实心方块
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nx = x + dx, ny = y + dy, nz = z + dz;
            const key = `${nx},${ny},${nz}`;
            const type = blockData[key];
            if (type && isAOApplicable(type)) {
              affectedPositions.add(key);
            }
          }
        }
      }
    }

    // 对每个受影响的方块，更新其 AO
    for (const key of affectedPositions) {
      const [x, y, z] = key.split(',').map(Number);
      const mesh = chunk.dynamicMeshes?.get(key);
      if (mesh) {
        // 收集这个方块周围的 blockData
        const localBlockData = {};
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const nkey = `${x + dx},${y + dy},${z + dz}`;
              if (blockData[nkey]) {
                localBlockData[nkey] = blockData[nkey];
              }
            }
          }
        }

        this.updateDynamicMeshAO({ x, y, z }, blockData[key], localBlockData, mesh);
      }
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
    this.pendingMeshCallbacks.clear();

    // 清除批处理队列
    if (this.batchQueueTimer) {
      clearTimeout(this.batchQueueTimer);
      this.batchQueueTimer = null;
    }
    this.batchQueue = [];

    // 清除 AO 更新队列
    if (this.aoUpdateTimer) {
      clearTimeout(this.aoUpdateTimer);
      this.aoUpdateTimer = null;
    }
    this.aoUpdateQueue = [];

    console.log('AOSystem disposed');
  }

  /**
   * 主线程 AO 计算（Fallback 实现）
   * @private
   */
  _computeAOInMainThread(blocks, blockData) {
    const startTime = performance.now();
    const affectedNeighbors = [];

    // 创建 isOccluding 函数
    const isOccluding = (x, y, z) => {
      const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
      const type = blockData[key];
      if (!type) return false;
      const props = getBlockProperties(type);
      return !props.isTransparent;
    };

    const aoData = buildAODataForBlocks(blocks, isOccluding);

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
