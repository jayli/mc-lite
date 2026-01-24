// src/entities/player/Physics.js
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
    this.gravity = -0.015;      // 重力加速度
    this.terminalVelocity = -1.0; // 终端速度（最大下落速度）
    this.playerHeight = 1.5;     // 玩家碰撞高度
    this.jumpForce = 0.25;       // 跳跃力
    this.speed = 0.12;           // 移动速度
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
    const y2 = Math.floor(this.player.position.y + this.playerHeight * 0.8);

    return this.isSolid(x, y1, z) || this.isSolid(x, y2, z);
  }

  /**
  * 判断指定方块坐标是否为实心
  * @param {number} x
  * @param {number} y
  * @param {number} z
  * @returns {boolean}
  */
  isSolid(x, y, z) {
  // 询问世界系统该位置是否为实心方块
    return this.world.isSolid(x, y, z);
  }

  /**
  * 物理更新逻辑
  */
  update() {
    // 物理更新由 Player 类调用
    // 此类目前主要提供辅助方法和存储物理参数
  }
}
