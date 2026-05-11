// src/world/Chunk.js
/**
 * 区块管理器 - 负责区块的生成、渲染和管理
 * 使用 InstancedMesh 优化渲染性能，管理区块内的所有方块和实体
 */
import * as THREE from 'three';
import { encodeCoord, decodeCoord, normalizeBlocksToNumberKeys, coordKeyToCode } from '../utils/CoordEncoding.js';
import { aoBridge } from '../core/AOBridge.js';
import { materials } from '../core/MaterialManager.js';
import { persistenceService } from '../services/PersistenceService.js';
import { specialEntitiesShadowStore } from './SpecialEntitiesShadowStore.js';
import { faceCullingSystem } from '../core/FaceCullingSystem.js';
import { getBlockProperties, createBlockPropsResolver } from '../constants/BlockData.js';
import { getRotationAngle, parseBlockEntry } from '../utils/OrientationUtils.js';
import { getStructureRenderDist } from '../utils/StructureUtils.js';
import { createOcclusionChecker, computeBlockAOPacked, packAOData } from '../utils/AOUtils.js';
import { createChunkNeighborSampler } from './ChunkNeighborUtils.js';
import { extendChunk as extendWithConsolidation, CHUNK_SIZE, geomMap } from './ChunkConsolidation.js';
import { extendChunk as extendWithGenerator } from './ChunkGenerator.js';
import { extendChunk as extendWithPersistence } from './ChunkPersistence.js';
import { extendChunk as extendWithRenderUtils } from './ChunkRenderUtils.js';
import { FACE_MASK_ALL } from '../constants/GameConfig.js';
import { StaticModelInstancedRenderer } from './entities/StaticModelInstancedRenderer.js';
import { carModel, gunManModel } from '../core/Engine.js';
import { recordChunkPerf } from '../utils/ChunkPerfMonitor.js';

