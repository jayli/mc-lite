// src/world/World.js
// 世界管理器模块
// 负责区块的加载/卸载、粒子效果、方块放置/移除逻辑
import * as THREE from 'three';
import { Chunk } from './Chunk.js';
import { chestManager } from './entities/Chest.js';
import { persistenceService } from '../services/PersistenceService.js';
import { noise } from '../utils/MathUtils.js';
import { ParticleSystem } from './effects/ParticleSystem.js';

const CHUNK_SIZE = 16;
const RENDER_DIST = 3;

/**
 * 世界管理器类
 * 管理游戏世界中的所有区块、粒子效果和方块操作
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map(); // Key: "cx,cz" -> Chunk

    // 初始化粒子系统
    this.particles = new ParticleSystem(this.scene);

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

    // 更新粒子系统
    this.particles.update(dt);

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
   * 生成挖掘粒子效果 (转发至 ParticleSystem)
   * @param {THREE.Vector3} pos - 粒子生成位置
   */
  spawnParticles(pos) {
    this.particles.spawnDigEffect(pos);
  }

  /**
   * 生成 TNT 爆炸效果 (转发至 ParticleSystem)
   * @param {THREE.Vector3} pos - 爆炸中心位置
   */
  spawnExplosionParticles(pos) {
    // 1. 触发 2D Billboard 爆炸
    this.particles.spawnExplosionEffect(pos);

    // 2. 触发球体扩张特效 (保留在 World 中，作为底层增强)
    const sphere = this.explosionSpheres.find(s => !s.active);
    if (sphere) {
      sphere.active = true;
      sphere.timer = 0;
      sphere.maxLife = 0.3;
      sphere.targetScale = 5.0;
      sphere.mesh.position.copy(pos);
      sphere.mesh.visible = true;
      sphere.mesh.scale.setScalar(0.1);
      sphere.mesh.material.opacity = 1.0;
    }
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
