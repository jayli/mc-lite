// src/world/WorldGenerationService.js
/**
 * WorldGenerationService — 世界预生成与后台扩图服务
 *
 * 职责：
 * - 新档初始大地图阻塞预生成
 * - 接近边界时后台扩图
 * - 使用 region 级生成缓冲区处理跨 chunk 结构
 * - 把结果写入 WorldStore
 *
 * 设计：
 * - 预生成阶段：批量调用 WorldWorker 生成每个 chunk，收集结果，按 region 写入 WorldStore
 * - 扩图阶段：后台生成相邻 region，完成后更新边界
 * - 使用 region (8x8 chunk) 作为生成和存储的基本单元
 */
import { worldStore } from './WorldStore.js';
// worldWorkerPool 预留，供未来批量生成优化使用
// import { worldWorkerPool } from '../workers/WorldWorkerPool.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { worldWorker, workerCallbacks } from './ChunkConsolidation.js';
import { encodeCoord } from '../utils/CoordEncoding.js';

// --- 常量 ---
const REGION_SIZE_IN_CHUNKS = 8;
const DEFAULT_INITIAL_REGION_RADIUS = 3; // 初始生成 7x7 region = 56x56 chunk
const CHUNK_SIZE = 16;
const REGION_GENERATION_HALO_IN_CHUNKS = 1;

// --- 依赖注入 ---
const getWorldStore = () => globalThis._worldStore || worldStore;
const getWorldWorker = () => globalThis._worldWorker || worldWorker;

export class WorldGenerationService {
  constructor(options = {}) {
    this._seed = options.seed || WORLD_CONFIG.SEED;
    this._regionSizeInChunks = REGION_SIZE_IN_CHUNKS;
    this._initialRegionRadius = options.initialRegionRadius || DEFAULT_INITIAL_REGION_RADIUS;
    this._world = null;
    this._isGenerating = false;
    this._onProgress = options.onProgress || null;
  }

  setWorld(world) {
    this._world = world;
  }

  /**
   * 计算 region 坐标
   */
  _chunkToRegion(cx, cz) {
    const rx = Math.floor(cx / this._regionSizeInChunks);
    const rz = Math.floor(cz / this._regionSizeInChunks);
    return { rx, rz };
  }

  _regionKey(rx, rz) {
    return `${rx},${rz}`;
  }

  _chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _isChunkInRegion(cx, cz, rx, rz) {
    const startCx = rx * this._regionSizeInChunks;
    const startCz = rz * this._regionSizeInChunks;
    return (
      cx >= startCx &&
      cx < startCx + this._regionSizeInChunks &&
      cz >= startCz &&
      cz < startCz + this._regionSizeInChunks
    );
  }

  // ============================================================
  // 新档初始预生成
  // ============================================================

