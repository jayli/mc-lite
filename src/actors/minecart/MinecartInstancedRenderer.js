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
  /** 车斗颜色 - 铁质灰色 */
  body: 0xb8bec6,
  /** 车轮颜色 - 深金属灰 */
  wheel: 0x2f3238
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
    this.bodyTexture = this.createMinecartBodyTexture();

    // 创建车轮几何体（圆柱体）
    this.wheelGeometry = new THREE.CylinderGeometry(
      MINECART_SIZES.wheelRadius,
      MINECART_SIZES.wheelRadius,
      MINECART_SIZES.wheelHeight,
      8
    );

    // 创建材质
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: MINECART_COLORS.body,
      map: this.bodyTexture,
      metalness: 0.22,
      roughness: 0.72,
      side: THREE.DoubleSide
    });

    this.wheelMaterial = new THREE.MeshStandardMaterial({
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

    // 计算半宽/半深，使几何体中心在原点
    const tw = topWidth / 2;
    const td = topDepth / 2;
    const bw = bottomWidth / 2;
    const bd = bottomDepth / 2;
    const h = height / 2;

    // 顶点：底部四点 + 顶部四点（开口车斗，无顶面）
    const p = {
      bbl: new THREE.Vector3(-bw, -h, -bd), // bottom back left
      bbr: new THREE.Vector3(bw, -h, -bd),  // bottom back right
      bfr: new THREE.Vector3(bw, -h, bd),   // bottom front right
      bfl: new THREE.Vector3(-bw, -h, bd),  // bottom front left
      tbl: new THREE.Vector3(-tw, h, -td),  // top back left
      tbr: new THREE.Vector3(tw, h, -td),   // top back right
      tfr: new THREE.Vector3(tw, h, td),    // top front right
      tfl: new THREE.Vector3(-tw, h, td)    // top front left
    };

    const positions = [];
    const uvs = [];
    const indices = [];

    const addFace = (a, b, c, d) => {
      const base = positions.length / 3;
      positions.push(
        a.x, a.y, a.z,
        b.x, b.y, b.z,
        c.x, c.y, c.z,
        d.x, d.y, d.z
      );

      // 统一四边形 UV，便于展示金属噪点与上沿压暗效果
      uvs.push(
        0, 0,
        1, 0,
        1, 1,
        0, 1
      );

      indices.push(
        base, base + 1, base + 2,
        base, base + 2, base + 3
      );
    };

    // 底部
    addFace(p.bbl, p.bbr, p.bfr, p.bfl);
    // 前、后、左、右（不含顶面）
    addFace(p.bfl, p.bfr, p.tfr, p.tfl);
    addFace(p.bbr, p.bbl, p.tbl, p.tbr);
    addFace(p.bbl, p.bfl, p.tfl, p.tbl);
    addFace(p.bfr, p.bbr, p.tbr, p.tfr);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * 创建矿车车斗纹理（参照原版矿车的灰色金属质感）
   * @returns {THREE.CanvasTexture}
   */
  createMinecartBodyTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    // 基础灰色渐变：中间略亮，边缘略暗
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#a7afb8');
    gradient.addColorStop(0.5, '#c0c6ce');
    gradient.addColorStop(1, '#8f98a2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // 顶部深色压边，贴近参考图车斗上沿效果
    ctx.fillStyle = 'rgba(58, 63, 70, 0.8)';
    ctx.fillRect(0, 0, size, Math.floor(size * 0.14));

    // 底部轻微阴影，增强金属厚度感
    ctx.fillStyle = 'rgba(40, 45, 52, 0.2)';
    ctx.fillRect(0, Math.floor(size * 0.85), size, Math.floor(size * 0.15));

    // 金属噪点
    for (let i = 0; i < 420; i++) {
      const x = (Math.random() * size) | 0;
      const y = (Math.random() * size) | 0;
      const v = 155 + ((Math.random() * 60) | 0);
      const alpha = 0.1 + Math.random() * 0.2;
      ctx.fillStyle = `rgba(${v}, ${v}, ${v}, ${alpha.toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // 轻微竖向拉丝纹理
    ctx.strokeStyle = 'rgba(235, 240, 245, 0.08)';
    for (let x = 0; x < size; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
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
    const { wheelRadius, wheelbase, trackWidth } = MINECART_SIZES;

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
    this.bodyTexture?.dispose();

    // 清空引用
    this.instanceMap = [];
  }
}
