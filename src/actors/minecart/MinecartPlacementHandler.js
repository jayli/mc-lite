/**
 * MinecartPlacementHandler.js
 * 矿车放置处理器 - 封装矿车的放置逻辑
 *
 * 职责：
 * - 检查矿车是否可以放置（铁轨检查、空间检查、占用检查）
 * - 执行矿车放置（获取铁轨方向、创建矿车实例）
 */

import { EntityPlacementHandler } from '../entity-registry/EntityPlacementHandler.js';
import * as THREE from 'three';

// 铁轨方块类型
const TRACK_BLOCKS = ['sand_train_track', 'sand_train_track_corner'];

export class MinecartPlacementHandler extends EntityPlacementHandler {
  /**
   * @param {Object} params - 初始化参数
   * @param {Player} params.player - 玩家实例
   * @param {World} params.world - 世界实例
   * @param {Game} params.game - 游戏实例
   * @param {MinecartManager} params.minecartManager - 矿车管理器
   */
  constructor(params) {
    super(params);
    this.minecartManager = params.minecartManager;
  }

  /**
   * 检查是否可以在指定位置放置矿车
   *
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean}
   */
  canPlace(x, y, z) {
    // 检查矿车管理器是否可用
    if (!this.minecartManager) {
      console.warn('[MinecartPlacementHandler] MinecartManager 不可用');
      return false;
    }

    // 检查目标方块下方是否为铁轨
    const trackY = y - 1;
    const blockBelow = this.getBlockAt(x, trackY, z);

    if (!this.isTrackBlock(blockBelow)) {
      return false;
    }

    // 检查目标位置是否已被占用
    const { canPlace, reason } = this.minecartManager.canPlaceAt(x, y, z);
    if (!canPlace) {
      return false;
    }

    // 检查目标位置是否为空气
    const targetBlock = this.getBlockAt(x, y, z);
    if (targetBlock && targetBlock.type !== 'air') {
      return false;
    }

    return true;
  }

  /**
   * 在指定位置放置矿车
   *
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean}
   */
  place(x, y, z) {
    if (!this.canPlace(x, y, z)) {
      return false;
    }

    // 获取下方铁轨的 orientation
    const trackY = y - 1;
    const orientation = this.getTrackOrientation(x, trackY, z);

    // 创建矿车
    const position = new THREE.Vector3(x, y, z);
    const minecart = this.minecartManager.createMinecart(position, orientation);

    if (!minecart) {
      console.warn('[MinecartPlacementHandler] 创建矿车失败');
      return false;
    }

    // 消耗物品并播放音效
    this.consumeItem('mine_cart', 1);
    this.playSound('put', 0.3);

    return true;
  }

  /**
   * 检查方块是否为铁轨
   * @param {{ type: string, orientation: number }|null} block - 方块条目
   * @returns {boolean}
   */
  isTrackBlock(block) {
    if (!block) return false;
    // getBlockAt 返回的是已解析格式，直接使用 type
    return TRACK_BLOCKS.includes(block.type);
  }

  /**
   * 获取铁轨方块的 orientation
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {number} orientation (0-3)
   */
  getTrackOrientation(x, y, z) {
    // 使用 getBlockAt 获取完整信息
    const blockEntry = this.getBlockAt(x, y, z);
    if (blockEntry) {
      return blockEntry.orientation || 0;
    }
    return 0;
  }

  /**
   * 获取指定位置的方块完整信息（包含朝向）
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {{ type: string, orientation: number }|null}
   */
  getBlockAt(x, y, z) {
    if (!this.world) return null;

    // 使用 getBlockEntry 获取完整的方块信息（包含 orientation）
    if (typeof this.world.getBlockEntry === 'function') {
      return this.world.getBlockEntry(x, y, z);
    }

    // 回退：仅返回类型信息
    const type = this.world.getBlock ? this.world.getBlock(x, y, z) : null;
    return type ? { type, orientation: 0 } : null;
  }

  /**
   * 获取矿车放置所需的空间
   * @returns {Array<{dx: number, dy: number, dz: number}>}
   */
  getRequiredSpace() {
    // 矿车只需要放置点本身
    return [{ dx: 0, dy: 0, dz: 0 }];
  }
}