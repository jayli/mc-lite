// src/core/FaceCullingSystem.js
/**
 * 隐藏面剔除系统
 * 负责计算和管理方块可见面状态，优化渲染性能
 * 使用位掩码存储每个方块的六个面可见性状态
 */

import * as THREE from 'three';
import { faceMask, countVisibleFaces } from './face-culling-utils.js';

/**
 * 隐藏面剔除系统类
 * 管理所有方块的可见面状态计算和更新
 */
export class FaceCullingSystem {
  /**
   * 构造函数
   * @param {Object} config - 系统配置
   */
  constructor(config = {}) {
    // 系统状态
    this.enabled = config.enabled !== false; // 默认启用
    this.debugMode = config.debugMode || false;

    // 透明方块类型集合
    this.transparentTypes = new Set(config.transparentTypes || [
      'air', 'water', 'glass_block', 'glass_blink', 'collider'
    ]);

    // 性能统计
    this.stats = {
      enabled: this.enabled,
      debugMode: this.debugMode,
      totalBlocksProcessed: 0,
      facesCulled: 0,
      facesRendered: 0,
      optimizationRate: 0,
      updateTime: 0,
      lastUpdateTime: 0,
      errorCount: 0,
      lastError: null,
      isDegraded: false,
      degradeReason: null
    };

    // 事件系统
    this.eventListeners = new Map();

    // 缓存
    this.neighborCache = new Map();
    this.chunkCache = new Map();

    // 调试可视化
    this.debugObjects = new Map();
    this.debugScene = null;

    // 配置参数
    this.config = {
      updateThreshold: config.updateThreshold || 16, // 更新阈值 (ms)：单次更新逻辑允许占用的最大时间，防止造成掉帧 (16ms 对应 60FPS)
      errorLimit: config.errorLimit || 10,           // 错误限制：系统连续发生错误的上限，超过此值将自动禁用系统以保证游戏稳定性
      batchSize: config.batchSize || 64,             // 批量大小：单词处理方块的数量，用于分片执行长任务
      cacheNeighbors: config.cacheNeighbors !== false, // 是否缓存相邻方块信息，平衡内存与计算开销
      lazyUpdate: config.lazyUpdate !== false,       // 懒更新：仅在方块数据发生变化时才重新计算
      performanceMonitoring: config.performanceMonitoring !== false, // 性能监控开关
      monitoringInterval: config.monitoringInterval || 5000, // 性能快照记录间隔 (ms)
      ...config
    };

    // 性能监控
    this.performanceHistory = [];
    this.maxHistorySize = 100;
    this.monitoringInterval = null;

    if (this.config.performanceMonitoring) {
      this.startPerformanceMonitoring();
    }

    console.log('FaceCullingSystem initialized', {
      enabled: this.enabled,
      transparentTypes: Array.from(this.transparentTypes)
    });
  }

  /**
   * 启用系统
   */
  enable() {
    if (this.enabled) return;

    this.enabled = true;
    this.stats.enabled = true;
    this.stats.isDegraded = false;
    this.stats.degradeReason = null;

    this.emit('enabled');
    console.log('FaceCullingSystem enabled');
  }

  /**
   * 禁用系统
   * @param {string} reason - 禁用原因
   */
  disable(reason = 'manual') {
    if (!this.enabled) return;

    this.enabled = false;
    this.stats.enabled = false;
    this.stats.isDegraded = true;
    this.stats.degradeReason = reason;

    // 清理调试对象
    this.clearDebugObjects();

    this.emit('disabled', { reason });
    console.log('FaceCullingSystem disabled:', reason);
  }

  /**
   * 检查系统是否启用
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * 设置透明方块类型列表
   * @param {string[]} types - 透明方块类型数组
   */
  setTransparentTypes(types) {
    this.transparentTypes = new Set(types);
    this.clearCaches();
    console.log('Transparent types updated:', Array.from(this.transparentTypes));
  }

  /**
   * 添加透明方块类型
   * @param {string} type - 方块类型
   */
  addTransparentType(type) {
    this.transparentTypes.add(type);
    this.clearCaches();
    console.log('Transparent type added:', type);
  }

  /**
   * 移除透明方块类型
   * @param {string} type - 方块类型
   */
  removeTransparentType(type) {
    this.transparentTypes.delete(type);
    this.clearCaches();
    console.log('Transparent type removed:', type);
  }

  /**
   * 获取透明方块类型列表
   * @returns {string[]}
   */
  getTransparentTypes() {
    return Array.from(this.transparentTypes);
  }

  /**
   * 检查方块是否为透明
   * @param {string} blockType - 方块类型
   * @returns {boolean}
   */
  isTransparent(blockType) {
    return this.transparentTypes.has(blockType);
  }

