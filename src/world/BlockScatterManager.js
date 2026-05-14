// src/world/BlockScatterManager.js
/**
 * 方块分发管理器 — 将 Worker 返回的 scatteredBlocks 按坐标分发到对应 chunk
 * 职责：
 * 1. 接收 Worker 返回的 scatteredBlocks 数组
 * 2. 按 (floor(x/CHUNK_SIZE), floor(z/CHUNK_SIZE)) 分发到对应 chunk 的 buffer
 * 3. 跟踪每个 chunk 的加载状态
 * 4. 通知就绪的 chunk 进行渲染
 */
import { CHUNK_SIZE } from './ChunkConsolidation.js';
import { coordKeyToCode, encodeCoord } from '../utils/CoordEncoding.js';
import { recordChunkPerf } from '../utils/ChunkPerfMonitor.js';

export class BlockScatterManager {
  constructor(world) {
    this.world = world;
    // chunkKey → { blocks: [], loading: true/false, sourceWorkers: Set }
    this.chunkBuffers = new Map();
    // chunkKey → 延迟跨 chunk 补刷数据。首帧不消费，runtime idle 时分批补刷。
    this.pendingCrossChunkPatchBuffers = new Map();
    // 跨 chunk 方块渲染开关，关闭时跨 chunk 的方块会被直接丢弃
    this.skipCrossChunk = false;
    // 就绪但尚未被 flush 消费的 chunk keys，避免全表扫描 buffer
    this.pendingReadyChunkKeys = new Set();
  }

  _getOrCreateBuffer(map, chunkKey) {
    let buffer = map.get(chunkKey);
    if (!buffer) {
      buffer = {
        blocks: [],
        meshData: null,
        ready: false,
        sourceWorkers: new Set(),
        visibleBlockKeys: new Set(),
        visibleBlocks: [],
        structureCenters: null,
        lastUpdatedAt: 0,
        retryCount: 0
      };
      map.set(chunkKey, buffer);
    }
    return buffer;
  }

  _removeBlockFromBuffer(buffer, code) {
    if (!buffer) return 0;
    const before = buffer.blocks.length;
    if (before === 0) {
      buffer.visibleBlockKeys?.delete?.(code);
      if (Array.isArray(buffer.visibleBlocks) && buffer.visibleBlocks.length > 0) {
        buffer.visibleBlocks = buffer.visibleBlocks.filter((block) => encodeCoord(block.x, block.y, block.z) !== code);
      }
      return 0;
    }

    buffer.blocks = buffer.blocks.filter((block) => encodeCoord(block.x, block.y, block.z) !== code);
    buffer.visibleBlockKeys?.delete?.(code);
    if (Array.isArray(buffer.visibleBlocks) && buffer.visibleBlocks.length > 0) {
      buffer.visibleBlocks = buffer.visibleBlocks.filter((block) => encodeCoord(block.x, block.y, block.z) !== code);
    }
    return before - buffer.blocks.length;
  }

  _markTouchedReadyKeys(touchedKeys) {
    for (const key of touchedKeys) {
      if (this.chunkBuffers.has(key)) {
        this.pendingReadyChunkKeys.add(key);
      }
    }
  }

  _mergeStructureCentersIntoTouchedBuffers(touchedKeys, structureCenters) {
    if (structureCenters?.length > 0) {
      for (const key of touchedKeys) {
        const buffer = this.chunkBuffers.get(key) || this.pendingCrossChunkPatchBuffers.get(key);
        if (buffer) {
          buffer.structureCenters = this._mergeStructureCenters(buffer.structureCenters, structureCenters);
        }
      }
    }
  }

