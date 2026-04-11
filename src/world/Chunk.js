// src/world/Chunk.js
/**
 * 区块管理器 - 负责区块的生成、渲染和管理
 * 使用 InstancedMesh 优化渲染性能，管理区块内的所有方块和实体
 */
import * as THREE from 'three';
import { materials } from '../core/MaterialManager.js';
import { persistenceService } from '../services/PersistenceService.js';
import { faceCullingSystem } from '../core/FaceCullingSystem.js';
import { getBlockProperties, createBlockPropsResolver } from '../constants/BlockData.js';
import { getRotationAngle, parseBlockEntry } from '../utils/OrientationUtils.js';
import { getStructureRenderDist, belongsToCrossChunkStructure } from '../utils/StructureUtils.js';
import { createOcclusionChecker, computeBlockAOPacked, packAOData } from '../utils/AOUtils.js';
import { createChunkNeighborSampler } from './ChunkNeighborUtils.js';
import { extendChunk as extendWithConsolidation, CHUNK_SIZE, geomMap } from './ChunkConsolidation.js';
import { extendChunk as extendWithGenerator } from './ChunkGenerator.js';
import { extendChunk as extendWithPersistence } from './ChunkPersistence.js';
import { extendChunk as extendWithRenderUtils } from './ChunkRenderUtils.js';
import { FACE_MASK_ALL } from '../constants/GameConfig.js';
import { StaticModelInstancedRenderer } from './entities/StaticModelInstancedRenderer.js';
import { carModel, gunManModel } from '../core/Engine.js';
import { RealisticTree } from './entities/RealisticTree.js';

// 阴影投射白名单规则：所有“实心且可渲染”的方块都允许投射阴影
const isSolidShadowCaster = (props) => props.isSolid && props.isRendered !== false;
const isGlassType = (type) => typeof type === 'string' && type.includes('glass');

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;
const getFaceCullingSystem = () => globalThis._faceCullingSystem || faceCullingSystem;
const getMaterials = () => globalThis._materials || materials;
const getCarModel = () => globalThis._carModel || carModel;
const getGunManModel = () => globalThis._gunManModel || gunManModel;

// 获取方块属性函数 - 优先使用测试环境的模拟
const getBlockProps = createBlockPropsResolver(getBlockProperties);

/**
 * 区块类 - 负责单个区块的生成、管理和渲染
 * 采用 InstancedMesh 架构：相同类型的方块在同一个区块内仅通过一次绘制调用（Draw Call）渲染
 * 支持动态更新与后台合并优化系统
 */
