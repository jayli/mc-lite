// src/actors/zombie-nest/ZombieNestManager.js
/**
 * 丧尸巢穴管理器 - 管理巢穴创建、更新与回收
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
   */
  constructor(scene, world, enemyManager) {
    this.scene = scene;
    this.world = world;
    this.enemyManager = enemyManager;

    this.nests = new Map();
    this.nestPositionIndex = new Map(); // key: "x,y,z" -> nestId
    this.maxNests = ZOMBIE_NEST_LIMIT;
    this._isDestroyingAll = false;
  }

  /**
   * 获取持久化服务（优先测试注入）
   * @returns {object|null}
   */
  getPersistenceService() {
    return globalThis._persistenceService || this.world?.persistenceService || null;
  }

  /**
   * 当前活动巢穴数量
   * @returns {number}
   */
  getNestCount() {
    return this.nests.size;
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
   * 确保持久化快照中存在巢穴列表
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
    if (!Array.isArray(chunkData.entities.zombieNests)) {
      chunkData.entities.zombieNests = [];
    }
    return chunkData;
  }

  /**
   * 巢穴序列化记录
   * @param {ZombieNest} nest
   * @returns {{id:string,position:{x:number,y:number,z:number},criticalBlock:{x:number,y:number,z:number,type:string},lastSpawnTime:number}|null}
   */
  toNestSnapshot(nest) {
    if (!nest || !nest.position || !nest.criticalBlock) return null;
    const position = this.normalizePosition(nest.position);
    const critical = this.normalizePosition(nest.criticalBlock);
    return {
      id: nest.id,
      position,
      criticalBlock: {
        ...critical,
        type: nest.criticalBlock.type
      },
      lastSpawnTime: nest.lastSpawnTime
    };
  }

  /**
   * 将巢穴写入归属 Chunk 快照
   * @param {ZombieNest} nest
   * @returns {void}
   */
  saveNestToSnapshot(nest) {
    const persistence = this.getPersistenceService();
    if (!persistence) return;
    const entry = this.toNestSnapshot(nest);
    if (!entry) return;
    const chunkKey = this.getChunkKeyByPosition(entry.position);
    const chunkData = this.ensureChunkSnapshot(chunkKey);
    if (!chunkData) return;
    const list = chunkData.entities.zombieNests;
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
   * 从归属 Chunk 快照中移除巢穴
   * @param {ZombieNest} nest
   * @returns {void}
   */
  removeNestFromSnapshot(nest) {
    const persistence = this.getPersistenceService();
    if (!persistence) return;
    const entry = this.toNestSnapshot(nest);
    if (!entry) return;
    const chunkKey = this.getChunkKeyByPosition(entry.position);
    const chunkData = this.ensureChunkSnapshot(chunkKey);
    if (!chunkData) return;
    const list = chunkData.entities.zombieNests;
    // 优先用 id 匹配
    const next = list.filter(item => item.id !== entry.id);
    chunkData.entities.zombieNests = next;

    const [cx, cz] = chunkKey.split(',').map(Number);
    persistence.saveChunkData?.(cx, cz, chunkData);
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
      return this.nests.get(existingId) || null;
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

    this.nests.set(id, nest);
    this.nestPositionIndex.set(positionKey, id);
    if (shouldPersist) {
      this.saveNestToSnapshot(nest);
    }
    console.log(`[ZombieNestManager] 创建丧尸巢穴: ${id}，位置: (${position.x}, ${position.y}, ${position.z})`);
    return nest;
  }

  /**
   * 从 Chunk 快照恢复巢穴实例（无扫描，直接按记录重建）
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {Array} nests - 快照中的巢穴列表
   * @returns {void}
   */
  restoreNestsForChunk(cx, cz, nests) {
    if (!Array.isArray(nests) || nests.length === 0) return;
    const currentChunkKey = `${cx},${cz}`;

    for (const item of nests) {
      if (!item?.position || !item?.criticalBlock) continue;
      if (this.getChunkKeyByPosition(item.position) !== currentChunkKey) continue;
      // 优先复用快照 id 和 lastSpawnTime
      this.createNest({
        position: item.position,
        criticalBlock: item.criticalBlock,
        restoredId: item.id || null,
        lastSpawnTime: item.lastSpawnTime || null
      }, {
        skipLimit: true,
        persist: false
      });
    }
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
    const nest = this.nests.get(nestId);
    if (nest) {
      this.nestPositionIndex.delete(this.getPositionKey(nest.position));
      if (!this._isDestroyingAll) {
        this.removeNestFromSnapshot(nest);
      }
    }
    this.nests.delete(nestId);
    console.log(`[ZombieNestManager] 丧尸巢穴已失效：${nestId}`);
    console.log(`[ZombieNestManager] 当前巢穴数量：${this.nests.size}/${this.maxNests}`);
  }

  /**
   * 更新所有巢穴
   * @returns {void}
   */
  update(_dt) {
    for (const nest of this.nests.values()) {
      nest.update();
    }
  }

  /**
   * 销毁所有巢穴
   * @returns {void}
   */
  destroy() {
    this._isDestroyingAll = true;
    for (const nest of Array.from(this.nests.values())) {
      nest.destroy();
    }
    this._isDestroyingAll = false;
    this.nests.clear();
    this.nestPositionIndex.clear();
  }
}
