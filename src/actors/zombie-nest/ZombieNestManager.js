// src/actors/zombie-nest/ZombieNestManager.js
/**
 * 丧尸巢穴管理器 - 管理巢穴创建、更新与回收
 */

import { Zombie } from '../enemy/Zombie.js';
import { ZombieNest } from './ZombieNest.js';
import { ZOMBIE_NEST_LIMIT } from '../../constants/GameConfig.js';

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
    this.maxNests = ZOMBIE_NEST_LIMIT;
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
   * 创建巢穴
   * @param {Object} params - 创建参数
   * @returns {ZombieNest|null}
   */
  createNest(params) {
    if (!this.canCreateNest()) {
      console.warn('[ZombieNestManager] 已达到最大丧尸巢穴数量限制');
      return null;
    }

    const id = `zombie_nest_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const nest = new ZombieNest({
      id,
      position: params.position,
      world: this.world,
      criticalBlock: params.criticalBlock,
      onSpawn: (spawnData) => this.handleNestSpawn(spawnData),
      onDestroy: (nestId) => this.handleNestDestroy(nestId)
    });

    this.nests.set(id, nest);
    console.log(`[ZombieNestManager] 创建丧尸巢穴: ${id}，位置: (${params.position.x}, ${params.position.y}, ${params.position.z})`);
    return nest;
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
    for (const nest of Array.from(this.nests.values())) {
      nest.destroy();
    }
    this.nests.clear();
  }
}
