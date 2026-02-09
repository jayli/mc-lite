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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.resolutionScale = 0.7;        // 初始渲染分辨率缩放系数
    this.renderer.setPixelRatio(this.resolutionScale);

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    // 灯光与天空设置
    this.sunDirection = new THREE.Vector3(0, 0.8, 0.6).normalize();
    this.sunColor = 0xfff7c2;
    this.lightColor = 0xfffaf0;
    this.zenithColor = 0x87CEEB;
    this.horizonColor = 0xb2e0f2;

    const light = new THREE.DirectionalLight(this.lightColor, 3.2);
    this.scene.add(light.target);

    light.castShadow = true;
    light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

    light.shadow.camera.left = -SHADOW_CAMERA_SIZE;
    light.shadow.camera.right = SHADOW_CAMERA_SIZE;
    light.shadow.camera.top = SHADOW_CAMERA_SIZE;
    light.shadow.camera.bottom = -SHADOW_CAMERA_SIZE;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 400;
    light.shadow.bias = 0.0001;
    light.shadow.normalBias = 0.078;

    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xddeeff, 1));

    this.light = light;

    this.createWaterPlane();

    this._tmpVec = new THREE.Vector3();
    this._lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);

    this.createSun();
    this.createSkybox();

    this.init();
    this.loadModel();
  }

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

    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    const sunColor = new THREE.Color(this.sunColor);
    const r = Math.floor(sunColor.r * 255);
    const g = Math.floor(sunColor.g * 255);
    const b = Math.floor(sunColor.b * 255);

    gradient.addColorStop(0, `rgba(255, 205, 177, 1)`);
    gradient.addColorStop(0.1, `rgba(255, 182, 142, 1)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.7)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    const sunMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      fog: false,
      depthTest: true
    });

    this.sunSprite = new THREE.Sprite(sunMaterial);
    this.sunSprite.visible = false;
    this.sunSprite.scale.set(20, 20, 1);
    this.scene.add(this.sunSprite);
  }

  createSkybox() {
    const loader = new THREE.CubeTextureLoader();
    const texture = loader.setPath('src/assets/skyBox4/').load([
      'posx.jpg', 'negx.jpg',
      'posy.jpg', 'negy.jpg',
      'posz.jpg', 'negz.jpg'
    ]);
    this.scene.background = texture;
  }

  createWaterPlane() {
    const waterGeo = new THREE.PlaneGeometry(800, 800);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(WATER_COLOR) },
        uSunDirection: { value: this.sunDirection },
        uOpacity: { value: WATER_OPACITY },
        uSeed: { value: WORLD_CONFIG.SEED },
        uFogColor: { value: new THREE.Color(WATER_FOG_COLOR) },
        uFogNear: { value: 20 },
        uFogFar: { value: 70 }
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

        float getNoise(float x, float z, float scale) {
          return sin((x + uSeed) * scale) * 2.0 + cos((z + uSeed) * scale) * 2.0;
        }

        float getHeight(float x, float z) {
          float h = getNoise(x, z, 0.08) + getNoise(x, z, 0.02) * 3.0;
          float temp = getNoise(x, z, 0.01);
          float hum = getNoise(x + 1000.0, z + 1000.0, 0.015);

          if (temp < -1.5) return h * 0.5 + 2.0;
          if (temp > -1.5 && temp < -0.8 && hum > 0.5) return h * 0.3 - 2.0;
          return h;
        }

        void main() {
          vec2 pos = vWorldPosition.xz;
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float dist = length(vWorldPosition.xz - cameraPosition.xz);

          if (dist < 60.0) {
            bool nearOcean = false;
            if (getHeight(pos.x, pos.y) < -0.8) {
              nearOcean = true;
            } else {
              if (getHeight(pos.x + 4.0, pos.y) < -0.8) nearOcean = true;
              else if (getHeight(pos.x - 4.0, pos.y) < -0.8) nearOcean = true;
              else if (getHeight(pos.x, pos.y + 4.0) < -0.8) nearOcean = true;
              else if (getHeight(pos.x, pos.y - 4.0) < -0.8) nearOcean = true;
              else if (getHeight(pos.x + 3.0, pos.y + 3.0) < -0.8) nearOcean = true;
              else if (getHeight(pos.x - 3.0, pos.y - 3.0) < -0.8) nearOcean = true;
            }

            if (!nearOcean) {
              discard;
            }
          }

          float detailMask = smoothstep(50.0, 30.0, dist);
          float waves = sin(pos.x * 1.5 + uTime * 5.5) * 0.1 + sin(pos.y * 1.3 - uTime * 3.2) * 0.1;
          if (detailMask > 0.0) {
             waves += sin(pos.x * 2.8 + pos.y * 2.2 + uTime * 3.5) * 0.08 * detailMask;
             waves += sin(pos.x * -2.1 + pos.y * 3.7 + uTime * 2.8) * 0.06 * detailMask;
             waves += sin((pos.x + pos.y) * 5.0 + uTime * 4.5) * 0.04 * detailMask;
          }

          vec3 normal = normalize(vec3(waves * 2.0, 1.0, waves * 2.0));

          vec3 halfDir = normalize(uSunDirection + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 100.0) * 8.0 * detailMask;
          float diffuse = max(dot(normal, uSunDirection), 0.0) * 0.15 * detailMask;
          float scatter = (max(0.0, normal.y) * 0.08 + (waves * 0.05)) * detailMask;
          float fresnel = pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), viewDir), 0.0), 3.0);

          vec3 highlightColor = vec3(0.95, 0.98, 1.0);
          vec3 finalColor = uColor + highlightColor * (diffuse + scatter + spec + fresnel * 0.1);

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

    this.faceCullingSystem = new FaceCullingSystem({
      transparentTypes: ['air', 'water']
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
      this.waterMaterial.uniforms.uTime.value += 0.015;
      this.waterMaterial.uniforms.uSeed.value = WORLD_CONFIG.SEED;
    }

    if (this.waterPlane) {
      this.waterPlane.position.x = this.camera.position.x;
      this.waterPlane.position.z = this.camera.position.z;
    }

    const camX = this.camera.position.x;
    const camY = this.camera.position.y;
    const camZ = this.camera.position.z;
    const waterLevel = WATER_LEVEL_OFFSET;

    const getNoise = (x, z, scale) => {
      const nx = x + WORLD_CONFIG.SEED, nz = z + WORLD_CONFIG.SEED;
      return Math.sin(nx * scale) * 2 + Math.cos(nz * scale) * 2;
    };

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

    if (camY < waterLevel && isNearOcean) {
      if (!this.isUnderwater) {
        this.scene.fog.color.set(0x103060);
        this.scene.fog.near = 0.1;
        this.scene.fog.far = 15;
        this.isUnderwater = true;

        if (this.waterMaterial) {
          this.waterMaterial.uniforms.uFogColor.value.set(0x103060);
          this.waterMaterial.uniforms.uFogNear.value = 0.1;
          this.waterMaterial.uniforms.uFogFar.value = 15;
        }
      }
    } else {
      if (this.isUnderwater) {
        this.scene.fog.color.set(FOG_COLOR);
        this.scene.fog.near = FOG_NEAR;
        this.scene.fog.far = FOG_FAR;
        this.isUnderwater = false;

        if (this.waterMaterial) {
          this.waterMaterial.uniforms.uFogColor.value.set(FOG_COLOR);
          this.waterMaterial.uniforms.uFogNear.value = FOG_NEAR;
          this.waterMaterial.uniforms.uFogFar.value = FOG_FAR;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  toggleFaceCulling() {
    if (this.faceCullingSystem.isEnabled()) {
      this.faceCullingSystem.disable('manual toggle');
      console.log('隐藏面剔除已禁用');
    } else {
      this.faceCullingSystem.enable();
      console.log('隐藏面剔除已启用');
    }
  }

  toggleFaceCullingDebug() {
    this.faceCullingSystem.toggleDebug();
    console.log('隐藏面剔除调试模式:', this.faceCullingSystem.isDebugMode() ? '开启' : '关闭');
  }

  getFaceCullingStats() {
    if (!this.faceCullingSystem) {
      return { error: '系统未初始化' };
    }
    return this.faceCullingSystem.getStats();
  }

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

  forceFaceCullingUpdate() {
    if (this.faceCullingSystem && this.faceCullingSystem.isEnabled()) {
      this.faceCullingSystem.forceUpdate();
      console.log('强制更新隐藏面剔除状态');
    }
  }

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

  clearFaceCullingDebug() {
    if (this.faceCullingSystem) {
      this.faceCullingSystem.clearDebugObjects();
      console.log('调试可视化已清理');
    }
  }
}
