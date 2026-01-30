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
    this.MAX_PARTICLES = 8; // 最大粒子数量，保持较小值以平衡视觉效果和性能
    this.particleGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1); // 每个粒子的基础几何体 (0.1单位的小方块)
    this.particleMaterial = new THREE.MeshBasicMaterial();
    this.particleMesh = new THREE.InstancedMesh(this.particleGeometry, this.particleMaterial, this.MAX_PARTICLES);
    // DynamicDrawUsage: 提示 WebGL 粒子位置会频繁更新，优化 GPU 缓冲区上传速度
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false; // 禁用视锥体裁剪，防止因实例矩阵变换导致边界球失效而误删渲染
    // 预先创建颜色属性，用于使粒子颜色与被挖掘方块匹配
    this.particleMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.MAX_PARTICLES * 3), 3);
    this.scene.add(this.particleMesh);

    this.particlesData = [];
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particlesData.push({
        active: false,
        vel: new THREE.Vector3(),
        life: 0,
        pos: new THREE.Vector3()
      });
      // 初始隐藏所有实例
      this.particleMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    this.particleNextIndex = 0;
    this.dummy = new THREE.Object3D(); // 用于辅助计算矩阵
  }

  /**
   * 更新世界状态
   * @param {THREE.Vector3} playerPos - 玩家当前位置
   * @param {number} dt - 增量时间（秒）
   */
  update(playerPos = new THREE.Vector3(), dt = 0) { // Default for safety
    const cx = Math.floor(playerPos.x / CHUNK_SIZE); // 玩家当前所在的区块 X 坐标
    const cz = Math.floor(playerPos.z / CHUNK_SIZE); // 玩家当前所在的区块 Z 坐标

    // Load new chunks
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
        // 持久化区块修改：将该区块的 Delta 数据存入 IndexedDB
        persistenceService.flush(chunk.cx, chunk.cz);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }

    // Update particles
    // 更新粒子效果：使用 InstancedMesh 统一更新所有粒子的物理状态和矩阵
    let needsUpdate = false;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      const p = this.particlesData[i];
      if (!p.active) continue;

      p.life -= 0.04; // 消失速度快一倍 (原为 0.02)
      p.pos.add(p.vel);
      p.vel.y -= 0.01;

      if (p.life <= 0) {
        p.active = false;
        this.dummy.scale.setScalar(0);
      } else {
        this.dummy.position.copy(p.pos);
        this.dummy.scale.setScalar(p.life);
      }

      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummy.matrix);
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }

    // Update chest animations
    // 更新宝箱动画：通过宝箱管理器更新所有宝箱的动画状态
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
    // 性能考虑可以先关闭，后面再打开
    persistenceService.flush(cx, cz);
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
      // 立即持久化删除操作
      // 性能考虑可以先关闭，后面再打开
      persistenceService.flush(cx, cz);
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
      persistenceService.flush(cx, cz);
    }
  }
}
