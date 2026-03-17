// src/world/entity-system/EntityManager.js

import { EntityDefinition } from './EntityDefinition.js';
import { CodeEntity } from './CodeEntity.js';
import { JsonEntity } from './JsonEntity.js';
import { Tree } from '../entities/Tree.js';
import { Cloud } from '../entities/Cloud.js';
import { Island } from '../entities/Island.js';
import { RealisticTree } from '../entities/RealisticTree.js';

/**
 * 实体管理器单例类
 * 负责实体的注册、生成决策和生成执行
 */
class EntityManagerClass {
  constructor() {
    this.registry = new Map();
    this.initialized = false;
  }

  /**
   * 注册实体定义
   * @param {string} id - 实体唯一标识符
   * @param {EntityDefinition} definition - 实体定义实例
   */
  register(id, definition) {
    if (!(definition instanceof EntityDefinition)) {
      throw new Error(`Definition must extend EntityDefinition, got: ${definition?.constructor?.name}`);
    }
    this.registry.set(id, definition);
  }

  /**
   * 获取实体定义
   * @param {string} id - 实体标识符
   * @returns {EntityDefinition|undefined} 实体定义
   */
  getEntity(id) {
    return this.registry.get(id);
  }

  /**
   * 获取所有注册的实体 ID
   * @returns {string[]} 实体 ID 列表
   */
  getAllEntityIds() {
    return Array.from(this.registry.keys());
  }

  /**
   * 根据生物群系获取可能的实体列表
   * @param {string} biome - 生物群系名称
   * @returns {EntityDefinition[]} 可能的实体定义列表
   */
  getEntitiesForBiome(biome) {
    const result = [];
    for (const def of this.registry.values()) {
      if (def.biomes.length === 0 || def.biomes.includes(biome)) {
        result.push(def);
      }
    }
    return result;
  }

  /**
   * 判断是否应该在此位置生成实体
   * 返回一个实体定义（如果有多个满足条件，返回第一个）
   * @param {number} wx - 世界 X 坐标
   * @param {number} wy - 世界 Y 坐标
   * @param {number} wz - 世界 Z 坐标
   * @param {string} biome - 生物群系名称
   * @param {number} seed - 世界种子
   * @param {string} [category] - 可选的实体分类过滤
   * @returns {{ id: string, definition: EntityDefinition } | null} 实体信息
   */
  shouldSpawn(wx, wy, wz, biome, seed, category = null) {
    // 确保实体已初始化
    if (!this.initialized) {
      this.initDefaultEntities();
    }

    // 遍历所有实体定义，检查是否应该生成
    for (const [id, def] of this.registry) {
      // 如果指定了分类，过滤不匹配的实体
      if (category && !def.categories.includes(category)) {
        continue;
      }

      if (def.shouldSpawn(wx, wy, wz, biome, seed)) {
        return { id, definition: def };
      }
    }

    return null;
  }

  /**
   * 执行实体生成
   * @param {string} id - 实体标识符
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {number} z - Z 坐标
   * @param {Object} chunk - 区块对象
   * @param {Object} dObj - 数据收集对象
   * @returns {Object|null} 生成结果 { blocks: [], entities: [] }
   */
  generate(id, x, y, z, chunk, dObj) {
    const def = this.registry.get(id);
    if (!def) {
      console.warn(`EntityManager.generate: Unknown entity "${id}"`);
      return null;
    }
    return def.generate(x, y, z, chunk, dObj);
  }

  /**
   * 获取实体的跨 Chunk 渲染距离
   * @param {string} id - 实体标识符
   * @returns {number} 渲染距离
   */
  getCrossChunkDist(id) {
    const def = this.registry.get(id);
    return def?.crossChunkDist || 8;
  }

  /**
   * 获取实体的分类标签
   * @param {string} id - 实体标识符
   * @returns {string[]} 分类标签列表
   */
  getCategories(id) {
    const def = this.registry.get(id);
    return def?.categories || [];
  }

  /**
   * 判断实体是否为固体（参与碰撞检测）
   * @param {string} id - 实体标识符
   * @returns {boolean} 是否为固体
   */
  isSolid(id) {
    const def = this.registry.get(id);
    return def?.isSolid ?? true;
  }

  /**
   * 预加载所有实体数据
   * @returns {Promise<void>}
   */
  async preloadAll() {
    const promises = [];
    for (const def of this.registry.values()) {
      if (def.type === 'json' && typeof def.preload === 'function') {
        promises.push(def.preload());
      }
    }
    await Promise.all(promises);
    console.log(`EntityManager: Preloaded ${promises.length} JSON entities`);
  }