  /**
   * 计算单个方块的可见面位掩码
   * 通过检查六个相邻位置是否存在不透明方块来确定每个面是否需要渲染
   * @param {Object} block - 方块对象
   * @param {Object} neighbors - 相邻方块对象 (top, bottom, north, south, west, east)
   * @returns {number} 位掩码 (0-63)，每一位对应一个面的可见性
   */
  calculateFaceVisibility(block, neighbors) {
    if (!this.enabled) return faceMask.ALL; // 系统禁用时，默认所有面都可见

    // 透明方块的所有面都可见
    if (this.isTransparent(block.type)) {
      return faceMask.ALL;
    }

    let mask = 0;

    // 检查六个方向，如果相邻方向没有遮挡（或是透明方块），则设置对应位的掩码为可见
    if (this.shouldShowFace(block, neighbors.top)) mask |= faceMask.TOP;
    if (this.shouldShowFace(block, neighbors.bottom)) mask |= faceMask.BOTTOM;
    if (this.shouldShowFace(block, neighbors.north)) mask |= faceMask.NORTH;
    if (this.shouldShowFace(block, neighbors.south)) mask |= faceMask.SOUTH;
    if (this.shouldShowFace(block, neighbors.west)) mask |= faceMask.WEST;
    if (this.shouldShowFace(block, neighbors.east)) mask |= faceMask.EAST;

    return mask;
  }

  /**
   * 判断是否应该显示面
   * @param {Object} currentBlock - 当前方块
   * @param {Object|null} neighborBlock - 相邻方块
   * @returns {boolean}
   */
  shouldShowFace(currentBlock, neighborBlock) {
    // 没有相邻方块（空气）-> 面可见
    if (!neighborBlock) return true;

    // 相邻方块是透明的 -> 面可见
    if (this.isTransparent(neighborBlock.type)) return true;

    // 相邻方块是固体的 -> 面隐藏
    return false;
  }

  /**
   * 更新整个区块的可见面状态
   * @param {Object} chunk - 区块对象
   */
  updateChunk(chunk) {
    if (!this.enabled) return;

    const startTime = performance.now();

    try {
      if (this.debugMode) {
        console.log('Updating chunk:', { cx: chunk.cx, cz: chunk.cz });
      }

      // 检查区块是否已缓存
      const chunkKey = `${chunk.cx},${chunk.cz}`;
      if (this.chunkCache.has(chunkKey) && this.config.lazyUpdate) {
        if (this.debugMode) console.log('Chunk already cached, skipping update');
        return;
      }

      // 这里需要访问区块的方块数据
      // 实际实现将在后续任务中与Chunk.js集成时完成
      // 临时模拟计算
      const blockCount = 16 * 16 * 256; // 区块大小
      let facesCulled = 0;
      let facesRendered = 0;

      // 模拟计算（实际实现将遍历所有方块）
      for (let i = 0; i < Math.min(blockCount, 1000); i++) {
        // 模拟：大约50%的面被剔除
        const culled = Math.random() > 0.5;
        if (culled) {
          facesCulled += 6; // 假设所有面都被剔除
        } else {
          facesRendered += 6; // 假设所有面都渲染
        }
      }

      // 更新统计
      this.stats.totalBlocksProcessed += Math.min(blockCount, 1000);
      this.stats.facesCulled += facesCulled;
      this.stats.facesRendered += facesRendered;

      // 缓存区块
      this.chunkCache.set(chunkKey, {
        cx: chunk.cx,
        cz: chunk.cz,
        facesCulled,
        facesRendered,
        lastUpdated: Date.now()
      });

      const endTime = performance.now();
      this.stats.updateTime = endTime - startTime;
      this.stats.lastUpdateTime = Date.now();

      if (this.debugMode) {
        console.log(`Chunk update completed in ${this.stats.updateTime.toFixed(2)}ms`, {
          blocks: Math.min(blockCount, 1000),
          facesCulled,
          facesRendered,
          optimizationRate: this.stats.optimizationRate.toFixed(3)
        });
      }

      this.emit('update', { ...this.stats });

    } catch (error) {
      this.handleError('updateChunk', error);
    }
  }

  /**
   * 更新单个方块及其相邻方块的可见面状态
   * @param {THREE.Vector3} position - 方块世界坐标
   * @param {Object} block - 方块对象（必须包含type属性）
   * @param {Object} neighbors - 相邻方块对象（六个方向）
   */
  updateBlock(position, block, neighbors) {
    if (!this.enabled) return;

    try {
      if (this.debugMode) {
        console.log('Updating block at:', position, 'type:', block?.type);
      }

      // 计算可见面状态
      const faceMask = this.calculateFaceVisibility(block, neighbors);

      // 这里应该将可见面状态存储到方块数据中
      // 实际存储逻辑将在与Chunk.js集成时实现

      // 更新调试可视化（如果启用）
      if (this.debugMode && this.debugScene) {
        const blockId = `${position.x},${position.y},${position.z}`;
        this.addDebugBlock(blockId, position, faceMask);
      }

      // 更新统计
      const visibleFaces = countVisibleFaces(faceMask);
      const hiddenFaces = 6 - visibleFaces;
      this.stats.facesRendered += visibleFaces;
      this.stats.facesCulled += hiddenFaces;
      this.stats.totalBlocksProcessed += 1;

      if (this.debugMode) {
        console.log(`方块更新完成，可见面: ${visibleFaces}, 隐藏面: ${hiddenFaces}。系统累计隐藏面数: ${this.stats.facesCulled}`);
      }

      // 触发事件
      this.emit('blockUpdated', { position, block, faceMask, visibleFaces, hiddenFaces });

    } catch (error) {
      this.handleError('updateBlock', error);
    }
  }

