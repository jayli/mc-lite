// src/world/WorldBoundsController.js
/**
 * WorldBoundsController — 世界边界控制器
 *
 * 职责：
 * - 维护 safeBounds（玩家可活动边界）
 * - 维护 expandTargetBounds（后台扩图目标边界）
 * - 硬边界判定：阻挡玩家越界移动
 * - 接近边缘检测：触发后台扩图
 *
 * 设计：
 * - safeBounds 是当前已加载并可探索的区域
 * - expandTargetBounds 是正在后台生成的目标区域
 * - 在 safeBounds 内：正常移动
 * - 在 safeBounds 外、expandTargetBounds 内：被硬阻挡
 * - expandTargetBounds 扩展完成后，safeBounds 同步扩大
 */

// 触发扩图的距离阈值（从 safeBounds 边缘算起，单位：chunk）
const EXPANSION_TRIGGER_CHUNKS = 2;

export class WorldBoundsController {
  constructor() {
    // 已生成并可探索的边界
    this.safeBounds = {
      minX: -Infinity,
      minZ: -Infinity,
      maxX: Infinity,
      maxZ: Infinity
    };

    // 后台扩图目标边界
    this.expandTargetBounds = {
      minX: -Infinity,
      minZ: -Infinity,
      maxX: Infinity,
      maxZ: Infinity
    };

    // 已生成的世界边界
    this.generatedBounds = {
      minX: -Infinity,
      minZ: -Infinity,
      maxX: Infinity,
      maxZ: Infinity
    };

    this._isExpanding = false;
    this._expansionDirection = null; // 'north', 'south', 'east', 'west', 'northeast', etc.
  }

  /**
   * 从 WorldMeta 初始化边界
   * @param {object} meta - WorldMeta
   */
  initFromMeta(meta) {
    if (meta.generatedBounds) {
      this.generatedBounds = { ...meta.generatedBounds };
    }
    if (meta.safeBounds) {
      this.safeBounds = { ...meta.safeBounds };
    }
    if (meta.expandTargetBounds) {
      this.expandTargetBounds = { ...meta.expandTargetBounds };
    }
  }

  /**
   * 更新 WorldMeta 中的边界信息
   * @param {object} meta - WorldMeta
   */
  updateMeta(meta) {
    meta.generatedBounds = { ...this.generatedBounds };
    meta.safeBounds = { ...this.safeBounds };
    meta.expandTargetBounds = { ...this.expandTargetBounds };
  }

  // ============================================================
  // 边界检查
  // ============================================================

  /**
   * 检查坐标是否在安全边界内
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isInsideSafeBounds(x, z) {
    const { minX, minZ, maxX, maxZ } = this.safeBounds;
    return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  }

  /**
   * 检查坐标是否在已生成边界内
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isInsideGeneratedBounds(x, z) {
    const { minX, minZ, maxX, maxZ } = this.generatedBounds;
    return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  }

  /**
   * 检查坐标是否在扩图目标边界内
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isInsideExpandTargetBounds(x, z) {
    const { minX, minZ, maxX, maxZ } = this.expandTargetBounds;
    return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  }

  /**
   * 检查移动是否应被硬边界阻挡
   * @param {number} fromX - 起点 X
   * @param {number} fromZ - 起点 Z
   * @param {number} toX - 终点 X
   * @param {number} toZ - 终点 Z
   * @returns {boolean} true = 应阻挡
   */
  shouldBlockMovement(fromX, fromZ, toX, toZ) {
    void fromX;
    void fromZ;
    return !this.isInsideSafeBounds(toX, toZ);
  }

  // ============================================================
  // 扩图触发检测
  // ============================================================

  /**
   * 检查玩家是否接近安全边界边缘（需要触发扩图）
   * @param {number} playerX
   * @param {number} playerZ
   * @param {number} triggerDistanceChunks - 触发距离（chunk 单位）
   * @returns {boolean}
   */
  isNearExpansionEdge(playerX, playerZ, triggerDistance = EXPANSION_TRIGGER_CHUNKS) {
    const CHUNK_SIZE = 16;
    const triggerPx = triggerDistance * CHUNK_SIZE;

    const { minX, minZ, maxX, maxZ } = this.safeBounds;
    const dxMin = Math.abs(playerX - minX);
    const dxMax = Math.abs(playerX - maxX);
    const dzMin = Math.abs(playerZ - minZ);
    const dzMax = Math.abs(playerZ - maxZ);

    return dxMin <= triggerPx || dxMax <= triggerPx ||
           dzMin <= triggerPx || dzMax <= triggerPx;
  }

  /**
   * 判断玩家需要扩展的方向
   * @param {number} playerX
   * @param {number} playerZ
   * @returns {Array<string>} ['north', 'east', ...]
   */
  getExpansionDirections(playerX, playerZ) {
    const CHUNK_SIZE = 16;
    const triggerPx = EXPANSION_TRIGGER_CHUNKS * CHUNK_SIZE;

    const { minX, minZ, maxX, maxZ } = this.safeBounds;
    const directions = [];

    if (Math.abs(playerX - minX) <= triggerPx) directions.push('west');
    if (Math.abs(playerX - maxX) <= triggerPx) directions.push('east');
    if (Math.abs(playerZ - minZ) <= triggerPx) directions.push('north');
    if (Math.abs(playerZ - maxZ) <= triggerPx) directions.push('south');

    return directions;
  }

  // ============================================================
  // 扩图状态管理
  // ============================================================

  /**
   * 标记开始扩图
   * @param {Array<string>} directions - 扩图方向
   */
  startExpansion(directions, targetBounds = null) {
    this._isExpanding = true;
    this._expansionDirection = directions;
    if (targetBounds) {
      this.expandTargetBounds = { ...targetBounds };
    }
  }

  /**
   * 扩图完成，更新安全边界
   * @param {object} newBounds - { minX, minZ, maxX, maxZ }
   */
  finishExpansion(newBounds) {
    this.generatedBounds = { ...newBounds };
    this.safeBounds = { ...newBounds };
    this.expandTargetBounds = { ...newBounds };
    this._isExpanding = false;
    this._expansionDirection = null;
  }

  /**
   * 是否正在扩图中
   */
  get isExpanding() {
    return this._isExpanding;
  }

  /**
   * 获取安全边界（用于渲染或调试）
   */
  getSafeBounds() {
    return { ...this.safeBounds };
  }

  /**
   * 获取已生成边界
   */
  getGeneratedBounds() {
    return { ...this.generatedBounds };
  }
}
