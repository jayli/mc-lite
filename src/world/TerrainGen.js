// src/world/TerrainGen.js
/**
 * 地形生成器模块
 *
 * 负责：
 * 1. 根据噪声函数和生物群系生成地形高度
 * 2. 提供生物群系查询功能
 * 3. 判断是否在特定位置生成云
 *
 * 使用多层噪声函数模拟自然地形，根据生物群系调整地形特征
 */
import { noise, getBiome } from '../utils/MathUtils.js';

/**
 * 地形生成器类
 *
 * 提供以下核心功能：
 * 1. 地形高度生成 - 基于噪声函数和生物群系特征
 * 2. 生物群系查询 - 封装 MathUtils.js 中的生物群系判断逻辑
 * 3. 云生成判断 - 根据噪声值决定是否生成云朵
 *
 * 使用多层噪声叠加技术模拟自然地形变化
 */
export class TerrainGen {
  /**
   * 创建地形生成器实例
   * 目前不需要特殊初始化，保留构造函数以备未来扩展
   */
  constructor() {
  }

  /**
   * 获取指定坐标的生物群系
   *
   * 生物群系判断基于温度和湿度噪声值：
   * 1. 温度噪声 (scale=0.01): 决定基本气候带
   * 2. 湿度噪声 (scale=0.015): 与温度结合决定具体生物群系
   *
   * 生物群系类型包括：
   * - 'FOREST' (森林): temp > 1.2
   * - 'AZALEA' (杜鹃林): 0.6 < temp ≤ 1.2 且 humidity > 0
   * - 'DESERT' (沙漠): temp < -1.5
   * - 'SWAMP' (沼泽): -1.5 < temp < -0.8 且 humidity > 0.5
   * - 'PLAINS' (平原): 默认生物群系
   *
   * @param {number} x - X坐标（世界坐标）
   * @param {number} z - Z坐标（世界坐标）
   * @returns {string} 生物群系类型
   */
  getBiome(x, z) {
    // 调用 MathUtils.js 中的生物群系判断函数
    return getBiome(x, z);
  }

  /**
   * 生成指定坐标的地形高度
   *
   * 使用多层噪声函数生成基础高度，然后根据生物群系进行调整：
   * 1. 基础噪声：低频噪声 (scale=0.08) 提供地形大体轮廓
   * 2. 细节噪声：高频噪声 (scale=0.02) 乘以3倍权重增加地形细节
   * 3. 生物群系调整：根据生物群系类型调整高度特征
   *
   * @param {number} x - X坐标（世界坐标）
   * @param {number} z - Z坐标（世界坐标）
   * @param {string} biome - 生物群系类型（'FOREST', 'DESERT', 'SWAMP', 'AZALEA', 'PLAINS'）
   * @returns {number} 地形高度值（整数Y坐标）
   */
  generateHeight(x, z, biome) {
    // 使用两层噪声叠加生成基础地形高度
    // 第一层：低频噪声 (0.08) - 控制地形大体轮廓
    // 第二层：高频噪声 (0.02) - 增加地形细节，乘以3倍权重增强效果
    let h = Math.floor(noise(x, z, 0.08) + noise(x, z, 0.02) * 3);

    // 根据生物群系调整地形高度特征
    if (biome === 'DESERT') h = Math.floor(h * 0.5 + 2);   // 沙漠：降低高度，增加平坦度
    if (biome === 'SWAMP') h = Math.floor(h * 0.3 - 2);   // 沼泽：显著降低高度，形成低洼湿地
    // 注意：森林、杜鹃林、平原等生物群系使用默认生成的高度

    return h;
  }

  /**
   * 判断指定坐标是否应该生成云
   *
   * 使用中等频率的噪声函数 (scale=0.03) 生成云朵分布模式：
   * - 噪声值 > 1.2 的区域生成云朵
   * - 噪声值 ≤ 1.2 的区域不生成云朵
   *
   * 这种方法可以生成自然的、连续的云朵分布，避免规则排列
   *
   * @param {number} x - X坐标（世界坐标）
   * @param {number} z - Z坐标（世界坐标）
   * @returns {boolean} 是否在指定坐标生成云朵
   */
  shouldGenerateCloud(x, z) {
    // 使用噪声函数生成云朵分布，噪声值大于1.2时生成云朵
    return noise(x, z, 0.03) > 1.7;
  }
}

/**
 * 地形生成器单例实例
 *
 * 项目中所有模块共享此实例，确保地形生成的一致性
 * 在 Chunk.js 等文件中导入并使用：import { terrainGen } from './TerrainGen.js'
 */
export const terrainGen = new TerrainGen();
