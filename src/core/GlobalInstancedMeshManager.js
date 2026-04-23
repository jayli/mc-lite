import * as THREE from 'three';
import { getBlockProperties } from '../constants/BlockData.js';
import { materials as defaultMaterials } from './MaterialManager.js';
import { geomMap } from '../world/ChunkConsolidation.js';
import { decodeCoord } from '../utils/CoordEncoding.js';

const DEFAULT_INITIAL_CAPACITY = 256;
const DEFAULT_MUTATION_MAX_OPS = 600;
const DEFAULT_MUTATION_MAX_MS = 2;
const MATRIX_STRIDE = 16;

const isGlassType = (type) => typeof type === 'string' && type.includes('glass');
const isSolidShadowCaster = (props) => props.isSolid && props.isRendered !== false;

function copyMatrixArray(source, sourceIndex, target, targetIndex) {
  target.set(
    source.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE),
    targetIndex * MATRIX_STRIDE
  );
}

class TypeBuffer {
  constructor(manager, renderKey, type, initialCapacity) {
    this.manager = manager;
    this.renderKey = renderKey;
    this.type = type;
    this.capacity = Math.max(1, initialCapacity || DEFAULT_INITIAL_CAPACITY);
    this.count = 0;
    this.coordToIndex = new Map();
    this.indexToCoord = new Array(this.capacity).fill(0);
    this.mesh = this._createMesh(this.capacity);
  }

