/**
 * 实体系统重构 - 完成总结
 *
 * ## 已创建的文件
 *
 * ### 1. src/world/entities/EntityDefinition.js
 * 实体定义基类，包含：
 * - id, type, biomes, probability 等属性
 * - shouldSpawn() 方法用于生成决策
 * - generate() 方法用于执行生成
 *
 * ### 2. src/world/entities/CodeEntity.js
 * 代码实现实体子类，用于 Tree, Cloud, Island 等程序化生成的实体
 *
 * ### 3. src/world/entities/JsonEntity.js
 * JSON 加载实体子类，用于 UglyHouse, BirchTree, Tank 等数据驱动的实体
 *
 * ### 4. src/world/entities/EntityManager.js
 * 实体管理器单例，包含：
 * - register() 注册实体定义
 * - getEntity() 获取实体定义
 * - shouldSpawn() 生成决策
 * - generate() 执行生成
 * - getCrossChunkDist() 获取跨 Chunk 渲染距离
 * - initDefaultEntities() 初始化所有默认实体
 *
 * ### 5. src/world/entities/EntitySpawnUtils.js
 * 实体生成工具函数，用于 WorldWorker 中的确定性随机生成
 *
 * ## 注册的系统
 *
 * ### 树木类 (trees)
 * - tree_default: 普通树木 (PLAINS 生物群系)
 * - tree_big: 大型树木 (FOREST 生物群系)
 * - tree_birch: 白桦树 (FOREST 生物群系，JSON 加载)
 * - tree_realistic: 真实树木 (FOREST 生物群系，InstancedMesh)
 * - tree_azalea: 杜鹃花树 (AZALEA 生物群系)
 * - tree_swamp: 沼泽树 (SWAMP 生物群系)
 * - tree_sky: 天空树 (由天空岛生成)
 *
 * ### 结构类 (structures)
 * - house: 普通房屋 (PLAINS 生物群系)
 * - ugly_house: 丑陋小屋 (DESERT 生物群系，JSON 加载)
 * - tank: 坦克 (PLAINS 生物群系，JSON 加载)
 * - ship: 沉船 (深海，程序化生成)
 * - rover: 火星车 (DESERT 生物群系)
 *
 * ### 装饰类 (decorations)
 * - cloud: 云
 * - cloud_cluster: 云簇
 * - island: 天空岛
 * - short_grass: 草丛
 * - flower: 花朵
 * - lilypad: 睡莲 (SWAMP)
 * - cactus: 仙人掌 (DESERT)
 *
 * ### 特殊实体 (special)
 * - gun_man: 模因人 (PLAINS, 确定性随机)
 *
 * ## 使用示例
 *
 * ### 在主线程中初始化 EntityManager
 * ```javascript
 * import { EntityManager } from './world/entities/EntityManager.js';
 * import { structureLoaders } from './workers/StructureLoader.js';
 *
 * // 设置 JSON 加载器的引用
 * EntityManager.setLoader('ugly_house', structureLoaders.uglyHouse);
 * EntityManager.setLoader('tree_birch', structureLoaders.birchTree);
 * EntityManager.setLoader('tank', structureLoaders.tank);
 *
 * // 预加载所有结构数据
 * await EntityManager.preloadAll();
 * ```
 *
 * ### 在 WorldWorker 中使用（未来重构方向）
 * ```javascript
 * import { EntityManager } from '../world/entities/EntityManager.js';
 *
 * // 初始化实体
 * EntityManager.initDefaultEntities();
 *
 * // 设置 loader（需要从主线程传递）
 * EntityManager.setLoader('ugly_house', uglyHouseLoader);
 *
 * // 生成决策
 * const spawnInfo = EntityManager.shouldSpawn(wx, wy, wz, biome, seed);
 * if (spawnInfo) {
 *   const { id, definition } = spawnInfo;
 *   EntityManager.generate(id, wx, wy, wz, fakeChunk, dPlaceholder);
 *   structureQueue.push({
 *     centerX: wx, centerY: wy, centerZ: wz,
 *     type: id
 *   });
 * }
 * ```
 *
 * ## 扩展示例
 *
 * ### 添加一个新的房屋类型
 *
 * 1. 在 src/world/blockmods/ 目录下创建新的 JSON 文件
 * 2. 在 StructureLoader.js 中添加新的 loader
 * 3. 在 EntityManager.initStructures() 中注册：
 *
 * ```javascript
 * import { structureLoaders } from './StructureLoader.js';
 *
 * // 在 initStructures() 中添加：
 * this.register('mansion', new JsonEntity({
 *   id: 'mansion',
 *   biomes: ['FOREST'],
 *   probability: 0.00005,
 *   loader: structureLoaders.mansion,
 *   crossChunkDist: 32,
 *   categories: ['structure', 'building']
 * }));
 * ```
 *
 * ### 添加一个新的程序化生成的树
 *
 * ```javascript
 * import { MyCustomTree } from './MyCustomTree.js';
 *
 * // 在 initTrees() 中添加：
 * this.register('tree_custom', new CodeEntity({
 *   id: 'tree_custom',
 *   biomes: ['JUNGLE'],
 *   probability: 0.01,
 *   generateFn: (x, y, z, chunk, dObj) => {
 *     MyCustomTree.generate(x, y, z, chunk, dObj);
 *   },
 *   crossChunkDist: 8,
 *   categories: ['tree', 'jungle']
 * }));
 * ```
 *
 * ## 性能优化
 *
 * 1. **生物群系预过滤**: getEntitiesForBiome() 可以预先过滤出可能的实体
 * 2. **空间分区**: 未来可以添加空间分区优化遍历
 * 3. **延迟加载**: JSON 实体的数据在需要时才加载
 *
 * ## 兼容性
 *
 * - 保留了现有的 WorldWorker.js 逻辑
 * - 保留了现有的结构生成函数 (generateUglyHouse, generateTank, etc.)
 * - structureCenters 机制保持不变
 * - Face Culling 和 InstancedMesh 优化不受影响
 *
 * ## 未来工作
 *
 * 1. 将 WorldWorker.js 的硬编码逻辑迁移到 EntityManager
 * 2. 添加空间分区优化
 * 3. 支持实体的序列化/反序列化
 * 4. 添加实体事件系统（生成前/后钩子）
 */

// 此文件为文档文件，无实际代码
