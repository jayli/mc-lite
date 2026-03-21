/**
 * TurretPlacementHandler.js
 * 炮塔放置处理器 - 封装炮塔的放置逻辑
 *
 * 职责：
 * - 检查炮塔是否可以放置（数量限制、空间检查、碰撞检测）
 * - 执行炮塔放置（放置底座、柱子、创建炮塔实例）
 */

import * as THREE from 'three';
import { EntityPlacementHandler } from '../entity-registry/EntityPlacementHandler.js';
import { audioManager } from '../../core/AudioManager.js';

/**
 * 炮塔放置处理器
 */
export class TurretPlacementHandler extends EntityPlacementHandler {
  /**
   * @param {Object} params - 初始化参数
   * @param {Player} params.player - 玩家实例
   * @param {World} params.world - 世界实例
   * @param {Game} params.game - 游戏实例
   * @param {TurretManager} params.turretManager - 炮塔管理器
   */
  constructor(params) {
    super(params);
    this.turretManager = params.turretManager;
  }

  /**
   * 检查是否可以在指定位置放置炮塔
   *
   * @param {number} x - 方块X坐标
   * @param {number} y - 方块Y坐标
   * @param {number} z - 方块Z坐标
   * @returns {boolean}
   */
  canPlace(x, y, z) {
    // 检查炮塔管理器是否可用
    if (!this.turretManager) {
      console.warn('[TurretPlacementHandler] TurretManager 不可用');
      return false;
    }

    // 检查炮塔数量限制
    if (this.turretManager.turrets.size >= this.turretManager.maxTurrets) {
      console.warn('[TurretPlacementHandler] 已达到最大炮塔数量限制，无法放置');
      return false;
    }

    // 检查基础位置是否被占用
    if (this.player.physics?.isSolid(x, y, z)) {
      return false;
    }

    // 检查底座 3x3 空间是否可用
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (this.player.physics?.isSolid(x + dx, y, z + dz)) {
          console.warn(`[TurretPlacementHandler] 底座位置 (${x + dx}, ${y}, ${z + dz}) 被占用，无法放置炮塔`);
          return false;
        }
      }
    }

    // 检查 obsidian 柱子上方空间是否可用
    if (this.player.physics?.isSolid(x, y + 1, z) || this.player.physics?.isSolid(x, y + 2, z)) {
      console.warn('[TurretPlacementHandler] 上方空间被占用，无法放置炮塔');
      return false;
    }

    // 检查是否与玩家碰撞（整个炮塔占据的3格高度）
    if (this.player.position.x - 0.3 < x + 1 &&
        this.player.position.x + 0.3 > x &&
        this.player.position.y < y + 2 &&
        this.player.position.y + 1.8 > y &&
        this.player.position.z - 0.3 < z + 1 &&
        this.player.position.z + 0.3 > z) {
      return false;
    }

    return true;
  }

  /**
   * 在指定位置放置炮塔
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

    // 放置 3x3 iron_ore 底座
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.world.setBlock(x + dx, y, z + dz, 'iron_ore', 0);
      }
    }

    // 放置 obsidian 柱子（中心位置，y+1 和 y+2）
    this.world.setBlock(x, y + 1, z, 'obsidian', 0);
    this.world.setBlock(x, y + 2, z, 'obsidian', 0);

    // 计算玩家相对于炮塔的方向，选择最接近的四个方向之一
    const playerPos = this.player.position;
    const dx = playerPos.x - (x + 0.5);  // 炮塔中心X
    const dz = playerPos.z - (z + 0.5);  // 炮塔中心Z

    // 四个方向的弧度值
    const DIRECTIONS = {
      NORTH: 0,           // +Z
      EAST: Math.PI / 2,  // +X
      SOUTH: Math.PI,     // -Z
      WEST: -Math.PI / 2  // -X (或 3π/2)
    };

    // 根据玩家位置选择最接近的方向（使炮塔朝向玩家）
    let initialRotation;
    if (Math.abs(dx) > Math.abs(dz)) {
      // 玩家在东西方向更远
      initialRotation = dx > 0 ? DIRECTIONS.EAST : DIRECTIONS.WEST;
    } else {
      // 玩家在南北方向更远（或相等，默认南北）
      initialRotation = dz > 0 ? DIRECTIONS.NORTH : DIRECTIONS.SOUTH;
    }

    // 创建炮塔位置
    const position = new THREE.Vector3(x, y, z);

    // 调用 TurretManager 创建炮塔
    const turret = this.turretManager.createTurret(position, initialRotation);

    if (!turret) {
      console.warn('[TurretPlacementHandler] 创建炮塔失败');
      return false;
    }

    // 消耗物品并播放音效
    this.player.inventory?.remove('turret_alias_block', 1);
    audioManager.playSound('put', 0.3);

    console.log(`[TurretPlacementHandler] 炮塔放置成功 at (${x}, ${y}, ${z})`);
    return true;
  }

  /**
   * 获取炮塔放置所需的空间
   * @returns {Array<{dx: number, dy: number, dz: number}>}
   */
  getRequiredSpace() {
    // 炮塔需要 3x3 的底座和上方 2 格空间
    const space = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        space.push({ dx, dy: 0, dz });
      }
    }
    space.push({ dx: 0, dy: 1, dz: 0 });
    space.push({ dx: 0, dy: 2, dz: 0 });
    return space;
  }
}