// 阴影投射白名单规则：所有”实心且可渲染”的方块都允许投射阴影
const isSolidShadowCaster = (props) => props.isSolid && props.isRendered !== false;
const isGlassType = (type) => typeof type === 'string' && type.includes('glass');

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;
const getFaceCullingSystem = () => globalThis._faceCullingSystem || faceCullingSystem;
const getMaterials = () => globalThis._materials || materials;
const getCarModel = () => globalThis._carModel || carModel;
const getGunManModel = () => globalThis._gunManModel || gunManModel;
const getAOBridge = () => globalThis._aoBridge || aoBridge;

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
   * 内联计算 4x4 变换矩阵（平移 + Y 轴旋转），避免 per-block 的 THREE.Object3D 开销
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {number} rotY - Y 轴旋转角度（弧度）
   * @param {Float32Array} target - 目标 Float32Array
   * @param {number} offset - 写入偏移（16 的倍数）
   */
  static _computeTransformMatrix(x, y, z, rotY, target, offset) {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    target[offset]     =  cos;  target[offset + 1]  = 0;  target[offset + 2]  = -sin;  target[offset + 3]  = 0;
    target[offset + 4] =  0;    target[offset + 5]  = 1;  target[offset + 6]  =  0;    target[offset + 7]  = 0;
    target[offset + 8] =  sin;  target[offset + 9]  = 0;  target[offset + 10] =  cos;  target[offset + 11] = 0;
    target[offset + 12] = x;    target[offset + 13] = y;  target[offset + 14] =  z;    target[offset + 15] = 1;
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
    this.awaitingStoreRecord = this.spawnReason === 'runtime-streaming';
    this.needsStoreRetry = this.spawnReason === 'runtime-streaming';
    this.hasPlayerMutations = false;
    this.deletedBlockTombstones = new Set();
    this.queuedAssemblyStages = new Set();
    this.pendingTerrainData = null;
    this.pendingSnapshot = null;
    this.pendingRuntimeEntities = null;
    this.pendingSpecialEntityData = null;
    this.hasDeferredFinalizeWork = false;
    this._needsDeferredPersistenceFlush = false;
    this._needsDeferredRuntimeEntityRestore = false;
    this._needsDeferredLightRegistration = false;
    this._needsEntityMigration = false;
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
     * solidBlocks — 实心方块世界坐标集合（Set<number>）
     * 存储该 Chunk 中所有 isSolid=true 的方块的世界坐标数字编码。
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
    this.lightSourceCoords = new Set(); // 光源方块坐标索引，避免遍历整个 blockData
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
     * _assemblyProgress — 可中断装配的游标状态
     * 仅在 runtime 装配过程中存在，完成后置 null。
     * 包含 hydrate 和 buildMesh 两个子阶段的游标信息。
     */
    this._assemblyProgress = null;

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

    // 渲染增量：追踪运行期方块修改，供 GlobalInstancedMeshManager.applyChunkDelta 消费
    this.renderDelta = {
      added: [],      // [{coord, entry, renderData}]
      removed: [],    // [coord]
      updated: []     // [{coord, entry, renderData}]
    };
    this._renderDeltaBudget = 500;  // delta 上限，超过后降级为全量刷新

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
    // 注意：runtime-streaming 阶段不再隐式调 gen()，由 World 显式控制装载路径
    if (world?.bootstrapState?.phase !== 'runtime-streaming') {
      this.gen();
    }
  }

  // ============================================================
  // 纯装载路径：从 ChunkRecord 装载数据（不调用 gen()）
  // ============================================================

  /**
   * 将 Chunk.blockData 挂接到 WorldBlockDataStore 的共享 authority slice
   * 此后 this.blockData 与 store 内部 slice 是同一个 Map 实例
   * 设置 _isAuthorityAttached 标志，供 assembleRuntimeHydratePhase 区分路径
   * @returns {boolean} 是否成功 attach
   */
  attachAuthoritySlice() {
    const store = this.world?.worldBlockDataStore;
    if (!store) return false;

    // 开发期断言：验证 slice 完整性
    store._verifySliceIntegrity(this.cx, this.cz, 'Chunk.attachAuthoritySlice');

    const slice = store.ensureChunkSlice(this.cx, this.cz);
    this.blockData = slice;
    store.markAttached(this.cx, this.cz);

    // 递增 assembly epoch，使旧异步回包失效
    this._assemblyEpoch = (this._assemblyEpoch || 0) + 1;

    // 显式标记 authority 已挂载，供 runtime-hydrate 阶段区分路径：
    // authority 路径不需要 _pendingChunkRecord，也不执行 blockData 注入
    this._isAuthorityAttached = true;

    return true;
  }

  /**
   * 从共享 authority slice 重建所有派生索引
   * 允许清空 visibleKeys/solidBlocks/blockDataArray/solidBlockIds 等派生层
   * 严禁清空或替换 authority slice（this.blockData）
   */
  rebuildDerivedIndexesFromAuthority() {
    // 清空派生索引层（不清空 authority slice）
    this.visibleKeys.clear();
    this.solidBlocks.clear();
    this.lightSourceCoords.clear();
    this.blockDataArray.fill(0);
    this.solidBlockIds.clear();
    this.blockPalette.clear();
    this.blockPaletteReverse.clear();
    this.nextBlockId = 1;

    // 从 authority slice 重建 blockDataArray / blockPalette / solidBlocks 等
    this._initArrayStorageFromBlockData();
  }

  /**
   * 从 authority slice 分离 Chunk.blockData 引用
   * 此后 this.blockData 置为空的 chunk-local Map，不再与 store 共享
   */
  detachAuthoritySlice() {
    const store = this.world?.worldBlockDataStore;
    if (store) {
      store.markDetached(this.cx, this.cz);
    }

    // 替换为空的 chunk-local Map（dispose 时使用）
    this.blockData = new Map();

    // 递增 assembly epoch，使旧异步回包失效
    this._assemblyEpoch = (this._assemblyEpoch || 0) + 1;
  }

  /**
   * 从权威 ChunkRecord 装载数据（纯装载，不生成地形）
   *
   * 流程：
   * 1. 注入 blockData（从 IndexedDB 读取的权威数据）
   * 2. 重建 blockDataArray / blockPalette / solidBlocks / solidBlockIds
   * 3. 发送 build-chunk-mesh 给 Worker
   * 4. Worker 返回 visibleKeys + meshData
   * 5. 主线程挂载渲染
   *
   * @param {object} chunkRecord - { blockData, staticEntities, runtimeSeedData }
   */
  async loadFromRecord(chunkRecord) {
    const perfStart = globalThis.performance?.now?.() ?? Date.now();

    if (!chunkRecord) {
      this.awaitingStoreRecord = true;
      this.needsStoreRetry = true;
      this.loadState = 'awaiting-store-record';
      const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - perfStart;
      recordChunkPerf('chunk.load-from-record.null-record', elapsed, {
        chunkKey: `${this.cx},${this.cz}`
      });
      return;
    }

    this.awaitingStoreRecord = false;
    this.needsStoreRetry = false;
    this.loadState = 'loading-from-record';

    const blockDataCount = chunkRecord.blockData ? Object.keys(chunkRecord.blockData).length : 0;

    // 7. 在真实 world 运行路径中，把纯装载装配交给主线程调度器切片执行，
    // 避免 loadFromRecord 自身同步完成 build + finalize。
    // 只缓存 chunkRecord，细粒度 stage 负责后续注入和装配。
    if (this.world?.onChunkWorkerReady) {
      this._pendingChunkRecord = chunkRecord;
      this.loadState = 'record-ready';
      this.isReady = false;

      const tEnqueueStart = globalThis.performance?.now?.() ?? Date.now();
      this.world.onChunkWorkerReady(this);
      const tEnqueueEnd = globalThis.performance?.now?.() ?? Date.now();
      recordChunkPerf('chunk.load-from-record.enqueue-assembly', tEnqueueEnd - tEnqueueStart, {
        chunkKey: `${this.cx},${this.cz}`
      });

      const totalMs = tEnqueueEnd - perfStart;
      recordChunkPerf('chunk.load-from-record.total', totalMs, {
        chunkKey: `${this.cx},${this.cz}`,
        blockDataCount,
        mode: 'fine-grained-stages'
      });
      return;
    }

    // 无 world 调度器的孤立/测试场景，保留同步路径以保持兼容。
    // 1. 注入 blockData 打点
    const effectiveBlockData = chunkRecord.blockData || {};
    const tInjectStart = globalThis.performance?.now?.() ?? Date.now();
    if (effectiveBlockData && blockDataCount > 0) {
      this._injectBlockData(effectiveBlockData);
    }
    const tInjectEnd = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.load-from-record.inject-block-data', tInjectEnd - tInjectStart, {
      chunkKey: `${this.cx},${this.cz}`,
      blockDataCount
    });

    // 2. 注入静态实体
    const tStaticEntitiesStart = globalThis.performance?.now?.() ?? Date.now();
    if (chunkRecord.staticEntities?.length > 0) {
      this._injectStaticEntities(chunkRecord.staticEntities);
    }
    const tStaticEntitiesEnd = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.load-from-record.inject-static-entities', tStaticEntitiesEnd - tStaticEntitiesStart, {
      chunkKey: `${this.cx},${this.cz}`,
      entityCount: chunkRecord.staticEntities?.length || 0
    });

    // 3. 注入结构中心
    if (chunkRecord.runtimeSeedData?.structureCenters) {
      this.structureCenters = chunkRecord.runtimeSeedData.structureCenters;
    }

    // 4. 纯加载路径不再额外构建 pendingSnapshot.blocks
    this.pendingSnapshot = null;
    this._isPureLoadPath = true;

    // 5. 恢复运行时实体数据
    const tEntitiesStart = globalThis.performance?.now?.() ?? Date.now();
    const hasRuntimeEntities = chunkRecord.runtimeEntities && (
      chunkRecord.runtimeEntities.turrets?.length > 0 ||
      chunkRecord.runtimeEntities.zombieNests?.length > 0 ||
      chunkRecord.runtimeEntities.minecarts?.length > 0
    );

    if (hasRuntimeEntities) {
      specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, chunkRecord.runtimeEntities);
      this._needsEntityMigration = false;
    } else {
      const liveShadowEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);
      const hasLiveShadowEntities = (
        liveShadowEntities.turrets?.length > 0 ||
        liveShadowEntities.zombieNests?.length > 0 ||
        liveShadowEntities.minecarts?.length > 0
      );

      if (!hasLiveShadowEntities) {
        specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, {
          turrets: [],
          zombieNests: [],
          minecarts: []
        });
      }
      this._needsEntityMigration = false;
    }

    this.pendingRuntimeEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);
    const tEntitiesEnd = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.load-from-record.entity-restore', tEntitiesEnd - tEntitiesStart, {
      chunkKey: `${this.cx},${this.cz}`,
      hasRuntimeEntities
    });

    // 同步路径：直接装配
    this._loadFromCachedRecord();
    this.loadState = 'terrain-built';
    this._buildMeshFromExistingBlockData();
    this.isReady = true;
    await this.finalizeNonDeferredPhase();
  }

  /**
   * 运行期 hydration 阶段（可中断）
   * 职责：将 blockData 注入 chunk 数据结构并重建派生索引
   *
   * 两条路径通过 _isAuthorityAttached 标志区分：
   * - authority attach 路径：World._requestRuntimeChunkRecord 已调用 attachAuthoritySlice() +
   *   rebuildDerivedIndexesFromAuthority() + 恢复 non-block payload，此处只需处理
   *   runtimeEntities 迁移并跳过 blockData 注入
   * - cold import 路径：_pendingChunkRecord 中有完整的 chunkRecord，需分批注入 blockData
   *   并重建派生索引
   *
   * @returns {'done' | 'continue' | boolean}
   */
  assembleRuntimeHydratePhase() {
    if (this.loadState !== 'record-ready') {
      return this.loadState === 'hydrated' || this.loadState === 'terrain-built' ||
             this.loadState === 'entities-built' || this.loadState === 'finalized';
    }

    // --- 路径 A：authority attach 路径 ---
    // World._requestRuntimeChunkRecord 已调用 attachAuthoritySlice() +
    // rebuildDerivedIndexesFromAuthority() + 恢复 staticEntities/structureCenters，
    // 此处只需处理 runtimeEntities 迁移，无需注入 blockData
    if (this._isAuthorityAttached) {
      this._isAuthorityAttached = false;

      // 合并/标记 runtimeEntities（对齐 cold import 路径的尾部逻辑）
      const liveShadowEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);
      const hasLiveShadowEntities = (
        liveShadowEntities.turrets?.length > 0 ||
        liveShadowEntities.zombieNests?.length > 0 ||
        liveShadowEntities.minecarts?.length > 0
      );
      if (!hasLiveShadowEntities) {
        specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, {
          turrets: [], zombieNests: [], minecarts: []
        });
      }
      this._needsEntityMigration = false;
      this.pendingRuntimeEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);

      this.pendingSnapshot = null;
      this._isPureLoadPath = true;
      this._pendingChunkRecord = null;
      this.loadState = 'hydrated';
      return 'done';
    }

    // --- 路径 B：cold import 路径 ---
    // _pendingChunkRecord 中有完整的 chunkRecord（来自 loadFromRecord 或 cold boundary），
    // 需要分批注入 blockData 并重建派生索引
    const chunkRecord = this._pendingChunkRecord;
    const effectiveBlockData = chunkRecord?.blockData || {};

    // 首次调用：初始化
    if (!this._assemblyProgress?.hydrate) {
      if (Object.keys(effectiveBlockData).length > 0) {
        this._clearForBlockInjection(effectiveBlockData);
      } else {
        // 没有 blockData 需要注入，直接跳到尾部逻辑
        if (chunkRecord?.staticEntities?.length > 0) {
          this._injectStaticEntities(chunkRecord.staticEntities);
        }
        if (chunkRecord?.runtimeSeedData?.structureCenters) {
          this.structureCenters = chunkRecord.runtimeSeedData.structureCenters;
        }
        this.pendingSnapshot = null;
        this._isPureLoadPath = true;
        this._pendingChunkRecord = null;
        this.loadState = 'hydrated';
        return 'done';
      }
    }

    const result = this._injectBlockDataBatch(3);
    if (result === 'done') {
      if (chunkRecord?.staticEntities?.length > 0) {
        this._injectStaticEntities(chunkRecord.staticEntities);
      }
      if (chunkRecord?.runtimeSeedData?.structureCenters) {
        this.structureCenters = chunkRecord.runtimeSeedData.structureCenters;
      }
      this.pendingSnapshot = null;
      this._isPureLoadPath = true;

      const hasRuntimeEntities = chunkRecord?.runtimeEntities && (
        chunkRecord.runtimeEntities.turrets?.length > 0 ||
        chunkRecord.runtimeEntities.zombieNests?.length > 0 ||
        chunkRecord.runtimeEntities.minecarts?.length > 0
      );

      if (hasRuntimeEntities) {
        specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, chunkRecord.runtimeEntities);
        this._needsEntityMigration = false;
      } else {
        const liveShadowEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);
        const hasLiveShadowEntities = (
          liveShadowEntities.turrets?.length > 0 ||
          liveShadowEntities.zombieNests?.length > 0 ||
          liveShadowEntities.minecarts?.length > 0
        );
        if (!hasLiveShadowEntities) {
          specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, {
            turrets: [],
            zombieNests: [],
            minecarts: []
          });
        }
        this._needsEntityMigration = false;
      }

      this.pendingRuntimeEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);
      this._pendingChunkRecord = null;
      this._assemblyProgress = null;
      this.loadState = 'hydrated';
    }

    return result;
  }

  /**
   * 运行期 finalize：实体恢复
   */
  assembleRuntimeFinalizePhase() {
    if (this.loadState === 'finalized') return true;
    if (this.loadState !== 'terrain-built') {
      return this.loadState === 'entities-built';
    }

    this.assembleEntityPhase();
    this._isPureLoadPath = true;
    this.loadState = 'entities-built';
    return true;
  }

  /**
   * 可中断装配：清空派生索引并初始化 hydrate 游标
   * 注意：shared authority view 下严禁清空 this.blockData，只清空派生索引层
   * 本方法仅用于 cold import 路径，不参与 authority attach 路径
   * @param {object} blockData - 原始 blockData 对象（仅用于计算游标进度）
   */
  _clearForBlockInjection(blockData) {
    // shared authority view 模式下禁止清空 blockData
    // 只清空派生索引层
    this.blockDataArray.fill(0);
    this.blockPalette.clear();
    this.blockPaletteReverse.clear();
    this.solidBlocks.clear();
    this.solidBlockIds.clear();
    this.lightSourceCoords.clear();
    this.nextBlockId = 1;

    this._assemblyProgress = {
      hydrate: {
        blockEntries: Object.entries(blockData).map(([k, v]) => [Number(k), v]),
        cursor: 0,
        totalBlocks: Object.keys(blockData).length
      }
    };
  }

  /**
   * 可中断装配：从 cold import plain object 分批重建派生索引
   * 职责：将 blockData 条目写入 this.blockData（shared Map）并同步更新派生索引，
   * 仅供 cold import 路径的 assembleRuntimeHydratePhase 调用
   * @param {number} maxMs - 时间预算（毫秒）
   * @returns {'done' | 'continue'}
   */
  _injectBlockDataBatch(maxMs = 3) {
    const progress = this._assemblyProgress?.hydrate;
    if (!progress) return 'done';

    const { blockEntries, totalBlocks } = progress;
    const start = globalThis.performance?.now?.() ?? Date.now();

    while (progress.cursor < totalBlocks) {
      const [code, entry] = blockEntries[progress.cursor];
      const decoded = Chunk.decodeCoord(code);
      const type = typeof entry === 'string' ? entry : entry.type;
      const orientation = typeof entry === 'object' ? (entry.orientation || 0) : 0;

      this.blockData.set(code, entry);

      const props = getBlockProps(type);
      if (props?.isSolid) {
        this.solidBlocks.add(code);
      }
      if (props?.isLightSource) {
        this.lightSourceCoords.add(code);
      }

      const blockIndex = this._getBlockIndex(decoded.x, decoded.y, decoded.z);
      if (blockIndex >= 0 && type !== 'air') {
        const blockEntry = typeof entry === 'string' ? entry : { type, orientation };
        const blockId = this._getOrCreateBlockId(blockEntry);
        this.blockDataArray[blockIndex] = blockId;
        if (props?.isSolid) {
          this.solidBlockIds.add(blockId);
        }
      }

      progress.cursor++;

      if ((globalThis.performance?.now?.() ?? Date.now()) - start >= maxMs) {
        recordChunkPerf('chunk.inject-block-data.partial', (globalThis.performance?.now?.() ?? Date.now()) - start, {
          chunkKey: `${this.cx},${this.cz}`,
          cursor: progress.cursor,
          totalBlocks: progress.totalBlocks
        }, { thresholdMs: 0 });
        return 'continue';
      }
    }

    return 'done';
  }

  /**
   * 从 _pendingChunkRecord 中提取数据并注入（同步路径，供非 scheduler 场景使用）
   * 仅用于 loadFromRecord 的孤立/测试同步降级路径，
   * 在正常 runtime 中由 assembleRuntimeHydratePhase 分帧执行
   */
  _loadFromCachedRecord() {
    const chunkRecord = this._pendingChunkRecord;
    if (!chunkRecord) return;

    const effectiveBlockData = chunkRecord.blockData || {};
    if (effectiveBlockData && Object.keys(effectiveBlockData).length > 0) {
      this._injectBlockData(effectiveBlockData);
    }

    if (chunkRecord.staticEntities?.length > 0) {
      this._injectStaticEntities(chunkRecord.staticEntities);
    }

    if (chunkRecord.runtimeSeedData?.structureCenters) {
      this.structureCenters = chunkRecord.runtimeSeedData.structureCenters;
    }

    this.pendingSnapshot = null;
    this._isPureLoadPath = true;

    const hasRuntimeEntities = chunkRecord.runtimeEntities && (
      chunkRecord.runtimeEntities.turrets?.length > 0 ||
      chunkRecord.runtimeEntities.zombieNests?.length > 0 ||
      chunkRecord.runtimeEntities.minecarts?.length > 0
    );

    if (hasRuntimeEntities) {
      specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, chunkRecord.runtimeEntities);
      this._needsEntityMigration = false;
    } else {
      const liveShadowEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);
      const hasLiveShadowEntities = (
        liveShadowEntities.turrets?.length > 0 ||
        liveShadowEntities.zombieNests?.length > 0 ||
        liveShadowEntities.minecarts?.length > 0
      );
      if (!hasLiveShadowEntities) {
        specialEntitiesShadowStore.deserializeAndMerge(this.cx, this.cz, {
          turrets: [],
          zombieNests: [],
          minecarts: []
        });
      }
      this._needsEntityMigration = false;
    }

    this.pendingRuntimeEntities = specialEntitiesShadowStore.getAllEntitiesInChunk(this.cx, this.cz);
    this._pendingChunkRecord = null;
  }

  /**
   * 从 plain object 重建 this.blockData 条目并重建所有派生索引
   * 注意：shared authority view 下不清空 this.blockData，只写入/更新条目并重建派生索引
   *
   * 职责边界：
   * - 同步路径冷导入 helper：供 _loadFromCachedRecord / loadFromRecord 同步降级路径使用
   * - 不承担 runtime 主链路中分帧注入 blockData 的职责（由 _injectBlockDataBatch 承担）
   * - 不参与 authority attach 路径（authority 路径由 attachAuthoritySlice + rebuildDerivedIndexesFromAuthority 完成）
   */
  _injectBlockData(blockData) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    // 清空派生索引（不清空 shared blockData）
    const tClearStart = globalThis.performance?.now?.() ?? Date.now();
    this.blockDataArray.fill(0);
    this.blockPalette.clear();
    this.blockPaletteReverse.clear();
    this.solidBlocks.clear();
    this.solidBlockIds.clear();
    this.lightSourceCoords.clear();
    this.nextBlockId = 1;
    const tClearEnd = globalThis.performance?.now?.() ?? Date.now();

    // 注入新数据（直接写入 this.blockData，shared view 下即写入 authority）
    let solidCount = 0;
    let lightCount = 0;
    let arrayWriteCount = 0;
    for (const [key, entry] of Object.entries(blockData)) {
      const code = Number(key);
      const decoded = Chunk.decodeCoord(code);
      const type = typeof entry === 'string' ? entry : entry.type;
      const orientation = typeof entry === 'object' ? (entry.orientation || 0) : 0;

      this.blockData.set(code, entry);

      const props = getBlockProps(type);
      if (props?.isSolid) {
        this.solidBlocks.add(code);
        solidCount++;
      }
      if (props?.isLightSource) {
        this.lightSourceCoords.add(code);
        lightCount++;
      }

      // 尝试填充 blockDataArray（仅 Y:0~15）
      const blockIndex = this._getBlockIndex(decoded.x, decoded.y, decoded.z);
      if (blockIndex >= 0 && type !== 'air') {
        const blockEntry = typeof entry === 'string' ? entry : { type, orientation };
        const blockId = this._getOrCreateBlockId(blockEntry);
        this.blockDataArray[blockIndex] = blockId;
        if (props?.isSolid) {
          this.solidBlockIds.add(blockId);
        }
        arrayWriteCount++;
      }
    }
    const t1 = globalThis.performance?.now?.() ?? Date.now();
    const totalMs = t1 - t0;
    recordChunkPerf('chunk.inject-block-data', totalMs, {
      chunkKey: `${this.cx},${this.cz}`,
      totalBlocks: Object.keys(blockData).length,
      clearMs: tClearEnd - tClearStart,
      iterateAndWriteMs: t1 - tClearEnd,
      solidCount,
      lightCount,
      arrayWriteCount
    }, { thresholdMs: 0 });
  }

  /**
   * 注入静态实体
   */
  _injectStaticEntities(entities) {
    for (const entity of entities) {
      if (entity.type === 'modGunMan' && entity.positions) {
        this.entities.modGunMan.push(...entity.positions);
      }
      if (entity.type === 'rovers' && entity.positions) {
        this.entities.rovers.push(...entity.positions);
      }
    }
  }

  /**
   * 运行期网格构建阶段（可中断）
   * @returns {'done' | 'continue' | boolean}
   */
  assembleRuntimeBuildMeshPhase() {
    if (this.loadState === 'finalized') return true;
    if (this.loadState !== 'hydrated') {
      return this.loadState === 'terrain-built' || this.loadState === 'entities-built';
    }

    const result = this._buildMeshFromExistingBlockDataIncremental(3);
    if (result === 'done') {
      this.loadState = 'terrain-built';
      this.isReady = true;
    }
    return result;
  }

  /**
   * 可中断装配：分批构建 mesh 数据
   * 内部状态机：iterate → convert-group → visible → build-mesh
   * @param {number} maxMs - 时间预算（毫秒）
   * @returns {'done' | 'continue'}
   */
  _buildMeshFromExistingBlockDataIncremental(maxMs = 3) {
    const start = globalThis.performance?.now?.() ?? Date.now();
    const cx = this.cx;
    const cz = this.cz;
    const minX = cx * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE;
    const chunkKey = `${cx},${cz}`;
    const stageThresholds = {
      iteratePassMs: 2,
      convertInitMs: 1,
      convertBatchMs: 1,
      visiblePassMs: 1,
      buildMeshesMs: 2,
      invocationMs: Math.max(2, maxMs),
      budgetExhaustedMs: Math.max(2, maxMs)
    };
    const pushTopSlowItem = (list, item, limit = 3) => {
      list.push(item);
      list.sort((a, b) => b.durationMs - a.durationMs);
      if (list.length > limit) list.length = limit;
    };
    const createInvocationStats = () => ({
      stageAtStart: null,
      iterateScannedEntries: 0,
      iterateEmittedBlocks: 0,
      convertBatchCount: 0,
      convertBlocksProcessed: 0,
      convertCompletedGroups: 0,
      convertCompletedTypes: [],
      convertSlowGroups: [],
      visiblePassCount: 0,
      visibleBlocksProcessed: 0,
      visibleSlowPasses: [],
      visibleMaxPassMs: 0,
      buildMeshesMs: 0
    });
    const resetBuildMeshProgressState = (progress, sourceEpoch) => {
      progress.subStage = 'iterate';
      progress.cursor = 0;
      progress.blocks.length = 0;
      progress.meshData = null;
      progress.groupedByType = null;
      progress.groupKeys = null;
      progress.groupCursor = 0;
      progress.groupInnerCursor = 0;
      progress._cachedEntries = null;
      progress._cachedEntriesEpoch = -1;
      progress._cachedEntriesSize = -1;
      progress._currentGroup = null;
      progress._sourceEpoch = sourceEpoch;
    };

    // 首次调用：初始化 progress
    if (!this._assemblyProgress) {
      this._assemblyProgress = {};
    }
    const currentEpoch = this._assemblyEpoch || 0;
    if (!this._assemblyProgress.buildMesh) {
      this._assemblyProgress.buildMesh = {
        subStage: 'iterate',
        cursor: 0,
        blocks: [],
        meshData: null,
        // convert-group 子状态
        groupedByType: null,
        groupKeys: null,
        groupCursor: 0,
        groupInnerCursor: 0,
        // 临时状态
        _cachedEntries: null,
        _cachedEntriesEpoch: -1,
        _cachedEntriesSize: -1,
        _currentGroup: null,
        _sourceEpoch: currentEpoch,
        _invocationStats: createInvocationStats(),
        metrics: {
          invocationCount: 0,
          slowInvocationCount: 0,
          staleRestartCount: 0,
          budgetExhaustedCount: 0,
          iteratePasses: 0,
          iterateSnapshotMs: 0,
          iterateLoopMs: 0,
          iterateBlocks: 0,
          iterateSlowPasses: 0,
          iterateMaxMs: 0,
          convertInitMs: 0,
          convertInitCount: 0,
          convertInitSlowCount: 0,
          convertInitMaxMs: 0,
          convertBatches: 0,
          convertBatchMs: 0,
          convertBlocks: 0,
          convertBatchSlowCount: 0,
          convertBatchMaxMs: 0,
          visiblePasses: 0,
          visibleMs: 0,
          visibleBlocks: 0,
          visibleSlowPasses: 0,
          visibleMaxMs: 0,
          buildMeshesMs: 0,
          buildMeshesCount: 0,
          buildMeshesSlowCount: 0,
          buildMeshesMaxMs: 0
        }
      };
    }

    const p = this._assemblyProgress.buildMesh;
    if (p._sourceEpoch !== currentEpoch) {
      p.metrics.staleRestartCount++;
      resetBuildMeshProgressState(p, currentEpoch);
      this.visibleKeys.clear();
    }
    p.metrics.invocationCount++;
    const invocationIndex = p.metrics.invocationCount;
    p._invocationStats = createInvocationStats();
    p._invocationStats.stageAtStart = p.subStage;
    const finishInvocation = (result, extra = {}) => {
      const invocationMs = (globalThis.performance?.now?.() ?? Date.now()) - start;
      const isDone = result === 'done';
      const isSlowInvocation = invocationMs >= stageThresholds.invocationMs;
      const isBudgetExhausted = extra.exitReason === 'budget-exhausted';
      if (isSlowInvocation) {
        p.metrics.slowInvocationCount++;
      }
      if (isBudgetExhausted) {
        p.metrics.budgetExhaustedCount++;
      }
      if (isDone || isSlowInvocation || isBudgetExhausted) {
        recordChunkPerf('chunk.build-mesh.increment.summary', invocationMs, {
          chunkKey,
          invocationIndex,
          result,
          subStage: p.subStage,
          cursor: p.cursor,
          groupCursor: p.groupCursor,
          groupInnerCursor: p.groupInnerCursor,
          blocksBuffered: p.blocks.length,
          meshGroups: p.meshData?.length || 0,
          invocationProfile: { ...p._invocationStats },
          metrics: { ...p.metrics },
          ...extra
        }, { thresholdMs: 0 });
      }
      return result;
    };

    while ((globalThis.performance?.now?.() ?? Date.now()) - start < maxMs) {
      switch (p.subStage) {
        case 'iterate': {
          const iterateStartedAt = globalThis.performance?.now?.() ?? Date.now();
          const snapshotStartedAt = globalThis.performance?.now?.() ?? Date.now();
          const iterateEpoch = this._assemblyEpoch || 0;
          const currentSize = this.blockData?.size || 0;
          if (!p._cachedEntries || p._cachedEntriesEpoch !== iterateEpoch || p._cachedEntriesSize !== currentSize) {
            // 快照已失效，整段 iterate 必须重启，避免旧快照前半段和新快照后半段混用
            p.cursor = 0;
            p.blocks.length = 0;
            p._cachedEntries = [...this.blockData.entries()];
            p._cachedEntriesEpoch = iterateEpoch;
            p._cachedEntriesSize = currentSize;
          }
          const entries = p._cachedEntries;
          const snapshotMs = (globalThis.performance?.now?.() ?? Date.now()) - snapshotStartedAt;
          const cursorStart = p.cursor;
          const end = Math.min(p.cursor + 128, entries.length);
          let emittedBlocks = 0;
          let outOfRangeCount = 0;
          let airCount = 0;
          const iterateLoopStartedAt = globalThis.performance?.now?.() ?? Date.now();
          for (let i = p.cursor; i < end; i++) {
            const [code, entry] = entries[i];
            const decoded = Chunk.decodeCoord(Number(code));
            const localX = decoded.x - minX;
            const localZ = decoded.z - minZ;
            if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
              outOfRangeCount++;
              continue;
            }
            const type = typeof entry === 'string' ? entry : entry.type;
            if (type === 'air') {
              airCount++;
              continue;
            }
            const orientation = typeof entry === 'object' ? (entry.orientation || 0) : 0;
            p.blocks.push({ x: decoded.x, y: decoded.y, z: decoded.z, type, orientation });
            emittedBlocks++;
          }
          const iterateLoopMs = (globalThis.performance?.now?.() ?? Date.now()) - iterateLoopStartedAt;
          p.cursor = end;
          p.metrics.iteratePasses++;
          p.metrics.iterateSnapshotMs += snapshotMs;
          p.metrics.iterateLoopMs += iterateLoopMs;
          p.metrics.iterateBlocks += emittedBlocks;
          p._invocationStats.iterateScannedEntries += end - cursorStart;
          p._invocationStats.iterateEmittedBlocks += emittedBlocks;
          const iterateMs = (globalThis.performance?.now?.() ?? Date.now()) - iterateStartedAt;
          p.metrics.iterateMaxMs = Math.max(p.metrics.iterateMaxMs, iterateMs);
          if (iterateMs >= stageThresholds.iteratePassMs) {
            p.metrics.iterateSlowPasses++;
            recordChunkPerf('chunk.build-mesh.iterate-pass', iterateMs, {
              chunkKey,
              invocationIndex,
              cursorStart,
              cursorEnd: end,
              entriesLength: entries.length,
              scannedEntries: end - cursorStart,
              emittedBlocks,
              outOfRangeCount,
              airCount,
              snapshotMs,
              iterateLoopMs
            }, { thresholdMs: 0 });
          }
          if (p.cursor < entries.length) return finishInvocation('continue', { exitReason: 'iterate-partial' });
          p.subStage = 'convert-group';
          p.cursor = 0;
          p._cachedEntries = null;  // 释放快照数组，节省内存
          break;
        }

        case 'convert-group': {
          // 首次：按 type 分组
          if (!p.groupedByType) {
            const initStartedAt = globalThis.performance?.now?.() ?? Date.now();
            p.groupedByType = {};
            for (const block of p.blocks) {
              const type = block.type;
              if (!p.groupedByType[type]) p.groupedByType[type] = [];
              p.groupedByType[type].push(block);
            }
            p.groupKeys = Object.keys(p.groupedByType);
            p.meshData = [];
            const initMs = (globalThis.performance?.now?.() ?? Date.now()) - initStartedAt;
            p.metrics.convertInitCount++;
            p.metrics.convertInitMs += initMs;
            p.metrics.convertInitMaxMs = Math.max(p.metrics.convertInitMaxMs, initMs);
            if (initMs >= stageThresholds.convertInitMs) {
              p.metrics.convertInitSlowCount++;
              recordChunkPerf('chunk.build-mesh.convert-group.init', initMs, {
                chunkKey,
                invocationIndex,
                blocksBuffered: p.blocks.length,
                groupCount: p.groupKeys.length
              }, { thresholdMs: 0 });
            }
          }

          // 逐组处理
          while (p.groupCursor < p.groupKeys.length) {
            const type = p.groupKeys[p.groupCursor];
            const blocks = p.groupedByType[type];
            const count = blocks.length;

            // 新组：检查预算
            if (p.groupInnerCursor === 0 && (globalThis.performance?.now?.() ?? Date.now()) - start >= maxMs) {
              return 'continue';
            }

            // 初始化当前组
            if (p.groupInnerCursor === 0) {
              p._currentGroup = {
                type,
                count,
                matrices: new Float32Array(count * 16),
                aoLow: new Float32Array(count),
                aoHigh: new Float32Array(count),
                orientation: new Float32Array(count),
                instanceIndexMap: {},
                perf: {
                  startedAt: globalThis.performance?.now?.() ?? Date.now(),
                  processedBlocks: 0,
                  batchCount: 0,
                  totalBatchMs: 0,
                  maxBatchMs: 0
                }
              };
            }

            const group = p._currentGroup;
            const batchSize = 128;
            const batchStartedAt = globalThis.performance?.now?.() ?? Date.now();
            const gEnd = Math.min(p.groupInnerCursor + batchSize, count);
            let matrixCopyCount = 0;
            let matrixComputeCount = 0;
            for (let i = p.groupInnerCursor; i < gEnd; i++) {
              const b = blocks[i];
              if (b.matrix) {
                group.matrices.set(b.matrix, i * 16);
                matrixCopyCount++;
              } else {
                const mx = b.x + 0.5;
                const my = b.y + 0.5;
                const mz = b.z + 0.5;
                const rot = getRotationAngle(b.orientation || 0);
                Chunk._computeTransformMatrix(mx, my, mz, rot, group.matrices, i * 16);
                matrixComputeCount++;
              }
              group.aoLow[i] = b.aoLow ?? 1;
              group.aoHigh[i] = b.aoHigh ?? 1;
              group.orientation[i] = b.orientation;
              const code = Chunk.encodeCoord(b.x, b.y, b.z);
              group.instanceIndexMap[code] = i;
            }
            const batchMs = (globalThis.performance?.now?.() ?? Date.now()) - batchStartedAt;
            p.metrics.convertBatches++;
            p.metrics.convertBatchMs += batchMs;
            p.metrics.convertBlocks += gEnd - p.groupInnerCursor;
            p.metrics.convertBatchMaxMs = Math.max(p.metrics.convertBatchMaxMs, batchMs);
            p._invocationStats.convertBatchCount++;
            p._invocationStats.convertBlocksProcessed += gEnd - p.groupInnerCursor;
            group.perf.processedBlocks += gEnd - p.groupInnerCursor;
            group.perf.batchCount++;
            group.perf.totalBatchMs += batchMs;
            group.perf.maxBatchMs = Math.max(group.perf.maxBatchMs, batchMs);
            if (batchMs >= stageThresholds.convertBatchMs) {
              p.metrics.convertBatchSlowCount++;
              recordChunkPerf('chunk.build-mesh.convert-group.batch', batchMs, {
                chunkKey,
                invocationIndex,
                type,
                groupCursor: p.groupCursor,
                groupInnerCursorStart: p.groupInnerCursor,
                groupInnerCursorEnd: gEnd,
                groupSize: count,
                processedBlocks: gEnd - p.groupInnerCursor,
                groupProcessedTotal: group.perf.processedBlocks,
                groupRemaining: count - gEnd,
                groupBatchCount: group.perf.batchCount,
                groupTotalBatchMs: group.perf.totalBatchMs,
                groupMaxBatchMs: group.perf.maxBatchMs,
                matrixCopyCount,
                matrixComputeCount
              }, { thresholdMs: 0 });
            }
            p.groupInnerCursor = gEnd;

            if (p.groupInnerCursor < count) return finishInvocation('continue', {
              exitReason: 'convert-group-partial',
              activeType: type
            });

            // 组完成
            const groupElapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - group.perf.startedAt;
            const groupSummary = {
              type,
              blockCount: count,
              batchCount: group.perf.batchCount,
              totalBatchMs: group.perf.totalBatchMs,
              maxBatchMs: group.perf.maxBatchMs,
              durationMs: groupElapsedMs
            };
            p._invocationStats.convertCompletedGroups++;
            if (p._invocationStats.convertCompletedTypes.length < 6) {
              p._invocationStats.convertCompletedTypes.push(type);
            }
            pushTopSlowItem(p._invocationStats.convertSlowGroups, groupSummary);
            p.meshData.push(group);
            p._currentGroup = null;
            p.groupCursor++;
            p.groupInnerCursor = 0;
          }

          p.subStage = 'visible';
          p.cursor = 0;
          break;
        }

        case 'visible': {
          const visibleStartedAt = globalThis.performance?.now?.() ?? Date.now();
          const cursorStart = p.cursor;
          const end = Math.min(p.cursor + 256, p.blocks.length);
          for (let i = p.cursor; i < end; i++) {
            const block = p.blocks[i];
            this.visibleKeys.add(Chunk.encodeCoord(block.x, block.y, block.z));
          }
          const visibleMs = (globalThis.performance?.now?.() ?? Date.now()) - visibleStartedAt;
          p.cursor = end;
          p.metrics.visiblePasses++;
          p.metrics.visibleMs += visibleMs;
          p.metrics.visibleBlocks += end - cursorStart;
          p._invocationStats.visiblePassCount++;
          p._invocationStats.visibleBlocksProcessed += end - cursorStart;
          p._invocationStats.visibleMaxPassMs = Math.max(p._invocationStats.visibleMaxPassMs, visibleMs);
          p.metrics.visibleMaxMs = Math.max(p.metrics.visibleMaxMs, visibleMs);
          if (visibleMs >= stageThresholds.visiblePassMs) {
            p.metrics.visibleSlowPasses++;
            pushTopSlowItem(p._invocationStats.visibleSlowPasses, {
              cursorStart,
              cursorEnd: end,
              processedBlocks: end - cursorStart,
              durationMs: visibleMs
            });
            recordChunkPerf('chunk.build-mesh.visible-pass', visibleMs, {
              chunkKey,
              invocationIndex,
              cursorStart,
              cursorEnd: end,
              processedBlocks: end - cursorStart,
              totalBlocks: p.blocks.length,
              visibleProcessedTotal: p._invocationStats.visibleBlocksProcessed,
              visibleRemaining: p.blocks.length - end
            }, { thresholdMs: 0 });
          }
          if (p.cursor < p.blocks.length) return finishInvocation('continue', { exitReason: 'visible-partial' });
          p.subStage = 'build-mesh';
          break;
        }

        case 'build-mesh': {
          const buildMeshesStartedAt = globalThis.performance?.now?.() ?? Date.now();
          this.buildMeshes(p.meshData);
          const buildMeshesMs = (globalThis.performance?.now?.() ?? Date.now()) - buildMeshesStartedAt;
          p._invocationStats.buildMeshesMs = buildMeshesMs;
          p.metrics.buildMeshesCount++;
          p.metrics.buildMeshesMs += buildMeshesMs;
          p.metrics.buildMeshesMaxMs = Math.max(p.metrics.buildMeshesMaxMs, buildMeshesMs);
          if (buildMeshesMs >= stageThresholds.buildMeshesMs) {
            p.metrics.buildMeshesSlowCount++;
            recordChunkPerf('chunk.build-mesh.build-mesh', buildMeshesMs, {
              chunkKey,
              invocationIndex,
              meshGroups: p.meshData?.length || 0,
              blocksBuffered: p.blocks.length
            }, { thresholdMs: 0 });
          }
          p.subStage = 'done';
          break;
        }

        case 'done':
          return finishInvocation('done');
      }
    }

    // 预算耗尽
    if (p.subStage !== 'done') {
      const elapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - start;
      if (elapsedMs >= stageThresholds.budgetExhaustedMs) {
        recordChunkPerf('chunk.build-mesh-increment.partial', elapsedMs, {
          chunkKey,
          subStage: p.subStage,
          cursor: p.cursor,
          groupCursor: p.groupCursor,
          blocksProcessed: p.blocks.length,
          invocationProfile: { ...p._invocationStats }
        }, { thresholdMs: 0 });
      }
      return finishInvocation('continue', {
        exitReason: 'budget-exhausted',
        elapsedMs
      });
    }
    return finishInvocation('done');
  }

  /**
   * 从已有的 blockData 直接构建 mesh（跳过 scatter 流程）
   *
   * 用于 loadFromRecord 纯装载路径：预生成阶段已完成方块打散，
   * ChunkRecord 的 blockData 就是最终归属数据，不需要再走 BlockScatterManager。
   */
  _buildMeshFromExistingBlockData() {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const cx = this.cx;
    const cz = this.cz;
    const minX = cx * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE;

    // 1. 从 blockData 构建方块列表（遍历 + 解码 + 过滤）
    const tBuildBlocksStart = globalThis.performance?.now?.() ?? Date.now();
    const blocks = [];
    let iteratedCount = 0;
    let outOfRangeCount = 0;
    let airCount = 0;
    for (const [code, entry] of this.blockData) {
      iteratedCount++;
      const decoded = Chunk.decodeCoord(Number(code));
      const localX = decoded.x - minX;
      const localZ = decoded.z - minZ;

      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
        outOfRangeCount++;
        continue;
      }

      const type = typeof entry === 'string' ? entry : entry.type;
      if (type === 'air') {
        airCount++;
        continue;
      }

      const orientation = typeof entry === 'object' ? (entry.orientation || 0) : 0;
      blocks.push({ x: decoded.x, y: decoded.y, z: decoded.z, type, orientation });
    }
    const tBuildBlocksEnd = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.build-mesh-from-record.iterate-blocks', tBuildBlocksEnd - tBuildBlocksStart, {
      chunkKey: `${cx},${cz}`,
      iteratedCount,
      validBlocks: blocks.length,
      outOfRangeCount,
      airCount
    });

    // 2. 按类型分组，计算可见性和 AO（_convertScatteredBlocksToMeshData）
    const tConvertStart = globalThis.performance?.now?.() ?? Date.now();
    const meshData = this._convertScatteredBlocksToMeshData(blocks, null, this.structureCenters || []);
    const tConvertEnd = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.build-mesh-from-record.convert-mesh-data', tConvertEnd - tConvertStart, {
      chunkKey: `${cx},${cz}`,
      inputBlocks: blocks.length,
      meshGroups: meshData?.length || 0
    });

    // 3. 构建 visibleKeys（所有非空气方块）
    const tVisibleKeysStart = globalThis.performance?.now?.() ?? Date.now();
    this.visibleKeys.clear();
    for (const block of blocks) {
      this.visibleKeys.add(Chunk.encodeCoord(block.x, block.y, block.z));
    }
    const tVisibleKeysEnd = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.build-mesh-from-record.build-visible-keys', tVisibleKeysEnd - tVisibleKeysStart, {
      chunkKey: `${cx},${cz}`,
      visibleCount: this.visibleKeys.size
    });

    // 4. 构建 mesh（调用 GlobalInstancedMeshManager 或传统路径）
    const tBuildMeshStart = globalThis.performance?.now?.() ?? Date.now();
    this.buildMeshes(meshData);
    const tBuildMeshEnd = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.build-mesh-from-record.build-meshes', tBuildMeshEnd - tBuildMeshStart, {
      chunkKey: `${cx},${cz}`,
      meshGroups: meshData?.length || 0
    });

    const totalMs = tBuildMeshEnd - t0;
    recordChunkPerf('chunk.load-from-record', totalMs, {
      chunkKey: `${cx},${cz}`,
      blockDataSize: this.blockData.size,
      blockCount: blocks.length,
      meshGroups: meshData?.length || 0,
      iterateBlocksMs: tBuildBlocksEnd - tBuildBlocksStart,
      convertMeshDataMs: tConvertEnd - tConvertStart,
      buildVisibleKeysMs: tVisibleKeysEnd - tVisibleKeysStart,
      buildMeshesMs: tBuildMeshEnd - tBuildMeshStart
    });
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
   * 统一采用“坐标所属 Chunk 唯一 owner”语义
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {boolean} 是否在责任范围内
   */
  _isInResponsibility(x, y, z) {
    const localX = Math.floor(x) - this.cx * CHUNK_SIZE;
    const localZ = Math.floor(z) - this.cz * CHUNK_SIZE;
    return localX >= 0 && localX < CHUNK_SIZE && localZ >= 0 && localZ < CHUNK_SIZE;
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
    this.world?.scatterManager?.invalidatePendingBlock?.(x, y, z);

    // === blockData 权威存储：优先通过 store mutation primitive ===
    const blockStore = this.world?.worldBlockDataStore;
    if (blockStore) {
      // 延迟 attach：确保 this.blockData 指向 store 的共享 slice
      if (!blockStore.isAttached(this.cx, this.cz)) {
        this.blockData = blockStore.ensureChunkSlice(this.cx, this.cz);
        blockStore.markAttached(this.cx, this.cz);
        this._assemblyEpoch = (this._assemblyEpoch || 0) + 1;
      }
      // 通过 store 原语写 authority（内部统一处理 entry 规范化 + version 递增 + 统计）
      if (type === 'air') {
        blockStore.deleteBlockEntry(this.cx, this.cz, code);
      } else {
        blockStore.setBlockEntry(this.cx, this.cz, code, entry);
      }
    } else {
      // 降级路径：无 store 时直接写 this.blockData（测试夹具/无 authority 环境兼容）
      if (type === 'air') {
        this.blockData.delete(code);
      } else {
        this.blockData.set(code, entry);
      }
    }
    // 任何运行时 blockData 变更都必须使进行中的装配快照失效
    this._assemblyEpoch = (this._assemblyEpoch || 0) + 1;

    if (type === 'air') {
      this.deletedBlockTombstones.add(code);
      this.visibleKeys.delete(code);
      // 同步到 AO Worker 副本
      aoBridge.enqueueDelete(`${this.cx},${this.cz}`, code);
    } else {
      this.deletedBlockTombstones.delete(code);
      this.visibleKeys.add(code);
      // 同步到 AO Worker 副本
      aoBridge.enqueueSet(`${this.cx},${this.cz}`, code, entry);
    }

    // 注意：authority version 在 store 路径下已由 setBlockEntry/deleteBlockEntry 内部递增，
    // 降级路径（无 store）无 version 递增需求

    // 更新碰撞体集合
    const props = getBlockProps(type);
    if (props.isSolid) {
      this.solidBlocks.add(code);
    } else {
      this.solidBlocks.delete(code);
    }

    // 同步光源索引：先移除旧记录，再根据新类型决定是否加入
    this.lightSourceCoords.delete(code);
    if (props.isLightSource) {
      this.lightSourceCoords.add(code);
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
    if (this.world?.globalInstancedMeshManager?.removeVisibleBlock?.(key)) {
      return true;
    }

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
   * 将交互期可见方块直接写入全局 InstancedMesh。
   * 仅作为即时视觉层，AO 后续由 AOWorker/consolidation 收敛。
   */
  _upsertGlobalBlockRender(x, y, z, code, type, orientation = 0) {
    const manager = this.world?.globalInstancedMeshManager;
    if (!manager) return false;

    const props = getBlockProps(type);
    const entry = this.blockData.get(code);
    const entryType = entry ? (typeof entry === 'string' ? entry : entry.type) : null;
    if (!props.isRendered || !entryType || type === 'air' || type === 'collider') {
      return false;
    }

    if (!this._globalRenderDummy) {
      this._globalRenderDummy = new THREE.Object3D();
    }

    this._globalRenderDummy.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);
    this._globalRenderDummy.rotation.set(0, getRotationAngle(orientation), 0);
    this._globalRenderDummy.scale.set(1, 1, 1);
    this._globalRenderDummy.updateMatrix();

    const { aoLow, aoHigh } = packAOData(new Uint8Array(24).fill(3));
    const renderData = {
      matrix: new Float32Array(this._globalRenderDummy.matrix.elements),
      aoLow,
      aoHigh,
      orientation
    };
    manager.addVisibleBlock(code, { type, orientation }, `${this.cx},${this.cz}`, renderData);
    this.visibleKeys.add(code);

    // 记录到 render delta（运行期修改路径）
    if (this.world?.bootstrapState?.phase === 'runtime-streaming') {
      this.renderDelta.added.push({ coord: code, entry: { type, orientation }, renderData });
    }

    return true;
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
    this._removeDynamicMesh(x, y, z, code);
    if (this._upsertGlobalBlockRender(x, y, z, code, type, parsed.orientation || 0)) {
      this._markDirtyAO(x, y, z, true);
      return;
    }
    this._removeInstancedMeshBlock(code, x, y, z, type);

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

  _isAOSystemEnabled() {
    const activeMaterials = getMaterials();
    if (activeMaterials && typeof activeMaterials.isAOEnabled === 'function') {
      return activeMaterials.isAOEnabled();
    }
    return activeMaterials?.aoEnabled !== false;
  }

  _clearPendingAOState() {
    if (this.aoRefreshTimer) {
      clearTimeout(this.aoRefreshTimer);
      this.aoRefreshTimer = null;
    }
    this.dirtyAOPositions?.clear?.();
    if (Array.isArray(this._aoOperationQueue)) {
      this._aoOperationQueue.length = 0;
    }
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
    const startedAt = performance.now();
    let markMs = 0;
    let fullSyncMs = 0;

    if (!this._isAOSystemEnabled()) {
      this._clearPendingAOState();
      return;
    }

    if (options.fullRefresh) {
      const markStartedAt = performance.now();
      this._markAllBlocksDirtyAO();
      markMs = performance.now() - markStartedAt;

      // 全量同步 AO Worker 副本（chunk 首次稳定 / consolidation 后）
      // 边界/角点刷新跳过 fullSync：Worker 已有该 chunk 的缓存数据
      const syncStartedAt = performance.now();
      getAOBridge().fullSync(`${this.cx},${this.cz}`, this.blockData);
      fullSyncMs = performance.now() - syncStartedAt;
    }

    if (this.aoRefreshTimer) {
      clearTimeout(this.aoRefreshTimer);
      this.aoRefreshTimer = null;
    }
    this._executeAORefresh();

    recordChunkPerf('chunk.ao-refresh.source-stable', performance.now() - startedAt, {
      chunkKey: `${this.cx},${this.cz}`,
      fullRefresh: options.fullRefresh === true,
      dirtyAO: this.dirtyAOPositions?.size || 0,
      markMs,
      fullSyncMs,
      reason: options.reason || 'unknown'
    });
  }

  /**
   * 判定方块条目是否需要 AO 计算（实心且不透明）
   * @param {*} entry - blockData 中的条目
   * @returns {boolean}
   */
  _isAOApplicableEntry(entry) {
    if (!entry) return false;
    const type = typeof entry === 'string' ? entry : entry.type;
    if (!type) return false;
    const props = getBlockProps(type);
    return props.isSolid && !props.isTransparent;
  }

  /**
   * 从 instanceIndexMap / visibleKeys 收集所有可见实例的编码坐标
   * 优先使用 instanceIndexMap，回退到 visibleKeys
   * @returns {Set<number>}
   */
  _collectVisibleAOInstanceCodes() {
    const codes = new Set();

    const collectFromTypeMap = (typeMap) => {
      if (!typeMap) return;
      const entries = typeMap instanceof Map
        ? typeMap.keys()
        : Object.keys(typeMap);
      for (const codeLike of entries) {
        codes.add(Number(codeLike));
      }
    };

    // instanceIndexMap: { type -> { code -> index } }
    if (this.instanceIndexMap) {
      const typeKeys = this.instanceIndexMap instanceof Map
        ? this.instanceIndexMap.keys()
        : Object.keys(this.instanceIndexMap);
      for (const typeKey of typeKeys) {
        const typeMap = this.instanceIndexMap instanceof Map
          ? this.instanceIndexMap.get(typeKey)
          : this.instanceIndexMap[typeKey];
        if (!typeMap) continue;
        collectFromTypeMap(typeMap);
      }
    }

    if (codes.size === 0 && this.visibleKeys?.size > 0) {
      for (const code of this.visibleKeys) {
        codes.add(Number(code));
      }
    }

    return codes;
  }

  /**
   * 将可渲染的 AO 候选坐标加入脏集
   * @param {number} code - 编码坐标
   * @returns {boolean} 是否成功加入
   */
  _addDirtyAOIfRenderable(code) {
    const entry = this.blockData.get(code);
    if (!this._isAOApplicableEntry(entry)) return false;

    if (this.visibleKeys?.size > 0 && !this.visibleKeys.has(code)) {
      return false;
    }

    this.dirtyAOPositions.add(code);
    return true;
  }

  /**
   * 标记所有实心不透明方块为 AO 脏位置
   * 优先遍历可见实例（instanceIndexMap / visibleKeys），只标记 face culling 后的可见方块
   * 用于 chunk 首次加载后全量刷新（WorldWorker 生成的 AO 可能因缺少邻居数据而不准确）
   */
  _markAllBlocksDirtyAO() {
    const visibleCodes = this._collectVisibleAOInstanceCodes();

    if (visibleCodes.size > 0) {
      for (const code of visibleCodes) {
        const entry = this.blockData.get(code);
        if (this._isAOApplicableEntry(entry)) {
          this.dirtyAOPositions.add(code);
        }
      }
      return;
    }

    // 兼容回退：没有可见索引时保留旧行为，优先保证正确性
    for (const [code, entry] of this.blockData) {
      if (this._isAOApplicableEntry(entry)) {
        this.dirtyAOPositions.add(code);
      }
    }
  }

  /**
   * 标记与指定邻居 chunk 相邻的边界方块为 AO 脏位
   * 根据邻居方向直接生成边界影响带，不再扫描整个 blockDataArray
   * @param {number} neighborCx - 邻居 chunk 的 cx
   * @param {number} neighborCz - 邻居 chunk 的 cz
   */
  _markBoundaryDirtyAO(neighborCx, neighborCz) {
    const startedAt = performance.now();
    const dx = neighborCx - this.cx;
    const dz = neighborCz - this.cz;

    const minX = this.cx * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE - 1;
    const minZ = this.cz * CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE - 1;
    const minY = this.worldY;
    const maxY = this.worldY + CHUNK_SIZE - 1;

    const xValues = [];
    const zValues = [];

    // 邻居在 +X 方向 → 刷新本 chunk 的 maxX / maxX-1 列（东侧边界）
    if (dx === 1) { xValues.push(maxX, maxX - 1); }
    // 邻居在 -X 方向 → 刷新本 chunk 的 minX / minX+1 列（西侧边界）
    else if (dx === -1) { xValues.push(minX, minX + 1); }

    // 邻居在 +Z 方向 → 刷新本 chunk 的 maxZ / maxZ-1 列（南侧边界）
    if (dz === 1) { zValues.push(maxZ, maxZ - 1); }
    // 邻居在 -Z 方向 → 刷新本 chunk 的 minZ / minZ+1 列（北侧边界）
    else if (dz === -1) { zValues.push(minZ, minZ + 1); }

    let marked = 0;

    // 按 X 边界带生成候选
    for (const x of xValues) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this._addDirtyAOIfRenderable(Chunk.encodeCoord(x, y, z))) marked++;
        }
      }
    }

    // 按 Z 边界带生成候选
    for (const z of zValues) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (this._addDirtyAOIfRenderable(Chunk.encodeCoord(x, y, z))) marked++;
        }
      }
    }

    // Y>15 安全网：visibleKeys 中可能存在 worldY+CHUNK_SIZE 之外的高层可见方块
    if (this.visibleKeys?.size > 0) {
      for (const code of this.visibleKeys) {
        const { x, y, z } = Chunk.decodeCoord(code);
        if (y <= maxY) continue; // 已在上面覆盖
        const nearX = dx === 1 ? x >= maxX - 1 : dx === -1 ? x <= minX + 1 : false;
        const nearZ = dz === 1 ? z >= maxZ - 1 : dz === -1 ? z <= minZ + 1 : false;
        if ((nearX || nearZ) && this._addDirtyAOIfRenderable(code)) marked++;
      }
    }

    recordChunkPerf('chunk.ao-refresh.mark-boundary', performance.now() - startedAt, {
      chunkKey: `${this.cx},${this.cz}`,
      neighborKey: `${neighborCx},${neighborCz}`,
      marked
    });
  }

  /**
   * 标记对角邻居方向的小范围角点影响带为 AO 脏位
   * AO 计算依赖 3x3x3 邻域，对角 chunk 后到达时角点也需要补刷新
   * @param {number} neighborCx - 对角邻居 chunk 的 cx
   * @param {number} neighborCz - 对角邻居 chunk 的 cz
   */
  _markCornerDirtyAO(neighborCx, neighborCz) {
    const startedAt = performance.now();
    const dx = neighborCx - this.cx;
    const dz = neighborCz - this.cz;

    const minX = this.cx * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE - 1;
    const minZ = this.cz * CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE - 1;
    const minY = this.worldY;
    const maxY = this.worldY + CHUNK_SIZE - 1;

    // 确定角点 X/Z 范围（2x2 带）
    const xStart = dx === 1 ? maxX - 1 : minX;
    const xEnd = dx === 1 ? maxX : minX + 1;
    const zStart = dz === 1 ? maxZ - 1 : minZ;
    const zEnd = dz === 1 ? maxZ : minZ + 1;

    let marked = 0;

    for (let x = xStart; x <= xEnd; x++) {
      for (let z = zStart; z <= zEnd; z++) {
        for (let y = minY; y <= maxY; y++) {
          if (this._addDirtyAOIfRenderable(Chunk.encodeCoord(x, y, z))) marked++;
        }
      }
    }

    recordChunkPerf('chunk.ao-refresh.mark-corner', performance.now() - startedAt, {
      chunkKey: `${this.cx},${this.cz}`,
      neighborKey: `${neighborCx},${neighborCz}`,
      marked
    });
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
    if (!this._isAOSystemEnabled()) {
      this._clearPendingAOState();
      return;
    }

    // 先处理操作队列：基于最新 blockData 重新计算所有操作的邻居脏位
    this._flushAOOperationQueue();

    if (this.dirtyAOPositions.size === 0) return;
    if (!this.isReady || this.isConsolidating) {
      return;
    }

    // 快照当前脏位置（后续新增的不会被本次请求覆盖）
    const sentCodes = new Set(this.dirtyAOPositions);

    // 收集脏位置
    const collectStartedAt = performance.now();
    const positions = [...sentCodes].map(code => Chunk.decodeCoord(code));
    const collectPositionsMs = performance.now() - collectStartedAt;

    // flush 所有积压的 delta，确保 Worker 副本是最新的
    // aoBridge 是全局单例，一次 flush 即发送所有 chunk 的待处理变更
    getAOBridge().flush();

    // 收集邻居 chunk 标识（Worker 侧用 cacheKey 合并缓存数据）
    // 不再传全量 blockData，Worker 从缓存副本读取
    const neighborChunks = [];
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dx, dz] of dirs) {
      const nc = this.world?.chunks?.get(`${this.cx + dx},${this.cz + dz}`);
      if (nc && nc.isReady) {
        neighborChunks.push({
          cx: nc.cx,
          cz: nc.cz
        });
      }
    }

    // 生成请求 ID
    const requestId = `${this.cx},${this.cz}-${Date.now()}`;
    const aoSourceVersion = this._aoSourceVersion;
    const assemblyEpoch = this._assemblyEpoch || 0;

    // 动态导入 Worker 和回调
    import('./ChunkConsolidation.js').then(({ aoWorker, aoCallbacks }) => {
      // 注册回调
      aoCallbacks.set(requestId, (data) => {
        if (this.disposed || !this.isReady || this.isConsolidating) return;
        if (this._aoSourceVersion !== aoSourceVersion) return;
        if (this._assemblyEpoch !== assemblyEpoch) return;
        this._applyAOResults(data.results, sentCodes);
      });

      // 发送给 Worker — 不再传全量 blockData
      recordChunkPerf('chunk.ao-refresh.request', collectPositionsMs, {
        chunkKey: `${this.cx},${this.cz}`,
        positions: positions.length,
        collectPositionsMs
      });

      aoWorker.postMessage({
        requestId,
        chunkKey: `${this.cx},${this.cz}`,
        positions,
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
    const applyStartedAt = performance.now();

    if (!this._isAOSystemEnabled()) {
      if (sentKeys) {
        for (const key of sentKeys) {
          this.dirtyAOPositions.delete(key);
        }
      }
      return;
    }

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

    if (this.world?.globalInstancedMeshManager) {
      for (const r of results) {
        const code = Chunk.encodeCoord(r.x, r.y, r.z);
        this.world.globalInstancedMeshManager.updateAO(code, r.aoLow, r.aoHigh);
      }
    }

    // 只清除本次已发送的脏标记，保留后续新增的
    if (sentKeys) {
      for (const key of sentKeys) {
        this.dirtyAOPositions.delete(key);
      }
    } else {
      this.dirtyAOPositions.clear();
    }

    recordChunkPerf('chunk.ao-refresh.apply-results', performance.now() - applyStartedAt, {
      chunkKey: `${this.cx},${this.cz}`,
      results: results?.length || 0,
      sentKeys: sentKeys?.size || 0
    });
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

      // 从 blockData、blockDataArray 和 solidBlocks 中清除对应坐标，确保 resolveBlockOwner 不会命中地形方块
      const code = Chunk.encodeCoord(x, y, z);
      this.blockData.delete(code);
      this.solidBlocks.delete(code);

      const lx = x & 15;
      const ly = y - this.worldY;
      const lz = z & 15;
      if (ly >= 0 && ly < 16) {
        const blockIndex = (ly << 8) | (lz << 4) | lx;
        const oldBlockId = this.blockDataArray[blockIndex];
        if (oldBlockId !== 0) {
          this.blockDataArray[blockIndex] = 0;
          this.solidBlockIds.delete(oldBlockId);
        }
      }
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
   * 合并结构中心列表，按位置去重
   * @param {Array} incoming - 新的结构中心列表
   */
  _mergeStructureCenters(incoming) {
    if (!incoming || incoming.length === 0) return;
    if (!this.structureCenters) this.structureCenters = [];
    if (this.structureCenters.length === 0) {
      this.structureCenters = incoming;
      return;
    }

    const seen = new Set(this.structureCenters.map(c => `${c.type},${c.x},${c.y},${c.z}`));
    for (const c of incoming) {
      const key = `${c.type},${c.x},${c.y},${c.z}`;
      if (!seen.has(key)) {
        this.structureCenters.push(c);
        seen.add(key);
      }
    }
  }

  /**
   * 接收 Worker 生成结果，但暂不立即在主线程完成全部装配
   * @param {object} payload - Worker 回包数据
   */
  acceptWorkerResult(payload = {}) {
    if (this.disposed) return;
    const t0 = globalThis.performance?.now?.() ?? Date.now();
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
    if (!this.lightSourceCoords) this.lightSourceCoords = new Set();
    this.visibleKeys.clear();
    this.solidBlocks.clear();
    this.lightSourceCoords.clear();

    if (visibleKeys) {
      for (const key of visibleKeys) {
        this.visibleKeys.add(coordKeyToCode(key));
      }
    }
    if (solidBlocks) {
      for (const key of solidBlocks) {
        this.solidBlocks.add(coordKeyToCode(key));
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
    recordChunkPerf('chunk.accept-worker-result', (globalThis.performance?.now?.() ?? Date.now()) - t0, {
      chunkKey: `${this.cx},${this.cz}`,
      visibleKeys: visibleKeys?.length || 0,
      solidBlocks: solidBlocks?.length || 0,
      scatteredBlocks: scatteredBlocks?.length || 0,
      structureCenters: structureCenters?.length || 0,
      modGunMan: modGunMan?.length || 0,
      rovers: rovers?.length || 0
    });
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

    if (this.loadState === 'record-ready' || this.loadState === 'loading-from-record') {
      this._buildMeshFromExistingBlockData();
      this.loadState = 'terrain-built';
      this.isReady = true;
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
          turrets: existingData.entities.turrets || snapshot.entities?.turrets || [],
          minecarts: existingData.entities.minecarts || snapshot.entities?.minecarts || []
        };
      }
      // 确保 snapshot.blocks 使用数字编码格式（与 Chunk.blockData 一致）
      // 兼容旧存档 / 旧 Worker 回包中的字符串 key 格式
      if (snapshot.blocks) {
        snapshot.blocks = normalizeBlocksToNumberKeys(snapshot.blocks);
      }
      if (persistence?.cache?.set) {
        persistence.cache.set(chunkKey, snapshot);
      }
      // 纯加载路径不触发持久化刷写（数据刚从 WorldStore 加载）
      if (!this._isPureLoadPath) {
        this._pendingPersistenceFlush = true;
      }

      // 从合并后的 snapshot 中提取运行时实体数据，供 finalize 阶段恢复
      const entities = snapshot.entities || {};
      if (
        (Array.isArray(entities.zombieNests) && entities.zombieNests.length > 0) ||
        (Array.isArray(entities.turrets) && entities.turrets.length > 0) ||
        (Array.isArray(entities.minecarts) && entities.minecarts.length > 0)
      ) {
        this.pendingRuntimeEntities = {
          zombieNests: entities.zombieNests || [],
          turrets: entities.turrets || [],
          minecarts: entities.minecarts || []
        };
      }
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

    // 预检查：非纯流式 chunk 且有脏块时，触发 consolidation 后等待
    if (this.loadState !== 'waiting-consolidation' && this.dirtyBlocks > 0 && !this.isPureRuntimeStreamingChunk()) {
      this.loadState = 'waiting-consolidation';
      this.consolidate();
      return false;
    }

    // 纯流式 chunk：跳过 consolidation，清理加载期脏块计数和定时器
    if (this.isPureRuntimeStreamingChunk()) {
      this.dirtyBlocks = 0;
      if (this.consolidationTimer) {
        clearTimeout(this.consolidationTimer);
        this.consolidationTimer = null;
      }
    }

    // finalize 仍在主线程装配路径内完成，不把首屏关键工作后移到 idle 阶段
    this.hasDeferredFinalizeWork = false;
    this._needsDeferredPersistenceFlush = false;
    this._needsDeferredRuntimeEntityRestore = false;
    this._needsDeferredLightRegistration = false;

    // 预检查完成，通知调度器可以继续后续阶段
    return true;
  }

  /**
   * finalize 非延迟工作阶段（主线程切片执行）
   * 处理持久化、实体恢复、光源注册，完成后标记 chunk 为 ready
   */
  async finalizeNonDeferredPhase() {
    if (this.loadState === 'finalized' || this.disposed) return true;

    // 运行时实体恢复 — 延迟到 runDeferredFinalizePhase 中异步执行
    // 避免在 chunk 加载关键路径上同步创建大量 mesh/纹理导致卡顿
    const zombieNests = this.pendingRuntimeEntities?.zombieNests;
    const turrets = this.pendingRuntimeEntities?.turrets;
    const minecarts = this.pendingRuntimeEntities?.minecarts;
    const hasRuntimeEntities = (
      (Array.isArray(zombieNests) && zombieNests.length > 0) ||
      (Array.isArray(turrets) && turrets.length > 0) ||
      (Array.isArray(minecarts) && minecarts.length > 0)
    );

    if (hasRuntimeEntities) {
      this._needsDeferredRuntimeEntityRestore = true;
      this.hasDeferredFinalizeWork = true;
    }

    // runtime-streaming 下将光源注册后移，避免 finalize 热路径产生大峰值。
    if (this.world?.bootstrapState?.phase === 'runtime-streaming') {
      if (this.lightSourceCoords.size > 0) {
        this._needsDeferredLightRegistration = true;
        this.hasDeferredFinalizeWork = true;
      }
      this._needsDeferredAOStabilization = true;
      this.hasDeferredFinalizeWork = true;
    } else {
      this._registerLightSources();
    }

    // 完成
    this.isReady = true;
    this.loadState = 'finalized';
    this.pendingTerrainData = null;
    this.pendingSpecialEntityData = null;
    this.pendingRuntimeEntities = null;
    this.pendingSnapshot = null;
    this.world?.onChunkFinalized?.(this, {
      deferAORefresh: this._needsDeferredAOStabilization === true
    });
    return true;
  }

  runDeferredFinalizePhase() {
    if (this.disposed || !this.hasDeferredFinalizeWork) return true;

    let aoRefreshTriggeredThisPass = false;

    // 分帧恢复运行时实体：每帧最多恢复 MAX_ENTITIES_PER_FRAME 个
    if (this._needsDeferredRuntimeEntityRestore) {
      const MAX_ENTITIES_PER_FRAME = 3;

      if (!this._entityRestoreProgress) {
        this._entityRestoreProgress = {
          nestIndex: 0, nestDone: false,
          turretIndex: 0, turretDone: false,
          minecartIndex: 0, minecartDone: false
        };
      }

      const p = this._entityRestoreProgress;
      let restoredThisFrame = 0;

      if (!p.nestDone && this.world?.zombieNestManager?.restoreNestsForChunk) {
        p.nestDone = !this.world.zombieNestManager.restoreNestsForChunk(this.cx, this.cz, p.nestIndex, MAX_ENTITIES_PER_FRAME - restoredThisFrame);
        restoredThisFrame += MAX_ENTITIES_PER_FRAME;
      }

      if (!p.turretDone && this.world?.turretManager?.restoreTurretsForChunk && restoredThisFrame < MAX_ENTITIES_PER_FRAME) {
        p.turretDone = !this.world.turretManager.restoreTurretsForChunk(this.cx, this.cz, p.turretIndex, MAX_ENTITIES_PER_FRAME - restoredThisFrame);
        restoredThisFrame += MAX_ENTITIES_PER_FRAME;
      }

      if (!p.minecartDone && this.world?.minecartManager?.restoreMinecartsForChunk && restoredThisFrame < MAX_ENTITIES_PER_FRAME) {
        p.minecartDone = !this.world.minecartManager.restoreMinecartsForChunk(this.cx, this.cz, p.minecartIndex, MAX_ENTITIES_PER_FRAME - restoredThisFrame);
      }

      // 更新索引（简化处理：每次调用递增，即使有跳过也会前进）
      p.nestIndex += MAX_ENTITIES_PER_FRAME;
      p.turretIndex += MAX_ENTITIES_PER_FRAME;
      p.minecartIndex += MAX_ENTITIES_PER_FRAME;

      if (p.nestDone && p.turretDone && p.minecartDone) {
        this._needsDeferredRuntimeEntityRestore = false;
        this.pendingRuntimeEntities = null;
        this._entityRestoreProgress = null;
      }
    } else if (this.pendingRuntimeEntities) {
      this.pendingRuntimeEntities = null;
    }

    if (this._needsDeferredLightRegistration) {
      this._registerLightSources();
      this._needsDeferredLightRegistration = false;
    }

    if (this._needsDeferredAOStabilization) {
      this.world?.onChunkAOSourceStable?.(this, {
        fullRefresh: true,
        markNeighborBoundaries: true,
        reason: 'deferred-finalize-ao-stable'
      });
      aoRefreshTriggeredThisPass = true;
      this._needsDeferredAOStabilization = false;
    }

    this.hasDeferredFinalizeWork = (
      this._needsDeferredRuntimeEntityRestore ||
      this._needsDeferredLightRegistration ||
      this._needsDeferredAOStabilization
    );

    // 所有延迟工作完成后，触发 AO 刷新（避免同一轮重复触发）
    if (!this.hasDeferredFinalizeWork && !aoRefreshTriggeredThisPass) {
      this.world?.onChunkAOSourceStable?.(this, {
        fullRefresh: true,
        markNeighborBoundaries: true,
        reason: 'deferred-finalize-done'
      });
    }

    return !this.hasDeferredFinalizeWork;
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 注册该 Chunk 中的所有光源方块
   * 直接遍历 lightSourceCoords 索引，无需扫描整个 blockData
   */
  _registerLightSources() {
    if (!this.world?.lightSourceManager) return;

    for (const code of this.lightSourceCoords) {
      const entry = this.blockData.get(code);
      if (!entry) continue;
      const parsed = parseBlockEntry(entry);
      if (!parsed.type || parsed.type === 'air') continue;
      const { x, y, z } = Chunk.decodeCoord(code);
      this.world.lightSourceManager.addLight(x, y, z, parsed.type);
    }
  }

  /**
   * 注销该 Chunk 中的所有光源方块
   * 清除该 Chunk 内所有光源的 PointLight
   */
  _unregisterLightSources() {
    if (!this.world.lightSourceManager) return;

    for (const code of this.lightSourceCoords) {
      const { x, y, z } = Chunk.decodeCoord(code);
      this.world.lightSourceManager.removeLight(x, y, z);
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

    if (this.world?.bootstrapState?.phase === 'runtime-streaming' && this.world?.worldRuntime) {
      this.world.worldRuntime.recordBlockMutation(this.cx, this.cz, x, y, z, entry);
    }

    // 4. 更新数据状态
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

    // 9. 写入即时渲染。优先走全局 InstancedMesh，保留旧动态 Mesh 作为降级路径。
    const renderedGlobally = this.visibleKeys.has(code) &&
      this._upsertGlobalBlockRender(x, y, z, code, type, blockOrientation);
    if (renderedGlobally) {
      this.dirtyBlocks++;
      this.scheduleConsolidation();
    } else {
      const mesh = this._createDynamicBlockMesh(x, y, z, code, type, blockOrientation, { applyAO: false });
      if (mesh) {
        this.group.add(mesh);
        this.dynamicMeshes.set(code, mesh);
        this.dirtyBlocks++;
        this.scheduleConsolidation();
        mesh.updateMatrix();
        mesh.updateMatrixWorld();
      }
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

      if (this.world?.bootstrapState?.phase === 'runtime-streaming' && this.world?.worldRuntime) {
        this.world.worldRuntime.recordBlockMutation(this.cx, this.cz, x, y, z, entry);
      }

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
    const owner = this.world.resolveBlockOwner(x, y, z, { allowScan: false });
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
    const chunkKey = `${this.cx},${this.cz}`;
    const aoDeltas = [];
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
        this.world?.scatterManager?.invalidatePendingBlock?.(px, py, pz);
        this.deletedBlockTombstones.add(code);
        this.blockData.delete(code);
        this.visibleKeys.delete(code);
        this.solidBlocks.delete(code);
        this.lightSourceCoords.delete(code);
        if (this.world?.bootstrapState?.phase === 'runtime-streaming' && this.world?.worldRuntime) {
          this.world.worldRuntime.recordBlockMutation(this.cx, this.cz, px, py, pz, 'air');
        }

        // 记录 AO Worker 副本同步 delta
        aoDeltas.push({ chunkKey, code, op: 'delete', entry: null });

        // 只收集正交邻居（6方向），对角线邻居不共享面，不需要即时 reveal/refresh
        Chunk.getAOImpactedNeighborKeys(px, py, pz).forEach(({ code: neighborCode, isOrthogonal }) => {
          if (isOrthogonal) {
            neighborsToUpdate.add(neighborCode);
          }
        });
      }
    });

    // 批量同步 AO Worker 副本
    if (aoDeltas.length > 0) {
      aoBridge.enqueueBatch(aoDeltas);
    }

    // 2. 移除当前待删除方块的渲染网格
    if (this.world?.globalInstancedMeshManager) {
      positions.forEach(p => {
        const code = Chunk.encodeCoord(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        this.world.globalInstancedMeshManager.removeVisibleBlock(code);

        // 记录到 render delta
        if (this.world?.bootstrapState?.phase === 'runtime-streaming') {
          this.renderDelta.removed.push(code);
        }
      });
    }

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
    if (this.world?.globalInstancedMeshManager) {
      positions.forEach(p => {
        const code = Chunk.encodeCoord(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        this.world.globalInstancedMeshManager.removeVisibleBlock(code);
      });
    }

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
   * @param {Array} structureCenters - 结构中心列表（供跨 chunk 结构判断）
   */
  acceptScatteredBlocks(scatteredBlocks, visibleBlockKeys, structureCenters, workerMeshData = null) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const minX = this.cx * CHUNK_SIZE;
    const minZ = this.cz * CHUNK_SIZE;
    const visibleBlocks = Array.isArray(visibleBlockKeys) ? visibleBlockKeys : null;
    const visibleKeySet = visibleBlocks
      ? new Set(visibleBlocks.map((block) => Chunk.encodeCoord(block.x, block.y, block.z)))
      : visibleBlockKeys;

    // 确保数据结构已初始化
    if (!this.visibleKeys) this.visibleKeys = new Set();
    if (!this.solidBlocks) this.solidBlocks = new Set();
    if (!this.lightSourceCoords) this.lightSourceCoords = new Set();

    // 收集 patches，通过 store mutation primitive 批量写入 authority
    const patches = new Map();
    for (const block of scatteredBlocks) {
      const localX = block.x - minX;
      const localZ = block.z - minZ;
      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
        continue;
      }

      const code = Chunk.encodeCoord(block.x, block.y, block.z);
      if (this.deletedBlockTombstones.has(code)) continue;

      // 若 authority 中已存在该方块（如 scatter 先写了未加载目标 chunk），
      // 跳过 store mutation 防止重复 version bump 与 stats 放大
      if (this.blockData.has(code)) continue;

      const entry = block.orientation !== 0 ? { type: block.type, orientation: block.orientation } : block.type;
      patches.set(code, entry);
    }

    // 批量写入 authority（优先通过 store mutation primitive）
    const blockStore = this.world?.worldBlockDataStore;
    if (blockStore) {
      // 延迟 attach：确保 this.blockData 指向 store 的共享 slice
      if (!blockStore.isAttached(this.cx, this.cz)) {
        this.blockData = blockStore.ensureChunkSlice(this.cx, this.cz);
        blockStore.markAttached(this.cx, this.cz);
        this._assemblyEpoch = (this._assemblyEpoch || 0) + 1;
      }
      if (patches.size > 0) {
        blockStore.applyChunkPatch(this.cx, this.cz, patches);
      }
    } else if (patches.size > 0) {
      // 降级路径：无 store 时直接写 this.blockData
      for (const [code, entry] of patches) {
        this.blockData.set(code, entry);
      }
    }

    // 从 authority 重建派生索引（_initArrayStorageFromBlockData 负责 blockDataArray/blockPalette/solidBlockIds）
    this._initArrayStorageFromBlockData();

    // 重建 solidBlocks 与 lightSourceCoords（_initArrayStorageFromBlockData 不处理这两个 Set）
    this.solidBlocks.clear();
    this.lightSourceCoords.clear();
    for (const [code, entry] of this.blockData) {
      const type = typeof entry === 'string' ? entry : (entry?.type || '');
      if (type === 'air') continue;
      const props = getBlockProps(type);
      if (props.isSolid) this.solidBlocks.add(code);
      if (props.isLightSource) this.lightSourceCoords.add(code);
    }
    const t1 = globalThis.performance?.now?.() ?? Date.now();

    // 构建可见方块编码集合，供 mesh 构建时过滤隐藏方块
    const encodedVisibleKeys = new Set();
    if (visibleBlocks) {
      for (const block of visibleBlocks) {
        const code = Chunk.encodeCoord(block.x, block.y, block.z);
        if (this.deletedBlockTombstones.has(code)) continue;
        encodedVisibleKeys.add(code);
        this.visibleKeys.add(code);
      }
    } else if (visibleKeySet) {
      for (const key of visibleKeySet) {
        const code = coordKeyToCode(key);
        if (this.deletedBlockTombstones.has(code)) continue;
        encodedVisibleKeys.add(code);
        this.visibleKeys.add(code);
      }
    }
    const t2 = globalThis.performance?.now?.() ?? Date.now();

    // 合并 structureCenters（buffer 中可能已包含来自相邻 chunk 的结构中心）
    if (structureCenters?.length > 0) {
      this._mergeStructureCenters(structureCenters);
    }
    const t3 = globalThis.performance?.now?.() ?? Date.now();

    // _initArrayStorageFromBlockData 已在 authority patch 写入后调用，此处不需要重复

    // 优先消费 Worker 预构建的 meshData，主线程仅保留回退转换路径。
    const meshData = Array.isArray(workerMeshData)
      ? workerMeshData
      : this._convertScatteredBlocksToMeshData(visibleBlocks || scatteredBlocks, encodedVisibleKeys, structureCenters);
    const t5 = globalThis.performance?.now?.() ?? Date.now();
    this.buildMeshes(meshData);
    const t6 = globalThis.performance?.now?.() ?? Date.now();

    // 标记 chunk 为已加载
    this.loadState = 'terrain-built';
    this.isReady = true;

    // 通知 World 继续后续装配流程（entities → finalize）
    this.world?.onChunkWorkerReady?.(this);
    const t7 = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.accept-scattered-blocks', t7 - t0, {
      chunkKey: `${this.cx},${this.cz}`,
      inputBlocks: scatteredBlocks?.length || 0,
      visibleBlockKeys: visibleBlocks?.length || visibleKeySet?.size || 0,
      blockDataSize: this.blockData.size,
      meshGroups: meshData?.length || 0,
      writeBlockDataMs: t1 - t0,
      // t1 包含了 authority patch 写入 + _initArrayStorageFromBlockData
      visibleKeysMs: t2 - t1,
      mergeStructureCentersMs: t3 - t2,
      convertMeshDataMs: t5 - t3,
      buildMeshesMs: t6 - t5,
      notifyWorldMs: t7 - t6
    });
  }

  /**
   * 增量追加 BlockScatterManager 分发来的方块数据
   * 用于后加载 chunk 的溢出方块追加到已渲染的 chunk 中
   * @param {Array} scatteredBlocks - 方块列表（含溢出）
   * @param {Set} visibleBlockKeys - 面剔除可见的方块 key 集合
   * @param {Array} structureCenters - 结构中心列表（供跨 chunk 结构判断）
   */
  appendScatteredBlocks(scatteredBlocks, visibleBlockKeys, structureCenters, options = {}) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const minX = this.cx * CHUNK_SIZE;
    const minZ = this.cz * CHUNK_SIZE;
    const visibleBlocks = Array.isArray(visibleBlockKeys) ? visibleBlockKeys : null;
    const visibleKeySet = visibleBlocks
      ? new Set(visibleBlocks.map((block) => Chunk.encodeCoord(block.x, block.y, block.z)))
      : visibleBlockKeys;

    // 合并 structureCenters（增量追加场景可能收到来自不同 chunk 的结构中心）
    if (structureCenters?.length > 0) {
      this._mergeStructureCenters(structureCenters);
    }

    // 收集 patches，通过 store mutation primitive 批量写入 authority
    const patches = new Map();
    let appendedCount = 0;

    for (const block of scatteredBlocks) {
      const localX = block.x - minX;
      const localZ = block.z - minZ;
      if (localX < 0 || localX >= CHUNK_SIZE || localZ < 0 || localZ >= CHUNK_SIZE) {
        continue;
      }

      const code = Chunk.encodeCoord(block.x, block.y, block.z);
      if (this.deletedBlockTombstones.has(code)) continue;

      // 跳过已存在的方块，尊重玩家修改或已有数据
      if (this.blockData.has(code)) continue;

      const entry = block.orientation !== 0 ? { type: block.type, orientation: block.orientation } : block.type;
      patches.set(code, entry);
      appendedCount++;
    }

    // 批量写入 authority（优先通过 store mutation primitive）
    const blockStore = this.world?.worldBlockDataStore;
    if (blockStore) {
      // 延迟 attach：确保 this.blockData 指向 store 的共享 slice
      if (!blockStore.isAttached(this.cx, this.cz)) {
        this.blockData = blockStore.ensureChunkSlice(this.cx, this.cz);
        blockStore.markAttached(this.cx, this.cz);
        this._assemblyEpoch = (this._assemblyEpoch || 0) + 1;
      }
      if (patches.size > 0) {
        blockStore.applyChunkPatch(this.cx, this.cz, patches);
      }
    } else if (patches.size > 0) {
      // 降级路径：无 store 时直接写 this.blockData
      for (const [code, entry] of patches) {
        this.blockData.set(code, entry);
      }
    }

    // 从 patches 增量更新派生索引 solidBlocks 与 lightSourceCoords
    if (patches.size > 0) {
      for (const [code] of patches) {
        const entry = this.blockData.get(code);
        const type = typeof entry === 'string' ? entry : (entry?.type || '');
        if (type === 'air') continue;
        const props = getBlockProps(type);
        if (props.isSolid) this.solidBlocks.add(code);
        if (props.isLightSource) this.lightSourceCoords.add(code);
      }
    }

    // 从 visibleBlockKeys 追加可见标记
    if (visibleBlocks) {
      for (const block of visibleBlocks) {
        const code = Chunk.encodeCoord(block.x, block.y, block.z);
        if (this.deletedBlockTombstones.has(code)) continue;
        this.visibleKeys.add(code);
      }
    } else if (visibleKeySet) {
      for (const key of visibleKeySet) {
        const code = coordKeyToCode(key);
        if (this.deletedBlockTombstones.has(code)) continue;
        this.visibleKeys.add(code);
      }
    }

    if (appendedCount === 0) return 0;
    const t1 = globalThis.performance?.now?.() ?? Date.now();

    // 同步数组存储；跨 chunk 流式补片不立即抢占 WorldWorker 合并队列
    this.dirtyBlocks += appendedCount;
    this._initArrayStorageFromBlockData();
    const t2 = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('chunk.append-scattered-blocks', t2 - t0, {
      chunkKey: `${this.cx},${this.cz}`,
      inputBlocks: scatteredBlocks?.length || 0,
      appendedCount,
      visibleBlockKeys: visibleBlocks?.length || visibleKeySet?.size || 0,
      deferConsolidation: options.deferConsolidation === true,
      writeBlockDataMs: t1 - t0,
      initArrayStorageMs: t2 - t1,
      dirtyBlocks: this.dirtyBlocks
    });
    if (options.deferConsolidation) {
      this.hasDeferredFinalizeWork = true;
      // 不再在这里 queue，改由 World 层 idle 任务统一触发
      return appendedCount;
    }
    this.scheduleConsolidation();
    return appendedCount;
  }

  /**
   * runtime idle 阶段补刷跨 chunk 方块。
   * 只写入数据并排入 deferred consolidation，不立即抢占 WorldWorker 合并队列。
   */
  appendDeferredCrossChunkPatch(scatteredBlocks, visibleBlockKeys, structureCenters) {
    return this.appendScatteredBlocks(scatteredBlocks, visibleBlockKeys, structureCenters, {
      deferConsolidation: true
    });
  }
}

// 扩展Chunk类功能
extendWithConsolidation(Chunk);
extendWithGenerator(Chunk);
extendWithPersistence(Chunk);
extendWithRenderUtils(Chunk);
