// src/world/entity-system/EntityDefinition.js

/**
 * 实体定义基类
 * 所有实体类型（代码实现和 JSON 加载）都必须继承此类
 */
export class EntityDefinition {
  /**
   * @param {Object} config - 实体配置
   * @param {string} config.id - 唯一标识符（如 'tree_default', 'ugly_house'）
   * @param {'code' | 'json'} config.type - 实体类型：'code' 表示代码实现，'json' 表示 JSON 加载
   * @param {string[]} [config.biomes=[]] - 允许生成的生物群系列表
   * @param {number} [config.probability=0] - 基础生成概率（0-1）
   * @param {Function} [config.condition] - 额外生成条件函数 (wx, wy, wz, biome, seed) => boolean
   * @param {Function} config.generate - 生成函数 (x, y, z, chunk, dObj) => void
   * @param {number} [config.crossChunkDist=8] - 跨 Chunk 渲染距离
   * @param {boolean} [config.isSolid=true] - 是否参与碰撞检测
   * @param {string[]} [config.categories=[]] - 实体分类标签（如 'tree', 'structure', 'decoration'）
   */
  constructor(config) {
    this.id = config.id;
    this.type = config.type;
    this.biomes = config.biomes || [];
    this.probability = config.probability || 0;
    this.condition = config.condition;
    this.generateFn = config.generate;
    this.crossChunkDist = config.crossChunkDist || 8;
    this.isSolid = config.isSolid ?? true;
    this.categories = config.categories || [];
  }

  /**
   * 判断是否应该在此位置生成实体
   * @param {number} wx - 世界 X 坐标
   * @param {number} wy - 世界 Y 坐标
   * @param {number} wz - 世界 Z 坐标
   * @param {string} biome - 生物群系名称
   * @param {number} seed - 世界种子
   * @returns {boolean} 是否应该生成
   */
  shouldSpawn(wx, wy, wz, biome, seed) {
    // 检查生物群系
    if (this.biomes.length > 0 && !this.biomes.includes(biome)) {
      return false;
    }

    // 检查随机概率
    if (this.probability > 0 && Math.random() > this.probability) {
      return false;
    }

    // 检查额外条件
    if (this.condition && !this.condition(wx, wy, wz, biome, seed)) {
      return false;
    }

    return true;
  }

  /**
   * 执行实体生成
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {number} z - Z 坐标
   * @param {Object} chunk - 区块对象（fakeChunk，用于 add 方块）
   * @param {Object} dObj - 数据收集对象
   * @returns {Object} 生成结果 { blocks: [], entities: [] }
   */
  generate(x, y, z, chunk, dObj) {
    if (!this.generateFn) {
      console.warn(`EntityDefinition[${this.id}]: generateFn is not defined`);
      return { blocks: [], entities: [] };
    }

    // 执行生成函数
    this.generateFn(x, y, z, chunk, dObj);

    // 返回基础实体数据（用于跨 Chunk 渲染跟踪）
    return {
      blocks: [],  // 注意：实际方块已通过 generateFn 直接添加到 chunk
      entities: [{ type: this.id, x, y, z }]
    };
  }
}
