// src/actors/zombie-nest/ZombieNestManager.js
/**
 * 丧尸巢穴管理器 — 纯行为层（数据由 SpecialEntitiesShadowStore 管理）
 */

import { Zombie } from '../enemy/Zombie.js';
import { ZombieNest } from './ZombieNest.js';
import { ZOMBIE_NEST_LIMIT } from '../../constants/GameConfig.js';
import { PERSISTENCE_CONFIG } from '../../constants/PersistenceConfig.js';

export class ZombieNestManager {
  /**
   * @param {THREE.Scene} scene - 场景
   * @param {World} world - 世界
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

    // 活跃的巢穴行为实例 Map<id, ZombieNest>（仅用于 update 循环）
    this.activeNests = new Map();
    this.nestPositionIndex = new Map();
    this.maxNests = ZOMBIE_NEST_LIMIT;
    this._isDestroyingAll = false;
  }

  getNestCount() {
    return this.activeNests.size;
  }

  /**
   * 最大巢穴数量
   * @returns {number}
   */
  getMaxNests() {
    return this.maxNests;
  }

  /**
   * 是否可继续创建巢穴
   * @returns {boolean}
   */
  canCreateNest() {
    return this.getNestCount() < this.getMaxNests();
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
   * 创建巢穴
   * @param {Object} params - 创建参数
   * @param {{skipLimit?:boolean,persist?:boolean}} options - 可选控制项
   * @returns {ZombieNest|null}
   */
  createNest(params, options = {}) {
    const skipLimit = options.skipLimit === true;
    const shouldPersist = options.persist !== false;

    const position = this.normalizePosition(params.position);
    const criticalBlock = params.criticalBlock
      ? {
          ...this.normalizePosition(params.criticalBlock),
          type: params.criticalBlock.type
        }
      : null;
    const positionKey = this.getPositionKey(position);
    const existingId = this.nestPositionIndex.get(positionKey);
    if (existingId) {
      return this.activeNests.get(existingId) || null;
    }

    if (!skipLimit && !this.canCreateNest()) {
      console.warn('[ZombieNestManager] 已达到最大丧尸巢穴数量限制');
      return null;
    }

    // 优先复用快照 id
    const id = params.restoredId || `zombie_nest_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const nest = new ZombieNest({
      id,
      position,
      world: this.world,
      criticalBlock,
      onSpawn: (spawnData) => this.handleNestSpawn(spawnData),
      onDestroy: (nestId) => this.handleNestDestroy(nestId)
    });

    // 恢复 lastSpawnTime，避免刷怪节奏重置
    if (params.lastSpawnTime) {
      nest.lastSpawnTime = params.lastSpawnTime;
    }

    this.activeNests.set(id, nest);
    this.nestPositionIndex.set(positionKey, id);

    // 写入 ShadowStore
    if (this.shadowStore) {
      const cx = Math.floor(position.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
      const cz = Math.floor(position.z / PERSISTENCE_CONFIG.CHUNK_SIZE);
      this.shadowStore.addEntity('zombieNest', cx, cz, id, {
        position,
        criticalBlock,
        lastSpawnTime: nest.lastSpawnTime
      });

      if (shouldPersist && this.dispatcher) {
        this.dispatcher.markDirty(cx, cz);
      }
    }

    console.log(`[ZombieNestManager] 创建丧尸巢穴: ${id}，位置: (${position.x}, ${position.y}, ${position.z})`);
    return nest;
  }

  /**
   * 从 ShadowStore 恢复巢穴实例（支持分帧）
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {number} [startIndex=0] - 起始索引
   * @param {number} [maxCount=3] - 本帧最多恢复数量
   * @returns {boolean} 是否还有更多巢穴待恢复
   */
  restoreNestsForChunk(cx, cz, startIndex = 0, maxCount = 3) {
    if (!this.shadowStore) return false;
    const nests = this.shadowStore.getAllEntities('zombieNest', cx, cz);
    if (nests.length === 0) return false;

    const currentChunkKey = `${cx},${cz}`;
    let restored = 0;
    let i = startIndex;

    for (; i < nests.length && restored < maxCount; i++) {
      const item = nests[i];
      if (!item?.position || !item?.criticalBlock) continue;
      if (this.getChunkKeyByPosition(item.position) !== currentChunkKey) continue;

      this.createNest({
        position: item.position,
        criticalBlock: item.criticalBlock,
        restoredId: item.id || null,
        lastSpawnTime: item.lastSpawnTime || null
      }, {
        skipLimit: true,
        persist: false
      });
      restored++;
    }

    while (i < nests.length) {
      const item = nests[i];
      if (item?.position && item?.criticalBlock && this.getChunkKeyByPosition(item.position) === currentChunkKey) {
        return true;
      }
      i++;
    }
    return false;
  }

  /**
   * 刷怪回调
   * @param {Object} spawnData - 刷怪数据
   * @returns {boolean}
   */
  handleNestSpawn(spawnData) {
    const zombie = new Zombie(spawnData.position);
    const didAdd = this.enemyManager && this.enemyManager.addZombie
      ? this.enemyManager.addZombie(zombie)
      : false;

    if (!didAdd) {
      return false;
    }

    if (zombie.mesh) {
      this.scene.add(zombie.mesh);
    }

    console.log(`[ZombieNestManager] 巢穴 ${spawnData.nestId} 生成丧尸成功`);
    return true;
  }

  /**
   * 巢穴销毁回调
   * @param {string} nestId - 巢穴 ID
   */
  handleNestDestroy(nestId) {
    const nest = this.activeNests.get(nestId);
    if (nest) {
      const pos = this.normalizePosition(nest.position);
      const cx = Math.floor(pos.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
      const cz = Math.floor(pos.z / PERSISTENCE_CONFIG.CHUNK_SIZE);

      // 从 ShadowStore 移除
      if (this.shadowStore) {
        this.shadowStore.removeEntity('zombieNest', cx, cz, nestId);
      }
      if (this.dispatcher) {
        this.dispatcher.markDirty(cx, cz);
      }

      this.nestPositionIndex.delete(this.getPositionKey(nest.position));
    }
    this.activeNests.delete(nestId);
    console.log(`[ZombieNestManager] 丧尸巢穴已失效：${nestId}`);
    console.log(`[ZombieNestManager] 当前巢穴数量：${this.activeNests.size}/${this.maxNests}`);
  }

  update(_dt) {
    for (const nest of this.activeNests.values()) {
      nest.update();
    }
  }

  destroy() {
    this._isDestroyingAll = true;
    for (const nest of Array.from(this.activeNests.values())) {
      nest.destroy();
    }
    this._isDestroyingAll = false;
    this.activeNests.clear();
    this.nestPositionIndex.clear();
  }
}
