/**
 * Chunk合并机制模块
 * 负责动态方块的合并优化、InstancedMesh生成等功能
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { getBlockProperties as getBlockProps } from '../constants/BlockData.js';
import { blockDataToStringKeys } from '../utils/CoordEncoding.js';
import { getRotationAngle } from '../utils/OrientationUtils.js';
import { filterWorkerResultAgainstBlockData } from './ChunkMeshDataFilter.js';
import { belongsToCrossChunkStructure } from '../utils/StructureUtils.js';
import { worldWorker, workerCallbacks, worldWorkerPool } from '../workers/WorldWorkerPool.js';
export { worldWorker, workerCallbacks, worldWorkerPool };

// 区块大小常量
export const CHUNK_SIZE = 16;

// 合并机制常量
const DIRTY_THRESHOLD = 50;
export const CONSOLIDATION_DELAY = 1000;

// 专用 AO Worker — 只做 AO 计算，不复用 FaceCullingWorker
export const aoWorker = new Worker(new URL('../workers/AOWorker.js', import.meta.url), { type: 'module' });
export const aoCallbacks = new Map(); // AO Worker 回调映射

// 共享几何体定义 - 用于优化渲染性能，避免在每个区块中重复创建相同的几何体，减少 GPU 内存占用

/**
 * 为几何体添加顶点 ID 属性，用于着色器中索引 AO 数据
 */
function addVertexIdAttribute(geometry) {
  const count = geometry.attributes.position.count;
  const vertexIds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    vertexIds[i] = i;
  }
  geometry.setAttribute('aVertexId', new THREE.BufferAttribute(vertexIds, 1));
  return geometry;
}

/**
 * 构建交叉平面几何体（用于花、藤蔓等植物）
 * 由两个垂直交叉的平面组成，形成十字形状，使其在各个角度看都有体积感
 * @param {number} offsetY - Y 轴偏移，用于调整植物模型相对于方块底部的垂直高度
 * @returns {THREE.BufferGeometry} 合并后的交叉平面几何体
 */
function buildCrossGeo(offsetY = -0.25) {
  const p1 = new THREE.PlaneGeometry(0.7, 0.7); // 基础平面尺寸 0.7x0.7
  const p2 = new THREE.PlaneGeometry(0.7, 0.7);
  p2.rotateY(Math.PI / 2); // 绕 Y 轴旋转 90 度
  const merged = BufferGeometryUtils.mergeGeometries([p1, p2]); // 合并几何体减少渲染开销
  merged.translate(0, offsetY, 0); // 应用垂直偏移
  return addVertexIdAttribute(merged);
}
// 花的几何体（交叉平面，向下偏移0.25单位，使花朵看起来生长在地面上）
const geoFlower = buildCrossGeo(-0.25);
// 藤蔓的几何体（交叉平面，高度占满整个方块，偏移+0.5使其从底部延伸到顶部，堆叠时无缝衔接）
const geoVine = (() => {
  const height = 1.0; // 占满方块高度
  const width = 0.8;  // 宽度稍宽以覆盖更好
  const p1 = new THREE.PlaneGeometry(width, height);
  const p2 = new THREE.PlaneGeometry(width, height);
  p2.rotateY(Math.PI / 2);
  const merged = BufferGeometryUtils.mergeGeometries([p1, p2]);
  merged.translate(0, 0.5, 0); // 向上偏移0.5，使几何体从y=0到y=1
  return addVertexIdAttribute(merged);
})();

/**
 * 睡莲几何体 - 一个旋转为水平方向的平面
 * 用于沼泽生物群系，浮在水面上
 */
const geoLily = (() => {
  const geo = new THREE.PlaneGeometry(0.8, 0.8);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.48, 0);
  return addVertexIdAttribute(geo);
})();

/**
 * 仙人掌几何体 - 由主茎和多个分支组成的复杂几何体
 * 用于沙漠生物群系，模拟真实仙人掌的形状
 */
