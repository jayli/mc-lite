// src/services/PlaygroundService.js
/**
 * PlaygroundService - 创造台服务
 * 负责创建、管理创造台平台和导出模型数据
 */

import { materials } from '../core/MaterialManager.js';

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
    this.playgroundSize = 40;     // 40x40 平台
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
   * @returns {{ success: boolean, error?: string }}
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

    // 生成 40x40 平台
    let placed = 0;
    for (let dx = 0; dx < this.playgroundSize; dx++) {
      for (let dz = 0; dz < this.playgroundSize; dz++) {
        const x = Math.floor(originX + dx);
        const y = Math.floor(originY);
        const z = Math.floor(originZ + dz);

        // 在中心位置放置标记方块
        const centerX = Math.floor(this.playgroundSize / 2);
        const centerZ = Math.floor(this.playgroundSize / 2);
        if (dx === centerX && dz === centerZ) {
          // 中心标记方块
          this.world.setBlock(x, y, z, 'playground_center_block');
          this.playgroundBlocks.add(`${x},${y},${z}`);
        } else {
          // 普通平台方块
          this.world.setBlock(x, y, z, 'playground_block');
          this.playgroundBlocks.add(`${x},${y},${z}`);
        }
        placed++;
      }
    }

    this.isPlaygroundActive = true;
    console.log(`Playground created: ${placed} blocks at (${originX}, ${originY}, ${originZ})`);

    return { success: true, origin: this.playgroundOrigin };
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
