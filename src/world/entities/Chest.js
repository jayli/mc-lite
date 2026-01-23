// src/world/entities/Chest.js
// 宝箱动画管理模块
// 负责宝箱开启动画的生成、更新和移除
import * as THREE from 'three';
import { materials } from '../../core/materials/MaterialManager.js';

/**
 * 宝箱动画管理器类
 * 管理游戏中所有宝箱的开启动画
 */
export class Chest {
  constructor() {
    this.chestAnimations = [];
  }

  /**
   * 生成宝箱开启动画
   * @param {THREE.Vector3} pos - 宝箱位置
   * @param {THREE.Object3D} parent - 父级对象（通常为场景或区块）
   * @returns {Object} 动画对象，包含mesh、lid、opening和t属性
   */
  spawnChestAnimation(pos, parent) {
    const group = new THREE.Group();
    group.position.copy(pos);

    const mat = materials.getMaterial('chest');
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), mat);
    body.position.y = 0.3;

    const pivot = new THREE.Group();
    pivot.position.set(0, 0.6, -0.4);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.8), mat);
    lid.position.set(0, 0.1, 0.4);

    pivot.add(lid);
    group.add(body, pivot);
    parent.add(group);

    this.chestAnimations.push({
      mesh: group,
      lid: pivot,
      opening: true,
      t: 0
    });

    return { mesh: group, lid: pivot, opening: true, t: 0 };
  }

  /**
   * 更新所有宝箱动画状态
   * @param {number} dt - 增量时间（秒）
   */
  update(dt) {
    for (let i = this.chestAnimations.length - 1; i >= 0; i--) {
      const c = this.chestAnimations[i];

      if (!c.mesh.parent) {
        this.chestAnimations.splice(i, 1);
        continue;
      }

      if (c.opening && c.t < 1) {
        // Using dt for frame-rate independent animation
        // 使用dt实现帧率无关的动画
        c.t = Math.min(1, c.t + (dt * 3)); // 3 units per second
        c.lid.rotation.x = THREE.MathUtils.lerp(0, -1.9, c.t);
      }
    }
  }

  /**
   * 移除指定索引的宝箱动画
   * @param {number} index - 动画索引
   */
  removeChestAnimation(index) {
    if (index >= 0 && index < this.chestAnimations.length) {
      const anim = this.chestAnimations[index];
      if (anim.mesh.parent) {
        anim.mesh.parent.remove(anim.mesh);
      }
      this.chestAnimations.splice(index, 1);
    }
  }
}

// 宝箱管理器实例
export const chestManager = new Chest();
