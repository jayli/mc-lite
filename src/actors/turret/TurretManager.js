/**
 * TurretManager.js
 * 炮塔管理器 - 管理所有炮塔的创建、更新和销毁
 */

import { Turret } from './Turret.js';
import { ProjectilePool } from './ProjectilePool.js';

export class TurretManager {
  /**
   * @param {THREE.Scene} scene - Three.js 场景
   * @param {World} world - 世界引用
   * @param {EnemyManager} enemyManager - 敌人管理器
   */
  constructor(scene, world, enemyManager) {
    this.scene = scene;
    this.world = world;
    this.enemyManager = enemyManager;

    // 存储所有炮塔 Map<id, Turret>
    this.turrets = new Map();

    // 炮弹对象池
    this.projectilePool = new ProjectilePool(scene, 100);

    // 配置
    this.maxTurrets = 20; // 最大炮塔数量
  }

  /**
   * 创建新炮塔
   * @param {THREE.Vector3} position - 炮塔位置
   * @returns {Turret|null} 创建的炮塔或null
   */
  createTurret(position) {
    // 检查是否超过最大数量
    if (this.turrets.size >= this.maxTurrets) {
      console.warn('[TurretManager] 已达到最大炮塔数量限制');
      return null;
    }

    // 生成唯一ID
    const id = `turret_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 创建炮塔
    const turret = new Turret({
      id,
      position,
      world: this.world,
      scene: this.scene,
      onFire: (fireData) => this.handleTurretFire(fireData)
    });

    // 存储
    this.turrets.set(id, turret);

    console.log(`[TurretManager] 创建炮塔: ${id} 位置: (${position.x}, ${position.y}, ${position.z})`);
    console.log(`[TurretManager] 期望 obsidian 位置: 下(${position.x}, ${position.y + 1}, ${position.z}) 上(${position.x}, ${position.y + 2}, ${position.z})`);

    return turret;
  }

  /**
   * 处理炮塔射击事件
   * @param {Object} fireData - 射击数据
   */
  handleTurretFire(fireData) {
    const { position, direction, turretId } = fireData;

    // 从对象池获取炮弹
    const projectile = this.projectilePool.acquire({
      position,
      direction,
      onHit: (enemy) => this.handleProjectileHit(enemy, turretId),
      onMaxDistance: () => {
        // 炮弹超距，自动回收
      }
    });

    if (!projectile) {
      console.warn('[TurretManager] 无法获取炮弹，对象池已满');
    }
  }

  /**
   * 处理炮弹命中
   * @param {Object} enemy - 被命中的丧尸
   * @param {string} turretId - 发射炮弹的炮塔ID
   */
  handleProjectileHit(enemy, turretId) {
    // 使用丧尸的 takeHit 方法处理受击
    const isDead = enemy.takeHit ? enemy.takeHit() : this.fallbackTakeHit(enemy);

    // 播放命中效果
    this.playHitEffect(enemy.position);

    // 检查丧尸是否死亡
    if (isDead) {
      this.killEnemy(enemy);
    }
  }

  /**
   * 备用受击处理（兼容旧版丧尸）
   * @param {Object} enemy - 丧尸对象
   * @returns {boolean} 是否死亡
   */
  fallbackTakeHit(enemy) {
    if (enemy.hitCount === undefined) {
      enemy.hitCount = 0;
    }
    enemy.hitCount++;
    return enemy.hitCount >= 3;
  }

  /**
   * 播放命中视觉效果
   * @param {THREE.Vector3} position - 命中位置
   */
  playHitEffect(position) {
    // 简化版：创建一个临时闪烁效果
    // 实际实现可以添加粒子效果或闪烁
    // 这里只是占位
  }

  /**
   * 击杀丧尸
   * @param {Object} enemy - 要击杀的丧尸
   */
  killEnemy(enemy) {
    enemy.isDead = true;

    // 通知 EnemyManager 移除丧尸
    if (this.enemyManager && this.enemyManager.removeZombie) {
      this.enemyManager.removeZombie(enemy.id);
    }

    // 播放死亡效果
    this.playDeathEffect(enemy.position);

    console.log(`[TurretManager] 丧尸被击杀: ${enemy.id}`);
  }

  /**
   * 播放死亡视觉效果
   * @param {THREE.Vector3} position - 死亡位置
   */
  playDeathEffect(position) {
    // 简化版：可以添加粒子爆炸效果
    // 这里只是占位
  }

  /**
   * 更新所有炮塔
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    // 获取活跃丧尸列表
    const enemies = this.getActiveEnemies();

    // 更新所有炮塔
    for (const turret of this.turrets.values()) {
      turret.update(deltaTime, enemies);
    }

    // 更新炮弹池
    this.projectilePool.update(deltaTime, enemies);
  }

  /**
   * 获取活跃丧尸列表
   * @returns {Array}
   */
  getActiveEnemies() {
    if (!this.enemyManager) {
      console.log('[TurretManager] enemyManager 不存在');
      return [];
    }

    // 从 EnemyManager 获取丧尸列表
    const enemies = [];
    if (this.enemyManager.zombies) {
      for (const zombie of this.enemyManager.zombies.values()) {
        if (zombie.isActive && !zombie.isDead) {
          enemies.push(zombie);
        }
      }
    }

    // 调试：定期输出丧尸数量
    this._debugFrame = (this._debugFrame || 0) + 1;
    if (this._debugFrame % 120 === 0) {
      console.log(`[TurretManager] 丧尸总数: ${this.enemyManager.zombies?.size || 0}, 活跃: ${enemies.length}`);
    }

    return enemies;
  }

  /**
   * 移除炮塔
   * @param {string} id - 炮塔ID
   */
  removeTurret(id) {
    const turret = this.turrets.get(id);
    if (turret) {
      turret.destroy();
      this.turrets.delete(id);
      console.log(`[TurretManager] 移除炮塔: ${id}`);
    }
  }

  /**
   * 获取所有活跃炮塔
   * @returns {Array<Turret>}
   */
  getActiveTurrets() {
    return Array.from(this.turrets.values()).filter(t => t.state === 'ACTIVE');
  }

  /**
   * 获取特定炮塔
   * @param {string} id - 炮塔ID
   * @returns {Turret|undefined}
   */
  getTurret(id) {
    return this.turrets.get(id);
  }

  /**
   * 清除所有炮塔
   */
  clearAll() {
    for (const turret of this.turrets.values()) {
      turret.destroy();
    }
    this.turrets.clear();
    this.projectilePool.clear();
    console.log('[TurretManager] 清除所有炮塔');
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.clearAll();
    this.projectilePool.destroy();
    this.scene = null;
    this.world = null;
    this.enemyManager = null;
  }
}
