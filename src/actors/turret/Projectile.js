/**
 * Projectile.js
 * 炮弹类 - 表示炮塔发射的飞行炮弹（InstancedMesh 版本）
 */

import * as THREE from 'three';

export class Projectile {
  constructor() {
    // 标识
    this.id = Math.random().toString(36).slice(2, 11);

    // 状态
    this.isActive = false;

    // 位置和运动
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.speed = 40; // 格/秒
    this.maxDistance = 50; // 最大飞行距离
    this.distanceTraveled = 0;

    // 伤害
    this.damage = 1;

    // InstancedMesh 索引
    this.instanceIndex = -1;

    // 回调引用
    this.onHit = null;
    this.onMaxDistance = null;
  }

  /**
   * 初始化炮弹
   * @param {Object} params - 初始化参数
   * @param {THREE.Vector3} params.position - 起始位置
   * @param {THREE.Vector3} params.direction - 飞行方向（单位向量）
   * @param {number} params.instanceIndex - InstancedMesh 实例索引
   * @param {Function} params.onHit - 命中回调 (enemy) => void
   * @param {Function} params.onMaxDistance - 超距回调 () => void
   */
  initialize(params) {
    this.position.copy(params.position);
    this.direction.copy(params.direction).normalize();
    this.speed = 40;
    this.maxDistance = 50;
    this.distanceTraveled = 0;
    this.damage = 1;
    this.isActive = true;
    this.instanceIndex = params.instanceIndex ?? -1;
    this.onHit = params.onHit || null;
    this.onMaxDistance = params.onMaxDistance || null;
  }

  /**
   * 更新炮弹状态
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Array} enemies - 丧尸列表，用于碰撞检测
   * @returns {boolean} 返回 true 表示炮弹仍活跃，false 表示已停用
   */
  update(deltaTime, enemies = []) {
    if (!this.isActive) return false;

    // 计算移动距离
    const moveDistance = this.speed * deltaTime;

    // 保存旧位置用于线段碰撞检测
    const oldPosition = this.position.clone();

    // 更新位置
    const moveVector = this.direction.clone().multiplyScalar(moveDistance);
    this.position.add(moveVector);
    this.distanceTraveled += moveDistance;

    // 检查是否超出最大距离
    if (this.distanceTraveled >= this.maxDistance) {
      this.deactivate();
      if (this.onMaxDistance) {
        this.onMaxDistance();
      }
      return false;
    }

    // 碰撞检测（使用线段检测避免跳过目标）
    const hit = this.checkCollisionWithSegment(oldPosition, this.position, enemies);
    if (hit) {
      this.onHitEnemy(hit);
      return false;
    }

    return true;
  }

  /**
   * 检查与丧尸的线段碰撞检测（避免炮弹跳过目标）
   * @param {THREE.Vector3} startPos - 起始位置
   * @param {THREE.Vector3} endPos - 结束位置
   * @param {Array} enemies - 丧尸列表
   * @returns {Object|null} 返回命中的敌人或 null
   */
  checkCollisionWithSegment(startPos, endPos, enemies) {
    const projectileRadius = 0.3;

    for (const enemy of enemies) {
      if (!enemy.isActive || enemy.isDead) continue;

      // 瞄准丧尸上半身（胸部位置，脚底 + 1.2）
      const enemyCenter = {
        x: enemy.position.x,
        y: enemy.position.y + 1.2,
        z: enemy.position.z
      };

      // 丧尸碰撞半径（宽0.6，考虑整体范围）
      const enemyRadius = 0.5;

      // 计算线段到丧尸中心的最短距离
      const dist = this.distanceFromPointToSegment(enemyCenter, startPos, endPos);

      if (dist < projectileRadius + enemyRadius) {
        // 命中！
        return enemy;
      }
    }

    return null;
  }

  /**
   * 计算点到线段的最短距离
   * @param {Object} point - 点坐标 {x, y, z}
   * @param {THREE.Vector3} segStart - 线段起点
   * @param {THREE.Vector3} segEnd - 线段终点
   * @returns {number} 最短距离
   */
  distanceFromPointToSegment(point, segStart, segEnd) {
    const px = point.x;
    const py = point.y;
    const pz = point.z;

    const x1 = segStart.x, y1 = segStart.y, z1 = segStart.z;
    const x2 = segEnd.x, y2 = segEnd.y, z2 = segEnd.z;

    // 线段向量
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;

    // 线段长度的平方
    const lenSq = dx * dx + dy * dy + dz * dz;

    if (lenSq === 0) {
      // 线段退化为点
      const ddx = px - x1;
      const ddy = py - y1;
      const ddz = pz - z1;
      return Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    }

    // 计算投影参数 t（0到1之间表示在线段内）
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy + (pz - z1) * dz) / lenSq));

    // 最近点坐标
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;
    const closestZ = z1 + t * dz;

    // 计算距离
    const distX = px - closestX;
    const distY = py - closestY;
    const distZ = pz - closestZ;

    return Math.sqrt(distX * distX + distY * distY + distZ * distZ);
  }

  /**
   * 命中丧尸的处理
   * @param {Object} enemy - 被命中的丧尸
   */
  onHitEnemy(enemy) {
    this.deactivate();
    if (this.onHit) {
      this.onHit(enemy);
    }
  }

  /**
   * 停用炮弹（回收进对象池）
   */
  deactivate() {
    this.isActive = false;
  }

  /**
   * 清理资源
   */
  destroy() {
    this.deactivate();
    this.instanceIndex = -1;
  }

  /**
   * 获取炮弹的世界位置
   * @returns {THREE.Vector3}
   */
  getPosition() {
    return this.position;
  }
}
