/**
 * MinecartLinkDetector.js
 * 矿车链接检测模块 - 检测相邻矿车形成链接关系
 *
 * 职责：
 * - 检测相邻铁轨上的矿车
 * - 构建链接关系
 * - 递归查找所有链接矿车
 */

import { MAX_LINKED_MINECARTS } from '../../constants/GameConfig.js';

/**
 * 方向向量映射表
 */
const DIRECTION_VECTORS = {
  0: { x: 1, z: 0 },   // EAST
  1: { x: 0, z: 1 },   // SOUTH
  2: { x: -1, z: 0 },  // WEST
  3: { x: 0, z: -1 }   // NORTH
};

/**
 * 矿车链接检测器类
 */
export class MinecartLinkDetector {
  /**
   * 检测单个矿车的相邻链接
   * @param {Minecart} minecart - 矿车对象
   * @param {MinecartManager} manager - 矿车管理器
   * @returns {Set<string>} 链接的矿车 ID 集合
   */
  detectLinks(minecart, manager) {
    const links = new Set();

    if (!manager || !minecart) return links;

    // 获取矿车前后的位置
    const direction = DIRECTION_VECTORS[minecart.orientation] || DIRECTION_VECTORS[0];

    // 前方位置
    const frontX = Math.floor(minecart.position.x) + direction.x;
    const frontZ = Math.floor(minecart.position.z) + direction.z;
    const frontMinecart = manager.getMinecartAt(frontX, minecart.position.y, frontZ);

    // 后方位置
    const backX = Math.floor(minecart.position.x) - direction.x;
    const backZ = Math.floor(minecart.position.z) - direction.z;
    const backMinecart = manager.getMinecartAt(backX, minecart.position.y, backZ);

    // 检查前方矿车是否可以链接（同方向）
    if (frontMinecart && frontMinecart.orientation === minecart.orientation) {
      links.add(frontMinecart.id);
    }

    // 检查后方矿车是否可以链接（同方向）
    if (backMinecart && backMinecart.orientation === minecart.orientation) {
      links.add(backMinecart.id);
    }

    return links;
  }

  /**
   * 递归查找所有链接的矿车
   * @param {Minecart} minecart - 起始矿车
   * @param {MinecartManager} manager - 矿车管理器
   * @param {Set<string>} visited - 已访问的矿车 ID
   * @returns {Array<Minecart>} 所有链接的矿车数组（包含起始矿车）
   */
  findAllLinked(minecart, manager, visited = new Set()) {
    const result = [];

    if (!minecart || !manager) return result;
    if (visited.has(minecart.id)) return result;
    if (visited.size >= MAX_LINKED_MINECARTS) return result;

    // 标记为已访问
    visited.add(minecart.id);
    result.push(minecart);

    // 获取相邻链接
    const links = this.detectLinks(minecart, manager);

    // 递归查找
    for (const linkedId of links) {
      if (visited.size >= MAX_LINKED_MINECARTS) break;

      const linkedMinecart = manager.activeMinecarts.get(linkedId);
      if (linkedMinecart && !visited.has(linkedId)) {
        const subResult = this.findAllLinked(linkedMinecart, manager, visited);
        result.push(...subResult);
      }
    }

    return result;
  }

  /**
   * 激活所有链接的矿车
   * @param {Minecart} minecart - 被激活的矿车
   * @param {MinecartManager} manager - 矿车管理器
   * @param {string} movementState - 移动状态 ('MOVING_FORWARD' | 'MOVING_BACKWARD')
   * @returns {Array<Minecart>} 被激活的所有矿车
   */
  activateLinkedMinecarts(minecart, manager, movementState) {
    const allLinked = this.findAllLinked(minecart, manager);

    // 使用移动系统检查轨道方向并调整每个矿车的朝向
    if (manager.movementSystem) {
      const movementSystem = manager.movementSystem;

      // 先检查领头矿车是否可以移动
      const canMove = movementSystem.alignMinecartToTrack(minecart, movementState);
      if (!canMove) {
        // 没有可用轨道，不激活
        return [];
      }

      // 对每个链接矿车也调整朝向（保持与领头矿车相同的朝向）
      const leaderOrientation = minecart.orientation;
      for (const linked of allLinked) {
        if (linked.id !== minecart.id) {
          // 检查链接矿车位置的可用轨道方向
          const availableDirs = movementSystem.getAvailableTrackDirections(linked);
          if (availableDirs.includes(leaderOrientation)) {
            linked.orientation = leaderOrientation;
          } else if (availableDirs.includes((leaderOrientation + 2) % 4)) {
            // 反方向
            linked.orientation = (leaderOrientation + 2) % 4;
          } else if (availableDirs.length > 0) {
            // 选择一个可用方向
            linked.orientation = availableDirs[0];
          }
        }
      }
    }

    for (const linked of allLinked) {
      linked.movementState = movementState;
      linked.velocity = { x: 0, z: 0 }; // 将由移动系统计算

      // 初始化最近铁轨位置
      if (!linked.lastTrackPosition) {
        linked.lastTrackPosition = {
          x: Math.floor(linked.position.x),
          y: Math.floor(linked.position.y),
          z: Math.floor(linked.position.z)
        };
      }

      // 更新链接关系
      for (const other of allLinked) {
        if (other.id !== linked.id) {
          linked.linkedMinecarts.add(other.id);
        }
      }
    }

    return allLinked;
  }

  /**
   * 断开矿车的链接关系
   * @param {Minecart} minecart - 矿车对象
   * @param {MinecartManager} manager - 矿车管理器
   */
  breakLinks(minecart, manager) {
    if (!minecart || !manager) return;

    // 通知链接的矿车停止
    for (const linkedId of minecart.linkedMinecarts) {
      const linked = manager.activeMinecarts.get(linkedId);
      if (linked) {
        linked.movementState = 'IDLE';
        linked.velocity = { x: 0, z: 0 };
        linked.linkedMinecarts.delete(minecart.id);
      }
    }

    // 清空自己的链接
    minecart.linkedMinecarts.clear();
  }
}

// 导出单例
export const minecartLinkDetector = new MinecartLinkDetector();