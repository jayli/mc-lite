/**
 * ZombieNestPlacementHandler.js
 * 丧尸巢穴放置处理器 - 封装丧尸巢穴的放置逻辑
 *
 * 职责：
 * - 检查丧尸巢穴是否可以放置（数量限制、空间检查、碰撞检测）
 * - 执行丧尸巢穴放置（放置结构方块、创建巢穴实例）
 */

import { EntityPlacementHandler } from '../entity-registry/EntityPlacementHandler.js';
import { getStructureLoader } from '../../world/entity-system/StructureLoader.js';

/**
 * 丧尸巢穴放置处理器
 */
export class ZombieNestPlacementHandler extends EntityPlacementHandler {
  /**
   * @param {Object} params - 初始化参数
   * @param {Player} params.player - 玩家实例
   * @param {World} params.world - 世界实例
   * @param {Game} params.game - 游戏实例
   * @param {ZombieNestManager} params.zombieNestManager - 丧尸巢穴管理器
   */
  constructor(params) {
    super(params);
    this.zombieNestManager = params.zombieNestManager;
  }

  /**
   * 检查是否可以在指定位置放置丧尸巢穴
   *
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean|Array<Object>} - 如果不能放置返回false，如果能放置返回结构方块数组
   */
  canPlace(x, y, z) {
    // 检查管理器是否可用
    if (!this.zombieNestManager) {
      console.warn('[ZombieNestPlacementHandler] ZombieNestManager 不可用');
      return false;
    }

    // 检查数量限制
    const canCreateNest = typeof this.zombieNestManager.canCreateNest === 'function'
      ? this.zombieNestManager.canCreateNest()
      : this.zombieNestManager.activeNests.size < this.zombieNestManager.maxNests;

    if (!canCreateNest) {
      console.warn('[ZombieNestPlacementHandler] 已达到最大丧尸巢穴数量限制，无法放置');
      return false;
    }

    // 获取结构方块
    const structureBlocks = this.getStructureBlocks(x, y, z);
    if (!structureBlocks) {
      return false;
    }

    // 检查所有位置是否可用
    for (const block of structureBlocks) {
      const existingBlock = this.world.getBlock(block.x, block.y, block.z);
      if (existingBlock && existingBlock !== 'air') {
        console.warn(`[ZombieNestPlacementHandler] 丧尸巢穴位置 (${block.x}, ${block.y}, ${block.z}) 被占用，无法放置`);
        return false;
      }

      if (this.isPlayerCollidingWithBlock(block.x, block.y, block.z)) {
        console.warn('[ZombieNestPlacementHandler] 玩家与丧尸巢穴重叠，无法放置');
        return false;
      }
    }

    // 返回结构方块供 place() 复用，避免重复生成
    return structureBlocks;
  }

  /**
   * 在指定位置放置丧尸巢穴
   *
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean}
   */
  place(x, y, z) {
    // canPlace 返回结构方块数组或 false，复用结果避免重复生成
    const structureBlocks = this.canPlace(x, y, z);
    if (!structureBlocks) {
      return false;
    }

    const criticalBlock = this.findCriticalBlock(structureBlocks);
    if (!criticalBlock) {
      console.warn('[ZombieNestPlacementHandler] 未找到丧尸巢穴关键方块');
      return false;
    }

    // 放置结构方块
    this.applyStructureBlocks(structureBlocks);

    // 创建丧尸巢穴实例
    const nest = this.zombieNestManager.createNest({
      position: { x, y, z },
      criticalBlock
    });

    if (!nest) {
      // 回滚已放置的方块
      this.rollbackStructureBlocks(structureBlocks);
      console.warn('[ZombieNestPlacementHandler] 创建丧尸巢穴运行时实例失败');
      return false;
    }

    // 消耗物品并播放音效
    this.player.inventory?.remove('zombie_nest_alias_block', 1);
    this.playSound('put', 0.3);

    console.log(`[ZombieNestPlacementHandler] 丧尸巢穴放置成功 at (${x}, ${y}, ${z})`);
    return true;
  }

  /**
   * 获取丧尸巢穴结构方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {Array<Object>|null}
   */
  getStructureBlocks(x, y, z) {
    const loader = getStructureLoader('zombieNest');
    const structureData = loader?.getData();
    if (!loader || !structureData) {
      console.warn('[ZombieNestPlacementHandler] zombie_nest 结构尚未加载完成');
      return null;
    }

    const structureBlocks = loader.generateBlocks(x, y, z);
    if (structureBlocks.length === 0) {
      console.warn('[ZombieNestPlacementHandler] zombie_nest 结构数据为空');
      return null;
    }

    return structureBlocks;
  }

  /**
   * 找出结构中最高的关键方块
   * @param {Array<Object>} blocks - 结构方块
   * @returns {Object|null}
   */
  findCriticalBlock(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return null;

    let criticalBlock = null;
    for (const block of blocks) {
      if (!criticalBlock || block.y > criticalBlock.y) {
        criticalBlock = { ...block };
      }
    }

    return criticalBlock;
  }

  /**
   * 应用结构方块到世界
   * @param {Array<Object>} blocks - 结构方块
   */
  applyStructureBlocks(blocks) {
    for (const block of blocks) {
      this.world.setBlock(block.x, block.y, block.z, block.type, block.orientation ?? 0);
    }
  }

  /**
   * 回滚结构方块
   * @param {Array<Object>} blocks - 结构方块
   */
  rollbackStructureBlocks(blocks) {
    for (const block of blocks) {
      this.world.removeBlock(block.x, block.y, block.z);
    }
  }

}