  _scatterWithRouting(workerResult) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const { cx, cz, structureCenters, routing } = workerResult;
    const touchedKeys = new Set();
    const ownChunk = routing?.ownChunk;
    const ownKey = ownChunk?.chunkKey || `${cx},${cz}`;
    const ownBuffer = this._getOrCreateBuffer(this.chunkBuffers, ownKey);
    ownBuffer.blocks = Array.isArray(ownChunk?.blockDataBlocks) ? [...ownChunk.blockDataBlocks] : [];
    ownBuffer.visibleBlocks = Array.isArray(ownChunk?.visibleBlocks) ? [...ownChunk.visibleBlocks] : [];
    ownBuffer.visibleBlockKeys = new Set(ownBuffer.visibleBlocks.map(block => encodeCoord(block.x, block.y, block.z)));
    ownBuffer.meshData = Array.isArray(ownChunk?.meshData) ? ownChunk.meshData : null;
    ownBuffer.ready = true;
    ownBuffer.sourceWorkers.add(`${cx},${cz}`);
    ownBuffer.lastUpdatedAt = globalThis.performance?.now?.() ?? Date.now();
    touchedKeys.add(ownKey);

    for (const entry of routing?.overflowChunks || []) {
      const chunkKey = entry.chunkKey;
      if (!chunkKey) continue;
      if (this.skipCrossChunk && chunkKey !== ownKey) continue;

      const buffer = this._getOrCreateBuffer(this.pendingCrossChunkPatchBuffers, chunkKey);
      const inputBlocks = Array.isArray(entry.blockDataBlocks) ? entry.blockDataBlocks : [];
      const inputVisibleBlocks = Array.isArray(entry.visibleBlocks) ? entry.visibleBlocks : [];

      for (const block of inputBlocks) {
        const existingChunk = this.world.chunks.get(chunkKey);
        if (existingChunk?.isReady && existingChunk.hasBlockEntry?.(block.x, block.y, block.z)) {
          continue;
        }
        buffer.blocks.push(block);
      }

      if (inputVisibleBlocks.length > 0) {
        buffer.visibleBlocks.push(...inputVisibleBlocks);
        for (const block of inputVisibleBlocks) {
          buffer.visibleBlockKeys.add(encodeCoord(block.x, block.y, block.z));
        }
      }
      buffer.sourceWorkers.add(`${cx},${cz}`);
      buffer.lastUpdatedAt = globalThis.performance?.now?.() ?? Date.now();
      touchedKeys.add(chunkKey);
    }

