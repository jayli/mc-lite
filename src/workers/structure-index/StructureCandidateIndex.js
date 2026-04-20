/**
 * 结构候选索引 — Tile 级缓存与 Chunk 查询
 *
 * 按固定大小 tile 缓存结构候选，相邻 chunk 查询大量重叠的 tile
 * 时直接复用已生成的候选，避免重复扫描。
 *
 * 使用方式：
 *   const index = new StructureCandidateIndex();
 *   const candidates = index.getCandidatesForChunk(cx, cz, seed, terrainGen);
 *
 * 维护说明：
 * - 候选索引只负责"发现结构中心"，不负责生成方块。
 * - 方块生成仍由 WorldWorker.js 的现有 generate 函数执行。
 * - 新增大型结构时必须更新 LargeStaticCandidateCollector.js 的候选发现逻辑。
 * - 新增 static_tree 类型时必须更新 StaticTreeCandidateCollector.js。
 *
 * 缓存 key：`${seed}:${tileX},${tileZ}`
 * 每个 WorldWorker 实例拥有独立的 index 和缓存。
 */

import { collectLargeStaticCandidatesInRect } from './LargeStaticCandidateCollector.js';
import { collectStaticTreeCandidatesInRect } from './StaticTreeCandidateCollector.js';
import { candidateKey } from './StructureCandidateTypes.js';
import { getStructureRenderDist, CROSS_CHUNK_OWNER_BLOCKED_TYPES } from '../../utils/StructureUtils.js';

const DEFAULT_TILE_SIZE = 64;
const CHUNK_SIZE = 16;

/**
 * 计算 CROSS_CHUNK_OWNER_BLOCKED_TYPES 中最大的渲染距离
 */
function getMaxLargeStaticPadding() {
  let max = 0;
  for (const type of CROSS_CHUNK_OWNER_BLOCKED_TYPES) {
    max = Math.max(max, getStructureRenderDist(type));
  }
  return Math.max(max, CHUNK_SIZE);
}

export class StructureCandidateIndex {
  constructor({ tileSize = DEFAULT_TILE_SIZE } = {}) {
    this.tileSize = tileSize;
    /** @type {Map<string, Array>} seed:tx,tz -> 候选数组 */
    this.tileCache = new Map();
    this.stats = { generatedTiles: 0, cacheHits: 0 };
  }

  /**
   * 查询影响指定 chunk 的所有结构候选
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {number} seed - 世界种子
   * @param {Object} terrainGen - 地形生成器
   * @returns {Array<Object>} 候选数组
   */
  getCandidatesForChunk(cx, cz, seed, terrainGen) {
    const padding = getMaxLargeStaticPadding();
    const rect = {
      minX: cx * CHUNK_SIZE - padding,
      maxX: (cx + 1) * CHUNK_SIZE + padding,
      minZ: cz * CHUNK_SIZE - padding,
      maxZ: (cz + 1) * CHUNK_SIZE + padding
    };
    return this.getCandidatesInRect(rect, seed, terrainGen);
  }

  /**
   * 查询影响指定 chunk 的 static_tree 候选
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {number} seed - 世界种子
   * @param {Object} terrainGen - 地形生成器
   * @returns {Array<Object>} 候选数组
   */
  getStaticTreeCandidatesForChunk(cx, cz, seed, terrainGen) {
    const padding = getStructureRenderDist('static_tree');
    const rect = {
      minX: cx * CHUNK_SIZE - padding,
      maxX: (cx + 1) * CHUNK_SIZE + padding,
      minZ: cz * CHUNK_SIZE - padding,
      maxZ: (cz + 1) * CHUNK_SIZE + padding
    };
    return this.getStaticTreeCandidatesInRect(rect, seed, terrainGen);
  }

  /**
   * 查询指定矩形范围内的 static_tree 候选（带 tile 缓存）
   * @param {Object} rect - { minX, maxX, minZ, maxZ }
   * @param {number} seed
   * @param {Object} terrainGen
   * @returns {Array<Object>}
   */
  getStaticTreeCandidatesInRect(rect, seed, terrainGen) {
    const candidates = [];
    const seen = new Set();
    for (const tile of this._tilesForRect(rect)) {
      const tileCandidates = this._getStaticTreeTileCandidates(tile.tx, tile.tz, seed, terrainGen);
      for (const c of tileCandidates) {
        if (c.x < rect.minX || c.x >= rect.maxX || c.z < rect.minZ || c.z >= rect.maxZ) continue;
        const key = candidateKey(c);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(c);
      }
    }
    return candidates;
  }

