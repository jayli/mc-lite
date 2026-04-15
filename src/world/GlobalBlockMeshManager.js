import * as THREE from 'three';

class TypePool {
  constructor({ blockType, mesh, capacity, usesAO, usesOrientation, ownsGeometry }) {
    this.blockType = blockType;
    this.mesh = mesh;
    this.capacity = capacity;
    this.count = 0;
    this.usesAO = usesAO;
    this.usesOrientation = usesOrientation;
    this.ownsGeometry = ownsGeometry;
    this.slotToWorldKey = new Array(capacity).fill(null);
    this.worldKeyToSlot = new Map();
  }
}

function setArrayValue(attribute, slot, value) {
  if (!attribute || slot < 0 || slot >= attribute.array.length) return;
  attribute.array[slot] = value ?? 0;
  attribute.needsUpdate = true;
}

function clearArrayValue(attribute, slot) {
  if (!attribute || slot < 0 || slot >= attribute.array.length) return;
  attribute.array[slot] = 0;
  attribute.needsUpdate = true;
}

export class GlobalBlockMeshManager {
  constructor({
    scene,
    geometryResolver,
    materialResolver,
    attributePolicy,
    initialCapacity = 64
  }) {
    this.scene = scene;
    this.geometryResolver = geometryResolver;
    this.materialResolver = materialResolver;
    this.attributePolicy = attributePolicy || (() => ({}));
    this.initialCapacity = Math.max(1, initialCapacity);

    this.typePools = new Map();
    this.worldIndex = new Map();
    this.chunkIndex = new Map();
  }

