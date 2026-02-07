// 引入 Three.js 库
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { FaceCullingSystem, faceCullingSystem } from './FaceCullingSystem.js';

// 海平面相比陆地低多少
const warterLeverHightOffset = -1.5;
// 雾颜色
const forgColor = 0x94bcf5; // 原单色天空球的雾色：0x62b4d5
const waterColor = 0x588be4; // 原来的颜色 0x4488ff; // 水颜色
const waterOpacity = 0.7; // 水透明度
const waterForgColor = 0xa7d1e2; // 水雾颜色
export let carModel = null;
export let gunManModel = null;
export let gunModel = null;
export let mag7Model = null;

// 定义并导出 Engine 类，用于管理游戏的核心渲染引擎
export class Engine {
  // Engine 类的构造函数
  constructor() {
    // 创建一个新的 Three.js 场景
    this.scene = new THREE.Scene();
    // 场景背景设为 null，因为我们将使用天空球
    this.scene.background = null;
    // 在场景中添加雾效
    // forgColor: 雾的颜色（浅蓝色），与背景/地平线颜色匹配
    // 20: 雾开始出现的近距，此距离内物体完全清晰
    // 70: 雾完全覆盖的远距，此距离外物体被完全遮盖，用于平滑过渡区块卸载的边界
    this.scene.fog = new THREE.Fog(forgColor, 30, 70);

    // 创建一个透视相机
    // 75: 视野角度 (FOV)，典型第一人称游戏设定
    // innerWidth / innerHeight: 宽高比，自动适配窗口
    // 0.1: 近裁剪面，物体离相机多近时开始不可见
    // 200: 远裁剪面，物体离相机多远时开始不可见，应大于雾的最大距离 (70)
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    // 设置相机的旋转顺序为 YXZ，这对于第一人称控制器很重要
    this.camera.rotation.order = 'YXZ';
    // 将相机添加到场景中
    this.scene.add(this.camera);

    // 创建一个 WebGL 渲染器
    // antialias: false 禁用抗锯齿，以提高性能
    // powerPreference: "high-performance" 请求高性能模式
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance"
    });
    // 启用渲染器的阴影贴图
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.resolutionScale = 0.7;
    this.renderer.setPixelRatio(this.resolutionScale);

    // --- 氛围渲染优化 ---
    // ACESFilmicToneMapping: 电影级色调映射，使高亮部分不过曝成纯白，而是有自然的色彩过渡，提升视觉质感
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25; // 全局曝光度，提升到 1.25 使阳光感更强，画面更明亮

    // --- 灯光与天空设置 ---
    // 太阳位置, x 水平1（越大，越靠右），高度，z 水平2（越大，越低）
    this.sunDirection = new THREE.Vector3(0, 0.8, 0.6).normalize(); // 初始太阳方向向量
    this.sunColor = 0xfff7c2; // 太阳本体颜色 (金黄色)
    this.lightColor = 0xfffaf0; // 阳光颜色 (接近白色的暖黄色)
    this.zenithColor = 0x87CEEB;  // 天空顶点颜色 (深蓝色)
    this.horizonColor = 0xb2e0f2; // 天空地平线颜色 (浅蓝色)

    // 创建一个平行光 (模拟太阳光)
    const light = new THREE.DirectionalLight(this.lightColor, 3.2); // 强度 3.2，提供强烈的直射光照
    // 关键优化：将 light.target 直接添加到场景中，方便后续同步灯光指向的方向
    this.scene.add(light.target);

    // 允许此光源投射阴影
    light.castShadow = true;
    // 设置阴影贴图的分辨率，更高的值意味着更清晰的阴影，但会增加 GPU 开销
    light.shadow.mapSize.set(712, 712);
    // 设置平行光阴影相机的视锥体范围，决定了阴影覆盖的区域大小
    var shadowSize = 30;
    light.shadow.camera.left = -1 * shadowSize;
    light.shadow.camera.right = shadowSize;
    light.shadow.camera.top = shadowSize;
    light.shadow.camera.bottom = -1 * shadowSize;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 400;
    // shadow.bias: 阴影偏移，用于减少阴影失真 (shadow acne)
    // normalBias: 法线偏移，通过沿表面法线偏移深度来进一步优化阴影边缘
    light.shadow.bias = 0.0001;
    light.shadow.normalBias = 0.078;

    this.scene.add(light);
    // 环境光：使用微弱的冷蓝色（天空散射光），与暖色阳光形成对比，增加画面的层次感
    this.scene.add(new THREE.AmbientLight(0xddeeff, 1));

    this.light = light;

    // 创建全局水面
    this.createWaterPlane();

    // 预分配向量以优化性能，避免在主循环中产生垃圾回收
    this._tmpVec = new THREE.Vector3();
    this._lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);

    // 创建太阳
    this.createSun();
    // 创建渐变天空
    // this.createSky();
    this.createSkybox();

    // 调用初始化方法
    this.init();
    this.loadModel();
  }
  loadModel() {
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('src/world/assets/mod/free_car_001.gltf', (gltf) => {
      const car = gltf.scene;
      // 计算边界框
      const box = new THREE.Box3().setFromObject(car);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      // 平移使基座底部中心位于 (0,0,0)
      car.position.set(-center.x, -box.min.y, -center.z);

      const carParent = new THREE.Group();
      carParent.add(car);

      // 目标尺寸：长(Z)=5, 宽(X)=3, 高(Y)=3
      const targetSize = new THREE.Vector3(3, 3, 5);
      carParent.scale.set(
        targetSize.x / size.x,
        targetSize.y / size.y,
        targetSize.z / size.z
      );

      carModel = carParent;
    });

    const mtlLoader = new MTLLoader();
    mtlLoader.load('src/world/assets/mod/gun_man.mtl', (materials) => {
      materials.preload();
      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      objLoader.load('src/world/assets/mod/gun_man.obj', (model) => {
        // 遍历设置阴影和材质属性
        model.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            // 确保材质可见
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

        // 平移使基座底部中心位于 (0,0,0)
        model.position.set(-center.x, -box.min.y, -center.z);

        const parent = new THREE.Group();
        parent.add(model);

        // 目标尺寸：高度设为 2 个方块高度
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

    gltfLoader.load('src/world/assets/mod/silahful.glb', (gltf) => {
      const model = gltf.scene;

      // 遍历设置阴影
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // 计算边界框并进行标准化处理
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // 平移模型使其中心位于原点，并旋转 180 度使枪口向前 (-Z 方向)
      model.position.set(-center.x, -center.y, -center.z);
      model.rotation.y = Math.PI;

      const group = new THREE.Group();
      group.add(model);

      // 将模型缩放到一个标准的单位大小 (最大维度为 1)，方便在 Player.js 中进一步微调
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.0 / (maxDim || 1);
      group.scale.set(scale, scale, scale);

      gunModel = group;
      console.log('Gun model loaded successfully and normalized');
    }, undefined, (error) => {
      console.error('Failed to load silahful.glb:', error);
    });

    gltfLoader.load('src/world/assets/mod/mag7.glb', (gltf) => {
      const model = gltf.scene;

      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // 标准化：中心归零，并根据需要调整朝向
      model.position.set(-center.x, -center.y, -center.z);
      // MAG7 可能需要不同的初始旋转，先参考 gun 的设置
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
  }


  // 设置渲染分辨率倍率
  setResolution(scale) {
    this.resolutionScale = scale;
    this.renderer.setPixelRatio(scale);
    // 更新渲染器尺寸以应用新的像素比
    this.onResize();
  }

  // 创建太阳 Sprite
  createSun() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');

    // 创建径向渐变
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    const sunColor = new THREE.Color(this.sunColor);
    const r = Math.floor(sunColor.r * 255);
    const g = Math.floor(sunColor.g * 255);
    const b = Math.floor(sunColor.b * 255);

    // 优化渐变：添加白色核心，提升亮度
    gradient.addColorStop(0, `rgba(255, 205, 177, 1)`); // 核心纯白
    gradient.addColorStop(0.1, `rgba(255, 182, 142, 1)`); // 亮色过渡
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.7)`); // 太阳原色，开始变淡
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`); // 边缘全透明

    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    const sunMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      fog: false, // 太阳不受雾效影响，保持明亮
      depthTest: true // 开启深度测试，允许被方块遮挡
    });

    this.sunSprite = new THREE.Sprite(sunMaterial);
    this.sunSprite.visible = false; // 天空盒已包含太阳，隐藏程序化太阳
    // 太阳形状
    this.sunSprite.scale.set(20, 20, 1);
    this.scene.add(this.sunSprite);
  }

  createSkybox() {
    const loader = new THREE.CubeTextureLoader();
    const texture = loader.setPath('src/world/assets/skyBox4/').load([
      'posx.jpg', 'negx.jpg',
      'posy.jpg', 'negy.jpg',
      'posz.jpg', 'negz.jpg'
    ]);
    this.scene.background = texture;
  }

  // 创建渐变天空球
  createSky() {
    // 180: 球体半径，必须大于相机远裁剪面以防被裁剪
    const skyGeo = new THREE.SphereGeometry(180, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(this.zenithColor) },
        bottomColor: { value: new THREE.Color(this.horizonColor) },
        offset: { value: 33 }, // 颜色过渡的垂直偏移量
        exponent: { value: 0.6 } // 渐变指数，值越小渐变越陡峭
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize( vWorldPosition + offset ).y;
          gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h, 0.0 ), exponent ), 0.0 ) ), 1.0 );
        }
      `,
      side: THREE.BackSide,
      depthWrite: false
    });

    // this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    // this.scene.add(this.skyMesh);
  }

  // 创建全局水面平面
  createWaterPlane() {
    const waterGeo = new THREE.PlaneGeometry(800, 800);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(waterColor) },
        uSunDirection: { value: this.sunDirection },
        uOpacity: { value: waterOpacity },
        uSeed: { value: WORLD_CONFIG.SEED },
        uFogColor: { value: new THREE.Color(waterForgColor) },
        uFogNear: { value: 20 },
        uFogFar: { value: 70 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying float vDepth;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;

          // 计算相对于相机的深度
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

          if (temp < -1.5) return h * 0.5 + 2.0; // DESERT
          if (temp > -1.5 && temp < -0.8 && hum > 0.5) return h * 0.3 - 2.0; // SWAMP
          return h;
        }

        void main() {
          vec2 pos = vWorldPosition.xz;
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float dist = length(vWorldPosition.xz - cameraPosition.xz);

          // --- 陆地/海洋显示逻辑 ---
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

          // 1. 距离掩码 (控制波纹细节)
          float detailMask = smoothstep(50.0, 30.0, dist);

          // 2. 波动计算
          float waves = sin(pos.x * 1.5 + uTime * 5.5) * 0.1 + sin(pos.y * 1.3 - uTime * 3.2) * 0.1;
          if (detailMask > 0.0) {
             waves += sin(pos.x * 2.8 + pos.y * 2.2 + uTime * 3.5) * 0.08 * detailMask;
             waves += sin(pos.x * -2.1 + pos.y * 3.7 + uTime * 2.8) * 0.06 * detailMask;
             waves += sin((pos.x + pos.y) * 5.0 + uTime * 4.5) * 0.04 * detailMask;
          }

          vec3 normal = normalize(vec3(waves * 2.0, 1.0, waves * 2.0));

          // 3. 太阳镜面反射
          vec3 halfDir = normalize(uSunDirection + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 100.0) * 8.0 * detailMask;

          // 4. 漫反射与背景散射
          float diffuse = max(dot(normal, uSunDirection), 0.0) * 0.15 * detailMask;
          float scatter = (max(0.0, normal.y) * 0.08 + (waves * 0.05)) * detailMask;

          // 5. 菲涅尔
          float fresnel = pow(1.0 - max(dot(vec3(0.0, 1.0, 0.0), viewDir), 0.0), 3.0);

          // 最终颜色混合
          vec3 highlightColor = vec3(0.95, 0.98, 1.0);
          vec3 finalColor = uColor + highlightColor * (diffuse + scatter + spec + fresnel * 0.1);

          // --- 雾效计算 ---
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
    this.waterPlane.rotation.x = -Math.PI / 2; // 将平面旋转到水平位置
    this.waterPlane.position.y = warterLeverHightOffset; // 设置水平面高度，略低于地面基准面
    this.scene.add(this.waterPlane);

    // --- 隐藏面剔除系统初始化 ---
    this.faceCullingSystem = new FaceCullingSystem({
      transparentTypes: ['air', 'water']
    });

    // 启用系统
    this.faceCullingSystem.enable();

    // 设置调试场景
    this.faceCullingSystem.initDebugScene(this.scene);

    // 监听系统事件
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

  // 初始化方法
  init() {
    // 设置渲染器的尺寸为窗口的内部宽高
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // 将渲染器的 DOM 元素（canvas）添加到 body 中
    document.body.appendChild(this.renderer.domElement);

    // 添加窗口大小变化的监听事件，当窗口大小改变时调用 onResize 方法
    window.addEventListener('resize', () => this.onResize());
  }

  // 窗口大小变化时的回调函数
  onResize() {
    // 更新相机的宽高比
    this.camera.aspect = window.innerWidth / window.innerHeight;
    // 更新相机的投影矩阵
    this.camera.updateProjectionMatrix();
    // 更新渲染器的尺寸
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // 渲染方法
  render() {
    // --- 隐藏面剔除系统更新 ---
    if (this.faceCullingSystem && this.faceCullingSystem.isEnabled()) {
      // 这里可以添加基于相机位置的区块更新逻辑
      // 实际实现将在后续任务中与World.js集成时完成
    }

    // --- 主场景渲染阶段 ---
    // 更新水面动画时间
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value += 0.015;
      // 强制同步种子，确保存档加载后的水面一致性
      this.waterMaterial.uniforms.uSeed.value = WORLD_CONFIG.SEED;
    }

    // 水面跟随相机移动
    if (this.waterPlane) {
      this.waterPlane.position.x = this.camera.position.x;
      this.waterPlane.position.z = this.camera.position.z;
    }

    // 动态水下雾效更新
    const camX = this.camera.position.x;
    const camY = this.camera.position.y;
    const camZ = this.camera.position.z;
    const waterLevel = warterLeverHightOffset; // 动态水雾效果高度，和waterPlane.position.y要一起配合配置

    // --- 模拟高度计算以判断是否在“近海”区域 ---
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
      // 检查周围 4 个单位
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
        this.scene.fog.color.set(forgColor);
        this.scene.fog.near = 20;
        this.scene.fog.far = 60;
        this.isUnderwater = false;

        if (this.waterMaterial) {
          this.waterMaterial.uniforms.uFogColor.value.set(forgColor);
          this.waterMaterial.uniforms.uFogNear.value = 20;
          this.waterMaterial.uniforms.uFogFar.value = 60;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  // --- 隐藏面剔除系统调试方法 ---

  /**
   * 切换隐藏面剔除系统
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
   * 切换调试模式
   */
  toggleFaceCullingDebug() {
    this.faceCullingSystem.toggleDebug();
    console.log('隐藏面剔除调试模式:', this.faceCullingSystem.isDebugMode() ? '开启' : '关闭');
  }

  /**
   * 获取隐藏面剔除系统状态
   * @returns {Object} 系统状态
   */
  getFaceCullingStats() {
    if (!this.faceCullingSystem) {
      return { error: '系统未初始化' };
    }
    return this.faceCullingSystem.getStats();
  }

  /**
   * 打印隐藏面剔除系统状态
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
   * 强制更新所有区块的可见面状态
   */
  forceFaceCullingUpdate() {
    if (this.faceCullingSystem && this.faceCullingSystem.isEnabled()) {
      this.faceCullingSystem.forceUpdate();
      console.log('强制更新隐藏面剔除状态');
    }
  }

  /**
   * 测试调试可视化
   */
  testFaceCullingDebug() {
    if (!this.faceCullingSystem) return;

    // 启用调试模式
    this.faceCullingSystem.setDebugMode(true);

    // 添加测试方块
    const testPositions = [
      new THREE.Vector3(0, 2, -5),
      new THREE.Vector3(2, 2, -5),
      new THREE.Vector3(-2, 2, -5)
    ];

    const testMasks = [
      0b00111111, // 所有面可见
      0b00010101, // 上、北、东面可见
      0b00101010  // 下、南、西面可见
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
   * 清理调试可视化
   */
  clearFaceCullingDebug() {
    if (this.faceCullingSystem) {
      this.faceCullingSystem.clearDebugObjects();
      console.log('调试可视化已清理');
    }
  }
}
