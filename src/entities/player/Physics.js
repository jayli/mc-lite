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
    this.gravity = -0.015;      // 重力加速度：每帧 Y 轴速度的改变量，负值表示向下坠落
    this.terminalVelocity = -1.0; // 终端速度：最大下落速度，防止重力加速度导致速度无限增大，避免穿透地面
    this.playerHeight = 1.9;     // 玩家碰撞高度：用于碰撞检测的高度，从 1.8 增加到 1.9 以匹配新的坐标系统
    this.jumpForce = 0.20;       // 跳跃初速度：跳跃瞬间向上的速度冲量
    this.speed = 0.13;           // 移动速度：每帧在 XZ 平面上移动的基础距离
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
    // 只检查头部和身体中部的碰撞，排除脚部支撑
    const x = nx;
    const z = nz;
    const y2 = Math.floor(this.player.position.y + this.playerHeight * 0.9);

    // 检查头部
    if (this.isSolid(x, y2, z)) {
      return true;
    }

    // 检查身体中部（大约玩家高度的一半）
    const yMid = Math.floor(this.player.position.y + this.playerHeight * 0.4);
    if (this.isSolid(x, yMid, z)) {
      return true;
    }

    return false;
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
