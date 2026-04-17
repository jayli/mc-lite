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
  }

  /**
   * 入口：接收 Worker 返回的完整结果
   * @param {Object} workerResult - Worker 返回的数据
   */
  scatter(workerResult) {
    const { scatteredBlocks, visibleKeys, cx, cz, entities } = workerResult;

    // visibleKeys 从 Worker 传来是数组，先转为 Set 方便查找
    const visibleKeysSet = Array.isArray(visibleKeys) ? new Set(visibleKeys) : null;

    // 1. 遍历所有方块，按坐标分发
    for (const block of scatteredBlocks) {
      const chunkCx = Math.floor(block.x / CHUNK_SIZE);
      const chunkCz = Math.floor(block.z / CHUNK_SIZE);
      const chunkKey = `${chunkCx},${chunkCz}`;

      let buffer = this.chunkBuffers.get(chunkKey);
      if (!buffer) {
        buffer = { blocks: [], ready: false, sourceWorkers: new Set(), visibleBlockKeys: new Set() };
        this.chunkBuffers.set(chunkKey, buffer);
      }
      buffer.blocks.push(block);
      buffer.sourceWorkers.add(`${cx},${cz}`);

      // 提取 visibleKeys，标记哪些方块是面剔除可见的
      const blockKey = `${block.x},${block.y},${block.z}`;
      if (visibleKeysSet?.has(blockKey)) {
        buffer.visibleBlockKeys.add(blockKey);
      }
    }

    // 2. 标记发起 Worker 的 chunk 为"已加载"
    const ownKey = `${cx},${cz}`;
    const ownBuffer = this.chunkBuffers.get(ownKey);
    if (ownBuffer) {
      ownBuffer.ready = true;
    }

    // 3. 特殊实体直接分发给对应 chunk
    if (entities) {
      this.scatterEntities(entities, cx, cz);
    }

    // 4. 通知就绪的 chunk 进行渲染
    this.flushReadyChunks();
  }

  /**
   * 特殊实体分发（RealisticTree、modGunMan、Rover）
   */
  scatterEntities(entities, cx, cz) {
    const chunk = this.world.chunks.get(`${cx},${cz}`);
    if (!chunk) return;

    if (entities.realisticTrees?.length) {
      chunk.entities.realisticTrees = entities.realisticTrees;
    }
    if (entities.modGunMan?.length) {
      chunk.entities.modGunMan = entities.modGunMan;
    }
    if (entities.rovers?.length) {
      chunk.entities.rovers = entities.rovers;
    }
  }

  /**
   * 检查 chunk 是否就绪并通知渲染
   * 支持首次渲染和已 ready chunk 的增量追加
   */
  flushReadyChunks() {
    for (const [key, buffer] of this.chunkBuffers) {
      if (!buffer.ready) continue;

      const chunk = this.world.chunks.get(key);
      if (!chunk) continue;

      if (!chunk.isReady) {
        // 首次渲染：完整接受并构建 mesh
        chunk.acceptScatteredBlocks(buffer.blocks, buffer.visibleBlockKeys);
      } else {
        // 增量追加：只追加新方块并触发 consolidation
        chunk.appendScatteredBlocks(buffer.blocks, buffer.visibleBlockKeys);
        // 清空已处理的方块，释放内存，保留 buffer 结构以接收后续溢出
        buffer.blocks = [];
        buffer.visibleBlockKeys = new Set();
      }
    }
  }

  /**
   * 清理：chunk unload 时清除 buffer
   */
  unloadChunk(chunkKey) {
    this.chunkBuffers.delete(chunkKey);
  }
}