  _createMesh(blockType, capacity) {
    const baseGeometry = this.geometryResolver(blockType);
    const material = this.materialResolver(blockType);
    const policy = this.attributePolicy(blockType) || {};
    const usesAO = Boolean(policy.usesAO);
    const usesOrientation = Boolean(policy.usesOrientation);
    const needsOwnedGeometry = usesAO || usesOrientation;
    const geometry = needsOwnedGeometry ? baseGeometry.clone() : baseGeometry;

    if (usesAO) {
      geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    }
    if (usesOrientation) {
      geometry.setAttribute('aOrientation', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    }

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = Boolean(policy.castsShadow);
    mesh.receiveShadow = Boolean(policy.receivesShadow);
    mesh.userData = {
      type: blockType,
      isGlobalBlockMesh: true
    };

    this.scene?.add?.(mesh);

    return new TypePool({
      blockType,
      mesh,
      capacity,
      usesAO,
      usesOrientation,
      ownsGeometry: needsOwnedGeometry
    });
  }

  _getOrCreatePool(blockType) {
    let pool = this.typePools.get(blockType);
    if (!pool) {
      pool = this._createMesh(blockType, this.initialCapacity);
      this.typePools.set(blockType, pool);
    }
    return pool;
  }

  _ensureCapacity(pool, nextCount) {
    if (nextCount <= pool.capacity) return;

    let newCapacity = pool.capacity;
    while (newCapacity < nextCount) {
      newCapacity = Math.max(this.initialCapacity, newCapacity * 2);
    }

    const newPool = this._createMesh(pool.blockType, newCapacity);
    const oldMesh = pool.mesh;
    const oldGeometry = oldMesh.geometry;
    const oldCount = pool.count;

    newPool.count = oldCount;
    newPool.mesh.count = oldCount;
    newPool.mesh.instanceMatrix.array.set(oldMesh.instanceMatrix.array.subarray(0, oldCount * 16), 0);
    newPool.mesh.instanceMatrix.needsUpdate = true;

    if (pool.usesAO) {
      const oldAoLow = oldMesh.geometry.getAttribute('aAoLow');
      const oldAoHigh = oldMesh.geometry.getAttribute('aAoHigh');
      const newAoLow = newPool.mesh.geometry.getAttribute('aAoLow');
      const newAoHigh = newPool.mesh.geometry.getAttribute('aAoHigh');
      newAoLow.array.set(oldAoLow.array.subarray(0, oldCount), 0);
      newAoHigh.array.set(oldAoHigh.array.subarray(0, oldCount), 0);
      newAoLow.needsUpdate = true;
      newAoHigh.needsUpdate = true;
    }

    if (pool.usesOrientation) {
      const oldOrientation = oldMesh.geometry.getAttribute('aOrientation');
      const newOrientation = newPool.mesh.geometry.getAttribute('aOrientation');
      newOrientation.array.set(oldOrientation.array.subarray(0, oldCount), 0);
      newOrientation.needsUpdate = true;
    }

    for (let i = 0; i < oldCount; i++) {
      newPool.slotToWorldKey[i] = pool.slotToWorldKey[i];
    }
    for (const [worldKey, slot] of pool.worldKeyToSlot.entries()) {
      newPool.worldKeyToSlot.set(worldKey, slot);
    }

    this.scene?.remove?.(oldMesh);
    if (pool.ownsGeometry) {
      oldGeometry.dispose();
    }

    pool.mesh = newPool.mesh;
    pool.capacity = newPool.capacity;
    pool.count = newPool.count;
    pool.slotToWorldKey = newPool.slotToWorldKey;
    pool.worldKeyToSlot = newPool.worldKeyToSlot;
    pool.ownsGeometry = newPool.ownsGeometry;
  }

  _writeMatrixAt(pool, slot, matrix) {
    pool.mesh.instanceMatrix.array.set(matrix.elements, slot * 16);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  _writeAttributesAt(pool, slot, attrs = {}) {
    if (pool.usesAO) {
      setArrayValue(pool.mesh.geometry.getAttribute('aAoLow'), slot, attrs.aoLow);
      setArrayValue(pool.mesh.geometry.getAttribute('aAoHigh'), slot, attrs.aoHigh);
    }
    if (pool.usesOrientation) {
      setArrayValue(pool.mesh.geometry.getAttribute('aOrientation'), slot, attrs.orientation);
    }
  }

  _clearSlot(pool, slot) {
    pool.mesh.instanceMatrix.array.fill(0, slot * 16, slot * 16 + 16);
    pool.mesh.instanceMatrix.needsUpdate = true;

    clearArrayValue(pool.mesh.geometry.getAttribute('aAoLow'), slot);
    clearArrayValue(pool.mesh.geometry.getAttribute('aAoHigh'), slot);
    clearArrayValue(pool.mesh.geometry.getAttribute('aOrientation'), slot);
  }

  _copyInstanceData(pool, fromSlot, toSlot) {
    if (fromSlot === toSlot) return;

    const matrixArray = pool.mesh.instanceMatrix.array;
    matrixArray.copyWithin(toSlot * 16, fromSlot * 16, fromSlot * 16 + 16);
    pool.mesh.instanceMatrix.needsUpdate = true;

    const aoLow = pool.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = pool.mesh.geometry.getAttribute('aAoHigh');
    const orientation = pool.mesh.geometry.getAttribute('aOrientation');

    if (aoLow) {
      aoLow.array[toSlot] = aoLow.array[fromSlot];
      aoLow.needsUpdate = true;
    }
    if (aoHigh) {
      aoHigh.array[toSlot] = aoHigh.array[fromSlot];
      aoHigh.needsUpdate = true;
    }
    if (orientation) {
      orientation.array[toSlot] = orientation.array[fromSlot];
      orientation.needsUpdate = true;
    }
  }

  _removeWorldKeyFromChunkIndex(worldKey, chunkKey) {
    if (!chunkKey) return;
    const keys = this.chunkIndex.get(chunkKey);
    if (!keys) return;
    keys.delete(worldKey);
    if (keys.size === 0) {
      this.chunkIndex.delete(chunkKey);
    }
  }

  upsertBlock(record) {
    const { worldKey, blockType, chunkKey, matrix } = record;
    if (!worldKey || !blockType || !matrix) return;

    const existing = this.worldIndex.get(worldKey);
    if (existing && existing.blockType === blockType) {
      const pool = this.typePools.get(blockType);
      if (!pool) return;
      const slot = pool.worldKeyToSlot.get(worldKey);
      if (slot === undefined) return;

      this._writeMatrixAt(pool, slot, matrix);
      this._writeAttributesAt(pool, slot, record);

      if (existing.chunkKey !== chunkKey) {
        this._removeWorldKeyFromChunkIndex(worldKey, existing.chunkKey);
        if (chunkKey) {
          let nextKeys = this.chunkIndex.get(chunkKey);
          if (!nextKeys) {
            nextKeys = new Set();
            this.chunkIndex.set(chunkKey, nextKeys);
          }
          nextKeys.add(worldKey);
        }
        existing.chunkKey = chunkKey;
      }
      return;
    }

    if (existing) {
      this.removeBlock(worldKey);
    }

    const pool = this._getOrCreatePool(blockType);
    this._ensureCapacity(pool, pool.count + 1);

    const slot = pool.count;
    pool.count += 1;
    pool.mesh.count = pool.count;
    pool.slotToWorldKey[slot] = worldKey;
    pool.worldKeyToSlot.set(worldKey, slot);
    this._writeMatrixAt(pool, slot, matrix);
    this._writeAttributesAt(pool, slot, record);

    this.worldIndex.set(worldKey, { blockType, chunkKey });
    if (chunkKey) {
      let keys = this.chunkIndex.get(chunkKey);
      if (!keys) {
        keys = new Set();
        this.chunkIndex.set(chunkKey, keys);
      }
      keys.add(worldKey);
    }
  }

  removeBlock(worldKey) {
    const meta = this.worldIndex.get(worldKey);
    if (!meta) return false;

    const pool = this.typePools.get(meta.blockType);
    if (!pool) {
      this.worldIndex.delete(worldKey);
      this._removeWorldKeyFromChunkIndex(worldKey, meta.chunkKey);
      return false;
    }

    const slot = pool.worldKeyToSlot.get(worldKey);
    if (slot === undefined) {
      this.worldIndex.delete(worldKey);
      this._removeWorldKeyFromChunkIndex(worldKey, meta.chunkKey);
      return false;
    }

    const lastSlot = pool.count - 1;
    const movedWorldKey = pool.slotToWorldKey[lastSlot];

    if (slot !== lastSlot && movedWorldKey) {
      this._copyInstanceData(pool, lastSlot, slot);
      pool.slotToWorldKey[slot] = movedWorldKey;
      pool.worldKeyToSlot.set(movedWorldKey, slot);
    }

    this._clearSlot(pool, lastSlot);
    pool.slotToWorldKey[lastSlot] = null;
    pool.worldKeyToSlot.delete(worldKey);
    pool.count -= 1;
    pool.mesh.count = pool.count;

    this.worldIndex.delete(worldKey);
    this._removeWorldKeyFromChunkIndex(worldKey, meta.chunkKey);

    return true;
  }

  replaceChunkBlocks(chunkKey, records) {
    this.unregisterChunk(chunkKey);
    for (const record of records) {
      this.upsertBlock({
        ...record,
        chunkKey: record.chunkKey || chunkKey
      });
    }
  }

  unregisterChunk(chunkKey) {
    const keys = this.chunkIndex.get(chunkKey);
    if (!keys) return;

    for (const worldKey of Array.from(keys)) {
      this.removeBlock(worldKey);
    }
  }

  updateBlockMatrix(worldKey, matrix) {
    const meta = this.worldIndex.get(worldKey);
    if (!meta || !matrix) return false;
    const pool = this.typePools.get(meta.blockType);
    if (!pool) return false;
    const slot = pool.worldKeyToSlot.get(worldKey);
    if (slot === undefined) return false;
    this._writeMatrixAt(pool, slot, matrix);
    return true;
  }

  updateBlockAttributes(worldKey, attrs) {
    const meta = this.worldIndex.get(worldKey);
    if (!meta) return false;
    const pool = this.typePools.get(meta.blockType);
    if (!pool) return false;
    const slot = pool.worldKeyToSlot.get(worldKey);
    if (slot === undefined) return false;
    this._writeAttributesAt(pool, slot, attrs);
    return true;
  }

  getWorldKeyFromInstance(blockType, instanceId) {
    const pool = this.typePools.get(blockType);
    if (!pool) return null;
    if (instanceId < 0 || instanceId >= pool.count) return null;
    return pool.slotToWorldKey[instanceId] || null;
  }

  getMeshes() {
    return Array.from(this.typePools.values()).map((pool) => pool.mesh);
  }

  getStats() {
    const byType = {};
    let totalBlocks = 0;

    for (const [blockType, pool] of this.typePools.entries()) {
      byType[blockType] = {
        count: pool.count,
        capacity: pool.capacity
      };
      totalBlocks += pool.count;
    }

    return {
      totalBlocks,
      typeCount: this.typePools.size,
      chunkCount: this.chunkIndex.size,
      byType
    };
  }

  validateInvariants() {
    const errors = [];

    for (const [worldKey, meta] of this.worldIndex.entries()) {
      const pool = this.typePools.get(meta.blockType);
      if (!pool) {
        errors.push(`worldIndex 指向缺失的类型池: ${worldKey} -> ${meta.blockType}`);
        continue;
      }
      const slot = pool.worldKeyToSlot.get(worldKey);
      if (slot === undefined) {
        errors.push(`worldIndex 存在但 worldKeyToSlot 缺失: ${worldKey}`);
        continue;
      }
      if (slot < 0 || slot >= pool.count) {
        errors.push(`worldKeyToSlot 超出活跃范围: ${worldKey} -> ${slot}`);
      }
      if (pool.slotToWorldKey[slot] !== worldKey) {
        errors.push(`slotToWorldKey 与 worldKeyToSlot 不一致: ${worldKey} -> ${slot}`);
      }
      if (meta.chunkKey) {
        const keys = this.chunkIndex.get(meta.chunkKey);
        if (!keys || !keys.has(worldKey)) {
          errors.push(`chunkIndex 缺失 worldKey: ${meta.chunkKey} -> ${worldKey}`);
        }
      }
    }

    for (const [blockType, pool] of this.typePools.entries()) {
      if (pool.count < 0 || pool.count > pool.capacity) {
        errors.push(`池计数非法: ${blockType} -> ${pool.count}/${pool.capacity}`);
      }
      if (pool.mesh.count !== pool.count) {
        errors.push(`mesh.count 不一致: ${blockType} -> ${pool.mesh.count}/${pool.count}`);
      }

      for (let i = 0; i < pool.count; i++) {
        const worldKey = pool.slotToWorldKey[i];
        if (!worldKey) {
          errors.push(`活跃区间存在空槽位: ${blockType}[${i}]`);
          continue;
        }
        if (pool.worldKeyToSlot.get(worldKey) !== i) {
          errors.push(`活跃区间双向索引不一致: ${blockType}[${i}] -> ${worldKey}`);
        }
      }

      for (let i = pool.count; i < pool.capacity; i++) {
        if (pool.slotToWorldKey[i] !== null) {
          errors.push(`非活跃区间残留 worldKey: ${blockType}[${i}] -> ${pool.slotToWorldKey[i]}`);
        }
      }
    }

    for (const [chunkKey, keys] of this.chunkIndex.entries()) {
      for (const worldKey of keys) {
        const meta = this.worldIndex.get(worldKey);
        if (!meta) {
          errors.push(`chunkIndex 指向不存在的 worldKey: ${chunkKey} -> ${worldKey}`);
          continue;
        }
        if (meta.chunkKey !== chunkKey) {
          errors.push(`chunkIndex 与 worldIndex 不一致: ${chunkKey} -> ${worldKey} -> ${meta.chunkKey}`);
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }

  dispose() {
    for (const pool of this.typePools.values()) {
      this.scene?.remove?.(pool.mesh);
      if (pool.ownsGeometry) {
        pool.mesh.geometry.dispose();
      }
    }

    this.typePools.clear();
    this.worldIndex.clear();
    this.chunkIndex.clear();
  }
}

