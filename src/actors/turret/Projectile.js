/**
 * Projectile.js
 * 炮弹类 - 表示炮塔发射的飞行炮弹（InstancedMesh 版本）
 */

import * as THREE from 'three';
import { getBlockProperties } from '../../constants/BlockData.js';
import { TURRET_CONFIG } from './Turret.js';

export class Projectile {
  constructor() {
    // 标识
    this.id = Math.random().toString(36).slice(2, 11);

    // 状态
    this.isActive = false;

    // 位置和运动
    this.position = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.speed = TURRET_CONFIG.PROJECTILE_SPEED;
    this.maxDistance = TURRET_CONFIG.MAX_KILL_DISTANCE;
    this.distanceTraveled = 0;

    // 伤害
    this.damage = 1;

    // InstancedMesh 索引
    this.instanceIndex = -1;

    // 回调引用
    this.onHit = null;
    this.onMaxDistance = null;

    // 临时变量（避免每帧 clone 产生 GC 压力）
    this._tempOldPos = new THREE.Vector3();
    this._tempMoveVec = new THREE.Vector3();

    // 缓存常量与方块遮挡类型查询结果，减少热路径重复计算
    this._projectileRadius = 0.3;
    this._enemyRadius = 0.5;
    this._hitRadiusSq = (this._projectileRadius + this._enemyRadius) ** 2;
    this._occlusionTypeCache = new Map();
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
    this.speed = TURRET_CONFIG.PROJECTILE_SPEED;
    this.maxDistance = TURRET_CONFIG.MAX_KILL_DISTANCE;
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
   * @param {World} world - 世界引用，用于方块碰撞检测
   * @returns {boolean} 返回 true 表示炮弹仍活跃，false 表示已停用
   */
  update(deltaTime, enemies = [], world = null) {
    if (!this.isActive) return false;

    // 计算移动距离
    const moveDistance = this.speed * deltaTime;

    // 保存旧位置用于线段碰撞检测（复用临时变量，避免 clone）
    this._tempOldPos.copy(this.position);

    // 更新位置（复用临时变量，避免 clone）
    this._tempMoveVec.copy(this.direction).multiplyScalar(moveDistance);
    this.position.add(this._tempMoveVec);
    this.distanceTraveled += moveDistance;

    // 检查是否超出最大距离
    if (this.distanceTraveled >= this.maxDistance) {
      this.deactivate();
      if (this.onMaxDistance) {
        this.onMaxDistance();
      }
      return false;
    }

    // 方块碰撞检测（双点检测：起点和终点）
    if (world) {
      const blockHit = this.checkCollisionWithBlocks(this._tempOldPos, this.position, world);
      if (blockHit) {
        this.deactivate();
        return false;
      }
    }

    // 碰撞检测（使用线段检测避免跳过目标）
    const hit = this.checkCollisionWithSegment(this._tempOldPos, this.position, enemies);
    if (hit) {
      this.onHitEnemy(hit);
      return false;
    }

    return true;
  }

  /**
   * 检查与方块的碰撞（双点检测：起点和终点）
   * 炮弹不能穿透实心不透明方块，但可以穿透透明方块
   * @param {THREE.Vector3} startPos - 起始位置
   * @param {THREE.Vector3} endPos - 结束位置
   * @param {World} world - 世界引用
   * @returns {boolean} 是否发生碰撞
   */
  checkCollisionWithBlocks(startPos, endPos, world) {
    if (!world || !world.getBlock) return false;
    const x1 = Math.floor(startPos.x);
    const y1 = Math.floor(startPos.y);
    const z1 = Math.floor(startPos.z);

    if (this.isBlockOccluding(world.getBlock(x1, y1, z1))) {
      return true;
    }

    const x2 = Math.floor(endPos.x);
    const y2 = Math.floor(endPos.y);
    const z2 = Math.floor(endPos.z);

    // 起点终点在同一体素时，避免重复查询
    if (x1 === x2 && y1 === y2 && z1 === z2) {
      return false;
    }

    return this.isBlockOccluding(world.getBlock(x2, y2, z2));
  }

  /**
   * 检查与丧尸的线段碰撞检测（避免炮弹跳过目标）
   * @param {THREE.Vector3} startPos - 起始位置
   * @param {THREE.Vector3} endPos - 结束位置
   * @param {Array} enemies - 丧尸列表
   * @returns {Object|null} 返回命中的敌人或 null
   */
  checkCollisionWithSegment(startPos, endPos, enemies) {
    for (const enemy of enemies) {
      if (!enemy.isActive || enemy.isDead) continue;
      const enemyX = enemy.position.x;
      const enemyY = enemy.position.y + TURRET_CONFIG.ENEMY_BODY_OFFSET_Y;
      const enemyZ = enemy.position.z;

      // 使用平方距离比较，避免每次命中检测都开方
      const distSq = this.distanceSqFromPointToSegment(enemyX, enemyY, enemyZ, startPos, endPos);
      if (distSq < this._hitRadiusSq) {
        // 命中！
        return enemy;
      }
    }

    return null;
  }

  /**
   * 计算点到线段的最短距离平方
   * @param {number} px - 点坐标 X
   * @param {number} py - 点坐标 Y
   * @param {number} pz - 点坐标 Z
   * @param {THREE.Vector3} segStart - 线段起点
   * @param {THREE.Vector3} segEnd - 线段终点
   * @returns {number} 最短距离平方
   */
  distanceSqFromPointToSegment(px, py, pz, segStart, segEnd) {
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
      return ddx * ddx + ddy * ddy + ddz * ddz;
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

    return distX * distX + distY * distY + distZ * distZ;
  }

  /**
   * 判断方块类型是否会阻挡炮弹
   * @param {string|null} blockType - 方块类型
   * @returns {boolean}
   */
  isBlockOccluding(blockType) {
    if (!blockType || blockType === 'air') return false;
    const cached = this._occlusionTypeCache.get(blockType);
    if (cached !== undefined) return cached;

    const props = getBlockProperties(blockType);
    const result = props.isSolid && !props.isTransparent;
    this._occlusionTypeCache.set(blockType, result);
    return result;
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
