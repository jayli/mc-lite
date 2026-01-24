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

/**
 * 世界管理器类
 * 管理游戏世界中的所有区块、粒子效果和方块操作
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map(); // Key: "cx,cz" -> Chunk
    this.activeParticles = [];
  }

  /**
   * 更新世界状态
   * @param {THREE.Vector3} playerPos - 玩家当前位置
   * @param {number} dt - 增量时间（秒）
   */
  update(playerPos = new THREE.Vector3(), dt = 0) { // Default for safety
    const cx = Math.floor(playerPos.x / CHUNK_SIZE);
    const cz = Math.floor(playerPos.z / CHUNK_SIZE);

    // Load new chunks
    // 加载新区块：根据玩家位置加载渲染距离内的区块
    for (let i = -RENDER_DIST; i <= RENDER_DIST; i++) {
      for (let j = -RENDER_DIST; j <= RENDER_DIST; j++) {
        const key = `${cx + i},${cz + j}`;
        if (!this.chunks.has(key)) {
          const chunk = new Chunk(cx + i, cz + j);
          this.chunks.set(key, chunk);
          this.scene.add(chunk.group);
        }
      }
    }

    // Unload old chunks
    // 卸载旧区块：卸载超出渲染距离的区块以节省内存
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - cx) > RENDER_DIST + 1 || Math.abs(chunk.cz - cz) > RENDER_DIST + 1) {
        this.scene.remove(chunk.group);
        // 持久化区块修改
        persistenceService.flush(chunk.cx, chunk.cz);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }

    // Update particles
    // 更新粒子效果：更新所有活跃粒子的生命周期、位置和缩放
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.userData.life -= 0.02;
      p.position.add(p.userData.vel);
      p.userData.vel.y -= 0.01;
      p.scale.setScalar(p.userData.life);
      if (p.userData.life <= 0) {
        this.scene.remove(p);
        // p.geometry.dispose(); // Shared geometry, do not dispose
        // p.material.dispose(); // Shared material, do not dispose (if using manager)
        // Actually, particles use basic material created on fly often.
        if (p.material.dispose) p.material.dispose();
        this.activeParticles.splice(i, 1);
      }
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
    const matDef = materials.getMaterial(type);
    // Extract color from material if possible, or lookup
    // Simplified: just use a basic material with approximate color
    // 从材质定义中提取颜色，或使用默认白色
    const color = matDef.color || 0xffffff;
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1); // Small particle

    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(geometry, mat);
      p.position.copy(pos).addScalar((Math.random() - 0.5) * 0.8);
      p.userData = { vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2), life: 1.0 };
      this.scene.add(p);
      this.activeParticles.push(p);
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

    const blockKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
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
}
