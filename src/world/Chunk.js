// src/world/Chunk.js
/**
 * 区块管理器 - 负责区块的生成、渲染和管理
 * 使用 InstancedMesh 优化渲染性能，管理区块内的所有方块和实体
 */
import * as THREE from 'three';
import { materials } from '../core/materials/MaterialManager.js';
import { terrainGen } from './TerrainGen.js';
import { Cloud } from './entities/Cloud.js';
import { Tree } from './entities/Tree.js';
import { RealisticTree } from './entities/RealisticTree.js';
import { Island } from './entities/Island.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { persistenceService } from '../services/PersistenceService.js';

/** 区块尺寸 - 每个区块在X和Z方向上的方块数量 */
const CHUNK_SIZE = 16;

// 共享几何体定义 - 用于优化渲染性能，避免重复创建相同几何体

/**
 * 构建交叉平面几何体（用于花、藤蔓等植物）
 * 由两个垂直交叉的平面组成，形成十字形状
 * @param {number} offsetY - Y轴偏移，用于调整植物在地面上的高度
 * @returns {THREE.BufferGeometry} 合并后的交叉平面几何体
 */
function buildCrossGeo(offsetY = -0.25) {
  const p1 = new THREE.PlaneGeometry(0.7, 0.7);
  const p2 = new THREE.PlaneGeometry(0.7, 0.7);
  p2.rotateY(Math.PI / 2);
  const merged = BufferGeometryUtils.mergeGeometries([p1, p2]);
  merged.translate(0, offsetY, 0);
  return merged;
}
// 花的几何体（交叉平面，向下偏移0.25单位，使花朵看起来生长在地面上）
const geoFlower = buildCrossGeo(-0.25);
// 藤蔓的几何体（交叉平面，无偏移，使藤蔓看起来附着在方块上）
const geoVine = buildCrossGeo(0);

// 垂落叶片的几何体（顶部对齐到0.5以接触上方方块）
// 高度1.0 -> 半高0.5。需要的偏移：0.5 - 0.5 = 0
// const geoHanging = buildCrossGeo(0); // 未使用

/**
 * 睡莲几何体 - 一个旋转为水平方向的平面
 * 用于沼泽生物群系，浮在水面上
 */
const geoLily = (() => {
  const geo = new THREE.PlaneGeometry(0.8, 0.8);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.48, 0);
  return geo;
})();

/**
 * 仙人掌几何体 - 由主茎和多个分支组成的复杂几何体
 * 用于沙漠生物群系，模拟真实仙人掌的形状
 */
const geoCactus = (() => {
  const geoms = [];
  geoms.push(new THREE.BoxGeometry(0.65, 1, 0.65));
  const la = new THREE.BoxGeometry(0.25, 0.25, 0.25); la.translate(-0.4, 0.1, 0); geoms.push(la);
  const lau = new THREE.BoxGeometry(0.25, 0.4, 0.25); lau.translate(-0.4, 0.35, 0); geoms.push(lau);
  const ra = new THREE.BoxGeometry(0.25, 0.25, 0.25); ra.translate(0.4, -0.1, 0); geoms.push(ra);
  const rau = new THREE.BoxGeometry(0.25, 0.3, 0.25); rau.translate(0.4, 0.1, 0); geoms.push(rau);
  return BufferGeometryUtils.mergeGeometries(geoms);
})();

/** 烟囱几何体 - 一个略窄的圆柱体 */
const geoChimney = new THREE.CylinderGeometry(0.15, 0.15, 2, 8);

/**
 * 几何体映射表 - 将方块类型映射到对应的几何体
 */
const geomMap = {
  'flower': geoFlower,
  'short_grass': geoFlower,
  'allium': geoFlower,
  'vine': geoVine,
  'lilypad': geoLily,
  'cactus': geoCactus,
  'chimney': geoChimney,
  'default': new THREE.BoxGeometry(1, 1, 1)
};

