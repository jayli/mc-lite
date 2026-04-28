/**
 * TurretManager.js
 * 炮塔管理器 - 管理所有炮塔的创建、更新和销毁
 */

import { Turret } from './Turret.js';
import { ProjectilePool } from './ProjectilePool.js';
import { audioManager } from '../../core/AudioManager.js';
import { PERSISTENCE_CONFIG } from '../../constants/PersistenceConfig.js';
import * as THREE from 'three';

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

    // 位置索引：key: "x,y,z" -> turretId
    this.turretPositionIndex = new Map();

    // 炮弹对象池
    this.projectilePool = new ProjectilePool(scene, 100);

    // 配置
    this.maxTurrets = 20; // 最大炮塔数量
  }

  /**
   * 获取持久化服务（优先测试注入）
   * @returns {object|null}
   */
  getPersistenceService() {
    return globalThis._persistenceService || this.world?.persistenceService || null;
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
   * 确保持久化快照中存在炮塔列表
   * @param {string} chunkKey
   * @returns {object}
   */
  ensureChunkSnapshot(chunkKey) {
    const persistence = this.getPersistenceService();
    if (!persistence?.cache) return null;

    let chunkData = persistence.cache.get(chunkKey);
    if (!chunkData) {
      chunkData = { blocks: {}, entities: {} };
      persistence.cache.set(chunkKey, chunkData);
    }
    if (!chunkData.entities) chunkData.entities = {};
    if (!Array.isArray(chunkData.entities.turrets)) {
      chunkData.entities.turrets = [];
    }
    return chunkData;
  }

  /**
   * 炮塔序列化记录
   * @param {Turret} turret
   * @returns {{id:string,position:{x:number,y:number,z:number},rotation:number}|null}
   */
  toTurretSnapshot(turret) {
    if (!turret || !turret.position) return null;
    const position = this.normalizePosition(turret.position);
    return {
      id: turret.id,
      position,
      rotation: turret.currentRotation || 0
    };
  }

  /**
   * 将炮塔写入归属 Chunk 快照
   * @param {Turret} turret
   * @returns {void}
   */
  saveTurretToSnapshot(turret) {
    const persistence = this.getPersistenceService();
    if (!persistence) return;
    const entry = this.toTurretSnapshot(turret);
    if (!entry) return;
    const chunkKey = this.getChunkKeyByPosition(entry.position);
    const chunkData = this.ensureChunkSnapshot(chunkKey);
    if (!chunkData) return;
    const list = chunkData.entities.turrets;
    // 优先用 id 去重，position 作为兼容保护
    const idx = list.findIndex(item => item.id === entry.id);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      const posKey = this.getPositionKey(entry.position);
      const posIdx = list.findIndex(item => this.getPositionKey(item.position) === posKey);
      if (posIdx >= 0) list[posIdx] = entry;
      else list.push(entry);
    }

    const [cx, cz] = chunkKey.split(',').map(Number);
    persistence.saveChunkData?.(cx, cz, chunkData);
  }

  /**
   * 从归属 Chunk 快照中移除炮塔
   * @param {Turret} turret
   * @returns {void}
   */
  removeTurretFromSnapshot(turret) {
    const persistence = this.getPersistenceService();
    if (!persistence) return;
    const entry = this.toTurretSnapshot(turret);
    if (!entry) return;
    const chunkKey = this.getChunkKeyByPosition(entry.position);
    const chunkData = this.ensureChunkSnapshot(chunkKey);
    if (!chunkData) return;
    const list = chunkData.entities.turrets;
    // 优先用 id 匹配
    const next = list.filter(item => item.id !== entry.id);
    chunkData.entities.turrets = next;

    const [cx, cz] = chunkKey.split(',').map(Number);
    persistence.saveChunkData?.(cx, cz, chunkData);
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

    // 检查是否超过最大数量
    if (!skipLimit && this.turrets.size >= this.maxTurrets) {
      console.warn('[TurretManager] 已达到最大炮塔数量限制');
      return null;
    }

    // 规范化位置 - 将普通对象转换为 {x,y,z}
    const normalizedPos = this.normalizePosition(position);
    const positionKey = this.getPositionKey(normalizedPos);

    // 检查该位置是否已有炮塔
    const existingId = this.turretPositionIndex.get(positionKey);
    if (existingId) {
      return this.turrets.get(existingId) || null;
    }

    // 生成唯一ID，优先复用快照 id
    const id = options.restoredId || `turret_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 将普通对象转换为 THREE.Vector3 传给 Turret 构造函数
    const positionVec3 = new THREE.Vector3(normalizedPos.x, normalizedPos.y, normalizedPos.z);

    // 创建炮塔
    const turret = new Turret({
      id,
      position: positionVec3,
      world: this.world,
      scene: this.scene,
      onFire: (fireData) => this.handleTurretFire(fireData),
      onDestroy: (turretId) => this.handleTurretDestroy(turretId),
      initialRotation  // 传递初始朝向
    });

    // 存储
    this.turrets.set(id, turret);
    this.turretPositionIndex.set(positionKey, id);

    // 保存到快照
    if (shouldPersist) {
      this.saveTurretToSnapshot(turret);
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
    const turret = this.turrets.get(turretId);
    if (turret) {
      this.turretPositionIndex.delete(this.getPositionKey(turret.position));
      this.removeTurretFromSnapshot(turret);
    }
    this.turrets.delete(turretId);
    console.log(`[TurretManager] 炮塔被销毁：${turretId}`);
    console.log(`[TurretManager] 当前炮塔数量：${this.turrets.size}/${this.maxTurrets}`);
  }

  /**
   * 从 Chunk 快照恢复炮塔实例（直接按记录重建）
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {Array} turrets - 快照中的炮塔列表
   * @returns {void}
   */
  restoreTurretsForChunk(cx, cz, turrets) {
    if (!Array.isArray(turrets) || turrets.length === 0) return;
    const currentChunkKey = `${cx},${cz}`;

    for (const item of turrets) {
      if (!item?.position) continue;
      if (this.getChunkKeyByPosition(item.position) !== currentChunkKey) continue;
      // 优先复用快照 id
      const restoredId = item.id || null;
      this.createTurret(
        item.position,
        item.rotation || 0,
        { skipLimit: true, persist: false, restoredId }
      );
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
    // 获取活跃丧尸列表
    const enemies = this.getActiveEnemies();

    // 更新所有炮塔
    for (const turret of this.turrets.values()) {
      turret.update(deltaTime, enemies);
    }

    // 更新炮弹池（传入 world 用于方块碰撞检测）
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
    const turret = this.turrets.get(id);
    if (turret) {
      turret.destroy();
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
