// src/core/Engine.js
// 引入 Three.js 库
import * as THREE from 'three';
import { SEED } from '../utils/MathUtils.js';

// 定义并导出 Engine 类，用于管理游戏的核心渲染引擎
export class Engine {
  // Engine 类的构造函数
  constructor() {
    // 创建一个新的 Three.js 场景
    this.scene = new THREE.Scene();
    // 场景背景设为 null，因为我们将使用天空球
    this.scene.background = null;
    // 在场景中添加雾效，颜色与地平线相同，从距离20开始，到距离70完全遮挡
    this.scene.fog = new THREE.Fog(0x62b4d5, 20, 70);

    // 创建一个透视相机
    // 参数分别为：视野角度(FOV)，宽高比，近裁剪面，远裁剪面
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
    this.renderer.setPixelRatio(0.6);

    // --- 氛围渲染优化 ---
    // 设置电影级色调映射，使高亮部分不过曝成纯白，而是有自然的色彩过渡
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25; // 提升全局曝光，让阳光感更强

    // --- 灯光与天空设置 ---
    this.sunDirection = new THREE.Vector3(1, 0.8, 0.5).normalize();
    this.sunColor = 0xfff7c2; // 温暖的金黄色
    this.lightColor = 0xfffaf0; // 极亮的暖白色
    this.zenithColor = 0x87CEEB;  // 顶点颜色 (深蓝)
    this.horizonColor = 0xb2e0f2; // 地平线颜色 (浅蓝)

    // 创建一个平行光
    const light = new THREE.DirectionalLight(this.lightColor, 2.2); // 强度大幅提升
    // 关键优化：将 light.target 直接添加到场景中，方便后续同步
    this.scene.add(light.target);

    // 允许此光源投射阴影
    light.castShadow = true;
    // 设置阴影贴图的分辨率（根据需要调整：512, 1024, 2048）
    light.shadow.mapSize.set(612, 612);
    // 设置平行光阴影相机的视锥体范围
    light.shadow.camera.left = -40;
    light.shadow.camera.right = 40;
    light.shadow.camera.top = 40;
    light.shadow.camera.bottom = -40;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 400;
    light.shadow.bias = -0.000;
    light.shadow.normalBias = 0.02;

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
    this.createSky();

    // 调用初始化方法
    this.init();
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
    this.sunSprite.scale.set(20, 20, 1);
    this.scene.add(this.sunSprite);
  }

  // 创建渐变天空球
  createSky() {
    const skyGeo = new THREE.SphereGeometry(180, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(this.zenithColor) },
        bottomColor: { value: new THREE.Color(this.horizonColor) },
        offset: { value: 33 },
        exponent: { value: 0.6 }
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

    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyMesh);
  }

  // 创建全局水面平面
  createWaterPlane() {
    const waterGeo = new THREE.PlaneGeometry(800, 800);

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x4488ff) },
        uSunDirection: { value: this.sunDirection },
        uOpacity: { value: 0.6 },
        uSeed: { value: SEED },
        uFogColor: { value: new THREE.Color(0xa7d1e2) },
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
            if (getHeight(pos.x, pos.y) < -1.8) {
              nearOcean = true;
            } else {
              if (getHeight(pos.x + 4.0, pos.y) < -1.8) nearOcean = true;
              else if (getHeight(pos.x - 4.0, pos.y) < -1.8) nearOcean = true;
              else if (getHeight(pos.x, pos.y + 4.0) < -1.8) nearOcean = true;
              else if (getHeight(pos.x, pos.y - 4.0) < -1.8) nearOcean = true;
              else if (getHeight(pos.x + 3.0, pos.y + 3.0) < -1.8) nearOcean = true;
              else if (getHeight(pos.x - 3.0, pos.y - 3.0) < -1.8) nearOcean = true;
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
    this.waterPlane.rotation.x = -Math.PI / 2;
    this.waterPlane.position.y = -2.15;
    this.scene.add(this.waterPlane);
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
    // --- 主场景渲染阶段 ---
    // 更新水面动画时间
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value += 0.015;
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
    const waterLevel = -2.0;

    // --- 模拟高度计算以判断是否在“近海”区域 ---
    const getNoise = (x, z, scale) => {
      const nx = x + SEED, nz = z + SEED;
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
    if (getHeight(camX, camZ) < -1.8) {
      isNearOcean = true;
    } else {
      // 检查周围 4 个单位
      if (getHeight(camX + 4, camZ) < -1.8 || getHeight(camX - 4, camZ) < -1.8 ||
          getHeight(camX, camZ + 4) < -1.8 || getHeight(camX, camZ - 4) < -1.8) {
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
        this.scene.fog.color.set(0x62b4d5);
        this.scene.fog.near = 20;
        this.scene.fog.far = 60;
        this.isUnderwater = false;

        if (this.waterMaterial) {
          this.waterMaterial.uniforms.uFogColor.value.set(0x62b4d5);
          this.waterMaterial.uniforms.uFogNear.value = 20;
          this.waterMaterial.uniforms.uFogFar.value = 60;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
