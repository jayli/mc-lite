/**
 * ProjectilePool.js
 * 炮弹对象池 - 管理炮弹的创建和回收，配合 InstancedMesh 渲染
 */

import { Projectile } from './Projectile.js';
import { InstancedProjectileRenderer } from './InstancedProjectileRenderer.js';

export class ProjectilePool {
  constructor(scene, maxSize = 100) {
    this.scene = scene;
    this.maxSize = maxSize;

    // 炮弹实例池（预创建）
    this.pool = [];

    // 活跃炮弹 Map<projectile, instanceIndex>
    this.active = new Map();

    // InstancedMesh 渲染器
    this.renderer = new InstancedProjectileRenderer(scene, maxSize);

    // 预创建炮弹对象
    this.preallocate();
  }

  /**
   * 预创建炮弹对象
   */
  preallocate() {
    for (let i = 0; i < this.maxSize; i++) {
      this.pool.push(new Projectile());
    }
  }

  /**
   * 获取一个炮弹
   * @param {Object} params - 初始化参数
   * @returns {Projectile|null} 炮弹实例或null（如果池已满）
   */
  acquire(params) {
    // 检查是否有可用索引
    const instanceIndex = this.renderer.acquireIndex();
    if (instanceIndex === null) {
      console.warn('[ProjectilePool] Pool exhausted, cannot acquire projectile');
      return null;
    }

    // 获取炮弹对象
    let projectile;
    if (this.pool.length > 0) {
      projectile = this.pool.pop();
    } else {
      // 池已空，创建新炮弹（不应该发生，因为索引已经用完了）
      projectile = new Projectile();
    }

    // 初始化炮弹
    projectile.initialize({
      ...params,
      instanceIndex
    });

    // 记录活跃炮弹
    this.active.set(projectile, instanceIndex);

    // 立即更新一次渲染
    this.renderer.updateProjectile(instanceIndex, projectile.position, projectile.direction);

    return projectile;
  }

  /**
   * 回收炮弹
   * @param {Projectile} projectile - 要回收的炮弹
   */
  release(projectile) {
    if (!projectile) return;

    const instanceIndex = this.active.get(projectile);
    if (instanceIndex === undefined) {
      console.warn('[ProjectilePool] 尝试回收未激活的炮弹');
      return;
    }

    // 从活跃列表移除
    this.active.delete(projectile);

    // 释放 InstancedMesh 索引
    this.renderer.releaseIndex(instanceIndex);

    // 停用炮弹
    projectile.deactivate();
    projectile.instanceIndex = -1;

    // 回收进池
    this.pool.push(projectile);
  }

  /**
   * 更新所有活跃炮弹
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Array} enemies - 丧尸列表
   * @param {World} world - 世界引用，用于方块碰撞检测
   */
  update(deltaTime, enemies, world) {
    // 收集需要更新的炮弹
    const updates = new Map();
    const toRelease = [];

    for (const [projectile, instanceIndex] of this.active) {
      const stillActive = projectile.update(deltaTime, enemies, world);

      if (stillActive) {
        // 仍在活跃，更新渲染
        updates.set(instanceIndex, {
          position: projectile.position,
          direction: projectile.direction
        });
      } else {
        // 已停用，准备回收
        toRelease.push(projectile);
      }
    }

    // 批量更新渲染（只需一次 needsUpdate）
    if (updates.size > 0) {
      this.renderer.updateBatch(updates);
    }

    // 回收已停用的炮弹
    for (const projectile of toRelease) {
      this.release(projectile);
    }
  }

  /**
   * 获取活跃炮弹数量
   * @returns {number}
   */
  getActiveCount() {
    return this.active.size;
  }

  /**
   * 获取可用炮弹数量
   * @returns {number}
   */
  getAvailableCount() {
    return this.pool.length;
  }

  /**
   * 清理所有炮弹
   */
  clear() {
    // 回收所有活跃炮弹
    for (const projectile of this.active.keys()) {
      projectile.deactivate();
      projectile.instanceIndex = -1;
      this.pool.push(projectile);
    }
    this.active.clear();

    // 清理渲染器
    this.renderer.clear();
  }

  /**
   * 销毁对象池
   */
  destroy() {
    this.clear();

    // 销毁渲染器
    this.renderer.destroy();

    // 清空池
    this.pool = [];

    this.scene = null;
  }
}