  _createMesh(capacity) {
    const props = getBlockProperties(this.type);
    const baseGeometry = geomMap[props.geometryType] || geomMap.default;
    const geometry = props.isSolid && !props.isTransparent ? baseGeometry.clone() : baseGeometry;
    const material = this.manager.materials.getMaterial(this.type);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = this.count;
    mesh.frustumCulled = false;
    mesh.userData = {
      type: this.type,
      globalInstancedMesh: true,
      globalBuffer: this
    };

    if (this.type === 'chest') {
      mesh.userData.chests = {};
    }

    if (props.isSolid && !props.isTransparent) {
      geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      geometry.setAttribute('aOrientation', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    }

    if (props.isShadowEnabled) {
      if (isGlassType(this.type)) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else {
        mesh.castShadow = isSolidShadowCaster(props);
        mesh.receiveShadow = true;
      }
    }

    return mesh;
  }

  ensureCapacity(required) {
    if (required <= this.capacity) return;

    let nextCapacity = this.capacity;
    while (nextCapacity < required) {
      nextCapacity = Math.max(nextCapacity + 1, Math.ceil(nextCapacity * 1.5));
    }

    const oldMesh = this.mesh;
    const oldGeometry = oldMesh.geometry;
    const oldMatrixArray = oldMesh.instanceMatrix.array;
    const oldAoLow = oldGeometry.getAttribute('aAoLow')?.array || null;
    const oldAoHigh = oldGeometry.getAttribute('aAoHigh')?.array || null;
    const oldOrientation = oldGeometry.getAttribute('aOrientation')?.array || null;

    this.capacity = nextCapacity;
    this.indexToCoord.length = nextCapacity;
    this.indexToCoord.fill(0, this.count);
    this.mesh = this._createMesh(nextCapacity);
    this.mesh.instanceMatrix.array.set(oldMatrixArray.subarray(0, this.count * MATRIX_STRIDE));

    const nextAoLow = this.mesh.geometry.getAttribute('aAoLow');
    const nextAoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    const nextOrientation = this.mesh.geometry.getAttribute('aOrientation');
    if (oldAoLow && nextAoLow) nextAoLow.array.set(oldAoLow.subarray(0, this.count));
    if (oldAoHigh && nextAoHigh) nextAoHigh.array.set(oldAoHigh.subarray(0, this.count));
    if (oldOrientation && nextOrientation) nextOrientation.array.set(oldOrientation.subarray(0, this.count));

    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (nextAoLow) nextAoLow.needsUpdate = true;
    if (nextAoHigh) nextAoHigh.needsUpdate = true;
    if (nextOrientation) nextOrientation.needsUpdate = true;

    this.manager.scene.remove(oldMesh);
    if (oldGeometry !== geomMap[getBlockProperties(this.type).geometryType] && oldGeometry !== geomMap.default) {
      oldGeometry.dispose();
    }
    this.manager.scene.add(this.mesh);
  }

  markDirty(index) {
    if (typeof this.mesh.instanceMatrix.addUpdateRange === 'function') {
      this.mesh.instanceMatrix.addUpdateRange(index * MATRIX_STRIDE, MATRIX_STRIDE);
    } else {
      this.mesh.instanceMatrix.updateRange.offset = index * MATRIX_STRIDE;
      this.mesh.instanceMatrix.updateRange.count = MATRIX_STRIDE;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    const orientation = this.mesh.geometry.getAttribute('aOrientation');
    if (aoLow) aoLow.needsUpdate = true;
    if (aoHigh) aoHigh.needsUpdate = true;
    if (orientation) orientation.needsUpdate = true;
    this.mesh.boundingSphere = null;
    this.mesh.boundingBox = null;
  }

  writeInstance(index, data) {
    this.mesh.instanceMatrix.array.set(data.matrix, index * MATRIX_STRIDE);
    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    const orientation = this.mesh.geometry.getAttribute('aOrientation');
    if (aoLow) aoLow.array[index] = data.aoLow ?? 1;
    if (aoHigh) aoHigh.array[index] = data.aoHigh ?? 1;
    if (orientation) orientation.array[index] = data.orientation ?? 0;
    this.markDirty(index);
  }

  copyInstance(fromIndex, toIndex) {
    copyMatrixArray(this.mesh.instanceMatrix.array, fromIndex, this.mesh.instanceMatrix.array, toIndex);
    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    const orientation = this.mesh.geometry.getAttribute('aOrientation');
    if (aoLow) aoLow.array[toIndex] = aoLow.array[fromIndex];
    if (aoHigh) aoHigh.array[toIndex] = aoHigh.array[fromIndex];
    if (orientation) orientation.array[toIndex] = orientation.array[fromIndex];
  }

  updateAO(index, aoLowValue, aoHighValue) {
    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    if (!aoLow || !aoHigh) return false;
    aoLow.array[index] = aoLowValue;
    aoHigh.array[index] = aoHighValue;
    aoLow.needsUpdate = true;
    aoHigh.needsUpdate = true;
    return true;
  }

  dispose() {
    this.manager.scene.remove(this.mesh);
    const props = getBlockProperties(this.type);
    const sharedGeometry = geomMap[props.geometryType] || geomMap.default;
    if (this.mesh.geometry && this.mesh.geometry !== sharedGeometry) {
      this.mesh.geometry.dispose();
    }
  }
}

export class GlobalInstancedMeshManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.materials = options.materials || defaultMaterials;
    this.initialCapacity = options.initialCapacity || DEFAULT_INITIAL_CAPACITY;
    this.buffers = new Map();
    this.coordToRef = new Map();
    this.chunkToCoords = new Map();
    this.pendingAO = new Map();
    this.queuedCoordToChunk = new Map();
    this.mutationQueue = [];
    this.mutationStats = {
      queuedBlocks: 0,
      lastProcessedBlocks: 0,
      lastFlushMs: 0
    };
  }

  getRenderKey(type) {
    return type;
  }

  getOrCreateBuffer(type) {
    const renderKey = this.getRenderKey(type);
    let buffer = this.buffers.get(renderKey);
    if (!buffer) {
      buffer = new TypeBuffer(this, renderKey, type, this.initialCapacity);
      this.buffers.set(renderKey, buffer);
      this.scene.add(buffer.mesh);
    }
    return buffer;
  }

