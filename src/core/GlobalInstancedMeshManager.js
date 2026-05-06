import * as THREE from 'three';
import { getBlockProperties } from '../constants/BlockData.js';
import { materials as defaultMaterials } from './MaterialManager.js';
import { geomMap } from '../world/ChunkConsolidation.js';
import { decodeCoord } from '../utils/CoordEncoding.js';
import { recordChunkPerf } from '../utils/ChunkPerfMonitor.js';

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
      if (typeof this.mesh.instanceMatrix.addUpdateRange === 'function') {
        this.mesh.instanceMatrix.addUpdateRange(offset, count);
      } else {
        this.mesh.instanceMatrix.updateRange.offset = offset;
        this.mesh.instanceMatrix.updateRange.count = count;
      }
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
    if (this.mutationQueue.length === 0) {
      this.mutationStats.lastProcessedBlocks = 0;
      this.mutationStats.lastFlushMs = 0;
      return { didWork: false, processedBlocks: 0, remainingBlocks: 0, elapsedMs: 0 };
    }

    const maxOps = Number.isFinite(options.maxOps) ? options.maxOps : DEFAULT_MUTATION_MAX_OPS;
    const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : DEFAULT_MUTATION_MAX_MS;
    const playerCx = Number.isFinite(options.playerCx) ? options.playerCx : null;
    const playerCz = Number.isFinite(options.playerCz) ? options.playerCz : null;
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    const start = now();
    let processedBlocks = 0;

    while (this.mutationQueue.length > 0 && processedBlocks < maxOps) {
      if (processedBlocks > 0 && now() - start >= maxMs) break;

      // 优化：按距离选出最近的任务后，批量消费该任务的多个条目，
      // 避免每处理一个 block 就重新扫描整个队列
      const taskIndex = this._selectNextMutationTaskIndex(playerCx, playerCz);
      const task = this.mutationQueue[taskIndex];
      const { data, entries, chunkKey } = task;
      const { type, matrices, aoLow, aoHigh, orientation } = data;

      // 批量消费当前任务的条目，直到预算耗尽或任务完成
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

      // 当前任务已消费完毕或预算耗尽，移除已完成的任务
      if (task.cursor >= entries.length) {
        this.mutationQueue.splice(taskIndex, 1);
      }
    }

    this.commitDirtyBuffers();
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