  /**
   * 更新指定位置周围6个相邻方块的可见面状态
   * @param {THREE.Vector3} position - 中心位置
   * @param {Function} getBlockData - 获取方块数据的函数，接收位置参数，返回{block, neighbors}或null
   */
  updateNeighbors(position, getBlockData = null) {
    if (!this.enabled) return;

    try {
      if (this.debugMode) {
        console.log('Updating neighbors around:', position);
      }

      // 如果没有提供获取方块数据的函数，无法继续
      if (!getBlockData) {
        if (this.debugMode) console.warn('updateNeighbors: 需要提供getBlockData函数来获取方块数据');
        return;
      }

      // 六个方向
      const directions = [
        { name: 'top', mask: faceMask.TOP, offset: new THREE.Vector3(0, 1, 0) },
        { name: 'bottom', mask: faceMask.BOTTOM, offset: new THREE.Vector3(0, -1, 0) },
        { name: 'north', mask: faceMask.NORTH, offset: new THREE.Vector3(0, 0, -1) },
        { name: 'south', mask: faceMask.SOUTH, offset: new THREE.Vector3(0, 0, 1) },
        { name: 'west', mask: faceMask.WEST, offset: new THREE.Vector3(-1, 0, 0) },
        { name: 'east', mask: faceMask.EAST, offset: new THREE.Vector3(1, 0, 0) }
      ];

      let updatedCount = 0;

      for (const dir of directions) {
        const neighborPos = position.clone().add(dir.offset);
        const blockData = getBlockData(neighborPos);

        if (blockData && blockData.block && blockData.neighbors) {
          this.updateBlock(neighborPos, blockData.block, blockData.neighbors);
          updatedCount++;
        }
      }

      if (this.debugMode) {
        console.log(`更新了 ${updatedCount} 个相邻方块`);
      }

      // 触发事件
      this.emit('neighborsUpdated', { position, updatedCount });

    } catch (error) {
      this.handleError('updateNeighbors', error);
    }
  }

  /**
   * 批量更新多个方块的可见面状态
   * @param {THREE.Vector3[]} positions - 位置数组
   * @param {Function} getBlockData - 获取方块数据的函数，接收位置参数，返回{block, neighbors}或null
   */
  batchUpdate(positions, getBlockData = null) {
    if (!this.enabled) return;

    try {
      console.log('Batch updating', positions.length, 'blocks');

      // 如果没有提供获取方块数据的函数，无法继续
      if (!getBlockData) {
        console.warn('batchUpdate: 需要提供getBlockData函数来获取方块数据');
        return;
      }

      let updatedCount = 0;
      let errorCount = 0;

      for (const position of positions) {
        try {
          const blockData = getBlockData(position);
          if (blockData && blockData.block && blockData.neighbors) {
            this.updateBlock(position, blockData.block, blockData.neighbors);
            updatedCount++;
          }
        } catch (error) {
          errorCount++;
          console.error(`批量更新错误 at ${position}:`, error);
        }
      }

      console.log(`批量更新完成，成功: ${updatedCount}, 错误: ${errorCount}`);

      // 触发事件
      this.emit('batchUpdated', { total: positions.length, updated: updatedCount, errors: errorCount });

    } catch (error) {
      this.handleError('batchUpdate', error);
    }
  }

  /**
   * 强制重新计算所有加载区块的可见面状态
   * @param {Function} getChunksData - 获取所有区块数据的函数，返回区块数组
   */
  forceUpdate(getChunksData = null) {
    if (!this.enabled) return;

    try {
      console.log('Force updating all chunks');

      // 如果没有提供获取区块数据的函数，无法继续
      if (!getChunksData) {
        console.warn('forceUpdate: 需要提供getChunksData函数来获取区块数据');
        return;
      }

      const chunks = getChunksData();
      if (!Array.isArray(chunks)) {
        console.error('forceUpdate: getChunksData必须返回数组');
        return;
      }

      let chunkCount = 0;
      let blockCount = 0;

      for (const chunk of chunks) {
        if (chunk && typeof chunk === 'object') {
          this.updateChunk(chunk);
          chunkCount++;
          // 假设updateChunk会更新统计信息
        }
      }

      console.log(`强制更新完成，处理区块: ${chunkCount}`);

      // 触发事件
      this.emit('forceUpdated', { chunks: chunkCount });

    } catch (error) {
      this.handleError('forceUpdate', error);
    }
  }

