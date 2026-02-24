// src/workers/StructureLoader.js
import { getBlockProperties } from '../constants/BlockData.js';

/**
 * 结构数据加载器类
 * 用于从 JSON 文件加载和管理结构数据（如小屋、树木、坦克等）
 */
export class StructureLoader {
  /**
   * @param {string} name - 结构名称（用于日志和缓存键）
   * @param {string} jsonPath - JSON 文件路径（相对于 workers 目录）
   * @param {boolean} normalizeY - 是否将 Y 坐标归一化（使最低点 Y=1）
   */
  constructor(name, jsonPath, normalizeY = true) {
    this.name = name;
    this.jsonPath = jsonPath;
    this.normalizeY = normalizeY;
    this.data = null;
    this.loading = null;
  }

  /**
   * 异步加载结构数据
   * @returns {Promise<{ blocks: Array }>} 结构数据
   */
  async load() {
    if (this.data) return this.data;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const response = await fetch(this.jsonPath);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log(`${this.name}.json loaded, block count:`, data.blocks.length);

        // 找出最低 Y 值
        let minY = Infinity;
        data.blocks.forEach(b => { if (b.y < minY) minY = b.y; });
        console.log(`${this.name} minY:`, minY);

        // 将 Y 坐标归一化，使最低点 Y=1
        this.data = {
          blocks: data.blocks.map(b => ({
            x: b.x,
            y: this.normalizeY ? (b.y - minY + 1) : b.y,
            z: b.z,
            type: b.type,
            direction: b.direction !== undefined ? b.direction : 0
          }))
        };
        console.log(`${this.name} ready, blocks:`, this.data.blocks.length);
        return this.data;
      } catch (err) {
        console.error(`Failed to load ${this.name}.json:`, err);
        this.data = { blocks: [] }; // 使用空数据避免后续错误
        return this.data;
      }
    })();

    return this.loading;
  }

  /**
   * 同步获取结构数据（仅在数据已加载后使用）
   * @returns {{ blocks: Array } | null} 结构数据
   */
  getData() {
    return this.data;
  }

  /**
   * 计算结构的最低点 Y 值
   * @returns {number} 最低点 Y 值
   */
  getBottomY() {
    if (!this.data) return 1;
    let minY = Infinity;
    for (const block of this.data.blocks) {
      if (block.y < minY) minY = block.y;
    }
    return minY;
  }

  /**
   * 生成结构方块
   * @param {number} x - X 坐标（结构中心点）
   * @param {number} y - Y 坐标（地面高度）
   * @param {number} z - Z 坐标（结构中心点）
   * @param {number} groundY - 地面 Y 坐标（用于对齐底部）
   * @returns {Array} 世界坐标下的方块数组
   */
  generateBlocks(x, y, z, groundY = null) {
    if (!this.data) return [];

    const blocks = [];
    const bottomY = groundY !== null ? this.getBottomY() : 0;

    for (const block of this.data.blocks) {
      const worldX = x + block.x;
      const worldY = groundY !== null ? y + (block.y - bottomY) : y + block.y - 1;
      const worldZ = z + block.z;

      blocks.push({
        x: worldX,
        y: worldY,
        z: worldZ,
        type: block.type,
        solid: block.solid !== false,
        orientation: block.direction ?? 0
      });
    }

    return blocks;
  }

  /**
   * 将方块添加到区块（带遮挡优化）
   * @param {Object} chunk - 区块对象
   * @param {Array} blocks - 方块数组
   * @param {Object} dObj - 数据收集对象
   * @param {boolean} optimizeTransparent - 是否对透明方块进行遮挡优化
   */
  addToChunk(chunk, blocks, dObj, optimizeTransparent = true) {
    if (!optimizeTransparent) {
      // 不进行优化，直接添加
      blocks.forEach(b => {
        chunk.add(b.x, b.y, b.z, b.type, dObj, b.solid !== false, b.orientation ?? 0);
      });
      return;
    }

    const blockMap = new Set();
    blocks.forEach(b => blockMap.add(`${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`));

    blocks.forEach(b => {
      const props = getBlockProperties(b.type);
      // 如果是透明方块（如某些特殊方块），进行遮挡剔除优化
      if (props.isTransparent && b.type !== 'vine') {
        // 检查 6 个相邻位置是否都在 blockMap 中
        const neighbors = [
          [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
        ];
        const isSurrounded = neighbors.every(([dx, dy, dz]) =>
          blockMap.has(`${Math.floor(b.x + dx)},${Math.floor(b.y + dy)},${Math.floor(b.z + dz)}`)
        );

        // 如果被完全包围，则认为不接触空气，跳过生成
        if (!isSurrounded) {
          chunk.add(b.x, b.y, b.z, b.type, dObj, b.solid !== false, b.orientation ?? 0);
        }
      } else {
        // 非透明方块直接添加
        chunk.add(b.x, b.y, b.z, b.type, dObj, b.solid !== false, b.orientation ?? 0);
      }
    });
  }

  /**
   * 生成并添加结构到区块
   * @param {number} x - X 坐标（结构中心点）
   * @param {number} y - Y 坐标（地面高度）
   * @param {number} z - Z 坐标（结构中心点）
   * @param {Object} chunk - 区块对象
   * @param {Object} dObj - 数据收集对象
   * @param {boolean} optimize - 是否进行遮挡优化
   */
  generate(x, y, z, chunk, dObj, optimize = true) {
    if (!this.data) return;
    const blocks = this.generateBlocks(x, y, z, y);
    this.addToChunk(chunk, blocks, dObj, optimize);
  }
}

/**
 * 预定义的结构加载器实例
 */
export const structureLoaders = {
  uglyHouse: new StructureLoader('ugly_house', '../world/blockmods/ugly_house.json'),
  birchTree: new StructureLoader('brich_tree', '../world/blockmods/brich_tree.json'),
  tank: new StructureLoader('tank', '../world/blockmods/tank.json')
};
