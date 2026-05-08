// src/world/WorldBlockDataStore.js
/**
 * WorldBlockDataStore — world-level blockData 唯一权威容器
 *
 * 职责：
 * - 持有所有已知 chunk 的 blockData slice（Map<number, entry>）
 * - 提供 chunk slice 的 peek / ensure / replace / mutation API
 * - 维护每个 chunk slice 的 authority version（逻辑修改递增）
 * - 不负责 chunk presence / generation state（由 WorldChunkRegistry 负责）
 * - 不负责 non-block payload（由 WorldChunkPayloadRegistry 负责）
 *
 * 存储格式：
 * - 外层：Map<chunkKey, Map<number, entry>>，chunkKey = "${cx},${cz}"
 * - 内层：Map<number, entry>，key 为 encodeCoord(x, y, z)
 *
 * 生命周期：独立于 Chunk 实例，由 World 持有
 */

export class WorldBlockDataStore {
  constructor() {
    /**
     * 主存储：chunkKey -> Map<number, entry>
     * 每个 chunk slice 都是一个独立的 Map 实例
     */
    this._slices = new Map();

    /**
     * authority version：chunkKey -> version（每次逻辑修改递增）
     */
    this._versions = new Map();

    /**
     * attached 标记：chunkKey -> true（表示该 slice 当前被 live Chunk 引用）
     * 用于 guard：已 attach 的 slice 不允许直接 replace
     */
    this._attached = new Set();

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

  // ============================================================
  // Chunk Slice 读取
  // ============================================================

  /**
   * 查询 chunk slice（只读，不创建）
   * @param {number} cx
   * @param {number} cz
   * @returns {Map<number, object>|null} 不存在时返回 null
   */
  peekChunkSlice(cx, cz) {
    const key = this.chunkKey(cx, cz);
    const slice = this._slices.get(key) || null;

    this.stats.totalReads++;
    if (slice) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }

    return slice;
  }

  /**
   * 查询或创建 chunk slice
   * @param {number} cx
   * @param {number} cz
   * @returns {Map<number, object>} 返回共享的 Map 实例
   */
  ensureChunkSlice(cx, cz) {
    const key = this.chunkKey(cx, cz);
    let slice = this._slices.get(key);

    if (!slice) {
      slice = new Map();
      this._slices.set(key, slice);
      this._versions.set(key, 0);
      this.stats.totalWrites++;
    }

    this.stats.totalReads++;
    this.stats.hits++;
    return slice;
  }

  /**
   * 检查是否存在 chunk slice
   * @param {number} cx
   * @param {number} cz
   * @returns {boolean}
   */
  hasChunkSlice(cx, cz) {
    return this._slices.has(this.chunkKey(cx, cz));
  }

  // ============================================================
  // Block Entry Mutation（热路径合法写入口）
  // ============================================================

  /**
   * 设置单个 block entry
   * @param {number} cx - chunk 坐标 X
   * @param {number} cz - chunk 坐标 Z
   * @param {number} code - encodeCoord(x, y, z)
   * @param {object|string} entry - block entry（{ type, orientation } 或 type 字符串）
   */
  setBlockEntry(cx, cz, code, entry) {
    const key = this.chunkKey(cx, cz);
    const slice = this._slices.get(key);
    if (!slice) return;

    const normalized = typeof entry === 'string' ? { type: entry, orientation: 0 } : { ...entry };
    slice.set(code, normalized);

    // 递增 authority version
    const currentVersion = this._versions.get(key) || 0;
    this._versions.set(key, currentVersion + 1);

    this.stats.totalMutations++;
  }

  /**
   * 删除单个 block entry
   * @param {number} cx
   * @param {number} cz
   * @param {number} code - encodeCoord(x, y, z)
   */
  deleteBlockEntry(cx, cz, code) {
    const key = this.chunkKey(cx, cz);
    const slice = this._slices.get(key);
    if (!slice) return;

    slice.delete(code);

    // 递增 authority version
    const currentVersion = this._versions.get(key) || 0;
    this._versions.set(key, currentVersion + 1);

    this.stats.totalMutations++;
  }

  /**
   * 批量局部 patch（一次 version 递增）
   * @param {number} cx
   * @param {number} cz
   * @param {Map<number, object|null>} patches - code -> entry（null 表示删除）
   */
  applyChunkPatch(cx, cz, patches) {
    const key = this.chunkKey(cx, cz);
    const slice = this._slices.get(key);
    if (!slice) return;

    for (const [code, entry] of patches) {
      if (entry === null || entry === undefined) {
        slice.delete(code);
      } else {
        const normalized = typeof entry === 'string' ? { type: entry, orientation: 0 } : { ...entry };
        slice.set(code, normalized);
      }
    }

    // 一次性递增 authority version
    const currentVersion = this._versions.get(key) || 0;
    this._versions.set(key, currentVersion + 1);

    this.stats.totalMutations++;
  }

  // ============================================================
  // 整块替换（低频 authority lifecycle API）
  // ============================================================

