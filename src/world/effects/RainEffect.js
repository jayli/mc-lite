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
    this.lineWidth = options.lineWidth || 2;
    this.refreshDistance = options.refreshDistance || 8;  // 玩家移动超过8格就刷新雨滴范围
    this.refreshDistanceSq = this.refreshDistance * this.refreshDistance;
    this.refreshInterval = options.refreshInterval || (1 / 30); // 30Hz 进行玩家位置检查
    this.verticalRefreshDistance = options.verticalRefreshDistance || 6;
    this.cycleHeight = options.cycleHeight || 42;
    this.refreshBatchSize = options.refreshBatchSize || 64; // 分批刷新，削峰
    this.floorOffset = options.floorOffset || 0.02;
    this.searchDepth = options.searchDepth || 56;
    this.world = options.world || null;

    // 玩家位置
    this.playerPos = options.playerPos || { x: 0, y: 0, z: 0 };
    this.lastRefreshPos = { x: this.playerPos.x, y: this.playerPos.y, z: this.playerPos.z };
    this.elapsedTime = 0;
    this.refreshAccumulator = 0;
    this.isRefreshing = false;
    this.refreshCursor = 0;
    this.refreshTargetPos = { x: this.playerPos.x, y: this.playerPos.y, z: this.playerPos.z };

    // 内部属性
    this.positions = null;
    this.phases = null;
    this.speedScales = null;
    this.isBottomVertex = null;
    this.minYs = null;
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
    this.phases = new Float32Array(vertexCount);
    this.speedScales = new Float32Array(vertexCount);
    this.isBottomVertex = new Float32Array(vertexCount);
    this.minYs = new Float32Array(vertexCount);

    // 初始化每个雨滴
    for (let i = 0; i < this.particleCount; i++) {
      this.resetParticle(i, this.playerPos);
    }

    // 创建 BufferGeometry
    this.geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(this.positions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttr);
    this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(this.phases, 1));
    this.geometry.setAttribute('aSpeedScale', new THREE.BufferAttribute(this.speedScales, 1));
    this.geometry.setAttribute('aIsBottomVertex', new THREE.BufferAttribute(this.isBottomVertex, 1));
    this.geometry.setAttribute('aMinY', new THREE.BufferAttribute(this.minYs, 1));

    // 使用 ShaderMaterial 将雨滴下落计算移动到 GPU
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uBaseSpeed: { value: this.speed },
        uDropLength: { value: this.dropLength },
        uCycleHeight: { value: this.cycleHeight },
        uOpacity: { value: 0.6 }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uBaseSpeed;
        uniform float uDropLength;
        uniform float uCycleHeight;
        attribute float aPhase;
        attribute float aSpeedScale;
        attribute float aIsBottomVertex;
        attribute float aMinY;

        void main() {
          vec3 transformed = position;
          float fallDistance = mod((uTime * uBaseSpeed * aSpeedScale) + aPhase, uCycleHeight);
          transformed.y = position.y - fallDistance - (aIsBottomVertex * uDropLength);
          transformed.y = max(transformed.y, aMinY);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;

        void main() {
          gl_FragColor = vec4(1.0, 1.0, 1.0, uOpacity);
        }
      `
    });
    this.material.linewidth = this.lineWidth;

    // 创建 LineSegments 并添加到场景
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;  // 禁用视锥体剔除，确保雨滴始终可见
    this.scene.add(this.lines);
  }

  /**
   * 重置单个雨滴位置
   * 在玩家周围360度均匀分布
   */
  resetParticle(i, playerPos = { x: 0, y: 0, z: 0 }, randomizeDynamics = true) {
    // 在圆形区域内随机生成位置，确保均匀分布
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.radius;  // sqrt确保均匀分布
    const x = playerPos.x + Math.cos(angle) * r;
    const topY = playerPos.y + 30 + Math.random() * 20;
    const z = playerPos.z + Math.sin(angle) * r;
    const minY = this.resolveRainMinY(x, topY, z, playerPos.y);

    const phase = randomizeDynamics ? (Math.random() * this.cycleHeight) : null;
    const speedScale = randomizeDynamics ? (0.85 + Math.random() * 0.35) : null;

    // 设置线段的两个顶点（垂直向下）
    const idx = i * 6;
    const vertexIdx = i * 2;

    // 顶点1（顶部）
    this.positions[idx] = x;
    this.positions[idx + 1] = topY;
    this.positions[idx + 2] = z;
    if (randomizeDynamics) {
      this.phases[vertexIdx] = phase;
      this.speedScales[vertexIdx] = speedScale;
    }
    this.isBottomVertex[vertexIdx] = 0;
    this.minYs[vertexIdx] = minY;

    // 顶点2（底部，位置与顶点1一致，长度在 shader 中通过 uDropLength 计算）
    this.positions[idx + 3] = x;
    this.positions[idx + 4] = topY;
    this.positions[idx + 5] = z;
    if (randomizeDynamics) {
      this.phases[vertexIdx + 1] = phase;
      this.speedScales[vertexIdx + 1] = speedScale;
    }
    this.isBottomVertex[vertexIdx + 1] = 1;
    this.minYs[vertexIdx + 1] = minY;
  }

  /**
   * 计算雨滴可见最低高度：
   * - 有实心方块时，停在该方块顶部
   * - 无遮挡时，保持默认循环最低高度
   */
  resolveRainMinY(x, topY, z, playerY = 0) {
    const defaultMinY = playerY - (this.cycleHeight * 0.35);
    if (!this.world || typeof this.world.isSolid !== 'function') {
      return defaultMinY;
    }

    const startY = Math.floor(topY);
    const endY = Math.floor(Math.max(defaultMinY, topY - this.searchDepth));
    for (let y = startY; y >= endY; y--) {
      if (this.world.isSolid(x, y, z)) {
        return y + 1 + this.floorOffset;
      }
    }
    return defaultMinY;
  }

  /**
   * 启动分批刷新，将雨幕中心逐步迁移到目标点
   */
  startBatchedRefresh(playerPos) {
    if (!playerPos) return;

    const dx = playerPos.x - this.refreshTargetPos.x;
    const dy = playerPos.y - this.refreshTargetPos.y;
    const dz = playerPos.z - this.refreshTargetPos.z;
    const targetChangedEnough = (dx * dx + dz * dz) > (this.refreshDistanceSq * 0.36)
      || Math.abs(dy) > (this.verticalRefreshDistance * 0.6);

    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshCursor = 0;
    } else if (targetChangedEnough) {
      // 刷新目标变化较大时，从头开始，避免旧目标尾部残留
      this.refreshCursor = 0;
    }

    this.refreshTargetPos.x = playerPos.x;
    this.refreshTargetPos.y = playerPos.y;
    this.refreshTargetPos.z = playerPos.z;
  }

  /**
   * 每帧处理一批雨滴刷新，降低单帧尖峰
   */
  processBatchedRefresh() {
    if (!this.isRefreshing) return;

    const end = Math.min(this.refreshCursor + this.refreshBatchSize, this.particleCount);
    for (let i = this.refreshCursor; i < end; i++) {
      // 分批刷新只迁移位置，不改速度相位，减少额外 attribute 上传
      this.resetParticle(i, this.refreshTargetPos, false);
    }
    this.refreshCursor = end;

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aMinY.needsUpdate = true;

    if (this.refreshCursor >= this.particleCount) {
      this.isRefreshing = false;
      this.lastRefreshPos.x = this.refreshTargetPos.x;
      this.lastRefreshPos.y = this.refreshTargetPos.y;
      this.lastRefreshPos.z = this.refreshTargetPos.z;
    }
  }

  /**
   * 每帧更新雨滴位置
   */
  update(playerPos, dt) {
    if (!playerPos || typeof playerPos.x !== 'number') {
      return;
    }

    this.elapsedTime += dt;
    this.material.uniforms.uTime.value = this.elapsedTime;
    this.processBatchedRefresh();

    // 位置刷新增量检查降频到 30Hz，避免每帧进行不必要的主线程判断
    this.refreshAccumulator += dt;
    if (this.refreshAccumulator < this.refreshInterval) {
      return;
    }
    this.refreshAccumulator = 0;

    // 检查玩家移动距离，超过阈值就刷新所有雨滴位置
    const referencePos = this.isRefreshing ? this.refreshTargetPos : this.lastRefreshPos;
    const dx = playerPos.x - referencePos.x;
    const dy = playerPos.y - referencePos.y;
    const dz = playerPos.z - referencePos.z;
    const moveDistSq = dx * dx + dz * dz;

    if (moveDistSq > this.refreshDistanceSq || Math.abs(dy) > this.verticalRefreshDistance) {
      this.startBatchedRefresh(playerPos);
    }
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
    this.phases = null;
    this.speedScales = null;
    this.isBottomVertex = null;
    this.minYs = null;
    this.geometry = null;
    this.material = null;
    this.lines = null;
  }
}
