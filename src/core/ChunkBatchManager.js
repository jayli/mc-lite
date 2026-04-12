/**
 * 跨 Chunk 材质合批管理器
 * 将视野内多个 Chunk 中相同纹理的方块合并到共享的 InstancedMesh 中
 * 每个纹理组（textureGroup）对应一个全局 InstancedMesh，减少 draw call
 */
import * as THREE from 'three';
import { getBlockProperties, createBlockPropsResolver } from '../constants/BlockData.js';
import { geomMap } from '../world/ChunkConsolidation.js';

const getBlockProps = createBlockPropsResolver(getBlockProperties);

// 阴影投射规则
const isSolidShadowCaster = (props) => props.isSolid && props.isRendered !== false;
const isGlassType = (type) => typeof type === 'string' && type.includes('glass');

// 容量增长策略
const INITIAL_CAPACITY = 2048;
const MAX_CAPACITY = 65536;
const GROWTH_FACTOR = 2;

export class ChunkBatchManager {
  /**
   * @param {THREE.Scene} scene - 渲染场景
   * @param {MaterialManager} materials - 材质管理器
   */
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    // textureKey -> TextureBatchGroup
    this.textureGroups = new Map();
    // chunkKey -> { meshDataArray, entries: Map<textureKey, { offset, count }> }
    this.chunkRegistry = new Map();
    this._enabled = true;
    // 外部注入：用于获取活跃区块集合
    this._getActiveChunks = null;
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(value) {
    if (this._enabled === value) return;
    this._enabled = value;
    // 切换时重建所有区块的渲染方式
    this._rebuildAllChunks();
  }

  /**
   * 重建所有活跃区块的渲染（enabled 切换时调用）
   * 先清理合批数据，再让每个活跃区块用新模式重建 mesh
   */
  _rebuildAllChunks() {
    // 收集活跃区块引用
    const activeChunks = this._getActiveChunks ? this._getActiveChunks() : null;
    if (!activeChunks) return;

    // 1. 清理所有合批 InstancedMesh
    for (const group of this.textureGroups.values()) {
      if (group.instancedMesh) {
        this.scene.remove(group.instancedMesh);
        group.instancedMesh.geometry.dispose();
        group.instancedMesh.dispose();
      }
    }
    this.textureGroups.clear();
    this.chunkRegistry.clear();

    // 2. 让每个活跃区块重新构建 mesh（会根据 enabled 走不同路径）
    for (const [chunkKey, chunk] of activeChunks) {
      if (chunk.disposed || !chunk._lastMeshData) continue;
      // 清理 chunk.group 中旧的 InstancedMesh（如果有的话）
      this._cleanupChunkGroup(chunk);
      // 重新构建
      chunk.buildMeshes(chunk._lastMeshData);
    }
  }

  /**
   * 清理 chunk.group 中的 InstancedMesh（保留特殊实体和动态 Mesh）
   */
  _cleanupChunkGroup(chunk) {
    for (let i = chunk.group.children.length - 1; i >= 0; i--) {
      const child = chunk.group.children[i];
      if (child.isInstancedMesh) {
        if (child.geometry) child.geometry.dispose();
        chunk.group.remove(child);
      }
    }
  }

  /**
   * 注册一个 Chunk 的 mesh 数据到合批系统
   * @param {string} chunkKey - 区块键 `${cx},${cz}`
   * @param {Array} meshDataArray - Worker 返回的 mesh 数据数组
   */
  registerChunk(chunkKey, meshDataArray) {
    if (this.chunkRegistry.has(chunkKey)) {
      // 已存在则更新
      this.updateChunk(chunkKey, meshDataArray);
      return;
    }

    const chunkEntry = { meshDataArray, entries: new Map() };
    this.chunkRegistry.set(chunkKey, chunkEntry);

    for (const data of meshDataArray) {
      const textureKey = this._getTextureKey(data);
      if (!textureKey) continue;

      let group = this.textureGroups.get(textureKey);
      if (!group) {
        group = this._createTextureGroup(textureKey, data);
        this.textureGroups.set(textureKey, group);
      }

      // 追加该 Chunk 的数据
      const offset = group.totalCount;
      const count = data.count || 0;
      group.chunkData.set(chunkKey, { data, count });
      group.totalCount += count;

      chunkEntry.entries.set(textureKey, { offset, count });
    }

    // 重建所有受影响的纹理组
    this._rebuildAffectedGroups(meshDataArray);
  }