/**
 * 区块类 - 负责单个区块的生成、管理和渲染
 * 使用 InstancedMesh 优化相同类型方块的渲染性能
 */
export class Chunk {
  /**
   * 创建区块实例
   * @param {number} cx - 区块的X坐标（区块坐标）
   * @param {number} cz - 区块的Z坐标（区块坐标）
   */
  constructor(cx, cz) {
    this.cx = cx;                    // 区块的X坐标（区块坐标）
    this.cz = cz;                    // 区块的Z坐标（区块坐标）
    this.group = new THREE.Group();  // Three.js 组，包含区块内所有网格
    this.keys = [];                  // 区块标识符（当前未使用）
    this.solidBlocks = new Set();    // 实心方块的集合，用于碰撞检测
    this.isReady = false;            // 区块是否已完成生成
    this.gen();                      // 生成区块内容
  }

  /**
   * 生成区块内容
   * 包括地形生成、植被生成、水体生成、天空岛生成等
   * 根据生物群系决定地形特征和植被类型
   */
  async gen() {
    // 0. 加载持久化增量数据
    const deltas = await persistenceService.getDeltas(this.cx, this.cz);
    this._tempDeltas = deltas; // 暂存以供 add() 方法使用

    // 初始化所有可能的类型数组，类似原始代码中的逻辑
    // d 对象用于按类型收集方块位置，以便后续批量创建 InstancedMesh
    const d = {};
    const allTypes = ['grass', 'dirt', 'stone', 'sand', 'wood', 'birch_log', 'planks', 'oak_planks', 'white_planks', 'obsidian', 'leaves', 'water', 'cactus',
      'flower', 'short_grass', 'allium', 'chest', 'bookbox', 'carBody', 'wheel', 'cloud', 'sky_stone', 'sky_grass',
      'sky_wood', 'sky_leaves', 'moss', 'azalea_log', 'azalea_leaves', 'azalea_flowers', 'swamp_water',
      'swamp_grass', 'vine', 'lilypad', 'diamond', 'gold', 'apple', 'gold_apple', 'god_sword', 'glass_block', 'glass_blink', 'gold_ore', 'calcite', 'bricks', 'chimney',
      'gold_block', 'emerald', 'amethyst', 'debris', 'iron', 'iron_ore'];
    for(const type of allTypes) {
      d[type] = [];
    }

    // 获取区块中心位置的生物群系，决定地形特征和植被类型
    const centerBiome = terrainGen.getBiome(this.cx * CHUNK_SIZE, this.cz * CHUNK_SIZE);

    // 遍历区块内的每个位置（16x16 网格）
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        // 将区块坐标转换为世界坐标
        const wx = this.cx * CHUNK_SIZE + x;
        const wz = this.cz * CHUNK_SIZE + z;

        // 生成该位置的地形高度
        const h = terrainGen.generateHeight(wx, wz, centerBiome);
        const wLvl = -2;  // 水位线高度

        // 根据高度判断是水下还是地表
        if (h < wLvl) {
          // 水下地形处理
          // 生成海底（沙子）
          this.add(wx, h, wz, 'sand', d);
          // 生成海底下方的沙子层（3层）
          for (let k = 1; k <= 3; k++) this.add(wx, h - k, wz, 'sand', d);

          // 不再循环生成水方块，水将由 Engine.js 中的全局平面渲染

          // 沼泽生物群系有8%的几率生成睡莲
          if (centerBiome === 'SWAMP' && Math.random() < 0.08) {
            this.add(wx, wLvl + 0.1, wz, 'lilypad', d, false); // 睡莲位置稍微调高一点
          }
          // 深水区有0.3%的几率生成沉船结构（水深低于-6时）
          if (h < -6 && Math.random() < 0.003) {
            this.structure('ship', wx, h + 1, wz, d);
          }
        } else {
          // 地表地形处理
          // 根据生物群系决定地表和地下方块类型
          let surf = 'grass', sub = 'dirt';  // 默认：草方块和泥土
          if (centerBiome === 'DESERT') { surf = 'sand'; sub = 'sand'; }      // 沙漠：沙子
          if (centerBiome === 'AZALEA') { surf = 'moss'; sub = 'dirt'; }      // 杜鹃花森林：苔藓和泥土
          if (centerBiome === 'SWAMP') { surf = 'swamp_grass'; sub = 'dirt'; } // 沼泽：沼泽草和泥土

          // 生成地表方块和地下方块
          this.add(wx, h, wz, surf, d);          // 地表方块
          this.add(wx, h - 1, wz, sub, d);       // 地表下方第一层（泥土或沙子）
          for (let k = 2; k <= 12; k++) {
            // 10% 的几率将石头替换为黄金矿石
            const blockType = Math.random() < 0.1 ? 'gold_ore' : 'stone';
            this.add(wx, h - k, wz, blockType, d);
          }

          // 植被生成 - 根据生物群系决定植物类型和生成概率
          if (centerBiome === 'FOREST') {
            // 森林生物群系：5%的几率生成树木
            if (Math.random() < 0.05) {
              try {
                if (Math.random() < 0.15) { // 15%的几率生成真实感树木
                  RealisticTree.generate(wx, h + 1, wz, this, null); // 真实树木不使用桦木替换
                } else {
                  const isBirch = Math.random() < 0.1; // 10% 的几率生成桦木树干
                  const logType = isBirch ? 'birch_log' : null;
                  Tree.generate(wx, h + 1, wz, this, 'big', d, logType);  // 85%的几率生成大型树木，且支持桦木替换
                }
              } catch (e) {
                console.error("Tree generation failed at", wx, wz, e);
              }
            }
          } else if (centerBiome === 'AZALEA') {
            // 杜鹃花森林：6%的几率生成杜鹃花树
            if (Math.random() < 0.06) Tree.generate(wx, h + 1, wz, this, 'azalea', d);
          } else if (centerBiome === 'SWAMP') {
            // 沼泽：3%的几率生成沼泽树
            if (Math.random() < 0.03) Tree.generate(wx, h + 1, wz, this, 'swamp', d);
          } else if (centerBiome === 'DESERT') {
            // 沙漠：1%的几率生成仙人掌
            if (Math.random() < 0.01) this.add(wx, h + 1, wz, 'cactus', d);
            // 0.1%的几率生成火星车结构
            if (Math.random() < 0.001) this.structure('rover', wx, h + 1, wz, d);
          } else {
            // 其他生物群系（平原等）：
            // 0.5%的几率生成默认树木
            if (Math.random() < 0.005) {
              Tree.generate(wx, h + 1, wz, this, 'default', d);
            }
            const randPlant = Math.random();
            if (randPlant < 0.05) { // 生成草的几率
              this.add(wx, h + 1, wz, 'short_grass', d, false);
            } else if (randPlant < 0.10) { // 生成花的几率
              // 1/3 的几率生成紫色小花 (allium)
              const flowerType = Math.random() < 0.33 ? 'allium' : 'flower';
              this.add(wx, h + 1, wz, flowerType, d, false);
            }
            // 0.1%的几率生成房屋结构
            if (Math.random() < 0.001) this.structure('house', wx, h + 1, wz, d);
          }
        }

        // 根据地形生成器的判断决定是否生成云
        if (terrainGen.shouldGenerateCloud(wx, wz)) {
          Cloud.generate(wx, 55, wz, this, d);  // 云生成在Y=55高度
        }
      }
    }

    // 天空岛生成 - 8%的几率在当前区块生成天空岛
    if (Math.random() < 0.08) {
      const islandY = 40 + Math.floor(Math.random() * 30);  // 随机高度在40-70之间
      const centerWx = this.cx * CHUNK_SIZE + 8;           // 区块中心世界坐标X
      const centerWz = this.cz * CHUNK_SIZE + 8;           // 区块中心世界坐标Z
      Island.generate(centerWx, islandY, centerWz, this, d);
    }

    // 叠加持久化修改 (优化后的逻辑：在生成过程中通过 add() 自动过滤，此处仅负责添加新增块)
    for (const [blockKey, delta] of deltas) {
      if (delta.type !== 'air') {
        const [bx, by, bz] = blockKey.split(',').map(Number);
        if (!d[delta.type]) d[delta.type] = [];
        d[delta.type].push({ x: bx, y: by, z: bz });

        // 简单逻辑：假设所有非 air 持久化块都是实心的（除非是花/水等，遵循 add 逻辑）
        if (!['water', 'swamp_water', 'cloud', 'vine', 'lilypad', 'flower', 'short_grass'].includes(delta.type)) {
          this.solidBlocks.add(blockKey);
        }
      }
    }

    // 清理临时增量缓存
    this._tempDeltas = null;

    // 构建所有网格 - 将收集的方块位置转换为 Three.js 网格
    this.buildMeshes(d);
    this.isReady = true; // 标记准备就绪
  }

  /**
    * 添加方块到区块中
    * @param {number} x - 世界坐标X
    * @param {number} y - 世界坐标Y
    * @param {number} z - 世界坐标Z
    * @param {string} type - 方块类型（如 'dirt', 'stone', 'wood' 等）
    * @param {Object} dObj - 数据收集对象（用于批量构建网格），如果为null则不收集
    * @param {boolean} solid - 是否为实心方块（影响碰撞检测）
    */
  add(x, y, z, type, dObj = null, solid = true) {
    // 生成方块的唯一键（用于碰撞检测和持久化覆盖检查）
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;

    // 如果该位置在当前区块生成期间有持久化增量覆盖，则跳过原始生成逻辑
    if (this._tempDeltas && this._tempDeltas.has(key)) return;

    // 如果提供了数据收集对象，将方块位置按类型分类存储
    if (dObj) {
      if (!dObj[type]) dObj[type] = [];
      dObj[type].push({ x, y, z });
    }
    // 如果是实心方块，添加到实心方块集合中
    if (solid) {
      this.solidBlocks.add(key);
    }
  }

  /**
   * 生成预制结构
   * @param {string} type - 结构类型：'house'（房屋）、'rover'（火星车）、'ship'（沉船）
   * @param {number} x - 结构中心世界坐标X
   * @param {number} y - 结构基础高度世界坐标Y
   * @param {number} z - 结构中心世界坐标Z
   * @param {Object} dObj - 数据收集对象
   */
  structure(type, x, y, z, dObj) {
    if (type === 'house') {
      // 房屋结构：5x5地基 + 3层高墙壁 + 金字塔形屋顶 + 内部家具

      // 决定墙体材质：1/3 概率为砖块，否则为木板
      const wallMat = Math.random() < 0.33 ? 'bricks' : 'planks';

      // 1. 地基：5x5的石头地基
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) this.add(x + i, y - 1, z + j, 'stone', dObj);

      // 2. 墙壁：外围5x5的墙，高度3层
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        if (Math.abs(i) === 2 || Math.abs(j) === 2) {  // 只在外围生成
          if (i === 0 && j === 2) continue;  // 留出前门位置
          if ((i === -2 || i === 2) && j === 0) {
            // 侧面中间位置：第一层和第三层是墙体材质，中间（第二层）是玻璃窗户
            this.add(x + i, y, z + j, wallMat, dObj);
            this.add(x + i, y + 1, z + j, 'glass_block', dObj, false); // 玻璃非实心方块，便于透视
            this.add(x + i, y + 2, z + j, wallMat, dObj);
          } else {
            // 其他位置：生成完整的3层墙壁
            for (let h = 0; h < 3; h++) this.add(x + i, y + h, z + j, wallMat, dObj);
          }
        }
      }

      // 3. 金字塔形屋顶：50% 概率使用深色木板，否则使用大橡木木板
      const roofMat = Math.random() < 0.5 ? 'dark_planks' : 'oak_planks';
      const roofBlocks = []; // 记录屋顶方块位置
      for (let h = 0; h < 3; h++) {
        for (let i = -2 + h; i <= 2 - h; i++) {
          for (let j = -2 + h; j <= 2 - h; j++) {
            this.add(x + i, y + 3 + h, z + j, roofMat, dObj);
            // 如果不是被上一层完全覆盖的内部方块，则可能是暴露的
            if (h === 2 || Math.abs(i) === 2 - h || Math.abs(j) === 2 - h) {
              roofBlocks.push({ x: x + i, y: y + 3 + h, z: z + j });
            }
          }
        }
      }

      // 4. 屋顶顶部：一行同样的木板，确保顶部平整
      for (let j = -1; j <= 1; j++) {
        this.add(x, y + 5, z + j, roofMat, dObj);
        roofBlocks.push({ x: x, y: y + 5, z: z + j });
      }

      // 5. 烟囱：1/3 的几率生成烟囱，随机选择一个非最高点的暴露屋顶方块上方放置
      if (Math.random() < 0.33) {
        const lowerRoofBlocks = roofBlocks.filter(b => b.y < y + 5);
        const targetPool = lowerRoofBlocks.length > 0 ? lowerRoofBlocks : roofBlocks;
        if (targetPool.length > 0) {
          const pos = targetPool[Math.floor(Math.random() * targetPool.length)];
          this.add(pos.x, pos.y + 1, pos.z, 'chimney', dObj, false);
        }
      }

      // 6. 内部家具：床和箱子
      this.add(x - 1, y, z - 1, 'bookbox', dObj, false);
      this.add(x + 1, y, z - 1, 'chest', dObj);
    } else if (type === 'rover') {
      // 火星车结构：4个轮子 + 车身 + 顶部箱子

      // 1. 四个轮子：放置在四个角
      this.add(x - 1, y, z - 1, 'wheel', dObj);
      this.add(x + 1, y, z - 1, 'wheel', dObj);
      this.add(x - 1, y, z + 1, 'wheel', dObj);
      this.add(x + 1, y, z + 1, 'wheel', dObj);

      // 2. 车身：3x4的汽车车身，高度1层
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 2; dz++) this.add(x + dx, y + 1, z + dz, 'carBody', dObj);

      // 3. 顶部箱子：放置在车身中央上方
      this.add(x, y + 2, z, 'chest', dObj);
    } else if (type === 'ship') {
      // 沉船结构：船体 + 船舷 + 桅杆 + 箱子

      // 1. 船体：5x7的木板船底和船舷
      for (let dz = -3; dz <= 3; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 || Math.abs(dz) === 3) {
          // 船舷：外围用木块，高度2层
          this.add(x + dx, y + 1, z + dz, 'wood', dObj);
          this.add(x + dx, y + 2, z + dz, 'planks', dObj);
        } else {
          // 船底：内部用木板，高度1层
          this.add(x + dx, y, z + dz, 'planks', dObj);
        }
      }

      // 2. 桅杆：中央的5层高木柱
      for (let i = 0; i < 5; i++) this.add(x, y + i, z, 'wood', dObj);

      // 3. 箱子：放置在船头位置
      this.add(x, y + 1, z + 2, 'chest', dObj);
    }
  }

  /**
   * 构建所有网格 - 将收集的方块位置转换为 Three.js 网格
   * 使用 InstancedMesh 优化相同类型方块的渲染性能
   * @param {Object} d - 数据收集对象，包含按类型分类的方块位置数组
   */
  buildMeshes(d) {
    // 创建一个虚拟对象用于计算实例矩阵
    const dummy = new THREE.Object3D();

    // 遍历每种方块类型，为每种类型创建一个 InstancedMesh
    for (const type in d) {
      if (d[type].length === 0) continue;  // 跳过没有方块的类型

      // 获取几何体和材质
      const geometry = geomMap[type] || geomMap['default'];  // 使用默认几何体如果未找到
      const material = materials.getMaterial(type);          // 从材质管理器获取材质
      const mesh = new THREE.InstancedMesh(geometry, material, d[type].length);  // 创建实例网格

      // 存储用户数据，包含方块类型信息
      mesh.userData = { type: type };
      // 如果是箱子，初始化箱子状态对象
      if (type === 'chest') {
        mesh.userData.chests = {};
      }

    // 为每个实例设置位置矩阵
    d[type].forEach((pos, i) => {
      dummy.position.set(pos.x, pos.y, pos.z);  // 设置虚拟对象位置
      dummy.updateMatrix();                     // 更新变换矩阵
      mesh.setMatrixAt(i, dummy.matrix);        // 设置实例矩阵
      // 如果是箱子，初始化该箱子的状态
      if (type === 'chest') {
        mesh.userData.chests[i] = { open: false };
      }
    });

    // 重要：设置完所有实例矩阵后标记需要更新
    mesh.instanceMatrix.needsUpdate = true;

      // 设置阴影：半透明和特殊模型不投射/接收阴影
      if(!['water','swamp_water','cloud','vine','lilypad','flower','short_grass'].includes(type)) {
        mesh.castShadow = true;    // 投射阴影
        mesh.receiveShadow = true; // 接收阴影
      }

      // 将网格添加到区块组中
      this.group.add(mesh);
    }
  }

  /**
   * 清理资源 - 释放几何体和材质，防止内存泄漏
   * 在区块不再需要时调用
   */
  dispose() {
    // 遍历组中的所有子对象
    this.group.children.forEach(c => {
      // 清理几何体
      if (c.geometry) c.geometry.dispose();
      // 只清理非实例网格的材质，因为实例网格共享材质
      if (!c.isInstancedMesh && c.material) {
        if (Array.isArray(c.material)) {
          // 如果是材质数组，清理每个材质
          c.material.forEach(m => m.dispose());
        } else {
          // 如果是单个材质，直接清理
          c.material.dispose();
        }
      }
    });
    // 清空组，移除所有子对象
    this.group.clear();
  }

  /**
   * 动态添加单个方块（与批量生成相对）
   * 用于游戏运行时玩家放置方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string} type - 方块类型
   */
  /**
   * 动态添加单个方块（与批量生成相对）
   * 用于游戏运行时玩家放置方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string} type - 方块类型
   */
  addBlockDynamic(x, y, z, type) {
    // 检查并移除该位置已有的动态方块（实现位移/替换逻辑）
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (!child.isInstancedMesh &&
          Math.round(child.position.x) === Math.round(x) &&
          Math.round(child.position.y) === Math.round(y) &&
          Math.round(child.position.z) === Math.round(z)) {
        if (child.geometry) child.geometry.dispose();
        if (child.material && !child.isInstancedMesh) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
        this.group.remove(child);
      }
    }

    // 添加到实心方块集合（用于碰撞检测）
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    if (!['water', 'swamp_water', 'cloud', 'vine', 'lilypad', 'flower', 'short_grass'].includes(type)) {
      this.solidBlocks.add(key);
    } else {
      this.solidBlocks.delete(key);
    }

    if (type === 'air') return; // 如果是空气，则只负责移除

    // 获取几何体和材质
    const geometry = geomMap[type] || geomMap['default'];
    const material = materials.getMaterial(type);
    // 创建单个网格
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);                  // 设置位置
    mesh.userData = { type: type };              // 存储方块类型

    // 设置阴影
    if(!['water','swamp_water','cloud','vine','lilypad','flower','short_grass'].includes(type)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    // 添加到区块组中
    this.group.add(mesh);
  }

  /**
   * 移除方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   */
  removeBlock(x, y, z) {
    // 从实心方块集合中移除（碰撞检测）
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    this.solidBlocks.delete(key);
    // 记录持久化变更
    persistenceService.recordChange(x, y, z, 'air');
    // 移除可能存在的动态方块
    this.addBlockDynamic(x, y, z, 'air');
  }
}
