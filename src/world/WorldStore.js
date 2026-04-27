// src/world/WorldStore.js
/**
 * WorldStore — 权威世界存储接口
 *
 * 封装 IndexedDB 上的 WorldMeta / RegionRecord / ChunkRecord 读写。
 * IndexedDB 是最终权威数据源，runtime blockData 只是内存工作集视图。
 *
 * 数据层级：
 *   - WorldMeta: 世界级元数据（边界、种子、生成状态）
 *   - RegionRecord: region 级存储单元（8x8 chunk），IndexedDB 物理存储粒度
 *   - ChunkRecord: 从 RegionRecord 中投影出的单个 chunk 权威数据
 */
import { persistenceService } from '../services/PersistenceService.js';

// --- 依赖注入：允许测试环境覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;

const REGION_SIZE_IN_CHUNKS = 8;

export class WorldStore {
  constructor() {
    this._regionSizeInChunks = REGION_SIZE_IN_CHUNKS;
  }

  /**
   * 将 chunk 坐标投影到 region 坐标
   */
  chunkToRegion(cx, cz) {
    const rx = Math.floor(cx / this._regionSizeInChunks);
    const rz = Math.floor(cz / this._regionSizeInChunks);
    return { rx, rz };
  }

  /**
   * 生成 region key
   */
  regionKey(rx, rz) {
    return `${rx},${rz}`;
  }

  /**
   * 生成 chunk key
   */
  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  // ============================================================
  // WorldMeta 读写
  // ============================================================

  /**
   * 读取 WorldMeta
   * @returns {Promise<object|null>}
   */
  async getWorldMeta() {
    return getPersistenceService().postMessage('getWorldMeta', {});
  }

  /**
   * 保存 WorldMeta
   * @param {object} meta
   */
  async saveWorldMeta(meta) {
    return getPersistenceService().postMessage('saveWorldMeta', { meta });
  }

  // ============================================================
  // RegionRecord 读写
  // ============================================================

  /**
   * 读取 RegionRecord
   * @param {number} rx
   * @param {number} rz
   * @returns {Promise<object|null>}
   */
  async getRegionRecord(rx, rz) {
    const key = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('getRegionRecord', { regionKey: key });
  }

  /**
   * 保存 RegionRecord
   * @param {number} rx
   * @param {number} rz
   * @param {object} record
   */
  async saveRegionRecord(rx, rz, record) {
    const key = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('saveRegionRecord', { regionKey: key, record });
  }

  /**
   * 批量保存多个 RegionRecord
   * @param {Array<{rx: number, rz: number, record: object}>} items
   */
  async saveRegionRecordsBatch(items) {
    const records = items.map(({ rx, rz, record }) => ({
      regionKey: this.regionKey(rx, rz),
      record
    }));
    return getPersistenceService().postMessage('saveRegionRecordsBatch', { records });
  }

  /**
   * 获取所有已生成的 region keys
   * @returns {Promise<string[]>}
   */
  async getAllRegionKeys() {
    return getPersistenceService().postMessage('getAllRegionKeys', {});
  }

  // ============================================================
  // ChunkRecord 投影读取（通过 RegionRecord）
  // ============================================================

  /**
   * 读取单个 ChunkRecord（通过 RegionRecord 投影）
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<object|null>}
   */
  async getChunkRecord(cx, cz) {
    const { rx, rz } = this.chunkToRegion(cx, cz);
    const region = await this.getRegionRecord(rx, rz);
    if (!region || !region.chunks) return null;
    const key = this.chunkKey(cx, cz);
    const chunkData = region.chunks[key];
    if (!chunkData) return null;
    return {
      cx,
      cz,
      blockData: chunkData.blockData || {},
      staticEntities: chunkData.staticEntities || [],
      runtimeSeedData: chunkData.runtimeSeedData || {}
    };
  }

  /**
   * 批量读取同一 region 内的多个 ChunkRecord
   * @param {number} rx
   * @param {number} rz
   * @param {Array<{cx: number, cz: number}>} chunkCoords
   * @returns {Promise<Map<string, object>>} key -> ChunkRecord
   */
  async getChunkRecordsInRegion(rx, rz, chunkCoords) {
    const region = await this.getRegionRecord(rx, rz);
    const result = new Map();
    if (!region || !region.chunks) return result;
    for (const { cx, cz } of chunkCoords) {
      const key = this.chunkKey(cx, cz);
      const chunkData = region.chunks[key];
      if (chunkData) {
        result.set(key, {
          cx,
          cz,
          blockData: chunkData.blockData || {},
          staticEntities: chunkData.staticEntities || [],
          runtimeSeedData: chunkData.runtimeSeedData || {}
        });
      }
    }
    return result;
  }

  // ============================================================
  // ChunkRecord 写回（通过更新 RegionRecord）
  // ============================================================

  /**
   * 将修改后的 ChunkRecord 写回 RegionRecord
   * 仅更新对应的 chunk 数据，不覆盖 region 中其他 chunk
   * @param {number} cx
   * @param {number} cz
   * @param {object} chunkRecord - { blockData, staticEntities, runtimeSeedData }
   */
  async putChunkRecord(cx, cz, chunkRecord) {
    const { rx, rz } = this.chunkToRegion(cx, cz);
    const regionKey = this.regionKey(rx, rz);
    const region = await this.getRegionRecord(rx, rz);

    if (!region) {
      // region 不存在，创建新的
      const newRegion = {
        regionKey,
        rx,
        rz,
        chunkKeys: [this.chunkKey(cx, cz)],
        chunks: {
          [this.chunkKey(cx, cz)]: chunkRecord
        },
        generatedAt: Date.now(),
        generatorVersion: '1.0'
      };
      return this.saveRegionRecord(rx, rz, newRegion);
    }

    // 更新已有 region 中的 chunk
    const key = this.chunkKey(cx, cz);
    region.chunks[key] = chunkRecord;
    if (!region.chunkKeys.includes(key)) {
      region.chunkKeys.push(key);
    }

    return this.saveRegionRecord(rx, rz, region);
  }

  /**
   * 检查 chunk 是否已有权威数据
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<boolean>}
   */
  async hasChunkRecord(cx, cz) {
    const record = await this.getChunkRecord(cx, cz);
    return record !== null && Object.keys(record.blockData || {}).length > 0;
  }

  // ============================================================
  // Cross-Region Overflow Blocks 读写
  // ============================================================

  /**
   * 保存跨 region overflow blocks
   * @param {number} rx
   * @param {number} rz
   * @param {object} overflowData - { "cx,cz": [{x,y,z,type,orientation}, ...] }
   */
  async saveOverflowBlocks(rx, rz, overflowData) {
    const regionKey = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('saveOverflowBlocks', { regionKey, overflowData });
  }

  /**
   * 读取跨 region overflow blocks
   * @param {number} rx
   * @param {number} rz
   * @returns {Promise<object|null>} { "cx,cz": [...] }
   */
  async getOverflowBlocks(rx, rz) {
    const regionKey = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('getOverflowBlocks', { regionKey });
  }

  /**
   * 删除跨 region overflow blocks
   * @param {number} rx
   * @param {number} rz
   */
  async removeOverflowBlocks(rx, rz) {
    const regionKey = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('removeOverflowBlocks', { regionKey });
  }

  // ============================================================
  // 清除世界数据
  // ============================================================

  /**
   * 清除世界数据（WorldMeta + 所有 RegionRecord）
   * 用于"开启新世界"场景，确保不残留旧数据
   */
  async clearWorld() {
    return getPersistenceService().postMessage('clearWorld', {});
  }
}

// 单例导出
export const worldStore = new WorldStore();
