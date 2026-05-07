/**
 * TurretManager.js
 * 炮塔管理器 — 纯行为层（数据由 SpecialEntitiesShadowStore 管理）
 */

import { Turret, preloadTurretTextures as preloadTextures } from './Turret.js';
import { ProjectilePool } from './ProjectilePool.js';
import { audioManager } from '../../core/AudioManager.js';
import { PERSISTENCE_CONFIG } from '../../constants/PersistenceConfig.js';
import * as THREE from 'three';

// 重命名以避免与 Turret.js 内部函数冲突
const preloadTurretTextures = preloadTextures;

export class TurretManager {
  /**
   * @param {THREE.Scene} scene - Three.js 场景
   * @param {World} world - 世界引用
   * @param {EnemyManager} enemyManager - 敌人管理器
   * @param {SpecialEntitiesShadowStore} shadowStore - 特殊实体影子存储
   * @param {ShadowSyncDispatcher} dispatcher - 异步同步调度器
   */
  constructor(scene, world, enemyManager, shadowStore, dispatcher) {
    this.scene = scene;
    this.world = world;
    this.enemyManager = enemyManager;
    this.shadowStore = shadowStore;
    this.dispatcher = dispatcher;

    // 预加载纹理（仅首次）
    preloadTurretTextures();

    // 活跃的炮塔行为实例 Map<id, Turret>（仅用于 update 循环）
    this.activeTurrets = new Map();

    // 位置索引：key: "x,y,z" -> turretId
    this.turretPositionIndex = new Map();

    // 炮弹对象池
    this.projectilePool = new ProjectilePool(scene, 100);

    // 配置
    this.maxTurrets = 20;
  }

