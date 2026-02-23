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
   * 查找指定位置的地表高度，确保上方有足够净空
   * @param {number} x - X 坐标
   * @param {number} z - Z 坐标
   * @param {number} minClearance - 最小净空要求（默认 12 格，包含平台到上方 10 格）
   * @returns {number|null} 地表 Y 坐标或 null
   */
  findGroundLevel(x, z, minClearance = 12) {
    // 从高空向下射线检测，找到第一个实心方块，且上方有足够净空
    for (let y = 100; y >= 0; y--) {
      if (this.world && this.world.isSolid(x, y, z)) {
        const groundY = y + 1; // 地面高度（方块上方）
        // 检查上方是否有足够净空
        if (this.hasClearanceAbove(x, groundY, z, minClearance)) {
          return groundY;
        }
      }
    }
    return null;
  }

  /**
   * 检查指定位置上方是否有足够的净空高度
   * @param {number} x - X 坐标（创造台中心）
   * @param {number} y - Y 坐标（创造台平台高度）
   * @param {number} z - Z 坐标（创造台中心）
   * @param {number} requiredHeight - 需要的净空高度
   * @returns {boolean} 是否有足够净空
   */
  hasClearanceAbove(x, y, z, requiredHeight = 12) {
    if (!this.world) return false;

    // 检查平台上方 requiredHeight 个方块高度内是否有障碍物
    // 从 y+1 开始检查到 y+requiredHeight
    for (let checkY = y + 1; checkY <= y + requiredHeight; checkY++) {
      if (this.world.isSolid(x, checkY, z)) {
        return false;
      }
    }
    return true;
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

    // 需要的净空高度：平台上方 10 格 + 平台本身 1 格 = 11 格，额外增加 2 格余量
    const requiredClearance = 12;

    // 尝试东侧（+X 方向）
    let originX = playerX + distance;
    let originZ = playerZ - this.playgroundSize / 2;
    const centerX = originX + this.playgroundSize / 2;
    const centerZ = originZ + this.playgroundSize / 2;
    let originY = this.findGroundLevel(centerX, centerZ, requiredClearance);

    // 如果东侧找不到地面，尝试西侧（-X 方向）
    if (originY === null) {
      originX = playerX - distance;
      originZ = playerZ - this.playgroundSize / 2;
      const centerX = originX + this.playgroundSize / 2;
      const centerZ = originZ + this.playgroundSize / 2;
      originY = this.findGroundLevel(centerX, centerZ, requiredClearance);
    }

    // 如果还是找不到地面，使用玩家 Y 坐标向下搜索
    if (originY === null) {
      originY = this.findGroundLevelFromBelow(playerX, playerY - 20, playerZ);
    }

    if (originY === null) {
      // 最后手段：在玩家脚下 5 格处生成
      originY = playerY - 5;
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
