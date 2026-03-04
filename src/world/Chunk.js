// src/world/Chunk.js
/**
 * 区块管理器 - 负责区块的生成、渲染和管理
 * 使用 InstancedMesh 优化渲染性能，管理区块内的所有方块和实体
 */
import * as THREE from 'three';
import { materials } from '../core/MaterialManager.js';
import { RealisticTree } from './entities/RealisticTree.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { persistenceService } from '../services/PersistenceService.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { faceCullingSystem } from '../core/FaceCullingSystem.js';
import { carModel, gunManModel } from '../core/Engine.js';
import { getBlockProperties } from '../constants/BlockData.js';
import { getRotationAngle, parseBlockEntry, serializeBlockEntry } from '../utils/OrientationUtils.js';
import { StructureUtils, getStructureRenderDist, belongsToStructure } from '../utils/StructureUtils.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;
const getFaceCullingSystem = () => globalThis._faceCullingSystem || faceCullingSystem;
const getMaterials = () => globalThis._materials || materials;
const getCarModel = () => globalThis._carModel || carModel;
const getGunManModel = () => globalThis._gunManModel || gunManModel;

// 获取方块属性函数 - 优先使用测试环境的模拟
function getBlockProps(type) {
  if (globalThis._blockData && typeof globalThis._blockData.getBlockProperties === 'function') {
    return globalThis._blockData.getBlockProperties(type);
  }
  return getBlockProperties(type);
}

/** 区块尺寸 - 每个区块在 X 和 Z 方向上的方块数量 (16x16 是 Voxel 游戏的标准区块大小) */
const CHUNK_SIZE = 16;

/** 后台合并触发阈值 - 当动态添加的方块数量达到此值时，强制触发合并 */
const DIRTY_THRESHOLD = 50;
/** 后台合并延迟 (ms) - 玩家最后一次操作后的等待时间 */
const CONSOLIDATION_DELAY = 1000;

// --- Worker 设置 ---
// 使用 Web Worker 处理计算密集型的地形生成，避免阻塞主线程（UI/渲染线程）
const worldWorker = new Worker(new URL('../workers/WorldWorker.js', import.meta.url), { type: 'module' });
const faceCullingWorker = new Worker(new URL('../workers/FaceCullingWorker.js', import.meta.url), { type: 'module' });
const workerCallbacks = new Map(); // 用于跟踪异步生成请求的回调函数
const faceCullingCallbacks = new Map(); // 用于跟踪隐藏面剔除请求的回调函数

    worldWorker.onmessage = (e) => {
  const { cx, cz, d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys, snapshot, structureCenters } = e.data;
  const key = `${cx},${cz}`;
  if (workerCallbacks.has(key)) {
    workerCallbacks.get(key)({ d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys, snapshot, structureCenters });
    workerCallbacks.delete(key);
  }
};

// 处理隐藏面剔除Worker的消息
faceCullingWorker.onmessage = (e) => {
  const { type, messageType, data, error, id } = e.data;

  if (type === 'RESULT' && faceCullingCallbacks.has(id)) {
    const callback = faceCullingCallbacks.get(id);
    faceCullingCallbacks.delete(id);
    callback(null, data);
  } else if (type === 'ERROR' && faceCullingCallbacks.has(id)) {
    const callback = faceCullingCallbacks.get(id);
    faceCullingCallbacks.delete(id);
    callback(new Error(error), null);
  }
};

worldWorker.onerror = (e) => {
  console.error('WorldWorker Error:', e);
  console.error('Error details:', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: e.error
  });
};

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
// 藤蔓的几何体（交叉平面，无偏移，使藤蔓看起来附着在方块上）
const geoVine = buildCrossGeo(0);

// 垂落叶片的几何体（顶部对齐到0.5以接触上方方块）
// 高度1.0 -> 半高0.5。需要的偏移：0.5 - 0.5 = 0
// const geoHanging = buildCrossGeo(0); // 未使用

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
  const barZ = new THREE.BoxGeometry(0.15, 0.15, 1);
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
 * 几何体映射表 - 将方块类型映射到对应的几何体
 */
const geomMap = {
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
  'pillar': geoPillar,
  'planks_step': geoPlanksStep,
  'cobblestone_step': geoCobblestoneStep,
  'stone_diorite_step': geoCobblestoneStep,
  'default': addVertexIdAttribute(new THREE.BoxGeometry(1, 1, 1))
};

/**
 * 区块类 - 负责单个区块的生成、管理和渲染
 * 采用 InstancedMesh 架构：相同类型的方块在同一个区块内仅通过一次绘制调用（Draw Call）渲染
 * 支持动态更新与后台合并优化系统
 */
export class Chunk {
  /**
   * 创建区块实例
   * @param {number} cx - 区块的 X 坐标（区块空间坐标，世界坐标 / 16）
   * @param {number} cz - 区块的 Z 坐标（区块空间坐标）
   * @param {World} world - 对所属 World 实例的引用，用于跨区块通信和资源访问
   */
  constructor(cx, cz, world) {
    this.cx = cx;                    // 区块的X坐标
    this.cz = cz;                    // 区块的Z坐标
    this.world = world;              // 世界引用
    this.group = new THREE.Group();  // Three.js 组，包含区块内所有网格
    this.keys = [];                  // 区块标识符（当前未使用）
    this.solidBlocks = new Set();    // 实心方块的集合，用于碰撞检测
    this.blockData = {};             // 全量方块类型数据
    this.visibleKeys = new Set();    // 当前已渲染方块的 Key 集合
    this.isReady = false;            // 区块是否已完成生成
    this.instanceIndexMap = new Map(); // Key: "type" -> Map("x,y,z" -> index)
    this.saveTimeout = null;         // 用于防抖保存

    // 存储实体数据，用于合并优化
    this.entities = {
      realisticTrees: [],
      modGunMan: [],
      rovers: []
    };

    // 存储结构中心点列表，用于跨 Chunk 碰撞体生成
    this.structureCenters = [];
    this._tempOriginalSolidBlocks = null; // 临时存储 Worker 原始返回的 solidBlocks

    // --- 后台合并系统 (Background Consolidation) ---
    this.dirtyBlocks = 0;            // 未优化的动态方块计数
    this.consolidationTimer = null;  // 合并防抖定时器
    this.isConsolidating = false;    // 是否正在合并中
    this.dynamicMeshes = new Map();  // 存储动态生成的单体 Mesh: Key "x,y,z" -> Mesh

    this.gen();                      // 生成区块内容
  }

