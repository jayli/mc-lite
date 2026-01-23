// src/world/TerrainGen.js
// 地形生成器模块
// 负责根据噪声函数和生物群系生成地形高度，判断是否生成云
import { noise, getBiome } from '../utils/MathUtils.js';

/**
 * 地形生成器类
 * 提供地形高度生成、生物群系获取和云生成判断功能
 */
export class TerrainGen {
    constructor() {
    }

    /**
     * 获取指定坐标的生物群系
     * @param {number} x - X坐标
     * @param {number} z - Z坐标
     * @returns {string} 生物群系类型
     */
    getBiome(x, z) {
        return getBiome(x, z);
    }

    /**
     * 生成指定坐标的地形高度
     * @param {number} x - X坐标
     * @param {number} z - Z坐标
     * @param {string} biome - 生物群系类型
     * @returns {number} 地形高度值
     */
    generateHeight(x, z, biome) {
        let h = Math.floor(noise(x, z, 0.08) + noise(x, z, 0.02) * 3);

        // Terrain tweaking based on biome
        // 根据生物群系调整地形高度
        if (biome === 'DESERT') h = Math.floor(h * 0.5 + 2);
        if (biome === 'SWAMP') h = Math.floor(h * 0.3 - 2);

        return h;
    }

    /**
     * 判断指定坐标是否应该生成云
     * @param {number} x - X坐标
     * @param {number} z - Z坐标
     * @returns {boolean} 是否生成云
     */
    shouldGenerateCloud(x, z) {
        return noise(x, z, 0.03) > 1.2;
    }
}

// 地形生成器实例
export const terrainGen = new TerrainGen();