export class Chunk {
  static getAOImpactedNeighborKeys(x, y, z) {
    const impacted = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          impacted.push({
            x: x + dx,
            y: y + dy,
            z: z + dz,
            key: `${Math.floor(x + dx)},${Math.floor(y + dy)},${Math.floor(z + dz)}`,
            isOrthogonal: Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1
          });
        }
      }
    }
    return impacted;
  }

  /**
   * 创建区块实例
   * @param {number} cx - 区块的 X 坐标（区块空间坐标，世界坐标 / 16）
   * @param {number} cz - 区块的 Z 坐标（区块空间坐标）
   * @param {World} world - 对所属 World 实例的引用，用于跨区块通信和资源访问
   */
  constructor(cx, cz, world) {
    // 基础属性
    this.cx = cx;
    this.cz = cz;
    this.world = world;
    this.group = new THREE.Group();
    this.isReady = false;
    this.loadState = 'created';
    this.spawnReason = world?.bootstrapState?.phase === 'runtime-streaming' ? 'runtime-streaming' : 'bootstrap';
    this.hasPlayerMutations = false;
    this.queuedAssemblyStages = new Set();
    this.pendingTerrainData = null;
    this.pendingSnapshot = null;
    this.pendingRuntimeEntities = null;
    this.pendingSpecialEntityData = null;
    this.hasDeferredFinalizeWork = false;
    this._needsDeferredPersistenceFlush = false;
    this._needsDeferredRuntimeEntityRestore = false;
    this._needsDeferredLightRegistration = false;
    this.disposed = false;

    // 数据存储 (旧的对象存储 - 将逐步迁移)
    this.blockData = {};
    this.solidBlocks = new Set();
    this.visibleKeys = new Set();
    this.instanceIndexMap = new Map();

    // === 高性能数组存储 (新) ===
    // 区块大小 16x16x16 = 4096 个方块
    // blockDataArray[blockIndex] = blockId (0 = 空气)
    // blockIndex = (y << 8) | (z << 4) | x = y * 256 + z * 16 + x
    this.blockDataArray = new Uint32Array(4096);
    // Palette: blockId -> { type, orientation } 或字符串类型
    // blockId 从 1 开始，0 保留给空气
    this.blockPalette = new Map();
    this.blockPaletteReverse = new Map(); // type+JSON(orientation) -> blockId
    this.nextBlockId = 1; // 下一个可用的 blockId
    // 预注册空气（id=0，不存入 palette）
    this.solidBlockIds = new Set(); // 存储实心方块对应的 blockId

    // 实体与结构数据
    this.entities = { realisticTrees: [], modGunMan: [], rovers: [] };
    this.structureCenters = [];
    this._tempOriginalSolidBlocks = null;
    this.specialEntityRenderers = new Map();
    this.entityCollisionIndex = new Map();

    // 后台合并系统
    this.dirtyBlocks = 0;
    this.consolidationTimer = null;
    this.isConsolidating = false;
    this.deferConsolidation = false;
    this.dynamicMeshes = new Map();

    // 批量 Face Culling 更新系统
    this.pendingBatchFaceCullingUpdates = new Set();
    this.batchFaceCullingTimer = null;

    // AO 脏集管理系统
    this.dirtyAOPositions = new Set();  // 需要重新计算 AO 的方块坐标集合
    this.aoRefreshTimer = null;         // 兼容旧定时器清理，AO 正确性由稳定源事件保证
    this._aoSourceVersion = 0;          // AO 源数据版本，用于丢弃过期 Worker 回包
    this._aoOperationQueue = [];        // 快速操作队列：记录所有操作位置，最终统一计算邻居

    // 持久化
    this.saveTimeout = null;

    // 启动区块生成
    this.gen();
  }

  // ============================================================
  // 坐标压缩与 Palette 工具 (高性能查询支持)
  // ============================================================

  /**
   * 将区块内局部坐标压缩为数组索引
   * @param {number} lx - 局部 X (0-15)
   * @param {number} ly - 局部 Y (0-15)
   * @param {number} lz - 局部 Z (0-15)
   * @returns {number} 数组索引 (0-4095)
   */
  static packBlockIndex(lx, ly, lz) {
    return (ly << 8) | (lz << 4) | lx;
  }

  /**
   * 从数组索引解压为局部坐标
   * @param {number} index - 数组索引
   * @returns {{x:number,y:number,z:number}} 局部坐标
   */
  static unpackBlockIndex(index) {
    return {
      x: index & 15,
      y: (index >> 8) & 15,
      z: (index >> 4) & 15
    };
  }

  /**
   * 从世界坐标获取 blockIndex（仅当在区块内时有效）
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {number} 数组索引，如果不在区块内返回 -1
   */
  _getBlockIndex(x, y, z) {
    const lx = x - this.cx * CHUNK_SIZE;
    const ly = y - this.worldY;
    const lz = z - this.cz * CHUNK_SIZE;
    if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
      return -1;
    }
    return (ly << 8) | (lz << 4) | lx;
  }

  /**
   * 获取或创建 blockId
   * @param {string|object} entry - 方块条目（类型字符串或对象）
   * @returns {number} blockId
   */
  _getOrCreateBlockId(entry) {
    const key = typeof entry === 'string' ? entry : JSON.stringify(entry);
    let id = this.blockPaletteReverse.get(key);
    if (id !== undefined) return id;

    id = this.nextBlockId++;
    this.blockPalette.set(id, entry);
    this.blockPaletteReverse.set(key, id);
    return id;
  }

  /**
   * 从 blockId 获取方块条目
   * @param {number} blockId
   * @returns {string|object|null}
   */
  _getEntryFromBlockId(blockId) {
    if (blockId === 0) return null;
    return this.blockPalette.get(blockId);
  }

  /**
   * 从 blockId 获取方块类型
   * @param {number} blockId
   * @returns {string|null}
   */
  _getTypeFromBlockId(blockId) {
    if (blockId === 0) return null;
    const entry = this.blockPalette.get(blockId);
    if (!entry) return null;
    return typeof entry === 'string' ? entry : entry.type;
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  /**
   * 检查指定位置是否在当前 Chunk 的责任范围内
   * - 大型静态结构：严格按坐标归属
   * - 小型实体（tree、gunman、rover 等）：允许跨 Chunk owner
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {boolean} 是否在责任范围内
   */
  _isInResponsibility(x, y, z) {
    const localX = Math.floor(x) - this.cx * CHUNK_SIZE;
    const localZ = Math.floor(z) - this.cz * CHUNK_SIZE;
    const isInChunk = localX >= 0 && localX < CHUNK_SIZE && localZ >= 0 && localZ < CHUNK_SIZE;

    if (isInChunk) return true;

    // 检查是否属于允许跨 Chunk 的小型实体
    // belongsToCrossChunkStructure 内部会过滤大型静态结构
    if (this.structureCenters?.length > 0) {
      return belongsToCrossChunkStructure(x, y, z, this.structureCenters);
    }

    return false;
  }

  /**
   * 更新方块的数据状态（blockData, visibleKeys, solidBlocks）
   * @param {string} key - 方块键
   * @param {string} type - 方块类型
   * @param {Object} entry - 方块条目
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   */
  _updateBlockState(key, type, entry, x, y, z) {
    // === 旧的对象存储（保持兼容） ===
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

    // === 新的数组存储（高性能） ===
    const blockIndex = this._getBlockIndex(x, y, z);
    if (blockIndex >= 0) {
      if (type === 'air') {
        // 清空数组位置
        const oldId = this.blockDataArray[blockIndex];
        if (oldId !== 0) {
          this.solidBlockIds.delete(oldId);
          this.blockDataArray[blockIndex] = 0;
        }
      } else {
        // 获取或创建 blockId
        const blockId = this._getOrCreateBlockId(entry);
        // 清空旧 id
        const oldId = this.blockDataArray[blockIndex];
        if (oldId !== 0 && oldId !== blockId) {
          this.solidBlockIds.delete(oldId);
        }
        // 设置新 id
        this.blockDataArray[blockIndex] = blockId;
        // 如果是实心方块，加入 solid set
        if (props.isSolid) {
          this.solidBlockIds.add(blockId);
        } else {
          this.solidBlockIds.delete(blockId);
        }
      }
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
        this._removeEntityWithCollisionBlocks(child);
        return true;
      }
    }
    return false;
  }

  /**
   * 获取指定 key 对应方块类型（兼容字符串/对象条目）
   * 优先使用新的数组存储
   * @param {string} key - 方块键
   * @returns {string|null} 方块类型
   */
  _getBlockTypeByKey(key) {
    // 优先使用 blockData（权威存储，worldY 未初始化导致 blockDataArray 索引不可靠）
    const entry = this.blockData[key];
    if (entry) return parseBlockEntry(entry).type;
    // 回退到 blockDataArray
    const [x, y, z] = key.split(',').map(Number);
    const blockIndex = this._getBlockIndex(x, y, z);
    if (blockIndex >= 0) {
      const blockId = this.blockDataArray[blockIndex];
      if (blockId) return this._getTypeFromBlockId(blockId);
    }
    return null;
  }

  /**
   * 检查指定 key 是否有方块（使用新存储）
   * @param {string} key - 方块键
   * @returns {boolean}
   */
  _hasBlockByKey(key) {
    const [x, y, z] = key.split(',').map(Number);
    const blockIndex = this._getBlockIndex(x, y, z);
    if (blockIndex >= 0) {
      return this.blockDataArray[blockIndex] !== 0;
    }
    return key in this.blockData;
  }

  /**
   * 获取指定 key 的方块条目（使用新存储）
   * @param {string} key - 方块键
   * @returns {string|object|null}
   */
  _getBlockEntryByKey(key) {
    // 优先使用 blockData（权威存储）
    const entry = this.blockData[key];
    if (entry) return entry;
    // 回退到 blockDataArray
    const [x, y, z] = key.split(',').map(Number);
    const blockIndex = this._getBlockIndex(x, y, z);
    if (blockIndex >= 0) {
      const blockId = this.blockDataArray[blockIndex];
      if (blockId) return this._getEntryFromBlockId(blockId);
    }
    return null;
  }

  /**
   * 检查指定 key 是否是可见方块（使用新存储）
   * @param {string} key - 方块键
   * @returns {boolean}
   */
  _isBlockVisibleByKey(key) {
    // 优先使用 blockData（权威存储，worldY 未初始化导致 blockDataArray 索引不可靠）
    const entry = this.blockData[key];
    if (entry) {
      const type = typeof entry === 'string' ? entry : entry.type;
      if (!type) return false;
      const props = getBlockProps(type);
      return props.isRendered !== false;
    }
    return false;
  }

  /**
   * 移除实体及其绑定的碰撞块（兜底统一清理）
   * @param {THREE.Object3D} entity - 实体对象
   */
  _removeEntityWithCollisionBlocks(entity) {
    if (!entity) return;
    this.group.remove(entity);

    const collisionBlocks = entity.userData?.collisionBlocks;
    if (!Array.isArray(collisionBlocks) || collisionBlocks.length === 0) return;

    collisionBlocks.forEach(b => {
      const bx = Math.floor(b.x);
      const by = Math.floor(b.y);
      const bz = Math.floor(b.z);
      const bKey = `${bx},${by},${bz}`;

      // 兼容 blockData 对象格式，避免 "实体已删但碰撞体残留"
      if (this._getBlockTypeByKey(bKey) === 'collider') {
        this.removeBlock(bx, by, bz);
      }
    });
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
   * 刷新已存在方块的渲染网格（仅刷新渲染，不改逻辑数据/持久化）
   * 用于方块被挖掉后，邻居方块立即补面，避免等待 consolidation。
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} key - 方块键
   * @param {string|object} entryOrType - 方块条目或类型
   */
  _refreshBlockRenderMesh(x, y, z, key, entryOrType) {
    const parsed = parseBlockEntry(entryOrType);
    const type = parsed.type;
    if (!type || type === 'air' || type === 'collider') return;

    // 先移除该位置已有网格（实例网格或动态网格）
    this._removeInstancedMeshBlock(key, x, y, z, type);
    this._removeDynamicMesh(x, y, z, key);

    // 立即创建动态网格，保证暴露面立刻可见
    const mesh = this._createDynamicBlockMesh(x, y, z, key, type, parsed.orientation || 0, { applyAO: false });
    if (!mesh) return;

    this.group.add(mesh);
    this.dynamicMeshes.set(key, mesh);
    mesh.updateMatrix();
    mesh.updateMatrixWorld();
    this.visibleKeys.add(key);
    // 标记 AO 脏位置（放置方块：自身+邻居）
    this._markDirtyAO(x, y, z, true);
  }

  /**
   * 轻量刷新方块渲染（仅保证补面立即可见，不做即时 AO）
   * AO 统一延迟到 consolidation 后由 chunk 级重建收敛，避免交互阶段的中间态 AO 脏块。
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} key - 方块键
   * @param {string|object} entryOrType - 方块条目或类型
   */
  _refreshBlockRenderLightweight(x, y, z, key, entryOrType) {
    const parsed = parseBlockEntry(entryOrType);
    const type = parsed.type;
    if (!type || type === 'air' || type === 'collider') return;

    const props = getBlockProps(type);
    if (!props.isRendered) return;

    // 原本已经可见的 InstancedMesh 方块不需要重建。
    // 方块几何本来就是完整立方体，邻块移除后新暴露的面会自然可见。
    // 若在这里删旧建新，反而容易引入临时 dynamic mesh、黑闪和共面重叠。
    if (this.visibleKeys.has(key) && !this.dynamicMeshes.has(key)) {
      return;
    }

    // 兜底：异常场景回退到重建，确保视觉正确性
    this._refreshBlockRenderMesh(x, y, z, key, entryOrType);
  }

  /**
   * 当方块被移除时，唤醒周围被隐藏的邻居方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   */
  _revealNeighbors(x, y, z) {
    const neighbors = Chunk.getAOImpactedNeighborKeys(x, y, z);

    for (const neighbor of neighbors) {
      // 对角线邻居不共享面，删除方块不会给它暴露新面，只影响 AO（由 _markDirtyAO 处理）
      // 跳过对角线邻居的 reveal/refresh，避免为本应隐藏的方块创建临时动态网格（幻影方块）
      if (!neighbor.isOrthogonal) continue;

      const nx = neighbor.x;
      const ny = neighbor.y;
      const nz = neighbor.z;

      const nCx = Math.floor(nx / CHUNK_SIZE);
      const nCz = Math.floor(nz / CHUNK_SIZE);

      if (nCx === this.cx && nCz === this.cz) {
        const nKey = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
        // 只使用 blockData（权威存储），不使用 _getBlockEntryByKey
        // blockData 始终包含所有方块（acceptWorkerResult 和 _updateBlockState 都写入 blockData）
        const entry = this.blockData[nKey];
        if (entry) {
          const parsed = parseBlockEntry(entry);
          const props = getBlockProps(parsed.type);
          if (!this.visibleKeys.has(nKey) && props.isRendered !== false) {
            this._refreshBlockRenderMesh(nx, ny, nz, nKey, entry);
          } else if (this.visibleKeys.has(nKey)) {
            this._refreshBlockRenderLightweight(nx, ny, nz, nKey, entry);
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
    // 标记 AO 脏位置（删除方块后 26 邻居都需要刷新 AO）
    this._markDirtyAO(x, y, z, false);
  }

  /**
   * 标记受方块操作影响的邻居为需要 AO 重算
   * @param {number} x - 方块世界坐标 X
   * @param {number} y - 方块世界坐标 Y
   * @param {number} z - 方块世界坐标 Z
   * @param {boolean} includeSelf - 是否包含自身（放置时 true，删除时 false）
   */
  _markDirtyAO(x, y, z, includeSelf = false) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);

    // 记录操作位置到队列，最终 AO 刷新时基于最新 blockData 重新计算邻居
    this._aoOperationQueue.push({ x: fx, y: fy, z: fz, includeSelf });

    // 同时立即标记 3x3x3 邻居（即时路径，保证单次操作也能正确刷新）
    // AO 顶点着色依赖对角线方向的方块，因此需要 26 邻居全覆盖
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          this._addDirtyAOPosition(fx + dx, fy + dy, fz + dz);
        }
      }
    }

    if (includeSelf) {
      this._addDirtyAOPosition(fx, fy, fz);
    }

    // 注意：不在此处调度 AO 刷新。AO 刷新统一由 consolidation 完成后触发，
    // 因为方块操作后需要先 consolidation 生成 InstancedMesh，才能写入 AO attribute。
  }

  /**
   * 将单个坐标添加到脏集（自动处理跨 chunk）
   * @private
   */
  _addDirtyAOPosition(x, y, z) {
    const key = `${x},${y},${z}`;
    const ncx = Math.floor(x / CHUNK_SIZE);
    const ncz = Math.floor(z / CHUNK_SIZE);

    if (ncx === this.cx && ncz === this.cz) {
      // 当前 chunk 内：只标记实心不透明方块
      const type = this._getBlockTypeByKey(key);
      if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
        this.dirtyAOPositions.add(key);
      }
    } else {
      // 跨 chunk：标记邻居 chunk 的脏集
      const nChunk = this.world?.chunks?.get(`${ncx},${ncz}`);
      if (nChunk && nChunk.isReady) {
        const nType = nChunk._getBlockTypeByKey?.(key);
        if (nType && getBlockProps(nType).isSolid && !getBlockProps(nType).isTransparent) {
          nChunk.dirtyAOPositions.add(key);
        }
      }
    }
  }

  /**
   * 在 blockData/InstancedMesh 已稳定后刷新 AO
   * @param {Object} [options]
   * @param {boolean} [options.fullRefresh=false] - 是否全量刷新（标记所有方块为脏）
   */
  _refreshAOFromStableSource(options = {}) {
    if (options.fullRefresh) {
      this._markAllBlocksDirtyAO();
    }
    if (this.aoRefreshTimer) {
      clearTimeout(this.aoRefreshTimer);
      this.aoRefreshTimer = null;
    }
    this._executeAORefresh();
  }

  /**
   * 标记所有实心不透明方块为 AO 脏位置
   * 用于 chunk 首次加载后全量刷新（WorldWorker 生成的 AO 可能因缺少邻居数据而不准确）
   */
  _markAllBlocksDirtyAO() {
    for (const [key, entry] of Object.entries(this.blockData)) {
      if (!entry) continue;
      const type = typeof entry === 'string' ? entry : entry.type;
      if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
        this.dirtyAOPositions.add(key);
      }
    }
  }

  /**
   * 标记与指定邻居 chunk 相邻的边界方块为 AO 脏位
   * 只刷新与新 chunk 接壤的那一列方块，而非整个 chunk
   * @param {number} neighborCx - 邻居 chunk 的 cx
   * @param {number} neighborCz - 邻居 chunk 的 cz
   */
  _markBoundaryDirtyAO(neighborCx, neighborCz) {
    const dx = neighborCx - this.cx;
    const dz = neighborCz - this.cz;
    // 确定边界列：邻居在哪个方向，就取哪个方向的边界列
    let boundaryX = null, boundaryZ = null;
    if (dx === 1) boundaryX = this.cx * CHUNK_SIZE;        // 邻居在 +X 方向，取本地 X=0 列
    else if (dx === -1) boundaryX = this.cx * CHUNK_SIZE + CHUNK_SIZE - 1; // 邻居在 -X 方向，取本地 X=15 列
    if (dz === 1) boundaryZ = this.cz * CHUNK_SIZE;
    else if (dz === -1) boundaryZ = this.cz * CHUNK_SIZE + CHUNK_SIZE - 1;

    // 遍历数组存储的方块
    for (let i = 0; i < this.blockDataArray.length; i++) {
      const blockId = this.blockDataArray[i];
      if (blockId === 0) continue;
      if (!this.solidBlockIds.has(blockId)) continue;

      const { x: lx, y: ly, z: lz } = Chunk.unpackBlockIndex(i);
      const x = this.cx * CHUNK_SIZE + lx;
      const y = this.worldY + ly;
      const z = this.cz * CHUNK_SIZE + lz;
      const key = `${x},${y},${z}`;

      // 只标记边界列上的方块（±1 范围覆盖对角线）
      const matchX = boundaryX !== null && Math.abs(x - boundaryX) <= 1;
      const matchZ = boundaryZ !== null && Math.abs(z - boundaryZ) <= 1;
      if (matchX || matchZ) {
        this.dirtyAOPositions.add(key);
      }
    }
  }

  /**
   * 处理 AO 操作队列：基于最新 blockData 重新计算所有操作的邻居脏位
   * 这确保 Mag7 等快速操作时，所有受影响的方块都会被刷新，不会遗漏
   */
  _flushAOOperationQueue() {
    if (this._aoOperationQueue.length === 0) return;

    // AO 顶点着色依赖 3x3x3 邻居（共 26 个），不仅仅是 6 个正交邻居，
    // 因为面对角线方向的方块也会影响顶点的 AO 值。
    for (const op of this._aoOperationQueue) {
      const { x, y, z, includeSelf } = op;
      // 标记 3x3x3 邻居（排除自身 0,0,0）
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            this._addDirtyAOPosition(x + dx, y + dy, z + dz);
          }
        }
      }
      // 操作自身
      if (includeSelf) {
        this._addDirtyAOPosition(x, y, z);
      }
    }

    // 清空队列
    this._aoOperationQueue.length = 0;
  }

  /**
   * 执行 AO 刷新：先处理操作队列，再收集脏集发送给 AOWorker
   */
  _executeAORefresh() {
    // 先处理操作队列：基于最新 blockData 重新计算所有操作的邻居脏位
    this._flushAOOperationQueue();

    if (this.dirtyAOPositions.size === 0) return;
    if (!this.isReady || this.isConsolidating) {
      return;
    }

    // 快照当前脏位置（后续新增的不会被本次请求覆盖）
    const sentKeys = new Set(this.dirtyAOPositions);

    // 收集脏位置
    const positions = [...sentKeys].map(key => {
      const [x, y, z] = key.split(',').map(Number);
      return { x, y, z };
    });

    // 收集邻居 chunk 快照（跨 chunk AO 计算需要）
    // AO 计算需要 26 邻居（3x3x3），因此需要包含 8 个方向的邻居（正交+对角线）
    const neighborChunks = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dx, dz] of dirs) {
      const nc = this.world?.chunks?.get(`${this.cx + dx},${this.cz + dz}`);
      if (nc && nc.isReady) {
        neighborChunks.push({
          blockData: nc.blockData,
          cx: nc.cx,
          cz: nc.cz
        });
      }
    }

    // 生成请求 ID
    const requestId = `${this.cx},${this.cz}-${Date.now()}`;
    const aoSourceVersion = this._aoSourceVersion;

    // 动态导入 Worker 和回调
    import('./ChunkConsolidation.js').then(({ aoWorker, aoCallbacks }) => {
      // 注册回调
      aoCallbacks.set(requestId, (data) => {
        if (!this.isReady || this.isConsolidating || this._aoSourceVersion !== aoSourceVersion) return;
        this._applyAOResults(data.results, sentKeys);
      });

      // 发送给 Worker
      aoWorker.postMessage({
        requestId,
        chunkKey: `${this.cx},${this.cz}`,
        positions,
        blockData: { ...this.blockData },
        neighborChunks
      });
    });
  }

  /**
   * 应用 Worker 返回的 AO 结果到 InstancedMesh
   * 直接覆写 attribute 值，无删除-重建中间态
   * @param {Array} results - [{x, y, z, aoLow, aoHigh}]
   */
  _applyAOResults(results, sentKeys) {
    if (!results || results.length === 0) {
      // 即使无结果，也要清除已发送的脏标记
      if (sentKeys) {
        for (const key of sentKeys) {
          this.dirtyAOPositions.delete(key);
        }
      }
      return;
    }

    // 按方块类型分组，减少 InstancedMesh 查找
    const resultsByType = new Map();
    for (const r of results) {
      const key = `${r.x},${r.y},${r.z}`;
      const type = this._getBlockTypeByKey(key);
      if (!type) continue;
      if (!resultsByType.has(type)) resultsByType.set(type, []);
      resultsByType.get(type).push({ ...r, key });
    }

    // 按类型批量更新 InstancedMesh
    for (const [type, typeResults] of resultsByType) {
      const typeMap = this.instanceIndexMap[type];
      if (!typeMap) continue;

      // 查找对应类型的 InstancedMesh
      const mesh = this.group.children.find(
        c => c.isInstancedMesh && c.userData?.type === type
      );
      if (!mesh?.geometry) continue;

      const aoLowAttr = mesh.geometry.getAttribute('aAoLow');
      const aoHighAttr = mesh.geometry.getAttribute('aAoHigh');
      if (!aoLowAttr || !aoHighAttr) continue;

      for (const r of typeResults) {
        const idx = typeMap.get(r.key);
        if (idx === undefined || idx < 0 || idx >= aoLowAttr.array.length) continue;

        // 直接覆写，无中间态
        aoLowAttr.array[idx] = r.aoLow;
        aoHighAttr.array[idx] = r.aoHigh;
      }

      aoLowAttr.needsUpdate = true;
      aoHighAttr.needsUpdate = true;
    }

    // 只清除本次已发送的脏标记，保留后续新增的
    if (sentKeys) {
      for (const key of sentKeys) {
        this.dirtyAOPositions.delete(key);
      }
    } else {
      this.dirtyAOPositions.clear();
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
  _createDynamicBlockMesh(x, y, z, key, type, orientation, options = {}) {
    const props = getBlockProps(type);
    if (!props.isRendered || !this._isBlockVisibleByKey(key)) {
      return null;
    }
    const applyAO = options.applyAO === true;

    const geometry = geomMap[props.geometryType] || geomMap['default'];
    let material = getMaterials().getMaterial(type);

    if (material) {
      material = Array.isArray(material)
        ? material.map(m => m.clone())
        : material.clone();
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);
    mesh.rotation.set(0, getRotationAngle(orientation), 0);
    mesh.userData = { type, orientation };
    mesh.frustumCulled = true;  // 启用视锥剔除

    // 创建后计算边界体积
    if (mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }

    // 动态交互期不做即时 AO，统一延迟到 consolidation 后收敛。
    // 但为了避免临时 mesh 因缺少 AO attribute 而出现黑闪，这里会写入“中性 AO”。
    if (props.isSolid && !props.isTransparent) {
      mesh.geometry = geometry.clone();
      const count = mesh.geometry.attributes.position.count;
      let aoLow = 0;
      let aoHigh = 0;
      if (applyAO) {
        const isOccluding = createOcclusionChecker(
          { chunk: this, chunks: this.world.chunks },
          CHUNK_SIZE,
          getBlockProps
        );
        ({ aoLow, aoHigh } = computeBlockAOPacked(x, y, z, isOccluding));
      } else {
        ({ aoLow, aoHigh } = packAOData(new Uint8Array(24).fill(3)));
      }

      const aoLowArray = new Float32Array(count);
      const aoHighArray = new Float32Array(count);
      const orientationArray = new Float32Array(count);

      aoLowArray.fill(aoLow);
      aoHighArray.fill(aoHigh);
      orientationArray.fill(orientation || 0);

      mesh.geometry.setAttribute('aAoLow', new THREE.BufferAttribute(aoLowArray, 1));
      mesh.geometry.setAttribute('aAoHigh', new THREE.BufferAttribute(aoHighArray, 1));
      mesh.geometry.setAttribute('aOrientation', new THREE.BufferAttribute(orientationArray, 1));
    }

    // 设置阴影
    if (props.isShadowEnabled) {
      if (isGlassType(type)) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else {
        mesh.castShadow = isSolidShadowCaster(props);
        mesh.receiveShadow = true;
      }
    }

    return mesh;
  }

  /**
   * 获取特殊实体记录所在桶
   * @param {string} entityType - 实体类型
   * @returns {string|null}
   */
  _getSpecialEntityBucket(entityType) {
    if (entityType === 'modGunMan') return 'modGunMan';
    if (entityType === 'rover') return 'rovers';
    return null;
  }

  /**
   * 获取结构中心类型
   * @param {string} entityType - 实体类型
   * @returns {string}
   */
  _getSpecialEntityCenterType(entityType) {
    return entityType === 'modGunMan' ? 'gunman' : entityType;
  }

  /**
   * 生成特殊实体唯一 ID
   * @param {string} entityType - 实体类型
   * @param {{x:number,y:number,z:number}} position - 位置
   * @returns {string}
   */
  _makeSpecialEntityId(entityType, position) {
    return `${entityType}:${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  }

  /**
   * 生成特殊实体记录
   * @param {string} entityType - 实体类型
   * @param {{id?:string,x:number,y:number,z:number,rotationY?:number}} position - 位置
   * @returns {{id:string,x:number,y:number,z:number,rotationY:number}|null}
   */
  _createSpecialEntityRecord(entityType, position) {
    if (!position) return null;
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    return {
      id: position.id || this._makeSpecialEntityId(entityType, { x, y, z }),
      x,
      y,
      z,
      rotationY: position.rotationY || 0
    };
  }

  /**
   * 获取特殊实体占位碰撞块
   * @param {string} entityType - 实体类型
   * @param {{x:number,y:number,z:number}} record - 实体记录
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  _getSpecialEntityCollisionBlocks(entityType, record) {
    const blocks = [];
    if (!record) return blocks;

    if (entityType === 'modGunMan') {
      for (let dy = 0; dy < 2; dy++) {
        blocks.push({ x: record.x, y: record.y + dy, z: record.z });
      }
      return blocks;
    }

    if (entityType === 'rover') {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = 0; dy < 3; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            blocks.push({ x: record.x + dx, y: record.y + dy, z: record.z + dz });
          }
        }
      }
    }

    return blocks;
  }

  /**
   * 将特殊实体同步到持久化快照缓存
   */
  _syncSpecialEntitiesToPersistence() {
    const persistence = getPersistenceService();
    const chunkKey = `${this.cx},${this.cz}`;
    const chunkData = persistence?.cache?.get?.(chunkKey);
    if (!chunkData?.entities) return;

    chunkData.entities.modGunMan = (this.entities.modGunMan || []).map(({ id, x, y, z, rotationY = 0 }) => ({
      id, x, y, z, rotationY
    }));
    chunkData.entities.rovers = (this.entities.rovers || []).map(({ id, x, y, z, rotationY = 0 }) => ({
      id, x, y, z, rotationY
    }));
  }

  /**
   * 注册特殊实体占位碰撞
   * @param {string} entityType - 实体类型
   * @param {{id:string,x:number,y:number,z:number}} record - 实体记录
   */
  _registerSpecialEntityCollision(entityType, record) {
    const collisionBlocks = this._getSpecialEntityCollisionBlocks(entityType, record);
    collisionBlocks.forEach(({ x, y, z }) => {
      const key = `${x},${y},${z}`;
      this.entityCollisionIndex.set(key, {
        entityType,
        entityId: record.id,
        x: record.x,
        y: record.y,
        z: record.z
      });
      this.solidBlocks.add(key);
    });
  }

  /**
   * 注销特殊实体占位碰撞
   * @param {string} entityType - 实体类型
   * @param {{id:string,x:number,y:number,z:number}} record - 实体记录
   */
  _unregisterSpecialEntityCollision(entityType, record) {
    const collisionBlocks = this._getSpecialEntityCollisionBlocks(entityType, record);
    collisionBlocks.forEach(({ x, y, z }) => {
      const key = `${x},${y},${z}`;
      const existing = this.entityCollisionIndex.get(key);
      if (existing && existing.entityId === record.id) {
        this.entityCollisionIndex.delete(key);
        this.solidBlocks.delete(key);
      }
    });
  }

  /**
   * 加载特殊实体实例化渲染与碰撞占位
   * @param {string} entityType - 实体类型
   * @param {Array<{id?:string,x:number,y:number,z:number,rotationY?:number}>} positions - 实体位置列表
   * @param {THREE.Object3D|null} sourceModel - 模型模板
   */
  loadSpecialEntityInstances(entityType, positions, sourceModel = null) {
    const bucket = this._getSpecialEntityBucket(entityType);
    if (!bucket) return;

    const existingRenderer = this.specialEntityRenderers.get(entityType);
    if (existingRenderer) {
      existingRenderer.detachFromGroup(this.group);
      existingRenderer.dispose();
      this.specialEntityRenderers.delete(entityType);
    }

    // 清理旧占位
    const oldRecords = this.entities[bucket] || [];
    oldRecords.forEach(record => this._unregisterSpecialEntityCollision(entityType, record));

    const seen = new Set();
    const records = [];
    (positions || []).forEach((position) => {
      const record = this._createSpecialEntityRecord(entityType, position);
      if (!record || seen.has(record.id)) return;
      seen.add(record.id);
      records.push(record);
      this._registerSpecialEntityCollision(entityType, record);
    });

    this.entities[bucket] = records;

    if (!sourceModel || records.length === 0) return;

    const renderer = new StaticModelInstancedRenderer({
      sourceModel,
      records,
      entityType,
      ownerChunk: this
    });
    renderer.attachToGroup(this.group);
    this.specialEntityRenderers.set(entityType, renderer);
  }

  markPlayerMutation() {
    this.hasPlayerMutations = true;
  }

  isPureRuntimeStreamingChunk() {
    return this.spawnReason === 'runtime-streaming' && !this.hasPlayerMutations;
  }

  /**
   * 销毁特殊实体
   * @param {string} entityType - 实体类型
   * @param {string} entityId - 实体 ID
   * @returns {boolean} 是否销毁成功
   */
  destroySpecialEntity(entityType, entityId) {
    const bucket = this._getSpecialEntityBucket(entityType);
    if (!bucket) return false;

    const records = this.entities[bucket] || [];
    const index = records.findIndex(record => record.id === entityId);
    if (index < 0) return false;

    const record = records[index];
    this._unregisterSpecialEntityCollision(entityType, record);

    const renderer = this.specialEntityRenderers.get(entityType);
    if (renderer) {
      renderer.hideEntity(entityId);
    }

    records.splice(index, 1);
    this.structureCenters = (this.structureCenters || []).filter(center => {
      if (center.type !== this._getSpecialEntityCenterType(entityType)) return true;
      return !(
        Math.floor(center.x) === record.x &&
        Math.floor(center.y) === record.y &&
        Math.floor(center.z) === record.z
      );
    });

    this._syncSpecialEntitiesToPersistence();
    this.saveDebounced();
    this.world?.clearBlockLookupCaches?.();
    this.world?.requestShadowMapUpdate?.('destroy-special-entity');
    return true;
  }

  /**
   * 获取特殊实体占位碰撞信息
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {object|null}
   */
  getSpecialEntityCollisionAt(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return this.entityCollisionIndex.get(key) || null;
  }

  /**
   * 接收 Worker 生成结果，但暂不立即在主线程完成全部装配
   * @param {object} payload - Worker 回包数据
   */
  acceptWorkerResult(payload = {}) {
    const {
      meshData,
      d,
      solidBlocks,
      realisticTrees,
      modGunMan,
      rovers,
      allBlockTypes,
      visibleKeys,
      snapshot,
      structureCenters
    } = payload;

    if (allBlockTypes) this.blockData = allBlockTypes;
    this.visibleKeys = new Set(visibleKeys || []);
    this.solidBlocks = new Set(solidBlocks || []);
    this.structureCenters = structureCenters || [];
    this.entities.staticTrees = (structureCenters || [])
      .filter(c => c.type === 'static_tree')
      .map(c => ({ x: c.x, y: c.y, z: c.z }));
    this.entities.realisticTrees = realisticTrees || [];

    // === 初始化新的数组存储（高性能查询支持） ===
    this._initArrayStorageFromBlockData();

    // 使用 meshData（新格式）或 d（旧格式）
    this.pendingTerrainData = meshData || d || {};
    this.pendingSnapshot = snapshot || null;
    this.pendingRuntimeEntities = {
      zombieNests: snapshot?.entities?.zombieNests || [],
      turrets: snapshot?.entities?.turrets || [],
      minecarts: snapshot?.entities?.minecarts || []
    };
    this.pendingSpecialEntityData = {
      realisticTrees: realisticTrees || [],
      modGunMan: modGunMan || [],
      rovers: rovers || []
    };
    this.loadState = 'worker-ready';
  }

  /**
   * 从 blockData 对象初始化数组存储
   * 在 Worker 结果接收或持久化加载后调用
   */
  _initArrayStorageFromBlockData() {
    // 重置数组存储
    this.blockDataArray.fill(0);
    this.blockPalette.clear();
    this.blockPaletteReverse.clear();
    this.solidBlockIds.clear();
    this.nextBlockId = 1;

    // 遍历 blockData 填充数组存储
    for (const [key, entry] of Object.entries(this.blockData)) {
      const [x, y, z] = key.split(',').map(Number);
      const parsed = parseBlockEntry(entry);
      const type = parsed.type;

      if (!type || type === 'air') continue;

      // 计算数组索引
      const lx = x - this.cx * CHUNK_SIZE;
      const ly = y - this.worldY;
      const lz = z - this.cz * CHUNK_SIZE;
      if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
        continue; // 不在本区块范围内
      }
      const blockIndex = (ly << 8) | (lz << 4) | lx;

      // 获取或创建 blockId
      const blockId = this._getOrCreateBlockId(entry);
      this.blockDataArray[blockIndex] = blockId;

      // 如果是实心方块，加入 solid set
      const props = getBlockProps(type);
      if (props.isSolid) {
        this.solidBlockIds.add(blockId);
      }
    }
  }

  /**
   * 构建地形 InstancedMesh
   * @returns {boolean} 是否完成该阶段
   */
  assembleTerrainPhase() {
    if (this.loadState !== 'worker-ready') return this.loadState === 'terrain-built' || this.loadState === 'entities-built' || this.loadState === 'finalized';
    this.buildMeshes(this.pendingTerrainData || {});
    this.loadState = 'terrain-built';
    return true;
  }

  assembleRuntimeBuildPhase() {
    if (this.loadState === 'finalized') return true;
    if (this.loadState === 'created') return false;
    if (this.loadState === 'worker-ready') {
      this.buildMeshes(this.pendingTerrainData || {});
      this.loadState = 'terrain-built';
    }
    if (this.loadState === 'terrain-built') {
      this.assembleEntityPhase();
    }
    return this.loadState === 'entities-built' || this.loadState === 'finalized';
  }

  /**
   * 构建实体渲染、恢复运行时实例并落地快照
   * @returns {boolean} 是否完成该阶段
   */
  assembleEntityPhase() {
    if (this.loadState !== 'terrain-built') return this.loadState === 'entities-built' || this.loadState === 'finalized';

    const realisticTrees = this.pendingSpecialEntityData?.realisticTrees || [];
    realisticTrees.forEach(pos => {
      RealisticTree.generate(pos.x, pos.y, pos.z, this, null, true);
    });
    RealisticTree.createInstancedForChunk(this);

    const gunman = this.pendingSpecialEntityData?.modGunMan || [];
    const rovers = this.pendingSpecialEntityData?.rovers || [];
    this.loadSpecialEntityInstances('modGunMan', gunman, getGunManModel());
    this.loadSpecialEntityInstances('rover', rovers, getCarModel());

    const snapshot = this.pendingSnapshot;
    if (snapshot) {
      const persistence = getPersistenceService();
      const chunkKey = `${this.cx},${this.cz}`;
      const existingData = persistence?.cache?.get?.(chunkKey);
      if (existingData?.entities) {
        snapshot.entities = {
          ...existingData.entities,
          ...snapshot.entities,
          turrets: existingData.entities.turrets || snapshot.entities?.turrets || []
        };
      }
      if (persistence?.cache?.set) {
        persistence.cache.set(chunkKey, snapshot);
      }
      this._pendingPersistenceFlush = true;
    }

    this.loadState = 'entities-built';
    return true;
  }

  /**
   * finalize 阶段：必要时 consolidation，之后才标记 ready
   */
  finalizeAssemblyPhase() {
    if (this.loadState === 'finalized') return true;
    if (this.loadState !== 'entities-built' && this.loadState !== 'waiting-consolidation') return false;

    if (this.loadState !== 'waiting-consolidation' && this.dirtyBlocks > 0 && !this.isPureRuntimeStreamingChunk()) {
      this.loadState = 'waiting-consolidation';
      this.consolidate();
      return false;
    }

    if (this.isPureRuntimeStreamingChunk()) {
      this.dirtyBlocks = 0;
      if (this.consolidationTimer) {
        clearTimeout(this.consolidationTimer);
        this.consolidationTimer = null;
      }
    }

    const shouldDeferNonRenderFinalize = this.isPureRuntimeStreamingChunk();
    if (shouldDeferNonRenderFinalize) {
      this.hasDeferredFinalizeWork = true;
      this._needsDeferredPersistenceFlush = Boolean(this._pendingPersistenceFlush);
      this._needsDeferredRuntimeEntityRestore = Boolean(
        (this.pendingRuntimeEntities?.zombieNests?.length || 0) +
        (this.pendingRuntimeEntities?.turrets?.length || 0) +
        (this.pendingRuntimeEntities?.minecarts?.length || 0)
      );
      this._needsDeferredLightRegistration = true;
    }

    if (this._pendingPersistenceFlush && !shouldDeferNonRenderFinalize) {
      this._pendingPersistenceFlush = false;
      getPersistenceService()?.saveChunkData?.(this.cx, this.cz, this.pendingSnapshot);
    }

    if (!shouldDeferNonRenderFinalize) {
      const zombieNests = this.pendingRuntimeEntities?.zombieNests;
      if (Array.isArray(zombieNests) && zombieNests.length > 0) {
        this.world?.zombieNestManager?.restoreNestsForChunk?.(this.cx, this.cz, zombieNests);
      }
      const turrets = this.pendingRuntimeEntities?.turrets;
      if (Array.isArray(turrets) && turrets.length > 0) {
        this.world?.turretManager?.restoreTurretsForChunk?.(this.cx, this.cz, turrets);
      }
      const minecarts = this.pendingRuntimeEntities?.minecarts;
      if (Array.isArray(minecarts) && minecarts.length > 0) {
        this.world?.minecartManager?.restoreMinecartsForChunk?.(this.cx, this.cz, minecarts);
      }
    }

    if (!shouldDeferNonRenderFinalize) {
      this._registerLightSources();
    }
    this.isReady = true;
    this.loadState = 'finalized';
    this.pendingTerrainData = null;
    this.pendingSpecialEntityData = null;
    if (!shouldDeferNonRenderFinalize) {
      this.pendingRuntimeEntities = null;
    }
    this.pendingSnapshot = null;
    this.world?.onChunkFinalized?.(this);
    return true;
  }

  runDeferredFinalizePhase() {
    if (this.disposed || !this.hasDeferredFinalizeWork) return true;

    if (this._needsDeferredPersistenceFlush) {
      this._needsDeferredPersistenceFlush = false;
      this._pendingPersistenceFlush = false;
      getPersistenceService()?.saveChunkData?.(this.cx, this.cz);
    }

    if (this._needsDeferredRuntimeEntityRestore) {
      const zombieNests = this.pendingRuntimeEntities?.zombieNests;
      if (Array.isArray(zombieNests) && zombieNests.length > 0) {
        this.world?.zombieNestManager?.restoreNestsForChunk?.(this.cx, this.cz, zombieNests);
      }
      const turrets = this.pendingRuntimeEntities?.turrets;
      if (Array.isArray(turrets) && turrets.length > 0) {
        this.world?.turretManager?.restoreTurretsForChunk?.(this.cx, this.cz, turrets);
      }
      const minecarts = this.pendingRuntimeEntities?.minecarts;
      if (Array.isArray(minecarts) && minecarts.length > 0) {
        this.world?.minecartManager?.restoreMinecartsForChunk?.(this.cx, this.cz, minecarts);
      }
      this._needsDeferredRuntimeEntityRestore = false;
      this.pendingRuntimeEntities = null;
    } else if (this.pendingRuntimeEntities) {
      this.pendingRuntimeEntities = null;
    }

    if (this._needsDeferredLightRegistration) {
      this._registerLightSources();
      this._needsDeferredLightRegistration = false;
    }

    this.hasDeferredFinalizeWork = (
      this._needsDeferredPersistenceFlush ||
      this._needsDeferredRuntimeEntityRestore ||
      this._needsDeferredLightRegistration
    );
    return !this.hasDeferredFinalizeWork;
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 注册该 Chunk 中的所有光源方块
   * 扫描 blockData 中标记为 isLightSource 的方块，创建对应的 PointLight
   */
  _registerLightSources() {
    if (!this.world.lightSourceManager) return;

    for (const key in this.blockData) {
      const entry = this.blockData[key];
      const parsed = parseBlockEntry(entry);
      if (!parsed.type || parsed.type === 'air') continue;

      const props = getBlockProps(parsed.type);
      if (props.isLightSource) {
        const [x, y, z] = key.split(',').map(Number);
        this.world.lightSourceManager.addLight(x, y, z, parsed.type);
      }
    }
  }

  /**
   * 注销该 Chunk 中的所有光源方块
   * 清除该 Chunk 内所有光源的 PointLight
   */
  _unregisterLightSources() {
    if (!this.world.lightSourceManager) return;

    for (const key in this.blockData) {
      const entry = this.blockData[key];
      const parsed = parseBlockEntry(entry);
      if (!parsed.type || parsed.type === 'air') continue;

      const props = getBlockProps(parsed.type);
      if (props.isLightSource) {
        const [x, y, z] = key.split(',').map(Number);
        this.world.lightSourceManager.removeLight(x, y, z);
      }
    }
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
    getPersistenceService().recordChangeForChunk(this.cx, this.cz, x, y, z, entry);

    // 5. 更新数据状态
    this._updateBlockState(key, type, entry, x, y, z);
    this.saveDebounced();

    // 6. 计算 Face Culling 掩码
    const { getNeighborBlock, getNeighborsOf } = createChunkNeighborSampler(this, (entry) => {
      if (!entry) return null;
      const parsed = parseBlockEntry(entry);
      return { type: parsed.type, orientation: parsed.orientation };
    });

    let mask = FACE_MASK_ALL;
    const fcSystem = getFaceCullingSystem();
    if (fcSystem && fcSystem.isEnabled() && type !== 'air' && type !== 'collider' && type !== 'chest') {
      const block = { type };
      const neighbors = getNeighborsOf(x, y, z);
      mask = fcSystem.calculateFaceVisibility(block, neighbors);

      mask === 0 && !fcSystem.isTransparent(type)
        ? this.visibleKeys.delete(key)
        : this.visibleKeys.add(key);
    }

    // 7. 移除旧的渲染网格
    this._removeInstancedMeshBlock(key, x, y, z, oldType);
    this._handleEntityRemoval(x, y, z, oldType);
    this._handleRealisticTreeRemoval(x, y, z, oldType);
    this._removeDynamicMesh(x, y, z, key);

    // 8. 如果是移除方块，唤醒邻居并移除光源
    if (type === 'air') {
      this.dirtyBlocks++;
      this.scheduleConsolidation();
      this._revealNeighbors(x, y, z);
      // 移除光源
      if (this.world.lightSourceManager) {
        this.world.lightSourceManager.updateLight(
          Math.floor(x),
          Math.floor(y),
          Math.floor(z),
          null
        );
      }
      return;
    }

    // 9. 创建新的动态网格
    const mesh = this._createDynamicBlockMesh(x, y, z, key, type, blockOrientation, { applyAO: false });
    if (mesh) {
      this.group.add(mesh);
      this.dynamicMeshes.set(key, mesh);
      this.dirtyBlocks++;
      this.scheduleConsolidation();
      mesh.updateMatrix();
      mesh.updateMatrixWorld();
    }

    // 9.5 标记 AO 脏位置（放置方块：自身+邻居）
    this._markDirtyAO(x, y, z, true);

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

    // 11. 更新光源（如果方块是光源或移除的是光源）
    if (this.world.lightSourceManager) {
      this.world.lightSourceManager.updateLight(
        Math.floor(x),
        Math.floor(y),
        Math.floor(z),
        type
      );
    }
  }

  /**
   * 批量快速添加方块（导入专用）
   * 仅更新逻辑状态与持久化记录，不逐块创建动态网格；由后续 consolidate 统一重建渲染
   * @param {Array<{x:number,y:number,z:number,type:string,orientation?:number}>} blocks
   * @param {{ deferConsolidation?: boolean, replaceExisting?: boolean }} [options]
   * @returns {{ placed: number, skipped: number }}
   */
  addBlocksBatchFast(blocks, options = {}) {
    const deferConsolidation = options.deferConsolidation === true;
    const replaceExisting = options.replaceExisting === true;
    let placed = 0;
    let skipped = 0;
    let hasChanges = false;

    for (const block of blocks) {
      const x = Math.floor(block.x);
      const y = Math.floor(block.y);
      const z = Math.floor(block.z);
      const key = `${x},${y},${z}`;

      if (!this._isInResponsibility(x, y, z)) {
        skipped++;
        continue;
      }

      const oldEntry = this.blockData[key];
      const oldType = oldEntry ? parseBlockEntry(oldEntry).type : null;
      const nextType = typeof block.type === 'string' ? block.type : 'air';

      // 默认不覆盖已有非空气方块；replaceExisting=true 时允许覆盖
      if (!replaceExisting && nextType !== 'air' && oldType && oldType !== 'air') {
        skipped++;
        continue;
      }

      // 清理操作：目标是 air，当前位置为空则跳过
      if (nextType === 'air' && (!oldType || oldType === 'air')) {
        skipped++;
        continue;
      }

      const orientation = nextType === 'air'
        ? 0
        : (Number.isFinite(block.orientation) ? Math.trunc(block.orientation) : 0);
      const entry = { type: nextType, orientation };

      getPersistenceService().recordChangeForChunk(this.cx, this.cz, x, y, z, entry);
      this._updateBlockState(key, nextType, entry, x, y, z);
      this.dirtyBlocks++;
      hasChanges = true;
      placed++;
    }

    if (hasChanges) {
      this.saveDebounced();
      if (!deferConsolidation) {
        this.scheduleConsolidation();
      }
    }

    return { placed, skipped };
  }

  /**
   * 检查指定位置是否是隐藏方块，如果是则显示它
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   */
  checkReveal(x, y, z) {
    const owner = this.world.resolveBlockOwner(x, y, z, { allowScan: true });
    if (!owner) return;

    const targetChunk = owner.ownerChunk;
    const { blockKey, entry } = owner;

    // 使用 visibleKeys（面剔除状态）判断可见性
    if (!targetChunk.visibleKeys.has(blockKey)) {
      // 隐藏邻居只创建临时渲染网格，不改 blockData/持久化
      const parsed = parseBlockEntry(entry);
      const props = getBlockProps(parsed.type);
      if (props.isRendered !== false) {
        targetChunk._refreshBlockRenderMesh(x, y, z, blockKey, entry);
      }
    } else {
      // 如果原本可见，跨区块暴露时也要立即刷新网格补面
      targetChunk._refreshBlockRenderLightweight(x, y, z, blockKey, entry);
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
    const entry = this._getBlockEntryByKey(key);
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
    const entry = this._getBlockEntryByKey(key);
    if (!entry) return null;
    return parseBlockEntry(entry);
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
   * @param {boolean} isBatch - 是否为批量操作模式。true 时不立即更新 Face Culling，
   *                           而是将需要更新的邻居收集到 pendingBatchFaceCullingUpdates 中，
   *                           等待外部统一调用 processPendingFaceCullingUpdates 处理。
   *                           适用于 Mag7、TNT 等批量删除场景，避免 AO 阴影计算丢失。
   */
  removeBlocksBatch(positions, isBatch = true) {
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
        affectedTypes.add(oldParsed.type);
        delete this.blockData[key];
        this.visibleKeys.delete(key);
        this.solidBlocks.delete(key);
        getPersistenceService().recordChangeForChunk(this.cx, this.cz, px, py, pz, 'air');

        // 只收集正交邻居（6方向），对角线邻居不共享面，不需要即时 reveal/refresh
        Chunk.getAOImpactedNeighborKeys(px, py, pz).forEach(({ key: neighborKey, isOrthogonal }) => {
          if (isOrthogonal) {
            neighborsToUpdate.add(neighborKey);
          }
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
        // 处理实体批量移除逻辑 (如 TNT 爆炸)
        if (child.userData.collisionBlocks) {
          const isHit = child.userData.collisionBlocks.some(b =>
            positions.some(p =>
              Math.floor(p.x) === Math.floor(b.x) &&
              Math.floor(p.y) === Math.floor(b.y) &&
              Math.floor(p.z) === Math.floor(b.z)
            )
          );

          if (isHit) {
            this._removeEntityWithCollisionBlocks(child);
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
        }
      }
    }

    // 3. 核心修复：更新周围邻居的 Face Culling 状态，让原本隐藏的面显示出来
    // 关键优化：在批量删除场景（如 Mag7、TNT）中，将需要更新的邻居收集起来，
    // 等待所有批量操作完成后统一处理，避免 AO 阴影计算丢失
    neighborsToUpdate.forEach(nKey => {
      // 如果邻居本身也在本次删除列表中，跳过
      if (positions.some(p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` === nKey)) return;

      const [nx, ny, nz] = nKey.split(',').map(Number);
      const nCx = Math.floor(nx / CHUNK_SIZE);
      const nCz = Math.floor(nz / CHUNK_SIZE);

      if (nCx === this.cx && nCz === this.cz) {
        // 邻居在当前区块
        // 只使用 blockData（权威存储），不使用 _getBlockEntryByKey
        // blockData 始终包含所有方块（acceptWorkerResult 和 _updateBlockState 都写入 blockData）
        const nEntry = this.blockData[nKey];
        if (nEntry) {
          // 使用 visibleKeys（面剔除状态）判断可见性
          const nParsed = parseBlockEntry(nEntry);
          const nProps = getBlockProps(nParsed.type);
          if (!this.visibleKeys.has(nKey) && nProps.isRendered !== false) {
            // 隐藏邻居现在有了暴露面，只创建临时渲染网格（不改 blockData/持久化）
            this._refreshBlockRenderMesh(nx, ny, nz, nKey, nEntry);
          } else if (this.visibleKeys.has(nKey)) {
            // 如果本来就可见，也要重新触发 Face Culling 更新以显示新的暴露面
            if (isBatch) {
              // 批量模式：收集到待处理队列，不立即更新
              this.pendingBatchFaceCullingUpdates.add(nKey);
              // 启动防抖定时器，在最后一批删除完成后统一处理
              this._scheduleBatchFaceCullingUpdate();
              // 标记 AO 脏位置（邻居自身 + 它的 6 个邻居，都要重算）
              this._markDirtyAO(nx, ny, nz, true);
            } else {
              // 非批量模式：立即刷新网格补面
              this._refreshBlockRenderLightweight(nx, ny, nz, nKey, nEntry);
            }
          }
        }
      } else {
        // 跨区块邻居处理
        const neighborChunk = this.world.chunks.get(`${nCx},${nCz}`);
        if (neighborChunk && neighborChunk.isReady) {
          if (isBatch) {
            // 批量模式：将跨区块的更新也收集起来
            this.pendingBatchFaceCullingUpdates.add(nKey);
            this._scheduleBatchFaceCullingUpdate();
            // 标记 AO 脏位置（跨 chunk 邻居自身 + 它的邻居都要重算）
            this._markDirtyAO(nx, ny, nz, true);
          } else {
            neighborChunk.checkReveal(nx, ny, nz);
          }
        }
      }
    });

    // 4. 标记区块为脏并调度合并
    this.dirtyBlocks += positions.length;
    this.scheduleConsolidation();

    // 5. 触发持久化刷新 (防抖)
    this.saveDebounced();

    // 6. 更新光源（移除被删除方块位置的光源）
    if (this.world.lightSourceManager) {
      positions.forEach(p => {
        this.world.lightSourceManager.updateLight(
          Math.floor(p.x),
          Math.floor(p.y),
          Math.floor(p.z),
          null  // null 表示移除光源
        );
      });
    }

    // 7. 标记 AO 脏位置（覆盖每个删除位置的全部 26 邻居，含对角线）
    positions.forEach(p => {
      this._markDirtyAO(p.x, p.y, p.z, false);
    });
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
    const type = this._getBlockTypeByKey(key);
    if (type) {
      const props = getBlockProps(type);
      if (props.isIndestructible) {
        // 不可破坏方块，忽略移除请求
        console.log(`Block at ${x},${y},${z} is indestructible (${type})`);
        return;
      }
    }

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

  /**
   * 仅移除渲染网格（用于跨Chunk实体方块）
   * 当跨Chunk实体方块的blockData存储在其他Chunk时，只更新本Chunk的渲染网格
   * @param {Array<{x,y,z}>} positions - 待移除的坐标列表
   */
  removeBlocksBatchRenderOnly(positions) {
    if (positions.length === 0) return;

    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    // 移除渲染网格（隐藏方块）
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];

      if (child.isInstancedMesh) {
        const type = child.userData.type;
        const typeMap = this.instanceIndexMap[type];
        let updated = false;

        if (typeMap) {
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
          // Fallback: 全量扫描
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
      } else if (!child.userData.isEntity) {
        // 处理动态网格
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
        }
      }
    }

    // 标记区块为脏并调度合并
    this.dirtyBlocks += positions.length;
    this.scheduleConsolidation();
  }
}

// 扩展Chunk类功能
extendWithConsolidation(Chunk);
extendWithGenerator(Chunk);
extendWithPersistence(Chunk);
extendWithRenderUtils(Chunk);
