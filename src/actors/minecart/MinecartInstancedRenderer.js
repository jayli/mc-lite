/**
 * MinecartInstancedRenderer.js
 * 矿车 InstancedMesh 批量渲染器
 *
 * 使用 Three.js 的 InstancedMesh 技术高效渲染大量矿车实体。
 * 通过批量渲染减少 draw call，显著提升渲染性能。
 *
 * 设计原则：
 * - 单一几何体共享：所有矿车共享同一组几何体和材质
 * - 实例化渲染：通过矩阵变换实现每个实例的独立位置/旋转
 * - 参照 ZombieInstancedRenderer 设计
 */

import * as THREE from 'three';

// ============================================================================
// 配置参数
// ============================================================================

/**
 * 默认最大渲染数量
 */
const DEFAULT_MAX_COUNT = 50;

/**
 * 矿车部件尺寸配置
 */
const MINECART_SIZES = {
  /** 车斗尺寸 */
  body: { width: 0.9, height: 0.8, depth: 0.9 },
  /** 车轮半径 */
  wheelRadius: 0.2,
  /** 车轮高度 */
  wheelHeight: 0.1,
  /** 轴距（前后轮间距） */
  wheelbase: 0.6,
  /** 轮距（左右轮间距） */
  trackWidth: 0.6
};

/**
 * 矿车颜色配置
 */
const MINECART_COLORS = {
  /** 车斗颜色 - 木质棕色 */
  body: 0x8B4513,
  /** 车轮颜色 - 金属灰色 */
  wheel: 0x555555
};

// ============================================================================
// 矿车实例化渲染器类
// ============================================================================

/**
 * 矿车实例化渲染器类
 *
 * 负责高效渲染大量矿车实体，使用 InstancedMesh 技术减少 draw call。
 */
export class MinecartInstancedRenderer {
  /**
   * 构造函数
   * @param {THREE.Scene} scene - Three.js 场景对象
   * @param {number} maxCount - 最大可渲染的矿车数量
   */
  constructor(scene, maxCount = DEFAULT_MAX_COUNT) {
    this.scene = scene;
    this.maxCount = maxCount;

    // 实例映射：索引 -> 矿车对象
    this.instanceMap = [];

    // 初始化共享资源（几何体、材质）
    this.initResources();

    // 创建实例化网格
    this.initInstancedMeshes();

    // 将所有网格添加到场景
    this.addToScene();

    // 复用的临时对象（性能优化：避免每帧创建新对象）
    this.dummy = new THREE.Object3D();
    this._tempMatrix = new THREE.Matrix4();
  }

  // --------------------------------------------------------------------------
  // 初始化方法
  // --------------------------------------------------------------------------

  /**
   * 初始化共享资源
   * 创建所有矿车实例共用的几何体和材质
   */
  initResources() {
    // 创建车斗几何体（倒梯形）
    this.bodyGeometry = this.createTrapezoidGeometry();

    // 创建车轮几何体（圆柱体）
    this.wheelGeometry = new THREE.CylinderGeometry(
      MINECART_SIZES.wheelRadius,
      MINECART_SIZES.wheelRadius,
      MINECART_SIZES.wheelHeight,
      8
    );

    // 创建材质
    this.bodyMaterial = new THREE.MeshLambertMaterial({
      color: MINECART_COLORS.body,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });

    this.wheelMaterial = new THREE.MeshLambertMaterial({
      color: MINECART_COLORS.wheel
    });
  }

  /**
   * 创建倒梯形车斗几何体
   * @returns {THREE.BufferGeometry}
   */
  createTrapezoidGeometry() {
    const { width, height, depth } = MINECART_SIZES.body;

    // 倒梯形参数：顶部尺寸保持不变，底部往内收缩
    const shrinkRatio = 0.8;
    const topWidth = width;
    const topDepth = depth;
    const bottomWidth = width * shrinkRatio;
    const bottomDepth = depth * shrinkRatio;

    const geometry = new THREE.BufferGeometry();

    // 计算半宽/半深，使几何体中心在原点
    const tw = topWidth / 2;
    const td = topDepth / 2;
    const bw = bottomWidth / 2;
    const bd = bottomDepth / 2;
    const h = height / 2;

    // 8个顶点：底部4个 + 顶部4个
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

    // 定义面的顶点索引
    const indices = [
      // 底部面
      0, 2, 1,
      0, 3, 2,
      // 前面
      3, 6, 7,
      3, 2, 6,
      // 后面
      1, 4, 5,
      1, 0, 4,
      // 左面
      0, 7, 4,
      0, 3, 7,
      // 右面
      2, 5, 6,
      2, 1, 5,
    ];

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * 初始化实例化网格
   * 为车斗和车轮创建独立的 InstancedMesh
   */
  initInstancedMeshes() {
    // 创建车斗实例化网格
    this.bodyMesh = this.createInstancedMesh(
      this.bodyGeometry,
      this.bodyMaterial,
      this.maxCount
    );

    // 创建车轮实例化网格（每个矿车4个车轮）
    this.wheelMesh = this.createInstancedMesh(
      this.wheelGeometry,
      this.wheelMaterial,
      this.maxCount * 4
    );

    this.meshes = {
      body: this.bodyMesh,
      wheel: this.wheelMesh
    };
  }

  /**
   * 创建单个实例化网格
   * @param {THREE.BufferGeometry} geometry - 几何体
   * @param {THREE.Material} material - 材质
   * @param {number} count - 实例数量
   * @returns {THREE.InstancedMesh}
   */
  createInstancedMesh(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);

    // 设置动态更新标记
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // 存储元数据
    mesh.userData = { isMinecartPart: true, renderer: this };

    // 禁用视锥体剔除
    mesh.frustumCulled = false;

    // 设置无限大边界球体
    this.setupInfiniteBoundingSphere(mesh);

    return mesh;
  }

