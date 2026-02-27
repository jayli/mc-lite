// src/world/entities/JsonEntity.js

import { EntityDefinition } from './EntityDefinition.js';

/**
 * JSON 加载实体类
 * 用于 UglyHouse、BirchTree、Tank 等从 JSON 文件加载的实体
 */
export class JsonEntity extends EntityDefinition {
  /**
   * @param {Object} config - 实体配置
   * @param {string} config.id - 唯一标识符
   * @param {string[]} [config.biomes=[]] - 允许的生物群系
   * @param {number} [config.probability=0] - 基础生成概率
   * @param {Function} [config.condition] - 额外生成条件
   * @param {Object} config.loader - StructureLoader 实例
   * @param {number} [config.crossChunkDist=8] - 跨 Chunk 渲染距离
   * @param {boolean} [config.isSolid=true] - 是否参与碰撞
   * @param {string[]} [config.categories=[]] - 实体分类标签
   */
  constructor(config) {
    super(config);
    this.type = 'json';
    this.loader = config.loader;  // StructureLoader 实例
  }

  /**
   * 预加载结构数据
   * @returns {Promise<void>}
   */
  async preload() {
    if (this.loader && typeof this.loader.load === 'function') {
      return this.loader.load();
    }
    return Promise.resolve();
  }

  /**
   * 执行实体生成
   * @param {number} x - X 坐标（结构中心点）
   * @param {number} y - Y 坐标（地面高度）
   * @param {number} z - Z 坐标（结构中心点）
   * @param {Object} chunk - 区块对象
   * @param {Object} dObj - 数据收集对象
   * @returns {Object} 生成结果
   */
  generate(x, y, z, chunk, dObj) {
    if (!this.loader) {
      console.warn(`JsonEntity[${this.id}]: loader is not defined`);
      return { blocks: [], entities: [] };
    }

    // 使用 StructureLoader 生成结构
    // generate 方法签名：generate(x, y, z, chunk, dObj, optimize = true)
    this.loader.generate(x, y, z, chunk, dObj, true);

    // 返回实体数据用于跨 Chunk 渲染
    return {
      blocks: [],  // JsonEntity 直接操作 chunk，不返回 blocks
      entities: [{ type: this.id, x, y, z }]
    };
  }
}