  /**
   * 切换调试模式
   */
  toggleDebug() {
    this.debugMode = !this.debugMode;
    this.stats.debugMode = this.debugMode;

    if (this.debugMode) {
      console.log('Debug mode enabled');
    } else {
      this.clearDebugObjects();
      console.log('Debug mode disabled');
    }
  }

  /**
   * 设置调试模式
   * @param {boolean} enabled - 是否启用调试模式
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.stats.debugMode = enabled;

    if (!enabled) {
      this.clearDebugObjects();
    }

    console.log('Debug mode set to:', enabled);
  }

  /**
   * 检查是否处于调试模式
   * @returns {boolean}
   */
  isDebugMode() {
    return this.debugMode;
  }

  /**
   * 获取性能统计信息
   * @returns {Object}
   */
  getStats() {
    // 计算优化率
    const totalFaces = this.stats.facesCulled + this.stats.facesRendered;
    this.stats.optimizationRate = totalFaces > 0 ? this.stats.facesCulled / totalFaces : 0;

    // 计算性能评分
    this.stats.performanceScore = this.calculatePerformanceScore();

    // 计算内存使用
    this.stats.memoryUsage = this.calculateMemoryUsage();

    return { ...this.stats };
  }

  /**
   * 计算性能评分
   * @returns {number} 性能评分 (0-100)
   */
  calculatePerformanceScore() {
    let score = 100;

    // 基于优化率评分
    if (this.stats.optimizationRate < 0.3) {
      score -= 30; // 优化率低于30%，扣30分
    } else if (this.stats.optimizationRate > 0.7) {
      score += 20; // 优化率高于70%，加20分
    }

    // 基于更新时间评分
    if (this.stats.updateTime > 16) {
      score -= 40; // 更新时间超过16ms（60FPS的一帧），扣40分
    } else if (this.stats.updateTime < 5) {
      score += 20; // 更新时间小于5ms，加20分
    }

    // 基于错误率评分
    if (this.stats.errorCount > 10) {
      score -= 30; // 错误数超过10，扣30分
    }

    // 确保分数在0-100范围内
    return Math.max(0, Math.min(100, score));
  }

  /**
   * 计算内存使用
   * @returns {Object} 内存使用信息
   */
  calculateMemoryUsage() {
    // 计算缓存内存使用
    let cacheMemory = 0;

    // 邻居缓存
    cacheMemory += this.neighborCache.size * 100; // 估算每个条目100字节

    // 区块缓存
    cacheMemory += this.chunkCache.size * 200; // 估算每个条目200字节

    // 调试对象内存
    cacheMemory += this.debugObjects.size * 500; // 估算每个调试对象500字节

    // 系统自身内存
    const systemMemory = 1024 * 10; // 估算系统自身10KB

    const totalMemory = cacheMemory + systemMemory;

    return {
      cacheMemory: Math.round(cacheMemory / 1024), // KB
      systemMemory: Math.round(systemMemory / 1024), // KB
      totalMemory: Math.round(totalMemory / 1024), // KB
      cacheEntries: this.neighborCache.size + this.chunkCache.size,
      debugObjects: this.debugObjects.size
    };
  }

  /**
   * 重置性能统计
   */
  resetStats() {
    this.stats.totalBlocksProcessed = 0;
    this.stats.facesCulled = 0;
    this.stats.facesRendered = 0;
    this.stats.optimizationRate = 0;
    this.stats.updateTime = 0;
    this.stats.errorCount = 0;
    this.stats.lastError = null;

    console.log('Statistics reset');
  }

  /**
   * 获取最后错误信息
   * @returns {string|null}
   */
  getLastError() {
    return this.stats.lastError;
  }

  /**
   * 获取错误计数
   * @returns {number}
   */
  getErrorCount() {
    return this.stats.errorCount;
  }

  /**
   * 清除错误记录
   */
  clearErrors() {
    this.stats.errorCount = 0;
    this.stats.lastError = null;

    console.log('Errors cleared');
  }

  /**
   * 事件监听
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * 移除事件监听
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  off(event, callback) {
    if (!this.eventListeners.has(event)) return;

    const listeners = this.eventListeners.get(event);
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * 触发事件
   * @param {string} event - 事件名称
   * @param {any} data - 事件数据
   */
  emit(event, data = null) {
    if (!this.eventListeners.has(event)) return;

    const listeners = this.eventListeners.get(event);
    for (const callback of listeners) {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    }
  }