  /**
   * 注销一个 Chunk，释放其占用的合批资源
   * @param {string} chunkKey - 区块键
   */
  unregisterChunk(chunkKey) {
    const chunkEntry = this.chunkRegistry.get(chunkKey);
    if (!chunkEntry) return;

    const affectedKeys = new Set();

    // 从所有纹理组中移除该 Chunk 的数据
    for (const [textureKey] of chunkEntry.entries) {
      const group = this.textureGroups.get(textureKey);
      if (group) {
        group.chunkData.delete(chunkKey);
        group.totalCount = 0;
        for (const cd of group.chunkData.values()) {
          group.totalCount += cd.count;
        }
        affectedKeys.add(textureKey);
      }
    }

    this.chunkRegistry.delete(chunkKey);

    // 重建受影响的纹理组
    for (const textureKey of affectedKeys) {
      const group = this.textureGroups.get(textureKey);
      if (group.totalCount === 0) {
        // 没有数据了，清理整个组
        if (group.instancedMesh) {
          this.scene.remove(group.instancedMesh);
          group.instancedMesh.geometry.dispose();
          group.instancedMesh.dispose();
          group.instancedMesh = null;
        }
        this.textureGroups.delete(textureKey);
      } else {
        this._rebuildGroup(textureKey);
      }
    }
  }

  /**
   * 更新一个 Chunk 的 mesh 数据
   * @param {string} chunkKey - 区块键
   * @param {Array} meshDataArray - 新的 mesh 数据
   */
  updateChunk(chunkKey, meshDataArray) {
    // 先注销再重新注册（简单可靠）
    this.unregisterChunk(chunkKey);
    this.registerChunk(chunkKey, meshDataArray);
  }

  /**
   * 重建所有合批组（视距切换时使用）
   * @param {Map} activeChunks - 可选，指定活跃的 Chunk 集合
   */
  rebuildAll(activeChunks = null) {
    // 清理所有现有合批组
    for (const group of this.textureGroups.values()) {
      if (group.instancedMesh) {
        this.scene.remove(group.instancedMesh);
        group.instancedMesh.geometry.dispose();
        group.instancedMesh.dispose();
      }
    }
    this.textureGroups.clear();
    this.chunkRegistry.clear();

    // 如果有活跃 Chunk 集合，重新注册所有
    if (activeChunks) {
      for (const [chunkKey, chunk] of activeChunks) {
        if (chunk._lastMeshData && !chunk.disposed) {
          this.registerChunk(chunkKey, chunk._lastMeshData);
        }
      }
    }
  }

