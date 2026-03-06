// src/core/AORepairManager.js
// AO 修复管理器 - 兜底机制确保批量删除后 AO 阴影正确渲染

import * as THREE from 'three';
import { getBlockProperties } from '../constants/BlockData.js';
import { computeBlockAOPacked, createOcclusionChecker } from '../utils/AOUtils.js';

const CHUNK_SIZE = 16;

/**
 * AO 修复管理器类
 * 监听批量删除事件，收集受影响区域，延迟执行全面修复
 */
export class AORepairManager {
  /**
   * 构造函数
   * @param {Object} world - World 实例
   */
  constructor(world) {
    this.world = world;

    // 待修复的区块映射
    // key: "cx,cz", value: Set of affected block keys "x,y,z"
    this.pendingChunkRepairs = new Map();

    // 防抖定时器
    this.repairTimer = null;

    // 配置
    this.REPAIR_DELAY = 1200;  // 1.2 秒后开始修复（等 consolidation 完成，1000ms + 200ms 缓冲）
    this.NEIGHBOR_RADIUS = 1;   // 3x3x3 范围

    console.log('AORepairManager initialized');
  }

  /**
   * 记录批量删除操作
   * @param {Array<{x,y,z}>} positions - 被删除的方块位置数组
   */
  recordBatchRemoval(positions) {
    if (!positions || positions.length === 0) return;

    // 对每个删除的方块，收集受影响的 3x3x3 区域
    for (const pos of positions) {
      const x = Math.floor(pos.x);
      const y = Math.floor(pos.y);
      const z = Math.floor(pos.z);

      // 收集 3x3x3 邻居
      for (let dx = -this.NEIGHBOR_RADIUS; dx <= this.NEIGHBOR_RADIUS; dx++) {
        for (let dy = -this.NEIGHBOR_RADIUS; dy <= this.NEIGHBOR_RADIUS; dy++) {
          for (let dz = -this.NEIGHBOR_RADIUS; dz <= this.NEIGHBOR_RADIUS; dz++) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;

            // 按区块分组
            const cx = Math.floor(nx / CHUNK_SIZE);
            const cz = Math.floor(nz / CHUNK_SIZE);
            const chunkKey = `${cx},${cz}`;
            const blockKey = `${nx},${ny},${nz}`;

            // 添加到待修复集合
            if (!this.pendingChunkRepairs.has(chunkKey)) {
              this.pendingChunkRepairs.set(chunkKey, new Set());
            }
            this.pendingChunkRepairs.get(chunkKey).add(blockKey);
          }
        }
      }
    }

