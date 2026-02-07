// src/core/materials/MaterialManager.js
// 材质管理器，负责加载、缓存和创建 Three.js 材质
// 支持纹理预加载、程序化纹理生成和材质定义注册

import * as THREE from 'three';
import { getBlockProperties } from '../../constants/BlockData.js';

/**
 * 材质管理器类，负责管理游戏中的所有材质
 * 提供材质注册、获取、纹理预加载和缓存功能
 */
export class MaterialManager {
  /**
   * 构造函数，初始化材质管理器
   */
  constructor() {
    this.materials = new Map();        // 已创建的材质缓存
    this.definitions = new Map();      // 材质定义注册表
    this.textureLoader = new THREE.TextureLoader(); // Three.js 纹理加载器
    this.textureCache = new Map();     // 纹理缓存
    this.defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff }); // 默认材质（洋红色，用于调试）
  }

  /**
   * 预加载纹理文件并缓存
   * @param {string[]} urls - 纹理文件的 URL 数组
   * @returns {Promise} 当所有纹理加载完成时解析的 Promise
   */
  preloadTextures(urls) {
    return Promise.all(urls.map(url =>
      this.textureLoader.loadAsync(url).then(texture => {
        // NearestFilter: 最近邻过滤，禁用插值，实现干净的像素风效果 (Minecraft 风格)
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        // 性能优化：禁用 Mipmaps 减少 GPU 显存占用，并避免在像素风材质上产生模糊效果
        texture.generateMipmaps = false;
        // SRGBColorSpace: 确保颜色在 WebGL2 中渲染正确，符合现代颜色工作流
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textureCache.set(url, texture); // 将加载完成的纹理存入缓存
      })
    ));
  }

  /**
   * 注册材质定义
   * @param {string} type - 材质类型标识符（如 'grass', 'stone'）
   * @param {Object} definition - 材质定义对象
   */
  registerMaterial(type, definition) {
    this.definitions.set(type, definition);
  }

  /**
   * 获取指定类型的材质（如果未创建则创建并缓存）
   * @param {string} type - 材质类型标识符
   * @returns {THREE.Material} Three.js 材质对象
   */
  getMaterial(type) {
    // 如果材质已缓存，直接返回
    if (this.materials.has(type)) {
      return this.materials.get(type);
    }

    // 获取材质定义
    const def = this.definitions.get(type);
    if (!def) {
      // console.warn(`Material definition not found for type: ${type}`);
      return this.defaultMaterial; // 返回默认材质
    }

    // 创建材质并缓存
    const mat = this._createMaterial(def, type);
    this.materials.set(type, mat);
    return mat;
  }

  /**
   * 根据材质定义创建 Three.js 材质（私有方法）
   * @param {Object} def - 材质定义对象
   * @param {string} type - 材质类型
   * @returns {THREE.Material} 创建的 Three.js 材质
   */
  _createMaterial(def, type) {
    // 根据配置判断是否允许使用 AO 阴影
    const props = getBlockProperties(type);
    const useAO = props.isAOEnabled;

    // 情况0：多面材质（用于立方体不同面使用不同材质）
    if (def.faces) {
      // Three.js BoxGeometry 面的顺序：px, nx, py, ny, pz, nz (0-5)
      // 对应关系：0: 正X面（东），1: 负X面（西），2: 正Y面（上），3: 负Y面（下），4: 正Z面（南），5: 负Z面（北）
      const mats = [];
      for (let i = 0; i < 6; i++) {
        const faceDef = def.faces[i] || def.faces.all || def;
        mats.push(this._createMaterial(faceDef, type));
      }
      return mats;
    }

    // 情况1：使用纹理URL（预加载的纹理文件）
    if (def.textureUrl) {
      let texture = this.textureCache.get(def.textureUrl);
      if (!texture) {
        console.warn(`Texture not preloaded: ${def.textureUrl}`);
        return this.defaultMaterial;
      }

      // 处理纹理重复（如果指定了repeat参数）
      if (def.repeat) {
        texture = texture.clone(); // 克隆纹理以避免修改缓存中的原始纹理
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(def.repeat[0], def.repeat[1]); // 设置纹理重复次数，[0]为U方向，[1]为V方向
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
      }

      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: def.transparent || false,
        opacity: def.opacity || 1,
        side: def.side || THREE.FrontSide,
        alphaTest: def.alphaTest || 0
      });
      if (useAO) this._applyShaderModifications(mat);
      return mat;
    }

    // 情况2：使用纹理生成器（程序化纹理）
    if (def.textureGenerator) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;  // 程序化纹理宽度：64像素
      canvas.height = 64; // 程序化纹理高度：64像素
      const ctx = canvas.getContext('2d');

      // 如果定义了颜色且fillBackground不为false，填充背景色
      if (def.color && def.fillBackground !== false) {
        ctx.fillStyle = def.color;
        ctx.fillRect(0, 0, 64, 64);
      }

      // 调用纹理生成器函数绘制纹理
      def.textureGenerator(ctx);

      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;

      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: def.transparent || false,
        opacity: def.opacity || 1,
        side: def.side || THREE.FrontSide,
        alphaTest: def.alphaTest || 0
      });
      if (useAO) this._applyShaderModifications(mat);
      return mat;
    }

    // 情况3：纯颜色材质（无纹理）
    const mat = new THREE.MeshStandardMaterial({
      color: def.color || 0xffffff,
      transparent: def.transparent || false,
      opacity: def.opacity || 1
    });
    if (useAO) this._applyShaderModifications(mat);
    return mat;
  }

  /**
   * 为材质注入 AO 着色器逻辑
   * @param {THREE.Material} material
   */
  _applyShaderModifications(material) {
    material.onBeforeCompile = (shader) => {
      // 顶点着色器修改
      shader.vertexShader = `
        attribute float aVertexId;
        attribute float aAoLow;
        attribute float aAoHigh;
        varying float vAo;
      ` + shader.vertexShader;

      // 台阶底部阴影
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        float getAo(float id, float low, float high) {
          float aoRaw;
          if (id < 12.0) { // 前12个顶点（0-11）的AO数据存储在low中，后12个顶点（12-23）存储在high中
            aoRaw = mod(floor(low / pow(4.0, id)), 4.0); // 每个顶点AO值用2位存储（0-3），4.0表示4种可能值
          } else {
            aoRaw = mod(floor(high / pow(4.0, id - 12.0)), 4.0);
          }
          return 1.0 - (3.0 - aoRaw) / 3.0 * 0.9; // 0.9 为阴影强度，3.0为最大AO值，将0-3映射到亮度系数
        }
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vAo = getAo(aVertexId, aAoLow, aAoHigh);
        `
      );

      // 片元着色器修改
      shader.fragmentShader = `
        varying float vAo;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        diffuseColor.rgb *= vAo;
        `
      );
    };
  }
}

/**
 * 导出的全局材质管理器实例
 */
export const materials = new MaterialManager();

/**
 * 异步初始化材质，包括纹理预加载
 * @returns {Promise} 当所有纹理加载完成时解析的Promise
 */
export async function initializeMaterials() {
  const textureUrls = [
    './src/world/assets/textures/oak_leaves_branch_medium.png',
    './src/world/assets/textures/azalea_leaves.png',
    './src/world/assets/textures/flowering_azalea_leaves.png',
    './src/world/assets/textures/grass_carried.png',
    './src/world/assets/textures/grass_side_carried.png',
    './src/world/assets/textures/moss_block.png',
    './src/world/assets/textures/planks_birch.png',
    './src/world/assets/textures/dark_planks.png',
    './src/world/assets/textures/stone_andesite.png',
    './src/world/assets/textures/stone.png',
    './src/world/assets/textures/sand.png',
    './src/world/assets/textures/sand_side.png',
    './src/world/assets/textures/dirt.png',
    './src/world/assets/textures/dirt_podzol_side.png',
    './src/world/assets/textures/dirt_podzol_top.png',
    './src/world/assets/textures/stone_diorite.png',
    './src/world/assets/textures/log_big_oak.png',
    './src/world/assets/textures/log_big_oak_top.png',
    './src/world/assets/textures/leaves.png',
    './src/world/assets/textures/box_side.png',
    './src/world/assets/textures/box_top.png',
    './src/world/assets/textures/box_face.png',
    './src/world/assets/textures/Bookshelf_texture_JE2_BE2.png',
    './src/world/assets/textures/Bone_Block_side_texture_JE2_BE2.png',
    './src/world/assets/textures/Bone_Block_top_texture_JE2_BE2.png',
    './src/world/assets/textures/double_plant_grass_carried.png',
    './src/world/assets/textures/Glass.png',
    './src/world/assets/textures/Deepslate_Gold.png',
    './src/world/assets/textures/Bricks.png',
    './src/world/assets/textures/flower_Allium.png',
    './src/world/assets/textures/Cobblestone.png',
    './src/world/assets/textures/Blue_Wood_Planks.png',
    './src/world/assets/textures/End_Stone.png',
    './src/world/assets/textures/Green_Wood_Planks.png',
    './src/world/assets/textures/Hay_Bale.png',
    './src/world/assets/textures/Hay_Bale_top.png',
    './src/world/assets/textures/Mossy_Cobblestone.png',
    './src/world/assets/textures/Mossy_Cobblestone_side.png',
    './src/world/assets/textures/Oak_Planks.png',
    './src/world/assets/textures/White_Wood_Planks.png',
    './src/world/assets/textures/Birch_Log_top.png',
    './src/world/assets/textures/Birch_Log_side.png',
    './src/world/assets/textures/Obsidian.png',
    './src/world/assets/textures/diamond.png',
    './src/world/assets/textures/gold.png',
    './src/world/assets/textures/glass_blink.png',
    './src/world/assets/textures/gold_block.png',
    './src/world/assets/textures/emerald.png',
    './src/world/assets/textures/amethyst.png',
    './src/world/assets/textures/Ancient_Debris_top.png',
    './src/world/assets/textures/Ancient_Debris_side.png',
    './src/world/assets/textures/iron.png',
    './src/world/assets/textures/Iron_Ore.png',
    './src/world/assets/textures/leaves_yellow.png',
    './src/world/assets/textures/tnt_side.png',
    './src/world/assets/textures/tnt_top.png'
  ];
  await materials.preloadTextures(textureUrls); // 预加载纹理
}

/**
 * 创建带有噪点纹理的材质定义辅助函数
 * @param {string} col - 材质基础颜色（CSS颜色字符串）
 * @param {number} op - 材质不透明度（默认1）
 * @returns {Object} 材质定义对象
 */
function mkMat(col, op=1) {
  return {
    color: col,
    opacity: op,
    transparent: op < 1, // 当不透明度小于1时启用透明
    textureGenerator: (ctx) => {
      // 添加随机噪点以增加纹理细节
      for(let i=0;i<100;i++){
        ctx.fillStyle=`rgba(0,0,0,${Math.random()*0.15})`; // 黑色噪点，随机透明度
        ctx.fillRect(Math.random()*64,Math.random()*64,2,2); // 随机位置绘制2x2像素
      }
    }
  };
}

/**
 * 创建带有细节绘图的材质定义辅助函数
 * @param {string} baseCol - 基础背景颜色（CSS颜色字符串）
 * @param {string} detailCol - 细节绘图颜色（CSS颜色字符串）
 * @param {boolean} isTransparent - 是否为透明材质（默认false）
 * @param {function} drawFunc - 自定义绘图函数，接收CanvasRenderingContext2D作为参数
 * @returns {Object} 材质定义对象
 */
function mkDetailMat(baseCol, detailCol, isTransparent=false, drawFunc) {
  return {
    color: baseCol,
    transparent: true, // 总是启用透明，因为可能有细节绘图
    side: isTransparent ? THREE.DoubleSide : THREE.FrontSide, // 透明材质需要双面渲染
    alphaTest: 0.5, // 设置alpha测试阈值
    fillBackground: !isTransparent, // 非透明材质填充背景色
    textureGenerator: (ctx) => {
      ctx.fillStyle = detailCol; // 设置细节绘图颜色
      drawFunc(ctx); // 调用自定义绘图函数
    }
  };
}

// ============================================
// 默认材质注册
// ============================================

// 基础方块材质
const grassSide = { textureUrl: './src/world/assets/textures/grass_side_carried.png' };
const grassTop = { textureUrl: './src/world/assets/textures/grass_carried.png' };
const grassBottom = mkMat('#559944');

materials.registerMaterial('grass', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: grassSide,   // 东面：草地侧面
    1: grassSide,   // 西面：草地侧面
    2: grassTop,    // 上面：草地顶部
    3: grassBottom, // 下面：草地底部（泥土色）
    4: grassSide,   // 南面：草地侧面
    5: grassSide    // 北面：草地侧面
  }
});

const dirtSide = { textureUrl: './src/world/assets/textures/dirt.png' };
const dirtTopBottom = { textureUrl: './src/world/assets/textures/dirt_podzol_top.png' };
materials.registerMaterial('dirt', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: dirtSide,       // 东面：泥土侧面
    1: dirtSide,       // 西面：泥土侧面
    2: dirtTopBottom,  // 上面：泥土顶部
    3: dirtTopBottom,  // 下面：泥土底部
    4: dirtSide,       // 南面：泥土侧面
    5: dirtSide        // 北面：泥土侧面
  }
}); // 土

const stoneSide1 = { textureUrl: './src/world/assets/textures/stone.png' };
const stoneSide = { textureUrl: './src/world/assets/textures/stone_diorite.png' };
const stoneTopBottom = { textureUrl: './src/world/assets/textures/stone_andesite.png' };
materials.registerMaterial('stone', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: stoneSide,       // 东面：石头侧面（闪长岩）
    1: stoneSide,       // 西面：石头侧面（闪长岩）
    2: stoneTopBottom,  // 上面：石头顶部（安山岩）
    3: stoneTopBottom,  // 下面：石头底部（安山岩）
    4: stoneSide1,      // 南面：石头侧面（普通石头）
    5: stoneSide1       // 北面：石头侧面（普通石头）
  }
}); // 石头

materials.registerMaterial('gold_ore', {
  textureUrl: './src/world/assets/textures/Deepslate_Gold.png'
}); // 黄金矿石

materials.registerMaterial('bricks', {
  textureUrl: './src/world/assets/textures/Bricks.png'
}); // 砖块

materials.registerMaterial('cobblestone', {
  textureUrl: './src/world/assets/textures/Cobblestone.png'
}); // 鹅卵石

materials.registerMaterial('obsidian', {
  textureUrl: './src/world/assets/textures/Obsidian.png'
}); // 黑曜石

materials.registerMaterial('marble', mkMat('#F2F0E6')); // 大理石

materials.registerMaterial('dark_planks', {
  textureUrl: './src/world/assets/textures/dark_planks.png'
}); // 深木板

materials.registerMaterial('mossy_stone', {
  textureUrl: './src/world/assets/textures/Mossy_Cobblestone.png'
}); // 苔藓石

materials.registerMaterial('blue_planks', {
  textureUrl: './src/world/assets/textures/Blue_Wood_Planks.png'
}); // 蓝色木板

materials.registerMaterial('end_stone', {
  textureUrl: './src/world/assets/textures/End_Stone.png'
}); // 末端石头

materials.registerMaterial('green_planks', {
  textureUrl: './src/world/assets/textures/Green_Wood_Planks.png'
}); // 绿色木板

const hayBaleSide = { textureUrl: './src/world/assets/textures/Hay_Bale.png' };
const hayBaleTopBottom = { textureUrl: './src/world/assets/textures/Hay_Bale_top.png' };
materials.registerMaterial('hay_bale', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: hayBaleSide,      // 东面：干草堆侧面
    1: hayBaleSide,      // 西面：干草堆侧面
    2: hayBaleTopBottom, // 上面：干草堆顶部
    3: hayBaleTopBottom, // 下面：干草堆底部
    4: hayBaleSide,      // 南面：干草堆侧面
    5: hayBaleSide       // 北面：干草堆侧面
  }
}); // 干草堆

const sandSide = { textureUrl: './src/world/assets/textures/sand_side.png' };
const sandTopBottom = { textureUrl: './src/world/assets/textures/sand.png' };
materials.registerMaterial('sand', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: sandSide,       // 东面：沙地侧面
    1: sandSide,       // 西面：沙地侧面
    2: sandTopBottom,  // 上面：沙地顶部
    3: sandTopBottom,  // 下面：沙地底部
    4: sandSide,       // 南面：沙地侧面
    5: sandSide        // 北面：沙地侧面
  }
}); // 沙地

const woodSide = { textureUrl: './src/world/assets/textures/log_big_oak.png' };
const woodTopBottom = { textureUrl: './src/world/assets/textures/log_big_oak_top.png' };
materials.registerMaterial('wood', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: woodSide,       // 东面：木头侧面（树干纹理）
    1: woodSide,       // 西面：木头侧面（树干纹理）
    2: woodTopBottom,  // 上面：木头顶部（年轮纹理）
    3: woodTopBottom,  // 下面：木头底部（年轮纹理）
    4: woodSide,       // 南面：木头侧面（树干纹理）
    5: woodSide        // 北面：木头侧面（树干纹理）
  }
}); // 木头

const birchLogSide = { textureUrl: './src/world/assets/textures/Birch_Log_side.png' };
const birchLogTopBottom = { textureUrl: './src/world/assets/textures/Birch_Log_top.png' };
materials.registerMaterial('birch_log', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: birchLogSide,       // 东面：桦木树干侧面
    1: birchLogSide,       // 西面：桦木树干侧面
    2: birchLogTopBottom,  // 上面：桦木树干顶部
    3: birchLogTopBottom,  // 下面：桦木树干底部
    4: birchLogSide,       // 南面：桦木树干侧面
    5: birchLogSide        // 北面：桦木树干侧面
  }
}); // 桦木树干

materials.registerMaterial('planks', { textureUrl: './src/world/assets/textures/planks_birch.png' }); // 木板
materials.registerMaterial('oak_planks', { textureUrl: './src/world/assets/textures/Oak_Planks.png' }); // 大橡木木板
materials.registerMaterial('white_planks', { textureUrl: './src/world/assets/textures/White_Wood_Planks.png' }); // 白色木板
materials.registerMaterial('glass_block', {
  textureUrl: './src/world/assets/textures/Glass.png',
  transparent: true,
  alphaTest: 0.1,
  // side: THREE.DoubleSide
}); // 玻璃
materials.registerMaterial('glass_blink', {
  textureUrl: './src/world/assets/textures/glass_blink.png',
  transparent: true,
  alphaTest: 0.1,
  // side: THREE.DoubleSide
}); // 闪闪玻璃
materials.registerMaterial('leaves', {
  textureUrl: './src/world/assets/textures/leaves.png',
  transparent: true,
  alphaTest: 0.3
}); // 树叶
materials.registerMaterial('water', mkMat('#205099', 0.6)); // 水
materials.registerMaterial('swamp_water', mkMat('#2F4F4F', 0.7)); // 沼泽水

const swampGrassSide = { textureUrl: './src/world/assets/textures/Mossy_Cobblestone_side.png' };
const swampGrassTopBottom = mkMat('#4C5E34');
materials.registerMaterial('swamp_grass', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: swampGrassSide,       // 东面：沼泽草侧面（苔藓石侧面纹理）
    1: swampGrassSide,       // 西面：沼泽草侧面（苔藓石侧面纹理）
    2: swampGrassTopBottom,  // 上面：沼泽草顶部（深绿色）
    3: swampGrassTopBottom,  // 下面：沼泽草底部（深绿色）
    4: swampGrassSide,       // 南面：沼泽草侧面（苔藓石侧面纹理）
    5: swampGrassSide        // 北面：沼泽草侧面（苔藓石侧面纹理）
  }
}); // 沼泽草

materials.registerMaterial('cactus', mkMat('#2E8B57')); // 仙人掌
const bookboxFront = { textureUrl: './src/world/assets/textures/Bookshelf_texture_JE2_BE2.png' };
const bookboxSide = { textureUrl: './src/world/assets/textures/Bone_Block_side_texture_JE2_BE2.png' };
const bookboxTopBottom = { textureUrl: './src/world/assets/textures/Bone_Block_top_texture_JE2_BE2.png' };
materials.registerMaterial('bookbox', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: bookboxSide,       // 东面：书架侧面（骨块侧面纹理）
    1: bookboxSide,       // 西面：书架侧面（骨块侧面纹理）
    2: bookboxTopBottom,  // 上面：书架顶部（骨块顶部纹理）
    3: bookboxTopBottom,  // 下面：书架底部（骨块顶部纹理）
    4: bookboxFront,      // 南面：书架正面（书架纹理，有书本）
    5: bookboxSide        // 北面：书架侧面（骨块侧面纹理）
  }
}); // 书架

materials.registerMaterial('carBody', mkMat('#FFD700')); // 汽车
materials.registerMaterial('wheel', mkMat('#222222')); // 轮子
materials.registerMaterial('cloud', mkMat('#FFFFFF', 1)); // 云
materials.registerMaterial('sky_stone', mkMat('#DDDDDD')); // 天空石头
materials.registerMaterial('sky_grass', mkMat('#88CCFF')); // 天空草
materials.registerMaterial('sky_wood', mkMat('#DDA0DD')); // 天空木头
materials.registerMaterial('sky_leaves', mkMat('#FF69B4', 0.9)); // 天空树叶

const mossSide = { textureUrl: './src/world/assets/textures/dirt_podzol_side.png' };
const mossTopBottom = { textureUrl: './src/world/assets/textures/moss_block.png' };
materials.registerMaterial('moss', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: mossSide,       // 东面：苔藓侧面（灰化土侧面纹理）
    1: mossSide,       // 西面：苔藓侧面（灰化土侧面纹理）
    2: mossTopBottom,  // 上面：苔藓顶部（苔藓块纹理）
    3: mossTopBottom,  // 下面：苔藓底部（苔藓块纹理）
    4: mossSide,       // 南面：苔藓侧面（灰化土侧面纹理）
    5: mossSide        // 北面：苔藓侧面（灰化土侧面纹理）
  }
}); // 苔藓

materials.registerMaterial('azalea_log', mkMat('#635338')); // 杜鹃花
const chestSide = { textureUrl: './src/world/assets/textures/box_side.png' };
const chestTop = { textureUrl: './src/world/assets/textures/box_top.png' };
const chestFront = { textureUrl: './src/world/assets/textures/box_face.png' };
materials.registerMaterial('chest', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: chestSide,   // 东面：宝箱侧面
    1: chestSide,   // 西面：宝箱侧面
    2: chestTop,    // 上面：宝箱顶部
    3: chestSide,   // 下面：宝箱侧面（底面不可见，使用侧面纹理）
    4: chestFront,  // 南面：宝箱正面（带锁扣）
    5: chestSide    // 北面：宝箱侧面
  }
}); // 宝箱

// 额外物品材质
materials.registerMaterial('diamond', { textureUrl: './src/world/assets/textures/diamond.png' });
materials.registerMaterial('gold', { textureUrl: './src/world/assets/textures/gold.png' });
materials.registerMaterial('apple', mkMat('#FF0000'));
materials.registerMaterial('god_sword', mkMat('#9400D3'));
materials.registerMaterial('gold_apple', mkMat('#FFD700'));

// 复杂材质（使用细节绘图函数）
materials.registerMaterial('flower', mkDetailMat('#000000', '#FF4444', true, (ctx)=>{
  ctx.fillStyle='#2E8B57'; ctx.fillRect(30,24,4,40); // 茎干：位置(30,24)，宽4，高40像素
  ctx.fillStyle='#FF4444'; ctx.beginPath(); ctx.arc(32,24,12,0,Math.PI*2); ctx.fill(); // 花瓣：圆心(32,24)，半径12
  ctx.fillStyle='#FFD700'; ctx.beginPath(); ctx.arc(32,24,4,0,Math.PI*2); ctx.fill(); // 花蕊：圆心(32,24)，半径4
}));

materials.registerMaterial('azalea_leaves', {
  textureUrl: './src/world/assets/textures/azalea_leaves.png',
  transparent: true,
  alphaTest: 0.5
});

materials.registerMaterial('azalea_flowers', {
  textureUrl: './src/world/assets/textures/flowering_azalea_leaves.png',
  transparent: true,
  alphaTest: 0.5
});

materials.registerMaterial('vine', mkDetailMat(null, '#355E3B', true, (ctx) => {
  ctx.strokeStyle = '#355E3B'; ctx.lineWidth = 3; // 藤蔓线条宽度3像素
  for(let i=0; i<5; i++) { // 绘制5条藤蔓
    ctx.beginPath();
    ctx.moveTo(10+i*10, 0); // 起始点：x坐标10+i*10（间隔10像素），y坐标0（顶部）
    ctx.bezierCurveTo(Math.random()*64, 20, Math.random()*64, 40, 10+i*10, 64); // 贝塞尔曲线，控制点随机产生弯曲效果
    ctx.stroke();
  }
}));

materials.registerMaterial('lilypad', mkDetailMat(null, '#228B22', true, (ctx) => {
  ctx.beginPath(); ctx.arc(32,32,28,0.3, Math.PI*1.8); ctx.fill(); // 圆心(32,32)，半径28，起始弧度0.3，结束弧度1.8π（制造缺口效果）
}));

materials.registerMaterial('realistic_trunk_procedural', {
  color: '#5D4037', // 深棕色
  textureGenerator: (ctx) => {
    // 添加深绿色斑点
    ctx.fillStyle = '#006400'; // 深绿色
    for(let i = 0; i < 150; i++) {
      ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
    }
  }
});

// 新树木材质（使用预加载纹理）
materials.registerMaterial('realistic_oak_leaves', {
  textureUrl: './src/world/assets/textures/oak_leaves_branch_medium.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

materials.registerMaterial('realistic_yellow_leaves', {
  textureUrl: './src/world/assets/textures/leaves_yellow.png',
  transparent: true,
  alphaTest: 0.3
});

materials.registerMaterial('short_grass', {
  textureUrl: './src/world/assets/textures/double_plant_grass_carried.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

materials.registerMaterial('allium', {
  textureUrl: './src/world/assets/textures/flower_Allium.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

materials.registerMaterial('chimney', mkMat('#7f5b37')); // 深棕色烟囱
materials.registerMaterial('collider', { transparent: true, opacity: 0 }); // 碰撞体材质


// 新增金属与宝石方块
materials.registerMaterial('gold_block', { textureUrl: './src/world/assets/textures/gold_block.png' });
materials.registerMaterial('emerald', { textureUrl: './src/world/assets/textures/emerald.png' });
materials.registerMaterial('amethyst', { textureUrl: './src/world/assets/textures/amethyst.png' });
materials.registerMaterial('iron', { textureUrl: './src/world/assets/textures/iron.png' });
materials.registerMaterial('iron_ore', { textureUrl: './src/world/assets/textures/Iron_Ore.png' });

const debrisSide = { textureUrl: './src/world/assets/textures/Ancient_Debris_side.png' };
const debrisTop = { textureUrl: './src/world/assets/textures/Ancient_Debris_top.png' };
materials.registerMaterial('debris', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: debrisSide,   // 东面：远古残骸侧面
    1: debrisSide,   // 西面：远古残骸侧面
    2: debrisTop,    // 上面：远古残骸顶部
    3: debrisTop,    // 下面：远古残骸底部（同顶部纹理）
    4: debrisSide,   // 南面：远古残骸侧面
    5: debrisSide    // 北面：远古残骸侧面
  }
});

materials.registerMaterial('yellow_leaves', {
  textureUrl: './src/world/assets/textures/leaves_yellow.png',
  transparent: true,
  alphaTest: 0.3
});

const tntSide = { textureUrl: './src/world/assets/textures/tnt_side.png' };
const tntTopBottom = { textureUrl: './src/world/assets/textures/tnt_top.png' };
materials.registerMaterial('tnt', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: tntSide,       // 东面：TNT侧面（带文字纹理）
    1: tntSide,       // 西面：TNT侧面（带文字纹理）
    2: tntTopBottom,  // 上面：TNT顶部（引线纹理）
    3: tntTopBottom,  // 下面：TNT底部（引线纹理）
    4: tntSide,       // 南面：TNT侧面（带文字纹理）
    5: tntSide        // 北面：TNT侧面（带文字纹理）
  }
});
