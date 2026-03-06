/**
 * Chunk合并机制模块
 * 负责动态方块的合并优化、InstancedMesh生成等功能
 */
import * as THREE from 'three';
import { WORLD_CONFIG, CHUNK_SIZE } from '../utils/MathUtils.js';
import { getBlockProperties as getBlockProps } from '../constants/BlockData.js';
import { belongsToStructure } from '../utils/StructureUtils.js';
import { geomMap } from './Chunk.js';

// 合并机制常量
export const DIRTY_THRESHOLD = 50;
export const CONSOLIDATION_DELAY = 1000;

// Worker 实例与回调映射
export const worldWorker = new Worker(new URL('../workers/WorldWorker.js', import.meta.url), { type: 'module' });
export const workerCallbacks = new Map(); // 用于跟踪异步生成请求的回调函数

export function extendChunk(Chunk) {
  // 注册 Worker 消息处理器
  worldWorker.onmessage = (e) => {
    const { key, d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys, snapshot, structureCenters } = e.data;
    if (workerCallbacks.has(key)) {
      workerCallbacks.get(key)({ d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys, snapshot, structureCenters });
      workerCallbacks.delete(key);
    }
  };

  worldWorker.onerror = (e) => {
    console.error('WorldWorker error:', e);
  };

  /**
   * 调度后台合并任务
   * 实现防抖和阈值立即触发逻辑
   */
  Chunk.prototype.scheduleConsolidation = function() {
    if (this.isConsolidating) return;

    // 清除现有的定时器
    if (this.consolidationTimer) {
      clearTimeout(this.consolidationTimer);
      this.consolidationTimer = null;
    }

    // 如果达到阈值，立即触发合并
    if (this.dirtyBlocks >= DIRTY_THRESHOLD) {
      this.consolidate();
    } else {
      // 否则，启动防抖定时器
      this.consolidationTimer = setTimeout(() => {
        this.consolidate();
      }, CONSOLIDATION_DELAY);
    }
  };

  /**
   * 执行区块合并优化
   * 将当前区块的所有逻辑数据发送回 Worker，重新计算所有方块的可见面（Face Culling）和 AO
   * 生成全新的 InstancedMesh 并替换掉当前分散的动态 Mesh
   */
  Chunk.prototype.consolidate = async function() {
    if (this.isConsolidating || !this.isReady) return;
    this.isConsolidating = true;

    // 阶段 1: 准备合并数据
    const consolidatedCount = this.dirtyBlocks;
    const consolidatedMeshKeys = new Set(this.dynamicMeshes.keys());

    // 清除定时器
    if (this.consolidationTimer) {
      clearTimeout(this.consolidationTimer);
      this.consolidationTimer = null;
    }

    // 阶段 2: 注册 Worker 回调并请求重新计算
    const callbackKey = `${this.cx},${this.cz}`;
    workerCallbacks.set(callbackKey, (data) => {
      this._applyConsolidateResult(data, consolidatedCount, consolidatedMeshKeys);
    });

    // 发送请求到 Worker
    worldWorker.postMessage({
      cx: this.cx,
      cz: this.cz,
      seed: WORLD_CONFIG.SEED,
      snapshot: {
        blocks: { ...this.blockData },
        entities: { ...this.entities }
      },
      structureCenters: this.structureCenters,
      isOptimization: true
    });
  };

  /**
   * 应用 Worker 返回的合并结果
   * @param {Object} data - Worker 返回的数据
   * @param {number} consolidatedCount - 合并前的脏方块数量
   * @param {Set} consolidatedMeshKeys - 合并前的动态 Mesh 键集合
   */
  Chunk.prototype._applyConsolidateResult = function(data, consolidatedCount, consolidatedMeshKeys) {
    let { d, visibleKeys, solidBlocks, structureCenters: newStructureCenters } = data;

    // 更新结构中心列表
    if (newStructureCenters && newStructureCenters.length > 0) {
      this.structureCenters = newStructureCenters;
    }

    // 过滤 Worker 结果，防止幻影方块
    ({ visibleKeys, solidBlocks, d } = this._filterWorkerResult(data));

    // 保存原始 solidBlocks 用于跨 Chunk 碰撞体
    this._tempOriginalSolidBlocks = solidBlocks ? [...solidBlocks] : [];

    // 同步可见性状态与碰撞状态
    this._syncVisibilityAndCollision(visibleKeys, solidBlocks);

    // 保存宝箱状态
    const savedChestStates = this._saveChestStates();

    // 清理旧网格
    this._cleanupOldMeshes(consolidatedMeshKeys);

    // 构建新的渲染网格
    this.buildMeshes(d);

    // 恢复宝箱状态
    this._restoreChestStates(savedChestStates);

    // 重置状态
    this.dirtyBlocks = Math.max(0, this.dirtyBlocks - consolidatedCount);
    this.isConsolidating = false;

    if (this.dirtyBlocks > 0) this.scheduleConsolidation();
  };

  /**
   * 过滤 Worker 返回的结果，防止幻影方块
   */
  Chunk.prototype._filterWorkerResult = function(data) {
    let { d, visibleKeys, solidBlocks } = data;

    const isInChunkRange = (x, y, z) => {
      const minX = this.cx * CHUNK_SIZE;
      const maxX = (this.cx + 1) * CHUNK_SIZE;
      const minZ = this.cz * CHUNK_SIZE;
      const maxZ = (this.cz + 1) * CHUNK_SIZE;
      return x >= minX && x < maxX && z >= minZ && z < maxZ;
    };

    const checkBelongsToStructure = (x, y, z) => {
      return belongsToStructure(x, y, z, this.structureCenters);
    };

    // 过滤 visibleKeys
    if (visibleKeys) {
      visibleKeys = visibleKeys.filter(key => {
        if (this.blockData[key]) return true;
        const [x, y, z] = key.split(',').map(Number);
        if (isInChunkRange(x, y, z)) return false;
        return checkBelongsToStructure(x, y, z);
      });
    }

    // 过滤 solidBlocks
    if (solidBlocks) {
      solidBlocks = solidBlocks.filter(key => {
        if (this.blockData[key]) return true;
        const [x, y, z] = key.split(',').map(Number);
        if (isInChunkRange(x, y, z)) return false;
        return checkBelongsToStructure(x, y, z);
      });
    }

    // 过滤 d（渲染数据）
    if (d) {
      for (const type in d) {
        d[type] = d[type].filter(pos => {
          const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
          const currentEntry = this.blockData[key];
          if (currentEntry) {
            const currentType = typeof currentEntry === 'string' ? currentEntry : currentEntry.type;
            return currentType === type;
          } else {
            const x = Math.floor(pos.x);
            const y = Math.floor(pos.y);
            const z = Math.floor(pos.z);
            if (isInChunkRange(x, y, z)) return false;
            return checkBelongsToStructure(x, y, z);
          }
        });
      }
    }

    return { visibleKeys, solidBlocks, d };
  };

  /**
   * 同步可见性状态与碰撞状态
   */
  Chunk.prototype._syncVisibilityAndCollision = function(visibleKeys, solidBlocks) {
    if (visibleKeys) {
      this.visibleKeys = new Set(visibleKeys);
      for (const key of this.dynamicMeshes.keys()) {
        this.visibleKeys.add(key);
      }
    }

    if (solidBlocks) {
      this.solidBlocks = new Set(solidBlocks);
      for (const [key, mesh] of this.dynamicMeshes.entries()) {
        const type = mesh.userData.type;
        if (this.blockData[key] && getBlockProps(type).isSolid) {
          this.solidBlocks.add(key);
        }
      }
      this.regenerateCrossChunkColliders();
    }
  };

  /**
   * 保存宝箱状态
   */
  Chunk.prototype._saveChestStates = function() {
    const savedChestStates = new Map();
    const oldChestIndices = this.instanceIndexMap['chest'];
    if (oldChestIndices) {
      const oldChestMesh = this.group.children.find(c => c.isInstancedMesh && c.userData.type === 'chest');
      if (oldChestMesh && oldChestMesh.userData.chests) {
        for (const [posKey, idx] of oldChestIndices) {
          if (oldChestMesh.userData.chests[idx]) {
            savedChestStates.set(posKey, { ...oldChestMesh.userData.chests[idx] });
          }
        }
      }
    }
    return savedChestStates;
  };

  /**
   * 恢复宝箱状态
   */
  Chunk.prototype._restoreChestStates = function(savedChestStates) {
    if (savedChestStates.size === 0) return;

    const newChestMesh = this.group.children.find(c => c.isInstancedMesh && c.userData.type === 'chest');
    const newChestIndices = this.instanceIndexMap['chest'];
    if (newChestMesh && newChestIndices) {
      const dummy = new THREE.Matrix4();
      const zeroScale = new THREE.Vector3(0, 0, 0);
      for (const [posKey, state] of savedChestStates) {
        if (newChestIndices.has(posKey)) {
          const newIdx = newChestIndices.get(posKey);
          newChestMesh.userData.chests[newIdx] = state;
          if (state.open) {
            newChestMesh.getMatrixAt(newIdx, dummy);
            dummy.scale(zeroScale);
            newChestMesh.setMatrixAt(newIdx, dummy);
          }
        }
      }
      newChestMesh.instanceMatrix.needsUpdate = true;
    }
  };

  /**
   * 清理旧的网格
   */
  Chunk.prototype._cleanupOldMeshes = function(consolidatedMeshKeys) {
    // 清理动态网格
    consolidatedMeshKeys.forEach((key) => {
      const mesh = this.dynamicMeshes.get(key);
      if (mesh) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
          else mesh.material.dispose();
        }
        this.group.remove(mesh);
        this.dynamicMeshes.delete(key);
      }
    });

    // 移除旧的 InstancedMesh（保留树木）
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (child.isInstancedMesh) {
        if (child.userData.type === 'realistic_trunk' || child.userData.type === 'realistic_leaves') {
          continue;
        }
        if (child.geometry && child.geometry !== geomMap[child.userData.type] && child.geometry !== geomMap['default']) {
          child.geometry.dispose();
        }
        this.group.remove(child);
      }
    }
  };
}