  addVisibleBlock(coord, entry, chunkKey, renderData) {
    const type = typeof entry === 'string' ? entry : entry?.type;
    if (!type || type === 'air' || type === 'collider') return null;
    const props = getBlockProperties(type);
    if (!props.isRendered) return null;

    const existing = this.coordToRef.get(coord);
    if (existing) {
      this.updateVisibleBlock(coord, entry, renderData);
      return existing;
    }

    const buffer = this.getOrCreateBuffer(type);
    buffer.ensureCapacity(buffer.count + 1);

    const index = buffer.count;
    buffer.count++;
    buffer.mesh.count = buffer.count;
    buffer.coordToIndex.set(coord, index);
    buffer.indexToCoord[index] = coord;
    const ref = { renderKey: buffer.renderKey, index, chunkKey };
    this.coordToRef.set(coord, ref);

    if (!this.chunkToCoords.has(chunkKey)) this.chunkToCoords.set(chunkKey, new Set());
    this.chunkToCoords.get(chunkKey).add(coord);

    buffer.writeInstance(index, renderData);
    const pendingAO = this.pendingAO.get(coord);
    if (pendingAO) {
      buffer.updateAO(index, pendingAO.aoLow, pendingAO.aoHigh);
      this.pendingAO.delete(coord);
    }
    return ref;
  }

  updateVisibleBlock(coord, entry, renderData) {
    const ref = this.coordToRef.get(coord);
    if (!ref) return false;
    const type = typeof entry === 'string' ? entry : entry?.type;
    const renderKey = this.getRenderKey(type);
    if (renderKey !== ref.renderKey) {
      const oldChunkKey = ref.chunkKey;
      this.removeVisibleBlock(coord);
      this.addVisibleBlock(coord, entry, oldChunkKey, renderData);
      return true;
    }
    const buffer = this.buffers.get(ref.renderKey);
    if (!buffer) return false;
    buffer.writeInstance(ref.index, renderData);
    return true;
  }

  removeVisibleBlock(coord) {
    const ref = this.coordToRef.get(coord);
    if (!ref) return false;

    const buffer = this.buffers.get(ref.renderKey);
    if (!buffer) return false;

    const index = ref.index;
    const last = buffer.count - 1;
    const movedCoord = buffer.indexToCoord[last];

    if (index !== last) {
      buffer.copyInstance(last, index);
      buffer.indexToCoord[index] = movedCoord;
      buffer.coordToIndex.set(movedCoord, index);
      const movedRef = this.coordToRef.get(movedCoord);
      if (movedRef) movedRef.index = index;
    }

    buffer.coordToIndex.delete(coord);
    buffer.indexToCoord[last] = 0;
    buffer.count--;
    buffer.mesh.count = buffer.count;
    this.coordToRef.delete(coord);
    this.pendingAO.delete(coord);
    if (ref.chunkKey && this.chunkToCoords.has(ref.chunkKey)) {
      const coords = this.chunkToCoords.get(ref.chunkKey);
      coords.delete(coord);
      if (coords.size === 0) this.chunkToCoords.delete(ref.chunkKey);
    }

    if (buffer.count > 0) {
      buffer.markDirty(Math.min(index, buffer.count - 1));
    } else {
      buffer.mesh.instanceMatrix.needsUpdate = true;
      buffer.mesh.boundingSphere = null;
      buffer.mesh.boundingBox = null;
    }
    return true;
  }

  removeChunk(chunkKey) {
    this._purgeQueuedChunk(chunkKey);
    const coords = this.chunkToCoords.get(chunkKey);
    if (!coords) return 0;
    const list = Array.from(coords);
    let removed = 0;
    for (const coord of list) {
      if (this.removeVisibleBlock(coord)) removed++;
    }
    this.chunkToCoords.delete(chunkKey);
    return removed;
  }

