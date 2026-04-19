// src/services/PlaygroundService.js
/**
 * PlaygroundService - 创造台服务
 * 负责创建、管理创造台平台和导入/导出模型数据
 */

import { persistenceService } from './PersistenceService.js';
import { getBlockProperties } from '../constants/BlockData.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { worldWorker, workerCallbacks } from '../world/ChunkConsolidation.js';
import { Chunk } from '../world/Chunk.js';

/**
 * 创造台服务类 - 单例模式
 */
export class PlaygroundService {
  constructor() {
    if (PlaygroundService.instance) {
      return PlaygroundService.instance;
    }

    this.world = null;
    this._isPlaygroundActive = false;
    this.playgroundOrigin = null; // 创造台中心坐标
    this.playgroundSize = 54;     // 54x54 平台（在原 40x40 基础上每边扩 7 格）
    this.playgroundBlocks = new Set(); // 存储创造台上所有方块的 key
  }

  /**
   * 获取服务实例（单例）
   * @returns {PlaygroundService}
   */
  static getInstance() {
    if (!PlaygroundService.instance) {
      PlaygroundService.instance = new PlaygroundService();
    }
    return PlaygroundService.instance;
  }

  /**
   * 初始化服务
   * @param {World} world - 游戏世界实例
   */
  initialize(world) {
    this.world = world;
    // 初始化时检测世界中是否已存在创造台
    this.detectExistingPlayground();
  }