  /**
   * 获取合批统计数据（用于控制台验证）
   */
  getStats() {
    const totalDrawCalls = this.textureGroups.size;
    let totalInstances = 0;
    const groupDetails = [];

    for (const [textureKey, group] of this.textureGroups) {
      const chunkCount = group.chunkData.size;
      const instanceCount = group.totalCount;
      totalInstances += instanceCount;
      groupDetails.push({
        textureKey,
        chunks: chunkCount,
        instances: instanceCount
      });
    }

    // 估算优化前的 draw call（每 Chunk 每类型一次）
    let estimatedBefore = 0;
    for (const [, chunkEntry] of this.chunkRegistry) {
      estimatedBefore += chunkEntry.entries.size;
    }

    const reduction = estimatedBefore > 0
      ? ((1 - totalDrawCalls / estimatedBefore) * 100).toFixed(1)
      : 0;

    const stats = {
      enabled: this._enabled,
      totalDrawCalls,
      totalInstances,
      activeChunks: this.chunkRegistry.size,
      textureGroupCount: this.textureGroups.size,
      estimatedDrawCallsBefore: estimatedBefore,
      reduction: `${reduction}%`,
      groups: groupDetails
    };

    console.log('=== 跨 Chunk 合批统计 ===');
    console.log(`启用状态: ${stats.enabled}`);
    console.log(`总 Draw Call: ${stats.totalDrawCalls} (优化前: ${stats.estimatedDrawCallsBefore}, 减少: ${stats.reduction})`);
    console.log(`总实例数: ${stats.totalInstances}`);
    console.log(`活跃区块: ${stats.activeChunks}`);
    console.log(`纹理组数: ${stats.textureGroupCount}`);
    console.log('各组详情:');
    for (const g of groupDetails) {
      console.log(`  [${g.textureKey}] 区块: ${g.chunks}  实例: ${g.instances}`);
    }

    return stats;
  }

  // ========== 内部方法 ==========

  /**
   * 获取纹理分组键
   */
  _getTextureKey(data) {
    if (data.blockTypes) {
      return `batched:${data.type}`;
    }
    return `single:${data.type}`;
  }

  /**
   * 创建新的纹理合批组
   */
  _createTextureGroup(textureKey, sampleData) {
    let geometry, material;

    if (sampleData.blockTypes) {
      // 批次纹理
      const textureUrl = sampleData.type;
      material = this.materials.getBatchedMaterial(textureUrl, sampleData.blockTypes);
      const props = getBlockProps(sampleData.blockTypes[0]);
      geometry = geomMap[props.geometryType] || geomMap['default'];
    } else {
      // 单一类型
      const type = sampleData.type;
      const props = getBlockProps(type);
      if (!props.isRendered) return null;
      material = this.materials.getMaterial(type);
      geometry = geomMap[props.geometryType] || geomMap['default'];
    }

    if (!material) return null;

    return {
      textureKey,
      material,
      geometry,
      instancedMesh: null,
      chunkData: new Map(), // chunkKey -> { data, count }
      totalCount: 0,
      // 元数据用于 shadow 等设置
      isBatched: !!sampleData.blockTypes,
      sampleData
    };
  }

  /**
   * 重建所有受影响的纹理组
   */
  _rebuildAffectedGroups(meshDataArray) {
    for (const data of meshDataArray) {
      const textureKey = this._getTextureKey(data);
      if (textureKey) {
        this._rebuildGroup(textureKey);
      }
    }
  }

  /**
   * 重建单个纹理组的 InstancedMesh
   */
  _rebuildGroup(textureKey) {
    const group = this.textureGroups.get(textureKey);
    if (!group) return;

    // 如果没有数据，清理
    if (group.totalCount === 0) {
      if (group.instancedMesh) {
        this.scene.remove(group.instancedMesh);
        group.instancedMesh.geometry.dispose();
        group.instancedMesh.dispose();
        group.instancedMesh = null;
      }
      return;
    }

    const totalCount = group.totalCount;
    const isBatched = group.isBatched;

    // 计算所需容量
    let capacity = INITIAL_CAPACITY;
    while (capacity < totalCount) {
      capacity = Math.min(capacity * GROWTH_FACTOR, MAX_CAPACITY);
    }

    // 始终重建 InstancedMesh，确保实例属性大小与 totalCount 一致
    if (group.instancedMesh) {
      this.scene.remove(group.instancedMesh);
      group.instancedMesh.geometry.dispose();
      group.instancedMesh.dispose();
      group.instancedMesh = null;
    }

    const clonedGeometry = group.geometry.clone();
    const mesh = new THREE.InstancedMesh(clonedGeometry, group.material, capacity);
    mesh._capacity = capacity;
    mesh.count = totalCount;
    mesh.frustumCulled = false;

    // 设置 userData 用于方块交互（Raycaster 命中后识别方块类型）
    if (group.isBatched) {
      mesh.userData = { type: 'batched', blockTypes: group.sampleData.blockTypes, textureUrl: group.sampleData.type };
    } else {
      // single:stone → stone
      const blockType = group.textureKey.replace('single:', '');
      mesh.userData = { type: blockType };
    }
    mesh.userData._isBatchManaged = true; // 标记为合批管理器的 mesh

    // 阴影配置
    this._configureShadow(mesh, group);

    // 设置实例属性（按容量预分配）
    this._initInstanceAttributes(mesh, capacity, isBatched);

    group.instancedMesh = mesh;
    this.scene.add(mesh);

    // 填充矩阵和实例属性数据
    this._fillInstanceData(group);
  }

