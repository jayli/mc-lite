// src/world/entity-system/EntitySpawnUtils.js

/**
 * 实体生成工具函数
 * 用于 WorldWorker 中的实体生成决策
 * 由于 WorldWorker 运行在 Worker 线程中，无法使用单例模式，
 * 因此提供纯函数方式的生成逻辑
 */

/**
 * 确定性随机函数
 * @param {number} x - X 坐标
 * @param {number} z - Z 坐标
 * @param {number} s - 种子
 * @returns {number} 0-1 之间的随机数
 */
export function seededRandom(x, z, s) {
  const val = Math.sin(x * 12.9898 + z * 78.233 + s) * 43758.5453123;
  return val - Math.floor(val);
}

/**
 * 判断是否生成普通树木
 * @param {string} biome - 生物群系
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 种子
 * @returns {boolean}
 */
export function shouldSpawnDefaultTree(biome, wx, wz, seed) {
  if (biome !== 'PLAINS') return false;
  const spawnRand = seededRandom(wx, wz, seed);
  return spawnRand < 0.005;
}

/**
 * 判断是否生成模因人
 * @param {string} biome - 生物群系
 * @param {number} wx - 世界 X 坐标
 * @param {number} wz - 世界 Z 坐标
 * @param {number} seed - 种子
 * @returns {boolean}
 */
export function shouldSpawnGunMan(biome, wx, wz, seed) {
  if (biome !== 'PLAINS') return false;
  const spawnRand = seededRandom(wx, wz, seed);
  return spawnRand < 0.0005;
}

/**
 * 判断是否生成坦克
 * @param {string} biome - 生物群系
 * @returns {boolean}
 */
export function shouldSpawnTank(biome) {
  return biome === 'PLAINS' && Math.random() < 0.0001;
}

/**
 * 判断是否生成房屋
 * @param {boolean} safeForStructure - 是否适合生成结构
 * @returns {boolean}
 */
export function shouldSpawnHouse(safeForStructure) {
  return safeForStructure && Math.random() < 0.001;
}

/**
 * 判断是否生成白桦树（在森林中）
 * @param {string} biome - 生物群系
 * @returns {boolean}
 */
export function shouldSpawnBirchTree(biome) {
  return biome === 'FOREST' && Math.random() < 0.04;
}

/**
 * 判断是否生成大型树木（在森林中）
 * @param {string} biome - 生物群系
 * @returns {boolean}
 */
export function shouldSpawnBigTree(biome) {
  return biome === 'FOREST' && Math.random() < 0.04;
}

/**
 * 判断是否生成真实树木（在森林中）
 * @param {string} biome - 生物群系
 * @returns {boolean}
 */
export function shouldSpawnRealisticTree(biome) {
  return biome === 'FOREST' && Math.random() < 0.04 && Math.random() < 0.15;
}

/**
 * 判断是否生成杜鹃花树
 * @param {string} biome - 生物群系
 * @returns {boolean}
 */
export function shouldSpawnAzaleaTree(biome) {
  return biome === 'AZALEA' && Math.random() < 0.045;
}

/**
 * 判断是否生成沼泽树
 * @param {string} biome - 生物群系
 * @returns {boolean}
 */
export function shouldSpawnSwampTree(biome) {
  return biome === 'SWAMP' && Math.random() < 0.03;
}

/**
 * 判断是否生成仙人掌
 * @param {string} biome - 生物群系
 * @returns {boolean}
 */
export function shouldSpawnCactus(biome) {
  return biome === 'DESERT' && Math.random() < 0.01;
}

/**
 * 判断是否生成火星车
 * @param {string} biome - 生物群系
 * @param {boolean} safeForStructure - 是否适合生成结构
 * @returns {boolean}
 */
export function shouldSpawnRover(biome, safeForStructure) {
  return biome === 'DESERT' && safeForStructure && Math.random() < 0.0005;
}

/**
 * 判断是否生成丑陋小屋
 * @param {string} biome - 生物群系
 * @param {boolean} safeForStructure - 是否适合生成结构
 * @returns {boolean}
 */
export function shouldSpawnUglyHouse(biome, safeForStructure) {
  return biome === 'DESERT' && safeForStructure && Math.random() < 0.00008;
}

/**
 * 判断是否生成沉船
 * @param {number} h - 高度
 * @param {boolean} safeForStructure - 是否适合生成结构
 * @returns {boolean}
 */
export function shouldSpawnShip(h, safeForStructure) {
  return h < -6 && safeForStructure && Math.random() < 0.001;
}

/**
 * 判断是否生成睡莲
 * @param {string} biome - 生物群系
 * @param {number} wLvl - 水位
 * @param {number} h - 高度
 * @returns {boolean}
 */
export function shouldSpawnLilypad(biome, wLvl, h) {
  return biome === 'SWAMP' && h < wLvl && Math.random() < 0.08;
}

/**
 * 判断是否生成云
 * @returns {boolean}
 */
export function shouldGenerateCloud() {
  // 实际判断在 terrainGen.shouldGenerateCloud 中
  return true;
}

/**
 * 判断是否生成天空岛
 * @returns {boolean}
 */
export function shouldSpawnIsland() {
  return Math.random() < 0.08;
}

/**
 * 判断是否生成云簇
 * @returns {boolean}
 */
export function shouldSpawnCloudCluster() {
  return Math.random() < 0.20;
}

/**
 * 判断是否生成草丛
 * @param {boolean} occupied - 是否已被占用
 * @returns {boolean}
 */
export function shouldSpawnShortGrass(occupied) {
  if (occupied) return false;
  return Math.random() < 0.05;
}

/**
 * 判断是否生成花朵
 * @param {boolean} occupied - 是否已被占用
 * @returns {boolean}
 */
export function shouldSpawnFlower(occupied) {
  if (occupied) return false;
  const rand = Math.random();
  return rand >= 0.05 && rand < 0.10;
}
