// src/world/effects/RainEffect.js
// 下雨效果 - 使用 LineSegments 实现始终垂直于地面的雨滴
import * as THREE from 'three';

/**
 * 下雨效果类
 * 管理雨滴粒子，在玩家周围20米半径内生成细长垂直雨滴
 */
export class RainEffect {
  /**
   * 创建下雨效果实例
   * @param {THREE.Scene} scene - Three.js 场景
   * @param {Object} options - 配置选项
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.particleCount = options.particleCount || 400;
    this.radius = options.radius || 20;  // 下雨范围半径20米
    this.speed = options.speed || 24;
    this.dropLength = options.dropLength || 0.5;  // 雨滴长度
    this.refreshDistance = 8;  // 玩家移动超过8格就刷新雨滴范围

    // 玩家位置
    this.playerPos = options.playerPos || { x: 0, y: 0, z: 0 };
    this.lastRefreshPos = { x: this.playerPos.x, y: this.playerPos.y, z: this.playerPos.z };

    // 内部属性
    this.positions = null;
    this.velocities = null;
    this.geometry = null;
    this.material = null;
    this.lines = null;

    this.initParticles();
  }

  /**
   * 初始化粒子系统
   */
  initParticles() {
    // 每个雨滴需要2个顶点（起点和终点）
    const vertexCount = this.particleCount * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.velocities = new Float32Array(this.particleCount);

    // 初始化每个雨滴
    for (let i = 0; i < this.particleCount; i++) {
      this.resetParticle(i, this.playerPos);
      this.velocities[i] = this.speed + Math.random() * 6;
    }

    // 创建 BufferGeometry
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    // 创建材质
    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      linewidth: 1
    });

    // 创建 LineSegments 并添加到场景
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;  // 禁用视锥体剔除，确保雨滴始终可见
    this.scene.add(this.lines);
  }

  /**
   * 重置单个雨滴位置
   * 在玩家周围360度均匀分布
   */
  resetParticle(i, playerPos = { x: 0, y: 0, z: 0 }) {
    // 在圆形区域内随机生成位置，确保均匀分布
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.radius;  // sqrt确保均匀分布
    const x = playerPos.x + Math.cos(angle) * r;
    const topY = playerPos.y + 30 + Math.random() * 20;
    const z = playerPos.z + Math.sin(angle) * r;

    // 设置线段的两个顶点（垂直向下）
    const idx = i * 6;

    // 顶点1（顶部）
    this.positions[idx] = x;
    this.positions[idx + 1] = topY;
    this.positions[idx + 2] = z;

    // 顶点2（底部）
    this.positions[idx + 3] = x;
    this.positions[idx + 4] = topY - this.dropLength;
    this.positions[idx + 5] = z;
  }

  /**
   * 每帧更新雨滴位置
   */
  update(playerPos, dt) {
    if (!playerPos || typeof playerPos.x !== 'number') {
      return;
    }

    // 检查玩家移动距离，超过阈值就刷新所有雨滴位置
    const dx = playerPos.x - this.lastRefreshPos.x;
    const dz = playerPos.z - this.lastRefreshPos.z;
    const moveDist = Math.sqrt(dx * dx + dz * dz);

    if (moveDist > this.refreshDistance) {
      this.lastRefreshPos.x = playerPos.x;
      this.lastRefreshPos.z = playerPos.z;
      for (let i = 0; i < this.particleCount; i++) {
        this.resetParticle(i, playerPos);
      }
      this.geometry.attributes.position.needsUpdate = true;
      return;
    }

    // 正常更新雨滴下落
    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 6;

      const moveY = this.velocities[i] * dt;
      this.positions[idx + 1] -= moveY;
      this.positions[idx + 4] -= moveY;

      if (this.positions[idx + 4] < playerPos.y - 5) {
        this.resetParticle(i, playerPos);
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * 释放 Three.js 资源
   */
  dispose() {
    this.scene.remove(this.lines);

    if (this.geometry) {
      this.geometry.dispose();
    }

    if (this.material) {
      this.material.dispose();
    }

    this.positions = null;
    this.velocities = null;
    this.geometry = null;
    this.material = null;
    this.lines = null;
  }
}