  /**
   * 处理错误
   * @param {string} context - 错误上下文
   * @param {Error} error - 错误对象
   */
  handleError(context, error) {
    this.stats.errorCount++;
    this.stats.lastError = `${context}: ${error.message}`;

    console.error(`FaceCullingSystem error (${context}):`, error);

    // 检查是否需要降级
    if (this.stats.errorCount >= this.config.errorLimit) {
      this.disable(`error limit exceeded (${this.stats.errorCount} errors)`);
    }

    this.emit('error', {
      error: error.message,
      count: this.stats.errorCount,
      context
    });
  }

  /**
   * 获取区块的相邻区块信息
   * @param {Object} chunk - 区块对象
   * @param {Map} worldChunks - 世界区块映射
   * @returns {Object} 相邻区块信息
   */
  getChunkNeighbors(chunk, worldChunks) {
    const neighbors = {
      north: null, // Z-1
      south: null, // Z+1
      west: null,  // X-1
      east: null   // X+1
    };

    if (!worldChunks) return neighbors;

    // 获取相邻区块
    const northKey = `${chunk.cx},${chunk.cz - 1}`;
    const southKey = `${chunk.cx},${chunk.cz + 1}`;
    const westKey = `${chunk.cx - 1},${chunk.cz}`;
    const eastKey = `${chunk.cx + 1},${chunk.cz}`;

    if (worldChunks.has(northKey)) neighbors.north = worldChunks.get(northKey);
    if (worldChunks.has(southKey)) neighbors.south = worldChunks.get(southKey);
    if (worldChunks.has(westKey)) neighbors.west = worldChunks.get(westKey);
    if (worldChunks.has(eastKey)) neighbors.east = worldChunks.get(eastKey);

    return neighbors;
  }

  /**
   * 计算区块边界方块的可见面状态
   * @param {Object} chunk - 当前区块
   * @param {Object} neighborChunk - 相邻区块
   * @param {string} direction - 方向 ('north', 'south', 'west', 'east')
   * @returns {Object} 边界方块可见面状态
   */
  calculateChunkBorderFaces(chunk, neighborChunk, direction) {
    // 这里需要实现跨区块边界计算
    // 实际实现将在后续任务中完成
    console.log(`Calculating border faces for direction: ${direction}`);

    return {
      direction,
      chunkKey: `${chunk.cx},${chunk.cz}`,
      neighborKey: neighborChunk ? `${neighborChunk.cx},${neighborChunk.cz}` : 'none',
      facesCalculated: 0
    };
  }

  /**
   * 批量计算区块内所有方块的可见面状态
   * @param {Object} chunk - 区块对象
   * @param {Object} chunkData - 区块方块数据
   * @returns {Uint8Array} 可见面状态数组
   */
  calculateChunkFaceData(chunk, chunkData) {
    const CHUNK_SIZE = 16;
    const CHUNK_HEIGHT = 256;
    const totalBlocks = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;

    // 创建Uint8Array存储可见面状态（每个方块1字节）
    const faceData = new Uint8Array(totalBlocks);

    console.log(`Calculating face data for chunk ${chunk.cx},${chunk.cz}`, {
      totalBlocks,
      dataSize: faceData.length,
      memory: (faceData.length / 1024).toFixed(2) + 'KB'
    });

    // 这里需要实现实际的遍历计算
    // 实际实现将在后续任务中完成

    return faceData;
  }

  /**
   * 清理缓存
   */
  clearCaches() {
    this.neighborCache.clear();
    this.chunkCache.clear();
    console.log('Caches cleared');
  }

  /**
   * 初始化调试场景
   * @param {THREE.Scene} scene - Three.js场景
   */
  initDebugScene(scene) {
    this.debugScene = scene;
    console.log('Debug scene initialized');
  }

