/**
 * Minecart.js
 * 矿车实体类 - 管理矿车的模型、碰撞和拾取逻辑
 */

import * as THREE from 'three';
import { getRotationAngle } from '../../utils/OrientationUtils.js';

// 矿车配置常量
export const MINECART_CONFIG = {
  // 车斗尺寸 (约 0.8x0.4x0.8 方块)
  BODY_SIZE: { width: 0.9, height: 0.8, depth: 0.9 },
  // 车轮尺寸
  WHEEL_RADIUS: 0.2,
  WHEEL_HEIGHT: 0.1,
  // 车轮轴距 (前后轮间距)
  WHEELBASE: 0.6,
  // 轮距 (左右轮间距)
  TRACK_WIDTH: 0.6,
  // 整体高度 (车斗底部到车轮底部)
  TOTAL_HEIGHT: 0.9,
  // 碰撞盒尺寸
  BOUNDING_BOX: { width: 1.0, height: 0.9, depth: 1.0 }
};

export class Minecart {
  /**
   * @param {Object} params - 初始化参数
   * @param {string} params.id - 唯一标识符
   * @param {THREE.Vector3} params.position - 矿车位置（方块坐标）
   * @param {number} params.orientation - 朝向 (0-3: EAST/SOUTH/WEST/NORTH)
   * @param {THREE.Scene} params.scene - Three.js 场景
   * @param {World} params.world - 世界引用
   */
  constructor(params) {
    this.id = params.id;
    this.position = params.position.clone();
    this.orientation = params.orientation || 0;
    this.scene = params.scene;
    this.world = params.world;

    // 状态
    this.state = 'PLACED'; // 'PLACED' | 'PICKED_UP' | 'DESTROYED'

    // 回调
    this.onDestroy = params.onDestroy || null;

    // Three.js 对象
    this.mesh = null;  // THREE.Group 包含车斗和车轮

    // 归属 chunk 键
    this.chunkKey = null;

    // 初始化视觉表现
    this.createVisuals();
  }

  /**
   * 创建矿车的视觉表现
   */
  createVisuals() {
    // 创建容器组
    this.mesh = new THREE.Group();

    // 创建车斗
    this.createBody();

    // 创建四个车轮
    this.createWheels();

    // 设置位置和旋转
    this.updateTransform();

    // 添加到场景
    if (this.scene) {
      this.scene.add(this.mesh);
    }
  }

  /**
   * 创建车斗几何体 - 倒梯形形状（上宽下窄）
   */
  createBody() {
    const { width, height, depth } = MINECART_CONFIG.BODY_SIZE;

    // 倒梯形参数：顶部尺寸保持不变，底部往内收缩
    const shrinkRatio = 0.8; // 底部收缩比例（底部宽度 = 顶部宽度 * shrinkRatio）
    const topWidth = width;
    const topDepth = depth;
    const bottomWidth = width * shrinkRatio;
    const bottomDepth = depth * shrinkRatio;

    // 创建倒梯形几何体
    const bodyGeometry = this.createTrapezoidGeometry(
      topWidth, topDepth, bottomWidth, bottomDepth, height
    );

    // 车斗材质 - 木质棕色
    const bodyMaterial = new THREE.MeshLambertMaterial({
      color: 0x8B4513,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide // 确保内外都可见
    });

    // 车斗
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.set(0, height / 2 + MINECART_CONFIG.WHEEL_RADIUS, 0);

    this.mesh.add(body);

    // 存储以便后续清理
    if (!this._meshes) this._meshes = [];
    this._meshes.push({ mesh: body, geometry: bodyGeometry, material: bodyMaterial });
  }

