// src/entities/player/Physics.js
/**
 * 物理系统常量定义
 */
export const PHYSICS_CONSTANTS = {
  GRAVITY: -24.0,           // 调整为每秒重力 (约为 -0.4 * 60)
  TERMINAL_VELOCITY: -50.0,
  PLAYER_WIDTH: 0.6,
  PLAYER_HEIGHT: 1.8,
  HEAD_HEIGHT: 1.65,
  MAX_STEP: 1.0,
  MAX_JUMP_STEP: 2.0,
  FRICTION_SLIDE: 0.9,
  FRICTION_CORNER: 0.7,
  JUMP_FORCE: 10.0,         // 调整为冲量速度
  SPEED: 8.0,               // 调整为每秒速度 (约为 0.133 * 60)
  CAMERA_WIDTH: 0.3
};

import { getBlockProperties } from '../../constants/BlockData.js';

/**
 * 物理系统类，负责处理玩家的碰撞检测和运动物理常量
 */

export class Physics {
  /**
   * @param {Player} player - 玩家实例
   * @param {World} world - 世界实例
   */
  constructor(player, world) {
    this.player = player;
    this.world = world;

    // 物理参数（从常量初始化，以便后续可能的动态调整）
    this.gravity = PHYSICS_CONSTANTS.GRAVITY;
    this.terminalVelocity = PHYSICS_CONSTANTS.TERMINAL_VELOCITY;
    this.playerHeight = PHYSICS_CONSTANTS.PLAYER_HEIGHT;
    this.playerWidth = PHYSICS_CONSTANTS.PLAYER_WIDTH;
    this.jumpForce = PHYSICS_CONSTANTS.JUMP_FORCE;
    this.speed = PHYSICS_CONSTANTS.SPEED;
  }

  /**
   * 检查指定坐标是否发生碰撞
   * @param {number} nx - 下一步的 X 坐标
   * @param {number} nz - 下一步的 Z 坐标
   * @returns {boolean} - 是否发生碰撞
   */
  checkCollision(nx, nz) {
    // 简单的 AABB / 体素碰撞检测
    // 同时检查脚部和头部水平
    const x = nx;
    const z = nz;
    const y1 = Math.floor(this.player.position.y);
    const y2 = Math.floor(this.player.position.y + this.playerHeight * 0.9);

    return this.isSolid(x, y1, z) || this.isSolid(x, y2, z);
  }

  /**
   * 检查指定坐标是否发生碰撞（排除脚部支撑碰撞）
   * 用于水平移动检测，防止脚部支撑方块误判为阻挡
   * @param {number} nx - 下一步的 X 坐标
   * @param {number} nz - 下一步的 Z 坐标
   * @returns {boolean} - 是否发生碰撞
   */
  checkCollisionForMovement(nx, nz) {
    return this.checkAABB(nx, this.player.position.y, nz, true);
  }

  /**
   * 检查 AABB 碰撞
   * @param {number} x - 逻辑中心 X
   * @param {number} y - 逻辑底部 Y
   * @param {number} z - 逻辑中心 Z
   * @param {boolean} excludeFeet - 是否排除脚部检测 (用于上台阶)
   * @returns {boolean}
   */
  checkAABB(x, y, z, excludeFeet = false) {
    const halfW = this.playerWidth / 2;
    const minX = x - halfW;
    const maxX = x + halfW;
    const minZ = z - halfW;
    const maxZ = z + halfW;

    // Y 轴采样范围
    // 0.1 和 0.2 的偏移量用于确保不会因为微小的浮点数误差检测到地板或天花板
    const startY = excludeFeet ? y + 0.51 : y + 0.1;
    const endY = y + this.playerHeight - 0.1;

    // 检查 AABB 覆盖的所有方块
    for (let bx = Math.floor(minX); bx <= Math.floor(maxX); bx++) {
      for (let bz = Math.floor(minZ); bz <= Math.floor(maxZ); bz++) {
        for (let by = Math.floor(startY); by <= Math.floor(endY); by++) {
          if (this.isSolid(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  /**
   * 获取 AABB 碰撞的详细信息
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {Object|null} 碰撞点信息 {x, y, z, type}
   */
  getCollisionDetail(x, y, z) {
    const halfW = this.playerWidth / 2;
    const minX = x - halfW;
    const maxX = x + halfW;
    const minZ = z - halfW;
    const maxZ = z + halfW;
    const startY = y + 0.1;
    const endY = y + this.playerHeight - 0.1;

    for (let bx = Math.floor(minX); bx <= Math.floor(maxX); bx++) {
      for (let bz = Math.floor(minZ); bz <= Math.floor(maxZ); bz++) {
        for (let by = Math.floor(startY); by <= Math.floor(endY); by++) {
          if (this.isSolid(bx, by, bz)) {
            return { x: bx, y: by, z: bz };
          }
        }
      }
    }
    return null;
  }

  /**
   * 处理滑动碰撞响应
   * @param {number} velocity - 该轴的速度
   * @returns {number} 调整后的速度
   */
  applyFriction(velocity) {
    // T006: 应用滑动摩擦力
    return velocity * PHYSICS_CONSTANTS.FRICTION_SLIDE;
  }

  /**
   * 检查是否处于凸角碰撞状态并应用惩罚
   * @param {number} dx - X 轴预期移动
   * @param {number} dz - Z 轴预期移动
   * @returns {number} 速度系数
   */
  getCornerPenalty(dx, dz) {
    // T007: 如果是斜向移动且发生碰撞，应用 0.7 惩罚
    if (Math.abs(dx) > 0.001 && Math.abs(dz) > 0.001) {
      return PHYSICS_CONSTANTS.FRICTION_CORNER;
    }
    return 1.0;
  }

  /**
   * 穿模推回逻辑 (T018)
   * 如果玩家由于某种原因卡在方块内，将其推向最近的空气
   */
  applyPushOut() {
    const px = this.player.position.x;
    const py = this.player.position.y;
    const pz = this.player.position.z;

    // 如果当前位置没有卡住，不需要推回
    if (!this.checkAABB(px, py, pz)) return;

    // 检查 6 个邻居方向
    const offsets = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    const pushStep = 0.1;
    for (const [ox, oy, oz] of offsets) {
      const nx = px + ox * pushStep;
      const ny = py + oy * pushStep;
      const nz = pz + oz * pushStep;

      if (!this.checkAABB(nx, ny, nz)) {
        this.player.position.set(nx, ny, nz);
        return;
      }
    }
  }

  /**
  * 判断指定方块坐标是否为实心
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @returns {boolean}
  */
  isSolid(x, y, z) {
    // 1. 询问世界系统该位置是否为实心方块 (基于 solidBlocks 集合)
    if (this.world.isSolid(x, y, z)) return true;

    // 2. 从方块属性配置中获取是否为实心
    const type = this.world.getBlock(x, y, z);
    if (!type) return false;

    return getBlockProperties(type).isSolid;
  }

  /**
  * 物理更新逻辑
  */
  update() {
    // 物理更新由 Player 类调用
    // 此类目前主要提供辅助方法和存储物理参数
  }
}
