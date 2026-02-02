// src/world/World.js
// 世界管理器模块
// 负责区块的加载/卸载、粒子效果、方块放置/移除逻辑
import * as THREE from 'three';
import { Chunk } from './Chunk.js';
import { materials } from '../core/materials/MaterialManager.js';
import { chestManager } from './entities/Chest.js';
import { persistenceService } from '../services/PersistenceService.js';
import { noise } from '../utils/MathUtils.js';

const CHUNK_SIZE = 16;
const RENDER_DIST = 3;
// 默认为白色
const white_color = new THREE.Color(0xffffff);

/**
 * 世界管理器类
 * 管理游戏世界中的所有区块、粒子效果和方块操作
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map(); // Key: "cx,cz" -> Chunk

    // 粒子系统优化：使用 InstancedMesh 统一管理所有挖掘粒子，大幅减少 Draw Call
    this.MAX_PARTICLES = 128; // 增加粒子上限以支持爆炸效果
    this.particleGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1); // 每个粒子的基础几何体 (0.1单位的小方块)
    this.particleGeometryBlow = new THREE.BoxGeometry(0.5, 0.5, 0.5); // 爆炸粒子
    this.particleMaterial = new THREE.MeshBasicMaterial();
    this.particleMesh = new THREE.InstancedMesh(this.particleGeometry, this.particleMaterial, this.MAX_PARTICLES);
    // DynamicDrawUsage: 提示 WebGL 粒子位置会频繁更新，优化 GPU 缓冲区上传速度
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false; // 禁用视锥体裁剪，防止因实例矩阵变换导致边界球失效而误删渲染
    // 预先创建颜色属性，用于使粒子颜色与被挖掘方块匹配
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX_PARTICLES * 3), 3);
    this.scene.add(this.particleMesh);

    // 爆炸粒子系统：使用更大的几何体 (particleGeometryBlow)
    this.explosionMesh = new THREE.InstancedMesh(this.particleGeometryBlow, this.particleMaterial, this.MAX_PARTICLES/3);
    this.explosionMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.explosionMesh.frustumCulled = false;
    this.explosionMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX_PARTICLES * 3), 3);
    this.scene.add(this.explosionMesh);

    this.particlesData = []; // 普通粒子数据
    this.explosionData = []; // 爆炸粒子数据
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particlesData.push({ active: false, vel: new THREE.Vector3(), life: 0, pos: new THREE.Vector3() });
      this.explosionData.push({ active: false, vel: new THREE.Vector3(), life: 0, pos: new THREE.Vector3() });

      // 初始隐藏
      this.particleMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.explosionMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    this.particleNextIndex = 0;
    this.explosionNextIndex = 0;
    this.dummy = new THREE.Object3D(); // 用于辅助计算矩阵

    // 爆炸球体特效池
    this.MAX_EXPLOSION_SPHERES = 15;
    this.explosionSphereGeometry = new THREE.SphereGeometry(1, 24, 24);
    this.explosionSpheres = [];
    for (let i = 0; i < this.MAX_EXPLOSION_SPHERES; i++) {
      const mesh = new THREE.Mesh(
        this.explosionSphereGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffff00,
          transparent: true,
          opacity: 0,
          depthWrite: false, // 避免深度冲突
          side: THREE.DoubleSide
        })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.explosionSpheres.push({
        mesh: mesh,
        active: false,
        timer: 0,
        maxLife: 0.6,
        targetScale: 8.0
      });
    }
  }

  /**
   * 更新世界状态
   * @param {THREE.Vector3} playerPos - 玩家当前位置
   * @param {number} dt - 增量时间（秒）
   */
  update(playerPos = new THREE.Vector3(), dt = 0) { // Default for safety
    const cx = Math.floor(playerPos.x / CHUNK_SIZE); // 玩家当前所在的区块 X 坐标
    const cz = Math.floor(playerPos.z / CHUNK_SIZE); // 玩家当前所在的区块 Z 坐标

    // ... (加载/卸载区块逻辑保持不变) ...
    // 加载新区块：根据玩家位置加载渲染距离 (RENDER_DIST=3) 内的所有区块
    for (let i = -RENDER_DIST; i <= RENDER_DIST; i++) {
      for (let j = -RENDER_DIST; j <= RENDER_DIST; j++) {
        const key = `${cx + i},${cz + j}`;
        if (!this.chunks.has(key)) {
          const chunk = new Chunk(cx + i, cz + j, this);
          this.chunks.set(key, chunk);
          this.scene.add(chunk.group);
        }
      }
    }

    // Unload old chunks
    // 卸载旧区块：卸载超出渲染距离 (+1缓冲) 的区块，释放 GPU 显存和内存资源
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - cx) > RENDER_DIST + 1 || Math.abs(chunk.cz - cz) > RENDER_DIST + 1) {
        this.scene.remove(chunk.group);
        // 持久化区块修改：将该区块的快照数据存入 IndexedDB
        persistenceService.saveChunkData(chunk.cx, chunk.cz);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }

    // Update particles (普通粒子)
    let digUpdate = false;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      const p = this.particlesData[i];
      if (!p.active) continue;
      p.life -= 0.04;
      p.pos.add(p.vel);
      p.vel.y -= 0.01;
      if (p.life <= 0) { p.active = false; this.dummy.scale.setScalar(0); }
      else { this.dummy.position.copy(p.pos); this.dummy.scale.setScalar(p.life); }
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      digUpdate = true;
    }
    if (digUpdate) this.particleMesh.instanceMatrix.needsUpdate = true;

    // Update explosion particles (爆炸粒子)
    let expUpdate = false;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      const p = this.explosionData[i];
      if (!p.active) continue;
      p.life -= 0.02; // 爆炸粒子消失慢一点，更有视觉冲击力
      p.pos.add(p.vel);
      p.vel.y -= 0.005; // 受到重力影响也小一点
      if (p.life <= 0) { p.active = false; this.dummy.scale.setScalar(0); }
      else { this.dummy.position.copy(p.pos); this.dummy.scale.setScalar(p.life); }
      this.dummy.updateMatrix();
      this.explosionMesh.setMatrixAt(i, this.dummy.matrix);
      expUpdate = true;
    }
    if (expUpdate) this.explosionMesh.instanceMatrix.needsUpdate = true;

    // 更新爆炸球体特效
    for (const s of this.explosionSpheres) {
      if (!s.active) continue;
      s.timer += dt;
      const progress = s.timer / s.maxLife;
      if (progress >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        // 使用自定义的目标缩放
        const scale = 0.1 + progress * s.targetScale;
        s.mesh.scale.setScalar(scale);
        // 从 1.0 变透明到 0.0，使用平方根使消失更平滑
        s.mesh.material.opacity = Math.pow(1.0 - progress, 1.5);
      }
    }

    // Update chest animations
    chestManager.update(dt);
  }

  /**
   * 生成粒子效果
   * @param {THREE.Vector3} pos - 粒子生成位置
   * @param {string} type - 方块类型，用于确定粒子颜色
   */
  spawnParticles(pos, type) {
    let material = materials.getMaterial(type);
    if (Array.isArray(material)) material = material[0];

    // 从材质中提取颜色，如果是 MeshStandardMaterial 则有 color 属性 (THREE.Color)
    const color = white_color;

    for (let i = 0; i < 4; i++) { // 稍微增加粒子数量
      const idx = this.particleNextIndex;
      const p = this.particlesData[idx];

      p.active = true;
      p.pos.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.1) * 0.5,
        (Math.random() - 0.5) * 0.5
      ));
      p.vel.set(
        (Math.random() - 0.5) * 0.1,
        Math.random() * 0.15 + 0.05,
        (Math.random() - 0.5) * 0.1
      );
      p.life = 1.0;

      this.dummy.position.copy(p.pos);
      this.dummy.scale.setScalar(p.life);
      this.dummy.rotation.set(0, 0, 0); // 重置旋转
      this.dummy.updateMatrix();

      this.particleMesh.setMatrixAt(idx, this.dummy.matrix);
      this.particleMesh.setColorAt(idx, color);

      this.particleNextIndex = (this.particleNextIndex + 1) % this.MAX_PARTICLES;
    }

    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  /**
   * 生成 TNT 爆炸粒子效果
   * @param {THREE.Vector3} pos - 爆炸中心位置
   */
  spawnExplosionParticles(pos) {
    const explosionColors = [
      new THREE.Color(0xffffff), // 白色 (闪光)
      new THREE.Color(0xffcc00), // 黄色 (火花)
      new THREE.Color(0xff6600), // 橙色 (火焰)
      new THREE.Color(0x666666),  // 灰色 (烟雾)
      new THREE.Color(0xfd52d3),  // 分红 (火焰)
      new THREE.Color(0xf7ff13),  // 纯黄 (火焰)
    ];

    const particleCount = 30; // 爆炸产生的粒子数量

    for (let i = 0; i < particleCount; i++) {
      const idx = this.explosionNextIndex;
      const p = this.explosionData[idx];

      p.active = true;
      p.pos.copy(pos);

      // 随机方向的强力爆发速度
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 0.2 + Math.random() * 0.4;

      p.vel.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      );

      // 爆炸粒子生命周期
      p.life = 1.0 + Math.random() * 0.5;

      this.dummy.position.copy(p.pos);
      this.dummy.scale.setScalar(p.life);
      this.dummy.updateMatrix();

      this.explosionMesh.setMatrixAt(idx, this.dummy.matrix);

      // 随机分配爆炸颜色
      const color = explosionColors[Math.floor(Math.random() * explosionColors.length)];
      this.explosionMesh.setColorAt(idx, color);

      this.explosionNextIndex = (this.explosionNextIndex + 1) % this.MAX_PARTICLES;
    }

    // 触发球体扩张特效
    const sphere = this.explosionSpheres.find(s => !s.active);
    if (sphere) {
      sphere.active = true;
      sphere.timer = 0;
      sphere.maxLife = 0.3; //+ Math.random() * 0.4;
      sphere.targetScale = 4.0; //+ Math.random() * 6.0;
      sphere.mesh.position.copy(pos);
      sphere.mesh.visible = true;
      sphere.mesh.scale.setScalar(0.1);
      sphere.mesh.material.opacity = 1.0;
    }

    this.explosionMesh.instanceMatrix.needsUpdate = true;
    if (this.explosionMesh.instanceColor) this.explosionMesh.instanceColor.needsUpdate = true;
  }

  /**
   * 批量移除指定位置的方块
   * @param {Array<{x,y,z}>} positions
   */
  removeBlocksBatch(positions) {
    const chunkGroups = new Map();
    positions.forEach(p => {
      const cx = Math.floor(p.x / CHUNK_SIZE);
      const cz = Math.floor(p.z / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      if (!chunkGroups.has(key)) chunkGroups.set(key, []);
      chunkGroups.get(key).push(p);
    });

    for (const [key, chunkPosList] of chunkGroups) {
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.removeBlocksBatch(chunkPosList);
      }
    }
  }

  /**
   * 判断指定位置是否为固体方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {boolean} 是否为固体方块
   */
  isSolid(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);

    // 如果区块正在加载中，使用简单的噪声高度图作为物理占位，防止玩家掉入虚空
    if (!chunk || !chunk.isReady) {
      // 使用与 TerrainGen 类似的比例来估算高度
      const h = Math.floor(noise(x, z, 0.08) + noise(x, z, 0.02) * 3);
      // 允许一点点误差，确保玩家不会卡在土里
      return y <= h;
    }

    const blockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return chunk.solidBlocks.has(blockKey);
  }

  /**
   * 获取指定位置的方块类型
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {string|null}
   */
  getBlock(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return null;

    const blockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return chunk.blockData[blockKey] || null;
  }

  /**
   * 在指定位置放置方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @param {string} type - 方块类型
   */
  setBlock(x, y, z, type) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let chunk = this.chunks.get(key);

    if (!chunk) {
      // Should create chunk if doesn't exist? Or ignore?
      // Usually we only place in loaded chunks.
      // 区块未加载，忽略放置操作
      return;
    }

    // Add logical block
    // For refactor parity, main.js just pushed mesh to scene.
    // Chunk.js adds to local tracking.
    // We need to actually add a mesh instance or a single mesh.
    // Chunk architecture here uses InstancedMesh for initial gen.
    // Dynamic blocks should probably be separate or managed.
    // Simple approach: Chunk.addBlock(x,y,z,type) -> adds single Mesh to group.
    // Rebuilding whole chunk instanced mesh is too expensive for single block place.
    // 添加逻辑方块：调用区块的动态方块添加方法
    chunk.addBlockDynamic(x, y, z, type);
    // 记录持久化变更
    persistenceService.recordChange(x, y, z, type);
  }

  /**
   * 移除指定位置的方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   */
  removeBlock(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.removeBlock(x, y, z);
    }
  }

  /**
   * 移除指定位置的方块碰撞体（无副作用）
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   */
  removeBlockCollider(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.removeCollisionKey(x, y, z);
    }
  }
}