  /**
   * 整块替换 chunk slice
   * 只允许用于：世界生成注入、未来导入、测试夹具、冷边界恢复
   * 禁止用于：单块修改、批量改单块、scatter patch、普通 unload/reload
   *
   * @param {number} cx
   * @param {number} cz
   * @param {Map<number, object>} blockData - 新的 Map 实例
   */
  replaceChunkSlice(cx, cz, blockData, _callSource = 'unknown') {
    const key = this.chunkKey(cx, cz);

    // guard：已 attach 的 slice 不允许直接 replace
    if (this._attached.has(key)) {
      console.warn(
        `[WorldBlockDataStore] replaceChunkSlice(${cx},${cz}) called on attached slice ` +
        `(source: ${_callSource}). Use detach -> replace -> reattach protocol.`
      );
      return;
    }

    if (!(blockData instanceof Map)) {
      console.warn(
        `[WorldBlockDataStore] replaceChunkSlice(${cx},${cz}) received non-Map input ` +
        `(source: ${_callSource}). Runtime authority must use Map<number, entry>.`
      );
      return;
    }

    this._slices.set(key, blockData);

    // 递增 authority version
    const currentVersion = this._versions.get(key) || 0;
    this._versions.set(key, currentVersion + 1);

    this.stats.totalWrites++;
    this.stats._replaceCallSources = this.stats._replaceCallSources || {};
    this.stats._replaceCallSources[_callSource] = (this.stats._replaceCallSources[_callSource] || 0) + 1;
  }

  // ============================================================
  // Attach / Detach 生命周期
  // ============================================================

  /**
   * 标记 chunk slice 已被 live Chunk attach
   * @param {number} cx
   * @param {number} cz
   */
  markAttached(cx, cz) {
    this._attached.add(this.chunkKey(cx, cz));
  }

  /**
   * 标记 chunk slice 已被 live Chunk detach
   * @param {number} cx
   * @param {number} cz
   */
  markDetached(cx, cz) {
    this._attached.delete(this.chunkKey(cx, cz));
  }

  /**
   * 检查 chunk slice 是否已被 live Chunk attach
   * @param {number} cx
   * @param {number} cz
   * @returns {boolean}
   */
  isAttached(cx, cz) {
    return this._attached.has(this.chunkKey(cx, cz));
  }

  // ============================================================
  // Authority Version
  // ============================================================

  /**
   * 获取 chunk slice 的 authority version
   * @param {number} cx
   * @param {number} cz
   * @returns {number}
   */
  getAuthorityVersion(cx, cz) {
    return this._versions.get(this.chunkKey(cx, cz)) || 0;
  }

  // ============================================================
  // Codec：plain object <-> Map 边界转换
  // ============================================================

  /**
   * 将 plain object 格式的 blockData 反序列化为 Map<number, entry>
   * 用于：世界生成结果注入、冷边界导入、测试夹具
   * @param {object} obj - { [code]: typeString | {type, orientation} }
   * @returns {Map<number, object>}
   */
  static deserializeBlockData(obj) {
    const map = new Map();
    if (!obj) return map;

    for (const [key, value] of Object.entries(obj)) {
      const code = Number(key);
      if (Number.isNaN(code)) continue;
      const entry = typeof value === 'string'
        ? { type: value, orientation: 0 }
        : { ...value };
      map.set(code, entry);
    }
    return map;
  }

  /**
   * 将 Map<number, entry> 序列化为 plain object
   * 用于：Worker 消息边界、测试快照、未来导出
   * @param {Map<number, object>} map
   * @returns {object}
   */
  static serializeBlockData(map) {
    const obj = {};
    if (!map) return obj;

    for (const [code, entry] of map) {
      obj[code] = entry;
    }
    return obj;
  }

  // ============================================================
  // 统计
  // ============================================================

  getStats() {
    return {
      sliceCount: this._slices.size,
      attachedCount: this._attached.size,
      reads: this.stats.totalReads,
      writes: this.stats.totalWrites,
      mutations: this.stats.totalMutations,
      hits: this.stats.hits,
      misses: this.stats.misses,
      replaceCallSources: { ...this.stats._replaceCallSources }
    };
  }

  /**
   * 开发期断言：验证 chunk slice 未被意外清空
   * 在关键状态转换点调用，检测是否存在绕过受控入口的 clear() 调用
   * @param {number} cx
   * @param {number} cz
   * @param {string} caller - 调用点标识
   * @returns {boolean}
   */
  _verifySliceIntegrity(cx, cz, caller = 'unknown') {
    const key = this.chunkKey(cx, cz);
    const slice = this._slices.get(key);
    if (!slice) {
      console.warn(`[WorldBlockDataStore] _verifySliceIntegrity(${cx},${cz}) from ${caller}: slice is null/missing`);
      return false;
    }
    if (!(slice instanceof Map)) {
      console.warn(`[WorldBlockDataStore] _verifySliceIntegrity(${cx},${cz}) from ${caller}: slice is not a Map`);
      return false;
    }
    return true;
  }
}
