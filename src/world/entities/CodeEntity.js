// src/world/entities/CodeEntity.js

import { EntityDefinition } from './EntityDefinition.js';

/**
 * 代码实现实体类
 * 用于 Tree、Cloud、Island 等程序化生成的实体
 */
export class CodeEntity extends EntityDefinition {
  /**
   * @param {Object} config - 实体配置
   * @param {string} config.id - 唯一标识符
   * @param {string[]} [config.biomes=[]] - 允许的生物群系
   * @param {number} [config.probability=0] - 基础生成概率
   * @param {Function} [config.condition] - 额外生成条件
   * @param {Function} config.generateFn - 静态生成方法引用（如 Tree.generate）
   * @param {number} [config.crossChunkDist=8] - 跨 Chunk 渲染距离
   * @param {boolean} [config.isSolid=true] - 是否参与碰撞
   * @param {string[]} [config.categories=[]] - 实体分类标签
   */
  constructor(config) {
    super(config);
    this.type = 'code';
    // generateFn 已经在父类中保存
  }

  /**
   * 执行实体生成
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {number} z - Z 坐标
   * @param {Object} chunk - 区块对象
   * @param {Object} dObj - 数据收集对象
   * @returns {Object} 生成结果
   */
  generate(x, y, z, chunk, dObj) {
    // 调用实际的生成方法
    this.generateFn(x, y, z, chunk, dObj);

    // 返回实体数据用于跨 Chunk 渲染
    return {
      blocks: [],  // CodeEntity 直接操作 chunk，不返回 blocks
      entities: [{ type: this.id, x, y, z }]
    };
  }
}