  /**
   * 调度后台合并任务
   * 实现防抖和阈值立即触发逻辑
   */
  scheduleConsolidation() {
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
  }

  /**
   * 执行区块合并优化
   * 将当前区块的所有逻辑数据发送回 Worker，重新计算所有方块的可见面（Face Culling）和 AO
   * 生成全新的 InstancedMesh 并替换掉当前分散的动态 Mesh
   */
  async consolidate() {
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
  }

  /**
   * 应用 Worker 返回的合并结果
   * @param {Object} data - Worker 返回的数据
   * @param {number} consolidatedCount - 合并前的脏方块数量
   * @param {Set} consolidatedMeshKeys - 合并前的动态 Mesh 键集合
   */
  _applyConsolidateResult(data, consolidatedCount, consolidatedMeshKeys) {
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
  }

  /**
   * 过滤 Worker 返回的结果，防止幻影方块
   */
  _filterWorkerResult(data) {
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
  }

  /**
   * 同步可见性状态与碰撞状态
   */
  _syncVisibilityAndCollision(visibleKeys, solidBlocks) {
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
  }

  /**
   * 保存宝箱状态
   */
  _saveChestStates() {
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
  }

  /**
   * 恢复宝箱状态
   */
  _restoreChestStates(savedChestStates) {
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
  }

  /**
   * 清理旧的网格
   */
  _cleanupOldMeshes(consolidatedMeshKeys) {
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
  }

  /**
   * 生成区块内容
   * 将计算压力较大的地形和结构生成逻辑分解到 Worker 线程中执行
   */
  async gen() {
    // 0. 加载持久化全量数据 (快照)
    const snapshot = await getPersistenceService().getChunkData(this.cx, this.cz);

    return new Promise((resolve) => {
      const callbackKey = `${this.cx},${this.cz}`;

      // 注册 Worker 回调
      workerCallbacks.set(callbackKey, (data) => {
        const { d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys, snapshot: newSnapshot, structureCenters } = data;

        // 1. 同步全量方块数据和可见性状态 (完全替换，确保剔除状态同步)
        if (allBlockTypes) this.blockData = allBlockTypes;
        if (visibleKeys) {
          this.visibleKeys = new Set(visibleKeys);
        }
        if (solidBlocks) {
          this.solidBlocks = new Set(solidBlocks);
        }

        // 1.1 保存结构中心列表，用于跨 Chunk 碰撞体生成
        this.structureCenters = structureCenters || [];

        // 1.2 保存实体快照，用于后续合并
        this.entities.realisticTrees = realisticTrees || [];
        this.entities.modGunMan = modGunMan || [];
        this.entities.rovers = rovers || [];

        // 2. 构建渲染网格 (InstancedMesh)
        this.buildMeshes(d);

        // 3. 处理真实感树木 (在主线程生成，因为涉及复杂 Mesh 克隆)
        // 使用实例化渲染优化：记录树木数据，后续批量创建 InstancedMesh
        realisticTrees.forEach(pos => {
          RealisticTree.generate(pos.x, pos.y, pos.z, this, null, true);
        });

        // 3.0 创建实例化树木网格（替换克隆的 Mesh）
        const instancedResult = RealisticTree.createInstancedForChunk(this);
        if (instancedResult) {
          console.log(`Chunk ${this.cx},${this.cz}: Created ${instancedResult.trunkCount} instanced trees`);
        }

        // 3.1 处理模型人 (gun_man.glb)
        if (modGunMan && modGunMan.length > 0 && getGunManModel()) {
          modGunMan.forEach(pos => {
            const gm = getGunManModel().clone();
            if (!gm) return; // 测试环境中可能为 null
            gm.userData.isEntity = true;
            gm.userData.type = 'modGunMan';
            gm.position.set(pos.x + 0.5, pos.y, pos.z + 0.5);

            // 确保可见性
            gm.traverse(child => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.frustumCulled = false;
              }
            });

            // 添加碰撞体：1x1x2
            const collisionBlocks = [];
            for (let dy = 0; dy < 2; dy++) {
              collisionBlocks.push({ x: pos.x, y: pos.y + dy, z: pos.z });
            }

            // 批量应用碰撞块
            collisionBlocks.forEach(b => {
              this.addBlockDynamic(b.x, b.y, b.z, 'collider');
            });

            gm.userData.collisionBlocks = collisionBlocks;
            this.group.add(gm);
          });
        }

        // 3.1 处理火星车模型
        if (rovers && rovers.length > 0 && getCarModel()) {
          rovers.forEach(pos => {
            const car = getCarModel().clone();
            if (!car) return; // 测试环境中可能为 null
            car.userData.isEntity = true;
            car.userData.type = 'rover';
            // 放置在方块顶部中心，注意模型已经处理过，基座在 (0,0,0)
            car.position.set(pos.x + 0.5, pos.y, pos.z + 0.5);

            // 添加碰撞体：火星车尺寸为 5x3x3 (长Z, 高Y, 宽X)
            // 我们以 pos 为基准，模型居中放置
            const collisionBlocks = [];
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = 0; dy < 3; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                  collisionBlocks.push({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz });
                  this.addBlockDynamic(pos.x + dx, pos.y + dy, pos.z + dz, 'collider');
                }
              }
            }
            car.userData.collisionBlocks = collisionBlocks;
            this.group.add(car);
          });
        }

        // 4. 重要：在生成完成后，立即保存快照数据
        if (newSnapshot) {
          getPersistenceService().saveChunkData(this.cx, this.cz, newSnapshot);
        }

