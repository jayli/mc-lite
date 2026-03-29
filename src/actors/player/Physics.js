// src/actors/player/Physics.js
/**
 * 物理系统常量定义
 */
export const PHYSICS_CONSTANTS = {
  GRAVITY: -24.0,           // 重力加速度 (-24.0 单位/秒²，约为 -0.4 * 60，向下为负)
  TERMINAL_VELOCITY: -50.0, // 终端速度，物体下落的最大速度限制
  PLAYER_WIDTH: 0.6,        // 玩家碰撞体宽度 (0.6 单位)
  PLAYER_HEIGHT: 1.8,       // 玩家碰撞体高度 (1.8 单位)
  HEAD_HEIGHT: 1.65,        // 玩家头部高度 (1.65 单位，用于相机位置)
  MAX_STEP: 1.0,            // 最大上台阶高度 (1.0 单位)
  MAX_JUMP_STEP: 2.0,       // 跳跃时的最大上台阶高度 (2.0 单位)
  FRICTION_SLIDE: 0.9,      // 滑动摩擦系数 (0.9，用于减速)
  FRICTION_CORNER: 0.7,     // 转弯时的摩擦系数 (0.7，用于对角移动减速)
  JUMP_FORCE: 10.0,         // 跳跃力度 (10.0 单位，向上冲量速度)
  SPEED: 8.0,               // 玩家移动速度 (8.0 单位/秒)
  CAMERA_WIDTH: 0.3         // 相机碰撞体宽度 (0.3 单位)
};