  /**
   * 初始化所有默认实体注册
   * 按分类组织：trees、structures、decorations
   */
  initDefaultEntities() {
    if (this.initialized) return;

    this.initTrees();
    this.initStructures();
    this.initDecorations();
    this.initSpecial();

    this.initialized = true;
    console.log(`EntityManager: Registered ${this.registry.size} entities`);
  }

  /**
   * 注册树木类实体
   */
  initTrees() {
    // 普通树木（默认）
    this.register('tree_default', new CodeEntity({
      id: 'tree_default',
      biomes: ['PLAINS'],
      probability: 0.005,
      generateFn: (x, y, z, chunk, dObj) => Tree.generate(x, y, z, chunk, 'default', dObj),
      crossChunkDist: 8,
      categories: ['tree', 'decoration']
    }));

    // 森林树木（大型）
    this.register('tree_big', new CodeEntity({
      id: 'tree_big',
      biomes: ['FOREST'],
      probability: 0.036,  // 综合概率：0.04 * 0.9 * 0.9（去除 realistic tree 和 birch）
      generateFn: (x, y, z, chunk, dObj) => {
        const isYellow = Math.random() < 0.1;
        const leafType = isYellow ? 'yellow_leaves' : null;
        const isBirch = Math.random() < 0.1;
        const logType = isBirch ? 'birch_log' : null;
        Tree.generate(x, y, z, chunk, 'big', dObj, logType, leafType);
      },
      crossChunkDist: 8,
      categories: ['tree', 'forest']
    }));

    // 白桦树（JSON 加载）
    // 注意：需要在 StructureLoader 中注册 birchTree
    this.register('tree_birch', new JsonEntity({
      id: 'tree_birch',
      biomes: ['FOREST'],
      probability: 0.004,  // 0.04 * 0.9 * 0.1
      loader: null,  // 将在 initSpecial 中设置
      crossChunkDist: 8,
      categories: ['tree', 'forest']
    }));

    // 真实树木（RealisticTree，使用 instanced rendering）
    this.register('tree_realistic', new CodeEntity({
      id: 'tree_realistic',
      biomes: ['FOREST'],
      probability: 0.006,  // 0.04 * 0.15
      generateFn: (x, y, z, chunk, dObj) => {
        RealisticTree.generate(x, y, z, chunk, null, true);
      },
      crossChunkDist: 8,
      categories: ['tree', 'forest']
    }));

    // 杜鹃花树
    this.register('tree_azalea', new CodeEntity({
      id: 'tree_azalea',
      biomes: ['AZALEA'],
      probability: 0.045,
      generateFn: (x, y, z, chunk, dObj) => Tree.generate(x, y, z, chunk, 'azalea', dObj),
      crossChunkDist: 8,
      categories: ['tree', 'azalea']
    }));

    // 沼泽树
    this.register('tree_swamp', new CodeEntity({
      id: 'tree_swamp',
      biomes: ['SWAMP'],
      probability: 0.03,
      generateFn: (x, y, z, chunk, dObj) => Tree.generate(x, y, z, chunk, 'swamp', dObj),
      crossChunkDist: 8,
      categories: ['tree', 'swamp']
    }));

    // 天空树（由天空岛生成时调用，不在此处注册生成概率）
    this.register('tree_sky', new CodeEntity({
      id: 'tree_sky',
      biomes: [],  // 不直接生成，由 Island 调用
      probability: 0,
      generateFn: (x, y, z, chunk, dObj) => Tree.generate(x, y, z, chunk, 'skyTree', dObj),
      crossChunkDist: 8,
      categories: ['tree', 'sky']
    }));
  }

