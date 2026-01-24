// src/core/Engine.js
// 引入 Three.js 库
import * as THREE from 'three';

// 定义并导出 Engine 类，用于管理游戏的核心渲染引擎
export class Engine {
  // Engine 类的构造函数
  constructor() {
    // 创建一个新的 Three.js 场景
    this.scene = new THREE.Scene();
    // 设置场景的背景颜色为天蓝色
    this.scene.background = new THREE.Color(0x87CEEB);
    // 在场景中添加雾效，颜色与背景色相同，从距离20开始，到距离90完全遮挡
    this.scene.fog = new THREE.Fog(0x87CEEB, 20, 90);

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
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    // 启用渲染器的阴影贴图
    this.renderer.shadowMap.enabled = true;

    // --- 灯光与天空设置 ---
    this.sunDirection = new THREE.Vector3(1, 0.8, 0.5).normalize();
    this.sunColor = 0xffcc74; // 暖黄色
    this.lightColor = 0xfdf7ec; // 暖白色

    // 创建一个平行光
    const light = new THREE.DirectionalLight(this.lightColor, 1.2);
    // 关键优化：将 light.target 直接添加到场景中，方便后续同步
    this.scene.add(light.target);

    // 允许此光源投射阴影
    light.castShadow = true;
    // 设置阴影贴图的分辨率（根据需要调整：512, 1024, 2048）
    light.shadow.mapSize.set(1024, 1024);
    // 设置平行光阴影相机的视锥体范围
    light.shadow.camera.left = -40;
    light.shadow.camera.right = 40;
    light.shadow.camera.top = 40;
    light.shadow.camera.bottom = -40;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 200;
    light.shadow.bias = -0.001;
    light.shadow.normalBias = 0.02;

    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xfff6f6, 0.8));

    this.light = light;

    // 预分配向量以优化性能，避免在主循环中产生垃圾回收
    this._tmpVec = new THREE.Vector3();
    this._lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);

    // 创建太阳
    this.createSun();

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

    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.8)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    const sunMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false // 确保太阳不会被云彩或其他远距离物体遮挡 (模拟无限远)
    });

    this.sunSprite = new THREE.Sprite(sunMaterial);
    this.sunSprite.scale.set(30, 30, 1);
    this.scene.add(this.sunSprite);
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
    // 使用指定的场景和相机来渲染一帧
    this.renderer.render(this.scene, this.camera);
  }
}
