/**
 * MinecartCollisionSystem.js
 * 矿车碰撞检测系统 - 处理矿车之间的碰撞检测、推动和回弹
 *
 * 职责：
 * - 检测矿车碰撞
 * - 判断相向运动
 * - 处理推动碰撞
 * - 处理相向碰撞
 * - 回弹到最近铁轨位置
 */

import { MINECART_SPEED } from '../../constants/GameConfig.js';

/**
 * 矿车碰撞系统类
 */
export class MinecartCollisionSystem {
  /**
   * 检测矿车在指定位置是否与其他矿车碰撞
   * @param {Minecart} minecart - 当前矿车
   * @param {{x: number, y: number, z: number}} newPos - 新位置
   * @param {MinecartManager} manager - 矿车管理器
   * @returns {Minecart|null} 碰撞的矿车对象，无碰撞返回 null
   */
  checkCollision(minecart, newPos, manager) {
    if (!manager || !minecart) return null;

    const newX = Math.floor(newPos.x);
    const newY = Math.floor(newPos.y);
    const newZ = Math.floor(newPos.z);

    // 获取新位置的矿车（排除自己）
    const otherMinecart = manager.getMinecartAt(newX, newY, newZ);
    if (otherMinecart && otherMinecart.id !== minecart.id) {
      return otherMinecart;
    }

    return null;
  }

  /**
   * 判断两个矿车是否相向运动
   * @param {Minecart} minecartA - 矿车 A
   * @param {Minecart} minecartB - 矿车 B
   * @returns {boolean}
   */
  isHeadOn(minecartA, minecartB) {
    // 两个矿车都在移动
    if (minecartA.movementState === 'IDLE' || minecartB.movementState === 'IDLE') {
      return false;
    }

    // 检查是否朝向对方
    const ax = Math.floor(minecartA.position.x);
    const az = Math.floor(minecartA.position.z);
    const bx = Math.floor(minecartB.position.x);
    const bz = Math.floor(minecartB.position.z);

    // A 的前方位置
    const aFrontX = minecartA.movementState === 'MOVING_FORWARD'
      ? ax + (minecartA.orientation === 0 ? 1 : minecartA.orientation === 2 ? -1 : 0)
      : ax + (minecartA.orientation === 0 ? -1 : minecartA.orientation === 2 ? 1 : 0);
    const aFrontZ = minecartA.movementState === 'MOVING_FORWARD'
      ? az + (minecartA.orientation === 1 ? 1 : minecartA.orientation === 3 ? -1 : 0)
      : az + (minecartA.orientation === 1 ? -1 : minecartA.orientation === 3 ? 1 : 0);

    // B 的前方位置
    const bFrontX = minecartB.movementState === 'MOVING_FORWARD'
      ? bx + (minecartB.orientation === 0 ? 1 : minecartB.orientation === 2 ? -1 : 0)
      : bx + (minecartB.orientation === 0 ? -1 : minecartB.orientation === 2 ? 1 : 0);
    const bFrontZ = minecartB.movementState === 'MOVING_FORWARD'
      ? bz + (minecartB.orientation === 1 ? 1 : minecartB.orientation === 3 ? -1 : 0)
      : bz + (minecartB.orientation === 1 ? -1 : minecartB.orientation === 3 ? 1 : 0);

    // A 的前方是 B，B 的前方是 A → 相向运动
    return (aFrontX === bx && aFrontZ === bz) && (bFrontX === ax && bFrontZ === az);
  }

  /**
   * 处理推动碰撞（运动矿车撞静止矿车）
   * @param {Minecart} movingCart - 运动的矿车
   * @param {Minecart} staticCart - 静止的矿车
   * @param {MinecartManager} manager - 矿车管理器
   */
  handlePushCollision(movingCart, staticCart, manager) {
    // 静止矿车被推动，继承运动矿车的方向和速度
    staticCart.movementState = movingCart.movementState;
    staticCart.orientation = movingCart.orientation;
    staticCart.velocity = { x: movingCart.velocity.x, z: movingCart.velocity.z };

    // 初始化静止矿车的最近铁轨位置
    if (!staticCart.lastTrackPosition) {
      staticCart.lastTrackPosition = {
        x: Math.floor(staticCart.position.x),
        y: Math.floor(staticCart.position.y),
        z: Math.floor(staticCart.position.z)
      };
    }

    // 运动矿车继续前进（但稍微减速避免重叠）
    movingCart.velocity.x *= 0.5;
    movingCart.velocity.z *= 0.5;
  }

