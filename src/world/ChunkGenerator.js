/**
 * Chunk地形生成模块
 * 负责区块生成、实体生成等功能
 */
import * as THREE from 'three';
import { getBlockProperties, createBlockPropsResolver } from '../constants/BlockData.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { materials } from '../core/MaterialManager.js';
import { geomMap, worldWorker, workerCallbacks } from './ChunkConsolidation.js';
import { recordChunkPerf } from '../utils/ChunkPerfMonitor.js';
import { worldStore } from './WorldStore.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getMaterials = () => globalThis._materials || materials;
const getWorldStore = (chunk) => chunk?.world?.worldStore || globalThis._worldStore || worldStore;

// 获取方块属性函数 - 优先使用测试环境的模拟
const getBlockProps = createBlockPropsResolver(getBlockProperties);
// 阴影投射白名单规则：所有“实心且可渲染”的方块都允许投射阴影
const isSolidShadowCaster = (props) => props.isSolid && props.isRendered !== false;
const isGlassType = (type) => typeof type === 'string' && type.includes('glass');

export function extendChunk(Chunk) {
  function buildSnapshotFromChunkRecord(chunkRecord) {
    if (!chunkRecord) return null;
    const staticTrees = Array.isArray(chunkRecord.staticEntities)
      ? chunkRecord.staticEntities
        .filter(entity => entity?.type === 'static_tree')
        .map(entity => ({ x: entity.x, y: entity.y, z: entity.z }))
      : [];
    return {
      blocks: chunkRecord.blockData || {},
      meta: {},
      entities: {
        modGunMan: [],
        rovers: [],
        zombieNests: chunkRecord.runtimeEntities?.zombieNests || [],
        staticTrees
      }
    };
  }

  /**
   * 生成区块内容
   * 将计算压力较大的地形和结构生成逻辑分解到 Worker 线程中执行
   */
  Chunk.prototype.gen = async function() {
    // 0. 从 WorldStore 读取权威 ChunkRecord，并转换为兼容 Worker 的 snapshot 结构
    const chunkRecord = await getWorldStore(this).loadChunkRecord?.(this.cx, this.cz);
    const snapshot = buildSnapshotFromChunkRecord(chunkRecord);

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
      const taskId = `gen:${this.cx},${this.cz}:${performance.now()}:${Math.random().toString(36).slice(2, 8)}`;

      // 注册 Worker 池回调
      workerCallbacks.set(taskId, (data) => {
        if (this.disposed) return;
        this.world?._onChunkGenResult?.(this, data);
        resolve();
      });

      // 存档加载优化：当 snapshot 已包含完整 blockData 时，
      // 跳过 Worker 地形生成（噪声、CityMap、结构放置等），直接消费 snapshot 数据
      const skipTerrainGeneration = snapshot?.blocks && Object.keys(snapshot.blocks).length > 0;

      // 4. 发送生成请求到 Worker 池
      worldWorker.postMessage({
        cx: this.cx,
        cz: this.cz,
        taskId,
        seed: WORLD_CONFIG.SEED,
        snapshot,
        structureCenters: neighborStructureCenters.length > 0 ? neighborStructureCenters : undefined,
        skipTerrainGeneration
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
    const key = Chunk.encodeCoord(x, y, z);

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
   * 构建所有网格 - 使用 Worker 预计算的矩阵数据
   * 主线程只做简单的数据装配，无复杂计算
   * @param {Array} meshDataArray - Worker 返回的预计算 mesh 数据
   */
  Chunk.prototype.buildMeshes = function(meshDataArray) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    // 防御性检查：确保数据格式正确
    if (!Array.isArray(meshDataArray)) {
      console.warn('buildMeshes received legacy data format, expected array');
      return;
    }

    if (this.world?.globalInstancedMeshManager) {
      const chunkKey = `${this.cx},${this.cz}`;
      const isInitialBuild = this.loadState !== 'finalized' && this.loadState !== 'waiting-consolidation';
      let result;
      if (isInitialBuild) {
        result = this.world.globalInstancedMeshManager.stageMeshDataForChunk(chunkKey, meshDataArray);
        if (result > 0) {
          this.renderState = 'staged';
        }
      } else {
        result = this.world.globalInstancedMeshManager.patchChunkVisibleBlocks(chunkKey, meshDataArray);
      }
      recordChunkPerf('chunk.build-meshes-global', (globalThis.performance?.now?.() ?? Date.now()) - t0, {
        chunkKey,
        meshGroups: meshDataArray.length,
        instanceCount: typeof result === 'number' ? result : result?.queued || 0,
        patchUpdated: result?.updated || 0,
        patchRemoved: result?.removed || 0,
        staged: isInitialBuild
      });
      return;
    }

    // 遍历每种方块类型的 mesh 数据
    for (const data of meshDataArray) {
      // 判断是否为合批数据（包含 blockTypes 数组）
      if (data.blockTypes) {
        this._buildBatchedMesh(data);
      } else {
        this._buildSingleTypeMesh(data);
      }
    }
    recordChunkPerf('chunk.build-meshes', (globalThis.performance?.now?.() ?? Date.now()) - t0, {
      chunkKey: `${this.cx},${this.cz}`,
      meshGroups: meshDataArray.length,
      instanceCount: meshDataArray.reduce((sum, data) => sum + (data.count || 0), 0)
    });
  }

  /**
   * 构建合批 Mesh（多个方块类型共享一个 InstancedMesh）
   * @param {Object} data - Worker 返回的合批 mesh 数据
   */
  Chunk.prototype._buildBatchedMesh = function(data) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const { type: textureUrl, count, matrices, aoLow, aoHigh, orientation, textureIndex, instanceIndexMap, blockTypes } = data;

    // 创建使用共享材质的 InstancedMesh
    const batchedMaterial = this.world.engine.materials.getBatchedMaterial(textureUrl, blockTypes);
    const props = getBlockProps(blockTypes[0]);
    const geometry = geomMap[props.geometryType] || geomMap['default'];

    const mesh = new THREE.InstancedMesh(geometry, batchedMaterial, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

    // 设置 AO 属性
    mesh.geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(aoLow, 1));
    mesh.geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(aoHigh, 1));
    mesh.geometry.setAttribute('aOrientation', new THREE.InstancedBufferAttribute(orientation, 1));
    mesh.geometry.setAttribute('aTextureIndex', new THREE.InstancedBufferAttribute(textureIndex, 1));

    mesh.userData = { type: 'batched', blockTypes, textureUrl };

    // 存储索引映射（用于后续交互），Worker 返回的 Object key 为字符串，转回数字编码
    this.instanceIndexMap['batched_' + textureUrl] = new Map(
      Object.entries(instanceIndexMap).map(([k, v]) => [Number(k), v])
    );

    this.group.add(mesh);
    recordChunkPerf('chunk.build-batched-mesh', (globalThis.performance?.now?.() ?? Date.now()) - t0, {
      chunkKey: `${this.cx},${this.cz}`,
      textureUrl,
      count,
      blockTypes: blockTypes?.length || 0
    }, { thresholdMs: 1 });
  };

  /**
   * 构建单一类型 Mesh（原有逻辑）
   * @param {Object} data - Worker 返回的 mesh 数据
   */
  Chunk.prototype._buildSingleTypeMesh = function(data) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const { type, count, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;

    const props = getBlockProps(type);
    if (!props.isRendered) return;

    // 检查是否已存在相同类型的 InstancedMesh，若有则移除旧 mesh 以便重建
    const existingMesh = this.group.children.find(c => c.isInstancedMesh && c.userData.type === type);
    if (existingMesh) {
      this.group.remove(existingMesh);
    }

    if (count === 0) return;

    // 从材质管理器和几何体映射表获取资源
    const geometry = geomMap[props.geometryType] || geomMap['default'];
    const material = getMaterials().getMaterial(type);

    // 创建实例化网格：指定几何体、材质和实例总数
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;

    // === 核心优化：直接设置矩阵数据 ===
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

    // === 设置 AO 属性（已预计算）===
    if (props.isSolid && !props.isTransparent) {
      // 克隆几何体以拥有独立的属性
      mesh.geometry = geometry.clone();
      mesh.geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(aoLow, 1));
      mesh.geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(aoHigh, 1));
      mesh.geometry.setAttribute('aOrientation', new THREE.InstancedBufferAttribute(orientation, 1));
    }

    // 存储元数据，便于后续通过 Raycaster 进行交互识别
    mesh.userData = { type: type };
    if (type === 'chest') {
      mesh.userData.chests = {}; // 如果是箱子，初始化一个子对象存储每个箱子的开启状态
    }

    // 存储索引映射（用于后续交互），Worker 返回的 Object key 为字符串，转回数字编码
    this.instanceIndexMap[type] = new Map(
      Object.entries(instanceIndexMap).map(([k, v]) => [Number(k), v])
    );

    // 宝箱特殊处理：初始化每个箱子的状态
    if (type === 'chest') {
      for (let i = 0; i < count; i++) {
        mesh.userData.chests[i] = { open: false };
      }
    }

    // 阴影配置优化
    if (props.isShadowEnabled) {
      if (isGlassType(type)) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else {
        mesh.castShadow = isSolidShadowCaster(props);
        mesh.receiveShadow = true; // 开启实时阴影接收
      }
    }

    // 将实例化网格添加到区块的分组中
    this.group.add(mesh);
    recordChunkPerf('chunk.build-single-type-mesh', (globalThis.performance?.now?.() ?? Date.now()) - t0, {
      chunkKey: `${this.cx},${this.cz}`,
      type,
      count,
      clonedGeometry: props.isSolid && !props.isTransparent,
      instanceIndexMapSize: Object.keys(instanceIndexMap || {}).length
    }, { thresholdMs: 1 });
  };
}