  /**
   * 创建倒梯形几何体
   * @param {number} topWidth - 顶部宽度
   * @param {number} topDepth - 顶部深度
   * @param {number} bottomWidth - 底部宽度
   * @param {number} bottomDepth - 底部深度
   * @param {number} height - 高度
   * @returns {THREE.BufferGeometry}
   */
  createTrapezoidGeometry(topWidth, topDepth, bottomWidth, bottomDepth, height) {
    const geometry = new THREE.BufferGeometry();

    // 计算半宽/半深，使几何体中心在原点
    const tw = topWidth / 2;   // 顶部半宽
    const td = topDepth / 2;   // 顶部半深
    const bw = bottomWidth / 2; // 底部半宽
    const bd = bottomDepth / 2; // 底部半深
    const h = height / 2;       // 半高

    // 8个顶点：底部4个 + 顶部4个
    // 底部顶点（y = -h，即底部）
    // 顶部顶点（y = +h，即顶部，开口）
    const vertices = new Float32Array([
      // 底部四个顶点
      -bw, -h, -bd,  // 0: 底部后左
       bw, -h, -bd,  // 1: 底部后右
       bw, -h,  bd,  // 2: 底部前右
      -bw, -h,  bd,  // 3: 底部前左
      // 顶部四个顶点
      -tw,  h, -td,  // 4: 顶部后左
       tw,  h, -td,  // 5: 顶部后右
       tw,  h,  td,  // 6: 顶部前右
      -tw,  h,  td,  // 7: 顶部前左
    ]);

    // 定义面的顶点索引（使用逆时针顺序，从外部看）
    // 每个面由两个三角形组成
    const indices = [
      // 底部面（顺时针从下往上看，即逆时针从外部看）
      0, 2, 1,
      0, 3, 2,

      // 前面（z+方向，顶点 3,2,6,7）
      3, 6, 7,
      3, 2, 6,

      // 后面（z-方向，顶点 1,0,4,5）
      1, 4, 5,
      1, 0, 4,

      // 左面（x-方向，顶点 0,3,7,4）
      0, 7, 4,
      0, 3, 7,

      // 右面（x+方向，顶点 2,1,5,6）
      2, 5, 6,
      2, 1, 5,
    ];

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * 创建四个车轮
   */
  createWheels() {
    const { WHEEL_RADIUS, WHEEL_HEIGHT, WHEELBASE, TRACK_WIDTH } = MINECART_CONFIG;

    // 车轮材质 - 金属灰色
    const wheelMaterial = new THREE.MeshLambertMaterial({
      color: 0x555555
    });

    // 车轮几何体 (圆柱体)
    const wheelGeometry = new THREE.CylinderGeometry(
      WHEEL_RADIUS,
      WHEEL_RADIUS,
      WHEEL_HEIGHT,
      8
    );

    // 四个车轮的位置 (相对于矿车中心)
    const wheelPositions = [
      { x: -TRACK_WIDTH / 2, z: WHEELBASE / 2 },   // 左前
      { x: TRACK_WIDTH / 2, z: WHEELBASE / 2 },    // 右前
      { x: -TRACK_WIDTH / 2, z: -WHEELBASE / 2 },  // 左后
      { x: TRACK_WIDTH / 2, z: -WHEELBASE / 2 }    // 右后
    ];

    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      // 圆柱体默认沿 Y 轴，旋转使其沿 X 轴（横向）
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos.x, WHEEL_RADIUS, pos.z);
      this.mesh.add(wheel);

      if (!this._meshes) this._meshes = [];
      this._meshes.push({ mesh: wheel, geometry: wheelGeometry, material: wheelMaterial });
    });
  }

  /**
   * 更新位置和旋转
   */
  updateTransform() {
    if (!this.mesh) return;

    // 设置位置 (矿车在方块中心上方)
    this.mesh.position.set(
      this.position.x + 0.5,
      this.position.y,
      this.position.z + 0.5
    );

    // 设置旋转 (根据 orientation)
    const rotationAngle = getRotationAngle(this.orientation);
    this.mesh.rotation.y = rotationAngle;
  }

  /**
   * 获取碰撞边界盒
   * @returns {THREE.Box3}
   */
  getBoundingBox() {
    const { width, height, depth } = MINECART_CONFIG.BOUNDING_BOX;
    const min = new THREE.Vector3(
      this.position.x + (1 - width) / 2,
      this.position.y,
      this.position.z + (1 - depth) / 2
    );
    const max = new THREE.Vector3(
      this.position.x + (1 + width) / 2,
      this.position.y + height,
      this.position.z + (1 + depth) / 2
    );
    return new THREE.Box3(min, max);
  }

  /**
   * 更新矿车状态 (每帧调用)
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    if (this.state === 'DESTROYED') return;

    // 当前版本矿车静止，无移动逻辑
    // 后续迭代可在此添加沿铁轨移动逻辑
  }

  /**
   * 销毁矿车
   */
  destroy() {
    if (this.state === 'DESTROYED') return;

    this.state = 'DESTROYED';

    // 清理视觉表现
    if (this.mesh) {
      // 从场景移除
      if (this.scene) {
        this.scene.remove(this.mesh);
      }

      // 释放 geometry 和 material
      if (this._meshes) {
        this._meshes.forEach(({ mesh, geometry, material }) => {
          if (geometry) geometry.dispose();
          if (material) material.dispose();
        });
        this._meshes = [];
      }

      this.mesh = null;
    }

    // 通知管理器移除自己
    if (this.onDestroy) {
      this.onDestroy(this.id);
    }
  }

  /**
   * 获取矿车当前状态
   * @returns {Object}
   */
  getState() {
    return {
      id: this.id,
      state: this.state,
      position: this.position,
      orientation: this.orientation
    };
  }

  /**
   * 序列化为持久化格式
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      orientation: this.orientation
    };
  }

  /**
   * 从持久化数据恢复
   * @param {Object} data - 持久化数据
   * @param {THREE.Scene} scene - 场景
   * @param {World} world - 世界引用
   * @returns {Minecart}
   */
  static fromJSON(data, scene, world) {
    return new Minecart({
      id: data.id,
      position: new THREE.Vector3(data.x, data.y, data.z),
      orientation: data.orientation,
      scene,
      world
    });
  }
}
