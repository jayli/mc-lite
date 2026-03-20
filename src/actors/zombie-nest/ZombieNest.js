// src/actors/zombie-nest/ZombieNest.js
/**
 * 丧尸巢穴 - 管理结构完整性检查与定时刷怪
 */

import { getBlockProperties } from '../../constants/BlockData.js';

export const ZOMBIE_NEST_CONFIG = {
  SPAWN_INTERVAL: 8000,
  INTEGRITY_CHECK_INTERVAL: 30,
  SPAWN_SEARCH_HEIGHT: 3,
  SPAWN_SEARCH_DEPTH: 2,
  SPAWN_OFFSETS: [
    { x: 0, z: 3 },
    { x: 3, z: 0 },
    { x: 0, z: -3 },
    { x: -3, z: 0 },
    { x: 2, z: 2 },
    { x: 2, z: -2 },
    { x: -2, z: 2 },
    { x: -2, z: -2 }
  ]
};

export class ZombieNest {
  /**
   * @param {Object} params - 初始化参数
   * @param {string} params.id - 唯一标识
   * @param {Object} params.position - 放置基准坐标
   * @param {World} params.world - 世界实例
   * @param {Object} params.criticalBlock - 关键顶端方块
   * @param {Function|null} params.onSpawn - 刷怪回调
   * @param {Function|null} params.onDestroy - 销毁回调
   */
  constructor(params) {
    this.id = params.id;
    this.position = { ...params.position };
    this.world = params.world;
    this.criticalBlock = params.criticalBlock ? { ...params.criticalBlock } : null;
    this.onSpawn = params.onSpawn || null;
    this.onDestroy = params.onDestroy || null;

    this.state = 'ACTIVE';
    this.lastSpawnTime = Date.now();
    this._integrityCheckCounter = 0;
    this._lastIntegrityResult = true;
  }

  /**
   * 更新巢穴状态
   * @returns {void}
   */
  update() {
    if (this.state === 'DESTROYED') return;

    this._integrityCheckCounter++;
    if (this._integrityCheckCounter >= ZOMBIE_NEST_CONFIG.INTEGRITY_CHECK_INTERVAL) {
      this._integrityCheckCounter = 0;
      this._lastIntegrityResult = this.checkIntegrity();
    }

    if (!this._lastIntegrityResult) {
      this.destroy();
      return;
    }

    this.trySpawnZombie();
  }

  /**
   * 获取方块类型
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {string|null}
   */
  getBlock(x, y, z) {
    if (!this.world) return null;
    if (this.world.getBlockFast) return this.world.getBlockFast(x, y, z);
    return this.world.getBlock ? this.world.getBlock(x, y, z) : null;
  }

  /**
   * 关键方块是否仍然完整
   * @returns {boolean}
   */
  checkIntegrity() {
    if (!this.criticalBlock) return false;
    // 关键方块所属区块未加载时，不做破坏判定，避免远离区块时误销毁巢穴
    if (this.isCriticalChunkUnavailable()) return true;
    const blockType = this.getBlock(this.criticalBlock.x, this.criticalBlock.y, this.criticalBlock.z);
    return blockType === this.criticalBlock.type;
  }

  /**
   * 关键方块所在 Chunk 当前是否不可用
   * @returns {boolean}
   */
  isCriticalChunkUnavailable() {
    if (!this.world || !this.criticalBlock) return false;
    if (typeof this.world.isChunkLoadedAt !== 'function') return false;
    return !this.world.isChunkLoadedAt(this.criticalBlock.x, this.criticalBlock.z);
  }

  /**
   * 尝试刷出一只丧尸
   * @returns {boolean}
   */
  trySpawnZombie() {
    const now = Date.now();
    if (now - this.lastSpawnTime < ZOMBIE_NEST_CONFIG.SPAWN_INTERVAL) {
      return false;
    }

    const spawnPosition = this.findSpawnPosition();
    if (!spawnPosition) {
      this.lastSpawnTime = now;
      return false;
    }

    if (!this.onSpawn) {
      this.lastSpawnTime = now;
      return false;
    }

    const didSpawn = this.onSpawn({
      nestId: this.id,
      position: spawnPosition
    });

    this.lastSpawnTime = now;

    if (didSpawn) {
      return true;
    }

    return false;
  }

  /**
   * 查找合法的刷怪位置
   * @returns {{x:number, y:number, z:number}|null}
   */
  findSpawnPosition() {
    for (const offset of ZOMBIE_NEST_CONFIG.SPAWN_OFFSETS) {
      const baseX = this.position.x + offset.x;
      const baseZ = this.position.z + offset.z;

      for (let dy = ZOMBIE_NEST_CONFIG.SPAWN_SEARCH_HEIGHT; dy >= -ZOMBIE_NEST_CONFIG.SPAWN_SEARCH_DEPTH; dy--) {
        const footY = this.position.y + 1 + dy;
        if (this.isValidSpawnPosition(baseX, footY, baseZ)) {
          return {
            x: baseX + 0.5,
            y: footY,
            z: baseZ + 0.5
          };
        }
      }
    }

    return null;
  }

  /**
   * 某个体素位置是否可作为丧尸出生点
   * @param {number} x - 方块坐标 X
   * @param {number} y - 脚底坐标 Y
   * @param {number} z - 方块坐标 Z
   * @returns {boolean}
   */
  isValidSpawnPosition(x, y, z) {
    const footBlock = this.getBlock(x, y, z);
    const headBlock = this.getBlock(x, y + 1, z);
    const supportBlock = this.getBlock(x, y - 1, z);

    if (this.isOccupied(footBlock) || this.isOccupied(headBlock)) {
      return false;
    }

    if (!supportBlock || supportBlock === 'air') {
      return false;
    }

    const supportProps = getBlockProperties(supportBlock);
    return supportProps.isSolid;
  }

  /**
   * 方块是否占据出生空间
   * @param {string|null} blockType - 方块类型
   * @returns {boolean}
   */
  isOccupied(blockType) {
    return !!blockType && blockType !== 'air';
  }

  /**
   * 销毁巢穴
   * @returns {void}
   */
  destroy() {
    if (this.state === 'DESTROYED') return;

    this.state = 'DESTROYED';

    if (this.onDestroy) {
      this.onDestroy(this.id);
    }
  }
}
