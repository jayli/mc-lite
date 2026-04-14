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
// 惰性压缩阈值
const WASTE_THRESHOLD = 0.25;

export class ChunkBatchManager {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.textureGroups = new Map();
    this.chunkRegistry = new Map();
    this._enabled = true;
    this._getActiveChunks = null;

    // 世界坐标 -> 实例映射（唯一实例主键）
    // key: "x,y,z", value: { textureKey, instanceId, chunkKey }
    this.worldPosToInstance = new Map();
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(value) {
    if (this._enabled === value) return;
    this._enabled = value;
    this._rebuildAllChunks();
  }

  /**
   * 重建所有活跃区块的渲染（enabled 切换时调用）
   */
  _rebuildAllChunks() {
    const activeChunks = this._getActiveChunks ? this._getActiveChunks() : null;
    if (!activeChunks) return;

    for (const group of this.textureGroups.values()) {
      if (group.instancedMesh) {
        this.scene.remove(group.instancedMesh);
        group.instancedMesh.geometry.dispose();
        group.instancedMesh.dispose();
      }
    }
    this.textureGroups.clear();
    this.chunkRegistry.clear();
    this.worldPosToInstance.clear();

    for (const [_chunkKey, chunk] of activeChunks) {
      if (chunk.disposed || !chunk._lastMeshData) continue;
      const chunkKey = `${chunk.cx},${chunk.cz}`;
      this.registerChunk(chunkKey, chunk._lastMeshData);
    }
  }

