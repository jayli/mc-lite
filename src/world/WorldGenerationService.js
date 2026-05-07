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
// MemoryWorldStore 通过 this._world.memoryWorldStore 访问，不直接导入
// worldWorkerPool 预留，供未来批量生成优化使用
// import { worldWorkerPool } from '../workers/WorldWorkerPool.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { worldWorker, workerCallbacks } from './ChunkConsolidation.js';
import { encodeCoord } from '../utils/CoordEncoding.js';

// --- 常量 ---
const REGION_SIZE_IN_CHUNKS = 8;
const DEFAULT_INITIAL_REGION_RADIUS = 3; // 初始生成 7x7 region = 56x56 chunk
const CHUNK_SIZE = 16;
const _REGION_GENERATION_HALO_IN_CHUNKS = 1; // 预生成不再使用，保留供向后兼容

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
    this._crossRegionOverflowMap = new Map(); // 暂存跨 region overflow
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

  /**
   * 在密集循环中定期让出主线程，避免阻塞渲染。
   * 每处理 batchSize 个元素后 setTimeout(0) yield 一次。
   */
  async _yieldIfNeeded(count, batchSize = 5000) {
    if (count > 0 && count % batchSize === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
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
          try {
            await this._generateRegion(rx, rz);
            completedRegions++;
            if (onProgress) {
              onProgress(completedRegions, totalRegions);
            }
            console.log(`[WorldGenerationService] Region ${rx},${rz} done (${completedRegions}/${totalRegions})`);
          } catch (err) {
            console.error(`[WorldGenerationService] Region ${rx},${rz} generation failed:`, err);
            // 继续生成其他 region，不中断整个预生成流程
          }
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

  /**
   * 收集 Worker 返回的跨 region overflow blocks
   * @param {object} data - Worker 返回的 regionGenerated 数据
   */
  async _collectCrossRegionOverflow(data) {
    const overflowBlocks = data.routingDiagnostics?.unresolvedOverflowBlocks || [];
    let processed = 0;
    for (const entry of overflowBlocks) {
      const [targetCx, targetCz] = entry.chunkKey.split(',').map(Number);
      const { rx: targetRx, rz: targetRz } = this._chunkToRegion(targetCx, targetCz);
      const targetRegionKey = this._regionKey(targetRx, targetRz);

      if (!this._crossRegionOverflowMap.has(targetRegionKey)) {
        this._crossRegionOverflowMap.set(targetRegionKey, []);
      }
      this._crossRegionOverflowMap.get(targetRegionKey).push(entry);
      processed++;
      await this._yieldIfNeeded(processed, 5000);
    }
  }

  /**
   * 分发跨 region overflow blocks 到目标 region。
   * 目标 region 已在当前批次中的直接合并到 RegionRecord；
   * 不在当前批次中的持久化到 world_overflow store。
   *
   * @param {Array<string>} targetRegionKeys - 当前批次已生成的 region keys
   */
  async _distributeCrossRegionOverflow(targetRegionKeys) {
    const targetKeySet = new Set(targetRegionKeys);

    let mergeProcessed = 0;
    for (const [regionKey, entries] of this._crossRegionOverflowMap) {
      if (targetKeySet.has(regionKey)) {
        const [rx, rz] = regionKey.split(',').map(Number);
        const record = await getWorldStore().getRegionRecord(rx, rz);
        if (!record) continue;

        for (const entry of entries) {
          const chunkData = record.chunks[entry.chunkKey];
          if (!chunkData) continue;
          for (const block of entry.blockDataBlocks) {
            const code = encodeCoord(block.x, block.y, block.z);
            if (chunkData.blockData[code] === undefined) {
              chunkData.blockData[code] = block.orientation
                ? { type: block.type, orientation: block.orientation }
                : block.type;
            }
            mergeProcessed++;
            await this._yieldIfNeeded(mergeProcessed, 5000);
          }
        }

        await getWorldStore().saveRegionRecord(rx, rz, record);
        this._crossRegionOverflowMap.delete(regionKey);
      }
    }
  }

  // ============================================================
  // Region 级生成
  // ============================================================

  /**
   * 生成单个 region（8x8 chunk）
   *
   * 策略：一次 worker 调用完成整个 region 的生成，
   * worker 内部共享候选索引和去重集合，完成 overflow routing。
   *
   * @param {number} rx
   * @param {number} rz
   */
  async _generateRegion(rx, rz) {
    const regionKey = this._regionKey(rx, rz);

    return new Promise((resolve, reject) => {
      const taskId = `pregen-region:${rx},${rz}:${Date.now()}`;

      workerCallbacks.set(taskId, async (data) => {
        // 构建 RegionRecord：直接使用 worker 返回的 chunks
        const chunks = {};
        const chunkKeys = [];

        for (const [chunkKey, result] of Object.entries(data.chunks)) {
          const [cx, cz] = chunkKey.split(',').map(Number);
          if (!this._isChunkInRegion(cx, cz, rx, rz)) continue;

          chunkKeys.push(chunkKey);
          chunks[chunkKey] = {
            blockData: this._buildBlockDataFromRouting(result),
            staticEntities: this._buildStaticEntitiesFromResult(result),
            runtimeSeedData: {
              structureCenters: result.structureCenters || []
            }
          };
        }

        const regionRecord = {
          regionKey,
          rx,
          rz,
          chunkKeys,
          chunks,
          generatedAt: Date.now(),
          generatorVersion: '1.0',
          routingDiagnostics: data.routingDiagnostics
        };

        // 合并之前保留的跨 region overflow blocks（扩图时消费）
        const pendingOverflow = this._crossRegionOverflowMap.get(regionKey);
        if (pendingOverflow) {
          for (const entry of pendingOverflow) {
            const chunkData = regionRecord.chunks[entry.chunkKey];
            if (!chunkData) continue;
            for (const block of entry.blockDataBlocks) {
              const code = encodeCoord(block.x, block.y, block.z);
              if (chunkData.blockData[code] === undefined) {
                chunkData.blockData[code] = block.orientation
                  ? { type: block.type, orientation: block.orientation }
                  : block.type;
              }
            }
          }
          this._crossRegionOverflowMap.delete(regionKey);
        }

        try {
          await getWorldStore().saveRegionRecord(rx, rz, regionRecord);
        } catch (err) {
          console.error('[WorldGenerationService] Failed to save region record:', err);
          reject(err);
          return;
        }

        // 直写到内存权威层（运行期主路径）
        if (this._world?.memoryWorldStore) {
          this._writeRegionToMemoryStore(rx, rz, regionRecord);
        }

        // 收集跨 region overflow blocks
        await this._collectCrossRegionOverflow(data);

        if (data.routingDiagnostics?.unresolved > 0) {
          console.warn('[WorldGenerationService] Region generation had unresolved overflow blocks', {
            regionKey,
            ...data.routingDiagnostics
          });
        }

        resolve(regionRecord);
      });

      getWorldWorker().postMessage({
        type: 'generateRegion',
        rx,
        rz,
        taskId,
        seed: this._seed
      });
    });
  }

  /**
   * 将 region 中的每个 chunk 直写到内存权威层
   */
  _writeRegionToMemoryStore(rx, rz, regionRecord) {
    const memoryStore = this._world.memoryWorldStore;
    if (!memoryStore) return;

    for (const [chunkKey, chunkData] of Object.entries(regionRecord.chunks)) {
      const [cx, cz] = chunkKey.split(',').map(Number);
      memoryStore.createOrReplaceChunkRecord(cx, cz, {
        blockData: chunkData.blockData || {},
        staticEntities: chunkData.staticEntities || [],
        runtimeSeedData: chunkData.runtimeSeedData || {},
        runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] },
        generatorVersion: regionRecord.generatorVersion
      });
    }
  }

  /**
   * 从 chunk 结果中提取 blockData（优先使用 blockDataBlocks）。
   */
  _buildBlockDataFromRouting(result) {
    const blockData = {};
    const blocks = result.blockDataBlocks || [];
    for (const block of blocks) {
      const code = encodeCoord(block.x, block.y, block.z);
      const entry = block.orientation
        ? { type: block.type, orientation: block.orientation }
        : block.type;
      blockData[code] = entry;
    }
    return blockData;
  }

  /**
   * 从 chunk 结果构建静态实体数据。
   */
  _buildStaticEntitiesFromResult(result) {
    const entities = [];
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
  _mergeOverflowBlocks(chunkResults, context = {}) {
    const diagnostics = {
      resolved: {
        rawBlocks: 0
      },
      unresolved: {
        rawBlocks: 0,
        uniqueCoords: 0,
        topTargetChunks: [],
        topSourceChunks: [],
        topDistanceBuckets: []
      }
    };
    const unresolvedCoordSet = new Set();
    const unresolvedTargetChunkCounts = new Map();
    const unresolvedSourceChunkCounts = new Map();
    const unresolvedDistanceCounts = new Map();

    for (const [sourceKey, result] of Object.entries(chunkResults)) {
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
            diagnostics.resolved.rawBlocks++;
          }
        } else {
          diagnostics.unresolved.rawBlocks += blocks.length;
          unresolvedTargetChunkCounts.set(targetKey, (unresolvedTargetChunkCounts.get(targetKey) || 0) + blocks.length);
          unresolvedSourceChunkCounts.set(sourceKey, (unresolvedSourceChunkCounts.get(sourceKey) || 0) + blocks.length);

          const [sourceCx, sourceCz] = sourceKey.split(',').map(Number);
          const [targetCx, targetCz] = targetKey.split(',').map(Number);
          const offsetKey = `${targetCx - sourceCx},${targetCz - sourceCz}`;
          unresolvedDistanceCounts.set(offsetKey, (unresolvedDistanceCounts.get(offsetKey) || 0) + blocks.length);

          for (const block of blocks) {
            unresolvedCoordSet.add(encodeCoord(block.x, block.y, block.z));
          }
        }
      }
    }

    diagnostics.unresolved.uniqueCoords = unresolvedCoordSet.size;
    diagnostics.unresolved.topTargetChunks = this._toSortedCountArray(unresolvedTargetChunkCounts, 'chunkKey');
    diagnostics.unresolved.topSourceChunks = this._toSortedCountArray(unresolvedSourceChunkCounts, 'chunkKey');
    diagnostics.unresolved.topDistanceBuckets = this._toSortedCountArray(unresolvedDistanceCounts, 'offset');

    if (diagnostics.unresolved.rawBlocks > 0) {
      console.warn('[WorldGenerationService] Overflow blocks unresolved after halo routing', {
        regionKey: context.regionKey || null,
        ...diagnostics.unresolved
      });
    }

    return diagnostics;
  }

  _toSortedCountArray(counts, keyName, limit = 5) {
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, blocks]) => ({ [keyName]: key, blocks }));
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
        try {
          await this._generateRegion(rx, rz);
          completed++;
        } catch (err) {
          console.error(`[WorldGenerationService] Expansion region ${rx},${rz} generation failed:`, err);
          // 继续生成其他 region，不中断扩图流程
        }
      }

      // 分发新生成 region 之间的 overflow
      const newRegionKeys = regionsToGenerate.map(({ rx, rz }) => this._regionKey(rx, rz));
      await this._distributeCrossRegionOverflow(newRegionKeys);

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