  /**
   * 规范化坐标（避免浮点误差造成索引失效）
   * @param {{x:number,y:number,z:number}} pos
   * @returns {{x:number,y:number,z:number}}
   */
  normalizePosition(pos) {
    return {
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z)
    };
  }

  /**
   * 位置索引键
   * @param {{x:number,y:number,z:number}} pos
   * @returns {string}
   */
  getPositionKey(pos) {
    const p = this.normalizePosition(pos);
    return `${p.x},${p.y},${p.z}`;
  }

  /**
   * 坐标归属 Chunk 键
   * @param {{x:number,y:number,z:number}} pos
   * @returns {string}
   */
  getChunkKeyByPosition(pos) {
    const p = this.normalizePosition(pos);
    const cx = Math.floor(p.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
    const cz = Math.floor(p.z / PERSISTENCE_CONFIG.CHUNK_SIZE);
    return `${cx},${cz}`;
  }

  /**
   * 创建新炮塔
   * @param {THREE.Vector3|Object} position - 炮塔位置 (可以是 THREE.Vector3 或 {x,y,z} 对象)
   * @param {number} initialRotation - 初始朝向（弧度，可选，默认为0）
   * @param {Object} options - 可选参数 { skipLimit?: boolean, persist?: boolean }
   * @returns {Turret|null} 创建的炮塔或null
   */
  createTurret(position, initialRotation = 0, options = {}) {
    const skipLimit = options.skipLimit === true;
    const shouldPersist = options.persist !== false;

    if (!skipLimit && this.activeTurrets.size >= this.maxTurrets) {
      console.warn('[TurretManager] 已达到最大炮塔数量限制');
      return null;
    }

    const normalizedPos = this.normalizePosition(position);
    const positionKey = this.getPositionKey(normalizedPos);

    const existingId = this.turretPositionIndex.get(positionKey);
    if (existingId) {
      return this.activeTurrets.get(existingId) || null;
    }

    const id = options.restoredId || `turret_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const positionVec3 = new THREE.Vector3(normalizedPos.x, normalizedPos.y, normalizedPos.z);

    const turret = new Turret({
      id,
      position: positionVec3,
      world: this.world,
      scene: this.scene,
      onFire: (fireData) => this.handleTurretFire(fireData),
      onDestroy: (turretId) => this.handleTurretDestroy(turretId),
      initialRotation
    });

    this.activeTurrets.set(id, turret);
    this.turretPositionIndex.set(positionKey, id);

    // 写入 ShadowStore
    if (this.shadowStore) {
      const cx = Math.floor(normalizedPos.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
      const cz = Math.floor(normalizedPos.z / PERSISTENCE_CONFIG.CHUNK_SIZE);
      this.shadowStore.addEntity('turret', cx, cz, id, {
        position: normalizedPos,
        rotation: initialRotation
      });

      if (shouldPersist && this.dispatcher) {
        this.dispatcher.markDirty(cx, cz);
      }
    }

    console.log(`[TurretManager] 创建炮塔: ${id} 位置: (${normalizedPos.x}, ${normalizedPos.y}, ${normalizedPos.z})`);

    return turret;
  }

  /**
   * 处理炮塔射击事件
   * @param {Object} fireData - 射击数据
   */
  handleTurretFire(fireData) {
    const { position, direction, turretId } = fireData;

    // 播放射击音效
    audioManager.playSound('turret_gun_fire', 0.25);

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
   * 处理炮塔销毁事件
   * @param {string} turretId - 被销毁的炮塔 ID
   */
  handleTurretDestroy(turretId) {
    const turret = this.activeTurrets.get(turretId);
    if (turret) {
      const pos = this.normalizePosition(turret.position);
      const cx = Math.floor(pos.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
      const cz = Math.floor(pos.z / PERSISTENCE_CONFIG.CHUNK_SIZE);

      // 从 ShadowStore 移除
      if (this.shadowStore) {
        this.shadowStore.removeEntity('turret', cx, cz, turretId);
      }
      if (this.dispatcher) {
        this.dispatcher.markDirty(cx, cz);
      }

      this.turretPositionIndex.delete(this.getPositionKey(turret.position));
    }
    this.activeTurrets.delete(turretId);
    console.log(`[TurretManager] 炮塔被销毁：${turretId}`);
    console.log(`[TurretManager] 当前炮塔数量：${this.activeTurrets.size}/${this.maxTurrets}`);
  }

  /**
   * 从 ShadowStore 恢复炮塔实例（支持分帧）
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {number} [startIndex=0] - 起始索引
   * @param {number} [maxCount=3] - 本帧最多恢复数量
   * @returns {boolean} 是否还有更多炮塔待恢复
   */
  restoreTurretsForChunk(cx, cz, startIndex = 0, maxCount = 3) {
    if (!this.shadowStore) return false;
    const turrets = this.shadowStore.getAllEntities('turret', cx, cz);
    if (turrets.length === 0) return false;

    const currentChunkKey = `${cx},${cz}`;
    let restored = 0;
    let i = startIndex;

    for (; i < turrets.length && restored < maxCount; i++) {
      const item = turrets[i];
      if (!item?.position) continue;
      if (this.getChunkKeyByPosition(item.position) !== currentChunkKey) continue;

      this.createTurret(
        item.position,
        item.rotation || 0,
        { skipLimit: true, persist: false, restoredId: item.id }
      );
      restored++;
    }

    // 跳过剩余不匹配 entry 找到下一个有效索引
    while (i < turrets.length) {
      const item = turrets[i];
      if (item?.position && this.getChunkKeyByPosition(item.position) === currentChunkKey) {
        return true; // 还有待恢复
      }
      i++;
    }
    return false;
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

    // 播放死亡音效
    audioManager.playSound('z_die', 0.3);

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
    const enemies = this.getActiveEnemies();

    for (const turret of this.activeTurrets.values()) {
      turret.update(deltaTime, enemies);
    }

    this.projectilePool.update(deltaTime, enemies, this.world);
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

    return enemies;
  }

  /**
   * 移除炮塔
   * @param {string} id - 炮塔ID
   */
  removeTurret(id) {
    const turret = this.activeTurrets.get(id);
    if (turret) {
      turret.destroy();
    }
  }

  getActiveTurrets() {
    return Array.from(this.activeTurrets.values()).filter(t => t.state === 'ACTIVE');
  }

  getTurret(id) {
    return this.activeTurrets.get(id);
  }

  clearAll() {
    for (const turret of this.activeTurrets.values()) {
      turret.destroy();
    }
    this.activeTurrets.clear();
    this.turretPositionIndex.clear();
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
