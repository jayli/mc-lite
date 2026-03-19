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
// 环境风格配置键
export const VISUAL_STYLE_KEYS = {
  DAY: 'day',
  OVERCAST: 'overcast'
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
    this.currentVisualStyle = VISUAL_STYLE_KEYS.DAY;
    this.visualStyles = {
      [VISUAL_STYLE_KEYS.DAY]: {
        fogColor: FOG_COLOR,
        fogNear: FOG_NEAR,
        fogFar: FOG_FAR,
        directionalLightColor: 0xfffaf0,
        directionalLightIntensity: 3.2,
        ambientLightColor: 0xddeeff,
        ambientLightIntensity: 1,
        backgroundMode: 'skybox',
        backgroundColor: null
      },
      [VISUAL_STYLE_KEYS.OVERCAST]: {
        // 阴天参数参考最初版本 components/main.js
        fogColor: 0x87CEEB,
        fogNear: 20,
        fogFar: 90,
        directionalLightColor: 0xffffff,
        directionalLightIntensity: 1.2,
        ambientLightColor: 0xffffff,
        ambientLightIntensity: 0.5,
        backgroundMode: 'color',
        backgroundColor: 0x87CEEB
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // 设置阴影映射类型为PCF（Percentage-Closer Filtering）软阴影
    this.resolutionScale = 0.7;        // 初始渲染分辨率缩放系数
    this.renderer.setPixelRatio(this.resolutionScale); // 设置渲染器的像素比例，用于控制输出分辨率

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // 应用ACES电影感色调映射，使颜色更接近真实摄影效果
    this.renderer.toneMappingExposure = 1.25; // 设置色调映射曝光值，调整整体亮度

    // 灯光与天空设置
    this.sunDirection = new THREE.Vector3(0, 0.8, 0.6).normalize(); // 设置太阳光方向向量，并归一化为单位向量
    this.sunColor = 0xfff7c2;   // 设置太阳光的颜色（暖黄色）
    this.lightColor = 0xfffaf0; // 设置环境光的颜色（温暖的白色）
    this.zenithColor = 0x87CEEB;  // 设置天顶（天空上方）颜色（浅蓝色）
    this.horizonColor = 0xb2e0f2; // 设置地平线颜色（较浅的蓝白色）

    const light = new THREE.DirectionalLight(this.lightColor, 3.2);
    this.scene.add(light.target);

    light.castShadow = true;  // 启用光源投射阴影
    light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);  // 设置阴影贴图的尺寸

    light.shadow.camera.left = -SHADOW_CAMERA_SIZE;   // 设置阴影相机左侧范围
    light.shadow.camera.right = SHADOW_CAMERA_SIZE;   // 设置阴影相机右侧范围
    light.shadow.camera.top = SHADOW_CAMERA_SIZE;     // 设置阴影相机顶部范围
    light.shadow.camera.bottom = -SHADOW_CAMERA_SIZE; // 设置阴影相机底部范围
    light.shadow.camera.near = 0.1;                   // 设置阴影相机近裁剪面
    light.shadow.camera.far = 400;                    // 设置阴影相机远裁剪面
    light.shadow.bias = 0.0001;                       // 设置阴影偏移，防止阴影自遮挡伪影
    light.shadow.normalBias = 0.078;                  // 设置法线偏移，改善斜面阴影质量

    this.scene.add(light);
    this.ambientLight = new THREE.AmbientLight(0xddeeff, 1);
    this.scene.add(this.ambientLight);

    this.light = light;

    this.createWaterPlane();

    this._tmpVec = new THREE.Vector3();
    this._lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);

    this.createSun();
    this.createSkybox();
    this.setVisualStyle(VISUAL_STYLE_KEYS.DAY);

    this.init();
    this.loadModel();
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
    this.sunSprite.visible = false;
    this.sunSprite.scale.set(20, 20, 1);
    this.scene.add(this.sunSprite);
  }

  createSkybox() {
    const loader = new THREE.CubeTextureLoader();
    this.skyboxTexture = loader.setPath('src/assets/skyBox4/').load([
      'posx.jpg', 'negx.jpg',
      'posy.jpg', 'negy.jpg',
      'posz.jpg', 'negz.jpg'
    ]);
    this.scene.background = this.skyboxTexture;
  }

  getVisualStyle(styleKey) {
    return this.visualStyles[styleKey] || this.visualStyles[VISUAL_STYLE_KEYS.DAY];
  }

  applySurfaceFogFromStyle() {
    const style = this.getVisualStyle(this.currentVisualStyle);
    this.scene.fog.color.set(style.fogColor);
    this.scene.fog.near = style.fogNear;
    this.scene.fog.far = style.fogFar;

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uFogColor.value.set(style.fogColor);
      this.waterMaterial.uniforms.uFogNear.value = style.fogNear;
      this.waterMaterial.uniforms.uFogFar.value = style.fogFar;
    }
  }

  setVisualStyle(styleKey) {
    const targetStyleKey = this.visualStyles[styleKey] ? styleKey : VISUAL_STYLE_KEYS.DAY;
    const style = this.getVisualStyle(targetStyleKey);
    this.currentVisualStyle = targetStyleKey;

    this.light.color.set(style.directionalLightColor);
    this.light.intensity = style.directionalLightIntensity;
    this.ambientLight.color.set(style.ambientLightColor);
    this.ambientLight.intensity = style.ambientLightIntensity;

    if (style.backgroundMode === 'skybox' && this.skyboxTexture) {
      this.scene.background = this.skyboxTexture;
    } else {
      this.scene.background = new THREE.Color(style.backgroundColor || 0x87CEEB);
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

          gl_FragColor = vec4(colorWithFog, uOpacity);
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

    // 定义噪声生成函数，用于地形和水面效果计算
    const getNoise = (x, z, scale) => {
      const nx = x + WORLD_CONFIG.SEED, nz = z + WORLD_CONFIG.SEED;
      return Math.sin(nx * scale) * 2 + Math.cos(nz * scale) * 2;
    };

    // 定义地形高度计算函数，用于判断当前位置是否靠近海洋
    const getHeight = (x, z) => {
      const h = getNoise(x, z, 0.08) + getNoise(x, z, 0.02) * 3;
      const temp = getNoise(x, z, 0.01);
      const hum = getNoise(x + 1000, z + 1000, 0.015);
      if (temp < -1.5) return h * 0.5 + 2;
      if (temp > -1.5 && temp < -0.8 && hum > 0.5) return h * 0.3 - 2;
      return h;
    };

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
        this.scene.fog.color.set(0x103060);    // 设置水下雾的颜色为深蓝色
        this.scene.fog.near = 0.1;             // 设置水下雾的近距范围
        this.scene.fog.far = 15;               // 设置水下雾的远距范围，较短的距离增强水下效果
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