  /**
   * 设置无限大边界球体
   * @param {THREE.InstancedMesh} mesh - 目标网格
   */
  setupInfiniteBoundingSphere(mesh) {
    if (!mesh.geometry.boundingSphere) {
      mesh.geometry.computeBoundingSphere();
    }
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  }

  /**
   * 将所有实例化网格添加到场景
   */
  addToScene() {
    Object.values(this.meshes).forEach(mesh => {
      this.scene.add(mesh);
    });
  }

  // --------------------------------------------------------------------------
  // 渲染更新方法
  // --------------------------------------------------------------------------

  /**
   * 更新所有矿车的实例化渲染
   * 每帧调用一次，更新所有矿车的位置和旋转
   *
   * @param {Map|Array} minecarts - 矿车对象集合
   * @param {Function} getRotationAngle - 获取旋转角度的函数
   */
  update(minecarts, getRotationAngle) {
    let count = 0;
    this.instanceMap = [];

    // 重置网格实例计数
    this.bodyMesh.count = 0;
    this.wheelMesh.count = 0;

    // 将 Map 转换为数组
    const minecartList = Array.isArray(minecarts) ? minecarts : Array.from(minecarts.values());

    // 限制渲染数量不超过最大值
    const renderCount = Math.min(minecartList.length, this.maxCount);

    // 更新每个矿车实例
    for (let i = 0; i < renderCount; i++) {
      const minecart = minecartList[i];
      this.instanceMap[i] = minecart;
      this.updateMinecartInstance(minecart, i, getRotationAngle);
      count++;
    }

    // 提交更新
    this.commitMeshUpdates(count);
  }

  /**
   * 更新单个矿车实例的渲染状态
   * @param {Object} minecart - 矿车对象
   * @param {number} index - 实例索引
   * @param {Function} getRotationAngle - 获取旋转角度的函数
   */
  updateMinecartInstance(minecart, index, getRotationAngle) {
    const px = minecart.position.x + 0.5;
    const py = minecart.position.y;
    const pz = minecart.position.z + 0.5;
    const ry = getRotationAngle(minecart.orientation);

    // 更新车斗
    this.updateBodyMatrix(index, px, py, pz, ry);

    // 更新4个车轮
    this.updateWheelMatrices(index, px, py, pz, ry);
  }

  /**
   * 更新车斗矩阵
   */
  updateBodyMatrix(index, px, py, pz, ry) {
    const { height } = MINECART_SIZES.body;
    const { wheelRadius } = MINECART_SIZES;

    this.dummy.position.set(px, py + height / 2 + wheelRadius, pz);
    this.dummy.rotation.set(0, ry, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();

    this.bodyMesh.setMatrixAt(index, this.dummy.matrix);
  }

  /**
   * 更新4个车轮矩阵
   */
  updateWheelMatrices(index, px, py, pz, ry) {
    const { wheelRadius, wheelHeight, wheelbase, trackWidth } = MINECART_SIZES;

    // 四个车轮的相对位置
    const wheelOffsets = [
      { x: -trackWidth / 2, z: wheelbase / 2 },   // 左前
      { x: trackWidth / 2, z: wheelbase / 2 },    // 右前
      { x: -trackWidth / 2, z: -wheelbase / 2 },  // 左后
      { x: trackWidth / 2, z: -wheelbase / 2 }    // 右后
    ];

    wheelOffsets.forEach((offset, wheelIndex) => {
      // 车轮在实例网格中的索引
      const instanceIndex = index * 4 + wheelIndex;

      // 设置车轮位置（相对于矿车中心）
      this.dummy.position.set(
        px + offset.x,
        py + wheelRadius,
        pz + offset.z
      );

      // 车轮旋转：圆柱体默认沿 Y 轴，旋转使其沿 X 轴（横向）
      // 同时应用矿车的 Y 轴旋转，并额外旋转90度使其与轨道方向对齐
      this.dummy.rotation.set(0, ry + Math.PI / 2, Math.PI / 2);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();

      this.wheelMesh.setMatrixAt(instanceIndex, this.dummy.matrix);
    });
  }

  /**
   * 提交网格更新到 GPU
   * @param {number} count - 活跃实例数量
   */
  commitMeshUpdates(count) {
    this.bodyMesh.count = count;
    this.bodyMesh.instanceMatrix.needsUpdate = true;

    this.wheelMesh.count = count * 4;
    this.wheelMesh.instanceMatrix.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  // 工具方法
  // --------------------------------------------------------------------------

  /**
   * 通过实例 ID 获取对应的矿车对象
   * @param {number} instanceId - 实例 ID
   * @param {THREE.Mesh} [mesh] - 可选的网格对象，用于判断是车身还是车轮
   * @returns {Object|undefined}
   */
  getMinecartAt(instanceId, mesh) {
    // 如果是车轮网格，需要将实例 ID 转换为矿车索引
    if (mesh === this.wheelMesh) {
      const minecartIndex = Math.floor(instanceId / 4);
      return this.instanceMap[minecartIndex];
    }
    // 默认是车身网格，实例 ID 直接对应矿车索引
    return this.instanceMap[instanceId];
  }

  /**
   * 释放所有资源
   */
  dispose() {
    // 移除并释放所有网格
    Object.values(this.meshes).forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });

    // 清空引用
    this.instanceMap = [];
  }
}