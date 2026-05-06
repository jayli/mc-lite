// src/world/MemoryWorldStore.js
/**
 * MemoryWorldStore — 运行期世界级权威内存存储
 *
 * 作为运行期唯一权威数据源，接管旧版 IndexedDB 在 chunk streaming 中的角色。
 * 启动时从旧存档导入，运行期间所有方块修改立即同步到本层。
 * 不自动回写 IndexedDB（仅未来手动保存时导出）。
 */

export class MemoryWorldStore {
  constructor() {
    this.worldMeta = null;

    // 双索引：region 级 + chunk 级
    this.regions = new Map();  // regionKey -> { rx, rz, chunkKeys: Set, chunks: Map }
    this.chunks = new Map();   // chunkKey -> MemoryChunkRecord

    // dirty 标记（仅为未来手动保存准备，不参与运行期正确性）
    this.dirtyChunks = new Set();

    // 统计
    this.stats = {
      totalReads: 0,
      totalWrites: 0,
      totalMutations: 0,
      hits: 0,
      misses: 0
    };
  }

  // ============================================================
  // 工具方法
  // ============================================================

  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  regionKey(rx, rz) {
    return `${rx},${rz}`;
  }

  chunkToRegion(cx, cz) {
    return { rx: Math.floor(cx / 8), rz: Math.floor(cz / 8) };
  }

  // ============================================================
  // ChunkRecord 读写
  // ============================================================

  /**
   * 写入或替换一个 chunk record
   */
  createOrReplaceChunkRecord(cx, cz, record) {
    const key = this.chunkKey(cx, cz);
    const { rx, rz } = this.chunkToRegion(cx, cz);
    const rKey = this.regionKey(rx, rz);

    const chunkRecord = {
      cx,
      cz,
      blockData: record.blockData ? { ...record.blockData } : {},
      staticEntities: record.staticEntities ? [...record.staticEntities] : [],
      runtimeSeedData: record.runtimeSeedData ? { ...record.runtimeSeedData } : {},
      runtimeEntities: record.runtimeEntities
        ? JSON.parse(JSON.stringify(record.runtimeEntities))
        : { turrets: [], zombieNests: [], minecarts: [] },
      version: record.version ?? 0,
      dirty: false,
      lastModifiedAt: Date.now()
    };

    this.chunks.set(key, chunkRecord);

    // 更新 region 索引
    let region = this.regions.get(rKey);
    if (!region) {
      region = {
        rx,
        rz,
        chunkKeys: new Set(),
        chunks: new Map(),
        generatedAt: Date.now(),
        generatorVersion: record.generatorVersion ?? 0
      };
      this.regions.set(rKey, region);
    }
    region.chunkKeys.add(key);
    region.chunks.set(key, chunkRecord);

    this.stats.totalWrites++;
  }

  /**
   * 读取一个 chunk record
   */
  getChunkRecord(cx, cz) {
    const key = this.chunkKey(cx, cz);
    const record = this.chunks.get(key);

    this.stats.totalReads++;
    if (record) {
      this.stats.hits++;
      // 返回快照，防止外部修改内部状态
      return {
        cx: record.cx,
        cz: record.cz,
        blockData: { ...record.blockData },
        staticEntities: [...record.staticEntities],
        runtimeSeedData: { ...record.runtimeSeedData },
        runtimeEntities: JSON.parse(JSON.stringify(record.runtimeEntities))
      };
    }

    this.stats.misses++;
    return null;
  }

  // ============================================================
  // Region 查询
  // ============================================================

  getRegion(rx, rz) {
    const rKey = this.regionKey(rx, rz);
    return this.regions.get(rKey) || null;
  }

  // ============================================================
  // Block mutation
  // ============================================================

  /**
   * 立即更新权威层的一个 block entry
   * entry 可以是 string type、{ type, orientation } 对象，或 null（删除）
   */
  applyBlockMutation(cx, cz, coord, entry) {
    const key = this.chunkKey(cx, cz);
    const record = this.chunks.get(key);
    if (!record) {
      return;
    }

    if (entry === null || entry === undefined) {
      delete record.blockData[coord];
    } else {
      record.blockData[coord] = typeof entry === 'string' ? entry : { ...entry };
    }

    record.dirty = true;
    record.lastModifiedAt = Date.now();
    record.version++;

    this.dirtyChunks.add(key);
    this.stats.totalMutations++;
  }

  /**
   * 批量替换 chunk 的 blockData 快照（用于生成器直写或导入）
   */
  applyChunkBlockSnapshot(cx, cz, blockData) {
    const key = this.chunkKey(cx, cz);
    const record = this.chunks.get(key);
    if (!record) {
      return;
    }

    record.blockData = { ...blockData };
    record.dirty = true;
    record.lastModifiedAt = Date.now();
    record.version++;

    this.dirtyChunks.add(key);
  }

  // ============================================================
  // 统计
  // ============================================================

  getStats() {
    return {
      regionCount: this.regions.size,
      chunkCount: this.chunks.size,
      dirtyChunkCount: this.dirtyChunks.size,
      reads: this.stats.totalReads,
      writes: this.stats.totalWrites,
      mutations: this.stats.totalMutations,
      hits: this.stats.hits,
      misses: this.stats.misses
    };
  }
}