    this._mergeStructureCentersIntoTouchedBuffers(touchedKeys, structureCenters);
    this._markTouchedReadyKeys(touchedKeys);
    this.flushReadyChunks();
    const t1 = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('block-scatter.scatter', t1 - t0, {
      sourceChunkKey: `${cx},${cz}`,
      distributeMs: t1 - t0,
      flushReadyChunksMs: 0,
      blockDataBlocks: ownBuffer.blocks.length,
      scatteredBlocks: ownBuffer.visibleBlocks.length,
      touchedKeys: touchedKeys.size,
      chunkBuffers: this.chunkBuffers.size,
      pendingPatchBuffers: this.pendingCrossChunkPatchBuffers.size,
      pendingReadyKeys: this.pendingReadyChunkKeys.size,
      routingSchemaVersion: routing?.schemaVersion || 0
    });
  }

  invalidatePendingBlock(x, y, z) {
    const code = encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));
    const chunkCx = Math.floor(x / CHUNK_SIZE);
    const chunkCz = Math.floor(z / CHUNK_SIZE);
    const chunkKey = `${chunkCx},${chunkCz}`;

    let removed = 0;

    const chunkBuffer = this.chunkBuffers.get(chunkKey);
    if (chunkBuffer) {
      removed += this._removeBlockFromBuffer(chunkBuffer, code);
    }

    const pendingBuffer = this.pendingCrossChunkPatchBuffers.get(chunkKey);
    if (pendingBuffer) {
      removed += this._removeBlockFromBuffer(pendingBuffer, code);
      if (pendingBuffer.blocks.length === 0) {
        this.pendingCrossChunkPatchBuffers.delete(chunkKey);
      }
    }

    return removed;
  }

  /**
   * 入口：接收 Worker 返回的完整结果
   * @param {Object} workerResult - Worker 返回的数据
   */
  scatter(workerResult) {
    if (workerResult?.routing?.schemaVersion) {
      this._scatterWithRouting(workerResult);
      return;
    }

    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const { scatteredBlocks = [], visibleKeys, cx, cz, structureCenters, meshData = null } = workerResult;
    const blockDataBlocks = Array.isArray(workerResult.blockDataBlocks)
      ? workerResult.blockDataBlocks
      : scatteredBlocks;

    // visibleKeys 从 Worker 传来是数字编码数组，旧字符串格式在边界处归一化兼容。
    const visibleKeysSet = Array.isArray(visibleKeys)
      ? new Set(visibleKeys.map(coordKeyToCode))
      : null;
    // 记录本次触达的 chunk keys，替代原先 touchedBuffers 的反向查找
    const touchedKeys = new Set();

    // 收集跨 chunk 未加载目标的 authority patches
    const unloadedCrossChunkPatches = new Map(); // chunkKey -> Map<code, entry>

    // 1. 遍历所有逻辑方块，按坐标分发
    for (const block of blockDataBlocks) {
      const chunkCx = Math.floor(block.x / CHUNK_SIZE);
      const chunkCz = Math.floor(block.z / CHUNK_SIZE);
      const chunkKey = `${chunkCx},${chunkCz}`;

      // 跨 chunk 方块过滤（测试用）
      if (this.skipCrossChunk && (chunkCx !== cx || chunkCz !== cz)) {
        continue;
      }

      const isOwnChunk = chunkCx === cx && chunkCz === cz;

      // 跨 chunk 场景：如果目标 chunk 已存在且已有该方块，跳过，避免创建冗余 buffer
      if (!isOwnChunk) {
        const existingChunk = this.world.chunks.get(chunkKey);
        if (existingChunk?.isReady && existingChunk.hasBlockEntry?.(block.x, block.y, block.z)) {
          continue;
        }
      }

      const targetMap = isOwnChunk ? this.chunkBuffers : this.pendingCrossChunkPatchBuffers;
      const buffer = this._getOrCreateBuffer(targetMap, chunkKey);
      buffer.blocks.push(block);
      buffer.visibleBlocks = [];
      buffer.sourceWorkers.add(`${cx},${cz}`);
      buffer.lastUpdatedAt = globalThis.performance?.now?.() ?? Date.now();
      touchedKeys.add(chunkKey);

      // 提取 visibleKeys，标记哪些方块是面剔除可见的
      const blockKey = encodeCoord(block.x, block.y, block.z);
      if (visibleKeysSet?.has(blockKey)) {
        buffer.visibleBlockKeys.add(blockKey);
      }

      // 跨 chunk 且目标未加载：同时收集到 authority patch Map
      if (!isOwnChunk) {
        const existingChunk = this.world.chunks.get(chunkKey);
        if (!existingChunk || !existingChunk.isReady) {
          const code = encodeCoord(block.x, block.y, block.z);
          const entry = block.orientation !== 0 ? { type: block.type, orientation: block.orientation } : block.type;
          let chunkPatches = unloadedCrossChunkPatches.get(chunkKey);
          if (!chunkPatches) {
            chunkPatches = new Map();
            unloadedCrossChunkPatches.set(chunkKey, chunkPatches);
          }
          chunkPatches.set(code, entry);
        }
      }
    }
    const t1 = globalThis.performance?.now?.() ?? Date.now();

    // 对未加载跨 chunk 目标，先写 authority（buffer 仍保留供未来渲染补刷）
    const blockStore = this.world?.worldBlockDataStore;
    if (blockStore && unloadedCrossChunkPatches.size > 0) {
      for (const [chunkKey, patches] of unloadedCrossChunkPatches) {
        const [tCx, tCz] = chunkKey.split(',').map(Number);
        blockStore.applyChunkPatch(tCx, tCz, patches);
        // 标记 chunk registry 为 known（若非空）
        if (this.world.worldChunkRegistry && !this.world.worldChunkRegistry.hasKnownChunk(tCx, tCz)) {
          this.world.worldChunkRegistry.markChunkKnown(tCx, tCz, { source: 'scatter' });
        }
      }
    }
    const t1b = globalThis.performance?.now?.() ?? Date.now();

    // 确保发起 Worker 的 chunk 即使没有方块，也有 buffer 承载 ready 状态和结构中心。
    const ownKey = `${cx},${cz}`;
    const ownBuffer = this._getOrCreateBuffer(this.chunkBuffers, ownKey);
    ownBuffer.meshData = Array.isArray(meshData) ? meshData : null;
    touchedKeys.add(ownKey);

    // 2. 合并结构中心信息到本次触达的 buffer（追加而非覆盖）
    // 避免把每个 Worker 的 structureCenters 灌入所有历史 buffer，放大后续归属判定成本。
    this._mergeStructureCentersIntoTouchedBuffers(touchedKeys, structureCenters);

    // 3. 标记发起 Worker 的 chunk 为"已加载"
    ownBuffer.ready = true;

    // 4. 将本次触达的 buffer key 加入待消费队列，避免全表扫描
    // chunkBuffers 中的 key 只入队 chunkBuffers（不含 pendingCrossChunkPatchBuffers）
    this._markTouchedReadyKeys(touchedKeys);

    // 5. 通知就绪的 chunk 进行渲染
    this.flushReadyChunks();
    const t2 = globalThis.performance?.now?.() ?? Date.now();
    recordChunkPerf('block-scatter.scatter', t2 - t0, {
      sourceChunkKey: `${cx},${cz}`,
      distributeMs: t1 - t0,
      authorityWriteMs: t1b - t1,
      flushReadyChunksMs: t2 - t1b,
      blockDataBlocks: blockDataBlocks.length,
      scatteredBlocks: scatteredBlocks.length,
      touchedKeys: touchedKeys.size,
      chunkBuffers: this.chunkBuffers.size,
      pendingPatchBuffers: this.pendingCrossChunkPatchBuffers.size,
      pendingReadyKeys: this.pendingReadyChunkKeys.size
    });
  }

  /**
   * 检查 chunk 是否就绪并通知渲染
   * 支持首次渲染和已 ready chunk 的增量追加
   * 优化：只消费 pendingReadyChunkKeys 中的 key，不再遍历所有 buffer
   */
  flushReadyChunks() {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    let acceptedChunks = 0;
    let appendedChunks = 0;
    let acceptedBlocks = 0;
    let appendedBlocks = 0;
    let skippedMissing = 0;
    let skippedNotReady = 0;

    // 只处理本次新触达的 chunk keys
    const keysToProcess = [...this.pendingReadyChunkKeys];
    this.pendingReadyChunkKeys.clear();

    for (const key of keysToProcess) {
      const buffer = this.chunkBuffers.get(key);
      if (!buffer) {
        skippedMissing++;
        continue;
      }

      const chunk = this.world.chunks.get(key);
      if (!chunk) continue;
      if (!buffer.ready && !chunk.isReady) {
        // 尚未就绪，保留在 pendingReadyChunkKeys 中等待后续触发
        this.pendingReadyChunkKeys.add(key);
        skippedNotReady++;
        continue;
      }

      if (!chunk.isReady) {
        // 首次渲染：完整接受并构建 mesh（传递 structureCenters 供跨 chunk 结构判断）
        acceptedChunks++;
        acceptedBlocks += buffer.blocks.length;
        chunk.acceptScatteredBlocks(
          buffer.blocks,
          Array.isArray(buffer.visibleBlocks) && buffer.visibleBlocks.length > 0 ? buffer.visibleBlocks : buffer.visibleBlockKeys,
          buffer.structureCenters,
          buffer.meshData
        );
        buffer.blocks = [];
        buffer.meshData = null;
        buffer.visibleBlockKeys = new Set();
        buffer.visibleBlocks = [];
      } else {
        // 增量追加：跨 chunk 流式补片不抢 WorldWorker consolidation 队列
        appendedChunks++;
        appendedBlocks += buffer.blocks.length;
        chunk.appendScatteredBlocks(
          buffer.blocks,
          Array.isArray(buffer.visibleBlocks) && buffer.visibleBlocks.length > 0 ? buffer.visibleBlocks : buffer.visibleBlockKeys,
          buffer.structureCenters,
          {
          deferConsolidation: !buffer.ready
          }
        );
        // 清空已处理的方块，释放内存，保留 buffer 结构以接收后续溢出
        buffer.blocks = [];
        buffer.meshData = null;
        buffer.visibleBlockKeys = new Set();
        buffer.visibleBlocks = [];
      }
    }
    recordChunkPerf('block-scatter.flush-ready', (globalThis.performance?.now?.() ?? Date.now()) - t0, {
      acceptedChunks,
      appendedChunks,
      acceptedBlocks,
      appendedBlocks,
      inputKeys: keysToProcess.length,
      skippedMissing,
      skippedNotReady,
      pendingReadyKeys: this.pendingReadyChunkKeys.size
    });
  }

  _getPendingPatchKeysByDistance(playerCx, playerCz) {
    return [...this.pendingCrossChunkPatchBuffers.keys()].sort((a, b) => {
      const [ax, az] = a.split(',').map(Number);
      const [bx, bz] = b.split(',').map(Number);
      const da = Math.abs(ax - playerCx) + Math.abs(az - playerCz);
      const db = Math.abs(bx - playerCx) + Math.abs(bz - playerCz);
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });
  }

  _getActivePatchRange(options = {}) {
    if (Number.isFinite(options.activeRange)) return options.activeRange;
    const renderDistance = this.world?.getRenderDistance?.() ?? this.world?.renderDistance ?? 2;
    return renderDistance + 1;
  }

  _pruneInactivePendingPatches(playerCx, playerCz, activeRange) {
    let prunedChunks = 0;
    let prunedBlocks = 0;

    for (const [key, buffer] of this.pendingCrossChunkPatchBuffers) {
      const targetOutsideActiveRange = this._isChunkKeyOutsideActiveRange(key, playerCx, playerCz, activeRange);
      if (!targetOutsideActiveRange) continue;

      // 只有目标 chunk 和所有 source worker 都离开活跃范围，才可以安全丢弃。
      // 如果源 chunk 仍活跃，保留 patch，避免源不重新生成导致跨 chunk 方块缺补刷。
      let allSourcesOutsideActiveRange = true;
      for (const sourceKey of buffer.sourceWorkers || []) {
        if (!this._isChunkKeyOutsideActiveRange(sourceKey, playerCx, playerCz, activeRange)) {
          allSourcesOutsideActiveRange = false;
          break;
        }
      }
      if (!allSourcesOutsideActiveRange) continue;

      prunedBlocks += buffer.blocks.length;
      prunedChunks++;
      this.pendingCrossChunkPatchBuffers.delete(key);
    }

    return { prunedChunks, prunedBlocks };
  }

  _isChunkKeyOutsideActiveRange(chunkKey, playerCx, playerCz, activeRange) {
    const [cx, cz] = chunkKey.split(',').map(Number);
    return Math.abs(cx - playerCx) > activeRange || Math.abs(cz - playerCz) > activeRange;
  }

  /**
   * runtime idle 阶段按玩家距离分批补刷跨 chunk 方块。
   * @returns {{processedChunks:number, processedBlocks:number, prunedChunks:number, prunedBlocks:number, elapsedMs:number, skippedBusy:number}}
   */
  flushDeferredCrossChunkPatchesAround(playerCx, playerCz, options = {}) {
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const maxChunks = Number.isFinite(options.maxChunks) ? options.maxChunks : 1;
    const maxBlocks = Number.isFinite(options.maxBlocks) ? options.maxBlocks : 400;
    const activeRange = this._getActivePatchRange(options);
    const pruneStats = this._pruneInactivePendingPatches(playerCx, playerCz, activeRange);
    let processedChunks = 0;
    let processedBlocks = 0;
    let skippedBusy = 0;
    // 记录本轮补刷涉及的 chunk keys，用于后续批量触发 consolidation
    const touchedChunkKeys = new Set();

    for (const key of this._getPendingPatchKeysByDistance(playerCx, playerCz)) {
      if (processedChunks >= maxChunks || processedBlocks >= maxBlocks) break;

      const chunk = this.world.chunks.get(key);
      const buffer = this.pendingCrossChunkPatchBuffers.get(key);
      if (!buffer) continue;

      if (!chunk) {
        // 目标 chunk 尚未加载：authority 已在 scatter() 中写入，buffer 保留供未来渲染补刷
        continue;
      }
      if (chunk.disposed) {
        this.pendingCrossChunkPatchBuffers.delete(key);
        continue;
      }
      if (!chunk.isReady || chunk.isConsolidating) {
        skippedBusy++;
        continue;
      }
      if (buffer.blocks.length === 0) {
        // 空 buffer：检查重试次数，超过上限则丢弃
        buffer.retryCount = (buffer.retryCount || 0) + 1;
        if (buffer.retryCount > 10) {
          this.pendingCrossChunkPatchBuffers.delete(key);
        }
        continue;
      }

      const remainingBudget = maxBlocks - processedBlocks;
      const blocks = buffer.blocks.length > remainingBudget
        ? buffer.blocks.splice(0, remainingBudget)
        : buffer.blocks.splice(0, buffer.blocks.length);

      const appended = chunk.appendDeferredCrossChunkPatch?.(
        blocks,
        buffer.visibleBlockKeys,
        buffer.structureCenters
      ) ?? 0;

      if (appended > 0) {
        processedBlocks += appended;
        processedChunks++;
        touchedChunkKeys.add(key);
      }
      // appended === 0 说明所有方块都已存在于 chunk，buffer 数据冗余。
      // splice 已移出，buffer 为空时删除；不为空时留给下一帧。

      if (buffer.blocks.length === 0) {
        this.pendingCrossChunkPatchBuffers.delete(key);
      }
    }

    // 本轮补刷完成后，对受影响的 chunks 统一触发 consolidation
    for (const key of touchedChunkKeys) {
      const chunk = this.world.chunks.get(key);
      if (chunk?.isReady && !chunk.isConsolidating && chunk.dirtyBlocks > 0) {
        this.world.queueDeferredConsolidation(chunk);
      }
    }

    const elapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - t0;
    return { processedChunks, processedBlocks, elapsedMs, skippedBusy, ...pruneStats };
  }

  getPendingCrossChunkPatchStats() {
    let blocks = 0;
    for (const buffer of this.pendingCrossChunkPatchBuffers.values()) {
      blocks += buffer.blocks.length;
    }
    return {
      chunks: this.pendingCrossChunkPatchBuffers.size,
      blocks
    };
  }

  /**
   * 合并结构中心列表，按位置去重
   */
  _mergeStructureCenters(existing, incoming) {
    if (!existing || existing.length === 0) return incoming;
    if (!incoming || incoming.length === 0) return existing;

    const merged = [...existing];
    const seen = new Set(existing.map(c => `${c.type},${c.x},${c.y},${c.z}`));
    for (const c of incoming) {
      const key = `${c.type},${c.x},${c.y},${c.z}`;
      if (!seen.has(key)) {
        merged.push(c);
        seen.add(key);
      }
    }
    return merged;
  }

  /**
   * 清理：chunk unload 时清除 buffer
   */
  unloadChunk(chunkKey) {
    this.chunkBuffers.delete(chunkKey);
    this.pendingCrossChunkPatchBuffers.delete(chunkKey);
    this.pendingReadyChunkKeys.delete(chunkKey);
  }
}