    // 调度修复
    this.scheduleRepair();
  }

  /**
   * 调度修复任务（防抖）
   */
  scheduleRepair() {
    if (this.repairTimer) {
      clearTimeout(this.repairTimer);
    }

    this.repairTimer = setTimeout(() => {
      this.executeRepair();
    }, this.REPAIR_DELAY);
  }

  /**
   * 执行修复
   */
  executeRepair() {
    console.log(`[AORepairManager] Starting repair for ${this.pendingChunkRepairs.size} chunks`);

    // 遍历每个待修复的区块
    for (const [chunkKey, affectedKeys] of this.pendingChunkRepairs) {
      const chunk = this.world.chunks.get(chunkKey);

      if (chunk && chunk.isReady) {
        this.repairChunk(chunk, affectedKeys);
      }
    }

    // 清空待修复队列
    this.pendingChunkRepairs.clear();
    this.repairTimer = null;

    console.log('[AORepairManager] Repair completed');
  }

  /**
   * 修复单个区块
   * 方案2：只修复实例化网格 (instancedMeshes)
   * 动态网格 (dynamicMeshes) 由 _updateNeighborsAOInBatch 负责处理
   * 避免重复计算造成的跳变
   * @param {Object} chunk - Chunk 实例
   * @param {Set<string>} affectedKeys - 受影响的方块 key 集合
   */
  repairChunk(chunk, affectedKeys) {
    // 只修复实例化网格
    for (const child of chunk.group.children) {
      if (child.isInstancedMesh) {
        this.repairInstancedMesh(child, chunk, affectedKeys);
      }
    }
  }

  /**
   * 修复动态网格
   * @param {THREE.Mesh} mesh - 动态网格
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {Object} chunk - Chunk 实例
   */
  repairDynamicMesh(mesh, x, y, z, chunk) {
    const key = `${x},${y},${z}`;
    const type = chunk.blockData[key];
    if (!type) return;

    const typeStr = typeof type === 'string' ? type : type.type;
    const props = getBlockProperties(typeStr);
    if (!props.isSolid || props.isTransparent) return;

    // 重新计算 AO
    const { aoLow, aoHigh } = this.calculateAOPacked(x, y, z, chunk);

    // 应用到 mesh
    const count = mesh.geometry.attributes.position?.count || 0;
    if (count === 0) return;

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
   * 修复实例化网格
   * @param {THREE.InstancedMesh} instancedMesh - 实例化网格
   * @param {Object} chunk - Chunk 实例
   * @param {Set<string>} affectedKeys - 受影响的方块 key 集合
   */
  repairInstancedMesh(instancedMesh, chunk, affectedKeys) {
    const instanceCount = instancedMesh.count;
    if (instanceCount === 0) return;

    const type = instancedMesh.userData.type;
    const props = getBlockProperties(type);
    if (!props.isSolid || props.isTransparent) return;

    // 检查 geometry 是否存在
    if (!instancedMesh.geometry) return;

    // 获取或创建 AO 属性（注意：在 InstancedMesh 中，属性在 geometry 上）
    let aoLowAttr = instancedMesh.geometry.getAttribute('aAoLow');
    let aoHighAttr = instancedMesh.geometry.getAttribute('aAoHigh');

    // 如果没有 AO 属性，说明这个方块类型不适用 AO，跳过
    if (!aoLowAttr || !aoHighAttr) return;

    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    let needsUpdate = false;

    // 遍历所有实例
    for (let i = 0; i < instanceCount; i++) {
      instancedMesh.getMatrixAt(i, dummy);
      pos.setFromMatrixPosition(dummy);
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      const z = Math.round(pos.z);
      const key = `${x},${y},${z}`;

      // 如果这个实例在受影响列表中
      if (affectedKeys.has(key)) {
        // 确认方块仍然存在且适用 AO
        const blockType = chunk.blockData[key];
        if (!blockType) continue;

        // 重新计算 AO
        const { aoLow, aoHigh } = this.calculateAOPacked(x, y, z, chunk);

        // 更新属性
        aoLowAttr.array[i] = aoLow;
        aoHighAttr.array[i] = aoHigh;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      aoLowAttr.needsUpdate = true;
      aoHighAttr.needsUpdate = true;
    }
  }

  /**
   * 计算方块的 AO 数据（打包格式）
   * 直接使用 AOUtils 中的函数，确保与正常渲染逻辑完全一致
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {Object} chunk - Chunk 实例
   * @returns {Object} { aoLow, aoHigh }
   */
  calculateAOPacked(x, y, z, chunk) {
    // 创建与 _createDynamicBlockMesh 中完全一致的 isOccluding 函数
    const isOccluding = createOcclusionChecker(
      { chunk: chunk, chunks: this.world.chunks },
      CHUNK_SIZE,
      getBlockProperties
    );

    // 直接使用 AOUtils 中的 computeBlockAOPacked 函数计算
    return computeBlockAOPacked(x, y, z, isOccluding);
  }

  /**
   * 清理资源
   */
  dispose() {
    if (this.repairTimer) {
      clearTimeout(this.repairTimer);
      this.repairTimer = null;
    }
    this.pendingChunkRepairs.clear();
    console.log('AORepairManager disposed');
  }
}
