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
import { createOcclusionChecker, computeBlockAOPacked } from '../utils/AOUtils.js';
import { createChunkNeighborSampler } from './ChunkNeighborUtils.js';
import { extendChunk as extendWithConsolidation, CHUNK_SIZE, geomMap } from './ChunkConsolidation.js';
import { extendChunk as extendWithGenerator } from './ChunkGenerator.js';
import { extendChunk as extendWithPersistence } from './ChunkPersistence.js';
import { extendChunk as extendWithRenderUtils } from './ChunkRenderUtils.js';
import { FACE_MASK_ALL } from '../constants/GameConfig.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;
const getFaceCullingSystem = () => globalThis._faceCullingSystem || faceCullingSystem;
const getMaterials = () => globalThis._materials || materials;

// 获取方块属性函数 - 优先使用测试环境的模拟
const getBlockProps = createBlockPropsResolver(getBlockProperties);

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
    // 基础属性
    this.cx = cx;
    this.cz = cz;
    this.world = world;
    this.group = new THREE.Group();
    this.isReady = false;

    // 数据存储
    this.blockData = {};
    this.solidBlocks = new Set();
    this.visibleKeys = new Set();
    this.instanceIndexMap = new Map();

    // 实体与结构数据
    this.entities = { realisticTrees: [], modGunMan: [], rovers: [] };
    this.structureCenters = [];
    this._tempOriginalSolidBlocks = null;

    // 后台合并系统
    this.dirtyBlocks = 0;
    this.consolidationTimer = null;
    this.isConsolidating = false;
    this.deferConsolidation = false;
    this.dynamicMeshes = new Map();

    // 批量 Face Culling 更新系统
    this.pendingBatchFaceCullingUpdates = new Set();
    this.batchFaceCullingTimer = null;

    // 持久化
    this.saveTimeout = null;

    // 启动区块生成
    this.gen();
  }

  // ============================================================
  // 私有辅助方法
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
        this._removeEntityWithCollisionBlocks(child);
        return true;
      }
    }
    return false;
  }

  /**
   * 获取指定 key 对应方块类型（兼容字符串/对象条目）
   * @param {string} key - 方块键
   * @returns {string|null} 方块类型
   */
  _getBlockTypeByKey(key) {
    const entry = this.blockData[key];
    if (!entry) return null;
    return parseBlockEntry(entry).type;
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
    const mesh = this._createDynamicBlockMesh(x, y, z, key, type, parsed.orientation || 0);
    if (!mesh) return;

    this.group.add(mesh);
    this.dynamicMeshes.set(key, mesh);
    mesh.updateMatrix();
    mesh.updateMatrixWorld();
    this.visibleKeys.add(key);
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
            this._refreshBlockRenderMesh(nx, ny, nz, nKey, this.blockData[nKey]);
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
      material = Array.isArray(material)
        ? material.map(m => m.clone())
        : material.clone();
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);
    mesh.rotation.set(0, getRotationAngle(orientation), 0);
    mesh.userData = { type, orientation };
    mesh.frustumCulled = false;

    // 设置 AO 属性
    if (props.isSolid && !props.isTransparent) {
      mesh.geometry = geometry.clone();
      const count = mesh.geometry.attributes.position.count;

      // 计算 AO（同步计算，确保 FrozenMountain 山体内 AO 正确显示）
      const isOccluding = createOcclusionChecker(
        { chunk: this, chunks: this.world.chunks },
        CHUNK_SIZE,
        getBlockProps
      );

      // 计算 AO 数据（打包格式）
      const { aoLow, aoHigh } = computeBlockAOPacked(x, y, z, isOccluding);

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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    return mesh;
  }

  // ============================================================
  // 公共 API
  // ============================================================

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
    this._updateBlockState(key, type, entry);
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
      this._updateBlockState(key, nextType, entry);
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

    if (!targetChunk.visibleKeys.has(blockKey)) {
      targetChunk.addBlockDynamic(x, y, z, entry);
    } else {
      // 如果原本可见，跨区块暴露时也要立即刷新网格补面
      targetChunk._refreshBlockRenderMesh(x, y, z, blockKey, entry);
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

        // 收集周围 6 个方向的邻居坐标
        const offsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
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
        if (this.blockData[nKey]) {
          // 如果邻居存在但不可见（被剔除了），则"唤醒"它
          if (!this.visibleKeys.has(nKey)) {
            this.addBlockDynamic(nx, ny, nz, this.blockData[nKey]);
          } else {
            // 如果本来就可见，也要重新触发 Face Culling 更新以显示新的暴露面
            if (isBatch) {
              // 批量模式：收集到待处理队列，不立即更新
              this.pendingBatchFaceCullingUpdates.add(nKey);
              // 启动防抖定时器，在最后一批删除完成后统一处理
              this._scheduleBatchFaceCullingUpdate();
            } else {
              // 非批量模式：立即刷新网格补面
              this._refreshBlockRenderMesh(nx, ny, nz, nKey, this.blockData[nKey]);
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
