// src/world/WorldChunkPayloadRegistry.js
/**
 * WorldChunkPayloadRegistry — world-level non-block payload authority
 *
 * 职责：
 * - 持有与 chunk 同坐标关联、但不属于普通块逻辑真相的 payload
 * - 本阶段 primary scope：
 *   - runtimeSeedData
 *   - staticEntities
 * - 为 runtimeEntities 预留兼容挂点，但不要求本阶段完成其 owner 重构
 *
 * 生命周期：独立于 Chunk 实例，由 World 持有
 *
 * 注意：
 * - runtimeEntities / 特殊实体系统在本阶段继续由 SpecialEntitiesShadowStore 管理
 * - 本 registry 只负责 runtimeSeedData 和 staticEntities 的 world-level 持有
 */

export class WorldChunkPayloadRegistry {
  constructor() {
    /**
     * chunkKey -> { runtimeSeedData, staticEntities }
     */
    this._payloads = new Map();
  }

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  // ============================================================
  // Payload 读写
  // ============================================================

  /**
   * 获取 chunk payload
   * @param {number} cx
   * @param {number} cz
   * @returns {object|null} { runtimeSeedData, staticEntities } 或 null
   */
  getChunkPayload(cx, cz) {
    const key = this.chunkKey(cx, cz);
    const payload = this._payloads.get(key);
    if (!payload) return null;

    // 返回浅拷贝，防止外部修改内部状态
    return {
      runtimeSeedData: payload.runtimeSeedData ? { ...payload.runtimeSeedData } : {},
      staticEntities: payload.staticEntities ? [...payload.staticEntities] : []
    };
  }

  /**
   * 设置 chunk payload（完整替换）
   * @param {number} cx
   * @param {number} cz
   * @param {object} payload - { runtimeSeedData?, staticEntities? }
   */
  setChunkPayload(cx, cz, payload) {
    const key = this.chunkKey(cx, cz);
    this._payloads.set(key, {
      runtimeSeedData: payload.runtimeSeedData ? { ...payload.runtimeSeedData } : {},
      staticEntities: payload.staticEntities ? [...payload.staticEntities] : []
    });
  }

  /**
   * 合并部分 payload（不覆盖未提供的字段）
   * @param {number} cx
   * @param {number} cz
   * @param {object} partialPayload - { runtimeSeedData?, staticEntities? }
   */
  mergeChunkPayload(cx, cz, partialPayload) {
    const key = this.chunkKey(cx, cz);
    const existing = this._payloads.get(key) || {
      runtimeSeedData: {},
      staticEntities: []
    };

    if (partialPayload.runtimeSeedData) {
      existing.runtimeSeedData = { ...existing.runtimeSeedData, ...partialPayload.runtimeSeedData };
    }
    if (partialPayload.staticEntities) {
      existing.staticEntities = [...partialPayload.staticEntities];
    }

    this._payloads.set(key, existing);
  }

  /**
   * 检查是否存在 chunk payload
   * @param {number} cx
   * @param {number} cz
   * @returns {boolean}
   */
  hasChunkPayload(cx, cz) {
    return this._payloads.has(this.chunkKey(cx, cz));
  }

  /**
   * 移除 chunk payload（chunk 完全卸载时）
   * @param {number} cx
   * @param {number} cz
   */
  removeChunkPayload(cx, cz) {
    this._payloads.delete(this.chunkKey(cx, cz));
  }
}
