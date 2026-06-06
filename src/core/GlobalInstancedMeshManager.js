import * as THREE from 'three';
import { getBlockProperties } from '../constants/BlockData.js';
import { materials as defaultMaterials } from './MaterialManager.js';
import { geomMap } from '../world/ChunkConsolidation.js';
import { decodeCoord } from '../utils/CoordEncoding.js';
import { recordChunkPerf } from '../utils/ChunkPerfMonitor.js';

const DEFAULT_INITIAL_CAPACITY = 256;
const DEFAULT_MUTATION_MAX_OPS = 600;
const DEFAULT_MUTATION_MAX_MS = 2;
const DISPOSAL_GRACE_FRAMES = 2;
const MATRIX_STRIDE = 16;

const isGlassType = (type) => typeof type === 'string' && type.includes('glass');
const isSolidShadowCaster = (props) => props.isSolid && props.isRendered !== false;

function copyMatrixArray(source, sourceIndex, target, targetIndex) {
  target.set(
    source.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE),
    targetIndex * MATRIX_STRIDE
  );
}

function copyChestState(sourceStates, fromIndex, targetStates, toIndex) {
  if (!sourceStates || !targetStates) return;
  const state = sourceStates[fromIndex];
  if (state) {
    targetStates[toIndex] = { ...state };
  } else {
    delete targetStates[toIndex];
  }
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
    this.dirtyStart = Infinity;
    this.dirtyEnd = -1;
    this.dirtyMatrix = false;
    this.dirtyAO = false;
    this.dirtyBounds = false;
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
    const oldChestStates = oldMesh.userData?.chests || null;

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
    if (oldChestStates && this.mesh.userData?.chests) {
      for (let i = 0; i < this.count; i++) {
        copyChestState(oldChestStates, i, this.mesh.userData.chests, i);
      }
    }

    this.mesh.count = this.count;
    // 标记全量范围为 dirty，让 commitDirty 的 addUpdateRange 覆盖整个 buffer，
    // 避免后续 addUpdateRange 只上传部分范围导致旧数据丢失（闪烁）
    if (this.count > 0) {
      this.dirtyStart = 0;
      this.dirtyEnd = this.count - 1;
      this.dirtyMatrix = true;
      this.dirtyAO = true;
      this.dirtyBounds = true;
    }

    this.manager.scene.add(this.mesh);
    this.manager._deferMeshDisposal(oldMesh, oldGeometry, this.type);
  }

  markDirty(index, options = {}) {
    const matrix = options.matrix !== false;
    const ao = options.ao !== false;
    const bounds = options.bounds !== false;
    this.dirtyStart = Math.min(this.dirtyStart, index);
    this.dirtyEnd = Math.max(this.dirtyEnd, index);
    this.dirtyMatrix = this.dirtyMatrix || matrix;
    this.dirtyAO = this.dirtyAO || ao;
    this.dirtyBounds = this.dirtyBounds || bounds;
  }

  commitDirty() {
    if (this.dirtyEnd < this.dirtyStart) return false;

    if (this.dirtyMatrix) {
      const offset = this.dirtyStart * MATRIX_STRIDE;
      const count = (this.dirtyEnd - this.dirtyStart + 1) * MATRIX_STRIDE;
      this.mesh.instanceMatrix.addUpdateRange(offset, count);
      this.mesh.instanceMatrix.needsUpdate = true;
    }

    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    const orientation = this.mesh.geometry.getAttribute('aOrientation');
    if (this.dirtyAO) {
      if (aoLow) aoLow.needsUpdate = true;
      if (aoHigh) aoHigh.needsUpdate = true;
      if (orientation) orientation.needsUpdate = true;
    }
    if (this.dirtyBounds) {
      this.mesh.boundingSphere = null;
      this.mesh.boundingBox = null;
    }

    this.dirtyStart = Infinity;
    this.dirtyEnd = -1;
    this.dirtyMatrix = false;
    this.dirtyAO = false;
    this.dirtyBounds = false;
    return true;
  }

  writeInstance(index, data, options = {}) {
    this.mesh.instanceMatrix.array.set(data.matrix, index * MATRIX_STRIDE);
    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    const orientation = this.mesh.geometry.getAttribute('aOrientation');
    if (aoLow) aoLow.array[index] = data.aoLow ?? 1;
    if (aoHigh) aoHigh.array[index] = data.aoHigh ?? 1;
    if (orientation) orientation.array[index] = data.orientation ?? 0;
    this.markDirty(index);
    if (options.commit !== false) this.commitDirty();
  }

  copyInstance(fromIndex, toIndex) {
    copyMatrixArray(this.mesh.instanceMatrix.array, fromIndex, this.mesh.instanceMatrix.array, toIndex);
    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    const orientation = this.mesh.geometry.getAttribute('aOrientation');
    if (aoLow) aoLow.array[toIndex] = aoLow.array[fromIndex];
    if (aoHigh) aoHigh.array[toIndex] = aoHigh.array[fromIndex];
    if (orientation) orientation.array[toIndex] = orientation.array[fromIndex];
    copyChestState(this.mesh.userData?.chests, fromIndex, this.mesh.userData?.chests, toIndex);
  }

  updateAO(index, aoLowValue, aoHighValue, options = {}) {
    const aoLow = this.mesh.geometry.getAttribute('aAoLow');
    const aoHigh = this.mesh.geometry.getAttribute('aAoHigh');
    if (!aoLow || !aoHigh) return false;
    aoLow.array[index] = aoLowValue;
    aoHigh.array[index] = aoHighValue;
    this.markDirty(index, { matrix: false, ao: true, bounds: false });
    if (options.commit !== false) this.commitDirty();
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
    this.typeCapacityHints = options.typeCapacityHints || null;
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
    this._pendingDisposal = [];
    this._frameCounter = 0;
    this.stagingZone = new Map();
    this._deferredChunkRemovals = [];
  }

  getRenderKey(type) {
    return type;
  }

  getOrCreateBuffer(type) {
    const renderKey = this.getRenderKey(type);
    let buffer = this.buffers.get(renderKey);
    if (!buffer) {
      const capacity = this.typeCapacityHints?.get(type) || this.initialCapacity;
      buffer = new TypeBuffer(this, renderKey, type, capacity);
      this.buffers.set(renderKey, buffer);
      this.scene.add(buffer.mesh);
    }
    return buffer;
  }

  addVisibleBlock(coord, entry, chunkKey, renderData, options = {}) {
    const type = typeof entry === 'string' ? entry : entry?.type;
    if (!type || type === 'air' || type === 'collider') return null;
    const props = getBlockProperties(type);
    if (!props.isRendered) return null;

    const existing = this.coordToRef.get(coord);
    if (existing) {
      this.updateVisibleBlock(coord, entry, renderData, options);
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

    if (type === 'chest' && buffer.mesh.userData?.chests) {
      buffer.mesh.userData.chests[index] = { open: false };
    }

    buffer.writeInstance(index, renderData, options);
    const pendingAO = this.pendingAO.get(coord);
    if (pendingAO) {
      buffer.updateAO(index, pendingAO.aoLow, pendingAO.aoHigh, options);
      this.pendingAO.delete(coord);
    }
    return ref;
  }

  updateVisibleBlock(coord, entry, renderData, options = {}) {
    const ref = this.coordToRef.get(coord);
    if (!ref) return false;
    const type = typeof entry === 'string' ? entry : entry?.type;
    const renderKey = this.getRenderKey(type);
    if (renderKey !== ref.renderKey) {
      const oldChunkKey = ref.chunkKey;
      this.removeVisibleBlock(coord, options);
      this.addVisibleBlock(coord, entry, oldChunkKey, renderData, options);
      return true;
    }
    const buffer = this.buffers.get(ref.renderKey);
    if (!buffer) return false;
    buffer.writeInstance(ref.index, renderData, options);
    return true;
  }

  removeVisibleBlock(coord, options = {}) {
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

    if (buffer.mesh.userData?.chests) {
      delete buffer.mesh.userData.chests[last];
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
    if (options.commit !== false) buffer.commitDirty();
    return true;
  }

  removeChunk(chunkKey) {
    this.removeStagedChunk(chunkKey);
    this._purgeQueuedChunk(chunkKey);
    const coords = this.chunkToCoords.get(chunkKey);
    if (!coords) return 0;
    const list = Array.from(coords);
    let removed = 0;
    for (const coord of list) {
      if (this.removeVisibleBlock(coord, { commit: false })) removed++;
    }
    this.chunkToCoords.delete(chunkKey);
    this.commitDirtyBuffers();
    return removed;
  }

  deferRemoveChunk(chunkKey) {
    this.removeStagedChunk(chunkKey);
    this._purgeQueuedChunk(chunkKey);
    if (this.chunkToCoords.has(chunkKey)) {
      this._deferredChunkRemovals.push(chunkKey);
    }
  }

  _flushDeferredChunkRemovals() {
    if (this._deferredChunkRemovals.length === 0) return 0;
    let removed = 0;
    for (const chunkKey of this._deferredChunkRemovals) {
      const coords = this.chunkToCoords.get(chunkKey);
      if (!coords) continue;
      for (const coord of coords) {
        if (this.removeVisibleBlock(coord, { commit: false })) removed++;
      }
      this.chunkToCoords.delete(chunkKey);
    }
    this._deferredChunkRemovals.length = 0;
    return removed;
  }

  replaceChunkVisibleBlocks(chunkKey, meshDataArray) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const removeCount = this.removeChunk(chunkKey);
    const t1 = globalThis.performance?.now?.() ?? Date.now();
    const queued = this.enqueueMeshDataForChunk(chunkKey, meshDataArray);
    const t2 = globalThis.performance?.now?.() ?? Date.now();

    recordChunkPerf('global-instanced-mesh.replace-chunk', t2 - t0, {
      chunkKey,
      removeMs: t1 - t0,
      enqueueMs: t2 - t1,
      removedBlocks: removeCount,
      queuedBlocks: queued,
      meshGroups: meshDataArray?.length || 0
    }, { thresholdMs: 0 });

    return queued;
  }

  patchChunkVisibleBlocks(chunkKey, meshDataArray) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    if (!Array.isArray(meshDataArray)) return { updated: 0, queued: 0, removed: 0 };

    this._purgeQueuedChunk(chunkKey);

    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered) continue;
      let missingCount = 0;
      for (const coordText of Object.keys(instanceIndexMap || {})) {
        if (!this.coordToRef.has(Number(coordText))) missingCount++;
      }
      if (missingCount > 0) {
        const buffer = this.getOrCreateBuffer(type);
        buffer.ensureCapacity(buffer.count + missingCount);
      }
    }

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
          this.updateVisibleBlock(coord, { type, orientation: renderData.orientation }, renderData, { commit: false });
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
        if (this.removeVisibleBlock(coord, { commit: false })) removed++;
      }
    }

    this.mutationStats.queuedBlocks += queued;
    this.commitDirtyBuffers();
    const t1 = globalThis.performance?.now?.() ?? Date.now();

    recordChunkPerf('global-instanced-mesh.patch-chunk', t1 - t0, {
      chunkKey,
      updated,
      queued,
      removed,
      meshGroups: meshDataArray.length
    }, { thresholdMs: 0 });

    return { updated, queued, removed };
  }

  /**
   * 增量 delta patch：只处理新增/删除/更新的坐标，不扫描全量 chunk 可见集
   * @param {string} chunkKey - "cx,cz"
   * @param {object} delta - { added: [{coord, entry, renderData}], removed: [coord], updated: [{coord, entry, renderData}] }
   * @param {object} options - { maxOps?: number, maxMs?: number }
   * @returns {object} { added: number, removed: number, updated: number }
   */
  applyChunkDelta(chunkKey, delta, options = {}) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    if (!delta) return { added: 0, removed: 0, updated: 0 };

    const maxOps = Number.isFinite(options.maxOps) ? options.maxOps : 200;
    const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : 1.5;

    let added = 0;
    let removed = 0;
    let updated = 0;
    let ops = 0;
    const start = t0;

    // 处理新增
    if (delta.added) {
      for (const item of delta.added) {
        if (ops >= maxOps || (globalThis.performance?.now?.() ?? Date.now()) - start >= maxMs) break;
        this.addVisibleBlock(item.coord, item.entry, chunkKey, item.renderData, { commit: false });
        added++;
        ops++;
      }
    }

    // 处理更新
    if (delta.updated) {
      for (const item of delta.updated) {
        if (ops >= maxOps || (globalThis.performance?.now?.() ?? Date.now()) - start >= maxMs) break;
        this.updateVisibleBlock(item.coord, item.entry, item.renderData, { commit: false });
        updated++;
        ops++;
      }
    }

    // 处理删除
    if (delta.removed) {
      for (const coord of delta.removed) {
        if (ops >= maxOps || (globalThis.performance?.now?.() ?? Date.now()) - start >= maxMs) break;
        this.removeVisibleBlock(coord, { commit: false });
        removed++;
        ops++;
      }
    }

    this.commitDirtyBuffers();
    const t1 = globalThis.performance?.now?.() ?? Date.now();

    recordChunkPerf('global-instanced-mesh.delta-patch', t1 - t0, {
      chunkKey,
      added,
      removed,
      updated,
      totalOps: added + removed + updated
    }, { thresholdMs: 0 });

    return { added, removed, updated, remaining: (delta.added?.length || 0) - added + (delta.updated?.length || 0) - updated + (delta.removed?.length || 0) - removed };
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

  _getChunkDistance(chunkKey, playerCx, playerCz) {
    if (!Number.isFinite(playerCx) || !Number.isFinite(playerCz) || typeof chunkKey !== 'string') {
      return Infinity;
    }
    const [cxText, czText] = chunkKey.split(',');
    const cx = Number(cxText);
    const cz = Number(czText);
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return Infinity;
    return Math.abs(cx - playerCx) + Math.abs(cz - playerCz);
  }

  _selectNextMutationTaskIndex(playerCx, playerCz) {
    if (!Number.isFinite(playerCx) || !Number.isFinite(playerCz) || this.mutationQueue.length <= 1) {
      return 0;
    }

    let bestIndex = 0;
    let bestDistance = this._getChunkDistance(this.mutationQueue[0]?.chunkKey, playerCx, playerCz);
    for (let i = 1; i < this.mutationQueue.length; i++) {
      const distance = this._getChunkDistance(this.mutationQueue[i]?.chunkKey, playerCx, playerCz);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  flushMutationQueue(options = {}) {
    this.flushDisposal();

    const maxOps = Number.isFinite(options.maxOps) ? options.maxOps : DEFAULT_MUTATION_MAX_OPS;
    const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : DEFAULT_MUTATION_MAX_MS;
    const playerCx = Number.isFinite(options.playerCx) ? options.playerCx : null;
    const playerCz = Number.isFinite(options.playerCz) ? options.playerCz : null;
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    const start = now();
    let processedBlocks = 0;

    while (this.mutationQueue.length > 0 && processedBlocks < maxOps) {
      if (processedBlocks > 0 && now() - start >= maxMs) break;

      const taskIndex = this._selectNextMutationTaskIndex(playerCx, playerCz);
      const task = this.mutationQueue[taskIndex];
      const { data, entries, chunkKey } = task;
      const { type, matrices, aoLow, aoHigh, orientation } = data;

      while (processedBlocks < maxOps && now() - start < maxMs && task.cursor < entries.length) {
        const [coordText, sourceIndex] = entries[task.cursor];
        const coord = Number(coordText);
        const matrix = matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE);

        this.addVisibleBlock(coord, { type, orientation: orientation?.[sourceIndex] || 0 }, chunkKey, {
          matrix,
          aoLow: aoLow?.[sourceIndex] ?? 1,
          aoHigh: aoHigh?.[sourceIndex] ?? 1,
          orientation: orientation?.[sourceIndex] ?? 0
        }, { commit: false });
        this.queuedCoordToChunk.delete(coord);

        task.cursor++;
        processedBlocks++;
        this.mutationStats.queuedBlocks = Math.max(0, this.mutationStats.queuedBlocks - 1);
      }

      if (task.cursor >= entries.length) {
        this.mutationQueue.splice(taskIndex, 1);
      }
    }

    const deferredRemoved = this._flushDeferredChunkRemovals();
    this.commitDirtyBuffers();
    const elapsedMs = now() - start;
    this.mutationStats.lastProcessedBlocks = processedBlocks;
    this.mutationStats.lastFlushMs = elapsedMs;
    return {
      didWork: processedBlocks > 0 || deferredRemoved > 0,
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

  updateAO(coord, aoLow, aoHigh, options = {}) {
    const ref = this.coordToRef.get(coord);
    if (!ref) {
      if (this.queuedCoordToChunk.has(coord)) {
        this.pendingAO.set(coord, { aoLow, aoHigh });
      }
      return false;
    }
    const buffer = this.buffers.get(ref.renderKey);
    if (!buffer) return false;
    return buffer.updateAO(ref.index, aoLow, aoHigh, options);
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

  commitDirtyBuffers() {
    let committed = 0;
    for (const buffer of this.buffers.values()) {
      if (buffer.commitDirty()) committed++;
    }
    return committed;
  }

  _deferMeshDisposal(mesh, geometry, type) {
    mesh.visible = false;
    this._pendingDisposal.push({ mesh, geometry, type, frame: this._frameCounter });
  }

  flushDisposal() {
    this._frameCounter++;
    if (this._pendingDisposal.length === 0) return;
    const threshold = this._frameCounter - DISPOSAL_GRACE_FRAMES;
    let i = 0;
    while (i < this._pendingDisposal.length) {
      const entry = this._pendingDisposal[i];
      if (entry.frame <= threshold) {
        this.scene.remove(entry.mesh);
        const sharedGeo = geomMap[getBlockProperties(entry.type).geometryType] || geomMap.default;
        if (entry.geometry && entry.geometry !== sharedGeo) {
          entry.geometry.dispose();
        }
        this._pendingDisposal.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  dispose() {
    for (const buffer of this.buffers.values()) {
      buffer.dispose();
    }
    for (const entry of this._pendingDisposal) {
      this.scene.remove(entry.mesh);
      const sharedGeo = geomMap[getBlockProperties(entry.type).geometryType] || geomMap.default;
      if (entry.geometry && entry.geometry !== sharedGeo) {
        entry.geometry.dispose();
      }
    }
    this._pendingDisposal.length = 0;
    this.buffers.clear();
    this.coordToRef.clear();
    this.chunkToCoords.clear();
    this.pendingAO.clear();
    this.queuedCoordToChunk.clear();
    this.mutationQueue.length = 0;
    this.mutationStats.queuedBlocks = 0;
  }

  // ==================== Staging Zone ====================

  stageMeshDataForChunk(chunkKey, meshDataArray) {
    if (!Array.isArray(meshDataArray)) return 0;
    this._purgeQueuedChunk(chunkKey);
    this.removeStagedChunk(chunkKey);

    let blockCount = 0;
    const validData = [];
    for (const data of meshDataArray) {
      if (data.blockTypes) continue;
      const { type, count, instanceIndexMap } = data;
      const props = getBlockProperties(type);
      if (!props.isRendered || count === 0) continue;
      const entries = Object.entries(instanceIndexMap || {});
      if (entries.length === 0) continue;
      validData.push(data);
      blockCount += entries.length;
    }
    if (blockCount === 0) return 0;
    this.stagingZone.set(chunkKey, { meshDataArray: validData, blockCount, prepareState: null });
    return blockCount;
  }

  prepareStagedBlocks(options = {}) {
    const maxBlocks = options.maxBlocks || 600;
    const maxMs = options.maxMs || 2;
    const perf = () => globalThis.performance?.now?.() ?? Date.now();
    const start = perf();
    let processed = 0;

    for (const [, staged] of this.stagingZone) {
      if (processed >= maxBlocks || perf() - start >= maxMs) break;
      if (!staged.prepareState) {
        this._initPrepareState(staged);
      }
      const ps = staged.prepareState;
      if (ps.complete) continue;

      while (ps.dataCursor < staged.meshDataArray.length && processed < maxBlocks && perf() - start < maxMs) {
        const data = staged.meshDataArray[ps.dataCursor];
        const { type, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;
        const renderKey = this.getRenderKey(type);
        const entries = Object.entries(instanceIndexMap || {});
        const batch = ps.compactBatch.get(renderKey);
        if (!batch) { ps.dataCursor++; ps.entryCursor = 0; continue; }

        while (ps.entryCursor < entries.length && processed < maxBlocks && perf() - start < maxMs) {
          const [coordText, sourceIndex] = entries[ps.entryCursor];
          const coord = Number(coordText);

          if (ps.seenCoords.has(coord)) { ps.entryCursor++; continue; }
          ps.seenCoords.add(coord);

          const writePos = batch.cursor;
          batch.coords[writePos] = coord;
          batch.matrices.set(
            matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE),
            writePos * MATRIX_STRIDE
          );
          batch.aoLow[writePos] = aoLow?.[sourceIndex] ?? 1;
          batch.aoHigh[writePos] = aoHigh?.[sourceIndex] ?? 1;
          batch.orientation[writePos] = orientation?.[sourceIndex] ?? 0;
          batch.cursor++;

          ps.entryCursor++;
          processed++;
        }

        if (ps.entryCursor >= entries.length) {
          ps.dataCursor++;
          ps.entryCursor = 0;
        }
      }

      if (ps.dataCursor >= staged.meshDataArray.length) {
        ps.complete = true;
        staged.meshDataArray = null;
      }
    }
    return processed;
  }

  _initPrepareState(staged) {
    const typeCounts = new Map();
    for (const data of staged.meshDataArray) {
      const renderKey = this.getRenderKey(data.type);
      const entries = Object.entries(data.instanceIndexMap || {});
      typeCounts.set(renderKey, (typeCounts.get(renderKey) || 0) + entries.length);
    }

    const compactBatch = new Map();
    for (const [renderKey, count] of typeCounts) {
      compactBatch.set(renderKey, {
        type: renderKey,
        coords: new Array(count),
        matrices: new Float32Array(count * MATRIX_STRIDE),
        aoLow: new Float32Array(count),
        aoHigh: new Float32Array(count),
        orientation: new Float32Array(count),
        count,
        cursor: 0
      });
    }

    staged.prepareState = { compactBatch, dataCursor: 0, entryCursor: 0, complete: false, seenCoords: new Set() };
  }

  publishPreparedChunk(chunkKey) {
    const staged = this.stagingZone.get(chunkKey);
    if (!staged || !staged.prepareState?.complete) return false;

    const ps = staged.prepareState;
    const _pubTypes = [];

    if (!this.chunkToCoords.has(chunkKey)) this.chunkToCoords.set(chunkKey, new Set());
    const chunkCoords = this.chunkToCoords.get(chunkKey);

    for (const [, batch] of ps.compactBatch) {
      const batchCount = batch.cursor;
      if (batchCount === 0) continue;
      _pubTypes.push(`${batch.type}:+${batchCount}`);

      const buffer = this.getOrCreateBuffer(batch.type);
      const appendSourceIndices = [];

      for (let i = 0; i < batchCount; i++) {
        const coord = batch.coords[i];
        const renderData = {
          matrix: batch.matrices.subarray(i * MATRIX_STRIDE, i * MATRIX_STRIDE + MATRIX_STRIDE),
          aoLow: batch.aoLow?.[i] ?? 1,
          aoHigh: batch.aoHigh?.[i] ?? 1,
          orientation: batch.orientation?.[i] ?? 0
        };
        if (this.coordToRef.has(coord)) {
          this.updateVisibleBlock(coord, { type: batch.type, orientation: renderData.orientation }, renderData, { commit: false });
          const ref = this.coordToRef.get(coord);
          if (ref && ref.chunkKey !== chunkKey) {
            const previousCoords = this.chunkToCoords.get(ref.chunkKey);
            previousCoords?.delete(coord);
            if (previousCoords?.size === 0) this.chunkToCoords.delete(ref.chunkKey);
            ref.chunkKey = chunkKey;
          }
          chunkCoords.add(coord);
        } else {
          appendSourceIndices.push(i);
        }
      }

      const appendCount = appendSourceIndices.length;
      if (appendCount === 0) continue;

      buffer.ensureCapacity(buffer.count + appendCount);

      const baseIndex = buffer.count;

      const attrAoLow = buffer.mesh.geometry.getAttribute('aAoLow');
      const attrAoHigh = buffer.mesh.geometry.getAttribute('aAoHigh');
      const attrOrientation = buffer.mesh.geometry.getAttribute('aOrientation');
      for (let i = 0; i < appendCount; i++) {
        const sourceIndex = appendSourceIndices[i];
        const coord = batch.coords[sourceIndex];
        const writeIndex = baseIndex + i;
        buffer.mesh.instanceMatrix.array.set(
          batch.matrices.subarray(sourceIndex * MATRIX_STRIDE, sourceIndex * MATRIX_STRIDE + MATRIX_STRIDE),
          writeIndex * MATRIX_STRIDE
        );
        if (attrAoLow) attrAoLow.array[writeIndex] = batch.aoLow?.[sourceIndex] ?? 1;
        if (attrAoHigh) attrAoHigh.array[writeIndex] = batch.aoHigh?.[sourceIndex] ?? 1;
        if (attrOrientation) attrOrientation.array[writeIndex] = batch.orientation?.[sourceIndex] ?? 0;
        buffer.coordToIndex.set(coord, writeIndex);
        buffer.indexToCoord[writeIndex] = coord;
        this.coordToRef.set(coord, { renderKey: batch.type, index: writeIndex, chunkKey });
        chunkCoords.add(coord);
      }

      buffer.count += appendCount;
      buffer.mesh.count = buffer.count;

      buffer.dirtyStart = Math.min(buffer.dirtyStart, baseIndex);
      buffer.dirtyEnd = Math.max(buffer.dirtyEnd, baseIndex + appendCount - 1);
      buffer.dirtyMatrix = true;
      buffer.dirtyAO = true;
      buffer.dirtyBounds = true;
    }

    this.commitDirtyBuffers();
    this.stagingZone.delete(chunkKey);
    return true;
  }

  publishNextReadyChunk(playerCx, playerCz) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const [chunkKey, staged] of this.stagingZone) {
      if (!staged.prepareState?.complete) continue;
      const dist = this._getChunkDistance(chunkKey, playerCx, playerCz);
      if (dist < bestDist) { bestDist = dist; bestKey = chunkKey; }
    }
    if (!bestKey) return null;
    const success = this.publishPreparedChunk(bestKey);
    return success ? bestKey : null;
  }

  removeStagedChunk(chunkKey) {
    this.stagingZone.delete(chunkKey);
  }

  getStagedChunkKeys() {
    return Array.from(this.stagingZone.keys());
  }

  getStagedBlockCount(chunkKey) {
    return this.stagingZone.get(chunkKey)?.blockCount || 0;
  }

  isPrepareComplete(chunkKey) {
    return this.stagingZone.get(chunkKey)?.prepareState?.complete || false;
  }

  getStats() {
    return {
      buffers: this.buffers.size,
      renderedBlocks: this.coordToRef.size,
      queuedBlocks: this.mutationStats.queuedBlocks,
      queueTasks: this.mutationQueue.length,
      pendingAO: this.pendingAO.size,
      stagedChunks: this.stagingZone.size,
      lastProcessedBlocks: this.mutationStats.lastProcessedBlocks,
      lastFlushMs: this.mutationStats.lastFlushMs
    };
  }
}