  /**
   * 注册结构类实体
   */
  initStructures() {
    // 普通房屋
    this.register('house', new CodeEntity({
      id: 'house',
      biomes: ['PLAINS'],
      probability: 0.001,
      generateFn: (x, y, z, chunk, dObj) => this._generateHouse(x, y, z, chunk, dObj),
      crossChunkDist: 5,
      categories: ['structure', 'building']
    }));

    // 丑陋小屋（JSON 加载）
    this.register('ugly_house', new JsonEntity({
      id: 'ugly_house',
      biomes: ['DESERT'],
      probability: 0.00008,
      loader: null,  // 将在 initSpecial 中设置
      crossChunkDist: 24,
      categories: ['structure', 'building', 'desert']
    }));

    // 坦克（JSON 加载）
    this.register('tank', new JsonEntity({
      id: 'tank',
      biomes: ['PLAINS'],
      probability: 0.0001,
      condition: (_wx, _wy, _wz, biome, _seed) => {
        // 只在草地上生成
        return biome === 'PLAINS';
      },
      loader: null,  // 将在 initSpecial 中设置
      crossChunkDist: 3,
      categories: ['structure', 'vehicle']
    }));

    // 沉船
    this.register('ship', new CodeEntity({
      id: 'ship',
      biomes: ['OCEAN'],
      probability: 0.001,
      condition: (_wx, wy, _wz, _biome, _seed) => {
        // 只在深海生成
        return wy < -6;
      },
      generateFn: (x, y, z, chunk, _dObj) => this._generateShip(x, y, z, chunk, _dObj),
      crossChunkDist: 5,
      categories: ['structure', 'vehicle', 'ocean']
    }));

    // 火星车
    this.register('rover', new CodeEntity({
      id: 'rover',
      biomes: ['DESERT'],
      probability: 0.0005,
      generateFn: (x, y, z, chunk, dObj, rovers) => {
        if (rovers) rovers.push({ x, y, z });
      },
      crossChunkDist: 3,
      categories: ['structure', 'vehicle', 'desert']
    }));

    // 炮塔（JSON 加载）- 海岛专用
    this.register('battery', new JsonEntity({
      id: 'battery',
      biomes: ['OCEAN'],
      probability: 0,  // 不由 shouldSpawn 生成，由海岛生成逻辑直接调用
      loader: null,  // 将在 initSpecial 中设置
      crossChunkDist: 8,
      categories: ['structure', 'island', 'battery']
    }));
  }

  /**
   * 注册装饰类实体
   */
  initDecorations() {
    // 云
    this.register('cloud', new CodeEntity({
      id: 'cloud',
      biomes: [],  // 云在所有生物群系都可以生成
      probability: 0,  // 云使用特殊的 shouldGenerateCloud 判断，不在此处生成
      generateFn: (x, y, z, chunk, dObj) => Cloud.generate(x, y, z, chunk, dObj),
      crossChunkDist: 8,
      categories: ['decoration', 'sky']
    }));

    // 云簇
    this.register('cloud_cluster', new CodeEntity({
      id: 'cloud_cluster',
      biomes: [],
      probability: 0,  // 云簇使用特殊逻辑生成
      generateFn: (x, y, z, chunk, dObj, size) => {
        Cloud.generateCluster(x, y, z, size || 30, chunk, dObj);
      },
      crossChunkDist: 8,
      categories: ['decoration', 'sky']
    }));

    // 天空岛
    this.register('island', new CodeEntity({
      id: 'island',
      biomes: [],
      probability: 0.08,  // 8% 概率
      generateFn: (x, y, z, chunk, dObj) => {
        const islandY = 40 + Math.floor(Math.random() * 30);
        Island.generate(x, islandY, z, chunk, dObj);
      },
      crossChunkDist: 16,
      categories: ['structure', 'sky']
    }));

    // 草丛
    this.register('short_grass', new CodeEntity({
      id: 'short_grass',
      biomes: ['PLAINS'],
      probability: 0.05,
      generateFn: (x, y, z, chunk, dObj) => {
        chunk.add(x, y, z, 'short_grass', dObj, false);
      },
      crossChunkDist: 1,
      isSolid: false,
      categories: ['decoration', 'plant']
    }));

    // 花朵
    this.register('flower', new CodeEntity({
      id: 'flower',
      biomes: ['PLAINS'],
      probability: 0.05,
      generateFn: (x, y, z, chunk, dObj) => {
        const flowerType = Math.random() < 0.33 ? 'allium' : 'flower';
        chunk.add(x, y, z, flowerType, dObj, false);
      },
      crossChunkDist: 1,
      isSolid: false,
      categories: ['decoration', 'plant']
    }));

    // 睡莲（沼泽）
    this.register('lilypad', new CodeEntity({
      id: 'lilypad',
      biomes: ['SWAMP'],
      probability: 0.08,
      condition: (_wx, wy, _wz, _biome, _seed) => wy < -2,  // 只在水面上生成
      generateFn: (x, _y, z, chunk, dObj) => {
        chunk.add(x, -1.5, z, 'lilypad', dObj, false);
      },
      crossChunkDist: 1,
      isSolid: false,
      categories: ['decoration', 'plant', 'swamp']
    }));

    // 仙人掌（沙漠）
    this.register('cactus', new CodeEntity({
      id: 'cactus',
      biomes: ['DESERT'],
      probability: 0.01,
      generateFn: (x, y, z, chunk, dObj) => {
        chunk.add(x, y, z, 'cactus', dObj, false);
      },
      crossChunkDist: 1,
      isSolid: false,
      categories: ['decoration', 'plant', 'desert']
    }));
  }