const geoCactus = (() => {
  const geoms = [];
  geoms.push(new THREE.BoxGeometry(0.65, 1, 0.65));
  const la = new THREE.BoxGeometry(0.25, 0.25, 0.25); la.translate(-0.4, 0.1, 0); geoms.push(la);
  const lau = new THREE.BoxGeometry(0.25, 0.4, 0.25); lau.translate(-0.4, 0.35, 0); geoms.push(lau);
  const ra = new THREE.BoxGeometry(0.25, 0.25, 0.25); ra.translate(0.4, -0.1, 0); geoms.push(ra);
  const rau = new THREE.BoxGeometry(0.25, 0.3, 0.25); rau.translate(0.4, 0.1, 0); geoms.push(rau);
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/** 烟囱几何体 - 一个略窄的圆柱体 */
const geoChimney = addVertexIdAttribute(new THREE.CylinderGeometry(0.15, 0.15, 2, 8));

/**
 * 栏杆几何体 - L 形状，由中心柱子和东/北方向的把手组成
 */
const geoHandrail = (() => {
  const geoms = [];
  // 中心柱子：宽 0.5，高 1.0
  geoms.push(new THREE.BoxGeometry(0.5, 1, 0.5));
  // 东方把手 (正 X 方向)：从中心向东延伸 0.5 单位
  const barEast = new THREE.BoxGeometry(0.5, 0.15, 0.15);
  barEast.translate(0.375, 0.35, 0); // 中心在 x=0.375 (0.25+0.125)
  geoms.push(barEast);
  // 北方把手 (正 Z 方向)：从中心向北延伸 0.5 单位
  const barNorth = new THREE.BoxGeometry(0.15, 0.15, 0.5);
  barNorth.translate(0, 0.35, 0.375); // 中心在 z=0.375 (0.25+0.125)
  geoms.push(barNorth);
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 栏杆 A 几何体 - 中心柱子和 X 轴向把手 (东西向)
 */
const geoHandrailA = (() => {
  const geoms = [];
  geoms.push(new THREE.BoxGeometry(0.3, 1, 0.3));
  const barX = new THREE.BoxGeometry(1, 0.15, 0.15);
  barX.translate(0, 0.35, 0);
  geoms.push(barX);
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 栏杆 B 几何体 - 中心柱子和 Z 轴向把手 (南北向)
 */
const geoHandrailB = (() => {
  const geoms = [];
  geoms.push(new THREE.BoxGeometry(0.3, 1, 0.3));
  const barZ = new THREE.BoxGeometry(0.15, 0.15, 0.5);
  barZ.translate(0, 0.35, 0);
  geoms.push(barZ);
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 柱子几何体 - 一个竖直的长方体，粗细等同于handrailA
 */
const geoPillar = (() => {
  const geoms = [];
  geoms.push(new THREE.BoxGeometry(0.3, 1, 0.3));
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 水平柱子几何体 - 一个横着的长方体（沿X轴），可以旋转
 */
const geoHorizontalPillar = (() => {
  const geoms = [];
  // 水平放置，长度1，高度和宽度0.3
  geoms.push(new THREE.BoxGeometry(1, 0.3, 0.3));
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 木台阶几何体 - 一个缺了右上角四分之一的立方体
 * 从侧面看是一个 L 形，占据左下、右下、左上三个象限
 */
const geoPlanksStep = (() => {
  const geoms = [];
  // 底部整体：x: [-0.5, 0.5], y: [-0.5, 0], z: [-0.5, 0.5]
  const bottom = new THREE.BoxGeometry(1, 0.5, 1);
  bottom.translate(0, -0.25, 0);
  geoms.push(bottom);
  // 左上部分：x: [-0.5, 0], y: [0, 0.5], z: [-0.5, 0.5]
  const topLeft = new THREE.BoxGeometry(0.5, 0.5, 1);
  topLeft.translate(-0.25, 0.25, 0);
  geoms.push(topLeft);
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 鹅卵石台阶几何体 - 与木台阶形状相同
 */
const geoCobblestoneStep = geoPlanksStep;

/**
 * 鹅卵石上下颠倒台阶几何体 - 与木台阶形状相同但上下颠倒
 * 底部整体：x: [-0.5, 0.5], y: [0, 0.5], z: [-0.5, 0.5]（上半部分）
 * 右下部分：x: [0, 0.5], y: [-0.5, 0], z: [-0.5, 0.5]（下半部分右侧）
 */
const geoCobblestoneStepUpdown = (() => {
  const geoms = [];
  // 上半部分整体：x: [-0.5, 0.5], y: [0, 0.5], z: [-0.5, 0.5]
  const top = new THREE.BoxGeometry(1, 0.5, 1);
  top.translate(0, 0.25, 0);
  geoms.push(top);
  // 右下部分：x: [0, 0.5], y: [-0.5, 0], z: [-0.5, 0.5]
  const bottomRight = new THREE.BoxGeometry(0.5, 0.5, 1);
  bottomRight.translate(0.25, -0.25, 0);
  geoms.push(bottomRight);
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 半高方块几何体 - 高度为0.5的方块，用于床等家具
 * 向下偏移0.25，使方块底部紧贴地面（y=0），顶部在y=0.5
 */
const geoHalfBlock = (() => {
  const geo = new THREE.BoxGeometry(1, 0.5, 1);
  geo.translate(0, -0.25, 0); // 向下偏移，使底部紧贴地面
  return addVertexIdAttribute(geo);
})();

/**
 * 吊灯几何体 - 细绳圆柱 + 灯体立方体
 * 细绳：直径0.03，长度0.4，从方块顶部向下延伸
 * 灯体：0.3x0.3x0.3立方体，位于方块正中间
 */
const geoHangingLamp = (() => {
  const geoms = [];
  // 细绳圆柱：直径0.03（半径0.015），长度0.4，从顶部(y=0.5)向下延伸到(y=0.1)
  const rope = new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8);
  rope.translate(0, 0.3, 0); // 中心在 y=0.3（从 y=0.5 到 y=0.1）
  geoms.push(rope);
  // 灯体立方体：0.3x0.3x0.3，位于方块正中间
  const lampBody = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  lampBody.translate(0, 0, 0); // 中心在 y=0（方块正中间）
  geoms.push(lampBody);
  return addVertexIdAttribute(BufferGeometryUtils.mergeGeometries(geoms));
})();

/**
 * 几何体映射表 - 将方块类型映射到对应的几何体
 */
export const geomMap = {
  'flower': geoFlower,
  'short_grass': geoFlower,
  'allium': geoFlower,
  'vine': geoVine,
  'lilypad': geoLily,
  'cactus': geoCactus,
  'chimney': geoChimney,
  'handrail': geoHandrail,
  'handrailA': geoHandrailA,
  'handrailB': geoHandrailB,
  'vertical_pillar': geoPillar,
  'horizontal_pillar': geoHorizontalPillar,
  'planks_step': geoPlanksStep,
  'cobblestone_step': geoCobblestoneStep,
  'cobblestone_step_updown': geoCobblestoneStepUpdown,
  'stone_diorite_step': geoCobblestoneStep,
  'half_block': geoHalfBlock,
  'hanging_lamp': geoHangingLamp,
  'default': addVertexIdAttribute(new THREE.BoxGeometry(1, 1, 1))
};

export function extendChunk(Chunk) {
  // WorldWorkerPool 内部已处理消息路由，不再需要全局 onmessage 注册
  // 仅保留 onerror 用于日志
  worldWorkerPool.onerror = (e) => {
    console.error('WorldWorkerPool Error:', e);
    console.error('Error details:', {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      error: e.error
    });
  };

  // 注册专用 AO Worker 消息处理器
  aoWorker.onmessage = (e) => {
    const { requestId, chunkKey, results } = e.data;
    if (requestId && aoCallbacks.has(requestId)) {
      aoCallbacks.get(requestId)({ chunkKey, results });
      aoCallbacks.delete(requestId);
    }
  };

  // 初始化 AO Bridge — 绑定 Worker 引用，启用 delta 同步机制
  import('../core/AOBridge.js').then(({ aoBridge }) => {
    aoBridge.init(aoWorker);
  });

  aoWorker.onerror = (e) => {
    console.error('AOWorker Error:', e.message, 'at', e.filename, ':', e.lineno);
  };

  /**
   * 调度后台合并任务
   * 实现防抖和阈值立即触发逻辑
   */
  Chunk.prototype.scheduleConsolidation = function() {
    if (this.isConsolidating) return;
    if (this.deferConsolidation) return;

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
    this._aoSourceVersion++;

    // 阶段 1: 准备合并数据
    const consolidatedCount = this.dirtyBlocks;
    const consolidatedMeshKeys = new Set(this.dynamicMeshes.keys());

    // 清除定时器
    if (this.consolidationTimer) {
      clearTimeout(this.consolidationTimer);
      this.consolidationTimer = null;
    }

    // 阶段 2: 注册 Worker 回调并请求重新计算
    const taskId = `consolidate:${this.cx},${this.cz}:${performance.now()}:${Math.random().toString(36).slice(2, 8)}`;
    workerCallbacks.set(taskId, (data) => {
      this._applyConsolidateResult(data, consolidatedCount, consolidatedMeshKeys);
    });

    // 发送请求到 Worker 池
    worldWorker.postMessage({
      cx: this.cx,
      cz: this.cz,
      taskId,
      seed: WORLD_CONFIG.SEED,
      snapshot: {
        blocks: blockDataToStringKeys(this.blockData),
        entities: {
          ...this.entities,
          staticTrees: this.entities.staticTrees || []
        }
      },
      structureCenters: this.structureCenters,
      isOptimization: true,
      textureGroups: this.world?.engine?.materials?.getTextureGroups() || {}  // 新增：纹理分组配置
    });
  };

  /**
   * 应用 Worker 返回的合并结果
   * @param {Object} data - Worker 返回的数据
   * @param {number} consolidatedCount - 合并前的脏方块数量
   * @param {Set} consolidatedMeshKeys - 合并前的动态 Mesh 键集合
   */
  Chunk.prototype._applyConsolidateResult = function(data, consolidatedCount, consolidatedMeshKeys) {
    let { scatteredBlocks, visibleKeys, solidBlocks, structureCenters: newStructureCenters } = data;

    // 更新结构中心列表
    if (newStructureCenters && newStructureCenters.length > 0) {
      this.structureCenters = newStructureCenters;
    }

    // 过滤 scatteredBlocks：只保留 blockData 中存在的方块
    const filteredBlocks = [];
    if (scatteredBlocks && Array.isArray(scatteredBlocks)) {
      for (const block of scatteredBlocks) {
        const code = Chunk.encodeCoord(block.x, block.y, block.z);
        const entry = this.blockData.get(code);
        if (!entry) continue;
        const entryType = typeof entry === 'string' ? entry : entry.type;
        if (entryType !== block.type) continue;
        filteredBlocks.push(block);
      }
    }

    // 将过滤后的 scatteredBlocks 转换为 meshData 格式（按 visibleKeys 过滤可见方块）
    const encodeKeys = (arr) => arr ? arr.map(strKey => {
      const [x, y, z] = strKey.split(',').map(Number);
      return Chunk.encodeCoord(x, y, z);
    }) : null;
    const encodedVisibleKeys = encodeKeys(visibleKeys);
    const encodedVisibleKeysSet = encodedVisibleKeys ? new Set(encodedVisibleKeys) : null;
    const meshData = this._convertScatteredBlocksToMeshData(filteredBlocks, encodedVisibleKeysSet, newStructureCenters);

    // 保存原始 solidBlocks 用于跨 Chunk 碰撞体（Worker 返回字符串数组，需编码转换）
    this._tempOriginalSolidBlocks = solidBlocks
      ? solidBlocks.map(strKey => {
        const [sx, sy, sz] = strKey.split(',').map(Number);
        return Chunk.encodeCoord(sx, sy, sz);
      })
      : [];

    // 同步可见性状态与碰撞状态（Worker 返回字符串数组，需编码转换）
    const encodedSolidBlocks = encodeKeys(solidBlocks);
    this._syncVisibilityAndCollision(encodedVisibleKeys, encodedSolidBlocks);

    // 保存宝箱状态
    const savedChestStates = this._saveChestStates();

    // 清理旧网格
    this._cleanupOldMeshes(consolidatedMeshKeys);

    // 构建新的渲染网格
    this.buildMeshes(meshData || []);

    // 恢复宝箱状态
    this._restoreChestStates(savedChestStates);

    // 重新注册光源（合并后方块可能变化，需要同步更新光源）
    this._unregisterLightSources();
    this._registerLightSources();

    // 重建数组存储，确保 blockDataArray 与 blockData 权威源同步
    this._initArrayStorageFromBlockData();

    // 重置状态
    this.dirtyBlocks = Math.max(0, this.dirtyBlocks - consolidatedCount);
    this.isConsolidating = false;
    this.world?.onChunkAOSourceStable?.(this, { reason: 'consolidation' });
    if (this.loadState === 'waiting-consolidation') {
      this.loadState = 'entities-built';
      this.world?.onChunkConsolidationComplete?.(this);
    }

    if (this.dirtyBlocks > 0) this.scheduleConsolidation();
  };

  /**
   * 将 scatteredBlocks 转换为 meshData 格式（按 type 分组）
   * @param {Array} scatteredBlocks - 过滤后的方块列表
   * @param {Set} visibleKeys - 面剔除可见的方块编码集合（可选，用于过滤隐藏方块）
   * @param {Array} structureCenters - 结构中心列表（供跨 chunk 结构判断）
   */
  Chunk.prototype._convertScatteredBlocksToMeshData = function(scatteredBlocks, visibleKeys, structureCenters) {
    if (!scatteredBlocks || scatteredBlocks.length === 0) return [];

    // 按 type 分组（只渲染 visibleKeys 中的方块，跨 chunk 结构方块除外）
    const groupedByType = {};
    for (const block of scatteredBlocks) {
      const code = Chunk.encodeCoord(block.x, block.y, block.z);
      if (visibleKeys && visibleKeys.size > 0 && !visibleKeys.has(code)) {
        if (!structureCenters?.length || !belongsToCrossChunkStructure(block.x, block.y, block.z, structureCenters)) continue;
      }
      if (!groupedByType[block.type]) groupedByType[block.type] = [];
      groupedByType[block.type].push(block);
    }

    // 转换为 meshData 格式
    const meshData = [];
    const dummy = new THREE.Object3D();
    for (const [type, blocks] of Object.entries(groupedByType)) {
      const count = blocks.length;
      if (count === 0) continue;

      const matrices = new Float32Array(count * 16);
      const aoLow = new Float32Array(count);
      const aoHigh = new Float32Array(count);
      const orientation = new Float32Array(count);
      const instanceIndexMap = {};

      for (let i = 0; i < count; i++) {
        const b = blocks[i];
        if (b.matrix) {
          matrices.set(b.matrix, i * 16);
        } else {
          dummy.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
          dummy.rotation.set(0, getRotationAngle(b.orientation || 0), 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          matrices.set(dummy.matrix.elements, i * 16);
        }
        aoLow[i] = b.aoLow;
        aoHigh[i] = b.aoHigh;
        orientation[i] = b.orientation;
        const code = Chunk.encodeCoord(b.x, b.y, b.z);
        instanceIndexMap[code] = i;
      }

      meshData.push({ type, count, matrices, aoLow, aoHigh, orientation, instanceIndexMap });
    }

    return meshData;
  };

  /**
   * 过滤 Worker 返回的结果，防止幻影方块
   * 核心原则：只保留 blockData 中存在的方块，避免已删除的跨Chunk实体方块被重新生成
   */
  Chunk.prototype._filterWorkerResult = function(data) {
    return filterWorkerResultAgainstBlockData(data, this.blockData);
  };

  /**
   * 同步可见性状态与碰撞状态
   */
  Chunk.prototype._syncVisibilityAndCollision = function(visibleKeys, solidBlocks) {
    // 内存优化：复用现有 Set，避免创建新对象
    if (!this.visibleKeys) this.visibleKeys = new Set();
    if (!this.solidBlocks) this.solidBlocks = new Set();

    if (visibleKeys) {
      this.visibleKeys.clear();
      for (const code of visibleKeys) {
        this.visibleKeys.add(code);
      }
      for (const code of this.dynamicMeshes.keys()) {
        this.visibleKeys.add(code);
      }
    }

    if (solidBlocks) {
      this.solidBlocks.clear();
      for (const code of solidBlocks) {
        this.solidBlocks.add(code);
      }
      for (const [code, mesh] of this.dynamicMeshes.entries()) {
        const type = mesh.userData.type;
        if (this.blockData.get(code) && getBlockProps(type).isSolid) {
          this.solidBlocks.add(code);
        }
      }
      if (this.entityCollisionIndex?.size > 0) {
        for (const key of this.entityCollisionIndex.keys()) {
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

    // 移除旧的 InstancedMesh（保留树木和树叶）
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (child.isInstancedMesh) {
        const type = child.userData.type;
        // 保留特殊实体和树叶（树叶是静态的，不应在合并时重建）
        if (type === 'modGunMan' || type === 'rover' ||
            type === 'leaves' || type === 'azalea_leaves' || type === 'azalea_flowers' ||
            type === 'sky_leaves' || type === 'yellow_leaves' || type === 'swamp_leaves' ||
            type === 'snow_leaves') {
          continue;
        }
        if (child.geometry && child.geometry !== geomMap[type] && child.geometry !== geomMap['default']) {
          child.geometry.dispose();
        }
        this.group.remove(child);
      }
    }
  };
}
