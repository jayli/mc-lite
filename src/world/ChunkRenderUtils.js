/**
 * Chunk渲染工具模块
 * 负责面剔除、AO计算、碰撞体生成等渲染相关功能
 */
import * as THREE from 'three';
import { getBlockProperties } from '../constants/BlockData.js';
import { faceCullingSystem } from '../core/FaceCullingSystem.js';
import { createChunkNeighborSampler } from './ChunkNeighborUtils.js';
import { CONSOLIDATION_DELAY } from './ChunkConsolidation.js';
import { createOcclusionChecker, calculateAOForBlock } from '../utils/AOUtils.js';
import { parseBlockEntry } from '../utils/OrientationUtils.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getFaceCullingSystem = () => globalThis._faceCullingSystem || faceCullingSystem;
const getBlockProps = (type) => {
  if (globalThis._blockData && typeof globalThis._blockData.getBlockProperties === 'function') {
    return globalThis._blockData.getBlockProperties(type);
  }
  return getBlockProperties(type);
};

export function extendChunk(Chunk) {
  const normalizeBlockType = (entryOrType) => {
    if (!entryOrType) return null;
    if (typeof entryOrType === 'string') return entryOrType;
    if (typeof entryOrType === 'object') {
      if (typeof entryOrType.type === 'string') return entryOrType.type;
      const parsed = parseBlockEntry(entryOrType);
      return parsed?.type || null;
    }
    return null;
  };

  /**
   * 清理资源 - 释放几何体和材质，防止内存泄漏
   * 在区块不再需要时调用
   */
  Chunk.prototype.dispose = function() {
    // 清除合并定时器
    if (this.consolidationTimer) {
      clearTimeout(this.consolidationTimer);
      this.consolidationTimer = null;
    }

    // 清除批量 Face Culling 更新定时器
    if (this.batchFaceCullingTimer) {
      clearTimeout(this.batchFaceCullingTimer);
      this.batchFaceCullingTimer = null;
    }

    // 清空待处理的 Face Culling 更新队列
    this.pendingBatchFaceCullingUpdates.clear();

    // 遍历组中的所有子对象
    this.group.children.forEach(c => {
      // 清理几何体
      if (c.geometry) c.geometry.dispose();
      // 只清理非实例网格的材质，因为实例网格共享材质
      if (!c.isInstancedMesh && c.material) {
        if (Array.isArray(c.material)) {
          // 如果是材质数组，清理每个材质
          c.material.forEach(m => m.dispose());
        } else {
          // 如果是单个材质，直接清理
          c.material.dispose();
        }
      }
    });
    // 清空组，移除所有子对象
    this.group.clear();
  };

  /**
   * 为跨 Chunk 结构方块重新生成碰撞体
   * 调用时机：在 consolidate() 后，确保所有结构方块的碰撞体都被正确注册
   */
  Chunk.prototype.regenerateCrossChunkColliders = function() {
    // 关键修复：使用 Worker 原始返回的 solidBlocks，因为 Worker 有完整的跨 Chunk 方块信息
    if (this._tempOriginalSolidBlocks && this._tempOriginalSolidBlocks.length > 0) {
      for (const key of this._tempOriginalSolidBlocks) {
        // 将 Worker 计算的所有 solidBlocks 都添加到主线程的 solidBlocks 中
        // 信任 Worker 的计算结果，因为 Worker 有完整的 blockMap
        this.solidBlocks.add(key);
      }
      // 清理临时变量
      this._tempOriginalSolidBlocks = null;
      return;
    }

    // 备用方案：如果没有临时原始数据，则通过结构中心遍历
    if (!this.structureCenters || this.structureCenters.length === 0) return;

    // 遍历所有结构中心，检查其覆盖的方块是否在当前 Chunk 的 solidBlocks 中
    for (const center of this.structureCenters) {
      const maxDist = this.getStructureRenderDist(center.type);
      // 检查结构覆盖的所有方块
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        for (let dy = -16; dy <= 16; dy++) {
          for (let dz = -maxDist; dz <= maxDist; dz++) {
            const bx = center.x + dx;
            const by = center.y + dy;
            const bz = center.z + dz;
            const key = `${bx},${by},${bz}`;

            // 主动检查：如果 blockData 中有该方块且是实心的，确保它在 solidBlocks 中
            const entry = this.blockData[key];
            if (entry) {
              const type = typeof entry === 'string' ? entry : entry.type;
              const props = getBlockProps(type);
              if (props.isSolid) {
                // 关键修复：确保跨 Chunk 结构方块始终在 solidBlocks 中
                this.solidBlocks.add(key);
              }
            }
          }
        }
      }
    }
  };

  /**
   * 私有辅助方法：为单个方块触发 Face Culling 更新
   */
  Chunk.prototype._triggerFaceCullingUpdate = function(x, y, z, type) {
    const fcSystem = getFaceCullingSystem();
    if (fcSystem && fcSystem.isEnabled()) {
      const typeStr = normalizeBlockType(type);
      if (!typeStr) return;

      const position = new THREE.Vector3(x, y, z);
      const block = { type: typeStr };

      const { getNeighborsOf } = createChunkNeighborSampler(this, (entry) => {
        const neighborType = normalizeBlockType(entry);
        return neighborType ? { type: neighborType } : null;
      });

      fcSystem.updateBlock(position, block, getNeighborsOf(x, y, z));
    }
  };

  /**
   * 调度批量 Face Culling 更新
   * 使用防抖定时器，在最后一批删除操作完成后统一处理所有待更新的邻居
   */
  Chunk.prototype._scheduleBatchFaceCullingUpdate = function() {
    if (this.batchFaceCullingTimer) {
      clearTimeout(this.batchFaceCullingTimer);
    }
    // 比 consolidation 延迟多100ms，确保Worker合并完成后再更新AO，避免竞态条件
    this.batchFaceCullingTimer = setTimeout(() => {
      this.processPendingFaceCullingUpdates();
    }, CONSOLIDATION_DELAY + 100);
  };

  /**
   * 处理所有待处理的批量 Face Culling 更新
   * 在 Mag7、TNT 等批量删除操作完成后调用，统一更新所有暴露面的 AO 阴影
   */
  Chunk.prototype.processPendingFaceCullingUpdates = function() {
    if (this.pendingBatchFaceCullingUpdates.size === 0) return;

    // 清除定时器
    if (this.batchFaceCullingTimer) {
      clearTimeout(this.batchFaceCullingTimer);
      this.batchFaceCullingTimer = null;
    }

    // 收集需要更新 AO 的位置
    const aoUpdatePositions = [];

    // 处理所有待更新的邻居
    this.pendingBatchFaceCullingUpdates.forEach(nKey => {
      const [nx, ny, nz] = nKey.split(',').map(Number);
      const nCx = Math.floor(nx / 16);
      const nCz = Math.floor(nz / 16);

      if (nCx === this.cx && nCz === this.cz) {
        // 邻居在当前区块
        if (this.blockData[nKey]) {
          this._triggerFaceCullingUpdate(nx, ny, nz, this.blockData[nKey]);
          aoUpdatePositions.push({ x: nx, y: ny, z: nz });
        }
      } else {
        // 跨区块邻居处理
        const neighborChunk = this.world.chunks.get(`${nCx},${nCz}`);
        if (neighborChunk && neighborChunk.isReady) {
          neighborChunk.checkReveal(nx, ny, nz);
        }
      }
    });

    // 批量更新邻居 AO - 解决 Mag7 批量删除后 AO 丢失问题
    // 在 requestIdleCallback 中执行，避免阻塞主线程
    if (aoUpdatePositions.length > 0) {
      this._updateNeighborsAOInBatch(aoUpdatePositions);
    }

    // 清空待处理队列
    this.pendingBatchFaceCullingUpdates.clear();
  };

  /**
   * 批量更新邻居方块的 AO（在 requestIdleCallback 中执行）
   * @param {Array} positions - 位置数组 [{x, y, z}]
   * @private
   */
  Chunk.prototype._updateNeighborsAOInBatch = function(positions) {
    const updateAO = () => {
      // 创建统一的遮挡检测函数（复用 AOUtils 中的逻辑）
      const isOccluding = createOcclusionChecker(
        { chunk: this, chunks: this.world.chunks },
        16,
        getBlockProps
      );

      for (const pos of positions) {
        const key = `${pos.x},${pos.y},${pos.z}`;
        const mesh = this.dynamicMeshes?.get(key);
        if (!mesh) continue;

        const type = this.blockData[key];
        if (!type) continue;

        const typeStr = typeof type === 'string' ? type : type.type;
        const props = getBlockProps(typeStr);
        if (!props.isSolid || props.isTransparent) continue;

        // 使用 AOUtils 中的函数计算 AO 数据
        const { aoLow, aoHigh } = calculateAOForBlock(pos.x, pos.y, pos.z, isOccluding);

        // 应用到 mesh
        const count = mesh.geometry.attributes.position.count;
        const aoLowArray = new Float32Array(count);
        const aoHighArray = new Float32Array(count);

        aoLowArray.fill(aoLow);
        aoHighArray.fill(aoHigh);

        mesh.geometry.setAttribute('aAoLow', new THREE.BufferAttribute(aoLowArray, 1));
        mesh.geometry.setAttribute('aAoHigh', new THREE.BufferAttribute(aoHighArray, 1));
      }
    };

    // 使用 requestIdleCallback 或 setTimeout 来避免卡顿
    if (window.requestIdleCallback) {
      window.requestIdleCallback(updateAO, { timeout: 500 });
    } else {
      setTimeout(updateAO, 0);
    }
  };
}
