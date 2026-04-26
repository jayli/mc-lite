// src/world/WorldAccessLayer.js
/**
 * WorldAccessLayer — 统一世界访问层
 *
 * 职责：
 * - 统一查询入口：getBlock / isSolid / getCollisionAt
 * - 统一编辑入口：setBlock / removeBlock / applyBatchEdits
 * - 屏蔽 chunk/view/store 差异
 * - 统一跨 chunk 编辑
 * - 统一边界阻挡逻辑
 *
 * 设计原则：
 * - 查询优先命中 runtime blockData（内存，快速）
 * - 编辑立即生效于 runtime blockData，异步写回 IndexedDB
 * - 上层不关心数据来自 chunk、region cache 还是 WorldStore
 */
import { parseBlockEntry } from '../utils/OrientationUtils.js';
import { getBlockProps } from '../constants/BlockData.js';

// --- 依赖注入：允许测试环境覆盖 ---
// getWorld 预留，供未来测试注入使用
// const getWorld = () => globalThis._worldAccessLayerWorld;

export class WorldAccessLayer {
  constructor(world) {
    this._world = world;
  }

  /**
   * 更新 World 引用
   */
  setWorld(world) {
    this._world = world;
  }

  // ============================================================
  // 只读查询
  // ============================================================

  /**
   * 获取指定坐标的方块条目
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {{type: string, orientation: number}|null}
   */
  getBlock(x, y, z) {
    const world = this._world;
    if (!world) return null;

    const chunk = world._getChunkAt?.(x, z);
    if (!chunk) return null;

    const entry = chunk.getBlockEntry?.(x, y, z);
    if (!entry) return null;

    return parseBlockEntry(entry);
  }

  /**
   * 获取指定坐标的方块类型字符串
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {string|null}
   */
  getBlockType(x, y, z) {
    const entry = this.getBlock(x, y, z);
    return entry ? entry.type : null;
  }

  /**
   * 检查指定坐标是否有实心方块
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {boolean}
   */
  isSolid(x, y, z) {
    const world = this._world;
    if (!world) return false;

    // 先查特殊实体碰撞占位
    const specialCollision = world.getSpecialEntityCollision?.(x, y, z);
    if (specialCollision) return true;

    const chunk = world._getChunkAt?.(x, z);
    if (!chunk) {
      // chunk 未加载，回退到 world 层面的 solidBlocks 索引
      return world.isSolidFallback?.(x, y, z) || false;
    }

    // 快速路径：blockDataArray + solidBlockIds
    const blockIndex = chunk._getBlockIndex?.(x, y, z);
    if (blockIndex >= 0) {
      const blockId = chunk.blockDataArray?.[blockIndex];
      if (blockId && chunk.solidBlockIds?.has(blockId)) return true;
    }

    // blockData 路径（Y:16+ 的方块）
    const entry = chunk.getBlockEntry?.(x, y, z);
    if (entry) {
      const type = typeof entry === 'string' ? entry : entry.type;
      return getBlockProps(type)?.isSolid || false;
    }

    return false;
  }

  /**
   * 获取指定位置的碰撞信息
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {object|null} { type, isSolid, isCollidable }
   */
  getCollisionAt(x, y, z) {
    const world = this._world;
    if (!world) return null;

    // 特殊实体碰撞
    const specialCollision = world.getSpecialEntityCollision?.(x, y, z);
    if (specialCollision) {
      return {
        type: specialCollision.entityType,
        isSolid: true,
        isCollidable: true,
        isSpecialEntity: true
      };
    }

    const chunk = world._getChunkAt?.(x, z);
    if (!chunk) return null;

    const entry = chunk.getBlockEntry?.(x, y, z);
    if (!entry) return null;

    const type = typeof entry === 'string' ? entry : entry.type;
    const props = getBlockProps(type);

    return {
      type,
      isSolid: props?.isSolid || false,
      isCollidable: props?.isCollidable !== false,
      isRendered: props?.isRendered !== false
    };
  }

  // ============================================================
  // 编辑操作
  // ============================================================

  /**
   * 放置/替换方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} type - 方块类型
   * @param {object} [options] - { orientation }
   */
  setBlock(x, y, z, type, options = {}) {
    const world = this._world;
    if (!world) return;

    const chunk = world._getChunkAt?.(x, z);
    if (!chunk) {
      // chunk 未加载，忽略操作
      return;
    }

    const orientation = options.orientation || 0;
    const entry = typeof type === 'object' ? type : { type, orientation };

    // 直接修改 runtime blockData
    chunk._updateBlockState?.(x, y, z, type, entry);

    // 标记 chunk 为脏，异步写回
    world.worldRuntime?.markChunkDirty(chunk.cx, chunk.cz);

    // 触发渲染更新
    world.onBlockChanged?.(chunk, x, y, z, type, entry);
  }

  /**
   * 移除方块
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  removeBlock(x, y, z) {
    this.setBlock(x, y, z, 'air');
  }

  /**
   * 批量编辑方块
   * @param {Array<{x: number, y: number, z: number, type: string, orientation?: number}>} edits
   */
  applyBatchEdits(edits) {
    if (!edits || edits.length === 0) return;

    const world = this._world;
    if (!world) return;

    const dirtyChunks = new Set();

    for (const edit of edits) {
      const chunk = world._getChunkAt?.(edit.x, edit.z);
      if (!chunk) continue;

      const entry = { type: edit.type, orientation: edit.orientation || 0 };
      chunk._updateBlockState?.(edit.x, edit.y, edit.z, edit.type, entry);
      dirtyChunks.add(`${chunk.cx},${chunk.cz}`);
    }

    // 批量标记脏
    for (const key of dirtyChunks) {
      const [cx, cz] = key.split(',').map(Number);
      world.worldRuntime?.markChunkDirty(cx, cz);
    }
  }

  // ============================================================
  // 边界检查
  // ============================================================

  /**
   * 检查坐标是否在世界安全边界内
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isInsideWorldBounds(x, z) {
    const world = this._world;
    if (!world?.worldBoundsController) return true;
    return world.worldBoundsController.isInsideSafeBounds(x, z);
  }

  /**
   * 检查移动是否应被硬边界阻挡
   * @param {number} fromX
   * @param {number} fromZ
   * @param {number} toX
   * @param {number} toZ
   * @returns {boolean} true 表示应阻挡
   */
  shouldBlockMovement(fromX, fromZ, toX, toZ) {
    const world = this._world;
    if (!world?.worldBoundsController) return false;
    return world.worldBoundsController.shouldBlockMovement(fromX, fromZ, toX, toZ);
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 批量获取多个坐标的方块类型
   * @param {Array<{x: number, y: number, z: number}>} positions
   * @returns {Map<string, string|null>} "x,y,z" -> type
   */
  getBlockTypesBatch(positions) {
    const result = new Map();
    for (const pos of positions) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      result.set(key, this.getBlockType(pos.x, pos.y, pos.z));
    }
    return result;
  }
}