import * as THREE from 'three';
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

    // 物理参数
    this.gravity = PHYSICS_CONSTANTS.GRAVITY;           // 重力加速度
    this.terminalVelocity = PHYSICS_CONSTANTS.TERMINAL_VELOCITY; // 终端速度（最大下落速度）
    this.playerHeight = PHYSICS_CONSTANTS.PLAYER_HEIGHT; // 玩家高度
    this.playerWidth = PHYSICS_CONSTANTS.PLAYER_WIDTH;   // 玩家宽度
    this.jumpForce = PHYSICS_CONSTANTS.JUMP_FORCE;       // 跳跃力度
    this.speed = PHYSICS_CONSTANTS.SPEED;               // 移动速度

    // 单帧查询缓存：避免同一帧内重复查询同一坐标
    this._solidQueryCache = new Map();
    this._isFrameCacheActive = false;
  }

  /**
   * 每帧开始时清理缓存，保证缓存只在当前帧生效
   */
  beginFrame() {
    this._isFrameCacheActive = true;
    this._solidQueryCache.clear();
  }

  /**
   * 每帧结束后关闭缓存，避免帧外事件读取到旧查询结果
   */
  endFrame() {
    this._isFrameCacheActive = false;
    this._solidQueryCache.clear();
  }

  /**
   * 检查指定坐标是否发生碰撞
   */
  checkCollision(nx, nz) {
    const x = nx;
    const z = nz;
    const y1 = Math.floor(this.player.position.y);
    const y2 = Math.floor(this.player.position.y + this.playerHeight * 0.9);

    return this.isSolid(x, y1, z) || this.isSolid(x, y2, z);
  }

  /**
   * 检查指定位置是否有矿车，并返回矿车对象
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标（用于检测矿车所在格子）
   * @param {number} z - Z 坐标
   * @returns {Object|null} 矿车对象或 null
   */
  getMinecartAt(x, y, z) {
    if (!this.player.game?.minecartManager) return null;
    return this.player.game.minecartManager.getMinecartAt(
      Math.floor(x),
      Math.floor(y),
      Math.floor(z)
    );
  }

  /**
   * 检查 AABB 碰撞
   */
  checkAABB(x, y, z, excludeFeet = false) {
    const halfW = this.playerWidth / 2;
    const minX = x - halfW;
    const maxX = x + halfW;
    const minZ = z - halfW;
    const maxZ = z + halfW;

    const startY = excludeFeet ? y + 0.51 : y + 0.1;
    const endY = y + this.playerHeight - 0.1;

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
   * 处理滑动摩擦力
   */
  applyFriction(velocity) {
    return velocity * PHYSICS_CONSTANTS.FRICTION_SLIDE;
  }

  /**
   * 应用凸角惩罚
   */
  getCornerPenalty(dx, dz) {
    if (Math.abs(dx) > 0.001 && Math.abs(dz) > 0.001) {
      return PHYSICS_CONSTANTS.FRICTION_CORNER;
    }
    return 1.0;
  }

  /**
   * 穿模推回逻辑
   */
  applyPushOut() {
    const px = this.player.position.x;
    const py = this.player.position.y;
    const pz = this.player.position.z;

    if (!this.checkAABB(px, py, pz)) return;

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
   * 尝试执行上台阶逻辑
   */
  tryStepUp(nx, nz) {
    const feetY = Math.floor(this.player.position.y - 0.01);
    let isSupported = false;
    const halfW = this.playerWidth / 2;
    const checkCoords = [
      [this.player.position.x, this.player.position.z],
      [this.player.position.x - halfW + 0.05, this.player.position.z - halfW + 0.05],
      [this.player.position.x + halfW - 0.05, this.player.position.z - halfW + 0.05],
      [this.player.position.x - halfW + 0.05, this.player.position.z + halfW - 0.05],
      [this.player.position.x + halfW - 0.05, this.player.position.z + halfW - 0.05]
    ];
    for (const [cx, cz] of checkCoords) {
      const blockType = this.world.getBlock(cx, feetY, cz);
      if (this.isSolid(cx, feetY, cz) || blockType === 'cloud') {
        isSupported = true;
        break;
      }
    }
    if (!isSupported) return false;

    const maxStep = (this.player.jumping && this.player.velocity.y > 0) ? 2.0 : 1.0;
    const currentFloorY = feetY + 1;

    // 首先检查目标位置是否有矿车，矿车可以踩上去
    const targetMinecart = this.getMinecartAt(nx, feetY, nz);
    if (targetMinecart) {
      const minecartTopY = targetMinecart.position.y + 0.9;
      // 检查矿车顶部是否有空间
      if (!this.checkAABB(nx, minecartTopY, nz)) {
        this.player.position.y = minecartTopY;
        this.player.position.x = nx;
        this.player.position.z = nz;
        this.player.velocity.y = 0;
        return true;
      }
    }

    for (let h = 1; h <= maxStep; h++) {
      const stepY = currentFloorY + h;
      const halfWCheck = 0.3;
      const ty = Math.floor(stepY - 1);
      let foundHandrail = false;
      for (const ox of [-halfWCheck, 0, halfWCheck]) {
        for (const oz of [-halfWCheck, 0, halfWCheck]) {
          const bType = this.world.getBlock(Math.floor(nx + ox), ty, Math.floor(nz + oz));
          if (bType === 'handrail' || bType === 'handrailA' || bType === 'handrailB') {
            foundHandrail = true;
            break;
          }
        }
        if (foundHandrail) break;
      }
      if (foundHandrail) continue;

      if (!this.checkAABB(nx, stepY, nz)) {
        if (!this.checkAABB(this.player.position.x, stepY, this.player.position.z)) {
          this.player.position.y = stepY;
          this.player.position.x = nx;
          this.player.position.z = nz;
          this.player.velocity.y = 0;

          if (h > 1.0) {
            this.player.spaceKeyReleased = false;
          }
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 检查头顶碰撞
   */
  checkCeilingBump() {
    if (this.player.velocity.y > 0) {
      if (this.checkAABB(this.player.position.x, this.player.position.y + 0.1, this.player.position.z)) {
        this.player.velocity.y = -0.01;
        return true;
      }
    }
    return false;
  }

  /**
   * 应用坑道自动对中逻辑
   */
  applyTunnelCentering() {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const py = this.player.position.y;
    const floorX = Math.floor(px);
    const floorZ = Math.floor(pz);
    const floorY = Math.floor(py + 0.1);

    const northSolid = this.isSolid(floorX, floorY, floorZ - 1);
    const southSolid = this.isSolid(floorX, floorY, floorZ + 1);
    const northHeadSolid = this.isSolid(floorX, floorY + 1, floorZ - 1);
    const southHeadSolid = this.isSolid(floorX, floorY + 1, floorZ + 1);

    if ((northSolid && southSolid) || (northHeadSolid && southHeadSolid)) {
      this.player.position.z = THREE.MathUtils.lerp(this.player.position.z, floorZ + 0.5, 0.1);
    }

    const westSolid = this.isSolid(floorX - 1, floorY, floorZ);
    const eastSolid = this.isSolid(floorX + 1, floorY, floorZ);
    const westHeadSolid = this.isSolid(floorX - 1, floorY + 1, floorZ);
    const eastHeadSolid = this.isSolid(floorX + 1, floorY + 1, floorZ);

    if ((westSolid && eastSolid) || (westHeadSolid && eastHeadSolid)) {
      this.player.position.x = THREE.MathUtils.lerp(this.player.position.x, floorX + 0.5, 0.1);
    }
  }

  /**
   * 相机碰撞保护
   */
  applyCameraBumper() {
    const yaw = this.player.rotation.y;
    const bumperDist = 0.25;
    const cameraHalfWidth = 0.2;

    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;

    const eyeY = this.player.position.y + 1.65;
    const floorY = Math.floor(eyeY);

    const points = [
      { x: this.player.position.x + fwdX * bumperDist, z: this.player.position.z + fwdZ * bumperDist },
      { x: this.player.position.x + fwdX * bumperDist - rightX * cameraHalfWidth, z: this.player.position.z + fwdZ * bumperDist - rightZ * cameraHalfWidth },
      { x: this.player.position.x + fwdX * bumperDist + rightX * cameraHalfWidth, z: this.player.position.z + fwdZ * bumperDist + rightZ * cameraHalfWidth }
    ];

    for (const p of points) {
      if (this.isSolid(Math.floor(p.x), floorY, Math.floor(p.z))) {
        const pushForce = 0.05;
        this.player.position.x -= fwdX * pushForce;
        this.player.position.z -= fwdZ * pushForce;
        return true;
      }
    }
    return false;
  }

  /**
  * 判断指定方块坐标是否为实心
  */
  isSolid(x, y, z) {
    const cacheKey = `${x},${y},${z}`;

    if (this._isFrameCacheActive && this._solidQueryCache.has(cacheKey)) {
      return this._solidQueryCache.get(cacheKey);
    }

    let result = false;
    if (this.world.isSolid(x, y, z)) {
      result = true;
    } else {
      const type = this.world.getBlock(x, y, z);
      result = !!(type && getBlockProperties(type).isSolid);
    }

    // 检查矿车碰撞
    if (!result && this.player.game?.minecartManager) {
      const minecart = this.player.game.minecartManager.getMinecartAt(
        Math.floor(x),
        Math.floor(y),
        Math.floor(z)
      );
      if (minecart) {
        result = true;
      }
    }

    if (this._isFrameCacheActive) {
      this._solidQueryCache.set(cacheKey, result);
    }
    return result;
  }
}
