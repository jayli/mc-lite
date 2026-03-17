/**
 * Projectile.js
 * 炮弹类 - 表示炮塔发射的飞行炮弹
 */

import * as THREE from 'three';

export class Projectile {
  constructor() {
    // 标识
    this.id = Math.random().toString(36).substr(2, 9);

    // 状态
    this.isActive = false;

    // 位置和运动
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.speed = 20; // 格/秒
    this.maxDistance = 50; // 最大飞行距离
    this.distanceTraveled = 0;

    // 伤害
    this.damage = 1;

    // 视觉表现
    this.mesh = null;

    // 回调引用
    this.onHit = null;
    this.onMaxDistance = null;
  }

  /**
   * 初始化炮弹
   * @param {Object} params - 初始化参数
   * @param {THREE.Vector3} params.position - 起始位置
   * @param {THREE.Vector3} params.direction - 飞行方向（单位向量）
   * @param {Function} params.onHit - 命中回调 (enemy) => void
   * @param {Function} params.onMaxDistance - 超距回调 () => void
   */
  initialize(params) {
    this.position.copy(params.position);
    this.direction.copy(params.direction).normalize();
    this.speed = 20;
    this.maxDistance = 50;
    this.distanceTraveled = 0;
    this.damage = 1;
    this.isActive = true;
    this.onHit = params.onHit || null;
    this.onMaxDistance = params.onMaxDistance || null;

    // 创建/更新视觉表现
    this.createMesh();
  }

  /**
   * 创建炮弹的视觉网格
   */
  createMesh() {
    if (!this.mesh) {
      // 使用简单的球体表示炮弹
      const geometry = new THREE.SphereGeometry(0.15, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.9
      });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.name = 'projectile';
    }

    this.mesh.position.copy(this.position);
    this.mesh.visible = true;
  }

  /**
   * 更新炮弹状态
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Array} enemies - 丧尸列表，用于碰撞检测
   */
  update(deltaTime, enemies = []) {
    if (!this.isActive) return;

    // 计算移动距离
    const moveDistance = this.speed * deltaTime;

    // 更新位置
    const moveVector = this.direction.clone().multiplyScalar(moveDistance);
    this.position.add(moveVector);
    this.distanceTraveled += moveDistance;

    // 更新视觉位置
    if (this.mesh) {
      this.mesh.position.copy(this.position);
    }

    // 检查是否超出最大距离
    if (this.distanceTraveled >= this.maxDistance) {
      this.deactivate();
      if (this.onMaxDistance) {
        this.onMaxDistance();
      }
      return;
    }

    // 碰撞检测
    this.checkCollision(enemies);
  }

  /**
   * 检查与丧尸的碰撞
   * @param {Array} enemies - 丧尸列表
   */
  checkCollision(enemies) {
    const projectileRadius = 0.3;

    for (const enemy of enemies) {
      if (!enemy.isActive || enemy.isDead) continue;

      // 计算与丧尸的距离
      const enemyPos = enemy.position;
      const dx = this.position.x - enemyPos.x;
      const dy = this.position.y - enemyPos.y;
      const dz = this.position.z - enemyPos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // 丧尸碰撞半径（假设丧尸宽度约0.8格）
      const enemyRadius = 0.4;

      if (distance < projectileRadius + enemyRadius) {
        // 命中！
        this.onHitEnemy(enemy);
        return;
      }
    }
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
    if (this.mesh) {
      this.mesh.visible = false;
    }
  }

  /**
   * 清理资源
   */
  destroy() {
    this.deactivate();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }

  /**
   * 获取炮弹的世界位置
   * @returns {THREE.Vector3}
   */
  getPosition() {
    return this.position;
  }
}
