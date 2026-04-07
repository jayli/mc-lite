// 引入 Three.js 库
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { FaceCullingSystem, faceCullingSystem } from './FaceCullingSystem.js';

// --- 引擎配置常量 ---
// 海平面相比陆地中心 y=0 的偏移量
export const WATER_LEVEL_OFFSET = -1.5;
// 环境雾的颜色 (天蓝色)
export const FOG_COLOR = 0x94bcf5;
// 水面的基本颜色
export const WATER_COLOR = 0x588be4;
// 水面的初始透明度
export const WATER_OPACITY = 0.7;
// 海面可见半径：与区块可见范围接近（RENDER_DIST=3, CHUNK_SIZE=16 => 48），额外加少量缓冲
export const WATER_VISIBLE_DISTANCE = 80;
// 海面边缘淡出带宽，避免突然裁切
export const WATER_EDGE_FADE_BAND = 15;
// 水下雾的颜色 (更深的蓝色)
export const WATER_FOG_COLOR = 0xa7d1e2;
// 雾的起始距离（米）
export const FOG_NEAR = 30;
// 雾的完全覆盖距离（米）
export const FOG_FAR = 70;
// 阴影贴图的分辨率大小（像素）
export const SHADOW_MAP_SIZE = 512;
// 阴影相机的覆盖范围大小（米）
export const SHADOW_CAMERA_SIZE = 30;
// 阴影相机远裁剪面：收紧覆盖范围，降低阴影渲染开销
export const SHADOW_CAMERA_FAR = 250;
// 环境风格配置键
export const VISUAL_STYLE_KEYS = {
  MORNING: 'morning',
  OVERCAST: 'overcast',
  NIGHT: 'night'
};

export let carModel = null;      // 汽车模型缓存
export let gunManModel = null;   // 枪手模型缓存
export let gunModel = null;      // 普通手枪模型缓存
export let mag7Model = null;     // MAG7 散弹枪模型缓存
export let minigunModel = null;  // 加特林机枪模型缓存

/**
 * Engine 类
 * 管理游戏的核心渲染引擎，包括场景、相机、渲染器、灯光、水面和天空
 */
