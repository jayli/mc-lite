// src/world/WorldStore.js
/**
 * WorldStore — 旧存档导入/导出工具
 *
 * 运行期权威数据源已迁移到 WorldBlockDataStore（内存）。
 * 本类保留 IndexedDB 的读写能力，仅用于：
 *   - 旧存档一次性导入内存
 *   - 未来手动保存时从内存导出到 IndexedDB
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
   * 在 Worker 内对指定 region 应用 chunk patch，避免主线程构造整包 region record。
   * @param {number} rx
   * @param {number} rz
   * @param {object} patch
   */
  async applyRegionPatch(rx, rz, patch) {
    const key = this.regionKey(rx, rz);
    return getPersistenceService().postMessage('applyRegionPatch', {
      regionKey: key,
      rx,
      rz,
      patch
    });
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
  // ChunkRecord 读取
  // getChunkRecord(): 走 Worker 侧裁剪，仅传输目标 chunk
  // getChunkRecordsInRegion(): 仍通过整包 region 读取后本地裁剪
  // ============================================================

  /**
   * 读取单个 ChunkRecord（Worker 侧裁剪，仅传输目标 chunk）
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<object|null>}
   */
  async getChunkRecord(cx, cz) {
    const { rx, rz } = this.chunkToRegion(cx, cz);
    const regionKey = this.regionKey(rx, rz);
    const chunkKey = this.chunkKey(cx, cz);
    return getPersistenceService().postMessage('getChunkRecord', {
      regionKey,
      chunkKey,
      cx,
      cz
    });
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
        result.set(key, this._extractChunkRecord(region, cx, cz));
      }
    }
    return result;
  }

  /**
   * 业务层专用：加载 chunk 权威记录
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<object|null>}
   */
  async loadChunkRecord(cx, cz) {
    return this.getChunkRecord(cx, cz);
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
   * 业务层专用：提交 chunk 权威记录
   * @param {number} cx
   * @param {number} cz
   * @param {object} chunkRecord
   * @returns {Promise<any>}
   */
  async commitChunkRecord(cx, cz, chunkRecord) {
    return this.putChunkRecord(cx, cz, chunkRecord);
  }

  /**
   * 业务层专用：仅提交 runtimeEntities，避免业务层自行读改写 region。
   * @param {number} cx
   * @param {number} cz
   * @param {object} runtimeEntities
   * @returns {Promise<any>}
   */
  async commitRuntimeEntities(cx, cz, runtimeEntities) {
    const chunkRecord = (await this.loadChunkRecord(cx, cz)) || {
      cx,
      cz,
      blockData: {},
      staticEntities: [],
      runtimeSeedData: {}
    };
    chunkRecord.runtimeEntities = runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] };
    return this.commitChunkRecord(cx, cz, chunkRecord);
  }

  /**
   * 旧档迁移专用：读取 world_deltas 中的旧 chunk 数据。
   * 新运行时禁止业务层直接调用 PersistenceService。
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<object|null>}
   */
  async getLegacyChunkDelta(cx, cz) {
    const key = this.chunkKey(cx, cz);
    return getPersistenceService().postMessage('getChunkData', { key });
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

  _extractChunkRecord(region, cx, cz) {
    if (!region || !region.chunks) return null;
    const key = this.chunkKey(cx, cz);
    const chunkData = region.chunks[key];
    if (!chunkData) return null;
    return {
      cx,
      cz,
      blockData: chunkData.blockData || {},
      staticEntities: chunkData.staticEntities || [],
      runtimeSeedData: chunkData.runtimeSeedData || {},
      runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] }
    };
  }
}

// 单例导出
export const worldStore = new WorldStore();
