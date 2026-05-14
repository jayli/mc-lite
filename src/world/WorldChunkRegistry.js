// src/world/WorldChunkRegistry.js
/**
 * WorldChunkRegistry — world-level chunk presence / generation state registry
 *
 * 职责：
 * - 记录每个 chunk 是否已知存在（已生成、已导入或已知为空）
 * - 区分 missing chunk、known empty chunk、known non-empty chunk
 * - 不负责 blockData 内容（由 WorldBlockDataStore 负责）
 * - 不负责 non-block payload（由 WorldChunkPayloadRegistry 负责）
 *
 * 生命周期：独立于 Chunk 实例，由 World 持有
 *
 * ChunkState:
 * - 'missing': 完全未知，未生成也未导入
 * - 'generated': 已由生成器产出（可能为空 slice）
 * - 'imported': 从冷边界导入
 */

export class WorldChunkRegistry {
  constructor() {
    /**
     * chunkKey -> { state: 'generated'|'imported', generatedAt?: number, generatorVersion?: number }
     */
    this._entries = new Map();
  }

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  // ============================================================
  // Chunk Presence
  // ============================================================

  /**
   * 标记 chunk 已被生成
   * @param {number} cx
   * @param {number} cz
   * @param {object} [meta] - 附加元数据
   */
  markChunkGenerated(cx, cz, meta = {}) {
    const key = this.chunkKey(cx, cz);
    this._entries.set(key, {
      state: 'generated',
      generatedAt: meta.generatedAt || Date.now(),
      generatorVersion: meta.generatorVersion || 0
    });
  }

  /**
   * 标记 chunk 已从冷边界导入
   * @param {number} cx
   * @param {number} cz
   * @param {object} [meta]
   */
  markChunkImported(cx, cz, meta = {}) {
    const key = this.chunkKey(cx, cz);
    this._entries.set(key, {
      state: 'imported',
      generatedAt: meta.generatedAt || Date.now(),
      generatorVersion: meta.generatorVersion || 0
    });
  }

  /**
   * 通用标记 chunk 为已知存在，根据 source 自动选择 state
   * scatter 写入 → 'generated'；cold-import → 'imported'
   * 若已标记过则跳过，避免覆盖已有 state
   * @param {number} cx
   * @param {number} cz
   * @param {object} [meta]
   */
  markChunkKnown(cx, cz, meta = {}) {
    const key = this.chunkKey(cx, cz);
    if (this._entries.has(key)) return; // 已标记过，不覆盖
    const state = meta.source === 'cold-import' ? 'imported' : 'generated';
    this._entries.set(key, {
      state,
      generatedAt: meta.generatedAt || Date.now(),
      generatorVersion: meta.generatorVersion || 0
    });
  }

  /**
   * 获取 chunk 的 presence state
   * @param {number} cx
   * @param {number} cz
   * @returns {object} { state: 'missing'|'generated'|'imported', ...meta }
   */
  getChunkState(cx, cz) {
    const key = this.chunkKey(cx, cz);
    const entry = this._entries.get(key);
    return entry ? { ...entry } : { state: 'missing' };
  }

  /**
   * 检查 chunk 是否已知存在（已生成或已导入）
   * @param {number} cx
   * @param {number} cz
   * @returns {boolean}
   */
  hasKnownChunk(cx, cz) {
    return this._entries.has(this.chunkKey(cx, cz));
  }

  /**
   * 检查 chunk 是否是 missing（完全未知）
   * @param {number} cx
   * @param {number} cz
   * @returns {boolean}
   */
  isMissing(cx, cz) {
    return !this._entries.has(this.chunkKey(cx, cz));
  }
}
