// src/core/materials/MaterialManager.js
// 材质管理器，负责加载、缓存和创建 Three.js 材质
// 支持纹理预加载、程序化纹理生成和材质定义注册

import * as THREE from 'three';

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
   * @param {string[]} urls - 纹理文件的URL数组
   * @returns {Promise} 当所有纹理加载完成时解析的Promise
   */
  preloadTextures(urls) {
    return Promise.all(urls.map(url =>
      this.textureLoader.loadAsync(url).then(texture => {
        texture.magFilter = THREE.NearestFilter; // 设置纹理放大过滤器为最近邻（保持像素风格）
        texture.colorSpace = THREE.SRGBColorSpace; // 设置颜色空间为SRGB
        this.textureCache.set(url, texture); // 将纹理存入缓存
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
    const mat = this._createMaterial(def);
    this.materials.set(type, mat);
    return mat;
  }

  /**
   * 根据材质定义创建 Three.js 材质（私有方法）
   * @param {Object} def - 材质定义对象
   * @returns {THREE.Material} 创建的 Three.js 材质
   */
  _createMaterial(def) {
    // 情况0：多面材质（用于立方体不同面使用不同材质）
    if (def.faces) {
      // Three.js BoxGeometry 面的顺序：px, nx, py, ny, pz, nz (0-5)
      const mats = [];
      for (let i = 0; i < 6; i++) {
        const faceDef = def.faces[i] || def.faces.all || def;
        mats.push(this._createMaterial(faceDef));
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
        texture.repeat.set(def.repeat[0], def.repeat[1]);
        texture.magFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
      }

      return new THREE.MeshStandardMaterial({
        map: texture,
        transparent: def.transparent || false,
        opacity: def.opacity || 1,
        side: def.side || THREE.FrontSide,
        alphaTest: def.alphaTest || 0
      });
    }

    // 情况2：使用纹理生成器（程序化纹理）
    if (def.textureGenerator) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
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
      texture.colorSpace = THREE.SRGBColorSpace;

      return new THREE.MeshStandardMaterial({
        map: texture,
        transparent: def.transparent || false,
        opacity: def.opacity || 1,
        side: def.side || THREE.FrontSide,
        alphaTest: def.alphaTest || 0
      });
    }

    // 情况3：纯颜色材质（无纹理）
    return new THREE.MeshStandardMaterial({
      color: def.color || 0xffffff,
      transparent: def.transparent || false,
      opacity: def.opacity || 1
    });
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
    './src/world/assets/textures/flowering_azalea_leaves.png',
    './src/world/assets/textures/flowering_azalea_side.png',
    './src/world/assets/textures/grass_carried.png',
    './src/world/assets/textures/grass_side_carried.png',
    './src/world/assets/textures/moss_block.png',
    './src/world/assets/textures/planks_birch.png',
    './src/world/assets/textures/planks_big_oak.png',
    './src/world/assets/textures/stone_andesite.png',
    './src/world/assets/textures/stone.png',
    './src/world/assets/textures/dirt.png',
    './src/world/assets/textures/dirt_podzol_side.png',
    './src/world/assets/textures/dirt_podzol_top.png',
    './src/world/assets/textures/stone_diorite.png',
    './src/world/assets/textures/log_big_oak.png',
    './src/world/assets/textures/log_big_oak_top.png',
    './src/world/assets/textures/leaves.png',
    './minecraft-bundles/box_side.png',
    './minecraft-bundles/box_top.png'
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
  faces: {
    0: grassSide,
    1: grassSide,
    2: grassTop,
    3: grassBottom,
    4: grassSide,
    5: grassSide
  }
});

const dirtSide = { textureUrl: './src/world/assets/textures/dirt.png' };
const dirtTopBottom = { textureUrl: './src/world/assets/textures/dirt_podzol_top.png' };
materials.registerMaterial('dirt', {
  faces: {
    0: dirtSide,
    1: dirtSide,
    2: dirtTopBottom,
    3: dirtTopBottom,
    4: dirtSide,
    5: dirtSide
  }
}); // 土

const stoneSide = { textureUrl: './src/world/assets/textures/stone_diorite.png' };
const stoneTopBottom = { textureUrl: './src/world/assets/textures/stone_andesite.png' };
materials.registerMaterial('stone', {
  faces: {
    0: stoneSide,
    1: stoneSide,
    2: stoneTopBottom,
    3: stoneTopBottom,
    4: stoneSide,
    5: stoneSide
  }
}); // 石头

materials.registerMaterial('sand', mkMat('#e6c288')); // 沙地

const woodSide = { textureUrl: './src/world/assets/textures/log_big_oak.png' };
const woodTopBottom = { textureUrl: './src/world/assets/textures/log_big_oak_top.png' };
materials.registerMaterial('wood', {
  faces: {
    0: woodSide,
    1: woodSide,
    2: woodTopBottom,
    3: woodTopBottom,
    4: woodSide,
    5: woodSide
  }
}); // 木头

materials.registerMaterial('planks', { textureUrl: './src/world/assets/textures/planks_birch.png' }); // 木板
materials.registerMaterial('oak_planks', { textureUrl: './src/world/assets/textures/planks_big_oak.png' }); // 大橡木木板
materials.registerMaterial('leaves', {
  textureUrl: './src/world/assets/textures/leaves.png',
  transparent: true,
  alphaTest: 0.3
}); // 树叶
materials.registerMaterial('water', mkMat('#205099', 0.6)); // 水
materials.registerMaterial('swamp_water', mkMat('#2F4F4F', 0.7)); // 沼泽水
materials.registerMaterial('swamp_grass', mkMat('#4C5E34')); // 沼泽草
materials.registerMaterial('cactus', mkMat('#2E8B57')); // 仙人掌
materials.registerMaterial('bookbox', mkMat('#cc0000')); // 书架
materials.registerMaterial('carBody', mkMat('#FFD700')); // 汽车
materials.registerMaterial('wheel', mkMat('#222222')); // 轮子
materials.registerMaterial('cloud', mkMat('#FFFFFF', 0.9)); // 云
materials.registerMaterial('sky_stone', mkMat('#DDDDDD')); // 天空石头
materials.registerMaterial('sky_grass', mkMat('#88CCFF')); // 天空草
materials.registerMaterial('sky_wood', mkMat('#DDA0DD')); // 天空木头
materials.registerMaterial('sky_leaves', mkMat('#FF69B4', 0.9)); // 天空树叶

const mossSide = { textureUrl: './src/world/assets/textures/dirt_podzol_side.png' };
const mossTopBottom = { textureUrl: './src/world/assets/textures/moss_block.png' };
materials.registerMaterial('moss', {
  faces: {
    0: mossSide,
    1: mossSide,
    2: mossTopBottom,
    3: mossTopBottom,
    4: mossSide,
    5: mossSide
  }
}); // 苔藓

materials.registerMaterial('azalea_log', mkMat('#635338')); // 杜鹃花
const chestSide = { textureUrl: './minecraft-bundles/box_side.png' };
const chestTop = { textureUrl: './minecraft-bundles/box_top.png' };
materials.registerMaterial('chest', {
  faces: {
    0: chestSide,
    1: chestSide,
    2: chestTop,
    3: chestSide,
    4: chestSide,
    5: chestSide
  }
}); // 宝箱

// 额外物品材质
materials.registerMaterial('diamond', mkMat('#00FFFF'));
materials.registerMaterial('gold', mkMat('#FFD700'));
materials.registerMaterial('apple', mkMat('#FF0000'));
materials.registerMaterial('god_sword', mkMat('#9400D3'));
materials.registerMaterial('gold_apple', mkMat('#FFD700'));

// 复杂材质（使用细节绘图函数）
materials.registerMaterial('flower', mkDetailMat('#000000', '#FF4444', true, (ctx)=>{
  ctx.fillStyle='#2E8B57'; ctx.fillRect(30,24,4,40);
  ctx.fillStyle='#FF4444'; ctx.beginPath(); ctx.arc(32,24,12,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#FFD700'; ctx.beginPath(); ctx.arc(32,24,4,0,Math.PI*2); ctx.fill();
}));

materials.registerMaterial('azalea_leaves', {
  textureUrl: './src/world/assets/textures/flowering_azalea_leaves.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide,
  repeat: [2, 2]
});

materials.registerMaterial('azalea_hanging', {
  textureUrl: './src/world/assets/textures/flowering_azalea_side.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

materials.registerMaterial('vine', mkDetailMat(null, '#355E3B', true, (ctx) => {
  ctx.strokeStyle = '#355E3B'; ctx.lineWidth = 3;
  for(let i=0; i<5; i++) {
    ctx.beginPath();
    ctx.moveTo(10+i*10, 0);
    ctx.bezierCurveTo(Math.random()*64, 20, Math.random()*64, 40, 10+i*10, 64);
    ctx.stroke();
  }
}));

materials.registerMaterial('lilypad', mkDetailMat(null, '#228B22', true, (ctx) => {
  ctx.beginPath(); ctx.arc(32,32,28,0.3, Math.PI*1.8); ctx.fill();
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