  /**
   * 处理相向碰撞（两个矿车相向运动碰撞）
   * @param {Minecart} cartA - 矿车 A
   * @param {Minecart} cartB - 矿车 B
   */
  handleHeadOnCollision(cartA, cartB) {
    // 两个矿车都停止
    cartA.movementState = 'IDLE';
    cartB.movementState = 'IDLE';
    cartA.velocity = { x: 0, z: 0 };
    cartB.velocity = { x: 0, z: 0 };

    // 两个矿车都回弹到最近铁轨位置
    this.bounceToLastTrack(cartA);
    this.bounceToLastTrack(cartB);

    // 处理链接矿车：通知所有链接矿车也停止并回弹
    this.stopLinkedMinecarts(cartA);
    this.stopLinkedMinecarts(cartB);
  }

  /**
   * 回弹到最近经过的铁轨位置
   * @param {Minecart} minecart - 矿车对象
   */
  bounceToLastTrack(minecart) {
    if (!minecart) return;

    if (minecart.lastTrackPosition) {
      // 回弹到最近铁轨位置
      minecart.position.x = minecart.lastTrackPosition.x;
      minecart.position.z = minecart.lastTrackPosition.z;
    } else {
      // 对齐到整数坐标
      minecart.position.x = Math.floor(minecart.position.x);
      minecart.position.z = Math.floor(minecart.position.z);
    }
  }

  /**
   * 停止所有链接矿车并回弹
   * @param {Minecart} minecart - 矿车对象
   */
  stopLinkedMinecarts(minecart) {
    if (!minecart || minecart.linkedMinecarts.size === 0) return;

    // 需要通过 manager 获取链接矿车，这里暂时只清理链接关系
    // 实际停止逻辑在 MinecartMovementSystem.stopMinecartAndLinked 中处理
    minecart.linkedMinecarts.forEach(linkedId => {
      // 链接矿车会在 MinecartMovementSystem 中被停止
    });
  }

  /**
   * 处理碰撞检测并返回处理结果
   * @param {Minecart} minecart - 当前矿车
   * @param {{x: number, y: number, z: number}} newPos - 新位置
   * @param {MinecartManager} manager - 矿车管理器
   * @param {Map<string, Minecart>} allMinecarts - 所有矿车集合
   * @returns {{handled: boolean, shouldStop: boolean}} 处理结果
   */
  handleCollision(minecart, newPos, manager, allMinecarts) {
    const otherCart = this.checkCollision(minecart, newPos, manager);

    if (!otherCart) {
      return { handled: false, shouldStop: false };
    }

    // 检查是否是链接矿车（链接矿车不触发碰撞处理）
    if (minecart.linkedMinecarts.has(otherCart.id) || otherCart.linkedMinecarts.has(minecart.id)) {
      return { handled: true, shouldStop: false }; // 跳过移动但不停
    }

    // 判断碰撞类型
    if (this.isHeadOn(minecart, otherCart)) {
      // 相向碰撞：两车都停止并回弹
      this.handleHeadOnCollision(minecart, otherCart);
      return { handled: true, shouldStop: true };
    } else if (otherCart.movementState === 'IDLE') {
      // 推动碰撞：静止矿车被推动
      this.handlePushCollision(minecart, otherCart, manager);
      return { handled: true, shouldStop: false };
    } else {
      // 其他碰撞情况（如追尾）：两车都停止
      minecart.movementState = 'IDLE';
      minecart.velocity = { x: 0, z: 0 };
      otherCart.movementState = 'IDLE';
      otherCart.velocity = { x: 0, z: 0 };
      this.bounceToLastTrack(minecart);
      this.bounceToLastTrack(otherCart);
      return { handled: true, shouldStop: true };
    }
  }
}

// 导出单例
export const minecartCollisionSystem = new MinecartCollisionSystem();