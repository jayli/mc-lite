/**
 * ProjectilePool.js
 * 炮弹对象池 - 管理炮弹的创建和回收，避免频繁GC
 */

import { Projectile } from './Projectile.js';

export class ProjectilePool {
  constructor(scene, maxSize = 100) {
    this.scene = scene;
    this.maxSize = maxSize;

    // 可用炮弹（未激活）
    this.available = [];

    // 活跃炮弹
    this.active = [];

    // 预创建炮弹对象
    this.preallocate();
  }

  /**
   * 预创建炮弹对象
   */
  preallocate() {
    for (let i = 0; i < this.maxSize; i++) {
      const projectile = new Projectile();
      this.available.push(projectile);
    }
  }

  /**
   * 获取一个炮弹
   * @param {Object} params - 初始化参数
   * @returns {Projectile|null} 炮弹实例或null（如果池已满）
   */
  acquire(params) {
    // 查找可用的炮弹
    let projectile = null;

    if (this.available.length > 0) {
      // 从可用列表取出
      projectile = this.available.pop();
    } else if (this.active.length < this.maxSize) {
      // 创建新炮弹（未超过上限）
      projectile = new Projectile();
    } else {
      // 池已满，无法获取
      console.warn('[ProjectilePool] Pool exhausted, cannot acquire projectile');
      return null;
    }

    // 初始化炮弹
    projectile.initialize(params);

    // 添加到场景（如果是第一次使用）
    if (projectile.mesh && !projectile.mesh.parent) {
      this.scene.add(projectile.mesh);
    }

    // 添加到活跃列表
    this.active.push(projectile);

    return projectile;
  }

  /**
   * 回收炮弹
   * @param {Projectile} projectile - 要回收的炮弹
   */
  release(projectile) {
    if (!projectile) return;

    // 从活跃列表移除
    const index = this.active.indexOf(projectile);
    if (index > -1) {
      this.active.splice(index, 1);
    }

    // 停用炮弹
    projectile.deactivate();

    // 添加到可用列表
    this.available.push(projectile);
  }

  /**
   * 更新所有活跃炮弹
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Array} enemies - 丧尸列表
   */
  update(deltaTime, enemies) {
    // 逆序遍历，允许在循环中移除元素
    for (let i = this.active.length - 1; i >= 0; i--) {
      const projectile = this.active[i];

      projectile.update(deltaTime, enemies);

      // 如果炮弹已停用（命中或超距），回收它
      if (!projectile.isActive) {
        this.release(projectile);
      }
    }
  }

  /**
   * 获取活跃炮弹数量
   * @returns {number}
   */
  getActiveCount() {
    return this.active.length;
  }

  /**
   * 获取可用炮弹数量
   * @returns {number}
   */
  getAvailableCount() {
    return this.available.length;
  }

  /**
   * 清理所有炮弹
   */
  clear() {
    // 清理活跃炮弹
    for (const projectile of this.active) {
      projectile.deactivate();
      this.available.push(projectile);
    }
    this.active.length = 0;
  }

  /**
   * 销毁对象池
   */
  destroy() {
    // 清理活跃炮弹
    this.clear();

    // 销毁所有炮弹
    for (const projectile of this.available) {
      projectile.destroy();
    }
    this.available.length = 0;

    this.scene = null;
  }
}
