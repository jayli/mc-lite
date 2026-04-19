// src/world/Chunk.js
/**
 * 区块管理器 - 负责区块的生成、渲染和管理
 * 使用 InstancedMesh 优化渲染性能，管理区块内的所有方块和实体
 */
import * as THREE from 'three';
import { encodeCoord, decodeCoord, blockDataToNumberKeys } from '../utils/CoordEncoding.js';
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
          const nx = Math.floor(x + dx);
          const ny = Math.floor(y + dy);
          const nz = Math.floor(z + dz);
          impacted.push({
            x: nx,
            y: ny,
            z: nz,
            code: Chunk.encodeCoord(nx, ny, nz),
            isOrthogonal: Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1
          });
        }
      }
    }
    return impacted;
  }

  /**
   * 将世界坐标编码为数字 key（大整数乘法编码，避免 JS 位运算 32bit 截断）
   * 支持范围: x,z ∈ [-1_000_000, +1_000_000], y ∈ [-512, +512]
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {number} 编码后的数字 key
   */
  static encodeCoord(x, y, z) {
    return encodeCoord(x, y, z);
  }

  /**
   * 将数字 key 解码为世界坐标
   * @param {number} code - 编码后的数字 key
   * @returns {{x:number,y:number,z:number}} 世界坐标
   */
  static decodeCoord(code) {
    return decodeCoord(code);
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
    this.worldY = 0; // 当前区块为单层 16x16x16，base Y = 0
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

    // =========================================
    // 数据存储
    // =========================================

    /**
     * blockData — 权威数据源（Map）
     * 存储该 Chunk 中所有动态方块（放置、挖掘、特殊结构产生的方块）。
     * 格式: Map<number, entry>，key 为 encodeCoord(x,y,z) 编码，value 为字符串类型或 { type, orientation } 对象。
     * 读写者: World.setBlockDataState, World.removeBlock, Worker 结果接收, 持久化加载
     * 包含: 所有被修改过的方块（地形生成后放置的方块、特殊实体占位等）。
     * 不包含: 原始地形生成的方块（这些走 blockDataArray 路径）。
     * 同步关系: 是 blockDataArray + solidBlockIds + solidBlocks 的权威来源。
     *           当 blockData 变更时，需要同步更新上述派生结构。
     */
    this.blockData = new Map();

    /**
     * solidBlocks — 实心方块世界坐标集合（Set<string>）
     * 存储该 Chunk 中所有 isSolid=true 的方块的世界坐标字符串 "x,y,z"。
     * 覆盖范围: Y:0~31（包含所有高度，不限于 blockDataArray 的 Y:0~15 范围）。
     * 读写者: setBlockDataState（跟随 blockData 同步）、
     *          acceptWorkerResult / buildMeshesForRegion（Worker 回传直接填充）、
     *          FaceCullingWorker（面剔除结果回传）、_markBoundaryDirtyAO（AO 脏位遍历时间接读取）。
     * 包含: blockData 中所有 isSolid=true 的方块。
     * 不包含: 特殊实体占位（modGunMan、rover 等）— 这些走 entityCollisionIndex。
     * 同步关系: 应保持为 blockData 中实心方块的子集，与 blockData 同步。
     *           注意: Worker 回传路径中可能先于 blockData 填充，需确保最终一致。
     */
    this.solidBlocks = new Set();
    this.visibleKeys = new Set();
    this.instanceIndexMap = new Map();

    /**
     * blockDataArray — 高速紧凑存储（Uint32Array[4096]）
     * 以局部索引一维数组存储 Y:0~15 范围内所有方块的 blockId。
     * 索引计算: blockIndex = (localY << 8) | (localZ << 4) | localX，其中 localY = worldY - chunk.worldY。
     * blockId = 0 表示空气。
     * 读写者: setBlockDataState（写入 blockId）、rebuildBlockDataArray（从 blockData 重建）、
     *          World.isSolid（快速读取）、World.resolveBlockOwner（读取）、渲染管线（遍历）。
     * 包含: Y:0~15 范围内所有方块的 blockId（包括空气=0）。
     * 不包含: Y:16+ 的方块（这些走 blockData 对象路径）。
     * 同步关系: 由 blockData 派生，通过 rebuildBlockDataArray 从 blockData 完整重建，
     *           或通过 setBlockDataState 增量更新。变更后需要同步 solidBlockIds。
     */
    this.blockDataArray = new Uint32Array(4096);

    /**
     * blockPalette — blockId 到方块属性的映射（Map<number → { type, orientation }>）
     * 与 blockDataArray 配合使用，blockId 从 1 开始递增，0 保留给空气（不存入 palette）。
     * 读写者: _getOrCreateBlockId（写入）、rebuildBlockDataArray（重建）、
     *          FaceCullingWorker/渲染（读取）。
     */
    this.blockPalette = new Map();

    /**
     * blockPaletteReverse — 方块属性到 blockId 的反向映射（Map<string → number>）
     * 键为 type+JSON(orientation) 的序列化字符串，值为对应的 blockId。
     * 读写者: _getOrCreateBlockId（读写）。
     */
    this.blockPaletteReverse = new Map();

    /**
     * nextBlockId — 下一个可用的 blockId（从 1 开始）
     * 写入者: _getOrCreateBlockId。
     */
    this.nextBlockId = 1;

    /**
     * solidBlockIds — 实心方块 blockId 集合（Set<number>）
     * 存储 blockDataArray 中所有 isSolid=true 方块对应的 blockId。
     * 覆盖范围: 仅 Y:0~15（与 blockDataArray 一致）。
     * 读写者: setBlockDataState（增量更新 add/delete）、
     *          rebuildBlockDataArray（完整重建）、
     *          World.isSolid（快速读取，配合 blockDataArray 做 O(1) 实心查询）、
     *          _markBoundaryDirtyAO（遍历 blockDataArray + solidBlockIds 标记 AO 脏位）。
     * 包含: blockDataArray 中所有 isSolid=true 方块的 blockId。
     * 不包含: 非实心方块、Y:16+ 方块、特殊实体占位。
     * 同步关系: 由 blockDataArray 派生，与 blockDataArray 中的实心方块保持同步。
     *           职责单一，仅服务于 World.isSolid 的快速路径。
     */
    this.solidBlockIds = new Set();

    // 实体与结构数据

    /**
     * entities — 特殊实体实例列表
     * 存储 modGunMan、rover 等实体的实例数据。
     */
    this.entities = { modGunMan: [], rovers: [] };

    /**
     * structureCenters — 结构中心位置列表
     */
    this.structureCenters = [];

    /**
     * _tempOriginalSolidBlocks — 合并过程中临时保存的原始 solidBlocks
     */
    this._tempOriginalSolidBlocks = null;

    /**
     * specialEntityRenderers — 特殊实体渲染器缓存（Map<entityType → InstancedRenderer>）
     * 存储 modGunMan、rover 等实体的实例化渲染器。
     */
    this.specialEntityRenderers = new Map();

    /**
     * entityCollisionIndex — 特殊实体碰撞占位索引（Map<string → { entityType, entityId, x, y, z }>）
     * 存储特殊实体（modGunMan、rover 等）占据的方块坐标及其归属信息。
     * 这些方块不属于 blockData，是纯碰撞占位。
     * 读写者: _registerSpecialEntityCollision（写入）、_unregisterSpecialEntityCollision（删除）、
     *          getSpecialEntityCollisionAt（读取）、World.isSolid（最终回退查询）。
     * 包含: modGunMan（2格高柱体）、rover（3×3×5包围盒）等特殊实体的占位坐标。
     * 不包含: 普通方块（走 blockData/solidBlocks）、矿车碰撞（走 MinecartManager 独立路径）。
     * 同步关系: 独立注册/注销，与 blockData/solidBlocks 无同步依赖。
     */
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
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} type - 方块类型
   * @param {Object} entry - 方块条目
   */
  _updateBlockState(x, y, z, type, entry) {
    const code = Chunk.encodeCoord(x, y, z);

    // === blockData（权威存储） ===
    if (type === 'air') {
      this.blockData.delete(code);
      this.visibleKeys.delete(code);
    } else {
      this.blockData.set(code, entry);
      this.visibleKeys.add(code);
    }

    // 更新碰撞体集合
    const props = getBlockProps(type);
    if (props.isSolid) {
      this.solidBlocks.add(code);
    } else {
      this.solidBlocks.delete(code);
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
   * 获取指定坐标的方块条目（权威查询）
   * 先查 blockData（Map），再回退到 blockDataArray
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {{type:string,orientation:number}|null}
   */
  getBlockEntry(x, y, z) {
    const code = Chunk.encodeCoord(x, y, z);
    const entry = this.blockData.get(code);
    if (entry) return parseBlockEntry(entry);
    // 回退到 blockDataArray
    const blockIndex = this._getBlockIndex(x, y, z);
    if (blockIndex >= 0) {
      const blockId = this.blockDataArray[blockIndex];
      if (blockId) {
        const arrEntry = this._getEntryFromBlockId(blockId);
        if (arrEntry) return parseBlockEntry(arrEntry);
      }
    }
    return null;
  }

  /**
   * 检查指定坐标是否有方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {boolean}
   */
  hasBlockEntry(x, y, z) {
    const code = Chunk.encodeCoord(x, y, z);
    if (this.blockData.has(code)) return true;
    const blockIndex = this._getBlockIndex(x, y, z);
    if (blockIndex >= 0) {
      return this.blockDataArray[blockIndex] !== 0;
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

      // 兼容 blockData 对象格式，避免 "实体已删但碰撞体残留"
      if (this.getBlockEntry(bx, by, bz)?.type === 'collider') {
        this.removeBlock(bx, by, bz);
      }
    });
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
   * @param {number} code - 方块编码
   * @param {string|object} entryOrType - 方块条目或类型
   */
  _refreshBlockRenderMesh(x, y, z, code, entryOrType) {
    const parsed = parseBlockEntry(entryOrType);
    const type = parsed.type;
    if (!type || type === 'air' || type === 'collider') return;

    // 先移除该位置已有网格（实例网格或动态网格）
    this._removeInstancedMeshBlock(code, x, y, z, type);
    this._removeDynamicMesh(x, y, z, code);

    // 立即创建动态网格，保证暴露面立刻可见
    const mesh = this._createDynamicBlockMesh(x, y, z, code, type, parsed.orientation || 0, { applyAO: false });
    if (!mesh) return;

    this.group.add(mesh);
    this.dynamicMeshes.set(code, mesh);
    mesh.updateMatrix();
    mesh.updateMatrixWorld();
    this.visibleKeys.add(code);
    // 标记 AO 脏位置（放置方块：自身+邻居）
    this._markDirtyAO(x, y, z, true);
  }

  /**
   * 轻量刷新方块渲染（仅保证补面立即可见，不做即时 AO）
   * AO 统一延迟到 consolidation 后由 chunk 级重建收敛，避免交互阶段的中间态 AO 脏块。
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {number} code - 方块编码
   * @param {string|object} entryOrType - 方块条目或类型
   */
  _refreshBlockRenderLightweight(x, y, z, code, entryOrType) {
    const parsed = parseBlockEntry(entryOrType);
    const type = parsed.type;
    if (!type || type === 'air' || type === 'collider') return;

    const props = getBlockProps(type);
    if (!props.isRendered) return;

    // 原本已经可见的 InstancedMesh 方块不需要重建。
    // 方块几何本来就是完整立方体，邻块移除后新暴露的面会自然可见。
    // 若在这里删旧建新，反而容易引入临时 dynamic mesh、黑闪和共面重叠。
    if (this.visibleKeys.has(code) && !this.dynamicMeshes.has(code)) {
      return;
    }

    // 兜底：异常场景回退到重建，确保视觉正确性
    this._refreshBlockRenderMesh(x, y, z, code, entryOrType);
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
        const nCode = Chunk.encodeCoord(nx, ny, nz);
        const entry = this.blockData.get(nCode);
        if (entry) {
          const parsed = parseBlockEntry(entry);
          const props = getBlockProps(parsed.type);
          if (!this.visibleKeys.has(nCode) && props.isRendered !== false) {
            this._refreshBlockRenderMesh(nx, ny, nz, nCode, entry);
          } else if (this.visibleKeys.has(nCode)) {
            this._refreshBlockRenderLightweight(nx, ny, nz, nCode, entry);
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
    const code = Chunk.encodeCoord(x, y, z);
    const ncx = Math.floor(x / CHUNK_SIZE);
    const ncz = Math.floor(z / CHUNK_SIZE);

    if (ncx === this.cx && ncz === this.cz) {
      // 当前 chunk 内：只标记实心不透明方块
      const entry = this.blockData.get(code);
      const type = entry ? (typeof entry === 'string' ? entry : entry.type) : null;
      if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
        this.dirtyAOPositions.add(code);
      }
    } else {
      // 跨 chunk：标记邻居 chunk 的脏集
      const nChunk = this.world?.chunks?.get(`${ncx},${ncz}`);
      if (nChunk && nChunk.isReady) {
        const nEntry = nChunk.blockData?.get(code);
        const nType = nEntry ? (typeof nEntry === 'string' ? nEntry : nEntry.type) : null;
        if (nType && getBlockProps(nType).isSolid && !getBlockProps(nType).isTransparent) {
          nChunk.dirtyAOPositions.add(code);
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
    for (const [code, entry] of this.blockData) {
      if (!entry) continue;
      const type = typeof entry === 'string' ? entry : entry.type;
      if (type && getBlockProps(type).isSolid && !getBlockProps(type).isTransparent) {
        this.dirtyAOPositions.add(code);
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
      const code = Chunk.encodeCoord(x, y, z);

      // 只标记边界列上的方块（±1 范围覆盖对角线）
      const matchX = boundaryX !== null && Math.abs(x - boundaryX) <= 1;
      const matchZ = boundaryZ !== null && Math.abs(z - boundaryZ) <= 1;
      if (matchX || matchZ) {
        this.dirtyAOPositions.add(code);
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
    const sentCodes = new Set(this.dirtyAOPositions);

    // 收集脏位置
    const positions = [...sentCodes].map(code => Chunk.decodeCoord(code));

    // 收集邻居 chunk 快照（跨 chunk AO 计算需要）
    // AO 计算需要 26 邻居（3x3x3），因此需要包含 8 个方向的邻居（正交+对角线）
    const neighborChunks = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dx, dz] of dirs) {
      const nc = this.world?.chunks?.get(`${this.cx + dx},${this.cz + dz}`);
      if (nc && nc.isReady) {
        neighborChunks.push({
          blockData: blockDataToNumberKeys(nc.blockData),
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
        this._applyAOResults(data.results, sentCodes);
      });

      // 发送给 Worker
      aoWorker.postMessage({
        requestId,
        chunkKey: `${this.cx},${this.cz}`,
        positions,
        blockData: blockDataToNumberKeys(this.blockData),
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
      const code = Chunk.encodeCoord(r.x, r.y, r.z);
      const entry = this.blockData.get(code);
      const type = entry ? (typeof entry === 'string' ? entry : entry.type) : null;
      if (!type) continue;
      if (!resultsByType.has(type)) resultsByType.set(type, []);
      resultsByType.get(type).push({ ...r, code });
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
        const idx = typeMap.get(r.code);
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
  _createDynamicBlockMesh(x, y, z, code, type, orientation, options = {}) {
    const props = getBlockProps(type);
    const entry = this.blockData.get(code);
    const entryType = entry ? (typeof entry === 'string' ? entry : entry.type) : null;
    if (!props.isRendered || !entryType) {
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
    mesh.frustumCulled = false;

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
      scatteredBlocks,
      solidBlocks,
      modGunMan,
      rovers,
      visibleKeys,
      snapshot,
      structureCenters
    } = payload;

    // 初始化数据结构
    if (!this.visibleKeys) this.visibleKeys = new Set();
    if (!this.solidBlocks) this.solidBlocks = new Set();
    this.visibleKeys.clear();
    this.solidBlocks.clear();

    if (visibleKeys) {
      for (const key of visibleKeys) {
        const [x, y, z] = key.split(',').map(Number);
        this.visibleKeys.add(Chunk.encodeCoord(x, y, z));
      }
    }
    if (solidBlocks) {
      for (const key of solidBlocks) {
        const [x, y, z] = key.split(',').map(Number);
        this.solidBlocks.add(Chunk.encodeCoord(x, y, z));
      }
    }

    this.structureCenters = structureCenters || [];
    this.entities.staticTrees = (structureCenters || [])
      .filter(c => c.type === 'static_tree')
      .map(c => ({ x: c.x, y: c.y, z: c.z }));

    // 保存 snapshot 和特殊实体数据（供后续阶段使用）
    this.pendingSnapshot = snapshot || null;
    this.pendingSpecialEntityData = {
      modGunMan: modGunMan || [],
      rovers: rovers || []
    };

    // 注意：blockData 和 mesh 构建不再在此处处理
    // 由 BlockScatterManager.scatter() → acceptScatteredBlocks() 处理

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
    for (const [code, entry] of this.blockData) {
      const { x, y, z } = Chunk.decodeCoord(code);
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
    if (this.loadState === 'worker-ready') {
      // worker-ready 后等待 BlockScatterManager 分发
      // acceptScatteredBlocks 会自动将 loadState 设为 terrain-built
      return false;
    }
    return this.loadState === 'terrain-built' || this.loadState === 'entities-built' || this.loadState === 'finalized';
  }

  assembleRuntimeBuildPhase() {
    if (this.loadState === 'finalized') return true;
    if (this.loadState === 'created') return false;
    // worker-ready 后等待 BlockScatterManager 分发
    if (this.loadState === 'worker-ready') return false;

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

    for (const [code, entry] of this.blockData) {
      const parsed = parseBlockEntry(entry);
      if (!parsed.type || parsed.type === 'air') continue;

      const props = getBlockProps(parsed.type);
      if (props.isLightSource) {
        const { x, y, z } = Chunk.decodeCoord(code);
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

    for (const [code, entry] of this.blockData) {
      const parsed = parseBlockEntry(entry);
      if (!parsed.type || parsed.type === 'air') continue;

      const props = getBlockProps(parsed.type);
      if (props.isLightSource) {
        const { x, y, z } = Chunk.decodeCoord(code);
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
    const code = Chunk.encodeCoord(x, y, z);

    // 2. 边界检查（跨 Chunk）
    if (!this._isInResponsibility(x, y, z)) return;

    // 3. 获取旧方块信息
    const oldEntry = this.blockData.get(code);
    const oldParsed = parseBlockEntry(oldEntry);
    const oldType = oldParsed.type;

    // 4. 更新持久化记录
    getPersistenceService().recordChangeForChunk(this.cx, this.cz, x, y, z, entry);

    // 5. 更新数据状态
    this._updateBlockState(x, y, z, type, entry);
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
        ? this.visibleKeys.delete(code)
        : this.visibleKeys.add(code);
    }

    // 7. 移除旧的渲染网格
    this._removeInstancedMeshBlock(code, x, y, z, oldType);
    this._handleEntityRemoval(x, y, z, oldType);
    this._removeDynamicMesh(x, y, z, code);

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
    const mesh = this._createDynamicBlockMesh(x, y, z, code, type, blockOrientation, { applyAO: false });
    if (mesh) {
      this.group.add(mesh);
      this.dynamicMeshes.set(code, mesh);
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
      const code = Chunk.encodeCoord(x, y, z);

      if (!this._isInResponsibility(x, y, z)) {
        skipped++;
        continue;
      }

      const oldEntry = this.blockData.get(code);
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
      this._updateBlockState(x, y, z, nextType, entry);
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
    const { blockCode, entry } = owner;

    // 使用 visibleKeys（面剔除状态）判断可见性
    if (!targetChunk.visibleKeys.has(blockCode)) {
      // 隐藏邻居只创建临时渲染网格，不改 blockData/持久化
      const parsed = parseBlockEntry(entry);
      const props = getBlockProps(parsed.type);
      if (props.isRendered !== false) {
        targetChunk._refreshBlockRenderMesh(x, y, z, blockCode, entry);
      }
    } else {
      // 如果原本可见，跨区块暴露时也要立即刷新网格补面
      targetChunk._refreshBlockRenderLightweight(x, y, z, blockCode, entry);
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
    const entry = this.getBlockEntry(x, y, z);
    if (!entry) return 0;
    return entry.orientation || 0;
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
      const code = Chunk.encodeCoord(px, py, pz);
      const oldEntry = this.blockData.get(code);

      if (oldEntry) {
        // 解析方块类型，兼容新旧格式
        const oldParsed = typeof oldEntry === 'string' ? { type: oldEntry, orientation: 0 } : parseBlockEntry(oldEntry);
        affectedTypes.add(oldParsed.type);
        this.blockData.delete(code);
        this.visibleKeys.delete(code);
        this.solidBlocks.delete(code);
        getPersistenceService().recordChangeForChunk(this.cx, this.cz, px, py, pz, 'air');

        // 只收集正交邻居（6方向），对角线邻居不共享面，不需要即时 reveal/refresh
        Chunk.getAOImpactedNeighborKeys(px, py, pz).forEach(({ code: neighborCode, isOrthogonal }) => {
          if (isOrthogonal) {
            neighborsToUpdate.add(neighborCode);
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
              const code = Chunk.encodeCoord(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
              if (typeMap.has(code)) {
                const idx = typeMap.get(code);
                dummy.makeScale(0, 0, 0);
                child.setMatrixAt(idx, dummy);
                typeMap.delete(code);
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
          const code = Chunk.encodeCoord(cx, cy, cz);
          this.dynamicMeshes.delete(code);
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
    neighborsToUpdate.forEach(nCode => {
      // 如果邻居本身也在本次删除列表中，跳过
      if (positions.some(p => Chunk.encodeCoord(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === nCode)) return;

      const { x: nx, y: ny, z: nz } = Chunk.decodeCoord(nCode);
      const nCx = Math.floor(nx / CHUNK_SIZE);
      const nCz = Math.floor(nz / CHUNK_SIZE);

      if (nCx === this.cx && nCz === this.cz) {
        // 邻居在当前区块
        const nEntry = this.blockData.get(nCode);
        if (nEntry) {
          // 使用 visibleKeys（面剔除状态）判断可见性
          const nParsed = parseBlockEntry(nEntry);
          const nProps = getBlockProps(nParsed.type);
          if (!this.visibleKeys.has(nCode) && nProps.isRendered !== false) {
            // 隐藏邻居现在有了暴露面，只创建临时渲染网格（不改 blockData/持久化）
            this._refreshBlockRenderMesh(nx, ny, nz, nCode, nEntry);
          } else if (this.visibleKeys.has(nCode)) {
            // 如果本来就可见，也要重新触发 Face Culling 更新以显示新的暴露面
            if (isBatch) {
              // 批量模式：收集到待处理队列，不立即更新
              this.pendingBatchFaceCullingUpdates.add(nCode);
              // 启动防抖定时器，在最后一批删除完成后统一处理
              this._scheduleBatchFaceCullingUpdate();
              // 标记 AO 脏位置（邻居自身 + 它的 6 个邻居，都要重算）
              this._markDirtyAO(nx, ny, nz, true);
            } else {
              // 非批量模式：立即刷新网格补面
              this._refreshBlockRenderLightweight(nx, ny, nz, nCode, nEntry);
            }
          }
        }
      } else {
        // 跨区块邻居处理
        const neighborChunk = this.world.chunks.get(`${nCx},${nCz}`);
        if (neighborChunk && neighborChunk.isReady) {
          if (isBatch) {
            // 批量模式：将跨区块的更新也收集起来
            this.pendingBatchFaceCullingUpdates.add(nCode);
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

    // 8. 重建数组存储，确保 blockDataArray 与 blockData 权威源同步
    this._initArrayStorageFromBlockData();
  }

  /**
   * 移除方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   */
  removeBlock(x, y, z) {
    // 检查方块是否为不可破坏类型
    const type = this.getBlockEntry(x, y, z)?.type;
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
            const code = Chunk.encodeCoord(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
            if (typeMap.has(code)) {
              const idx = typeMap.get(code);
              dummy.makeScale(0, 0, 0);
              child.setMatrixAt(idx, dummy);
              typeMap.delete(code);
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
          const code = Chunk.encodeCoord(cx, cy, cz);
          this.dynamicMeshes.delete(code);
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

  /**
   * 接收 BlockScatterManager 分发来的方块数据
   * @param {Array} scatteredBlocks - 方块列表（含溢出）
   * @param {Set} visibleBlockKeys - 面剔除可见的方块 key 集合
   */
  acceptScatteredBlocks(scatteredBlocks, visibleBlockKeys) {
    const minX = this.cx * CHUNK_SIZE;
    const minZ = this.cz * CHUNK_SIZE;

    // 确保数据结构已初始化
    if (!this.visibleKeys) this.visibleKeys = new Set();
    if (!this.solidBlocks) this.solidBlocks = new Set();

    for (const block of scatteredBlocks) {
      const localX = block.x - minX;
      const localZ = block.z - minZ;
      // 只处理属于本 chunk 范围的方块
      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
        continue;
      }

      const code = Chunk.encodeCoord(block.x, block.y, block.z);

      // 写入 blockData（唯一真相源）
      if (block.orientation !== 0) {
        this.blockData.set(code, { type: block.type, orientation: block.orientation });
      } else {
        this.blockData.set(code, block.type);
      }

      // 写入 solidBlocks
      const props = getBlockProps(block.type);
      if (props.isSolid) {
        this.solidBlocks.add(code);
      }
    }

    // 从 Worker 传来的 visibleBlockKeys 初始化 visibleKeys
    // 只有面剔除可见的方块才加入 visibleKeys，被遮挡的地下方块不加入
    if (visibleBlockKeys) {
      for (const key of visibleBlockKeys) {
        const [x, y, z] = key.split(',').map(Number);
        this.visibleKeys.add(Chunk.encodeCoord(x, y, z));
      }
    }

    // 初始化数组存储
    this._initArrayStorageFromBlockData();

    // 从已填充的 blockData 构建渲染 mesh
    this.buildMeshesFromScatteredData();

    // 标记 chunk 为已加载
    this.loadState = 'terrain-built';
    this.isReady = true;

    // 通知 World 继续后续装配流程（entities → finalize）
    this.world?.onChunkWorkerReady?.(this);
  }

  /**
   * 增量追加 BlockScatterManager 分发来的方块数据
   * 用于后加载 chunk 的溢出方块追加到已渲染的 chunk 中
   * @param {Array} scatteredBlocks - 方块列表（含溢出）
   * @param {Set} visibleBlockKeys - 面剔除可见的方块 key 集合
   */
  appendScatteredBlocks(scatteredBlocks, visibleBlockKeys) {
    const minX = this.cx * CHUNK_SIZE;
    const minZ = this.cz * CHUNK_SIZE;

    let appendedCount = 0;

    for (const block of scatteredBlocks) {
      const localX = block.x - minX;
      const localZ = block.z - minZ;
      // 只处理属于本 chunk 范围的方块
      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
        continue;
      }

      const code = Chunk.encodeCoord(block.x, block.y, block.z);

      // 跳过已存在的方块，尊重玩家修改或已有数据
      if (this.blockData.has(code)) continue;

      // 写入 blockData
      if (block.orientation !== 0) {
        this.blockData.set(code, { type: block.type, orientation: block.orientation });
      } else {
        this.blockData.set(code, block.type);
      }

      // 写入 solidBlocks
      const props = getBlockProps(block.type);
      if (props.isSolid) {
        this.solidBlocks.add(code);
      }

      appendedCount++;
    }

    // 从 visibleBlockKeys 追加可见标记
    if (visibleBlockKeys) {
      for (const key of visibleBlockKeys) {
        const [x, y, z] = key.split(',').map(Number);
        this.visibleKeys.add(Chunk.encodeCoord(x, y, z));
      }
    }

    if (appendedCount === 0) return;

    // 同步数组存储并触发合并重建
    this.dirtyBlocks += appendedCount;
    this._initArrayStorageFromBlockData();
    this.scheduleConsolidation();
  }

  /**
   * 从散装的方块数据构建渲染 mesh
   * 按 type 分组后，自动选择合批模式或 per-chunk 模式
   */
  buildMeshesFromScatteredData() {
    // 按 type 分组
    const groupedByType = {};

    for (const [code, entry] of this.blockData) {
      const parsed = parseBlockEntry(entry);
      const type = parsed.type;
      const orientation = parsed.orientation || 0;
      const { x, y, z } = Chunk.decodeCoord(code);

      if (!groupedByType[type]) groupedByType[type] = [];
      groupedByType[type].push({ code, orientation, x, y, z });
    }

    // 构建 meshDataArray（兼容现有 buildMeshes 的输入格式）
    const meshDataArray = [];
    const dummy = new THREE.Object3D();

    for (const [type, blocks] of Object.entries(groupedByType)) {
      const props = getBlockProps(type);
      if (!props.isRendered) continue;

      const count = blocks.length;
      if (count === 0) continue;

      const matrices = new Float32Array(count * 16);
      const aoLow = new Float32Array(count);
      const aoHigh = new Float32Array(count);
      const orientationArr = new Float32Array(count);
      const instanceIndexMap = {};

      for (let i = 0; i < count; i++) {
        const b = blocks[i];
        dummy.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
        dummy.rotation.set(0, getRotationAngle(b.orientation), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        matrices.set(dummy.matrix.elements, i * 16);
        // AO 在 consolidation 时重新计算
        aoLow[i] = 1;
        aoHigh[i] = 1;
        orientationArr[i] = b.orientation;
        instanceIndexMap[b.code] = i;
      }

      meshDataArray.push({ type, count, matrices, aoLow, aoHigh, orientation: orientationArr, instanceIndexMap });
    }

    // 复用现有 buildMeshes 方法（自动处理合批/非合批模式）
    this.buildMeshes(meshDataArray);
  }
}

// 扩展Chunk类功能
extendWithConsolidation(Chunk);
extendWithGenerator(Chunk);
extendWithPersistence(Chunk);
extendWithRenderUtils(Chunk);