  /**
   * 清理 chunk.group 中的 InstancedMesh
   */
  _cleanupChunkGroup(chunk) {
    for (let i = chunk.group.children.length - 1; i >= 0; i--) {
      const child = chunk.group.children[i];
      if (child.isInstancedMesh) {
        const type = child.userData.type;
        if (child.geometry &&
            child.geometry !== geomMap[type] &&
            child.geometry !== geomMap['default']) {
          child.geometry.dispose();
        }
        chunk.group.remove(child);
      }
    }
  }

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
      const textureUrl = sampleData.type;
      material = this.materials.getBatchedMaterial(textureUrl, sampleData.blockTypes);
      const props = getBlockProps(sampleData.blockTypes[0]);
      geometry = geomMap[props.geometryType] || geomMap['default'];
    } else {
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
      chunkData: new Map(),
      totalCount: 0,
      isBatched: !!sampleData.blockTypes,
      sampleData
    };
  }

  /**
   * 注册一个 Chunk 的 mesh 数据到合批系统
   */
  registerChunk(chunkKey, meshDataArray) {
    if (this.chunkRegistry.has(chunkKey)) {
      this.updateChunk(chunkKey, meshDataArray);
      return;
    }

    const chunkEntry = { meshDataArray, entries: new Map() };
    this.chunkRegistry.set(chunkKey, chunkEntry);

    const needsRebuildKeys = new Set();

    for (const data of meshDataArray) {
      const textureKey = this._getTextureKey(data);
      if (!textureKey) continue;

      let group = this.textureGroups.get(textureKey);
      if (!group) {
        group = this._createTextureGroup(textureKey, data);
        if (!group) continue;
        this.textureGroups.set(textureKey, group);
      }

      const count = data.count || 0;

      if (count > 0 && group.instancedMesh && group.totalCount + count <= group.instancedMesh._capacity) {
        const offset = group.totalCount;
        this._appendDataToGroup(group, chunkKey, data, count, offset);
        chunkEntry.entries.set(textureKey, { offset, count });
        this._updateWorldPosMapping(group, data, offset, chunkKey);
        continue;
      }

      group.chunkData.set(chunkKey, { data, count });
      group.totalCount += count;
      chunkEntry.entries.set(textureKey, { offset: group.totalCount - count, count });
      needsRebuildKeys.add(textureKey);
    }

    for (const textureKey of needsRebuildKeys) {
      this._rebuildGroup(textureKey);
    }
  }

  /**
   * 同步更新世界坐标映射（增量追加时调用）
   */
  _updateWorldPosMapping(group, data, offset, chunkKey) {
    const { matrices } = data;
    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    for (let i = 0; i < data.count; i++) {
      dummy.fromArray(matrices, i * 16);
      pos.setFromMatrixPosition(dummy);
      const worldKey = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;

      if (this.worldPosToInstance.has(worldKey)) {
        console.warn(`[BatchManager] 重复注册 ${worldKey}，Worker 输出可能未去重`);
        continue;
      }

      this.worldPosToInstance.set(worldKey, {
        textureKey: group.textureKey,
        instanceId: offset + i,
        chunkKey
      });
    }
  }

  /**
   * 增量追加 chunk 数据到现有 group
   */
  _appendDataToGroup(group, chunkKey, data, count, offset) {
    const mesh = group.instancedMesh;

    if (data.matrices) {
      mesh.instanceMatrix.array.set(data.matrices, offset * 16);
    }
    if (data.aoLow) {
      mesh.geometry.getAttribute('aAoLow').array.set(data.aoLow, offset);
    }
    if (data.aoHigh) {
      mesh.geometry.getAttribute('aAoHigh').array.set(data.aoHigh, offset);
    }
    if (data.orientation) {
      mesh.geometry.getAttribute('aOrientation').array.set(data.orientation, offset);
    }
    if (data.textureIndex && group.isBatched) {
      const attr = mesh.geometry.getAttribute('aTextureIndex');
      if (attr) attr.array.set(data.textureIndex, offset);
    }

    mesh.count = offset + count;
    mesh.instanceMatrix.needsUpdate = true;

    const attrs = mesh.geometry.attributes;
    if (attrs.aAoLow) attrs.aAoLow.needsUpdate = true;
    if (attrs.aAoHigh) attrs.aAoHigh.needsUpdate = true;
    if (attrs.aOrientation) attrs.aOrientation.needsUpdate = true;
    if (attrs.aTextureIndex) attrs.aTextureIndex.needsUpdate = true;

    group.chunkData.set(chunkKey, { data, count });
    group.totalCount = offset + count;
  }

  /**
   * 重建单个纹理组的 InstancedMesh
   */
  _rebuildGroup(textureKey) {
    const group = this.textureGroups.get(textureKey);
    if (!group) return;

    for (const [worldKey, info] of this.worldPosToInstance) {
      if (info.textureKey === textureKey) {
        this.worldPosToInstance.delete(worldKey);
      }
    }

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

    let capacity = INITIAL_CAPACITY;
    while (capacity < totalCount) {
      capacity = Math.min(capacity * GROWTH_FACTOR, MAX_CAPACITY);
    }

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

    if (group.isBatched) {
      mesh.userData = { type: 'batched', blockTypes: group.sampleData.blockTypes, textureUrl: group.sampleData.type };
    } else {
      const blockType = group.textureKey.replace('single:', '');
      mesh.userData = { type: blockType };
    }
    mesh.userData._isBatchManaged = true;
    mesh.userData._textureKey = group.textureKey;

    this._configureShadow(mesh, group);
    this._initInstanceAttributes(mesh, capacity, isBatched);

    group.instancedMesh = mesh;
    this.scene.add(mesh);

    this._fillInstanceData(group);

    for (const [ck, { data }] of group.chunkData) {
      const chunkEntry = this.chunkRegistry.get(ck);
      const entry = chunkEntry?.entries.get(textureKey);
      if (entry) {
        this._updateWorldPosMappingForChunk(group, data, entry.offset, ck);
      }
    }
  }

  /**
   * 为单个 chunk 更新世界坐标映射
   */
  _updateWorldPosMappingForChunk(group, data, offset, chunkKey) {
    const { matrices } = data;
    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    for (let i = 0; i < data.count; i++) {
      dummy.fromArray(matrices, i * 16);
      pos.setFromMatrixPosition(dummy);
      const worldKey = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;

      this.worldPosToInstance.set(worldKey, {
        textureKey: group.textureKey,
        instanceId: offset + i,
        chunkKey
      });
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

      if (data.matrices) {
        mesh.instanceMatrix.array.set(data.matrices, matrixOffset);
      }
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

      const chunkEntry = this.chunkRegistry.get(chunkKey);
      if (chunkEntry) {
        chunkEntry.entries.set(group.textureKey, { offset: attrOffset, count });
      }

      matrixOffset += count * 16;
      attrOffset += count;
    }

    mesh.instanceMatrix.needsUpdate = true;

    const attrs = mesh.geometry.attributes;
    if (attrs.aAoLow) attrs.aAoLow.needsUpdate = true;
    if (attrs.aAoHigh) attrs.aAoHigh.needsUpdate = true;
    if (attrs.aOrientation) attrs.aOrientation.needsUpdate = true;
    if (attrs.aTextureIndex) attrs.aTextureIndex.needsUpdate = true;
  }

  /**
   * 配置阴影
   */
  _configureShadow(mesh, group) {
    const sampleData = group.sampleData;
    if (sampleData.blockTypes) {
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
   * 在指定偏移量覆盖写入数据
   */
  _writeDataAtOffset(group, data, _count, offset) {
    const mesh = group.instancedMesh;
    if (data.matrices) mesh.instanceMatrix.array.set(data.matrices, offset * 16);
    if (data.aoLow) mesh.geometry.getAttribute('aAoLow').array.set(data.aoLow, offset);
    if (data.aoHigh) mesh.geometry.getAttribute('aAoHigh').array.set(data.aoHigh, offset);
    if (data.orientation) mesh.geometry.getAttribute('aOrientation').array.set(data.orientation, offset);
    if (data.textureIndex && group.isBatched) {
      const attr = mesh.geometry.getAttribute('aTextureIndex');
      if (attr) attr.array.set(data.textureIndex, offset);
    }
    mesh.instanceMatrix.needsUpdate = true;
    const attrs = mesh.geometry.attributes;
    if (attrs.aAoLow) attrs.aAoLow.needsUpdate = true;
    if (attrs.aAoHigh) attrs.aAoHigh.needsUpdate = true;
    if (attrs.aOrientation) attrs.aOrientation.needsUpdate = true;
    if (attrs.aTextureIndex) attrs.aTextureIndex.needsUpdate = true;
  }

  /**
   * 将指定范围的实例缩放到 0（视觉隐藏）
   */
  _zeroOutInstances(mesh, startIdx, count) {
    const dummy = new THREE.Matrix4();
    const zeroVec = new THREE.Vector3(0, 0, 0);
    for (let i = startIdx; i < startIdx + count; i++) {
      mesh.getMatrixAt(i, dummy);
      dummy.scale(zeroVec);
      mesh.setMatrixAt(i, dummy);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * 注销一个 Chunk，释放其占用的合批资源
   */
  unregisterChunk(chunkKey) {
    const chunkEntry = this.chunkRegistry.get(chunkKey);
    if (!chunkEntry) return;

    // 清理该 chunk 的世界坐标映射
    for (const [worldKey, info] of this.worldPosToInstance) {
      if (info.chunkKey === chunkKey) {
        this.worldPosToInstance.delete(worldKey);
      }
    }

    for (const [textureKey, slot] of chunkEntry.entries) {
      const group = this.textureGroups.get(textureKey);
      if (!group) continue;

      if (group.instancedMesh) {
        this._zeroOutInstances(group.instancedMesh, slot.offset, slot.count);
      }

      group.chunkData.delete(chunkKey);
    }

    this.chunkRegistry.delete(chunkKey);

    const keysToDelete = [];
    for (const [textureKey, group] of this.textureGroups) {
      if (group.chunkData.size === 0) {
        if (group.instancedMesh) {
          this.scene.remove(group.instancedMesh);
          group.instancedMesh.geometry.dispose();
          group.instancedMesh.dispose();
          group.instancedMesh = null;
        }
        keysToDelete.push(textureKey);
      } else if (group.instancedMesh) {
        const usedCount = [...group.chunkData.values()].reduce((sum, cd) => sum + cd.count, 0);
        const allocatedCount = group.instancedMesh.count;
        if (allocatedCount > 0 && (allocatedCount - usedCount) / allocatedCount > WASTE_THRESHOLD) {
          group.totalCount = usedCount;
          this._rebuildGroup(textureKey);
        }
      }
    }

    for (const key of keysToDelete) {
      this.textureGroups.delete(key);
    }
  }

  /**
   * 更新一个 Chunk 的 mesh 数据
   */
  updateChunk(chunkKey, meshDataArray) {
    const oldEntry = this.chunkRegistry.get(chunkKey);
    if (!oldEntry) {
      this.registerChunk(chunkKey, meshDataArray);
      return;
    }

    let canAllInPlace = true;
    for (const data of meshDataArray) {
      const textureKey = this._getTextureKey(data);
      if (!textureKey) continue;
      const group = this.textureGroups.get(textureKey);
      if (!group?.instancedMesh) { canAllInPlace = false; break; }
      const newCount = data.count || 0;
      const oldSlot = oldEntry.entries.get(textureKey);
      if (!oldSlot || newCount > oldSlot.count) { canAllInPlace = false; break; }
    }

    if (!canAllInPlace) {
      this.unregisterChunk(chunkKey);
      this.registerChunk(chunkKey, meshDataArray);
      return;
    }

    const newEntry = { meshDataArray, entries: new Map() };

    for (const data of meshDataArray) {
      const textureKey = this._getTextureKey(data);
      if (!textureKey) continue;
      const group = this.textureGroups.get(textureKey);
      const newCount = data.count || 0;
      const oldSlot = oldEntry.entries.get(textureKey);
      const offset = oldSlot.offset;

      this._clearWorldPosMappingForChunk(textureKey, offset, oldSlot.count);

      this._writeDataAtOffset(group, data, newCount, offset);
      if (newCount < oldSlot.count) {
        this._zeroOutInstances(group.instancedMesh, offset + newCount, oldSlot.count - newCount);
      }
      group.chunkData.set(chunkKey, { data, count: newCount });
      newEntry.entries.set(textureKey, { offset, count: newCount });

      this._updateWorldPosMappingForChunk(group, data, offset, chunkKey);
    }

    for (const [textureKey, oldSlot] of oldEntry.entries) {
      if (newEntry.entries.has(textureKey)) continue;
      const group = this.textureGroups.get(textureKey);
      if (group?.instancedMesh) {
        this._zeroOutInstances(group.instancedMesh, oldSlot.offset, oldSlot.count);
        this._clearWorldPosMappingForChunk(textureKey, oldSlot.offset, oldSlot.count);
      }
      if (group) group.chunkData.delete(chunkKey);
    }

    this.chunkRegistry.set(chunkKey, newEntry);
  }

  /**
   * 清理指定 chunk 在指定范围内的世界坐标映射
   */
  _clearWorldPosMappingForChunk(textureKey, offset, count) {
    const toRemove = [];
    for (const [worldKey, info] of this.worldPosToInstance) {
      if (info.textureKey === textureKey && offset <= info.instanceId && info.instanceId < offset + count) {
        toRemove.push(worldKey);
      }
    }
    for (const key of toRemove) {
      this.worldPosToInstance.delete(key);
    }
  }

  /**
   * 通过世界坐标隐藏实例（用于方块删除）
   */
  hideInstanceAt(x, y, z) {
    const worldKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const instanceInfo = this.worldPosToInstance.get(worldKey);

    if (!instanceInfo) {
      return false;
    }

    const { textureKey, instanceId } = instanceInfo;
    const group = this.textureGroups.get(textureKey);

    if (!group?.instancedMesh) {
      return false;
    }

    const dummy = new THREE.Matrix4();
    dummy.makeScale(0, 0, 0);
    group.instancedMesh.setMatrixAt(instanceId, dummy);
    group.instancedMesh.instanceMatrix.needsUpdate = true;

    this.worldPosToInstance.delete(worldKey);

    return true;
  }

  /**
   * 检查坐标是否有合批实例
   */
  hasInstanceAt(x, y, z) {
    const worldKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return this.worldPosToInstance.has(worldKey);
  }

  /**
   * 通过世界坐标获取实例信息
   */
  getInstanceInfoAt(x, y, z) {
    const worldKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return this.worldPosToInstance.get(worldKey) || null;
  }

  /**
   * 重建所有合批组（视距切换时使用）
   */
  rebuildAll(activeChunks = null) {
    for (const group of this.textureGroups.values()) {
      if (group.instancedMesh) {
        this.scene.remove(group.instancedMesh);
        group.instancedMesh.geometry.dispose();
        group.instancedMesh.dispose();
      }
    }
    this.textureGroups.clear();
    this.chunkRegistry.clear();
    this.worldPosToInstance.clear();

    if (activeChunks) {
      for (const [chunkKey, chunk] of activeChunks) {
        if (chunk._lastMeshData && !chunk.disposed) {
          this.registerChunk(chunkKey, chunk._lastMeshData);
        }
      }
    }
  }

  /**
   * 查找指定位置在全局 batch mesh 中的实例索引（兼容旧接口）
   */
  resolveInstanceIndex(_chunkKey, _textureKey, posKey) {
    const worldKey = posKey;
    const info = this.worldPosToInstance.get(worldKey);
    if (!info) return null;
    const group = this.textureGroups.get(info.textureKey);
    if (!group?.instancedMesh) return null;
    return { mesh: group.instancedMesh, globalIndex: info.instanceId };
  }

  /**
   * 获取合批统计数据
   */
  getStats() {
    const totalDrawCalls = this.textureGroups.size;
    let totalInstances = 0;
    const groupDetails = [];

    for (const [textureKey, group] of this.textureGroups) {
      const chunkCount = group.chunkData.size;
      const instanceCount = group.totalCount;
      totalInstances += instanceCount;
      groupDetails.push({ textureKey, chunks: chunkCount, instances: instanceCount });
    }

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
}
