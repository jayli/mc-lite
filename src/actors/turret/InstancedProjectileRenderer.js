/**
 * InstancedProjectileRenderer.js
 * 炮弹实例化渲染器 - 使用 InstancedMesh 高效渲染大量炮弹
 */

import * as THREE from 'three';

export class InstancedProjectileRenderer {
  /**
   * @param {THREE.Scene} scene - Three.js 场景
   * @param {number} maxCount - 最大炮弹数量（默认100）
   */
  constructor(scene, maxCount = 100) {
    this.scene = scene;
    this.maxCount = maxCount;
    this.activeCount = 0;

    // 共享几何体和材质
    this.geometry = this.createSharedGeometry();
    this.material = this.createSharedMaterial();

    // InstancedMesh
    this.mesh = null;

    // 炮弹状态数组（与 InstancedMesh 的索引对应）
    this.activeIndices = new Set(); // 活跃的炮弹索引
    this.indexPool = []; // 可用索引池

    // 临时对象（避免每帧创建）
    this._tempMatrix = new THREE.Matrix4();
    this._tempScale = new THREE.Vector3(1, 1, 1);

    this.initInstancedMesh();
  }

  /**
   * 创建共享几何体
   * @returns {THREE.BufferGeometry}
   */
  createSharedGeometry() {
    // 使用细长的圆柱体表示激光（稍微粗一点，更容易看到）
    const geometry = new THREE.CylinderGeometry(0.08, 0.08, 2.0, 8);
    // 圆柱体默认是垂直的(Y轴)，需要旋转到Z轴方向
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }

  /**
   * 创建共享材质
   * @returns {THREE.Material}
   */
  createSharedMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.9
    });
  }

  /**
   * 初始化 InstancedMesh
   */
  initInstancedMesh() {
    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      this.maxCount
    );
    this.mesh.name = 'projectile_instanced';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // 频繁更新
    this.mesh.visible = true;

    // 禁用视锥体剔除，避免炮弹在视野外被错误剔除
    this.mesh.frustumCulled = false;

    // 设置较大的边界球，确保渲染
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);

    // 初始化所有实例为不可见
    this._tempMatrix.makeScale(0, 0, 0); // 缩放为0表示隐藏
    for (let i = 0; i < this.maxCount; i++) {
      this.mesh.setMatrixAt(i, this._tempMatrix);
      this.indexPool.push(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.mesh);
  }

  /**
   * 分配一个实例索引
   * @returns {number|null} 实例索引或null（已满）
   */
  acquireIndex() {
    if (this.indexPool.length === 0) {
      console.warn('[InstancedProjectileRenderer] 没有可用的实例索引');
      return null;
    }

    const index = this.indexPool.pop();
    this.activeIndices.add(index);
    this.activeCount++;
    return index;
  }

  /**
   * 释放一个实例索引
   * @param {number} index - 实例索引
   */
  releaseIndex(index) {
    if (!this.activeIndices.has(index)) {
      console.warn(`[InstancedProjectileRenderer] 尝试释放未激活的索引: ${index}`);
      return;
    }

    // 隐藏该实例（缩放为0）
    this._tempMatrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(index, this._tempMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    this.activeIndices.delete(index);
    this.indexPool.push(index);
    this.activeCount--;
  }

  /**
   * 更新炮弹的变换矩阵
   * @param {number} index - 实例索引
   * @param {THREE.Vector3} position - 位置
   * @param {THREE.Quaternion} orientation - 朝向四元数
   */
  updateProjectile(index, position, orientation) {
    if (!this.activeIndices.has(index)) return;

    this._tempMatrix.compose(position, orientation, this._tempScale);
    this.mesh.setMatrixAt(index, this._tempMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * 批量更新多个炮弹（优化版本）
   * @param {Array<number>} indices - 实例索引列表
   * @param {Array} projectiles - 炮弹对象列表
   */
  updateBatch(indices, projectiles) {
    let hasUpdate = false;

    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (!this.activeIndices.has(index)) continue;
      const projectile = projectiles[i];
      if (!projectile) continue;

      this._tempMatrix.compose(projectile.position, projectile.orientation, this._tempScale);
      this.mesh.setMatrixAt(index, this._tempMatrix);
      hasUpdate = true;
    }

    if (hasUpdate) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * 获取活跃炮弹数量
   * @returns {number}
   */
  getActiveCount() {
    return this.activeCount;
  }

  /**
   * 清理所有炮弹
   */
  clear() {
    this._tempMatrix.makeScale(0, 0, 0);

    for (const index of this.activeIndices) {
      this.mesh.setMatrixAt(index, this._tempMatrix);
      this.indexPool.push(index);
    }

    this.activeIndices.clear();
    this.activeCount = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * 销毁渲染器
   */
  destroy() {
    this.clear();

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }

    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }

    if (this.material) {
      this.material.dispose();
      this.material = null;
    }

    this.indexPool = [];
    this.activeIndices.clear();
    this.scene = null;
  }
}
