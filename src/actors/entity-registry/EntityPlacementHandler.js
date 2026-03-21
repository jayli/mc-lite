/**
 * EntityPlacementHandler.js
 * 实体放置处理器基类 - 定义所有复杂实体放置处理器的统一接口
 *
 * 设计目标：
 * - 封装特定实体的放置逻辑（方块放置、实体创建、交互绑定）
 * - 提供统一的 canPlace/place 接口供 PlayerInteraction 调用
 * - 隐藏实体内部实现细节，降低模块耦合
 */

import { audioManager } from '../../core/AudioManager.js';

/**
 * 实体放置处理器基类
 * 所有复杂实体（炮塔、丧尸巢穴等）的放置处理器必须继承此类
 */
export class EntityPlacementHandler {
  /**
   * @param {Object} params - 初始化参数
   * @param {Player} params.player - 玩家实例
   * @param {World} params.world - 世界实例
   * @param {Game} params.game - 游戏实例
   */
  constructor(params) {
    this.player = params.player;
    this.world = params.world;
    this.game = params.game;
  }

  /**
   * 检查是否可以在指定位置放置实体
   * 子类必须实现此方法
   *
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean} - 如果可以放置返回true
   */
  canPlace(x, y, z) {
    throw new Error('EntityPlacementHandler.canPlace() must be implemented by subclass');
  }

  /**
   * 在指定位置放置实体
   * 子类必须实现此方法
   *
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean} - 如果放置成功返回true
   */
  place(x, y, z) {
    throw new Error('EntityPlacementHandler.place() must be implemented by subclass');
  }

  /**
   * 获取实体放置所需的空间（相对于放置点）
   * 子类可以重写此方法
   *
   * @returns {Array<{dx: number, dy: number, dz: number}>} - 相对坐标列表
   */
  getRequiredSpace() {
    // 默认只需要放置点本身
    return [{ dx: 0, dy: 0, dz: 0 }];
  }

  /**
   * 规范化坐标（避免浮点误差）
   * @param {number} n - 坐标值
   * @returns {number} - 规范化后的坐标
   */
  normalizeCoord(n) {
    return Math.floor(n);
  }

  /**
   * 检查指定位置是否被占用（实心方块）
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {boolean}
   */
  isSolid(x, y, z) {
    if (!this.world) return false;
    const block = this.world.getBlock ? this.world.getBlock(x, y, z) : null;
    return block && block !== 'air';
  }

  /**
   * 检查玩家是否与指定方块位置碰撞
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean}
   */
  isPlayerCollidingWithBlock(x, y, z) {
    if (!this.player) return false;

    const px = this.player.position.x;
    const py = this.player.position.y;
    const pz = this.player.position.z;

    // 玩家碰撞箱：宽度0.6（x: px-0.3 to px+0.3），高度1.8（y: py to py+1.8），宽度0.6（z: pz-0.3 to pz+0.3）
    return (
      px - 0.3 < x + 1 &&
      px + 0.3 > x &&
      py < y + 1 &&
      py + 1.8 > y &&
      pz - 0.3 < z + 1 &&
      pz + 0.3 > z
    );
  }

  /**
   * 消耗玩家背包中的物品
   * @param {string} itemType - 物品类型
   * @param {number} count - 数量
   * @returns {boolean} - 如果成功消耗返回true
   */
  consumeItem(itemType, count = 1) {
    if (!this.player || !this.player.inventory) return false;
    this.player.inventory.remove(itemType, count);
    return true;
  }

  /**
   * 播放放置音效
   * @param {string} soundName - 音效名称
   * @param {number} volume - 音量（0-1）
   */
  playSound(soundName, volume = 0.3) {
    audioManager.playSound(soundName, volume);
  }
}
