/**
 * 丧尸管理器
 *
 * 负责管理游戏中所有丧尸实体的生命周期，包括生成、更新和移除。
 * 提供查询接口用于获取附近的丧尸或检查特定位置的丧尸。
 *
 * 注意：此类用于独立丧尸管理，实际的丧尸渲染由 ZombieInstancedRenderer 处理，
 * AI 决策由 EnemyManager + EnemyWorker 处理。
 */
import { Zombie } from './Zombie.js';

// ============================================================================
// 配置参数
// ============================================================================

/**
 * 最大活跃丧尸数量
 * 限制同时存在的丧尸数量，防止性能问题
 */
const MAX_ACTIVE_ZOMBIES = 20;

/**
 * 默认位置容差
 * 用于判断丧尸是否在某个位置的默认容差范围
 */
const DEFAULT_POSITION_TOLERANCE = 0.5;

// ============================================================================
// 丧尸管理器类
// ============================================================================

/**
 * 丧尸管理器类
 *
 * 职责：
 * - 丧尸生成与移除
 * - 批量更新所有丧尸状态
 * - 提供丧尸查询接口
 */
export class ZombieManager {
  /**
   * 构造函数
   * @param {THREE.Scene} scene - Three.js 场景对象
   * @param {World} world - 游戏世界对象，用于碰撞检测
   */
  constructor(scene, world) {
    // 场景引用
    this.scene = scene;

    // 世界引用（用于碰撞检测）
    this.world = world;

    // 丧尸实例列表
    this.zombies = [];

    // 最大活跃数量
    this.maxActiveZombies = MAX_ACTIVE_ZOMBIES;

    // 性能优化：更新队列（预留）
    this.updateQueue = [];
  }

  // --------------------------------------------------------------------------
  // 丧尸生命周期管理
  // --------------------------------------------------------------------------

  /**
   * 生成一个新的丧尸
   *
   * @param {Object} position - 丧尸生成位置 {x, y, z}
   * @returns {Zombie|null} 生成的丧尸实例，如果达到数量限制则返回 null
   */
  spawnZombie(position) {
    // 检查数量限制
    if (this.zombies.length >= this.maxActiveZombies) {
      console.warn('[ZombieManager] 已达到最大丧尸数量限制');
      return null;
    }

    // 创建丧尸实例
    const zombie = new Zombie(position);

    // 添加到场景
    this.scene.add(zombie.mesh);

    // 添加到管理列表
    this.zombies.push(zombie);

    return zombie;
  }

  /**
   * 从世界中移除丧尸
   *
   * @param {Zombie} zombie - 要移除的丧尸实例
   */
  removeZombie(zombie) {
    // 从场景中移除网格
    if (zombie.mesh && zombie.mesh.parent) {
      zombie.mesh.parent.remove(zombie.mesh);
    }

    // 从管理列表中移除
    const index = this.zombies.indexOf(zombie);
    if (index !== -1) {
      this.zombies.splice(index, 1);
    }
  }

  // --------------------------------------------------------------------------
  // 更新方法
  // --------------------------------------------------------------------------

  /**
   * 批量更新所有丧尸
   * 每帧调用一次，更新丧尸的物理状态和位置
   *
   * @param {Object} playerPosition - 玩家位置 {x, y, z}
   */
  updateAll(playerPosition) {
    // 从后向前遍历，便于安全移除元素
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const zombie = this.zombies[i];

      // 更新丧尸状态（物理、碰撞检测等）
      zombie.update(
        playerPosition,
        this.world.getBlock.bind(this.world)
      );

      // 检查丧尸是否死亡
      if (!zombie.isAlive) {
        this.removeZombie(zombie);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 查询方法
  // --------------------------------------------------------------------------

  /**
   * 获取所有活跃丧尸
   * 返回副本以防止外部修改内部数组
   *
   * @returns {Zombie[]} 丧尸数组副本
   */
  getAllZombies() {
    return [...this.zombies];
  }

  /**
   * 获取指定位置附近的丧尸
   *
   * @param {Object} position - 参考点位置 {x, y, z}
   * @param {number} radius - 搜索半径
   * @returns {Zombie[]} 范围内的丧尸数组
   */
  getZombiesNear(position, radius) {
    return this.zombies.filter(zombie => {
      const distance = this.calculateDistance(zombie.position, position);
      return distance <= radius;
    });
  }

  /**
   * 检查指定位置是否有丧尸
   *
   * @param {Object} position - 检查位置 {x, y, z}
   * @param {number} tolerance - 容差范围，默认 0.5
   * @returns {boolean} 是否存在丧尸
   */
  isZombieAt(position, tolerance = DEFAULT_POSITION_TOLERANCE) {
    return this.zombies.some(zombie => {
      return this.isWithinTolerance(zombie.position, position, tolerance);
    });
  }

  // --------------------------------------------------------------------------
  // 工具方法
  // --------------------------------------------------------------------------

  /**
   * 计算两点之间的距离
   * @param {Object} pos1 - 位置 1 {x, y, z}
   * @param {Object} pos2 - 位置 2 {x, y, z}
   * @returns {number} 欧几里得距离
   */
  calculateDistance(pos1, pos2) {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * 检查两个位置是否在容差范围内
   * @param {Object} pos1 - 位置 1 {x, y, z}
   * @param {Object} pos2 - 位置 2 {x, y, z}
   * @param {number} tolerance - 容差
   * @returns {boolean} 是否在容差范围内
   */
  isWithinTolerance(pos1, pos2, tolerance) {
    return (
      Math.abs(pos1.x - pos2.x) <= tolerance &&
      Math.abs(pos1.y - pos2.y) <= tolerance &&
      Math.abs(pos1.z - pos2.z) <= tolerance
    );
  }
}