  replaceChunkVisibleBlocks(chunkKey, meshDataArray) {
    this.removeChunk(chunkKey);
    return this.enqueueMeshDataForChunk(chunkKey, meshDataArray);
  }

  patchChunkVisibleBlocks(chunkKey, meshDataArray) {
    if (!Array.isArray(meshDataArray)) return { updated: 0, queued: 0, removed: 0 };

    this._purgeQueuedChunk(chunkKey);
    const nextCoords = new Set();
    let updated = 0;
    let queued = 0;

    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, count, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered || count === 0) continue;

      const missingEntries = [];
      for (const [coordText, sourceIndex] of Object.entries(instanceIndexMap || {})) {
        const coord = Number(coordText);
        nextCoords.add(coord);
        const matrix = matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE);
        const renderData = {
          matrix,
          aoLow: aoLow?.[sourceIndex] ?? 1,
          aoHigh: aoHigh?.[sourceIndex] ?? 1,
          orientation: orientation?.[sourceIndex] ?? 0
        };

        const ref = this.coordToRef.get(coord);
        if (ref) {
          this.updateVisibleBlock(coord, { type, orientation: renderData.orientation }, renderData);
          updated++;
        } else {
          missingEntries.push([coordText, sourceIndex]);
        }
      }

      if (missingEntries.length > 0) {
        this.mutationQueue.push({
          chunkKey,
          data,
          entries: missingEntries,
          cursor: 0
        });
        for (const [coordText] of missingEntries) {
          this.queuedCoordToChunk.set(Number(coordText), chunkKey);
        }
        queued += missingEntries.length;
      }
    }

    let removed = 0;
    const existingCoords = this.chunkToCoords.get(chunkKey);
    if (existingCoords) {
      for (const coord of Array.from(existingCoords)) {
        if (nextCoords.has(coord)) continue;
        if (this.removeVisibleBlock(coord)) removed++;
      }
    }

    this.mutationStats.queuedBlocks += queued;
    return { updated, queued, removed };
  }

  _purgeQueuedChunk(chunkKey) {
    if (this.mutationQueue.length === 0) return 0;
    let removed = 0;
    this.mutationQueue = this.mutationQueue.filter(task => {
      if (task.chunkKey !== chunkKey) return true;
      for (let i = task.cursor; i < task.entries.length; i++) {
        const coord = Number(task.entries[i][0]);
        this.queuedCoordToChunk.delete(coord);
        this.pendingAO.delete(coord);
      }
      removed += task.entries.length - task.cursor;
      return false;
    });
    this.mutationStats.queuedBlocks = Math.max(0, this.mutationStats.queuedBlocks - removed);
    return removed;
  }

  enqueueMeshDataForChunk(chunkKey, meshDataArray) {
    if (!Array.isArray(meshDataArray)) return 0;
    this._purgeQueuedChunk(chunkKey);

    let queued = 0;
    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, count, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered || count === 0) continue;

      const entries = Object.entries(instanceIndexMap || {});
      if (entries.length === 0) continue;
      this.mutationQueue.push({
        chunkKey,
        data,
        entries,
        cursor: 0
      });
      for (const [coordText] of entries) {
        this.queuedCoordToChunk.set(Number(coordText), chunkKey);
      }
      queued += entries.length;
    }

    this.mutationStats.queuedBlocks += queued;
    return queued;
  }

  flushMutationQueue(options = {}) {
    if (this.mutationQueue.length === 0) {
      this.mutationStats.lastProcessedBlocks = 0;
      this.mutationStats.lastFlushMs = 0;
      return { didWork: false, processedBlocks: 0, remainingBlocks: 0, elapsedMs: 0 };
    }

    const maxOps = Number.isFinite(options.maxOps) ? options.maxOps : DEFAULT_MUTATION_MAX_OPS;
    const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : DEFAULT_MUTATION_MAX_MS;
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    const start = now();
    let processedBlocks = 0;

    while (this.mutationQueue.length > 0 && processedBlocks < maxOps) {
      if (processedBlocks > 0 && now() - start >= maxMs) break;

      const task = this.mutationQueue[0];
      const { data, entries, chunkKey } = task;
      const { type, matrices, aoLow, aoHigh, orientation } = data;
      const [coordText, sourceIndex] = entries[task.cursor];
      const coord = Number(coordText);
      const matrix = matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE);

      this.addVisibleBlock(coord, { type, orientation: orientation?.[sourceIndex] || 0 }, chunkKey, {
        matrix,
        aoLow: aoLow?.[sourceIndex] ?? 1,
        aoHigh: aoHigh?.[sourceIndex] ?? 1,
        orientation: orientation?.[sourceIndex] ?? 0
      });
      this.queuedCoordToChunk.delete(coord);

      task.cursor++;
      processedBlocks++;
      this.mutationStats.queuedBlocks = Math.max(0, this.mutationStats.queuedBlocks - 1);
      if (task.cursor >= entries.length) {
        this.mutationQueue.shift();
      }
    }

    const elapsedMs = now() - start;
    this.mutationStats.lastProcessedBlocks = processedBlocks;
    this.mutationStats.lastFlushMs = elapsedMs;
    return {
      didWork: processedBlocks > 0,
      processedBlocks,
      remainingBlocks: this.mutationStats.queuedBlocks,
      elapsedMs
    };
  }

  addMeshDataForChunk(chunkKey, meshDataArray) {
    if (!Array.isArray(meshDataArray)) return 0;
    let added = 0;
    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, count, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered || count === 0) continue;

      const entries = Object.entries(instanceIndexMap || {});
      for (const [coordText, sourceIndex] of entries) {
        const coord = Number(coordText);
        const matrix = matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE);
        this.addVisibleBlock(coord, { type, orientation: orientation?.[sourceIndex] || 0 }, chunkKey, {
          matrix,
          aoLow: aoLow?.[sourceIndex] ?? 1,
          aoHigh: aoHigh?.[sourceIndex] ?? 1,
          orientation: orientation?.[sourceIndex] ?? 0
        });
        added++;
      }
    }
    return added;
  }

  updateAO(coord, aoLow, aoHigh) {
    const ref = this.coordToRef.get(coord);
    if (!ref) {
      if (this.queuedCoordToChunk.has(coord)) {
        this.pendingAO.set(coord, { aoLow, aoHigh });
      }
      return false;
    }
    const buffer = this.buffers.get(ref.renderKey);
    if (!buffer) return false;
    return buffer.updateAO(ref.index, aoLow, aoHigh);
  }

  resolveHit(hit) {
    const buffer = hit?.object?.userData?.globalBuffer;
    if (!buffer || hit.instanceId === undefined) return null;
    const coord = buffer.indexToCoord[hit.instanceId];
    if (!coord) return null;
    return { coord, ...decodeCoord(coord), type: buffer.type };
  }

  getRaycastTargets() {
    return Array.from(this.buffers.values())
      .filter(buffer => buffer.count > 0)
      .map(buffer => buffer.mesh);
  }

  dispose() {
    for (const buffer of this.buffers.values()) {
      buffer.dispose();
    }
    this.buffers.clear();
    this.coordToRef.clear();
    this.chunkToCoords.clear();
    this.pendingAO.clear();
    this.queuedCoordToChunk.clear();
    this.mutationQueue.length = 0;
    this.mutationStats.queuedBlocks = 0;
  }

  getStats() {
    return {
      buffers: this.buffers.size,
      renderedBlocks: this.coordToRef.size,
      queuedBlocks: this.mutationStats.queuedBlocks,
      queueTasks: this.mutationQueue.length,
      pendingAO: this.pendingAO.size,
      lastProcessedBlocks: this.mutationStats.lastProcessedBlocks,
      lastFlushMs: this.mutationStats.lastFlushMs
    };
  }
}
