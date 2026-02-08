// src/world/World.js
// 世界管理器模块
// 负责区块的加载/卸载、粒子效果、方块放置/移除逻辑、爆炸效果和物理查询
import * as THREE from 'three';
import { Chunk } from './Chunk.js';
import { chestManager } from './entities/Chest.js';
import { persistenceService } from '../services/PersistenceService.js';
import { noise } from '../utils/MathUtils.js';
import { ParticleSystem } from './effects/ParticleSystem.js';

// --- 全局世界常量 ---
/** 每个区块在 X 和 Z 方向上的大小 (16x16) */
const CHUNK_SIZE = 16;
/** 渲染距离（以区块为单位），玩家周围 3x3 的区块将被加载 */
const RENDER_DIST = 3;

/**
 * 世界管理器类
 * 管理游戏世界中的所有区块、粒子效果和方块操作，是世界数据的中央访问点
 */
export class World {
  /**
   * @param {THREE.Scene} scene - Three.js 场景对象，用于添加/移除区块网格
   */
  constructor(scene) {
    this.scene = scene;
    /** 存储当前加载的所有区块，Key 为 "cx,cz" 字符串 */
    this.chunks = new Map();

    // 初始化粒子系统，处理挖掘和爆炸的视觉效果
    this.particles = new ParticleSystem(this.scene);

    /** 用于辅助计算变换矩阵的虚拟对象，避免频繁实例化 */
    this.dummy = new THREE.Object3D();

    // --- 爆炸球体特效池 ---
    /** 最大同时显示的爆炸球体数量 */
    this.MAX_EXPLOSION_SPHERES = 15;
    /** 球体几何体 */
    this.explosionSphereGeometry = new THREE.SphereGeometry(1, 24, 24);
    /** 爆炸球体特效对象池 */
    this.explosionSpheres = [];
    for (let i = 0; i < this.MAX_EXPLOSION_SPHERES; i++) {
      const mesh = new THREE.Mesh(
        this.explosionSphereGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffff00,
          transparent: true,
          opacity: 0,
          depthWrite: false, // 避免深度冲突，提升重叠球体的视觉效果
          side: THREE.DoubleSide
        })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.explosionSpheres.push({
        mesh: mesh,      // Three.js 网格
        active: false,    // 是否激活中
        timer: 0,         // 当前存活时间
        maxLife: 0.6,     // 最大存活时间（秒）
        targetScale: 8.0  // 球体扩张的目标缩放
      });
    }
  }

  /**
   * 更新世界状态：处理区块加载卸载、粒子更新和特效更新
   * @param {THREE.Vector3} playerPos - 玩家当前的世界坐标
   * @param {number} dt - 自上一帧以来的增量时间（秒）
   */
  update(playerPos = new THREE.Vector3(), dt = 0) {
    // 计算玩家所在的区块坐标
    const cx = Math.floor(playerPos.x / CHUNK_SIZE);
    const cz = Math.floor(playerPos.z / CHUNK_SIZE);

    // --- 加载新区块 ---
    // 遍历渲染距离范围内的所有坐标，如果未加载则创建新区块
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

    // --- 卸载过期区块 ---
    // 遍历已加载区块，卸载超出渲染距离（额外加1作为缓冲）的区块
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - cx) > RENDER_DIST + 1 || Math.abs(chunk.cz - cz) > RENDER_DIST + 1) {
        this.scene.remove(chunk.group);
        // 重要：在卸载前请求持久化，确保修改不丢失
        persistenceService.saveChunkData(chunk.cx, chunk.cz);
        chunk.dispose(); // 释放显存
        this.chunks.delete(key);
      }
    }

    // 更新粒子系统逻辑（运动、透明度衰减等）
    this.particles.update(dt);

    // --- 更新爆炸球体特效动画 ---
    for (const s of this.explosionSpheres) {
      if (!s.active) continue;
      s.timer += dt;
      const progress = s.timer / s.maxLife;
      if (progress >= 1) {
        s.active = false;
        s.mesh.visible = false;
      } else {
        // 球体从小扩张到 targetScale
        const scale = 0.1 + progress * s.targetScale;
        s.mesh.scale.setScalar(scale);
        // 使用指数函数实现先慢后快的透明度淡出效果
        s.mesh.material.opacity = Math.pow(1.0 - progress, 1.5);
      }
    }

    // 更新宝箱打开/关闭动画
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
   * 批量移除指定位置的方块（用于爆炸或大规模编辑）
   * @param {Array<{x:number, y:number, z:number}>} positions - 待移除方块的世界坐标列表
   */
  removeBlocksBatch(positions) {
    // 将坐标按区块分组，减少跨区块调用次数，提升性能
    const chunkGroups = new Map();
    positions.forEach(p => {
      const cx = Math.floor(p.x / CHUNK_SIZE);
      const cz = Math.floor(p.z / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      if (!chunkGroups.has(key)) chunkGroups.set(key, []);
      chunkGroups.get(key).push(p);
    });

    // 针对每个区块执行批量删除优化
    for (const [key, chunkPosList] of chunkGroups) {
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.removeBlocksBatch(chunkPosList);
      }
    }
  }

  /**
   * 判断指定世界坐标是否为实心方块（用于物理碰撞检测）
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {boolean} 是否发生碰撞
   */
  isSolid(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);

    // --- 边界情况处理 ---
    // 如果该坐标所在的区块尚未创建或尚未从 Worker 加载完成（isReady=false）
    // 为了防止玩家掉入虚空，使用基础高度图噪声函数进行物理占位
    if (!chunk || !chunk.isReady) {
      // 使用与 TerrainGen 一致的噪声参数来估算地表高度
      const h = Math.floor(noise(x, z, 0.08) + noise(x, z, 0.02) * 3);
      // y 小于地表高度则视为实心
      return y <= h;
    }

    // 获取方块在区块内的精确碰撞状态（通过 Set 进行 O(1) 查询）
    const blockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return chunk.solidBlocks.has(blockKey);
  }

  /**
   * 获取指定世界坐标的方块类型名称
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {string|null} 方块类型（如 'stone'），如果区块未加载则返回 null
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
   * 在世界中放置一个新的方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string} type - 方块类型名称
   */
  setBlock(x, y, z, type) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let chunk = this.chunks.get(key);

    if (!chunk) {
      // 只能在已加载的区块中放置方块，否则忽略
      return;
    }

    // 逻辑委托：调用区块的动态添加方法，处理网格生成和邻居面更新
    chunk.addBlockDynamic(x, y, z, type);
    // 持久化：通知持久化服务记录这一变更
    persistenceService.recordChange(x, y, z, type);
  }

  /**
   * 移除指定世界坐标的方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
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
   * 移除特定坐标的碰撞键（仅影响物理，不改变渲染，用于特定实体逻辑）
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
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
