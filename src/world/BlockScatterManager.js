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

export class BlockScatterManager {
  constructor(world) {
    this.world = world;
    // chunkKey → { blocks: [], loading: true/false, sourceWorkers: Set }
    this.chunkBuffers = new Map();
    // chunkKey → 延迟跨 chunk 补刷数据。首帧不消费，runtime idle 时分批补刷。
    this.pendingCrossChunkPatchBuffers = new Map();
    // 跨 chunk 方块渲染开关，关闭时跨 chunk 的方块会被直接丢弃
    this.skipCrossChunk = false;
  }

  _getOrCreateBuffer(map, chunkKey) {
    let buffer = map.get(chunkKey);
    if (!buffer) {
      buffer = {
        blocks: [],
        ready: false,
        sourceWorkers: new Set(),
        visibleBlockKeys: new Set(),
        structureCenters: null,
        lastUpdatedAt: 0
      };
      map.set(chunkKey, buffer);
    }
    return buffer;
  }

  /**
   * 入口：接收 Worker 返回的完整结果
   * @param {Object} workerResult - Worker 返回的数据
   */
  scatter(workerResult) {
    const { scatteredBlocks = [], visibleKeys, cx, cz, structureCenters } = workerResult;
    const blockDataBlocks = Array.isArray(workerResult.blockDataBlocks)
      ? workerResult.blockDataBlocks
      : scatteredBlocks;

    // visibleKeys 从 Worker 传来是数组，先转为 Set 方便查找
    const visibleKeysSet = Array.isArray(visibleKeys) ? new Set(visibleKeys) : null;
    const touchedBuffers = new Set();

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
      const targetMap = isOwnChunk ? this.chunkBuffers : this.pendingCrossChunkPatchBuffers;
      const buffer = this._getOrCreateBuffer(targetMap, chunkKey);
      buffer.blocks.push(block);
      buffer.sourceWorkers.add(`${cx},${cz}`);
      buffer.lastUpdatedAt = globalThis.performance?.now?.() ?? Date.now();
      touchedBuffers.add(buffer);

      // 提取 visibleKeys，标记哪些方块是面剔除可见的
      const blockKey = `${block.x},${block.y},${block.z}`;
      if (visibleKeysSet?.has(blockKey)) {
        buffer.visibleBlockKeys.add(blockKey);
      }
    }

    // 确保发起 Worker 的 chunk 即使没有方块，也有 buffer 承载 ready 状态和结构中心。
    const ownKey = `${cx},${cz}`;
    const ownBuffer = this._getOrCreateBuffer(this.chunkBuffers, ownKey);
    touchedBuffers.add(ownBuffer);

    // 2. 合并结构中心信息到本次触达的 buffer（追加而非覆盖）
    // 避免把每个 Worker 的 structureCenters 灌入所有历史 buffer，放大后续归属判定成本。
    if (structureCenters?.length > 0) {
      for (const buffer of touchedBuffers) {
        buffer.structureCenters = this._mergeStructureCenters(buffer.structureCenters, structureCenters);
      }
    }

    // 3. 标记发起 Worker 的 chunk 为"已加载"
    ownBuffer.ready = true;

    // 4. 通知就绪的 chunk 进行渲染
    this.flushReadyChunks();
  }

  /**
   * 检查 chunk 是否就绪并通知渲染
   * 支持首次渲染和已 ready chunk 的增量追加
   */
  flushReadyChunks() {
    for (const [key, buffer] of this.chunkBuffers) {
      const chunk = this.world.chunks.get(key);
      if (!chunk) continue;
      if (!buffer.ready && !chunk.isReady) continue;

      if (!chunk.isReady) {
        // 首次渲染：完整接受并构建 mesh（传递 structureCenters 供跨 chunk 结构判断）
        chunk.acceptScatteredBlocks(buffer.blocks, buffer.visibleBlockKeys, buffer.structureCenters);
        buffer.blocks = [];
        buffer.visibleBlockKeys = new Set();
      } else {
        // 增量追加：跨 chunk 流式补片不抢 WorldWorker consolidation 队列
        chunk.appendScatteredBlocks(buffer.blocks, buffer.visibleBlockKeys, buffer.structureCenters, {
          deferConsolidation: !buffer.ready
        });
        // 清空已处理的方块，释放内存，保留 buffer 结构以接收后续溢出
        buffer.blocks = [];
        buffer.visibleBlockKeys = new Set();
      }
    }
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
   * @returns {{processedChunks:number, processedBlocks:number, prunedChunks:number, prunedBlocks:number}}
   */
  flushDeferredCrossChunkPatchesAround(playerCx, playerCz, options = {}) {
    const maxChunks = Number.isFinite(options.maxChunks) ? options.maxChunks : 1;
    const maxBlocks = Number.isFinite(options.maxBlocks) ? options.maxBlocks : 400;
    const activeRange = this._getActivePatchRange(options);
    const pruneStats = this._pruneInactivePendingPatches(playerCx, playerCz, activeRange);
    let processedChunks = 0;
    let processedBlocks = 0;

    for (const key of this._getPendingPatchKeysByDistance(playerCx, playerCz)) {
      if (processedChunks >= maxChunks || processedBlocks >= maxBlocks) break;

      const chunk = this.world.chunks.get(key);
      const buffer = this.pendingCrossChunkPatchBuffers.get(key);
      if (!buffer) continue;

      if (!chunk || chunk.disposed) {
        continue;
      }
      if (!chunk.isReady || chunk.isConsolidating) continue;
      if (buffer.blocks.length === 0) {
        this.pendingCrossChunkPatchBuffers.delete(key);
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

      processedBlocks += Number.isFinite(appended) ? appended : blocks.length;
      processedChunks++;

      if (buffer.blocks.length === 0) {
        this.pendingCrossChunkPatchBuffers.delete(key);
      }
    }

    return { processedChunks, processedBlocks, ...pruneStats };
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
  }
}