  /**
   * 检测世界中是否已存在创造台
   * 遍历已加载的区块查找 playground_center_block 或 playground_block
   * @returns {boolean} 是否存在创造台
   */
  detectExistingPlayground() {
    if (!this.world) return false;

    // 遍历世界中的所有区块
    for (const [chunkKey, chunk] of this.world.chunks.entries()) {
      // 检查区块是否有修改过的方块
      if (chunk.blockData) {
        for (const [code, entry] of chunk.blockData) {
          const entryType = typeof entry === 'string' ? entry : entry?.type;
          if (entryType === 'playground_center_block' || entryType === 'playground_block') {
            // 找到创造台方块，解析坐标
            const { x, y, z } = Chunk.decodeCoord(code);

            // 查找中心方块来确定创造台原点
            if (entryType === 'playground_center_block') {
              this.playgroundOrigin = { x, y, z };
              this.isPlaygroundActive = true;

              // 重新构建 playgroundBlocks 集合
              this.playgroundBlocks.clear();
              const halfSize = this.playgroundSize / 2;
              const originX = x - halfSize;
              const originZ = z - halfSize;

              for (let dx = 0; dx < this.playgroundSize; dx++) {
                for (let dz = 0; dz < this.playgroundSize; dz++) {
                  const px = Math.floor(originX + dx);
                  const pz = Math.floor(originZ + dz);
                  this.playgroundBlocks.add(`${px},${y},${pz}`);
                }
              }

              console.log(`[PlaygroundService] 检测到已存在的创造台 at (${originX}, ${y}, ${originZ})`);
              return true;
            }
          }
        }
      }
    }

    // 如果没找到中心方块，尝试通过 persistenceService 的缓存查找
    // 注意：persistenceService.cache 的键是区块坐标 "cx,cz"，值是 { blocks: {}, entities: {} }
    if (persistenceService && persistenceService.cache) {
      for (const [chunkKey, chunkData] of persistenceService.cache.entries()) {
        if (chunkData && chunkData.blocks) {
          for (const [blockKey, blockData] of Object.entries(chunkData.blocks)) {
            if (blockData && blockData.type === 'playground_center_block') {
              const [x, y, z] = blockKey.split(',').map(Number);
              this.playgroundOrigin = { x, y, z };
              this.isPlaygroundActive = true;

              // 重新构建 playgroundBlocks 集合
              this.playgroundBlocks.clear();
              const halfSize = this.playgroundSize / 2;
              const originX = x - halfSize;
              const originZ = z - halfSize;

              for (let dx = 0; dx < this.playgroundSize; dx++) {
                for (let dz = 0; dz < this.playgroundSize; dz++) {
                  const px = Math.floor(originX + dx);
                  const pz = Math.floor(originZ + dz);
                  this.playgroundBlocks.add(`${px},${y},${pz}`);
                }
              }

              console.log(`[PlaygroundService] 从缓存检测到已存在的创造台 at (${originX}, ${y}, ${originZ})`);
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查创造台是否已激活
   * @returns {boolean}
   */
  get isPlaygroundActive() {
    return this._isPlaygroundActive || false;
  }

  set isPlaygroundActive(value) {
    this._isPlaygroundActive = value;
  }

  /**
   * 从指定高度向下搜索地面
   * @param {number} x - X 坐标
   * @param {number} startY - 起始 Y 坐标
   * @param {number} z - Z 坐标
   * @returns {number|null} 地面 Y 坐标
   */
  findGroundLevelFromBelow(x, startY, z) {
    for (let y = startY; y >= 0; y--) {
      if (this.world && this.world.isSolid(x, y, z)) {
        return y + 1;
      }
    }
    return null;
  }

  /**
   * 检查创造台区域是否与现有非空气方块重叠
   * @param {number} originX - 创造台左下角 X 坐标
   * @param {number} originY - 创造台平台 Y 坐标
   * @param {number} originZ - 创造台左下角 Z 坐标
   * @param {number} size - 创造台尺寸
   * @param {number} clearance - 净空高度（平台上方需要检查的高度）
   * @returns {boolean} 是否有重叠
   */
  hasOverlapWithWorld(originX, originY, originZ, size, clearance = 10) {
    if (!this.world) return false;

    // 检查创造台平台层（y）和上方净空区域是否有非空气方块
    for (let dx = 0; dx < size; dx++) {
      for (let dz = 0; dz < size; dz++) {
        const x = Math.floor(originX + dx);
        const z = Math.floor(originZ + dz);

        // 检查平台层是否有非空气方块（重叠）
        const platformBlock = this.world.getBlock(x, originY, z);
        if (platformBlock && platformBlock !== 'air') {
          return true; // 平台位置与世界方块重叠
        }

        // 检查平台上方净空区域是否有非空气方块
        for (let y = originY + 1; y <= originY + clearance; y++) {
          const blockType = this.world.getBlock(x, y, z);
          if (blockType && blockType !== 'air') {
            return true; // 净空区域有方块
          }
        }
      }
    }
    return false;
  }

  /**
   * 从指定高度向上搜索，找到第一个没有重叠的安全高度
   * @param {number} originX - 创造台左下角 X 坐标
   * @param {number} startY - 起始 Y 坐标
   * @param {number} originZ - 创造台左下角 Z 坐标
   * @param {number} size - 创造台尺寸
   * @param {number} clearance - 净空高度
   * @param {number} maxY - 最大搜索高度
   * @returns {number|null} 安全高度或 null
   */
  findSafePlaygroundHeight(originX, startY, originZ, size, clearance = 10, maxY = 200) {
    if (!this.world) return null;

    let y = startY;
    while (y <= maxY) {
      if (!this.hasOverlapWithWorld(originX, y, originZ, size, clearance)) {
        return y; // 找到安全高度
      }
      y++; // 向上移动一格继续检查
    }
    return null; // 未找到安全高度
  }

  /**
   * 在玩家附近创建创造台
   * @param {THREE.Vector3} playerPos - 玩家位置
   * @returns {{ success: boolean, error?: string, affectedChunkKeys?: string[] }}
   */
  createPlayground(playerPos) {
    if (this.isPlaygroundActive) {
      return { success: false, error: 'PLAYGROUND_EXISTS' };
    }

    if (!this.world) {
      return { success: false, error: 'WORLD_NOT_INITIALIZED' };
    }

    // 在玩家东侧或西侧生成创造台（优先东侧，如果东侧空间不足则选西侧）
    const distance = 10; // 距离玩家 10 格
    const playerX = Math.floor(playerPos.x);
    const playerY = Math.floor(playerPos.y);
    const playerZ = Math.floor(playerPos.z);

    // 需要的净空高度：平台上方 10 格
    const requiredClearance = 10;

    // 尝试东侧（+X 方向）
    let originX = playerX + distance;
    let originZ = playerZ - this.playgroundSize / 2;

    // 从东侧找到地面高度，然后向上搜索直到没有重叠
    let groundY = this.findGroundLevelFromBelow(playerX + distance, playerY, playerZ - this.playgroundSize / 2);
    let originY = groundY !== null
      ? this.findSafePlaygroundHeight(originX, groundY, originZ, this.playgroundSize, requiredClearance)
      : null;

    // 如果东侧找不到合适位置，尝试西侧（-X 方向）
    if (originY === null) {
      originX = playerX - distance;
      originZ = playerZ - this.playgroundSize / 2;
      groundY = this.findGroundLevelFromBelow(playerX - distance, playerY, playerZ - this.playgroundSize / 2);
      originY = groundY !== null
        ? this.findSafePlaygroundHeight(originX, groundY, originZ, this.playgroundSize, requiredClearance)
        : null;
    }

    // 如果还是找不到合适位置，使用玩家 Y 坐标作为起点向上搜索
    if (originY === null) {
      originX = playerX + distance;
      originZ = playerZ - this.playgroundSize / 2;
      originY = this.findSafePlaygroundHeight(originX, playerY - 20, originZ, this.playgroundSize, requiredClearance);
    }

    // 最后手段：在玩家脚下 5 格处作为起点向上搜索
    if (originY === null) {
      originX = playerX + distance;
      originZ = playerZ - this.playgroundSize / 2;
      originY = this.findSafePlaygroundHeight(originX, playerY - 5, originZ, this.playgroundSize, requiredClearance);
    }

    if (originY === null) {
      return { success: false, error: 'NO_SAFE_LOCATION' };
    }

    this.playgroundOrigin = { x: originX, y: originY, z: originZ };

    // 生成 playgroundSize x playgroundSize 平台（批量快写，不走逐块动态渲染）
    const platformBlocks = [];
    for (let dx = 0; dx < this.playgroundSize; dx++) {
      for (let dz = 0; dz < this.playgroundSize; dz++) {
        const x = Math.floor(originX + dx);
        const y = Math.floor(originY);
        const z = Math.floor(originZ + dz);

        // 在中心位置放置标记方块
        const centerX = Math.floor(this.playgroundSize / 2);
        const centerZ = Math.floor(this.playgroundSize / 2);
        if (dx === centerX && dz === centerZ) {
          platformBlocks.push({ x, y, z, type: 'playground_center_block', orientation: 0 });
        } else {
          platformBlocks.push({ x, y, z, type: 'playground_block', orientation: 0 });
        }
      }
    }
    const batchResult = this.world.setBlocksBatch(platformBlocks, {
      deferConsolidation: true,
      replaceExisting: true
    });
    const affectedChunkKeys = new Set(batchResult.touchedChunks);
    platformBlocks.forEach((block) => {
      this.playgroundBlocks.add(`${block.x},${block.y},${block.z}`);
      affectedChunkKeys.add(this.getChunkKeyForPosition(block.x, block.z));
    });
    const placed = batchResult.placed;

    this.isPlaygroundActive = true;
    console.log(`Playground created: ${placed} blocks at (${originX}, ${originY}, ${originZ})`);

    return { success: true, origin: this.playgroundOrigin, affectedChunkKeys: Array.from(affectedChunkKeys) };
  }

  /**
   * 检查玩家是否在创造台区域内
   * @param {THREE.Vector3} playerPos - 玩家位置
   * @returns {boolean} 是否在区域内
   */
  isPlayerInPlayground(playerPos) {
    if (!this.isPlaygroundActive || !this.playgroundOrigin) {
      return false;
    }

    const minX = this.playgroundOrigin.x;
    const maxX = this.playgroundOrigin.x + this.playgroundSize;
    const minZ = this.playgroundOrigin.z;
    const maxZ = this.playgroundOrigin.z + this.playgroundSize;
    const minY = this.playgroundOrigin.y;
    const maxY = this.playgroundOrigin.y + 20; // 合理的高度范围

    return playerPos.x >= minX && playerPos.x < maxX &&
           playerPos.y >= minY && playerPos.y < maxY &&
           playerPos.z >= minZ && playerPos.z < maxZ;
  }

  /**
   * 关闭创造台，删除所有相关方块
   * @param {THREE.Vector3} playerPos - 玩家位置（用于安全检查）
   * @returns {{ success: boolean, error?: string }}
   */
  closePlayground(playerPos) {
    if (!this.isPlaygroundActive) {
      return { success: false, error: 'NOT_ACTIVE' };
    }

    // 检查玩家是否在创造台区域内
    if (playerPos && this.isPlayerInPlayground(playerPos)) {
      return { success: false, error: 'PLAYER_IN_PLAYGROUND' };
    }

    // 删除所有创造台方块
    if (this.world && this.playgroundBlocks.size > 0) {
      for (const blockKey of this.playgroundBlocks) {
        const [x, y, z] = blockKey.split(',').map(Number);
        this.world.setBlock(x, y, z, 'air');
      }
    }

    // 清空方块追踪集合
    this.playgroundBlocks.clear();

    // 重置状态
    this.isPlaygroundActive = false;
    this.playgroundOrigin = null;

    console.log('Playground closed and all blocks removed');
    return { success: true };
  }

  /**
   * 获取创造台上所有非 playground_block 的方块
   * @returns {Array} 模型方块数组
   */
  getModelBlocks() {
    if (!this.world || !this.playgroundOrigin) {
      return [];
    }

    const blocks = [];
    const centerX = this.playgroundOrigin.x + this.playgroundSize / 2;
    const centerY = this.playgroundOrigin.y;
    const centerZ = this.playgroundOrigin.z + this.playgroundSize / 2;

    // 遍历创造台区域
    for (let dx = 0; dx < this.playgroundSize; dx++) {
      for (let dz = 0; dz < this.playgroundSize; dz++) {
        const x = Math.floor(this.playgroundOrigin.x + dx);
        // 从平台上方开始检查（y+1 及以上）
        for (let y = Math.floor(this.playgroundOrigin.y) + 1; y < 256; y++) {
          const blockType = this.world.getBlock(x, y, this.playgroundOrigin.z + dz);

          if (blockType && blockType !== 'air' && blockType !== 'playground_block' && blockType !== 'playground_center_block') {
            const entry = this.world.getBlockEntry(x, y, this.playgroundOrigin.z + dz);
            if (entry) {
              // 计算相对坐标
              const relativeX = x - centerX;
              const relativeY = y - centerY;
              const relativeZ = (this.playgroundOrigin.z + dz) - centerZ;

              // 转换方向值为 Minecraft 标准 (0-5)
              const direction = this.convertOrientation(entry.orientation);

              blocks.push({
                x: Math.round(relativeX),
                y: Math.round(relativeY),
                z: Math.round(relativeZ),
                type: entry.type,
                direction: direction
              });
            }
          }
        }
      }
    }

    return blocks;
  }

  /**
   * 将游戏内方向 (0-3) 转换为 Minecraft 标准方向 (0-5)
   * @param {number} orientation - 游戏内方向 (0-3)
   * @returns {number} Minecraft 方向 (0-5)
   */
  convertOrientation(orientation) {
    // 游戏内：0=东，1=南，2=西，3=北
    // Minecraft: 0=上，1=下，2=北，3=南，4=西，5=东
    // 简单映射：水平方向保持不变（0-3 对应东东南西）
    // 为了兼容性，返回原值（0-3），后续可扩展垂直方向
    return orientation || 0;
  }

  /**
   * 导出模型为 JSON 文件并触发下载
   * @returns {{ success: boolean, error?: string }}
   */
  exportModel() {
    if (!this.isPlaygroundActive) {
      return { success: false, error: 'PLAYGROUND_NOT_ACTIVE' };
    }

    const blocks = this.getModelBlocks();

    // 创建 JSON 数据
    const modelData = {
      blocks: blocks,
      metadata: {
        created: new Date().toISOString(),
        dimensions: this.calculateDimensions(blocks)
      }
    };

    // 序列化为 JSON 字符串
    const json = JSON.stringify(modelData, null, 2);

    // 创建 Blob 并触发下载
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`Model exported: ${blocks.length} blocks to model.json`);
      return { success: true };
    } catch (error) {
      console.error('Export failed:', error);
      return { success: false, error: 'DOWNLOAD_FAILED' };
    }
  }

  /**
   * 从 JSON 字符串导入模型到创造台（批量快写 + 导入后统一优化）
   * @param {string} jsonText - 模型 JSON 字符串（格式兼容 tank.json）
   * @returns {Promise<{ success: boolean, error?: string, placed?: number, skipped?: number, invalid?: number, affectedChunkKeys?: string[] }>}
   */
  async importModelFromJson(jsonText) {
    if (!this.isPlaygroundActive || !this.playgroundOrigin) {
      return { success: false, error: 'PLAYGROUND_NOT_ACTIVE' };
    }

    if (!this.world) {
      return { success: false, error: 'WORLD_NOT_INITIALIZED' };
    }

    let modelData;
    try {
      modelData = JSON.parse(jsonText);
    } catch {
      return { success: false, error: 'INVALID_JSON' };
    }

    if (!modelData || !Array.isArray(modelData.blocks)) {
      return { success: false, error: 'INVALID_MODEL_FORMAT' };
    }

    const centerX = this.playgroundOrigin.x + this.playgroundSize / 2;
    const centerY = this.playgroundOrigin.y;
    const centerZ = this.playgroundOrigin.z + this.playgroundSize / 2;

    let placed = 0;
    let skipped = 0;
    let invalid = 0;
    const affectedChunkKeys = new Set();
    const pendingPosSet = new Set();
    const blocksToPlace = [];

    for (const block of modelData.blocks) {
      if (!block || typeof block !== 'object') {
        invalid++;
        continue;
      }

      const relX = Number(block.x);
      const relY = Number(block.y);
      const relZ = Number(block.z);
      const type = typeof block.type === 'string' ? block.type.trim() : '';

      if (!Number.isFinite(relX) || !Number.isFinite(relY) || !Number.isFinite(relZ) || !type) {
        invalid++;
        continue;
      }

      const props = getBlockProperties(type);
      // 统一跳过不可渲染方块（例如 collider / 各类占位符），避免“透明可碰撞”
      if (!props.isRendered) {
        skipped++;
        continue;
      }

      const x = Math.round(centerX + relX);
      const y = Math.round(centerY + relY);
      const z = Math.round(centerZ + relZ);
      const posKey = `${x},${y},${z}`;

      // 防止越界写入
      if (y < 0 || y > 255) {
        invalid++;
        continue;
      }

      // 同一次导入中，重复坐标只保留首次，避免重复写入
      if (pendingPosSet.has(posKey)) {
        skipped++;
        continue;
      }

      const orientation = this.convertDirectionToOrientation(block.direction);
      pendingPosSet.add(posKey);
      blocksToPlace.push({ x, y, z, type, orientation });
      affectedChunkKeys.add(this.getChunkKeyForPosition(x, z));
    }

    const clearInfo = this.collectModelAreaBlocksToClear();
    const clearResult = this.world.setBlocksBatch(clearInfo.blocks, {
      deferConsolidation: true,
      replaceExisting: true
    });
    clearResult.touchedChunks.forEach((key) => affectedChunkKeys.add(key));

    // 导入阶段只写逻辑数据，不创建动态 mesh，避免导入中帧率骤降
    const importResult = this.world.setBlocksBatch(blocksToPlace, {
      deferConsolidation: true,
      replaceExisting: false
    });
    placed = importResult.placed;
    skipped += importResult.skipped;
    importResult.touchedChunks.forEach((key) => affectedChunkKeys.add(key));

    return {
      success: true,
      placed,
      skipped,
      invalid,
      affectedChunkKeys: Array.from(affectedChunkKeys)
    };
  }

  /**
   * 收集创造台模型区中的可清除方块（保留平台本体）
   * @returns {{ blocks: Array<{x:number,y:number,z:number,type:string,orientation:number}> }}
   */
  collectModelAreaBlocksToClear() {
    const blocks = [];
    if (!this.world || !this.playgroundOrigin) return { blocks };

    const minX = Math.floor(this.playgroundOrigin.x);
    const maxX = minX + this.playgroundSize - 1;
    const minZ = Math.floor(this.playgroundOrigin.z);
    const maxZ = minZ + this.playgroundSize - 1;
    const minY = Math.floor(this.playgroundOrigin.y) + 1;

    for (const [, chunk] of this.world.chunks) {
      if (!chunk || !chunk.blockData) continue;

      for (const [key, entry] of Object.entries(chunk.blockData)) {
        const [x, y, z] = key.split(',').map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (x < minX || x > maxX || z < minZ || z > maxZ || y < minY) continue;

        const type = typeof entry === 'string' ? entry : entry?.type;
        if (!type || type === 'air' || type === 'playground_block' || type === 'playground_center_block') {
          continue;
        }

        blocks.push({ x, y, z, type: 'air', orientation: 0 });
      }
    }

    return { blocks };
  }

  /**
   * 将世界坐标转换为区块键
   * @param {number} x - 世界坐标 X
   * @param {number} z - 世界坐标 Z
   * @returns {string} 区块键 "cx,cz"
   */
  getChunkKeyForPosition(x, z) {
    return `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
  }

  /**
   * 等待指定区块优化完成（Worker 一次性计算并回写）
   * @param {string[]|Set<string>} chunkKeys - 受影响区块列表
   * @param {number} timeoutMs - 超时时间（毫秒）
   * @param {{ includeNeighbors?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async waitForOptimizationComplete(chunkKeys, timeoutMs = 30000, options = {}) {
    if (!this.world || !chunkKeys) return true;
    const includeNeighbors = options.includeNeighbors === true;
    const baseKeys = Array.isArray(chunkKeys) ? chunkKeys : Array.from(chunkKeys);
    const keys = includeNeighbors ? this.expandChunkKeysWithNeighbors(baseKeys) : baseKeys;
    if (keys.length === 0) return true;

    const pendingKeys = [];
    for (const key of keys) {
      const chunk = this.world.chunks.get(key);
      if (!chunk || !chunk.isReady) continue;
      if (chunk.dirtyBlocks > 0 || chunk.isConsolidating || chunk.consolidationTimer) {
        pendingKeys.push(key);
      }
    }
    if (pendingKeys.length === 0) return true;

    return this.optimizeChunksWithWorker(pendingKeys, timeoutMs);
  }

  /**
   * 将指定区块一次性提交到 Worker 优化，并同步回主线程
   * @param {string[]} chunkKeys - 待优化区块键列表
   * @param {number} timeoutMs - 超时时间
   * @returns {Promise<boolean>}
   */
  async optimizeChunksWithWorker(chunkKeys, timeoutMs = 30000) {
    if (!this.world || !Array.isArray(chunkKeys) || chunkKeys.length === 0) return true;

    const tasks = [];
    for (const key of chunkKeys) {
      const chunk = this.world.chunks.get(key);
      if (!chunk || !chunk.isReady) continue;

      tasks.push(new Promise((resolve) => {
        const callbackKey = `pg-opt:${key}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const consolidatedCount = chunk.dirtyBlocks;
        const consolidatedMeshKeys = new Set(chunk.dynamicMeshes.keys());

        if (chunk.consolidationTimer) {
          clearTimeout(chunk.consolidationTimer);
          chunk.consolidationTimer = null;
        }
        chunk.deferConsolidation = false;
        chunk.isConsolidating = true;

        const timeoutId = setTimeout(() => {
          workerCallbacks.delete(callbackKey);
          chunk.isConsolidating = false;
          console.warn(`[PlaygroundService] Worker 优化超时: ${key}`);
          resolve(false);
        }, timeoutMs);

        workerCallbacks.set(callbackKey, (data) => {
          clearTimeout(timeoutId);
          try {
            chunk._applyConsolidateResult(data, consolidatedCount, consolidatedMeshKeys);
            resolve(true);
          } catch (error) {
            chunk.isConsolidating = false;
            console.error(`[PlaygroundService] 应用 Worker 优化结果失败: ${key}`, error);
            resolve(false);
          }
        });

        worldWorker.postMessage({
          cx: chunk.cx,
          cz: chunk.cz,
          callbackKey,
          seed: WORLD_CONFIG.SEED,
          snapshot: {
            blocks: { ...chunk.blockData },
            entities: { ...chunk.entities }
          },
          structureCenters: chunk.structureCenters,
          isOptimization: true
        });
      }));
    }

    if (tasks.length === 0) return true;
    const results = await Promise.all(tasks);
    return results.every(Boolean);
  }