  /**
   * 查询指定矩形范围内的所有结构候选（带 tile 缓存）
   * @param {Object} rect - { minX, maxX, minZ, maxZ }
   * @param {number} seed
   * @param {Object} terrainGen
   * @returns {Array<Object>}
   */
  getCandidatesInRect(rect, seed, terrainGen) {
    const candidates = [];
    const seen = new Set();
    for (const tile of this._tilesForRect(rect)) {
      const tileCandidates = this._getTileCandidates(tile.tx, tile.tz, seed, terrainGen);
      for (const c of tileCandidates) {
        if (c.x < rect.minX || c.x >= rect.maxX || c.z < rect.minZ || c.z >= rect.maxZ) continue;
        const key = candidateKey(c);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(c);
      }
    }
    return candidates;
  }

  /**
   * 获取内部统计信息
   * @returns {{ generatedTiles: number, cacheHits: number, cachedTiles: number }}
   */
  getStats() {
    return { ...this.stats, cachedTiles: this.tileCache.size };
  }

  // -- 内部方法 --

  /**
   * 计算覆盖指定矩形的所有 tile 坐标
   * @param {Object} rect - { minX, maxX, minZ, maxZ }
   * @returns {Array<{tx: number, tz: number}>}
   */
  _tilesForRect(rect) {
    const ts = this.tileSize;
    const tiles = [];
    const minTileX = Math.floor(rect.minX / ts);
    const maxTileX = Math.floor((rect.maxX - 1) / ts);
    const minTileZ = Math.floor(rect.minZ / ts);
    const maxTileZ = Math.floor((rect.maxZ - 1) / ts);
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let tz = minTileZ; tz <= maxTileZ; tz++) {
        tiles.push({ tx, tz });
      }
    }
    return tiles;
  }

  /**
   * 获取指定 tile 的候选（命中缓存则返回缓存，否则生成并缓存）
   * @param {number} tx - Tile X
   * @param {number} tz - Tile Z
   * @param {number} seed
   * @param {Object} terrainGen
   * @returns {Array<Object>}
   */
  _getTileCandidates(tx, tz, seed, terrainGen) {
    const ts = this.tileSize;
    const cacheKey = `${seed}:${tx},${tz}`;
    if (this.tileCache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.tileCache.get(cacheKey);
    }

    // tile 的扫描范围需要覆盖整个 tile 边界，确保中心落在 tile 内的结构都能被捕获
    const tileRect = {
      minX: tx * ts,
      maxX: (tx + 1) * ts,
      minZ: tz * ts,
      maxZ: (tz + 1) * ts
    };

    const tileCandidates = collectLargeStaticCandidatesInRect(tileRect, seed, terrainGen);
    this.tileCache.set(cacheKey, tileCandidates);
    this.stats.generatedTiles++;
    return tileCandidates;
  }

  /**
   * 获取指定 tile 的 static_tree 候选（独立缓存）
   * @param {number} tx - Tile X
   * @param {number} tz - Tile Z
   * @param {number} seed
   * @param {Object} terrainGen
   * @returns {Array<Object>}
   */
  _getStaticTreeTileCandidates(tx, tz, seed, terrainGen) {
    const ts = this.tileSize;
    const cacheKey = `${seed}:tree:${tx},${tz}`;
    if (this.tileCache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.tileCache.get(cacheKey);
    }

    const tileRect = {
      minX: tx * ts,
      maxX: (tx + 1) * ts,
      minZ: tz * ts,
      maxZ: (tz + 1) * ts
    };

    const tileCandidates = collectStaticTreeCandidatesInRect(tileRect, seed, terrainGen);
    this.tileCache.set(cacheKey, tileCandidates);
    this.stats.generatedTiles++;
    return tileCandidates;
  }
}