  /**
   * 阻塞预生成初始世界
   *
   * 流程：
   * 1. 检查是否已有 WorldMeta（旧档）
   * 2. 新档：初始化 WorldMeta
   * 3. 批量生成 region（围绕出生点）
   * 4. 写入 WorldStore
   * 5. 更新 bounds
   *
   * @param {object} options
   * @param {number} options.spawnX - 出生点 X
   * @param {number} options.spawnZ - 出生点 Z
   * @param {number} options.regionRadius - 初始 region 半径（默认 3）
   * @param {Function} options.onProgress - 进度回调 (current, total)
   * @param {boolean} options.forceReset - 是否清除已有世界数据重新生成（默认 false）
   * @returns {Promise<object>} WorldMeta
   */
  async generateInitialWorld(options = {}) {
    if (this._isGenerating) {
      throw new Error('World generation already in progress');
    }

    this._isGenerating = true;
    const {
      spawnX = 0,
      spawnZ = 0,
      regionRadius = this._initialRegionRadius,
      onProgress = this._onProgress,
      forceReset = false
    } = options;

    try {
      // 1. 清除旧数据（如果开启强制重置）
      if (forceReset) {
        console.log('[WorldGenerationService] Force reset: clearing existing world data');
        await getWorldStore().clearWorld();
      }

      // 2. 检查是否已有世界数据
      const existingMeta = await getWorldStore().getWorldMeta();
      if (!forceReset && existingMeta && existingMeta.generationState === 'done') {
        console.log('[WorldGenerationService] Existing world found, skipping pre-generation');
        return existingMeta;
      }

      console.log(`[WorldGenerationService] Starting pre-generation: radius=${regionRadius} regions around spawn(${spawnX}, ${spawnZ})`);

      // 2. 初始化 WorldMeta
      const spawnChunkX = Math.floor(spawnX / CHUNK_SIZE);
      const spawnChunkZ = Math.floor(spawnZ / CHUNK_SIZE);
      const { rx: spawnRx, rz: spawnRz } = this._chunkToRegion(spawnChunkX, spawnChunkZ);

      const minRx = spawnRx - regionRadius;
      const maxRx = spawnRx + regionRadius;
      const minRz = spawnRz - regionRadius;
      const maxRz = spawnRz + regionRadius;

      const meta = {
        schemaVersion: 1,
        worldId: `world_${Date.now()}`,
        seed: this._seed,
        chunkSize: CHUNK_SIZE,
        regionSizeInChunks: this._regionSizeInChunks,
        generatedBounds: {
          minX: minRx * this._regionSizeInChunks * CHUNK_SIZE,
          minZ: minRz * this._regionSizeInChunks * CHUNK_SIZE,
          maxX: (maxRx + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1,
          maxZ: (maxRz + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1
        },
        safeBounds: {
          minX: minRx * this._regionSizeInChunks * CHUNK_SIZE,
          minZ: minRz * this._regionSizeInChunks * CHUNK_SIZE,
          maxX: (maxRx + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1,
          maxZ: (maxRz + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1
        },
        expandTargetBounds: {
          minX: minRx * this._regionSizeInChunks * CHUNK_SIZE,
          minZ: minRz * this._regionSizeInChunks * CHUNK_SIZE,
          maxX: (maxRx + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1,
          maxZ: (maxRz + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1
        },
        generationState: 'generating',
        generatorVersion: '1.0',
        playerSpawn: {
          x: spawnX,
          y: this._estimateSpawnY(spawnX, spawnZ),
          z: spawnZ
        }
      };

      await getWorldStore().saveWorldMeta(meta);

      // 3. 批量生成 region
      const totalRegions = (maxRx - minRx + 1) * (maxRz - minRz + 1);
      let completedRegions = 0;

      for (let rx = minRx; rx <= maxRx; rx++) {
        for (let rz = minRz; rz <= maxRz; rz++) {
          await this._generateRegion(rx, rz);
          completedRegions++;
          if (onProgress) {
            onProgress(completedRegions, totalRegions);
          }
          console.log(`[WorldGenerationService] Region ${rx},${rz} done (${completedRegions}/${totalRegions})`);
        }
      }

      // 4. 更新状态
      meta.generationState = 'done';
      await getWorldStore().saveWorldMeta(meta);

      console.log(`[WorldGenerationService] Pre-generation complete: ${totalRegions} regions`);
      return meta;
    } finally {
      this._isGenerating = false;
    }
  }

  // ============================================================
  // Region 级生成
  // ============================================================

  /**
   * 生成单个 region（8x8 chunk）
   *
   * 策略：逐个 chunk 调用 WorldWorker 生成，收集所有 chunk 结果，
   * 合并为 RegionRecord 写入 WorldStore。
   *
   * 注意：跨 chunk 结构（如城市建筑）由 CityMap 的确定性布局保证一致性。
   *
   * @param {number} rx
   * @param {number} rz
   */
  async _generateRegion(rx, rz) {
    const regionKey = this._regionKey(rx, rz);
    const chunks = {};
    const chunkKeys = [];
    const startCx = rx * this._regionSizeInChunks;
    const startCz = rz * this._regionSizeInChunks;
    const endCx = startCx + this._regionSizeInChunks - 1;
    const endCz = startCz + this._regionSizeInChunks - 1;

    // 收集所有 chunk 的完整 routing 结果（含 halo 与 overflow）
    const chunkResults = {};

    // 使用 1 chunk halo 生成邻接来源，保证跨 region 的相邻 owner
    // 能在目标 chunk 已存在时直接落到正确的 target result 中。
    for (let cx = startCx - REGION_GENERATION_HALO_IN_CHUNKS; cx <= endCx + REGION_GENERATION_HALO_IN_CHUNKS; cx++) {
      for (let cz = startCz - REGION_GENERATION_HALO_IN_CHUNKS; cz <= endCz + REGION_GENERATION_HALO_IN_CHUNKS; cz++) {
        const chunkKey = this._chunkKey(cx, cz);

        const chunkResult = await this._generateChunkWithRouting(cx, cz);
        if (chunkResult) {
          chunkResults[chunkKey] = chunkResult;
        }
      }
    }

    // 合并 overflow 方块：Worker 生成的方块可能落在相邻 chunk，
    // 需要按坐标归属分发到正确的 chunk 中
    this._mergeOverflowBlocks(chunkResults);

    // 构建 RegionRecord：只持久化核心 region 的 owner chunk。
    for (const [chunkKey, result] of Object.entries(chunkResults)) {
      const [cx, cz] = chunkKey.split(',').map(Number);
      if (!this._isChunkInRegion(cx, cz, rx, rz)) continue;

      chunkKeys.push(chunkKey);
      chunks[chunkKey] = {
        blockData: result.blockData,
        staticEntities: result.staticEntities,
        runtimeSeedData: result.runtimeSeedData
      };
    }

    // 构建 RegionRecord
    const regionRecord = {
      regionKey,
      rx,
      rz,
      chunkKeys,
      chunks,
      generatedAt: Date.now(),
      generatorVersion: '1.0'
    };

    // 写入 WorldStore
    await getWorldStore().saveRegionRecord(rx, rz, regionRecord);

    return regionRecord;
  }

  /**
   * 生成单个 chunk（返回完整 routing 信息，含 overflow 方块）
   *
   * 使用 WorldWorker 的现有生成管线，收集完整结果用于后续 overflow 合并。
   *
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<object|null>} { blockData, staticEntities, runtimeSeedData, routing }
   */
  _generateChunkWithRouting(cx, cz) {
    return new Promise((resolve) => {
      const taskId = `pregen:${cx},${cz}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

      workerCallbacks.set(taskId, (data) => {
        const blockData = this._buildBlockDataFromResult(data);
        const staticEntities = this._buildStaticEntities(data);
        const runtimeSeedData = {
          structureCenters: data.structureCenters || []
        };

        resolve({
          blockData,
          staticEntities,
          runtimeSeedData,
          routing: data.routing || null
        });
      });

      getWorldWorker().postMessage({
        cx,
        cz,
        taskId,
        seed: this._seed,
        snapshot: null,
        structureCenters: undefined,
        skipTerrainGeneration: false
      });
    });
  }

  /**
   * 合并 overflow 方块到正确的 chunk
   *
   * Worker 生成的方块可能落在相邻 chunk 范围内，通过 routing.overflowChunks
   * 返回。需要按坐标归属分发到正确的 chunk 的 blockData 中。
   *
   * @param {Object} chunkResults - { chunkKey: { blockData, routing, ... } }
   */
  _mergeOverflowBlocks(chunkResults) {
    let unresolvedOverflowCount = 0;

    for (const [_sourceKey, result] of Object.entries(chunkResults)) {
      if (!result.routing?.overflowChunks) continue;

      for (const overflowEntry of result.routing.overflowChunks) {
        const targetKey = overflowEntry.chunkKey;
        if (!targetKey) continue;

        const targetResult = chunkResults[targetKey];
        const blocks = Array.isArray(overflowEntry.blockDataBlocks) ? overflowEntry.blockDataBlocks : [];
        if (blocks.length === 0) continue;

        if (targetResult) {
          // 目标 chunk 已在当前批次结果中，正常分发到唯一 owner。
          for (const block of blocks) {
            const targetCx = Math.floor(block.x / CHUNK_SIZE);
            const targetCz = Math.floor(block.z / CHUNK_SIZE);
            const expectedKey = this._chunkKey(targetCx, targetCz);
            if (expectedKey !== targetKey) continue;

            const code = encodeCoord(block.x, block.y, block.z);
            if (targetResult.blockData[code] !== undefined) continue;

            targetResult.blockData[code] = block.orientation
              ? { type: block.type, orientation: block.orientation }
              : block.type;
          }
        } else {
          unresolvedOverflowCount += blocks.length;
        }
      }
    }

    if (unresolvedOverflowCount > 0) {
      console.warn(`[WorldGenerationService] Overflow blocks unresolved after halo routing: ${unresolvedOverflowCount}`);
    }
  }

  /**
   * 从 Worker 结果构建 blockData
   */
  _buildBlockDataFromResult(result) {
    const blockData = {};

    // 从 routing 或 blockDataBlocks 中提取
    const blocks = result.routing?.ownChunk?.blockDataBlocks || result.blockDataBlocks || [];
    for (const block of blocks) {
      const code = encodeCoord(block.x, block.y, block.z);
      const entry = block.orientation ? { type: block.type, orientation: block.orientation } : block.type;
      blockData[code] = entry;
    }

    return blockData;
  }

  /**
   * 构建静态实体数据
   */
  _buildStaticEntities(result) {
    const entities = [];

    // 提取特殊实体
    if (result.entities?.modGunMan?.length > 0) {
      entities.push({
        type: 'modGunMan',
        positions: result.entities.modGunMan
      });
    }
    if (result.entities?.rovers?.length > 0) {
      entities.push({
        type: 'rovers',
        positions: result.entities.rovers
      });
    }

    return entities;
  }

  /**
   * 估算出生点 Y 坐标
   */
  _estimateSpawnY(x, z) {
    // 简单估算：使用 terrainGen 如果可用
    const { terrainGen } = globalThis;
    if (terrainGen && terrainGen.generateHeight) {
      const biome = terrainGen.getBiome(x, z);
      return Math.floor(terrainGen.generateHeight(x, z, biome));
    }
    return 10; // 默认值
  }

  // ============================================================
  // 后台扩图
  // ============================================================

  /**
   * 检查并执行扩图
   *
   * 当玩家接近 safeBounds 边缘时触发。
   * 生成相邻 region 并更新边界。
   *
   * @param {object} options
   * @param {number} options.playerX
   * @param {number} options.playerZ
   * @param {number} options.expandRegions - 每次扩展的 region 数量（默认 1 层）
   * @returns {Promise<boolean>} 是否执行了扩图
   */
  async expandWorldIfNeeded(options = {}) {
    if (this._isGenerating) return false;
    if (!this._world?.worldBoundsController) return false;

    const { playerX, playerZ, expandRegions = 1 } = options;

    // 检查是否需要扩图
    if (!this._world.worldBoundsController.isNearExpansionEdge(playerX, playerZ)) {
      return false;
    }

    // 确定扩图方向
    const directions = this._world.worldBoundsController.getExpansionDirections(playerX, playerZ);
    if (directions.length === 0) return false;

    // 检查是否已经在扩图中
    if (this._world.worldBoundsController.isExpanding) return false;

    // 获取当前 WorldMeta
    const meta = await getWorldStore().getWorldMeta();
    if (!meta) return false;

    this._isGenerating = true;

    try {

      const { rx: _currentRx, rz: _currentRz } = this._chunkToRegion(
        Math.floor(playerX / CHUNK_SIZE),
        Math.floor(playerZ / CHUNK_SIZE)
      );

      const { rx: _spawnRx, rz: _spawnRz } = this._chunkToRegion(
        Math.floor(meta.playerSpawn.x / CHUNK_SIZE),
        Math.floor(meta.playerSpawn.z / CHUNK_SIZE)
      );

      // 计算当前已生成的 region 边界
      const bounds = this._world.worldBoundsController.getGeneratedBounds();
      const currentMinRx = Math.floor(bounds.minX / (this._regionSizeInChunks * CHUNK_SIZE));
      const currentMaxRx = Math.floor(bounds.maxX / (this._regionSizeInChunks * CHUNK_SIZE));
      const currentMinRz = Math.floor(bounds.minZ / (this._regionSizeInChunks * CHUNK_SIZE));
      const currentMaxRz = Math.floor(bounds.maxZ / (this._regionSizeInChunks * CHUNK_SIZE));

      // 生成需要扩展的 region
      const regionsToGenerate = [];

      if (directions.includes('west')) {
        for (let rz = currentMinRz; rz <= currentMaxRz; rz++) {
          for (let i = 0; i < expandRegions; i++) {
            regionsToGenerate.push({ rx: currentMinRx - 1 - i, rz });
          }
        }
      }
      if (directions.includes('east')) {
        for (let rz = currentMinRz; rz <= currentMaxRz; rz++) {
          for (let i = 0; i < expandRegions; i++) {
            regionsToGenerate.push({ rx: currentMaxRx + 1 + i, rz });
          }
        }
      }
      if (directions.includes('north')) {
        for (let rx = currentMinRx; rx <= currentMaxRx; rx++) {
          for (let i = 0; i < expandRegions; i++) {
            regionsToGenerate.push({ rx, rz: currentMinRz - 1 - i });
          }
        }
      }
      if (directions.includes('south')) {
        for (let rx = currentMinRx; rx <= currentMaxRx; rx++) {
          for (let i = 0; i < expandRegions; i++) {
            regionsToGenerate.push({ rx, rz: currentMaxRz + 1 + i });
          }
        }
      }

      // 执行生成
      let completed = 0;
      for (const { rx, rz } of regionsToGenerate) {
        await this._generateRegion(rx, rz);
        completed++;
      }

      // 更新边界
      const newBounds = {
        minX: (currentMinRx - (directions.includes('west') ? expandRegions : 0)) * this._regionSizeInChunks * CHUNK_SIZE,
        minZ: (currentMinRz - (directions.includes('north') ? expandRegions : 0)) * this._regionSizeInChunks * CHUNK_SIZE,
        maxX: (currentMaxRx + (directions.includes('east') ? expandRegions : 0) + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1,
        maxZ: (currentMaxRz + (directions.includes('south') ? expandRegions : 0) + 1) * this._regionSizeInChunks * CHUNK_SIZE - 1
      };

      console.log(`[WorldGenerationService] Starting world expansion: ${directions.join(', ')}`);
      this._world.worldBoundsController.startExpansion(directions, newBounds);
      meta.expandTargetBounds = { ...newBounds };
      await getWorldStore().saveWorldMeta(meta);

      this._world.worldBoundsController.finishExpansion(newBounds);
      meta.generatedBounds = { ...newBounds };
      meta.safeBounds = { ...newBounds };
      meta.expandTargetBounds = { ...newBounds };
      await getWorldStore().saveWorldMeta(meta);
      this._world.applyWorldMeta?.(meta);
      this._world.onExpansionFinished?.(newBounds);

      console.log(`[WorldGenerationService] World expansion complete: ${completed} regions`);
      return true;
    } finally {
      this._isGenerating = false;
    }
  }

  /**
   * 获取生成状态
   */
  get isGenerating() {
    return this._isGenerating;
  }
}