  /**
   * 创建调试可视化对象
   * @param {THREE.Vector3} position - 位置
   * @param {number} faceMask - 面位掩码
   * @returns {THREE.Object3D} 调试对象
   */
  createDebugVisualization(position, faceMask) {
    const group = new THREE.Group();
    group.position.copy(position);

    // 创建面可视化
    const faceGeometry = new THREE.PlaneGeometry(0.9, 0.9);
    const visibleMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const hiddenMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide
    });

    // 六个面的位置和旋转
    const faceConfigs = [
      { mask: faceMask.TOP, position: [0, 0.5, 0], rotation: [0, 0, 0] },
      { mask: faceMask.BOTTOM, position: [0, -0.5, 0], rotation: [Math.PI, 0, 0] },
      { mask: faceMask.NORTH, position: [0, 0, -0.5], rotation: [0, Math.PI / 2, 0] },
      { mask: faceMask.SOUTH, position: [0, 0, 0.5], rotation: [0, -Math.PI / 2, 0] },
      { mask: faceMask.WEST, position: [-0.5, 0, 0], rotation: [0, 0, Math.PI / 2] },
      { mask: faceMask.EAST, position: [0.5, 0, 0], rotation: [0, 0, -Math.PI / 2] }
    ];

    for (const config of faceConfigs) {
      const isVisible = (faceMask & config.mask) !== 0;
      const material = isVisible ? visibleMaterial : hiddenMaterial;

      const faceMesh = new THREE.Mesh(faceGeometry, material);
      faceMesh.position.set(...config.position);
      faceMesh.rotation.set(...config.rotation);

      // 添加标签
      const label = this.createFaceLabel(config.mask, isVisible);
      label.position.set(config.position[0], config.position[1] + 0.1, config.position[2]);
      faceMesh.add(label);

      group.add(faceMesh);
    }

    // 添加中心点
    const centerGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    group.add(center);

    return group;
  }

  /**
   * 创建面标签
   * @param {number} face - 面位掩码
   * @param {boolean} isVisible - 是否可见
   * @returns {THREE.Object3D} 标签对象
   */
  createFaceLabel(face, isVisible) {
    // 创建文本精灵（简化版，实际可以使用TextGeometry或CSS2DRenderer）
    const geometry = new THREE.PlaneGeometry(0.2, 0.1);
    const material = new THREE.MeshBasicMaterial({
      color: isVisible ? 0x00ff00 : 0xff0000,
      transparent: true,
      opacity: 0.8
    });

    const label = new THREE.Mesh(geometry, material);

    // 添加文本（这里使用简单几何体，实际项目可以使用更高级的文本渲染）
    const faceName = this.getFaceName(face);
    label.userData = { face: faceName, visible: isVisible };

    return label;
  }

  /**
   * 获取面名称
   * @param {number} face - 面位掩码
   * @returns {string} 面名称
   */
  getFaceName(face) {
    const names = {
      [faceMask.TOP]: '上',
      [faceMask.BOTTOM]: '下',
      [faceMask.NORTH]: '北',
      [faceMask.SOUTH]: '南',
      [faceMask.WEST]: '西',
      [faceMask.EAST]: '东'
    };
    return names[face] || '未知';
  }

  /**
   * 添加调试方块
   * @param {string} id - 标识符
   * @param {THREE.Vector3} position - 位置
   * @param {number} faceMask - 面位掩码
   */
  addDebugBlock(id, position, faceMask) {
    if (!this.debugMode || !this.debugScene) return;

    const debugObj = this.createDebugVisualization(position, faceMask);
    this.debugObjects.set(id, debugObj);
    this.debugScene.add(debugObj);

    console.log('Debug block added:', { id, position, faceMask });
  }

  /**
   * 更新调试方块
   * @param {string} id - 标识符
   * @param {number} faceMask - 新面位掩码
   */
  updateDebugBlock(id, faceMask) {
    if (!this.debugMode || !this.debugScene) return;

    const debugObj = this.debugObjects.get(id);
    if (debugObj) {
      this.debugScene.remove(debugObj);
      const newObj = this.createDebugVisualization(debugObj.position, faceMask);
      this.debugObjects.set(id, newObj);
      this.debugScene.add(newObj);

      console.log('Debug block updated:', { id, faceMask });
    }
  }

  /**
   * 移除调试方块
   * @param {string} id - 标识符
   */
  removeDebugBlock(id) {
    if (!this.debugScene) return;

    const debugObj = this.debugObjects.get(id);
    if (debugObj) {
      this.debugScene.remove(debugObj);
      this.debugObjects.delete(id);
      console.log('Debug block removed:', id);
    }
  }

  /**
   * 清理调试对象
   */
  clearDebugObjects() {
    if (this.debugScene) {
      for (const obj of this.debugObjects.values()) {
        this.debugScene.remove(obj);
      }
    }
    this.debugObjects.clear();
    console.log('Debug objects cleared');
  }

  /**
   * 创建性能面板可视化
   * @returns {THREE.Object3D} 性能面板对象
   */
  createPerformancePanel() {
    const panel = new THREE.Group();
    panel.position.set(5, 5, -10); // 放在相机前方右侧

    // 创建面板背景
    const backgroundGeometry = new THREE.PlaneGeometry(4, 3);
    const backgroundMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.7
    });
    const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
    panel.add(background);

    // 这里可以添加文本和图表
    // 实际实现可以使用CSS2DRenderer或自定义着色器

    return panel;
  }

  /**
   * 开始性能监控
   */
  startPerformanceMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.recordPerformanceSnapshot();
    }, this.config.monitoringInterval);

    console.log('性能监控已启动，间隔:', this.config.monitoringInterval, 'ms');
  }

  /**
   * 停止性能监控
   */
  stopPerformanceMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    console.log('性能监控已停止');
  }

  /**
   * 记录性能快照
   */
  recordPerformanceSnapshot() {
    const stats = this.getStats();
    const snapshot = {
      timestamp: Date.now(),
      optimizationRate: stats.optimizationRate,
      updateTime: stats.updateTime,
      performanceScore: stats.performanceScore,
      totalBlocksProcessed: stats.totalBlocksProcessed,
      facesCulled: stats.facesCulled,
      facesRendered: stats.facesRendered,
      errorCount: stats.errorCount,
      memoryUsage: stats.memoryUsage
    };

    this.performanceHistory.push(snapshot);

    // 限制历史记录大小
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory.shift();
    }

    // 触发性能事件
    this.emit('performanceSnapshot', snapshot);

    // 检查性能警告
    this.checkPerformanceWarnings(snapshot);
  }

  /**
   * 检查性能警告
   * @param {Object} snapshot - 性能快照
   */
  checkPerformanceWarnings(snapshot) {
    const warnings = [];

    if (snapshot.optimizationRate < 0.3) {
      warnings.push(`优化率过低: ${(snapshot.optimizationRate * 100).toFixed(1)}%`);
    }

    if (snapshot.updateTime > 16) {
      warnings.push(`更新时间过长: ${snapshot.updateTime.toFixed(2)}ms`);
    }

    if (snapshot.performanceScore < 60) {
      warnings.push(`性能评分低: ${snapshot.performanceScore.toFixed(1)}/100`);
    }

    if (warnings.length > 0) {
      const warningMessage = warnings.join('; ');
      console.warn('性能警告:', warningMessage);
      this.emit('performanceWarning', { warnings, snapshot });
    }
  }

  /**
   * 异步审计整个世界的 Face Culling 情况 (分片执行，避免卡顿)
   * @param {Object} world - 世界对象
   * @returns {Promise<Object>} 审计结果
   */
  async auditWorld(world) {
    // console.log('开始异步审计世界 Face Culling 情况...');
    document.getElementById("perf").innerHTML = `开始审计地图 Face Culling 情况...`;
    const startTime = performance.now();

    let totalBlocks = 0;
    let totalFaces = 0;
    let hiddenFaces = 0;
    let visibleFaces = 0;

    const chunks = Array.from(world.chunks.values());
    const totalChunks = chunks.length;
    let processedChunks = 0;

    return new Promise((resolve) => {
      const processNextBatch = () => {
        const batchStartTime = performance.now();

        // 每次处理最多 5ms，避免掉帧
        while (processedChunks < totalChunks && performance.now() - batchStartTime < 5) {
          const chunk = chunks[processedChunks++];

          for (const key of chunk.solidBlocks) {
            totalBlocks++;
            totalFaces += 6;

            const [x, y, z] = key.split(',').map(Number);

            // 检查 6 个方向的邻居
            const directions = [
              [0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]
            ];

            for (const [dx, dy, dz] of directions) {
              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;

              if (world.isSolid(nx, ny, nz)) {
                // 如果是固体，进一步检查是否为透明/碰撞体（非遮挡方块）
                const neighborType = world.getBlock(nx, ny, nz);
                if (neighborType && this.isTransparent(neighborType)) {
                  visibleFaces++;
                } else {
                  hiddenFaces++;
                }
              } else {
                visibleFaces++;
              }
            }
          }
        }

        if (processedChunks < totalChunks) {
          // 继续下一批
          if (window.requestIdleCallback) {
              window.requestIdleCallback(processNextBatch);
          } else {
              setTimeout(processNextBatch, 0);
          }
        } else {
          // 完成
          const endTime = performance.now();
          const duration = endTime - startTime;

          const stats = {
            totalBlocks,
            totalFaces,
            hiddenFaces,
            visibleFaces,
            cullingRate: totalFaces > 0 ? (hiddenFaces / totalFaces) : 0,
            duration
          };

          var retMsg = `地图绘制审计完成（耗时: ${duration.toFixed(2)}ms）<br />`;
          retMsg += `- 总方块数: ${stats.totalBlocks}<br />`;
          retMsg += `- 总面数: ${stats.totalFaces}<br />`;
          retMsg += `- 隐藏面 (被剔除): ${stats.hiddenFaces}<br />`;
          retMsg += `- 可见面 (需渲染): ${stats.visibleFaces}<br />`;
          retMsg += `- 剔除率: ${(stats.cullingRate * 100).toFixed(2)}%`;
          document.getElementById("perf").innerHTML = retMsg;

          // console.log(`异步审计完成 (耗时: ${duration.toFixed(2)}ms):`);
          // console.log(`- 总方块数: ${stats.totalBlocks}`);
          // console.log(`- 总面数: ${stats.totalFaces}`);
          // console.log(`- 隐藏面 (被剔除): ${stats.hiddenFaces}`);
          // console.log(`- 可见面 (需渲染): ${stats.visibleFaces}`);
          // console.log(`- 剔除率: ${(stats.cullingRate * 100).toFixed(2)}%`);

          resolve(stats);
        }
      };

      // 启动处理
      processNextBatch();
    });
  }

  /**
   * 获取性能历史
   * @param {number} limit - 限制返回的记录数
   * @returns {Array} 性能历史记录
   */
  getPerformanceHistory(limit = 20) {
    const history = [...this.performanceHistory];
    if (limit && history.length > limit) {
      return history.slice(-limit);
    }
    return history;
  }

  /**
   * 获取性能趋势
   * @returns {Object} 性能趋势分析
   */
  getPerformanceTrend() {
    if (this.performanceHistory.length < 2) {
      return { trend: 'insufficient data', samples: this.performanceHistory.length };
    }

    const recent = this.performanceHistory.slice(-10);
    const first = recent[0];
    const last = recent[recent.length - 1];

    const optimizationRateChange = last.optimizationRate - first.optimizationRate;
    const updateTimeChange = last.updateTime - first.updateTime;
    const performanceScoreChange = last.performanceScore - first.performanceScore;

    let trend = 'stable';
    if (performanceScoreChange > 5) trend = 'improving';
    if (performanceScoreChange < -5) trend = 'degrading';

    return {
      trend,
      optimizationRate: {
        current: last.optimizationRate,
        change: optimizationRateChange,
        trend: optimizationRateChange > 0 ? 'improving' : optimizationRateChange < 0 ? 'degrading' : 'stable'
      },
      updateTime: {
        current: last.updateTime,
        change: updateTimeChange,
        trend: updateTimeChange < 0 ? 'improving' : updateTimeChange > 0 ? 'degrading' : 'stable'
      },
      performanceScore: {
        current: last.performanceScore,
        change: performanceScoreChange,
        trend: performanceScoreChange > 0 ? 'improving' : performanceScoreChange < 0 ? 'degrading' : 'stable'
      },
      samples: recent.length
    };
  }

  /**
   * 生成性能报告
   * @returns {Object} 性能报告
   */
  generatePerformanceReport() {
    const stats = this.getStats();
    const trend = this.getPerformanceTrend();
    const history = this.getPerformanceHistory(10);

    return {
      summary: {
        enabled: stats.enabled,
        optimizationRate: stats.optimizationRate,
        performanceScore: stats.performanceScore,
        status: stats.isDegraded ? 'degraded' : 'normal',
        trend: trend.trend
      },
      metrics: {
        blocksProcessed: stats.totalBlocksProcessed,
        facesCulled: stats.facesCulled,
        facesRendered: stats.facesRendered,
        updateTime: stats.updateTime,
        errorCount: stats.errorCount,
        memoryUsage: stats.memoryUsage
      },
      trendAnalysis: trend,
      recentHistory: history,
      recommendations: this.generateRecommendations(stats, trend)
    };
  }

  /**
   * 生成性能优化建议
   * @param {Object} stats - 当前统计
   * @param {Object} trend - 性能趋势
   * @returns {Array} 建议列表
   */
  generateRecommendations(stats, trend) {
    const recommendations = [];

    if (stats.optimizationRate < 0.3) {
      recommendations.push({
        priority: 'high',
        issue: '优化率过低',
        suggestion: '检查透明方块配置，确保固体方块被正确识别',
        action: '验证透明方块类型列表，调整算法参数'
      });
    }

    if (stats.updateTime > 16) {
      recommendations.push({
        priority: 'high',
        issue: '更新时间过长',
        suggestion: '算法执行时间超过一帧时间(16ms)',
        action: '考虑启用懒更新或减少批量更新大小'
      });
    }

    if (stats.errorCount > 5) {
      recommendations.push({
        priority: 'medium',
        issue: '错误计数较高',
        suggestion: '系统出现较多计算错误',
        action: '检查错误日志，考虑临时禁用优化'
      });
    }

    if (trend.trend === 'degrading') {
      recommendations.push({
        priority: 'medium',
        issue: '性能趋势下降',
        suggestion: '系统性能正在下降',
        action: '监控内存使用，清理缓存'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'low',
        issue: '无',
        suggestion: '系统运行良好',
        action: '继续保持当前配置'
      });
    }

    return recommendations;
  }

  /**
   * 设置配置参数
   * @param {Object} config - 配置对象
   */
  setConfig(config) {
    const oldMonitoring = this.config.performanceMonitoring;
    this.config = { ...this.config, ...config };

    // 如果性能监控设置发生变化
    if (config.performanceMonitoring !== undefined) {
      if (config.performanceMonitoring && !oldMonitoring) {
        this.startPerformanceMonitoring();
      } else if (!config.performanceMonitoring && oldMonitoring) {
        this.stopPerformanceMonitoring();
      }
    }

    console.log('Configuration updated:', this.config);
  }
}

// 导出默认实例
export const faceCullingSystem = new FaceCullingSystem();

// 全局访问（用于调试）
if (typeof window !== 'undefined') {
  window.faceCullingSystem = faceCullingSystem;
}
