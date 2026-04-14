/**
 * Chunk地形生成模块
 * 负责区块生成、实体生成等功能
 */
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { persistenceService } from '../services/PersistenceService.js';
import { worldWorker, workerCallbacks } from './ChunkConsolidation.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;

export function extendChunk(Chunk) {
  /**
   * 生成区块内容
   * 将计算压力较大的地形和结构生成逻辑分解到 Worker 线程中执行
   */
  Chunk.prototype.gen = async function() {
    // 0. 加载持久化全量数据 (快照)
    const snapshot = await getPersistenceService().getChunkData(this.cx, this.cz);

    // 收集相邻已加载 chunk 的 structureCenters，用于跨 Chunk 空岛/云朵渲染
    const neighborStructureCenters = [];
    if (this.world?.chunks) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          const neighborKey = `${this.cx + dx},${this.cz + dz}`;
          const neighborChunk = this.world.chunks.get(neighborKey);
          if (neighborChunk?.structureCenters?.length) {
            neighborStructureCenters.push(...neighborChunk.structureCenters);
          }
        }
      }
    }

    return new Promise((resolve) => {
      const callbackKey = `${this.cx},${this.cz}`;

      // 注册 Worker 回调
      workerCallbacks.set(callbackKey, (data) => {
        this.acceptWorkerResult(data);
        this.world?.onChunkWorkerReady?.(this);
        resolve();
      });

      // 4. 发送生成请求到 Worker
      worldWorker.postMessage({
        cx: this.cx,
        cz: this.cz,
        seed: WORLD_CONFIG.SEED,
        snapshot,
        structureCenters: neighborStructureCenters.length > 0 ? neighborStructureCenters : undefined
      });
    });
  }

  /**
    * 添加方块到区块中
    * @param {number} x - 世界坐标X
    * @param {number} y - 世界坐标Y
    * @param {number} z - 世界坐标Z
    * @param {string} type - 方块类型（如 'dirt', 'stone', 'wood' 等）
    * @param {Object} dObj - 数据收集对象（用于批量构建网格），如果为null则不收集
    * @param {boolean} solid - 是否为实心方块（影响碰撞检测）
    * @param {number} orientation - 方块朝向（0-3），默认为 0
    */
  Chunk.prototype.add = function(x, y, z, type, dObj = null, solid = true, orientation = 0) {
    // 生成方块的唯一键（用于碰撞检测和持久化覆盖检查）
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

    // 如果提供了数据收集对象，将方块位置按类型分类存储
    if (dObj) {
      if (!dObj[type]) dObj[type] = [];
      dObj[type].push({ x, y, z, orientation: orientation || 0 });
    }
    // 如果是实心方块，添加到实心方块集合中
    if (solid) {
      this.solidBlocks.add(key);
    }
  }

  /**
   * 构建所有网格 - 将 meshData 注册到 BatchManager
   * 主线程不创建 InstancedMesh，BatchManager 是唯一渲染事实源
   * @param {Array} meshDataArray - Worker 返回的预计算 mesh 数据
   */
  Chunk.prototype.buildMeshes = function(meshDataArray) {
    // 防御性检查
    if (!Array.isArray(meshDataArray)) {
      console.warn('buildMeshes received legacy data format, expected array');
      return;
    }

    // 存储最后一次 mesh 数据（用于 consolidation / rebuild）
    this._lastMeshData = meshDataArray;

    // 填充 instanceIndexMap（用于非 batch 场景和调试）
    for (const data of meshDataArray) {
      if (data.blockTypes) {
        this.instanceIndexMap['batched_' + data.type] = new Map(Object.entries(data.instanceIndexMap || {}));
      } else {
        const type = data.type;
        if (type !== 'realistic_trunk' && type !== 'realistic_leaves') {
          this.instanceIndexMap[type] = new Map(Object.entries(data.instanceIndexMap || {}));
        }
      }
    }

    // 注册到 BatchManager（唯一渲染路径）
    const batchManager = this.world?.batchManager;
    if (batchManager?.enabled) {
      const chunkKey = `${this.cx},${this.cz}`;
      batchManager.registerChunk(chunkKey, meshDataArray);
    }
  }
}
