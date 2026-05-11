// src/core/MaterialManager.js
// 材质管理器，负责加载、缓存和创建 Three.js 材质
// 支持纹理预加载、程序化纹理生成和材质定义注册

import * as THREE from 'three';
import { BatchedMaterial } from './BatchedMaterial.js';
import { getBlockProperties } from '../constants/BlockData.js';
import { DEFAULT_TEXTURE_BLUR_LEVEL } from '../constants/GameConfig.js';

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
    this.batchedMaterials = new Map(); // 合批材质缓存
    this.textureBlurLevel = DEFAULT_TEXTURE_BLUR_LEVEL; // 贴图模糊参数（0-1）
    this.defaultMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff }); // 默认材质（洋红色，用于调试）
    this.aoEnabled = true;             // AO 着色开关（用于性能对比调试）
  }

  /**
   * 将输入值钳制到 [0, 1]
   * @param {number} level - 模糊程度
   * @returns {number}
   */
  _clampBlurLevel(level) {
    return Math.min(1, Math.max(0, Number(level) || 0));
  }

  /**
   * 根据模糊参数应用纹理采样策略
   * @param {THREE.Texture} texture - 目标纹理
   */
  _applyTextureSampling(texture) {
    if (!texture) return;

    const blurLevel = this._clampBlurLevel(this.textureBlurLevel);
    if (blurLevel <= 0) {
      // 纯像素风：最近邻采样 + 关闭 mipmaps
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
    } else if (blurLevel < 0.5) {
      // 轻微模糊：保留锐度，远处使用较平滑采样
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapNearestFilter;
      texture.generateMipmaps = true;
    } else {
      // 明显模糊：近远处都更平滑
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
    }

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }

  /**
   * 设置全局贴图像素模糊程度
   * @param {number} level - 0~1，0为清晰像素风，1为最大模糊
   */
  setTextureBlurLevel(level) {
    const nextLevel = this._clampBlurLevel(level);
    if (Math.abs(nextLevel - this.textureBlurLevel) < 0.001) return;

    this.textureBlurLevel = nextLevel;

    // 更新缓存纹理
    for (const texture of this.textureCache.values()) {
      this._applyTextureSampling(texture);
    }

    // 更新所有已创建材质中的纹理（包括 repeat 克隆纹理）
    for (const matOrMats of this.materials.values()) {
      const mats = Array.isArray(matOrMats) ? matOrMats : [matOrMats];
      for (const mat of mats) {
        if (!mat || !mat.map) continue;
        this._applyTextureSampling(mat.map);
        mat.needsUpdate = true;
      }
    }
  }

  /**
   * 获取当前贴图像素模糊程度
   * @returns {number}
   */
  getTextureBlurLevel() {
    return this.textureBlurLevel;
  }

  /**
   * 预加载纹理文件并缓存
   * @param {string[]} urls - 纹理文件的 URL 数组
   * @returns {Promise} 当所有纹理加载完成时解析的 Promise
   */
  preloadTextures(urls) {
    return Promise.all(urls.map(url =>
      this.textureLoader.loadAsync(url).then(texture => {
        this._applyTextureSampling(texture);
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
   * 获取纹理分组映射 — 用于材质合批优化
   * 将使用相同纹理的方块类型归为一组，减少 Draw Call
   * @returns {Object} 纹理 URL → 方块类型数组 的映射
   */
  getTextureGroups() {
    const groups = {};

    for (const [type, def] of this.definitions.entries()) {
      // 跳过透明方块（不参与合批）
      const props = getBlockProperties(type);
      if (!props.isSolid || props.isTransparent) continue;

      // 处理多面材质
      if (def.faces) {
        for (const faceDef of Object.values(def.faces)) {
          if (faceDef.textureUrl) {
            if (!groups[faceDef.textureUrl]) groups[faceDef.textureUrl] = [];
            if (!groups[faceDef.textureUrl].includes(type)) {
              groups[faceDef.textureUrl].push(type);
            }
          }
        }
        continue;
      }

      // 处理单一纹理
      if (def.textureUrl) {
        if (!groups[def.textureUrl]) groups[def.textureUrl] = [];
        groups[def.textureUrl].push(type);
      }

      // 处理纯色材质（按颜色值分组）
      if (def.color) {
        const colorKey = `color:${def.color}`;
        if (!groups[colorKey]) groups[colorKey] = [];
        groups[colorKey].push(type);
      }
    }

    // 过滤掉只有一个成员的组（无法合批）
    return Object.fromEntries(
      Object.entries(groups).filter(([_, types]) => types.length > 1)
    );
  }

  /**
   * 获取合批材质 — 支持多个方块类型共享
   * @param {string} textureUrl - 主纹理 URL
   * @param {Array} blockTypes - 该组包含的方块类型
   * @returns {THREE.Material} 合批材质
   */
  getBatchedMaterial(textureUrl, blockTypes) {
    const cacheKey = `batched:${textureUrl}:${blockTypes.sort().join(',')}`;

    if (this.batchedMaterials.has(cacheKey)) {
      return this.batchedMaterials.get(cacheKey);
    }

    // 加载所有纹理
    const textureObjects = blockTypes.map(type => {
      const def = this.definitions.get(type);
      if (def?.textureUrl) {
        return this.textureCache.get(def.textureUrl);
      }
      return null;
    }).filter(Boolean);

    // 创建 BatchedMaterial
    const batchedMat = new BatchedMaterial({
      textures: textureObjects,
      baseColor: 0xffffff
    });

    this.batchedMaterials.set(cacheKey, batchedMat);
    return batchedMat;
  }

  /**
   * 根据材质定义创建 Three.js 材质（私有方法）
   * @param {Object} def - 材质定义对象
   * @param {string} type - 材质类型
   * @returns {THREE.Material} 创建的 Three.js 材质
   */
  _createMaterial(def, type) {
    // 根据配置判断是否允许使用 AO 阴影
    // AO 适用于所有实心且不透明的方块
    const props = getBlockProperties(type);
    const useAO = props.isSolid && !props.isTransparent;

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
        this._applyTextureSampling(texture);
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
      this._applyTextureSampling(texture);

      const mat = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: def.transparent || false,
        opacity: def.opacity || 1,
        side: def.side || THREE.FrontSide,
        alphaTest: def.alphaTest || 0,
        emissive: def.emissive || 0x000000,      // 自发光颜色
        emissiveIntensity: def.emissiveIntensity || 0  // 自发光强度
      });
      if (useAO) this._applyShaderModifications(mat);
      return mat;
    }

    // 情况3：纯颜色材质（无纹理）
    const mat = new THREE.MeshStandardMaterial({
      color: def.color || 0xffffff,
      transparent: def.transparent || false,
      opacity: def.opacity || 1,
      emissive: def.emissive || 0x000000,      // 自发光颜色
      emissiveIntensity: def.emissiveIntensity || 0  // 自发光强度
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
      // 注入 AO 开关 uniform
      shader.uniforms = {
        ...shader.uniforms,
        uAoEnabled: { value: this.aoEnabled ? 1.0 : 0.0 }
      };

      // 存储 shader 引用以便后续更新
      material._aoShader = shader;

      // 顶点着色器修改
      shader.vertexShader = `
        attribute float aVertexId;
        attribute float aAoLow;
        attribute float aAoHigh;
        attribute float aOrientation;
        varying float vAo;
      ` + shader.vertexShader;

      // 台阶底部阴影
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        float remapTopCorner(float corner, float orientationIdx) {
          // orientation=0: [0,1,2,3]
          if (orientationIdx < 0.5) return corner;
          // orientation=1: [2,0,3,1]
          if (orientationIdx < 1.5) {
            if (corner < 0.5) return 2.0;
            if (corner < 1.5) return 0.0;
            if (corner < 2.5) return 3.0;
            return 1.0;
          }
          // orientation=2: [3,2,1,0]
          if (orientationIdx < 2.5) {
            if (corner < 0.5) return 3.0;
            if (corner < 1.5) return 2.0;
            if (corner < 2.5) return 1.0;
            return 0.0;
          }
          // orientation=3: [1,3,0,2]
          if (corner < 0.5) return 1.0;
          if (corner < 1.5) return 3.0;
          if (corner < 2.5) return 0.0;
          return 2.0;
        }

        float remapBottomCorner(float corner, float orientationIdx) {
          // orientation=0: [0,1,2,3]
          if (orientationIdx < 0.5) return corner;
          // orientation=1: [1,3,0,2]
          if (orientationIdx < 1.5) {
            if (corner < 0.5) return 1.0;
            if (corner < 1.5) return 3.0;
            if (corner < 2.5) return 0.0;
            return 2.0;
          }
          // orientation=2: [3,2,1,0]
          if (orientationIdx < 2.5) {
            if (corner < 0.5) return 3.0;
            if (corner < 1.5) return 2.0;
            if (corner < 2.5) return 1.0;
            return 0.0;
          }
          // orientation=3: [2,0,3,1]
          if (corner < 0.5) return 2.0;
          if (corner < 1.5) return 0.0;
          if (corner < 2.5) return 3.0;
          return 1.0;
        }

        float remapSideFace(float face, float orientationIdx) {
          // 将侧面归一化到顺序：+X(0), +Z(1), -X(2), -Z(3)
          float sideIdx;
          if (face < 0.5) sideIdx = 0.0;       // +X
          else if (face < 1.5) sideIdx = 2.0;  // -X
          else if (face < 4.5) sideIdx = 1.0;  // +Z
          else sideIdx = 3.0;                  // -Z

          // 与实例旋转保持一致：orientation=1 表示绕 Y 轴 +90°
          float worldSideIdx = mod(sideIdx - orientationIdx + 4.0, 4.0);

          // 还原到 AO 面索引：+X(0), -X(1), +Z(4), -Z(5)
          if (worldSideIdx < 0.5) return 0.0;
          if (worldSideIdx < 1.5) return 4.0;
          if (worldSideIdx < 2.5) return 1.0;
          return 5.0;
        }

        float remapAoVertexId(float vertexId, float orientation) {
          float orientationIdx = mod(floor(orientation + 0.5), 4.0);
          float face = floor(vertexId / 4.0);
          float corner = mod(vertexId, 4.0);

          // +Y
          if (face > 1.5 && face < 2.5) {
            return 8.0 + remapTopCorner(corner, orientationIdx);
          }

          // -Y
          if (face > 2.5 && face < 3.5) {
            return 12.0 + remapBottomCorner(corner, orientationIdx);
          }

          // 四个侧面角落顺序不变，仅重映射世界面
          return remapSideFace(face, orientationIdx) * 4.0 + corner;
        }

        float getAo(float id, float low, float high) {
          float remappedId = remapAoVertexId(id, aOrientation);
          float aoRaw;
          if (remappedId < 12.0) { // 前12个顶点（0-11）的AO数据存储在low中，后12个顶点（12-23）存储在high中
            aoRaw = mod(floor(low / pow(4.0, remappedId)), 4.0); // 每个顶点AO值用2位存储（0-3），4.0表示4种可能值
          } else {
            aoRaw = mod(floor(high / pow(4.0, remappedId - 12.0)), 4.0);
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
        uniform float uAoEnabled;
        varying float vAo;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        // 根据 uAoEnabled 开关决定是否应用 AO
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vAo, uAoEnabled);
        `
      );
    };
  }

  /**
   * 同步 AO 开关到所有材质 shader
   * @param {boolean} enabled - 是否启用 AO
   */
  _syncAOShaderState(enabled) {
    // 更新合批材质（ShaderMaterial）
    for (const mat of this.batchedMaterials.values()) {
      if (mat && mat.uniforms && mat.uniforms.uAoEnabled) {
        mat.uniforms.uAoEnabled.value = enabled ? 1.0 : 0.0;
      }
    }

    // 更新普通材质（MeshStandardMaterial）- 通过存储的 shader 引用
    for (const matOrMats of this.materials.values()) {
      const mats = Array.isArray(matOrMats) ? matOrMats : [matOrMats];
      for (const mat of mats) {
        if (mat && mat._aoShader && mat._aoShader.uniforms) {
          mat._aoShader.uniforms.uAoEnabled.value = enabled ? 1.0 : 0.0;
        }
      }
    }
  }

  /**
   * 通知世界系统：AO 开关已变化
   * @param {boolean} enabled - 是否启用 AO
   */
  _notifyAOSettingChanged(enabled) {
    const world = globalThis.game?.world;
    if (world && typeof world.onAOSettingChanged === 'function') {
      world.onAOSettingChanged(enabled);
    }
  }

  /**
   * 切换 AO 着色开关
   */
  toggleAO() {
    this.aoEnabled = !this.aoEnabled;
    const enabled = this.aoEnabled;
    console.log(`[MaterialManager] AO 着色已${enabled ? '开启' : '关闭'}`);
    this._syncAOShaderState(enabled);
    this._notifyAOSettingChanged(enabled);
  }

  /**
   * 设置 AO 着色状态
   * @param {boolean} enabled - 是否启用 AO
   */
  setAOEnabled(enabled) {
    if (this.aoEnabled === enabled) return;
    this.aoEnabled = enabled;
    console.log(`[MaterialManager] AO 着色已${enabled ? '开启' : '关闭'}`);
    this._syncAOShaderState(enabled);
    this._notifyAOSettingChanged(enabled);
  }

  /**
   * 获取 AO 着色状态
   * @returns {boolean}
   */
  isAOEnabled() {
    return this.aoEnabled;
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
    './src/assets/textures/oak_leaves_branch_medium.png',
    './src/assets/textures/azalea_leaves.png',
    './src/assets/textures/flowering_azalea_leaves.png',
    './src/assets/textures/grass_carried.png',
    './src/assets/textures/grass_side_carried.png',
    './src/assets/textures/moss_block.png',
    './src/assets/textures/planks_birch.png',
    './src/assets/textures/dark_planks.png',
    './src/assets/textures/stone_andesite.png',
    './src/assets/textures/stone.png',
    './src/assets/textures/stone_diorite.png',
    './src/assets/textures/sand.png',
    './src/assets/textures/sand_side.png',
    './src/assets/textures/dirt.png',
    './src/assets/textures/dirt_podzol_side.png',
    './src/assets/textures/dirt_podzol_top.png',
    './src/assets/textures/stone_diorite.png',
    './src/assets/textures/log_big_oak.png',
    './src/assets/textures/log_big_oak_top.png',
    './src/assets/textures/Stripped_Dark_Oak_Log_(texture)_JE1.png',
    './src/assets/textures/leaves.png',
    './src/assets/textures/box_side.png',
    './src/assets/textures/box_top.png',
    './src/assets/textures/box_face.png',
    './src/assets/textures/Bookshelf_texture_JE2_BE2.png',
    './src/assets/textures/Bone_Block_side_texture_JE2_BE2.png',
    './src/assets/textures/Bone_Block_top_texture_JE2_BE2.png',
    './src/assets/textures/double_plant_grass_carried.png',
    './src/assets/textures/Glass.png',
    './src/assets/textures/Deepslate_Gold.png',
    './src/assets/textures/Bricks.png',
    './src/assets/textures/flower_Allium.png',
    './src/assets/textures/Azure_Bluet.png',
    './src/assets/textures/Dead_Bush.png',
    './src/assets/textures/Oxeye_Daisy.png',
    './src/assets/textures/Red_Mushroom.png',
    './src/assets/textures/Cobblestone.png',
    './src/assets/textures/Blue_Wood_Planks.png',
    './src/assets/textures/End_Stone.png',
    './src/assets/textures/Green_Wood_Planks.png',
    './src/assets/textures/Hay_Bale.png',
    './src/assets/textures/Hay_Bale_top.png',
    './src/assets/textures/Mossy_Cobblestone.png',
    './src/assets/textures/Mossy_Cobblestone_side.png',
    './src/assets/textures/Oak_Planks.png',
    './src/assets/textures/White_Wood_Planks.png',
    './src/assets/textures/Birch_Log_top.png',
    './src/assets/textures/Birch_Log_side.png',
    './src/assets/textures/Obsidian.png',
    './src/assets/textures/diamond.png',
    './src/assets/textures/gold.png',
    './src/assets/textures/glass_blink.png',
    './src/assets/textures/gold_block.png',
    './src/assets/textures/emerald.png',
    './src/assets/textures/amethyst.png',
    './src/assets/textures/Ancient_Debris_top.png',
    './src/assets/textures/Ancient_Debris_side.png',
    './src/assets/textures/iron.png',
    './src/assets/textures/Iron_Ore.png',
    './src/assets/textures/leaves_yellow.png',
    './src/assets/textures/tnt_side.png',
    './src/assets/textures/tnt_top.png',
    './src/assets/textures/Snow_top.png',
    './src/assets/textures/Snowy_Grass_Block_side.png',
    './src/assets/textures/ice.png',
    './src/assets/textures/leaves_with_snow.png',

    // ========== 新增方块纹理 (30种) ==========
    './src/assets/textures/Deepslate.png',
    './src/assets/textures/Deepslate_Diamond_Ore.png',
    './src/assets/textures/Polished_Deepslate.png',
    './src/assets/textures/Glowstone.png',
    './src/assets/textures/Ochre_Froglight.png',
    './src/assets/textures/Oxidized_Cut_Copper.png',
    './src/assets/textures/Weathered_Cut_Copper.png',
    './src/assets/textures/Lava.png',
    './src/assets/textures/Block_of_Quartz.png',
    './src/assets/textures/Quartz_Bricks.png',
    './src/assets/textures/Brain_Coral_Block.png',
    './src/assets/textures/Block_of_Amber.png',
    './src/assets/textures/Floatato.png',
    './src/assets/textures/Clay.png',
    './src/assets/textures/End_Stone_Bricks.png',
    './src/assets/textures/Smooth_Stone.png',
    './src/assets/textures/Smooth_Stone_1.png',
    './src/assets/textures/Stone_Bricks.png',
    './src/assets/textures/Tuff_Bricks.png',
    './src/assets/textures/Snow.png',
    './src/assets/textures/Light_Gray_Cloth.png',
    './src/assets/textures/Pink_Wool.png',
    './src/assets/textures/Nether_Bricks.png',
    './src/assets/textures/Nether_Bricks_1.png',
    './src/assets/textures/Nether_Gold_Ore.png',
    './src/assets/textures/Netherrack.png',
    './src/assets/textures/Polished_Blackstone_Bricks.png',
    './src/assets/textures/Oak_Planks_1.png',
    './src/assets/textures/Acacia_Planks.png',
    './src/assets/textures/Bedrock.png',

    // ========== 新增方块纹理 (6种) ==========
    './src/assets/textures/Polished_Diorite.png',
    './src/assets/textures/Polished_Granite.png',
    './src/assets/textures/Piston.png',
    './src/assets/textures/Piston_Head.png',
    './src/assets/textures/Mud_Bricks.png',
    './src/assets/textures/Orange_Shulker_Box.png',

    // ========== 床方块纹理 ==========
    './src/assets/textures/bed/Bed_(back_texture)_JE2_BE2.png',
    './src/assets/textures/bed/Bed_(front_texture)_JE2_BE2.png',
    './src/assets/textures/bed/Bed_(top_texture)_JE1_BE1.png',
    './src/assets/textures/bed/Bed_(bottom_texture)_JE1_BE1.png',
    './src/assets/textures/bed/Bed_(top_side_texture)_JE2_BE2.png',
    './src/assets/textures/bed/Bed_(bottom_side_texture)_JE2_BE2.png',

    // ========== 轨道方块纹理 ==========
    './src/assets/textures/sand_train_track.png',
    './src/assets/textures/sand_train_track_conner.png'
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
 * 创建带有程序化斑点纹理的材质定义辅助函数
 * @param {string} baseColor - 材质基础颜色（CSS 颜色字符串）
 * @param {string} spotColor - 斑点颜色（CSS 颜色字符串）
 * @param {number} spotSize - 斑点大小（像素，默认 2）
 * @returns {Object} 材质定义对象
 */
function mkProceduralMat(baseColor, spotColor, spotSize=2) {
  return {
    color: baseColor,
    textureGenerator: (ctx) => {
      // 填充基础色背景
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, 64, 64);
      // 添加随机斑点
      const spotCount = Math.floor(100 / spotSize); // 斑点数量与大小成反比
      for(let i = 0; i < spotCount; i++) {
        ctx.fillStyle = spotColor;
        ctx.fillRect(
          Math.random() * 64,
          Math.random() * 64,
          spotSize,
          spotSize
        );
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
const grassSide = { textureUrl: './src/assets/textures/grass_side_carried.png' };
const grassTop = { textureUrl: './src/assets/textures/grass_carried.png' };
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

const dirtSide = { textureUrl: './src/assets/textures/dirt.png' };
const dirtTopBottom = { textureUrl: './src/assets/textures/dirt_podzol_top.png' };
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

const stoneSide1 = { textureUrl: './src/assets/textures/stone.png' };
const stoneTopBottom = { textureUrl: './src/assets/textures/stone_andesite.png' };
materials.registerMaterial('stone', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: stoneSide1,       // 东面：石头侧面（闪长岩）
    1: stoneSide1,       // 西面：石头侧面（闪长岩）
    2: stoneTopBottom,  // 上面：石头顶部（安山岩）
    3: stoneTopBottom,  // 下面：石头底部（安山岩）
    4: stoneSide1,      // 南面：石头侧面（普通石头）
    5: stoneSide1       // 北面：石头侧面（普通石头）
  }
}); // 石头

materials.registerMaterial('stone_diorite', {
  textureUrl: './src/assets/textures/stone_diorite.png'
}); // 闪长岩

materials.registerMaterial('gold_ore', {
  textureUrl: './src/assets/textures/Deepslate_Gold.png'
}); // 黄金矿石

materials.registerMaterial('bricks', {
  textureUrl: './src/assets/textures/Bricks.png'
}); // 砖块

materials.registerMaterial('cobblestone', {
  textureUrl: './src/assets/textures/Cobblestone.png'
}); // 鹅卵石

materials.registerMaterial('obsidian', {
  textureUrl: './src/assets/textures/Obsidian.png'
}); // 黑曜石

materials.registerMaterial('marble', mkMat('#F2F0E6')); // 大理石

materials.registerMaterial('dark_planks', {
  textureUrl: './src/assets/textures/dark_planks.png'
}); // 深木板

materials.registerMaterial('mossy_stone', {
  textureUrl: './src/assets/textures/Mossy_Cobblestone.png'
}); // 苔藓石

materials.registerMaterial('blue_planks', {
  textureUrl: './src/assets/textures/Blue_Wood_Planks.png'
}); // 蓝色木板

materials.registerMaterial('end_stone', {
  textureUrl: './src/assets/textures/End_Stone.png'
}); // 末端石头

materials.registerMaterial('green_planks', {
  textureUrl: './src/assets/textures/Green_Wood_Planks.png'
}); // 绿色木板

const hayBaleSide = { textureUrl: './src/assets/textures/Hay_Bale.png' };
const hayBaleTopBottom = { textureUrl: './src/assets/textures/Hay_Bale_top.png' };
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

const sandSide = { textureUrl: './src/assets/textures/sand_side.png' };
const sandTopBottom = { textureUrl: './src/assets/textures/sand.png' };
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

// ========== 轨道方块材质 ==========
const sandTrainTrackTop = { textureUrl: './src/assets/textures/sand_train_track.png' };
const sandTrainTrackCornerTop = { textureUrl: './src/assets/textures/sand_train_track_conner.png' };
materials.registerMaterial('sand_train_track', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: sandTopBottom,      // 东面：沙子
    1: sandTopBottom,      // 西面：沙子
    2: sandTrainTrackTop,  // 上面：直轨
    3: sandTopBottom,      // 下面：沙子
    4: sandTopBottom,      // 南面：沙子
    5: sandTopBottom       // 北面：沙子
  }
}); // 直轨方块

materials.registerMaterial('sand_train_track_corner', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: sandTopBottom,          // 东面：沙子
    1: sandTopBottom,          // 西面：沙子
    2: sandTrainTrackCornerTop, // 上面：转弯轨道
    3: sandTopBottom,          // 下面：沙子
    4: sandTopBottom,          // 南面：沙子
    5: sandTopBottom           // 北面：沙子
  }
}); // 转弯轨道方块

const woodSide = { textureUrl: './src/assets/textures/log_big_oak.png' };
const woodTopBottom = { textureUrl: './src/assets/textures/log_big_oak_top.png' };
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

materials.registerMaterial('dark_oak', { textureUrl: './src/assets/textures/Stripped_Dark_Oak_Log_(texture)_JE1.png' }); // 深色橡木（六面同纹理）

const birchLogSide = { textureUrl: './src/assets/textures/Birch_Log_side.png' };
const birchLogTopBottom = { textureUrl: './src/assets/textures/Birch_Log_top.png' };
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

materials.registerMaterial('planks', { textureUrl: './src/assets/textures/planks_birch.png' }); // 木板
materials.registerMaterial('planks_step', { textureUrl: './src/assets/textures/planks_birch.png' }); // 木台阶
materials.registerMaterial('cobblestone_step', { textureUrl: './src/assets/textures/Cobblestone.png' }); // 鹅卵石台阶
materials.registerMaterial('cobblestone_step_updown', { textureUrl: './src/assets/textures/Cobblestone.png' }); // 鹅即石上下台阶（上下颠倒）
materials.registerMaterial('stone_diorite_step', { textureUrl: './src/assets/textures/stone_diorite.png' }); // 闪长岩台阶
materials.registerMaterial('oak_planks', { textureUrl: './src/assets/textures/Oak_Planks.png' }); // 大橡木木板
materials.registerMaterial('white_planks', { textureUrl: './src/assets/textures/White_Wood_Planks.png' }); // 白色木板
materials.registerMaterial('glass_block', {
  textureUrl: './src/assets/textures/Glass.png',
  transparent: true,
  alphaTest: 0.1,
  // side: THREE.DoubleSide
}); // 玻璃
materials.registerMaterial('glass_blink', {
  textureUrl: './src/assets/textures/glass_blink.png',
  transparent: true,
  alphaTest: 0.1,
  // side: THREE.DoubleSide
}); // 闪闪玻璃
materials.registerMaterial('leaves', {
  textureUrl: './src/assets/textures/leaves.png',
  transparent: true,
  alphaTest: 0.3
}); // 树叶
materials.registerMaterial('water', mkMat('#205099', 0.6)); // 水
materials.registerMaterial('swamp_water', mkMat('#2F4F4F', 0.7)); // 沼泽水

const swampGrassSide = { textureUrl: './src/assets/textures/Mossy_Cobblestone_side.png' };
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
const bookboxFront = { textureUrl: './src/assets/textures/Bookshelf_texture_JE2_BE2.png' };
const bookboxSide = { textureUrl: './src/assets/textures/Bone_Block_side_texture_JE2_BE2.png' };
const bookboxTopBottom = { textureUrl: './src/assets/textures/Bone_Block_top_texture_JE2_BE2.png' };
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

const mossSide = { textureUrl: './src/assets/textures/dirt_podzol_side.png' };
const mossTopBottom = { textureUrl: './src/assets/textures/moss_block.png' };
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
const chestSide = { textureUrl: './src/assets/textures/box_side.png' };
const chestTop = { textureUrl: './src/assets/textures/box_top.png' };
const chestFront = { textureUrl: './src/assets/textures/box_face.png' };
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
materials.registerMaterial('diamond', { textureUrl: './src/assets/textures/diamond.png' });
materials.registerMaterial('gold', { textureUrl: './src/assets/textures/gold.png' });
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
  textureUrl: './src/assets/textures/azalea_leaves.png',
  transparent: true,
  alphaTest: 0.5
});

materials.registerMaterial('azalea_flowers', {
  textureUrl: './src/assets/textures/flowering_azalea_leaves.png',
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

materials.registerMaterial('realistic_trunk_procedural', mkProceduralMat('#5D4037', '#006400', 2)); // 深棕色树干带深绿色斑点

// 新树木材质（使用预加载纹理）
materials.registerMaterial('realistic_oak_leaves', {
  textureUrl: './src/assets/textures/oak_leaves_branch_medium.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

materials.registerMaterial('realistic_yellow_leaves', {
  textureUrl: './src/assets/textures/leaves_yellow.png',
  transparent: true,
  alphaTest: 0.3
});

materials.registerMaterial('short_grass', {
  textureUrl: './src/assets/textures/double_plant_grass_carried.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

materials.registerMaterial('allium', {
  textureUrl: './src/assets/textures/flower_Allium.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

// 新增花朵类材质 (4种)
materials.registerMaterial('azure_bluet', {
  textureUrl: './src/assets/textures/Azure_Bluet.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});
materials.registerMaterial('dead_bush', {
  textureUrl: './src/assets/textures/Dead_Bush.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});
materials.registerMaterial('oxeye_daisy', {
  textureUrl: './src/assets/textures/Oxeye_Daisy.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});
materials.registerMaterial('red_mushroom', {
  textureUrl: './src/assets/textures/Red_Mushroom.png',
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide
});

materials.registerMaterial('chimney', mkMat('#7f5b37')); // 深棕色烟囱
const handrailBaseColor = "#b98e5b";
const handrailPotColor = "#8e6148";
const handrailPotSize = 10;
materials.registerMaterial('handrail', mkProceduralMat(handrailBaseColor, handrailPotColor, 4)); // 栏杆（带深灰色斑点）
materials.registerMaterial('handrailA', mkProceduralMat(handrailBaseColor, handrailPotColor, handrailPotSize)); // 栏杆 A（带深灰色斑点）
materials.registerMaterial('handrailB', mkProceduralMat(handrailBaseColor, handrailPotColor, handrailPotSize)); // 栏杆 B（带深灰色斑点）
materials.registerMaterial('vertical_pillar', mkMat('#b98e5b')); // 柱子
materials.registerMaterial('horizontal_pillar', mkMat('#b98e5b')); // 水平柱子
materials.registerMaterial('collider', { transparent: true, opacity: 0 }); // 碰撞体材质
materials.registerMaterial('playground_block', mkMat('#808080')); // 创造台灰色方块
materials.registerMaterial('playground_center_block', mkMat('#4a90e2')); // 创造台中心标记（蓝色）
materials.registerMaterial('turret_alias_block', {
  color: 0x808080,  // 中灰色
  roughness: 0.7,
  metalness: 0.3
}); // 炮塔方块
materials.registerMaterial('zombie_nest_alias_block', {
  textureUrl: './src/assets/textures/zombie_nest_alias_block.png'
}); // 丧尸巢穴别名方块

// 矿车物品材质
materials.registerMaterial('mine_cart', {
  textureUrl: './src/assets/textures/Invicon_Minecart.png'
}); // 矿车物品图标


// 新增金属与宝石方块
materials.registerMaterial('gold_block', { textureUrl: './src/assets/textures/gold_block.png' });
materials.registerMaterial('emerald', { textureUrl: './src/assets/textures/emerald.png' });
materials.registerMaterial('amethyst', { textureUrl: './src/assets/textures/amethyst.png' });
materials.registerMaterial('iron', { textureUrl: './src/assets/textures/iron.png' });
materials.registerMaterial('iron_ore', { textureUrl: './src/assets/textures/Iron_Ore.png' });

const debrisSide = { textureUrl: './src/assets/textures/Ancient_Debris_side.png' };
const debrisTop = { textureUrl: './src/assets/textures/Ancient_Debris_top.png' };
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
  textureUrl: './src/assets/textures/leaves_yellow.png',
  transparent: true,
  alphaTest: 0.3
});

const tntSide = { textureUrl: './src/assets/textures/tnt_side.png' };
const tntTopBottom = { textureUrl: './src/assets/textures/tnt_top.png' };
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

// 雪方块 - 六个面都是 Snow_top.png
const snowTexture = { textureUrl: './src/assets/textures/Snow_top.png' };
materials.registerMaterial('snow', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: snowTexture,  // 东面：雪
    1: snowTexture,  // 西面：雪
    2: snowTexture,  // 上面：雪
    3: snowTexture,  // 下面：雪
    4: snowTexture,  // 南面：雪
    5: snowTexture   // 北面：雪
  }
});

// 雪草方块 - 顶部雪，侧面雪地，底部泥土
const snowGrassTop = { textureUrl: './src/assets/textures/Snow_top.png' };
const snowGrassSide = { textureUrl: './src/assets/textures/Snowy_Grass_Block_side.png' };
const snowGrassBottom = { textureUrl: './src/assets/textures/dirt.png' };
materials.registerMaterial('snow_grass', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: snowGrassSide,   // 东面：雪地侧面
    1: snowGrassSide,   // 西面：雪地侧面
    2: snowGrassTop,    // 上面：雪
    3: snowGrassBottom,  // 下面：泥土
    4: snowGrassSide,   // 南面：雪地侧面
    5: snowGrassSide    // 北面：雪地侧面
  }
});

// 冰方块 - 六个面都是 ice.png
const iceTexture = { textureUrl: './src/assets/textures/ice.png' };
materials.registerMaterial('ice', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: iceTexture,  // 东面：冰
    1: iceTexture,  // 西面：冰
    2: iceTexture,  // 上面：冰
    3: iceTexture,  // 下面：冰
    4: iceTexture,  // 南面：冰
    5: iceTexture   // 北面：冰
  }
});

// 雪树叶方块 - 顶部雪，侧面带雪树叶，底部树叶
const snowLeavesTop = { textureUrl: './src/assets/textures/Snow_top.png', transparent: true, alphaTest: 0.3 };
const snowLeavesSide = { textureUrl: './src/assets/textures/leaves_with_snow.png', transparent: true, alphaTest: 0.3 };
const snowLeavesBottom = { textureUrl: './src/assets/textures/leaves.png', transparent: true, alphaTest: 0.3 };
materials.registerMaterial('snow_leaves', {
  faces: { // 立方体六个面：0:东，1:西，2:上，3:下，4:南，5:北
    0: snowLeavesSide,   // 东面：带雪树叶
    1: snowLeavesSide,   // 西面：带雪树叶
    2: snowLeavesTop,    // 上面：雪
    3: snowLeavesBottom,  // 下面：树叶
    4: snowLeavesSide,   // 南面：带雪树叶
    5: snowLeavesSide    // 北面：带雪树叶
  }
});

// ========== 新增方块材质 (30种) ==========

// 深板岩系列
materials.registerMaterial('deepslate', { textureUrl: './src/assets/textures/Deepslate.png' });
materials.registerMaterial('deepslate_diamond_ore', { textureUrl: './src/assets/textures/Deepslate_Diamond_Ore.png' });
materials.registerMaterial('polished_deepslate', { textureUrl: './src/assets/textures/Polished_Deepslate.png' });

// 发光方块
materials.registerMaterial('glowstone', { textureUrl: './src/assets/textures/Glowstone.png' });
materials.registerMaterial('ochre_froglight', { textureUrl: './src/assets/textures/Ochre_Froglight.png' });

// 铜系列
materials.registerMaterial('oxidized_cut_copper', { textureUrl: './src/assets/textures/Oxidized_Cut_Copper.png' });
materials.registerMaterial('weathered_cut_copper', { textureUrl: './src/assets/textures/Weathered_Cut_Copper.png' });

// 岩浆
materials.registerMaterial('lava', { textureUrl: './src/assets/textures/Lava.png' });

// 石英系列
materials.registerMaterial('block_of_quartz', { textureUrl: './src/assets/textures/Block_of_Quartz.png' });
materials.registerMaterial('quartz_bricks', { textureUrl: './src/assets/textures/Quartz_Bricks.png' });

// 珊瑚与琥珀
materials.registerMaterial('brain_coral_block', { textureUrl: './src/assets/textures/Brain_Coral_Block.png' });
materials.registerMaterial('block_of_amber', { textureUrl: './src/assets/textures/Block_of_Amber.png' });
materials.registerMaterial('floatato', { textureUrl: './src/assets/textures/Floatato.png' });

// 粘土与石头变体
materials.registerMaterial('clay', { textureUrl: './src/assets/textures/Clay.png' });
materials.registerMaterial('end_stone_bricks', { textureUrl: './src/assets/textures/End_Stone_Bricks.png' });
materials.registerMaterial('smooth_stone', { textureUrl: './src/assets/textures/Smooth_Stone.png' });
materials.registerMaterial('smooth_stone_1', { textureUrl: './src/assets/textures/Smooth_Stone_1.png' });
materials.registerMaterial('stone_bricks', { textureUrl: './src/assets/textures/Stone_Bricks.png' });
materials.registerMaterial('tuff_bricks', { textureUrl: './src/assets/textures/Tuff_Bricks.png' });

// 雪方块
materials.registerMaterial('snow_block', { textureUrl: './src/assets/textures/Snow.png' });

// 布料与羊毛
materials.registerMaterial('light_gray_cloth', { textureUrl: './src/assets/textures/Light_Gray_Cloth.png' });
materials.registerMaterial('pink_wool', { textureUrl: './src/assets/textures/Pink_Wool.png' });

// 下界系列
materials.registerMaterial('nether_bricks', { textureUrl: './src/assets/textures/Nether_Bricks.png' });
materials.registerMaterial('nether_bricks_1', { textureUrl: './src/assets/textures/Nether_Bricks_1.png' });
materials.registerMaterial('nether_gold_ore', { textureUrl: './src/assets/textures/Nether_Gold_Ore.png' });
materials.registerMaterial('netherrack', { textureUrl: './src/assets/textures/Netherrack.png' });
materials.registerMaterial('polished_blackstone_bricks', { textureUrl: './src/assets/textures/Polished_Blackstone_Bricks.png' });

// 木板变体
materials.registerMaterial('oak_planks_1', { textureUrl: './src/assets/textures/Oak_Planks_1.png' });
materials.registerMaterial('acacia_planks', { textureUrl: './src/assets/textures/Acacia_Planks.png' });

// 基岩
materials.registerMaterial('bedrock', { textureUrl: './src/assets/textures/Bedrock.png' });

// ========== 新增方块材质 (6种) ==========
materials.registerMaterial('polished_diorite', { textureUrl: './src/assets/textures/Polished_Diorite.png' });
materials.registerMaterial('polished_granite', { textureUrl: './src/assets/textures/Polished_Granite.png' });
materials.registerMaterial('piston', { textureUrl: './src/assets/textures/Piston.png' });
materials.registerMaterial('piston_head', { textureUrl: './src/assets/textures/Piston_Head.png' });
materials.registerMaterial('mud_bricks', { textureUrl: './src/assets/textures/Mud_Bricks.png' });
materials.registerMaterial('orange_shulker_box', { textureUrl: './src/assets/textures/Orange_Shulker_Box.png' });

// ========== 床方块材质 ==========
// 床头侧面材质 - 只使用纹理下半部分（0.5-1.0），repeat y=0.5 + offset=0.5
// 右侧面（+X）需要水平翻转，左侧面（-X）正常
const bedHeadSideLeft = {
  textureUrl: './src/assets/textures/bed/Bed_(top_side_texture)_JE2_BE2.png',
  repeat: [1, 0.5],
  offset: [0, 0.5]
};
const bedHeadSideRight = {
  textureUrl: './src/assets/textures/bed/Bed_(top_side_texture)_JE2_BE2.png',
  repeat: [-1, 0.5],  // 水平翻转
  offset: [1, 0.5]
};
const bedHeadTop = {
  textureUrl: './src/assets/textures/bed/Bed_(top_texture)_JE1_BE1.png',
  rotation: -Math.PI / 2  // 顺时针旋转90度
};
const bedHeadFront = {
  textureUrl: './src/assets/textures/bed/Bed_(back_texture)_JE2_BE2.png',
  repeat: [1, 0.5],
  offset: [0, 0.5]
};
const bedHeadBack = { transparent: true, opacity: 0 };
const bedHeadBottom = { transparent: true, opacity: 0 };

materials.registerMaterial('bed_head', {
  faces: {
    0: bedHeadSideRight, // +X (右) - 水平翻转
    1: bedHeadSideLeft,  // -X (左) - 正常
    2: bedHeadTop,       // +Y (上)
    3: bedHeadBottom,    // -Y (下)
    4: bedHeadFront,     // +Z (前 - 面向玩家)
    5: bedHeadBack       // -Z (后 - 与床尾连接，透明)
  }
});

// 床尾材质 - 后面显示床尾纹理，前面透明（与床头连接）
// 右侧面（+X）需要水平翻转，左侧面（-X）正常
const bedTailSideLeft = {
  textureUrl: './src/assets/textures/bed/Bed_(bottom_side_texture)_JE2_BE2.png',
  repeat: [1, 0.5],
  offset: [0, 0.5]
};
const bedTailSideRight = {
  textureUrl: './src/assets/textures/bed/Bed_(bottom_side_texture)_JE2_BE2.png',
  repeat: [-1, 0.5],  // 水平翻转
  offset: [1, 0.5]
};
const bedTailTop = { textureUrl: './src/assets/textures/bed/Bed_(bottom_texture)_JE1_BE1.png' };
const bedTailBack = {
  textureUrl: './src/assets/textures/bed/Bed_(front_texture)_JE2_BE2.png',
  repeat: [1, 0.5],
  offset: [0, 0.5]
};
const bedTailFront = { transparent: true, opacity: 0 };
const bedTailBottom = { transparent: true, opacity: 0 };

materials.registerMaterial('bed_tail', {
  faces: {
    0: bedTailSideRight, // +X (右) - 水平翻转
    1: bedTailSideLeft,  // -X (左) - 正常
    2: bedTailTop,       // +Y (上)
    3: bedTailBottom,    // -Y (下)
    4: bedTailFront,     // +Z (前 - 与床头连接，透明)
    5: bedTailBack       // -Z (后 - 面向玩家)
  }
});

materials.registerMaterial('bed_alias_block', {
  color: 0x8B4513,
  roughness: 0.8
});

// ========== 吊灯材质 ==========
// 吊灯使用暖黄色材质带自发光效果
// 使用程序化纹理绘制吊灯形状（细绳 + 灯体）
materials.registerMaterial('hanging_lamp', {
  color: '#aaa49a',            // 背景色
  emissive: '#FFE4B5',         // 自发光颜色（暖黄色）
  emissiveIntensity: 0.8,      // 发光强度
  transparent: true,
  alphaTest: 0.1,
  textureGenerator: (ctx) => {
    // 绘制细绳（深灰色）
    ctx.fillStyle = '#333333';
    ctx.fillRect(30, 0, 4, 20);  // 细绳：宽4像素，高20像素，位于顶部中央

    // 绘制灯体（暖黄色）
    ctx.fillStyle = '#FFE4B5';
    ctx.fillRect(18, 20, 28, 28);  // 灯体：宽28像素，高28像素，位于细绳下方

    // 添加发光效果（更亮的中心）
    ctx.fillStyle = '#FFF5E6';
    ctx.fillRect(24, 26, 16, 16);  // 内部发光区域

    // 添加高光点
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(26, 28, 4, 4);  // 左上高光
  }
});