  /**
   * 注册特殊实体（需要外部依赖的）
   * 这些实体的 loader 需要在外部设置
   */
  initSpecial() {
    // 模因人（gun_man.glb）
    this.register('gun_man', new CodeEntity({
      id: 'gun_man',
      biomes: ['PLAINS'],
      probability: 0.0005,
      condition: (wx, _wy, wz, _biome, seed) => {
        // 使用确定性随机
        const spawnRand = Math.sin(wx * 12.9898 + wz * 78.233 + seed) * 43758.5453123;
        return (spawnRand - Math.floor(spawnRand)) < 0.0005;
      },
      generateFn: (x, y, z, chunk, _dObj, modGunMan) => {
        if (modGunMan) modGunMan.push({ x, y, z });
      },
      crossChunkDist: 3,
      categories: ['entity', 'mod']
    }));
  }

  /**
   * 设置 StructureLoader 实例
   * 用于 JsonEntity 的 loader 属性
   * @param {string} entityId - 实体 ID
   * @param {Object} loader - StructureLoader 实例
   */
  setLoader(entityId, loader) {
    const def = this.getEntity(entityId);
    if (def && def.type === 'json') {
      def.loader = loader;
    }
  }

  /**
   * 内部方法：生成普通房屋
   * @private
   */
  _generateHouse(x, y, z, chunk, dObj) {
    const wallMat = Math.random() < 0.33 ? 'bricks' : 'planks';
    // 地基
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        chunk.add(x + i, y - 1, z + j, 'stone', dObj);
      }
    }
    // 墙壁
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        if (Math.abs(i) === 2 || Math.abs(j) === 2) {
          if (i === 0 && j === 2) continue; // 门
          if ((i === -2 || i === 2) && j === 0) {
            // 窗户列
            chunk.add(x + i, y, z + j, wallMat, dObj);
            chunk.add(x + i, y + 1, z + j, 'glass_block', dObj);
            chunk.add(x + i, y + 2, z + j, wallMat, dObj);
          } else {
            for (let h = 0; h < 3; h++) {
              chunk.add(x + i, y + h, z + j, wallMat, dObj);
            }
          }
        }
      }
    }
    // 屋顶
    const roofMat = Math.random() < 0.5 ? 'dark_planks' : 'oak_planks';
    for (let h = 0; h < 3; h++) {
      for (let i = -2 + h; i <= 2 - h; i++) {
        for (let j = -2 + h; j <= 2 - h; j++) {
          chunk.add(x + i, y + 3 + h, z + j, roofMat, dObj);
        }
      }
    }
    // 屋脊
    for (let j = -1; j <= 1; j++) {
      chunk.add(x, y + 5, z + j, roofMat, dObj);
    }
    // 烟囱（33% 概率）
    if (Math.random() < 0.33) {
      chunk.add(x, y + 6, z, 'chimney', dObj, false);
    }
    // 内部物品
    chunk.add(x - 1, y, z - 1, 'bookbox', dObj, false);
    chunk.add(x + 1, y, z - 1, 'chest', dObj);
  }

  /**
   * 内部方法：生成沉船
   * @private
   */
  _generateShip(x, y, z, chunk, dObj) {
    // 船体
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 || Math.abs(dz) === 3) {
          chunk.add(x + dx, y + 1, z + dz, 'wood', dObj);
          chunk.add(x + dx, y + 2, z + dz, 'planks', dObj);
        } else {
          chunk.add(x + dx, y, z + dz, 'planks', dObj);
        }
      }
    }
    // 桅杆
    for (let i = 0; i < 5; i++) {
      chunk.add(x, y + i, z, 'wood', dObj);
    }
    // 宝箱
    chunk.add(x, y + 1, z + 2, 'chest', dObj);
  }
}

// 导出单例
export const EntityManager = new EntityManagerClass();