export class Engine {
  constructor() {
    // 1. 核心三维场景初始化
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    this.isUnderwater = false;
    this.currentVisualStyle = VISUAL_STYLE_KEYS.MORNING;
    this.visualStyles = {
      [VISUAL_STYLE_KEYS.MORNING]: {
        // 早晨风格：贴近参考图的暖色晨光 + 蓝紫天空 + 柔和阴影
        fogColor: 0xb7c6f7,
        fogNear: 42,
        fogFar: 115,
        directionalLightColor: 0xffe9c9,
        directionalLightIntensity: 2.65,
        moonDirectionalLightColor: 0xc7d8ff,
        moonDirectionalLightIntensity: 0.12,
        ambientLightColor: 0xc8d7ff,
        ambientLightIntensity: 1.25,
        backgroundMode: 'skybox',
        backgroundColor: null,
        sunDirection: [0.18, 0.45, 0.88],
        moonDirection: [-0.38, 0.45, -0.81],
        toneMappingExposure: 1.35,
        sunVisible: false,
        moonVisible: false,
        moonSize: 20,
        colorSaturate: 1.15,
        colorContrast: 1.1,
        colorBrightness: 1.06,
        backgroundBlurriness: 0,
        skyboxKey: 'skyBox4'
      },
      [VISUAL_STYLE_KEYS.OVERCAST]: {
        // 阴天参数参考最初版本 components/main.js
        fogColor: 0x87CEEB,
        fogNear: 30,
        fogFar: 65,
        directionalLightColor: 0xffffff,
        directionalLightIntensity: 1.2,
        moonDirectionalLightColor: 0xb8c8f5,
        moonDirectionalLightIntensity: 0.05,
        ambientLightColor: 0xffffff,
        ambientLightIntensity: 0.5,
        backgroundMode: 'color',
        backgroundColor: 0x87CEEB,
        sunDirection: [0, 0.8, 0.6],
        moonDirection: [-0.25, 0.5, -0.82],
        toneMappingExposure: 1.25,
        sunVisible: false,
        moonVisible: false,
        moonSize: 18,
        colorSaturate: 1,
        colorContrast: 1,
        colorBrightness: 1
      },
      [VISUAL_STYLE_KEYS.NIGHT]: {
        // 黑夜风格：低照度、蓝色环境光、星空天空盒；雾距拉远到可视边界外
        fogColor: 0x050b1e,
        fogNear: 1200,
        fogFar: 2400,
        directionalLightColor: 0x9cbcff,
        directionalLightIntensity: 0.22,
        moonDirectionalLightColor: 0xcddcff,
        moonDirectionalLightIntensity: 5,
        ambientLightColor: 0x5d79b7,
        ambientLightIntensity: 5,
        backgroundMode: 'skybox',
        backgroundColor: null,
        sunDirection: [0.08, 0.25, 0.96],
        moonDirection: [-0.32, 0.58, -0.75],
        toneMappingExposure: 0.95,
        sunVisible: false,
        moonVisible: true,
        moonSize: 34,
        colorSaturate: 1.08,
        colorContrast: 1.12,
        colorBrightness: 0.75,
        backgroundBlurriness: 0.28,
        skyboxKey: 'skyBox1'
      }
    };

    // 2. 相机初始化 (FOV, Aspect, Near, Far)
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.rotation.order = 'YXZ'; // 关键：锁定 YXZ 顺序以匹配 FPS 视角控制
    this.scene.add(this.camera);

    // 3. 渲染器初始化
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,               // 关闭抗锯齿以换取性能
      powerPreference: "high-performance" // 提示浏览器使用高性能 GPU
    });
    this.renderer.shadowMap.enabled = true; // 启用阴影系统
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 设置阴影映射类型为更柔和的 PCF 软阴影
    // 性能优化：关闭每帧自动更新阴影，仅在场景关键变化时按需刷新
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.resolutionScale = 0.6;        // 初始渲染分辨率缩放系数
    this.renderer.setPixelRatio(this.resolutionScale); // 设置渲染器的像素比例，用于控制输出分辨率

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // 应用ACES电影感色调映射，使颜色更接近真实摄影效果
    this.renderer.toneMappingExposure = 1.25; // 设置色调映射曝光值，调整整体亮度

    // 灯光与天空设置
    this.sunDirection = new THREE.Vector3(0, 0.8, 0.6).normalize(); // 设置太阳光方向向量，并归一化为单位向量
    this.moonDirection = new THREE.Vector3(-0.28, 0.55, -0.78).normalize(); // 设置月光方向向量（更偏斜，营造柔和侧光）
    this.sunColor = 0xfff7c2;   // 设置太阳光的颜色（暖黄色）
    this.lightColor = 0xfffaf0; // 设置环境光的颜色（温暖的白色）
    this.zenithColor = 0x9fb7f7;  // 设置天顶颜色（偏蓝紫）
    this.horizonColor = 0xf7c9a8; // 设置地平线颜色（暖色晚霞）

    const light = new THREE.DirectionalLight(this.lightColor, 3.2);
    this.scene.add(light.target);

    light.castShadow = true;  // 启用光源投射阴影
    light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);  // 设置阴影贴图的尺寸

    light.shadow.camera.left = -SHADOW_CAMERA_SIZE;   // 设置阴影相机左侧范围
    light.shadow.camera.right = SHADOW_CAMERA_SIZE;   // 设置阴影相机右侧范围
    light.shadow.camera.top = SHADOW_CAMERA_SIZE;     // 设置阴影相机顶部范围
    light.shadow.camera.bottom = -SHADOW_CAMERA_SIZE; // 设置阴影相机底部范围
    light.shadow.camera.near = 0.1;                   // 设置阴影相机近裁剪面
    light.shadow.camera.far = SHADOW_CAMERA_FAR;      // 设置阴影相机远裁剪面（收紧至玩家活动核心区域）
    light.shadow.bias = 0.00008;                      // 设置阴影偏移，防止阴影自遮挡伪影
    light.shadow.normalBias = 0.048;                  // 设置法线偏移，改善斜面阴影质量
    light.shadow.radius = 2.6;                        // 阴影边缘轻微软化

    this.scene.add(light);

    // 月光平行光：默认弱光，主要在黑夜风格下提供柔和补光
    const moonLight = new THREE.DirectionalLight(0xcddcff, 0.02);
    this.scene.add(moonLight.target);
    moonLight.castShadow = false;
    this.scene.add(moonLight);

    this.ambientLight = new THREE.AmbientLight(0xddeeff, 1);
    this.scene.add(this.ambientLight);

    this.light = light;
    this.moonLight = moonLight;

    this.createWaterPlane();

    this._tmpVec = new THREE.Vector3();
    this._lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);
    this._underwaterColor = new THREE.Color(0x103060); // 预分配水下颜色对象避免GC

    this.createSun();
    this.createMoon();
    this.createSkybox();
    this.setVisualStyle(VISUAL_STYLE_KEYS.MORNING);

    // 预绑定水面渲染用的噪声和高度计算方法，避免每帧创建函数
    this._getNoise = this._getNoise.bind(this);
    this._getHeight = this._getHeight.bind(this);

    this.init();
    this.loadModel();
  }

  /**
   * 噪声生成函数 - 用于地形和水面效果计算
   * 预绑定到实例，避免每帧创建闭包
   */
  _getNoise(x, z, scale) {
    const nx = x + WORLD_CONFIG.SEED, nz = z + WORLD_CONFIG.SEED;
    return Math.sin(nx * scale) * 2 + Math.cos(nz * scale) * 2;
  }

  /**
   * 地形高度计算函数 - 用于判断当前位置是否靠近海洋
   * 预绑定到实例，避免每帧创建闭包
   */
  _getHeight(x, z) {
    const h = this._getNoise(x, z, 0.08) + this._getNoise(x, z, 0.02) * 3;
    const temp = this._getNoise(x, z, 0.01);
    const hum = this._getNoise(x + 1000, z + 1000, 0.015);
    if (temp < -1.5) return h * 0.5 + 2;
    if (temp > -1.5 && temp < -0.8 && hum > 0.5) return h * 0.3 - 2;
    return h;
  }

  /**
   * 加载游戏所需的各种3D模型资源，包括汽车、人物、武器等模型
   * 对每个模型进行标准化处理，包括居中、缩放和材质设置
   */
  loadModel() {
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('src/assets/mod/free_car_001.gltf', (gltf) => {
      const car = gltf.scene;
      const box = new THREE.Box3().setFromObject(car);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      car.position.set(-center.x, -box.min.y, -center.z);

      const carParent = new THREE.Group();
      carParent.add(car);

      const targetSize = new THREE.Vector3(3, 3, 5);
      carParent.scale.set(
        targetSize.x / size.x,
        targetSize.y / size.y,
        targetSize.z / size.z
      );

      carModel = carParent;
    });

    const mtlLoader = new MTLLoader();
    mtlLoader.load('src/assets/mod/gun_man.mtl', (materials) => {
      materials.preload();
      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      objLoader.load('src/assets/mod/gun_man.obj', (model) => {
        model.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(m => {
                  m.side = THREE.DoubleSide;
                  m.transparent = true;
                  m.alphaTest = 0.5;
                });
              } else {
                child.material.side = THREE.DoubleSide;
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
              }
            }
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        model.position.set(-center.x, -box.min.y, -center.z);

        const parent = new THREE.Group();
        parent.add(model);

        const targetHeight = 2.0;
        const scale = targetHeight / (size.y || 1);
        parent.scale.set(scale, scale, scale);

        gunManModel = parent;
      }, undefined, (error) => {
        console.error('Failed to load gun_man.obj:', error);
      });
    }, undefined, (error) => {
      console.error('Failed to load gun_man.mtl:', error);
    });

    gltfLoader.load('src/assets/mod/silahful.glb', (gltf) => {
      const model = gltf.scene;
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      model.position.set(-center.x, -center.y, -center.z);
      model.rotation.y = Math.PI;

      const group = new THREE.Group();
      group.add(model);

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.0 / (maxDim || 1);
      group.scale.set(scale, scale, scale);

      gunModel = group;
      console.log('Gun model loaded successfully and normalized');
    }, undefined, (error) => {
      console.error('Failed to load silahful.glb:', error);
    });

    gltfLoader.load('src/assets/mod/mag7.glb', (gltf) => {
      const model = gltf.scene;
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      model.position.set(-center.x, -center.y, -center.z);
      model.rotation.y = Math.PI;

      const group = new THREE.Group();
      group.add(model);

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.0 / (maxDim || 1);
      group.scale.set(scale, scale, scale);

      mag7Model = group;
      console.log('MAG7 model loaded successfully and normalized');
    }, undefined, (error) => {
      console.error('Failed to load mag7.glb:', error);
    });

    gltfLoader.load('src/assets/mod/minigun.glb', (gltf) => {
      const model = gltf.scene;
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      model.position.set(-center.x, -center.y, -center.z);
      model.rotation.y = Math.PI;

      const group = new THREE.Group();
      group.add(model);

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.0 / (maxDim || 1);
      group.scale.set(scale, scale, scale);

      minigunModel = group;
      console.log('Minigun model loaded successfully and normalized');
    }, undefined, (error) => {
      console.error('Failed to load minigun.glb:', error);
    });
  }

  setResolution(scale) {
    this.resolutionScale = scale;
    this.renderer.setPixelRatio(scale);
    this.onResize();
  }

  createSun() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');

    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64); // 创建径向渐变用于绘制太阳图像
    const sunColor = new THREE.Color(this.sunColor);
    const r = Math.floor(sunColor.r * 255);
    const g = Math.floor(sunColor.g * 255);
    const b = Math.floor(sunColor.b * 255);

    gradient.addColorStop(0, `rgba(255, 205, 177, 1)`);      // 设置渐变起始色（中心亮黄色）
    gradient.addColorStop(0.1, `rgba(255, 182, 142, 1)`);    // 设置渐变中间色（橙黄色）
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.7)`); // 设置渐变过渡色（太阳本色，半透明）
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);    // 设置渐变结束色（完全透明）

    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128); // 填充渐变矩形到canvas画布

    const texture = new THREE.CanvasTexture(canvas);
    const sunMaterial = new THREE.SpriteMaterial({
      map: texture,       // 使用上面创建的canvas纹理
      transparent: true,  // 启用透明度混合
      fog: false,         // 禁用雾效，保持太阳光亮
      depthTest: true     // 启用深度测试，确保太阳在正确位置渲染
    });

    this.sunSprite = new THREE.Sprite(sunMaterial); // 创建精灵对象用于渲染太阳
    this.sunSprite.visible = true;
    this.sunSprite.scale.set(28, 28, 1);
    this.scene.add(this.sunSprite);
  }

  createMoon() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');

    // 先画柔和月晕，再画满月圆盘，确保是“大大的圆形满月”
    const glow = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    glow.addColorStop(0.45, 'rgba(226, 236, 255, 0.35)');
    glow.addColorStop(1, 'rgba(200, 220, 255, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, 256, 256);

    const moonGradient = context.createRadialGradient(112, 112, 16, 128, 128, 64);
    moonGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    moonGradient.addColorStop(0.55, 'rgba(245, 248, 255, 1)');
    moonGradient.addColorStop(1, 'rgba(216, 226, 246, 1)');
    context.fillStyle = moonGradient;
    context.beginPath();
    context.arc(128, 128, 60, 0, Math.PI * 2);
    context.fill();

    const texture = new THREE.CanvasTexture(canvas);
    const moonMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      fog: false,
      depthTest: true
    });

    this.moonSprite = new THREE.Sprite(moonMaterial);
    this.moonSprite.visible = false;
    this.moonSprite.scale.set(34, 34, 1);
    this.scene.add(this.moonSprite);
  }

  createSkybox() {
    const loader = new THREE.CubeTextureLoader();
    const faces = ['posx.jpg', 'negx.jpg', 'posy.jpg', 'negy.jpg', 'posz.jpg', 'negz.jpg'];
    const skybox4 = loader.setPath('src/assets/skyBox4/').load(faces);
    const skybox1 = loader.setPath('src/assets/skyBox1/').load(faces);
    this.configureSkyboxTexture(skybox4);
    this.configureSkyboxTexture(skybox1);
    this.skyboxTextures = {
      skyBox4: skybox4,
      skyBox1: skybox1
    };
    this.skyboxTexture = this.skyboxTextures.skyBox4;
    this.scene.background = this.skyboxTexture;
  }

  configureSkyboxTexture(texture) {
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }

  getSkyboxTextureByStyle(style) {
    const skyboxKey = style?.skyboxKey || 'skyBox4';
    return this.skyboxTextures?.[skyboxKey] || this.skyboxTexture;
  }

  getVisualStyle(styleKey) {
    return this.visualStyles[styleKey] || this.visualStyles[VISUAL_STYLE_KEYS.MORNING];
  }

  applySurfaceFogFromStyle() {
    const style = this.getVisualStyle(this.currentVisualStyle);

    // 早晨和黑夜不显示雾效果
    const noFogStyles = [VISUAL_STYLE_KEYS.MORNING, VISUAL_STYLE_KEYS.NIGHT];
    if (noFogStyles.includes(this.currentVisualStyle)) {
      this.scene.fog = null;
    } else {
      // 重新启用雾（如果之前被禁用）
      if (!this.scene.fog) {
        this.scene.fog = new THREE.Fog(style.fogColor, style.fogNear, style.fogFar);
      } else {
        this.scene.fog.color.set(style.fogColor);
        this.scene.fog.near = style.fogNear;
        this.scene.fog.far = style.fogFar;
      }
    }

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uFogColor.value.set(style.fogColor);
      this.waterMaterial.uniforms.uFogNear.value = style.fogNear;
      this.waterMaterial.uniforms.uFogFar.value = style.fogFar;
    }

    // 恢复对应风格的背景（修复：需处理所有背景模式）
    const styleSkyboxTexture = this.getSkyboxTextureByStyle(style);
    if (style.backgroundMode === 'skybox' && styleSkyboxTexture) {
      this.scene.background = styleSkyboxTexture;
      this.scene.backgroundBlurriness = style.backgroundBlurriness ?? 0;
    } else if (style.backgroundMode === 'fogColor') {
      this.scene.background = new THREE.Color(style.fogColor);
      this.scene.backgroundBlurriness = 0;
    } else {
      this.scene.background = new THREE.Color(style.backgroundColor || 0x87CEEB);
      this.scene.backgroundBlurriness = 0;
    }
  }

  setVisualStyle(styleKey) {
    const targetStyleKey = this.visualStyles[styleKey] ? styleKey : VISUAL_STYLE_KEYS.MORNING;
    const style = this.getVisualStyle(targetStyleKey);
    this.currentVisualStyle = targetStyleKey;

    this.light.color.set(style.directionalLightColor);
    this.light.intensity = style.directionalLightIntensity;
    if (this.moonLight) {
      this.moonLight.color.set(style.moonDirectionalLightColor || 0xcddcff);
      this.moonLight.intensity = style.moonDirectionalLightIntensity ?? 0.02;
    }
    this.ambientLight.color.set(style.ambientLightColor);
    this.ambientLight.intensity = style.ambientLightIntensity;
    if (Array.isArray(style.sunDirection) && style.sunDirection.length === 3) {
      this.sunDirection.set(style.sunDirection[0], style.sunDirection[1], style.sunDirection[2]).normalize();
      this.requestShadowMapUpdate();
    }
    if (Array.isArray(style.moonDirection) && style.moonDirection.length === 3) {
      this.moonDirection.set(style.moonDirection[0], style.moonDirection[1], style.moonDirection[2]).normalize();
    }
    if (typeof style.toneMappingExposure === 'number') {
      this.renderer.toneMappingExposure = style.toneMappingExposure;
    }
    this.colorSaturate = style.colorSaturate ?? 1;
    this.colorContrast = style.colorContrast ?? 1;
    this.colorBrightness = style.colorBrightness ?? 1;
    this._applyColorGrading();

    if (this.sunSprite) {
      this.sunSprite.visible = style.sunVisible !== false;
    }
    if (this.moonSprite) {
      this.moonSprite.visible = style.moonVisible === true;
      const moonSize = style.moonSize ?? 28;
      this.moonSprite.scale.set(moonSize, moonSize, 1);
    }

    const styleSkyboxTexture = this.getSkyboxTextureByStyle(style);
    if (style.backgroundMode === 'skybox' && styleSkyboxTexture) {
      this.scene.background = styleSkyboxTexture;
      this.scene.backgroundBlurriness = style.backgroundBlurriness ?? 0;
    } else if (style.backgroundMode === 'fogColor') {
      this.scene.background = new THREE.Color(style.fogColor);
      this.scene.backgroundBlurriness = 0;
    } else {
      this.scene.background = new THREE.Color(style.backgroundColor || 0x87CEEB);
      this.scene.backgroundBlurriness = 0;
    }

    // 水下时仍保持水下雾，离开水下后再回到当前风格雾参数
    if (!this.isUnderwater) {
      this.applySurfaceFogFromStyle();
    }
  }

  /**
   * 创建水面平面和相关的着色器材质
   * 设置水面的几何形状、波浪效果、反射特性等
   */
  createWaterPlane() {
    const waterGeo = new THREE.PlaneGeometry(800, 800);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },                        // 时间变量，用于波浪动画
        uColor: { value: new THREE.Color(WATER_COLOR) }, // 水面基础颜色
        uSunDirection: { value: this.sunDirection }, // 太阳光照方向
        uOpacity: { value: WATER_OPACITY },          // 水面透明度
        uSeed: { value: WORLD_CONFIG.SEED },         // 世界种子，用于噪声函数一致性
        uFogColor: { value: new THREE.Color(WATER_FOG_COLOR) }, // 水下雾的颜色
        uFogNear: { value: 20 },                     // 水下雾的近距范围
        uFogFar: { value: 70 }                      // 水下雾的远距范围
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying float vDepth;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mvPosition.z;

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uSunDirection;
        uniform float uOpacity;
        uniform float uSeed;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec3 vWorldPosition;
        varying float vDepth;

        // 简化的地形高度函数（仅用于水面遮罩）
        float getTerrainHeight(float x, float z) {
          float nx = x + uSeed, nz = z + uSeed;
          return sin(nx * 0.08) * 2.0 + cos(nz * 0.08) * 2.0 + sin(nx * 0.02) * 6.0 + cos(nz * 0.02) * 6.0;
        }

        void main() {
          vec2 pos = vWorldPosition.xz;
          float dist = length(pos - cameraPosition.xz);
          float waterFade = 1.0 - smoothstep(${(WATER_VISIBLE_DISTANCE - WATER_EDGE_FADE_BAND).toFixed(1)}, ${WATER_VISIBLE_DISTANCE.toFixed(1)}, dist);
          if (waterFade <= 0.001) discard;

          // 水域遮罩：只在靠近海洋的地方显示水面（切入岸边约4个方块）
          if (dist < 100.0) {
            float h = getTerrainHeight(pos.x, pos.y);
            // 检查中心点和周围4个方向，确保在海岸附近
            bool nearOcean = h < -0.8;
            if (!nearOcean) {
              const float offset = 3.5;
              nearOcean = getTerrainHeight(pos.x + offset, pos.y) < -0.8 ||
                          getTerrainHeight(pos.x - offset, pos.y) < -0.8 ||
                          getTerrainHeight(pos.x, pos.y + offset) < -0.8 ||
                          getTerrainHeight(pos.x, pos.y - offset) < -0.8;
            }
            if (!nearOcean) discard;
          }

          // LOD：远距离减少计算
          float detailMask = smoothstep(50.0, 25.0, dist);

          // 基础波纹（始终计算）
          float waves = sin(pos.x * 1.5 + uTime * 5.5) * 0.1 + sin(pos.y * 1.3 - uTime * 3.2) * 0.1;

          // 细节波纹（仅近距离计算）
          if (detailMask > 0.0) {
             waves += sin(pos.x * 2.8 + pos.y * 2.2 + uTime * 3.5) * 0.08 * detailMask;
             waves += sin(pos.x * -2.1 + pos.y * 3.7 + uTime * 2.8) * 0.06 * detailMask;
          }

          // 法线和视角方向
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          vec3 normal = normalize(vec3(waves * 2.0, 1.0, waves * 2.0));

          // 太阳光镜面反射（Blinn-Phong）
          vec3 halfDir = normalize(uSunDirection + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 100.0) * 8.0 * detailMask;

          // 漫反射和环境散射
          float diffuse = max(dot(normal, uSunDirection), 0.0) * 0.15 * detailMask;
          float scatter = max(0.0, normal.y) * 0.08 * detailMask;

          // Fresnel 边缘高光
          float fresnel = pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), viewDir), 0.0), 3.0);

          // 合成颜色
          vec3 highlightColor = vec3(0.95, 0.98, 1.0);
          vec3 finalColor = uColor + highlightColor * (diffuse + scatter + spec + fresnel * 0.1);

          // 雾效
          float fogFactor = smoothstep(uFogNear, uFogFar, vDepth);
          vec3 colorWithFog = mix(finalColor, uFogColor, fogFactor);

          gl_FragColor = vec4(colorWithFog, uOpacity * waterFade);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.waterPlane = new THREE.Mesh(waterGeo, this.waterMaterial);
    this.waterPlane.rotation.x = -Math.PI / 2;
    this.waterPlane.position.y = WATER_LEVEL_OFFSET;
    this.scene.add(this.waterPlane);

    // 初始化隐藏面剔除系统，用于优化渲染性能
    this.faceCullingSystem = new FaceCullingSystem({
      transparentTypes: ['air', 'water']  // 指定透明类型的方块，用于确定面剔除规则
    });

    this.faceCullingSystem.enable();
    this.faceCullingSystem.initDebugScene(this.scene);

    this.faceCullingSystem.on('update', (stats) => {
      if (stats.optimizationRate > 0.3) {
        console.log(`隐藏面剔除优化率: ${(stats.optimizationRate * 100).toFixed(1)}%`);
      }
    });

    this.faceCullingSystem.on('error', (error) => {
      console.warn('隐藏面剔除系统错误:', error);
    });

    this.faceCullingSystem.on('performanceWarning', (warning) => {
      console.warn('性能警告:', warning.warnings.join(', '));
    });

    console.log('隐藏面剔除系统已集成到渲染引擎');
  }

  init() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.onResize());

    // 初始化色彩分级（色调偏移）
    if (typeof this.colorHueShift !== 'number') this.colorHueShift = 0;
    if (typeof this.colorSaturate !== 'number') this.colorSaturate = 1;
    if (typeof this.colorContrast !== 'number') this.colorContrast = 1;
    if (typeof this.colorBrightness !== 'number') this.colorBrightness = 1;
    this._applyColorGrading();
  }

  /**
   * 应用色彩分级效果到渲染画布
   * 使用 CSS filter 实现色调偏移
   */
  _applyColorGrading() {
    const canvas = this.renderer.domElement;
    if (canvas) {
      canvas.style.filter = `hue-rotate(${this.colorHueShift}deg) saturate(${this.colorSaturate}) contrast(${this.colorContrast}) brightness(${this.colorBrightness})`;
    }
  }

  /**
   * 设置色调偏移值
   * @param {number} hueShift - 色调偏移度数（正值偏暖，负值偏冷）
   */
  setColorHueShift(hueShift) {
    this.colorHueShift = hueShift;
    this._applyColorGrading();
  }

  /**
   * 获取当前色调偏移值
   * @returns {number}
   */
  getColorHueShift() {
    return this.colorHueShift;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render() {
    if (this.faceCullingSystem && this.faceCullingSystem.isEnabled()) {
    }

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value += 0.015;    // 更新时间变量，驱动水面波浪动画
      this.waterMaterial.uniforms.uSeed.value = WORLD_CONFIG.SEED; // 同步世界种子，确保噪声函数的一致性
    }

    if (this.waterPlane) {
      this.waterPlane.position.x = this.camera.position.x;  // 将水面跟随相机在X轴移动，营造无限水面效果
      this.waterPlane.position.z = this.camera.position.z;  // 将水面跟随相机在Z轴移动，营造无限水面效果
    }

    const camX = this.camera.position.x;
    const camY = this.camera.position.y;
    const camZ = this.camera.position.z;
    const waterLevel = WATER_LEVEL_OFFSET;

    // 直接使用预绑定的方法，避免每帧创建函数
    const getHeight = this._getHeight;

    let isNearOcean = false;
    if (getHeight(camX, camZ) < -0.8) {
      isNearOcean = true;
    } else {
      if (getHeight(camX + 4, camZ) < -0.8 || getHeight(camX - 4, camZ) < -0.8 ||
          getHeight(camX, camZ + 4) < -0.8 || getHeight(camX, camZ - 4) < -0.8) {
        isNearOcean = true;
      }
    }

    // 检测玩家是否在水下，并相应地更改雾效设置
    if (camY < waterLevel && isNearOcean) {
      if (!this.isUnderwater) {
        if (!this.scene.fog) {
          this.scene.fog = new THREE.Fog(0x103060, 0.1, 15);
        } else {
          this.scene.fog.color.set(0x103060);    // 设置水下雾的颜色为深蓝色
          this.scene.fog.near = 0.1;             // 设置水下雾的近距范围
          this.scene.fog.far = 15;               // 设置水下雾的远距范围，较短的距离增强水下效果
        }
        this.scene.background = this._underwaterColor; // 使用预分配的颜色对象
        this.isUnderwater = true;              // 标记玩家处于水下状态

        if (this.waterMaterial) {
          this.waterMaterial.uniforms.uFogColor.value.set(0x103060); // 更新水面材质的水下雾颜色
          this.waterMaterial.uniforms.uFogNear.value = 0.1;          // 更新水面材质的水下雾近距范围
          this.waterMaterial.uniforms.uFogFar.value = 15;            // 更新水面材质的水下雾远距范围
        }
      }
    } else {
      if (this.isUnderwater) {
        this.isUnderwater = false;
        this.applySurfaceFogFromStyle();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 请求下一帧刷新阴影贴图（按需刷新）
   */
  requestShadowMapUpdate() {
    if (!this.renderer?.shadowMap?.enabled) return;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * 切换隐藏面剔除系统的启用/禁用状态
   * 输出当前状态到控制台
   */
  toggleFaceCulling() {
    if (this.faceCullingSystem.isEnabled()) {
      this.faceCullingSystem.disable('manual toggle');
      console.log('隐藏面剔除已禁用');
    } else {
      this.faceCullingSystem.enable();
      console.log('隐藏面剔除已启用');
    }
  }

  /**
   * 切换隐藏面剔除系统的调试模式
   * 在控制台输出当前调试模式状态
   */
  toggleFaceCullingDebug() {
    this.faceCullingSystem.toggleDebug();
    console.log('隐藏面剔除调试模式:', this.faceCullingSystem.isDebugMode() ? '开启' : '关闭');
  }

  /**
   * 获取隐藏面剔除系统的统计信息
   * @returns {Object} 包含系统状态和统计数据的对象
   */
  getFaceCullingStats() {
    if (!this.faceCullingSystem) {
      return { error: '系统未初始化' };
    }
    return this.faceCullingSystem.getStats();
  }

  /**
   * 打印隐藏面剔除系统的详细状态信息
   * 在控制台输出格式化的统计数据
   */
  printFaceCullingStats() {
    const stats = this.getFaceCullingStats();
    console.group('隐藏面剔除系统状态');
    console.log('启用状态:', stats.enabled ? '是' : '否');
    console.log('调试模式:', stats.debugMode ? '是' : '否');
    console.log('处理方块数:', stats.totalBlocksProcessed);
    console.log('剔除面数:', stats.facesCulled);
    console.log('渲染面数:', stats.facesRendered);
    console.log('优化率:', (stats.optimizationRate * 100).toFixed(1) + '%');
    console.log('最后更新时间:', stats.updateTime.toFixed(2) + 'ms');
    console.log('错误计数:', stats.errorCount);
    if (stats.lastError) {
      console.log('最后错误:', stats.lastError);
    }
    console.groupEnd();
  }

  /**
   * 强制更新隐藏面剔除系统的状态
   * 在控制台输出操作结果
   */
  forceFaceCullingUpdate() {
    if (this.faceCullingSystem && this.faceCullingSystem.isEnabled()) {
      this.faceCullingSystem.forceUpdate();
      console.log('强制更新隐藏面剔除状态');
    }
  }

  /**
   * 启动隐藏面剔除系统的调试测试
   * 添加预定义的测试方块到调试场景中
   */
  testFaceCullingDebug() {
    if (!this.faceCullingSystem) return;
    this.faceCullingSystem.setDebugMode(true);

    const testPositions = [
      new THREE.Vector3(0, 2, -5),
      new THREE.Vector3(2, 2, -5),
      new THREE.Vector3(-2, 2, -5)
    ];

    const testMasks = [
      0b00111111,
      0b00010101,
      0b00101010
    ];

    for (let i = 0; i < testPositions.length; i++) {
      this.faceCullingSystem.addDebugBlock(
        `test-block-${i}`,
        testPositions[i],
        testMasks[i]
      );
    }

    console.log('调试可视化测试已启动，添加了', testPositions.length, '个测试方块');
  }

  /**
   * 清理隐藏面剔除系统的调试对象
   * 在控制台输出操作结果
   */
  clearFaceCullingDebug() {
    if (this.faceCullingSystem) {
      this.faceCullingSystem.clearDebugObjects();
      console.log('调试可视化已清理');
    }
  }
}
