// src/world/World.js
// 世界管理器模块
// 负责区块的加载/卸载、粒子效果、方块放置/移除逻辑、爆炸效果和物理查询
import * as THREE from 'three';
import { Chunk } from './Chunk.js';
import { chestManager } from './entities/Chest.js';
import { persistenceService } from '../services/PersistenceService.js';
import { noise } from '../utils/MathUtils.js';
import { ParticleSystem } from './effects/ParticleSystem.js';
import { parseBlockEntry } from '../utils/OrientationUtils.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;
const getChestManager = () => globalThis._chestManager || chestManager;
const getParticleSystem = () => globalThis._ParticleSystem || ParticleSystem;

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
    const ParticleSystemClass = getParticleSystem();
    this.particles = new ParticleSystemClass(this.scene);

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

    // --- 批量 Face Culling 更新定时器 ---
    // 用于 Mag7、TNT 等批量删除场景，避免 AO 阴影计算丢失
    this.batchFaceCullingTimeout = null;

    // --- 方块查询缓存 ---
    // 命中缓存：blockKey -> 所属 chunkKey（仅缓存跨区块命中）
    this.crossChunkOwnerCache = new Map();

    // --- Chunk 就绪状态跟踪 ---
    // 用于检测 Chunk 就绪状态变化，触发阴影更新
    this._lastReadyChunkCount = 0;
    this._lastReadyChunkKeys = new Set();

    // 阴影按需刷新回调（由 Game/Engine 注入）
    this.shadowUpdateCallback = null;
  }

  /**
   * 注入阴影刷新回调
   * @param {(reason?: string) => void} callback - 阴影刷新函数
   */
  setShadowUpdateCallback(callback) {
    this.shadowUpdateCallback = typeof callback === 'function' ? callback : null;
  }

  /**
   * 请求刷新阴影贴图（按需刷新）
   * @param {string} [reason='world-change'] - 触发原因
   */
  requestShadowMapUpdate(reason = 'world-change') {
    if (!this.shadowUpdateCallback) return;
    this.shadowUpdateCallback(reason);
  }

  /**
   * 更新世界状态：处理区块加载卸载、粒子更新和特效更新
   * @param {THREE.Vector3} playerPos - 玩家当前的世界坐标
   * @param {number} dt - 自上一帧以来的增量时间（秒）
   */
  update(playerPos = new THREE.Vector3(), dt = 0) {
    let chunkTopologyChanged = false;

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
          chunkTopologyChanged = true;
        }
      }
    }

    // --- 卸载过期区块 ---
    // 遍历已加载区块，卸载超出渲染距离（额外加1作为缓冲）的区块
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - cx) > RENDER_DIST + 1 || Math.abs(chunk.cz - cz) > RENDER_DIST + 1) {
        // 重要：在卸载前通知 MinecartManager 停止该 Chunk 内的矿车运动并保存状态
        if (this.minecartManager) {
          this.minecartManager.stopMinecartsForChunk(chunk.cx, chunk.cz);
        }
        this.scene.remove(chunk.group);
        // 重要：在卸载前请求持久化，确保修改不丢失
        getPersistenceService().saveChunkData(chunk.cx, chunk.cz);
        // 清理待处理的 Face Culling 更新
        chunk.pendingBatchFaceCullingUpdates?.clear();
        if (chunk.batchFaceCullingTimer) {
          clearTimeout(chunk.batchFaceCullingTimer);
          chunk.batchFaceCullingTimer = null;
        }
        chunk.dispose(); // 释放显存
        this.chunks.delete(key);
        chunkTopologyChanged = true;
      }
    }

    if (chunkTopologyChanged) {
      this.clearBlockLookupCaches();
      this.requestShadowMapUpdate('chunk-topology-changed');
    }

    // Chunk 就绪数量变化时执行一次去重，避免历史重复 owner 长期存在
    let readyChunkCount = 0;
    const readyChunkKeys = new Set();
    for (const [, chunk] of this.chunks) {
      if (chunk?.isReady) {
        readyChunkCount++;
        readyChunkKeys.add(`${chunk.cx},${chunk.cz}`);
      }
    }
    const readyStateChanged =
      readyChunkCount !== this._lastReadyChunkCount ||
      readyChunkKeys.size !== this._lastReadyChunkKeys.size ||
      [...readyChunkKeys].some(key => !this._lastReadyChunkKeys.has(key));

    if (readyStateChanged) {
      // 移除 _dedupeLoadedChunkOwners 调用：Worker 已按坐标正确归属方块，不再需要兜底清理
      // 同时移除 AO 边界重算：方块只被一个 Chunk 渲染一次，AO 不会重复着色

      this._lastReadyChunkCount = readyChunkCount;
      this._lastReadyChunkKeys = readyChunkKeys;
      this.requestShadowMapUpdate('chunk-ready-count-changed');
    }

    // 移除 _processPendingAORefreshQueue 调用：不再需要 AO 边界重算

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
    getChestManager().update(dt);
  }

  /**
   * 清理已加载 Chunk 中的重复 owner：
   * 当“坐标所属 Chunk”已加载并包含该方块时，移除其他 Chunk 的同坐标副本。
   * 目的：消除同坐标双重渲染导致的深度竞争（AO/明暗随视角闪烁）。
   */
  /**
   * 生成击中粒子效果 (转发至 ParticleSystem)
   * @param {THREE.Vector3} pos - 粒子生成位置
   * @param {string} type - 方块类型
   */
  spawnParticles(pos, type) {
    this.particles.spawnHitEffect(pos, type);
  }

  /**
   * 生成 TNT 爆炸效果 (转发至 ParticleSystem)
   * @param {THREE.Vector3} pos - 爆炸中心位置
   */
  spawnExplosionParticles(pos) {
    // 1. 触发 2D Billboard 爆炸
    this.particles.spawnExplosionEffect(pos);

    // 2. 触发球体扩张特效 (保留在 World 中，作为底层增强)
    const sphere = this.explosionSpheres.find(s => !s.active); // 从爆炸球体池中找到一个未激活的对象
    if (sphere) {
      sphere.active = true;           // 标记该爆炸球体为激活状态
      sphere.timer = 0;               // 重置计时器为0，开始新的生命周期
      sphere.maxLife = 0.3;           // 设置爆炸球体最大生存时间为0.3秒
      sphere.targetScale = 5.0;       // 设置爆炸球体最终扩张的目标尺寸为5.0
      sphere.mesh.position.copy(pos); // 将爆炸球体的位置设置为传入的位置参数
      sphere.mesh.visible = true;     // 显示爆炸球体网格
      sphere.mesh.scale.setScalar(0.1); // 将爆炸球体的初始缩放设为0.1（很小的初始尺寸）
      sphere.mesh.material.opacity = 1.0; // 设置爆炸球体的不透明度为完全不透明
    }
  }

  /**
   * 生成破坏方块粒子效果（徒手破坏专用，转发至 ParticleSystem）
   * @param {THREE.Vector3} pos - 粒子生成位置
   */
  spawnBlockCrashParticles(pos) {
    this.particles.spawnBlockCrashEffect(pos);
  }

  /**
   * 批量移除指定位置的方块（用于爆炸或大规模编辑）
   * @param {Array<{x:number, y:number, z:number}>} positions - 待移除方块的世界坐标列表
   * @param {boolean} isBatch - 是否启用批量模式（默认 true）。启用时，Face Culling 更新会被收集并延迟处理，
   *                           等待所有区块处理完成后统一调用 processPendingFaceCullingUpdates，
   *                           避免 Mag7、TNT 等批量删除场景中 AO 阴影计算丢失。
   */
  removeBlocksBatch(positions, isBatch = true) {
    // 将坐标按实际存储 blockData 的 Chunk 分组
    // 跨Chunk实体方块的 blockData 存储在结构中心所在的Chunk中
    const chunkGroups = new Map();
    // 同时收集方块坐标所在的Chunk，用于更新渲染网格
    const renderChunks = new Map();

    positions.forEach(p => {
      const px = Math.floor(p.x);
      const py = Math.floor(p.y);
      const pz = Math.floor(p.z);

      // 首先查找方块坐标所在的Chunk
      const cx = Math.floor(p.x / CHUNK_SIZE);
      const cz = Math.floor(p.z / CHUNK_SIZE);
      const coordKey = `${cx},${cz}`;

      // 记录方块坐标所在的Chunk（用于渲染更新）
      if (!renderChunks.has(coordKey)) renderChunks.set(coordKey, []);
      renderChunks.get(coordKey).push(p);

      // 与 removeBlock 语义保持一致：同坐标存在多个 owner 时，批量删除也要全部命中
      const owners = this.getAllBlockOwners(px, py, pz);
      owners.forEach((owner) => {
        const targetKey = owner.ownerChunkKey;
        if (!chunkGroups.has(targetKey)) chunkGroups.set(targetKey, []);
        chunkGroups.get(targetKey).push(p);
      });
    });

    // 针对每个区块执行批量删除优化（更新blockData）
    for (const [key, chunkPosList] of chunkGroups) {
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.removeBlocksBatch(chunkPosList, isBatch);
      }
    }

    // 跨Chunk实体方块渲染更新：
    // 对于方块坐标所在的Chunk，也需要更新渲染网格
    for (const [key, chunkPosList] of renderChunks) {
      // 跳过已经处理过的Chunk（blockData所在的Chunk已经在上面处理过）
      if (chunkGroups.has(key)) continue;

      const chunk = this.chunks.get(key);
      if (chunk && chunk.isReady) {
        // 只更新渲染网格，不更新blockData
        chunk.removeBlocksBatchRenderOnly(chunkPosList);
      }
    }

    // 批量模式：在所有区块处理完成后，统一触发待处理的 Face Culling 更新
    // 使用防抖定时器，确保连续多次调用时只在最后一次完成后处理
    if (isBatch) {
      if (this.batchFaceCullingTimeout) {
        clearTimeout(this.batchFaceCullingTimeout);
      }
      this.batchFaceCullingTimeout = setTimeout(() => {
        // 遍历所有区块，处理待更新的 Face Culling
        this.chunks.forEach(chunk => {
          if (chunk.processPendingFaceCullingUpdates) {
            chunk.processPendingFaceCullingUpdates();
          }
        });
        this.batchFaceCullingTimeout = null;
      }, 100); // 100ms 防抖，等待所有批次完成
    }

    // 批量删除会修改多个 chunk 的 blockData，统一清理查询缓存
    this.clearBlockLookupCaches();
    this.requestShadowMapUpdate('remove-blocks-batch');
  }

  /**
   * 解析指定坐标的方块“真实持有者”
   * 统一处理：坐标所属 Chunk、本地缓存命中、跨 Chunk 全量扫描
   *
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {{ allowScan?: boolean }} [options]
   * @returns {{
   *   ownerChunk: Chunk,
   *   ownerChunkKey: string,
   *   coordChunk: Chunk|null,
   *   coordChunkKey: string,
   *   blockKey: string,
   *   entry: string|object
   * }|null}
   */
  resolveBlockOwner(x, y, z, options = {}) {
    const allowScan = options.allowScan !== false;

    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const cx = Math.floor(ix / CHUNK_SIZE);
    const cz = Math.floor(iz / CHUNK_SIZE);
    const coordChunkKey = `${cx},${cz}`;
    const coordChunk = this.chunks.get(coordChunkKey) || null;
    const blockKey = `${ix},${iy},${iz}`;

    // 1) 坐标所属 Chunk 优先
    if (coordChunk) {
      const entry = coordChunk.blockData[blockKey];
      if (entry) {
        this.crossChunkOwnerCache.delete(blockKey);
        return {
          ownerChunk: coordChunk,
          ownerChunkKey: coordChunkKey,
          coordChunk,
          coordChunkKey,
          blockKey,
          entry
        };
      }
    }

    // 2) 跨 Chunk owner 缓存命中
    const ownerChunkKey = this.crossChunkOwnerCache.get(blockKey);
    if (ownerChunkKey) {
      const ownerChunk = this.chunks.get(ownerChunkKey);
      if (ownerChunk && ownerChunk.isReady) {
        const entry = ownerChunk.blockData[blockKey];
        if (entry) {
          return {
            ownerChunk,
            ownerChunkKey,
            coordChunk,
            coordChunkKey,
            blockKey,
            entry
          };
        }
      }
      // 缓存失效，清理后回退
      this.crossChunkOwnerCache.delete(blockKey);
    }

    // 3) 快速模式不扫描
    if (!allowScan) {
      return null;
    }

    // 4) 全量扫描已加载 Chunk
    for (const [otherKey, otherChunk] of this.chunks) {
      if (!otherChunk || !otherChunk.isReady || otherChunk === coordChunk) continue;
      const entry = otherChunk.blockData[blockKey];
      if (!entry) continue;
      this.crossChunkOwnerCache.set(blockKey, otherKey);
      return {
        ownerChunk: otherChunk,
        ownerChunkKey: otherKey,
        coordChunk,
        coordChunkKey,
        blockKey,
        entry
      };
    }

    return null;
  }

  /**
   * 获取指定坐标在所有已加载 Chunk 中的持有者列表（用于清理历史重复 owner）
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {Array<{
   *   ownerChunk: Chunk,
   *   ownerChunkKey: string,
   *   coordChunk: Chunk|null,
   *   coordChunkKey: string,
   *   blockKey: string,
   *   entry: string|object
   * }>}
   */
  getAllBlockOwners(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const cx = Math.floor(ix / CHUNK_SIZE);
    const cz = Math.floor(iz / CHUNK_SIZE);
    const coordChunkKey = `${cx},${cz}`;
    const coordChunk = this.chunks.get(coordChunkKey) || null;
    const blockKey = `${ix},${iy},${iz}`;
    const owners = [];

    if (coordChunk) {
      const entry = coordChunk.blockData[blockKey];
      if (entry) {
        owners.push({
          ownerChunk: coordChunk,
          ownerChunkKey: coordChunkKey,
          coordChunk,
          coordChunkKey,
          blockKey,
          entry
        });
      }
    }

    for (const [otherKey, otherChunk] of this.chunks) {
      if (!otherChunk || !otherChunk.isReady || otherKey === coordChunkKey) continue;
      const entry = otherChunk.blockData[blockKey];
      if (!entry) continue;
      owners.push({
        ownerChunk: otherChunk,
        ownerChunkKey: otherKey,
        coordChunk,
        coordChunkKey,
        blockKey,
        entry
      });
    }

    return owners;
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

    // --- 核心修复：主 Chunk 责任制 ---
    // 首先检查方块位置所在的 Chunk
    if (chunk.solidBlocks.has(blockKey)) {
      return true;
    }

    // 如果不在，查询所有已加载的 Chunk（跨 Chunk 结构的碰撞体可能在其他 Chunk 中）
    for (const [, otherChunk] of this.chunks) {
      if (otherChunk.isReady && otherChunk !== chunk && otherChunk.solidBlocks.has(blockKey)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取指定世界坐标的方块类型名称
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {string|null} 方块类型（如 'stone'），如果区块未加载则返回 null
   */
  getBlock(x, y, z) {
    const owner = this.resolveBlockOwner(x, y, z, { allowScan: true });
    return owner ? this.getBlockTypeFromEntry(owner.entry) : null;
  }

  /**
   * 指定坐标所属 Chunk 是否已加载且完成初始化
   * @param {number} x - 世界坐标 X
   * @param {number} z - 世界坐标 Z
   * @returns {boolean}
   */
  isChunkLoadedAt(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);
    return !!(chunk && chunk.isReady);
  }

  /**
   * 获取指定世界坐标的方块类型（快速路径）
   * 仅查询：坐标所属 Chunk + crossChunkOwnerCache
   * 不执行全量 Chunk 扫描，适用于高频实时判定（如 AI / LOS / 弹道碰撞）
   *
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {string|null} 方块类型，未命中则返回 null
   */
  getBlockFast(x, y, z) {
    const owner = this.resolveBlockOwner(x, y, z, { allowScan: false });
    return owner ? this.getBlockTypeFromEntry(owner.entry) : null;
  }

  /**
   * 获取指定世界坐标的方块完整信息（包含朝向）
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @returns {{ type: string, orientation: number }|null} 方块信息，如果区块未加载则返回 null
   */
  getBlockEntry(x, y, z) {
    const owner = this.resolveBlockOwner(x, y, z, { allowScan: true });
    return owner ? parseBlockEntry(owner.entry) : null;
  }

  /**
   * 在世界中放置一个新的方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {string|object} typeOrEntry - 方块类型名称或完整条目对象 { type, orientation }
   * @param {number} [orientation=0] - 朝向 (0-3)，当 typeOrEntry 为字符串时使用
   */
  setBlock(x, y, z, typeOrEntry, orientation = 0) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    let chunk = this.chunks.get(key);

    if (!chunk) {
      // 只能在已加载的区块中放置方块，否则忽略
      return;
    }

    // 逻辑委托：调用区块的动态添加方法，处理网格生成和邻居面更新
    chunk.addBlockDynamic(x, y, z, typeOrEntry, orientation);
    this.clearBlockLookupCaches();
    this.requestShadowMapUpdate('set-block');
  }

  /**
   * 批量放置方块（导入专用）
   * 按 Chunk 分组后走快速写入路径，避免逐块触发高成本动态更新
   * @param {Array<{x:number,y:number,z:number,type:string,orientation?:number}>} blocks
   * @param {{ deferConsolidation?: boolean, replaceExisting?: boolean }} [options]
   * @returns {{ placed: number, skipped: number, touchedChunks: Set<string> }}
   */
  setBlocksBatch(blocks, options = {}) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return { placed: 0, skipped: 0, touchedChunks: new Set() };
    }

    const deferConsolidation = options.deferConsolidation === true;
    const replaceExisting = options.replaceExisting === true;
    const chunkGroups = new Map();

    for (const block of blocks) {
      const cx = Math.floor(block.x / CHUNK_SIZE);
      const cz = Math.floor(block.z / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      if (!chunkGroups.has(key)) chunkGroups.set(key, []);
      chunkGroups.get(key).push(block);
    }

    let placed = 0;
    let skipped = 0;
    const touchedChunks = new Set();

    for (const [chunkKey, list] of chunkGroups.entries()) {
      const chunk = this.chunks.get(chunkKey);
      if (!chunk || !chunk.isReady || typeof chunk.addBlocksBatchFast !== 'function') {
        skipped += list.length;
        continue;
      }

      const result = chunk.addBlocksBatchFast(list, { deferConsolidation, replaceExisting });
      placed += result.placed;
      skipped += result.skipped;
      if (result.placed > 0) {
        touchedChunks.add(chunkKey);
      }
    }

    this.clearBlockLookupCaches();
    if (placed > 0) {
      this.requestShadowMapUpdate('set-blocks-batch');
    }
    return { placed, skipped, touchedChunks };
  }

  /**
   * 对指定 Chunk 统一调度合并
   * @param {Iterable<string>} chunkKeys - Chunk 键列表（格式：cx,cz）
   */
  scheduleConsolidationForChunks(chunkKeys) {
    if (!chunkKeys) return;
    for (const key of chunkKeys) {
      const chunk = this.chunks.get(key);
      if (!chunk || !chunk.isReady || chunk.dirtyBlocks <= 0) continue;
      chunk.scheduleConsolidation();
    }
  }

  /**
   * 移除指定世界坐标的方块
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   */
  removeBlock(x, y, z) {
    // 防御式处理：移除该坐标在所有 Chunk 的重复 owner，避免历史脏数据导致一键只删一层
    const owners = this.getAllBlockOwners(x, y, z);
    if (owners.length === 0) return;
    owners.forEach(owner => owner.ownerChunk.removeBlock(x, y, z));
    this.clearBlockLookupCaches();
    this.requestShadowMapUpdate('remove-block');
  }

  /**
   * 移除特定坐标的碰撞键（仅影响物理，不改变渲染，用于特定实体逻辑）
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   */
  removeBlockCollider(x, y, z) {
    const owners = this.getAllBlockOwners(x, y, z);
    if (owners.length === 0) return;
    owners.forEach(owner => owner.ownerChunk.removeCollisionKey(x, y, z));
    this.clearBlockLookupCaches();
  }

  /**
   * 从 blockData 条目中提取方块类型（兼容字符串/对象）
   * @param {string|object} entry - 方块条目
   * @returns {string}
   */
  getBlockTypeFromEntry(entry) {
    if (typeof entry === 'string') return entry;
    return parseBlockEntry(entry).type;
  }

  /**
   * 清空 getBlock 相关缓存
   */
  clearBlockLookupCaches() {
    this.crossChunkOwnerCache.clear();
  }
}