  /**
   * 将传入区块扩展为“自身 + 邻居一圈（3x3）”
   * @param {string[]} chunkKeys - 区块键数组
   * @returns {string[]} 扩展后的区块键数组
   */
  expandChunkKeysWithNeighbors(chunkKeys) {
    const expanded = new Set();
    for (const key of chunkKeys) {
      const [cxStr, czStr] = String(key).split(',');
      const cx = Number(cxStr);
      const cz = Number(czStr);
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          expanded.add(`${cx + dx},${cz + dz}`);
        }
      }
    }
    return Array.from(expanded);
  }

  /**
   * 对指定区块立即触发一次合并（绕过防抖延迟）
   * @param {Iterable<string>} chunkKeys - 区块键集合
   */
  triggerImmediateConsolidation(chunkKeys) {
    if (!this.world || !chunkKeys) return;
    for (const key of chunkKeys) {
      const chunk = this.world.chunks.get(key);
      if (!chunk || !chunk.isReady || chunk.dirtyBlocks <= 0 || chunk.isConsolidating) continue;
      if (chunk.consolidationTimer) {
        clearTimeout(chunk.consolidationTimer);
        chunk.consolidationTimer = null;
      }
      chunk.consolidate();
    }
  }

  /**
   * 将导入模型中的 direction 转为游戏内 orientation
   * @param {number} direction - 模型方向值
   * @returns {number} orientation (0-3)
   */
  convertDirectionToOrientation(direction) {
    const normalized = Number(direction);
    if (!Number.isFinite(normalized)) return 0;
    const intDir = Math.trunc(normalized);
    return ((intDir % 4) + 4) % 4;
  }

  /**
   * 计算模型尺寸
   * @param {Array} blocks - 方块数组
   * @returns {{ width: number, height: number, depth: number }}
   */
  calculateDimensions(blocks) {
    if (blocks.length === 0) {
      return { width: 0, height: 0, depth: 0 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const block of blocks) {
      minX = Math.min(minX, block.x);
      maxX = Math.max(maxX, block.x);
      minY = Math.min(minY, block.y);
      maxY = Math.max(maxY, block.y);
      minZ = Math.min(minZ, block.z);
      maxZ = Math.max(maxZ, block.z);
    }

    return {
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      depth: maxZ - minZ + 1
    };
  }
}

// 导出单例实例
export const playgroundService = PlaygroundService.getInstance();