  /**
   * 配置阴影
   */
  _configureShadow(mesh, group) {
    const sampleData = group.sampleData;
    if (sampleData.blockTypes) {
      // 批次网格：根据第一个 blockType 判断
      const props = getBlockProps(sampleData.blockTypes[0]);
      if (props.isShadowEnabled) {
        mesh.castShadow = isSolidShadowCaster(props);
        mesh.receiveShadow = true;
      }
    } else {
      const type = sampleData.type;
      const props = getBlockProps(type);
      if (props.isShadowEnabled) {
        if (isGlassType(type)) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        } else {
          mesh.castShadow = isSolidShadowCaster(props);
          mesh.receiveShadow = true;
        }
      }
    }
  }

  /**
   * 初始化实例属性缓冲区
   */
  _initInstanceAttributes(mesh, count, isBatched) {
    const geometry = mesh.geometry;
    geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aOrientation', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    if (isBatched) {
      geometry.setAttribute('aTextureIndex', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    }
  }

  /**
   * 填充所有 Chunk 的实例数据到 InstancedMesh
   */
  _fillInstanceData(group) {
    const mesh = group.instancedMesh;
    if (!mesh) return;

    let matrixOffset = 0;
    let attrOffset = 0;

    for (const [chunkKey, { data, count }] of group.chunkData) {
      if (count === 0) continue;

      // 写入矩阵数据
      if (data.matrices) {
        mesh.instanceMatrix.array.set(data.matrices, matrixOffset);
      }

      // 写入 AO 和方向数据
      if (data.aoLow) {
        const aoLowAttr = mesh.geometry.getAttribute('aAoLow');
        aoLowAttr.array.set(data.aoLow, attrOffset);
      }
      if (data.aoHigh) {
        const aoHighAttr = mesh.geometry.getAttribute('aAoHigh');
        aoHighAttr.array.set(data.aoHigh, attrOffset);
      }
      if (data.orientation) {
        const orientAttr = mesh.geometry.getAttribute('aOrientation');
        orientAttr.array.set(data.orientation, attrOffset);
      }
      if (data.textureIndex && group.isBatched) {
        const texIdxAttr = mesh.geometry.getAttribute('aTextureIndex');
        if (texIdxAttr) {
          texIdxAttr.array.set(data.textureIndex, attrOffset);
        }
      }

      // 更新 chunkEntry 中的 offset
      const chunkEntry = this.chunkRegistry.get(chunkKey);
      if (chunkEntry) {
        chunkEntry.entries.set(group.textureKey, { offset: attrOffset, count });
      }

      matrixOffset += count * 16; // 每个矩阵 16 个 float
      attrOffset += count;
    }

    mesh.instanceMatrix.needsUpdate = true;

    // 标记所有实例属性需要更新
    const attrs = mesh.geometry.attributes;
    if (attrs.aAoLow) attrs.aAoLow.needsUpdate = true;
    if (attrs.aAoHigh) attrs.aAoHigh.needsUpdate = true;
    if (attrs.aOrientation) attrs.aOrientation.needsUpdate = true;
    if (attrs.aTextureIndex) attrs.aTextureIndex.needsUpdate = true;
  }
}