        this.isReady = true;
        resolve();
      });

      // 4. 发送生成请求到 Worker
      worldWorker.postMessage({
        cx: this.cx,
        cz: this.cz,
        seed: WORLD_CONFIG.SEED,
        snapshot
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
  add(x, y, z, type, dObj = null, solid = true, orientation = 0) {
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
   * 构建所有网格 - 将收集的方块位置转换为 Three.js 网格
   * 使用 InstancedMesh 优化相同类型方块的渲染性能：
   * 1. 对于每个方块类型，只创建一个 InstancedMesh 实例。
   * 2. 通过一次 Draw Call 渲染该区块内所有的该类方块。
   * @param {Object} d - 数据收集对象，包含按类型分类的方块位置数组
   * @param {boolean} skipEntities - 是否跳过实体生成逻辑（用于合并优化）
   */
  buildMeshes(d) {
    // 创建一个虚拟对象用于计算每个实例的变换矩阵 (Matrix4)
    const dummy = new THREE.Object3D();

    // 遍历每种方块类型，为每种类型创建一个 InstancedMesh
    for (const type in d) {
      const props = getBlockProps(type);
      if (d[type].length === 0 || !props.isRendered) continue;  // 跳过没有任何实例或不需渲染的方块类型

      // 从材质管理器和几何体映射表获取资源
      const geometry = geomMap[props.geometryType] || geomMap['default'];
      const material = getMaterials().getMaterial(type);
      // 创建实例化网格：指定几何体、材质和实例总数
      const mesh = new THREE.InstancedMesh(geometry, material, d[type].length);

      // --- 添加 AO 属性 ---
      // AO 适用于所有实心且不透明的方块
      if (props.isSolid && !props.isTransparent) {
        const aoLowArray = new Float32Array(d[type].length);
        const aoHighArray = new Float32Array(d[type].length);
        d[type].forEach((pos, i) => {
          aoLowArray[i] = pos.aoLow || 0;
          aoHighArray[i] = pos.aoHigh || 0;
        });
        // 必须在 geometry 上克隆或者直接设置，InstancedMesh 共享 geometry 会有问题
        // 但这里我们使用的是共享几何体，所以我们需要为每个 InstancedMesh 唯一的属性
        // 实际上 InstancedBufferAttribute 就是为此设计的
        mesh.geometry = geometry.clone(); // 克隆几何体以拥有独立的属性
        mesh.geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(aoLowArray, 1));
        mesh.geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(aoHighArray, 1));
      }

      // 存储元数据，便于后续通过 Raycaster 进行交互识别
      mesh.userData = { type: type };
      if (type === 'chest') {
        mesh.userData.chests = {}; // 如果是箱子，初始化一个子对象存储每个箱子的开启状态
      }

    // 为每个实例设置位置矩阵
    // 跳过树木类型，因为树木的 instanceIndexMap 已经在 createInstancedTreesForChunk 中设置
    if (type !== 'realistic_trunk' && type !== 'realistic_leaves') {
      this.instanceIndexMap[type] = new Map();
    }
    d[type].forEach((pos, i) => {
      // 核心偏移：将模型中心对齐到方块中心 (增加 0.5 偏移)
      dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      // 应用朝向旋转（如果有）
      const orientation = pos.orientation || 0;
      dummy.rotation.set(0, getRotationAngle(orientation), 0);
      dummy.updateMatrix();                     // 根据位置和旋转生成变换矩阵
      mesh.setMatrixAt(i, dummy.matrix);        // 将矩阵写入实例化缓冲区

      const posKey = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      this.instanceIndexMap[type].set(posKey, i);

      if (type === 'chest') {
        mesh.userData.chests[i] = { open: false }; // 初始化对应索引箱子的状态
      }
    });

    // 重要：标记 instanceMatrix 需要更新，否则 GPU 不会重新加载数据
    mesh.instanceMatrix.needsUpdate = true;

      // 阴影配置优化
      if(props.isShadowEnabled) {
        mesh.castShadow = true;    // 开启实时阴影投射
        mesh.receiveShadow = true; // 开启实时阴影接收
      }

      // 将实例化网格添加到区块的分S组中
      this.group.add(mesh);
    }
  }

  /**
   * 清理资源 - 释放几何体和材质，防止内存泄漏
   * 在区块不再需要时调用
   */
  dispose() {
    // 清除合并定时器
    if (this.consolidationTimer) {
      clearTimeout(this.consolidationTimer);
      this.consolidationTimer = null;
    }

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
  }

  /**
   * 防抖保存区块数据
   */
  saveDebounced() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      getPersistenceService().saveChunkData(this.cx, this.cz);
      this.saveTimeout = null;
    }, 500);
  }

  // ============================================================
  // addBlockDynamic 辅助方法
  // ============================================================

  /**
   * 检查指定位置是否在当前 Chunk 的责任范围内
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {boolean} 是否在责任范围内（Chunk 内或属于当前 Chunk 负责的结构）
   */
  _isInResponsibility(x, y, z) {
    const localX = Math.floor(x) - this.cx * CHUNK_SIZE;
    const localZ = Math.floor(z) - this.cz * CHUNK_SIZE;
    const isInChunk = localX >= 0 && localX < CHUNK_SIZE && localZ >= 0 && localZ < CHUNK_SIZE;

    if (isInChunk) return true;

    // 检查是否属于当前 Chunk 负责的结构
    if (this.structureCenters && this.structureCenters.length > 0) {
      return belongsToStructure(x, y, z, this.structureCenters);
    }

    return false;
  }

  /**
   * 更新方块的数据状态（blockData, visibleKeys, solidBlocks）
   * @param {string} key - 方块键
   * @param {string} type - 方块类型
   * @param {Object} entry - 方块条目
   */
  _updateBlockState(key, type, entry) {
    if (type === 'air') {
      delete this.blockData[key];
      this.visibleKeys.delete(key);
    } else {
      this.blockData[key] = entry;
      this.visibleKeys.add(key);
    }

    // 更新碰撞体集合
    const props = getBlockProps(type);
    if (props.isSolid) {
      this.solidBlocks.add(key);
    } else {
      this.solidBlocks.delete(key);
    }
  }

  /**
   * 从 InstancedMesh 中移除指定位置的方块实例
   * @param {string} key - 方块键
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} oldType - 旧方块类型
   * @returns {boolean} 是否成功移除
   */
  _removeInstancedMeshBlock(key, x, y, z, oldType) {
    if (!oldType) return false;

    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (!child.isInstancedMesh || child.userData.type !== oldType) continue;

      const typeMap = this.instanceIndexMap[oldType];
      if (typeMap && typeMap.has(key)) {
        const idx = typeMap.get(key);
        const dummy = new THREE.Matrix4();
        dummy.makeScale(0, 0, 0);
        child.setMatrixAt(idx, dummy);
        child.instanceMatrix.needsUpdate = true;
        typeMap.delete(key);
        return true;
      } else {
        // Fallback: 慢速搜索
        const dummy = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        for (let j = 0; j < child.count; j++) {
          child.getMatrixAt(j, dummy);
          pos.setFromMatrixPosition(dummy);
          if (Math.floor(pos.x) === Math.floor(x) &&
              Math.floor(pos.y) === Math.floor(y) &&
              Math.floor(pos.z) === Math.floor(z)) {
            dummy.makeScale(0, 0, 0);
            child.setMatrixAt(j, dummy);
            child.instanceMatrix.needsUpdate = true;
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * 处理实体移除逻辑（当碰撞体被移除时）
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} oldType - 旧方块类型
   * @returns {boolean} 是否处理了实体移除
   */
  _handleEntityRemoval(x, y, z, oldType) {
    if (oldType !== 'collider') return false;

    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (!child.userData.isEntity || !child.userData.collisionBlocks) continue;

      const isHit = child.userData.collisionBlocks.some(b =>
        Math.floor(b.x) === Math.floor(x) &&
        Math.floor(b.y) === Math.floor(y) &&
        Math.floor(b.z) === Math.floor(z)
      );

      if (isHit) {
        this.group.remove(child);
        child.userData.collisionBlocks.forEach(b => {
          const bKey = `${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`;
          if (this.blockData[bKey] === 'collider') {
            this.removeBlock(b.x, b.y, b.z);
          }
        });
        return true;
      }
    }
    return false;
  }

  /**
   * 处理 RealisticTree 实例化树木移除逻辑
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} oldType - 旧方块类型
   */
  _handleRealisticTreeRemoval(x, y, z, oldType) {
    if (oldType !== 'realistic_trunk_collider') return;

    const posKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const dummy = new THREE.Matrix4();
    dummy.makeScale(0, 0, 0);

    // 隐藏树干实例
    const trunkMesh = this.group.children.find(c => c.isInstancedMesh && c.userData.type === 'realistic_trunk');
    if (trunkMesh && this.instanceIndexMap['realistic_trunk']) {
      const idx = this.instanceIndexMap['realistic_trunk'].get(posKey);
      if (idx !== undefined) {
        trunkMesh.setMatrixAt(idx, dummy);
        trunkMesh.instanceMatrix.needsUpdate = true;
      }
    }

    // 隐藏树叶实例
    const leavesMesh = this.group.children.find(c => c.isInstancedMesh && c.userData.type === 'realistic_leaves');
    if (leavesMesh && this.instanceIndexMap['realistic_leaves']) {
      const idx = this.instanceIndexMap['realistic_leaves'].get(posKey);
      if (idx !== undefined) {
        leavesMesh.setMatrixAt(idx, dummy);
        leavesMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * 移除指定位置的动态网格
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} key - 方块键
   */
  _removeDynamicMesh(x, y, z, key) {
    const matchX = Math.floor(x);
    const matchY = Math.floor(y);
    const matchZ = Math.floor(z);

    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (child.isInstancedMesh || child.userData.isEntity) continue;

      if (Math.floor(child.position.x) === matchX &&
          Math.floor(child.position.y) === matchY &&
          Math.floor(child.position.z) === matchZ) {

        this.dynamicMeshes.delete(key);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
        this.group.remove(child);
      }
    }
  }

  /**
   * 当方块被移除时，唤醒周围被隐藏的邻居方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   */
  _revealNeighbors(x, y, z) {
    const neighbors = [
      { dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 },
      { dx: 0, dy: 1, dz: 0 }, { dx: 0, dy: -1, dz: 0 },
      { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 }
    ];

    for (const offset of neighbors) {
      const nx = x + offset.dx;
      const ny = y + offset.dy;
      const nz = z + offset.dz;

      const nCx = Math.floor(nx / CHUNK_SIZE);
      const nCz = Math.floor(nz / CHUNK_SIZE);

      if (nCx === this.cx && nCz === this.cz) {
        const nKey = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
        if (this.blockData[nKey]) {
          if (!this.visibleKeys.has(nKey)) {
            this.addBlockDynamic(nx, ny, nz, this.blockData[nKey]);
          } else {
            this._triggerFaceCullingUpdate(nx, ny, nz, this.blockData[nKey]);
          }
        }
      } else {
        const neighborChunkKey = `${nCx},${nCz}`;
        const neighborChunk = this.world.chunks.get(neighborChunkKey);
        if (neighborChunk && neighborChunk.isReady) {
          neighborChunk.checkReveal(nx, ny, nz);
        }
      }
    }
  }

  /**
   * 创建动态方块的网格
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} key - 方块键
   * @param {string} type - 方块类型
   * @param {number} orientation - 方块朝向
   * @returns {THREE.Mesh|null} 创建的网格或 null
   */
  _createDynamicBlockMesh(x, y, z, key, type, orientation) {
    const props = getBlockProps(type);
    if (!props.isRendered || !this.visibleKeys.has(key)) {
      return null;
    }

    const geometry = geomMap[props.geometryType] || geomMap['default'];
    let material = getMaterials().getMaterial(type);

    if (material) {
      if (Array.isArray(material)) {
        material = material.map(m => m.clone());
      } else {
        material = material.clone();
      }
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);
    mesh.rotation.set(0, getRotationAngle(orientation), 0);
    mesh.userData = { type, orientation };
    mesh.frustumCulled = false;

    // 设置 AO 属性
    // AO 适用于所有实心且不透明的方块
    if (props.isSolid && !props.isTransparent) {
      mesh.geometry = geometry.clone();
      const count = mesh.geometry.attributes.position.count;

      // 计算 AO
      const aoLowArray = new Float32Array(count);
      const aoHighArray = new Float32Array(count);

      // 辅助函数：判断是否遮挡
      const isOccluding = (ox, oy, oz) => {
        const cx = Math.floor(ox / CHUNK_SIZE);
        const cz = Math.floor(oz / CHUNK_SIZE);
        let chunk = (cx === this.cx && cz === this.cz) ? this : this.world.chunks.get(`${cx},${cz}`);

        // 核心修复：即使 Chunk 未 Ready，只要 blockData 中有数据，就应该使用
        if (!chunk) return true; // 邻居 Chunk 不存在，默认为实体(遮挡)，避免死白

        const key = `${Math.floor(ox)},${Math.floor(oy)},${Math.floor(oz)}`;
        const entry = chunk.blockData[key];

        if (entry) {
          const type = typeof entry === 'string' ? entry : entry.type;
          const p = getBlockProps(type);
          return p.isSolid && !p.isTransparent;
        }

        // 如果 blockData 中没有该方块
        if (chunk.isReady) {
           // Chunk 已加载完成且没有该记录 -> 确实是空气
           return false;
        } else {
           // Chunk 未加载完成且没有该记录 -> 未知区域
           // 在这种情况下，默认为实体(遮挡)通常比默认为空气(发光)视觉效果更好
           // 尤其是在山体和地下
           return true;
        }
      };

      // 辅助函数：计算 AO 值 (0-3)
      const getAOValue = (side1, side2, corner) => {
        const s1 = side1 ? 1 : 0;
        const s2 = side2 ? 1 : 0;
        const c = (side1 || side2) ? (corner ? 1 : 0) : 0;
        if (s1 && s2) return 0;
        return 3 - (s1 + s2 + c);
      };

      // 计算每个面的 AO
      const getAO = (faceIdx) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const iz = Math.floor(z);
        const aos = new Uint8Array(4).fill(3);

        if (faceIdx === 0) { // px (+X side)
          aos[0] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix+1, iy, iz+1), isOccluding(ix+1, iy+1, iz+1));
          aos[1] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix+1, iy, iz-1), isOccluding(ix+1, iy+1, iz-1));
          aos[2] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix+1, iy, iz+1), isOccluding(ix+1, iy-1, iz+1));
          aos[3] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix+1, iy, iz-1), isOccluding(ix+1, iy-1, iz-1));
        } else if (faceIdx === 1) { // nx (-X side)
          aos[0] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix-1, iy, iz-1), isOccluding(ix-1, iy+1, iz-1));
          aos[1] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix-1, iy, iz+1), isOccluding(ix-1, iy+1, iz+1));
          aos[2] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix-1, iy, iz-1), isOccluding(ix-1, iy-1, iz-1));
          aos[3] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix-1, iy, iz+1), isOccluding(ix-1, iy-1, iz+1));
        } else if (faceIdx === 2) { // py (+Y top)
          aos[0] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix, iy+1, iz-1), isOccluding(ix-1, iy+1, iz-1));
          aos[1] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix, iy+1, iz-1), isOccluding(ix+1, iy+1, iz-1));
          aos[2] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix, iy+1, iz+1), isOccluding(ix-1, iy+1, iz+1));
          aos[3] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix, iy+1, iz+1), isOccluding(ix+1, iy+1, iz+1));
        } else if (faceIdx === 3) { // ny (-Y bottom)
          aos[0] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix, iy-1, iz+1), isOccluding(ix-1, iy-1, iz+1));
          aos[1] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix, iy-1, iz+1), isOccluding(ix+1, iy-1, iz+1));
          aos[2] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix, iy-1, iz-1), isOccluding(ix-1, iy-1, iz-1));
          aos[3] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix, iy-1, iz-1), isOccluding(ix+1, iy-1, iz-1));
        } else if (faceIdx === 4) { // pz (+Z side)
          aos[0] = getAOValue(isOccluding(ix-1, iy, iz+1), isOccluding(ix, iy+1, iz+1), isOccluding(ix-1, iy+1, iz+1));
          aos[1] = getAOValue(isOccluding(ix+1, iy, iz+1), isOccluding(ix, iy+1, iz+1), isOccluding(ix+1, iy+1, iz+1));
          aos[2] = getAOValue(isOccluding(ix-1, iy, iz+1), isOccluding(ix, iy-1, iz+1), isOccluding(ix-1, iy-1, iz+1));
          aos[3] = getAOValue(isOccluding(ix+1, iy, iz+1), isOccluding(ix, iy-1, iz+1), isOccluding(ix+1, iy-1, iz+1));
        } else if (faceIdx === 5) { // nz (-Z side)
          aos[0] = getAOValue(isOccluding(ix+1, iy, iz-1), isOccluding(ix, iy+1, iz-1), isOccluding(ix+1, iy+1, iz-1));
          aos[1] = getAOValue(isOccluding(ix-1, iy, iz-1), isOccluding(ix, iy+1, iz-1), isOccluding(ix-1, iy+1, iz-1));
          aos[2] = getAOValue(isOccluding(ix+1, iy, iz-1), isOccluding(ix, iy-1, iz-1), isOccluding(ix+1, iy-1, iz-1));
          aos[3] = getAOValue(isOccluding(ix-1, iy, iz-1), isOccluding(ix, iy-1, iz-1), isOccluding(ix-1, iy-1, iz-1));
        }
        return aos;
      };

      // 填充 AO 数组
      for (let f = 0; f < 6; f++) {
        const aos = getAO(f);
        for (let v = 0; v < 4; v++) {
          const vertexIdx = f * 4 + v;
          if (vertexIdx < count) { // 安全检查
             // 注意：这里我们模拟 Worker 中的位打包逻辑
             // 但由于这是单体 Mesh，我们其实只需要正确设置 attributes
             // Worker 中打包是为了 InstanceBufferAttribute
             // 这里我们需要将计算出的 AO 值 (0-3) 映射到 shader 期望的格式

             // 等等，原逻辑是：
             // aoLowArray.fill(16777215); // 全白

             // 在 WorldWorker.js 中：
             // aoLow |= (aoVal << (vertexIdx * 2));

             // InstancedMesh 使用的是打包后的整数 (Uint32 拆分为两个 Float传给 shader)
             // 但这里是普通 Mesh，使用的也是 aoLow/aoHigh 属性名
             // 着色器代码 (block_fragment.glsl/vertex) 对 Instanced 和 非Instanced 处理是一致的吗？
             // 通常动态 Mesh 会复用相同的 Material/Shader。

             // 如果复用相同的 Material，那么 shader 期望的 attribute 格式必须一致。
             // InstancedMesh: aAoLow 是 InstancedBufferAttribute (每个实例一个值) -> 这里的逻辑似乎不同？

             // 让我们再看 Chunk.js buildMeshes 中的逻辑：
             // mesh.geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(aoLowArray, 1));
             // aoLowArray[i] = pos.aoLow;

             // 而在 _createDynamicBlockMesh 中：
             // mesh.geometry.setAttribute('aAoLow', new THREE.BufferAttribute(aoLowArray, 1));
             // 注意这里是 BufferAttribute，不是 InstancedBufferAttribute。
             // 这意味着每个顶点都有自己的 aoLow 值？

             // 不，WorldWorker 中是为每个实例计算一个 aoLow (32位整数，包含12个顶点的AO值)
             // 对于普通 Mesh，如果是 BoxGeometry，它有 24 个顶点 (6面 * 4顶)。
             // 着色器如何知道当前顶点对应 AO 包中的哪两位？
             // 它是通过 aVertexId 来索引的！

             // 请看 addVertexIdAttribute 函数：
             // vertexIds[i] = i;
             // 0-23

             // 所以我们需要构建一个整数，使得 shader 能通过 vertexId 取出对应的 2bit AO 值。
             // 既然这是一个单体 Mesh，其实我们不需要像 InstancedMesh 那样打包所有顶点的 AO 到一个整数里传给每个顶点。
             // 我们直接给每个顶点赋 AO 值不行吗？

             // 还要看 Shader 的实现。如果 Shader 是设计为解码整数的：
             // float getAO(float aoPacked, int vertexId) { ... }

             // 那么我们必须模拟这种打包。
             // 对于单体 Mesh，所有顶点的 aAoLow/aAoHigh 应该是相同的吗？
             // 不，对于 InstancedMesh，每个实例有一个 aAoLow，实例内的所有顶点共享这个值（通过 divisor 自动处理？不，InstancedBufferAttribute 是 per-instance 的）。
             // 是的，在 InstancedMesh 中，VS 对每个顶点执行，读取的是当前 Instance 的 aAoLow。

             // 此时，在单体 Mesh 中，我们使用 BufferAttribute。
             // 这意味着我们需要为每个顶点提供数据。
             // 为了让 Shader 正常工作（它期望一个打包整数），我们需要：
             // 为这个 Mesh 的 *所有* 顶点，都赋值 *同一个* 打包好的 AO 整数！

             const aoVal = aos[v];
             // 重新计算打包整数
          }
        }
      }

      let aoLow = 0;
      let aoHigh = 0;
      for (let f = 0; f < 6; f++) {
          const aos = getAO(f);
          for (let v = 0; v < 4; v++) {
            const vertexIdx = f * 4 + v;
            const aoVal = aos[v];
            if (vertexIdx < 12) aoLow |= (aoVal << (vertexIdx * 2));
            else aoHigh |= (aoVal << ((vertexIdx - 12) * 2));
          }
      }

      // 将计算出的打包值填充给所有顶点
      aoLowArray.fill(aoLow);
      aoHighArray.fill(aoHigh);

      mesh.geometry.setAttribute('aAoLow', new THREE.BufferAttribute(aoLowArray, 1));
      mesh.geometry.setAttribute('aAoHigh', new THREE.BufferAttribute(aoHighArray, 1));
    }

    // 设置阴影
    if (props.isShadowEnabled) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    return mesh;
  }

  /**
   * 动态添加单个方块（与批量生成相对）
   * 用于游戏运行时玩家放置方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string|object} typeOrEntry - 方块类型或完整条目对象 { type, orientation }
   * @param {number} [orientation=0] - 朝向 (0-3)，当 typeOrEntry 为字符串时使用
   */
  addBlockDynamic(x, y, z, typeOrEntry, orientation = 0) {
    // 1. 解析参数
    const entry = typeof typeOrEntry === 'string'
      ? { type: typeOrEntry, orientation }
      : parseBlockEntry(typeOrEntry);
    const { type } = entry;
    const blockOrientation = entry.orientation || 0;
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

    // 2. 边界检查（跨 Chunk）
    if (!this._isInResponsibility(x, y, z)) return;

    // 3. 获取旧方块信息
    const oldEntry = this.blockData[key];
    const oldParsed = parseBlockEntry(oldEntry);
    const oldType = oldParsed.type;

    // 4. 更新持久化记录
    getPersistenceService().recordChange(x, y, z, entry);

    // 5. 更新数据状态
    this._updateBlockState(key, type, entry);
    this.saveDebounced();

    // 6. 计算 Face Culling 掩码
    const getNeighborBlock = (nx, ny, nz) => {
      const cx = Math.floor(nx / 16);
      const cz = Math.floor(nz / 16);
      let chunk = (cx === this.cx && cz === this.cz) ? this : this.world.chunks.get(`${cx},${cz}`);
      if (!chunk || !chunk.isReady) return null;
      const nKey = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
      const nEntry = chunk.blockData[nKey];
      if (!nEntry) return null;
      const parsed = parseBlockEntry(nEntry);
      return { type: parsed.type, orientation: parsed.orientation };
    };

    const getNeighborsOf = (nx, ny, nz) => ({
      top: getNeighborBlock(nx, ny + 1, nz),
      bottom: getNeighborBlock(nx, ny - 1, nz),
      north: getNeighborBlock(nx, ny, nz - 1),
      south: getNeighborBlock(nx, ny, nz + 1),
      west: getNeighborBlock(nx - 1, ny, nz),
      east: getNeighborBlock(nx + 1, ny, nz)
    });

    let mask = 63;
    const fcSystem = getFaceCullingSystem();
    if (fcSystem && fcSystem.isEnabled() && type !== 'air' && type !== 'collider' && type !== 'chest') {
      const block = { type };
      const neighbors = getNeighborsOf(x, y, z);
      mask = fcSystem.calculateFaceVisibility(block, neighbors);

      if (mask === 0 && !fcSystem.isTransparent(type)) {
        this.visibleKeys.delete(key);
      } else {
        this.visibleKeys.add(key);
      }
    }

    // 7. 移除旧的渲染网格
    this._removeInstancedMeshBlock(key, x, y, z, oldType);
    this._handleEntityRemoval(x, y, z, oldType);
    this._handleRealisticTreeRemoval(x, y, z, oldType);
    this._removeDynamicMesh(x, y, z, key);

    // 8. 如果是移除方块，唤醒邻居
    if (type === 'air') {
      this.dirtyBlocks++;
      this.scheduleConsolidation();
      this._revealNeighbors(x, y, z);
      return;
    }

    // 9. 创建新的动态网格
    const mesh = this._createDynamicBlockMesh(x, y, z, key, type, blockOrientation);
    if (mesh) {
      this.group.add(mesh);
      this.dynamicMeshes.set(key, mesh);
      this.dirtyBlocks++;
      this.scheduleConsolidation();
      mesh.updateMatrix();
      mesh.updateMatrixWorld();
    }

    // 10. 通知 Face Culling 系统更新
    const fcSystem2 = getFaceCullingSystem();
    if (fcSystem2 && fcSystem2.isEnabled()) {
      const position = new THREE.Vector3(x, y, z);
      const block = { type };
      fcSystem2.updateBlock(position, block, getNeighborsOf(x, y, z));
      fcSystem2.updateNeighbors(position, (neighborPos) => {
        const nx = neighborPos.x, ny = neighborPos.y, nz = neighborPos.z;
        const nb = getNeighborBlock(nx, ny, nz);
        if (!nb) return null;
        return { block: nb, neighbors: getNeighborsOf(nx, ny, nz) };
      });
    }
  }

  /**
   * 检查指定位置是否是隐藏方块，如果是则显示它
   */
  checkReveal(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    if (this.blockData[key]) {
      if (!this.visibleKeys.has(key)) {
        this.addBlockDynamic(x, y, z, this.blockData[key]);
      } else {
        // 如果原本可见，跨区块暴露也需要触发 Face Culling 更新
        this._triggerFaceCullingUpdate(x, y, z, this.blockData[key]);
      }
    }
  }

  /**
   * 获取指定位置方块的朝向
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {number} 朝向值 (0-3)，方块不存在时返回 0
   */
  getBlockOrientation(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const entry = this.blockData[key];
    if (!entry) return 0;
    const parsed = parseBlockEntry(entry);
    return parsed.orientation || 0;
  }

  /**
   * 获取指定位置方块的类型
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {{ type: string, orientation: number }|null} 方块信息
   */
  getBlockEntry(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const entry = this.blockData[key];
    if (!entry) return null;
    return parseBlockEntry(entry);
  }

  /**
   * 为跨 Chunk 结构方块重新生成碰撞体
   * 调用时机：在 consolidate() 后，确保所有结构方块的碰撞体都被正确注册
   */
  regenerateCrossChunkColliders() {
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
  }

  /**
   * 获取结构类型的渲染距离
   * @param {string} type - 结构类型
   * @returns {number} 渲染距离
   * @deprecated 使用 StructureUtils.getRenderDist() 代替
   */
  getStructureRenderDist(type) {
    return getStructureRenderDist(type);
  }

  /**
   * 批量移除方块优化
   * @param {Array<{x,y,z}>} positions - 待移除的坐标列表
   */
  removeBlocksBatch(positions) {
    if (positions.length === 0) return;

    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const affectedTypes = new Set();
    const neighborsToUpdate = new Set();

    // 1. 更新逻辑数据和物理数据，并收集需要更新的邻居
    positions.forEach(p => {
      const px = Math.floor(p.x);
      const py = Math.floor(p.y);
      const pz = Math.floor(p.z);
      const key = `${px},${py},${pz}`;
      const oldEntry = this.blockData[key];

      if (oldEntry) {
        // 解析方块类型，兼容新旧格式
        const oldParsed = typeof oldEntry === 'string' ? { type: oldEntry, orientation: 0 } : parseBlockEntry(oldEntry);
        affectedTypes.add(oldParsed.type); // 存储类型字符串，而不是完整对象
        // this.blockData[key] = 'air';
        delete this.blockData[key];
        this.visibleKeys.delete(key);
        this.solidBlocks.delete(key);
        getPersistenceService().recordChange(px, py, pz, 'air');

        // 收集周围 6 个方向的邻居坐标
        const offsets = [
          [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
        ];
        offsets.forEach(([dx, dy, dz]) => {
          const nx = px + dx;
          const ny = py + dy;
          const nz = pz + dz;
          neighborsToUpdate.add(`${nx},${ny},${nz}`);
        });
      }
    });

    // 2. 移除当前待删除方块的渲染网格
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];

      if (child.isInstancedMesh) {
        const type = child.userData.type;
        if (affectedTypes.has(type)) {
          const typeMap = this.instanceIndexMap[type];
          let updated = false;

          if (typeMap) {
            // 优化：使用 Map 直接查找索引，避免扫描全量实例
            positions.forEach(p => {
              const key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
              if (typeMap.has(key)) {
                const idx = typeMap.get(key);
                dummy.makeScale(0, 0, 0);
                child.setMatrixAt(idx, dummy);
                typeMap.delete(key);
                updated = true;
              }
            });
          } else {
            // Fallback: 如果没有 Map，进行全量扫描 (降级处理)
            for (let j = 0; j < child.count; j++) {
              child.getMatrixAt(j, dummy);
              pos.setFromMatrixPosition(dummy);
              const mx = Math.floor(pos.x);
              const my = Math.floor(pos.y);
              const mz = Math.floor(pos.z);

              const isMatch = positions.some(p =>
                Math.floor(p.x) === mx && Math.floor(p.y) === my && Math.floor(p.z) === mz
              );

              if (isMatch) {
                dummy.makeScale(0, 0, 0);
                child.setMatrixAt(j, dummy);
                updated = true;
              }
            }
          }
          if (updated) child.instanceMatrix.needsUpdate = true;
        }
      } else if (child.userData.isEntity) {
        // --- 处理实体批量移除逻辑 (如 TNT 爆炸) ---
        if (child.userData.collisionBlocks) {
          const isHit = child.userData.collisionBlocks.some(b =>
            positions.some(p =>
              Math.floor(p.x) === Math.floor(b.x) &&
              Math.floor(p.y) === Math.floor(b.y) &&
              Math.floor(p.z) === Math.floor(b.z)
            )
          );

          if (isHit) {
            // 1. 从场景中移除实体模型
            this.group.remove(child);

            // 2. 递归移除该实体的所有其他碰撞块，确保逻辑彻底清理
            child.userData.collisionBlocks.forEach(b => {
              const bKey = `${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`;
              // 只有当该位置确实还是碰撞体时才移除
              if (this.blockData[bKey] === 'collider') {
                this.removeBlock(b.x, b.y, b.z);
              }
            });
          }
        }
      } else {
        // 处理动态网格 (玩家放置的单体 Mesh)
        // 核心修复：移除该位置的所有动态 mesh，防止"方块消除后又重新出现"的 bug
        const cx = Math.floor(child.position.x);
        const cy = Math.floor(child.position.y);
        const cz = Math.floor(child.position.z);
        const isMatch = positions.some(p =>
          Math.floor(p.x) === cx && Math.floor(p.y) === cy && Math.floor(p.z) === cz
        );

        if (isMatch) {
          const key = `${cx},${cy},${cz}`;
          this.dynamicMeshes.delete(key);
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
          this.group.remove(child);
          // 注意：这里不 break，继续检查是否有其他 mesh 在同一位置
        }
      }
    }

    // 3. 核心修复：更新周围邻居的 Face Culling 状态，让原本隐藏的面显示出来
    neighborsToUpdate.forEach(nKey => {
      // 如果邻居本身也在本次删除列表中，跳过
      if (positions.some(p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` === nKey)) return;

      const [nx, ny, nz] = nKey.split(',').map(Number);
      const nCx = Math.floor(nx / CHUNK_SIZE);
      const nCz = Math.floor(nz / CHUNK_SIZE);

      if (nCx === this.cx && nCz === this.cz) {
        // 邻居在当前区块
        if (this.blockData[nKey]) {
          // 如果邻居存在但不可见（被剔除了），则“唤醒”它
          if (!this.visibleKeys.has(nKey)) {
            this.addBlockDynamic(nx, ny, nz, this.blockData[nKey]);
          } else {
            // 如果本来就可见，也要重新触发 Face Culling 更新以显示新的暴露面
            this._triggerFaceCullingUpdate(nx, ny, nz, this.blockData[nKey]);
          }
        }
      } else {
        // 跨区块邻居处理
        const neighborChunk = this.world.chunks.get(`${nCx},${nCz}`);
        if (neighborChunk && neighborChunk.isReady) {
          neighborChunk.checkReveal(nx, ny, nz);
        }
      }
    });

    // 4. 标记区块为脏并调度合并
    this.dirtyBlocks += positions.length;
    this.scheduleConsolidation();

    // 5. 触发持久化刷新 (防抖)
    this.saveDebounced();
  }

  /**
   * 私有辅助方法：为单个方块触发 Face Culling 更新
   */
  _triggerFaceCullingUpdate(x, y, z, type) {
    const fcSystem = getFaceCullingSystem();
    if (fcSystem && fcSystem.isEnabled()) {
      const position = new THREE.Vector3(x, y, z);
      const block = { type };

      const getNeighborBlock = (nx, ny, nz) => {
        const cx = Math.floor(nx / 16);
        const cz = Math.floor(nz / 16);
        let chunk = (cx === this.cx && cz === this.cz) ? this : this.world.chunks.get(`${cx},${cz}`);
        if (!chunk || !chunk.isReady) return null;
        const key = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
        const t = chunk.blockData[key];
        return t ? { type: t } : null;
      };

      const getNeighborsOf = (nx, ny, nz) => ({
        top: getNeighborBlock(nx, ny + 1, nz),
        bottom: getNeighborBlock(nx, ny - 1, nz),
        north: getNeighborBlock(nx, ny, nz - 1),
        south: getNeighborBlock(nx, ny, nz + 1),
        west: getNeighborBlock(nx - 1, ny, nz),
        east: getNeighborBlock(nx + 1, ny, nz)
      });

      fcSystem.updateBlock(position, block, getNeighborsOf(x, y, z));
    }
  }

  /**
   * 移除方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   */
  removeBlock(x, y, z) {
    // 检查方块是否为不可破坏类型
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const currentType = this.blockData[key];
    if (currentType) {
      // 兼容新旧格式：当前类型可能是字符串或对象
      const blockType = typeof currentType === 'string' ? currentType : currentType.type;
      if (blockType) {
        const props = getBlockProps(blockType);
        if (props.isIndestructible) {
          // 不可破坏方块，忽略移除请求
          console.log(`Block at ${x},${y},${z} is indestructible (${blockType})`);
          return;
        }
      }
    }

    // 记录持久化变更
    getPersistenceService().recordChange(x, y, z, 'air');
    // 使用 addBlockDynamic 统一处理逻辑状态更新、内存缓存同步和隐藏面剔除
    this.addBlockDynamic(x, y, z, 'air');
  }

  /**
   * 移除一个坐标的碰撞键（用于实体碰撞体）
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   */
  removeCollisionKey(x, y, z) {
    // 移除碰撞键的操作现在与移除方块逻辑完全一致，确保状态同步
    this.removeBlock(x, y, z);
  }
}
