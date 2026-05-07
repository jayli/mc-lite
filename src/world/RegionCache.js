// src/world/RegionCache.js
/**
 * RegionCache — 活动 region 的 LRU 缓存
 *
 * 缓存 RegionRecord 到内存，避免频繁读取 IndexedDB。
 * 当缓存满时按 LRU 策略淘汰最久未使用的 region。
 *
 * 设计考虑：
 * - 持久化的 RegionRecord 包含完整 blockData，对象较大
 * - 无限增长会导致内存膨胀和 GC 抖动
 * - LRU 淘汰确保热区常驻内存
 */

const DEFAULT_MAX_REGIONS = 32; // 默认最多缓存 32 个 region (32 * 8x8 = 2048 chunks)

export class RegionCache {
  constructor(options = {}) {
    this._maxRegions = options.maxRegions || DEFAULT_MAX_REGIONS;
    // Map 保持插入顺序，用于实现 LRU
    this._cache = new Map();
  }

  /**
   * 获取 region
   * @param {string} regionKey - "rx,rz"
   * @returns {object|null}
   */
  get(regionKey) {
    const record = this._cache.get(regionKey);
    if (!record) return null;
    // 访问时移到末尾（标记为最近使用）
    this._cache.delete(regionKey);
    this._cache.set(regionKey, record);
    return record;
  }

  /**
   * 设置 region
   * @param {string} regionKey
   * @param {object} record
   */
  set(regionKey, record) {
    // 如果已存在，先删除再插入（刷新 LRU 位置）
    if (this._cache.has(regionKey)) {
      this._cache.delete(regionKey);
    }
    this._cache.set(regionKey, record);
    this._evict();
  }

  /**
   * 检查 region 是否在缓存中
   * @param {string} regionKey
   * @returns {boolean}
   */
  has(regionKey) {
    return this._cache.has(regionKey);
  }

  /**
   * 删除 region
   * @param {string} regionKey
   * @returns {object|null} 被删除的 record
   */
  delete(regionKey) {
    const record = this._cache.get(regionKey);
    this._cache.delete(regionKey);
    return record || null;
  }

  /**
   * 获取缓存大小
   */
  get size() {
    return this._cache.size;
  }

  /**
   * 获取缓存中所有 region keys
   */
  keys() {
    return Array.from(this._cache.keys());
  }

  /**
   * 清空缓存
   */
  clear() {
    this._cache.clear();
  }

  /**
   * LRU 淘汰：移除最久未使用的 region
   */
  _evict() {
    while (this._cache.size > this._maxRegions) {
      // Map 的迭代顺序是插入顺序，第一个是最久未使用的
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
  }
}
