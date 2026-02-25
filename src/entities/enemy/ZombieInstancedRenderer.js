/**
 * 丧尸实例化渲染器
 *
 * 使用 Three.js 的 InstancedMesh 技术高效渲染大量丧尸实体。
 * 通过批量渲染减少 draw call，显著提升渲染性能。
 *
 * 设计原则：
 * - 单一几何体共享：所有丧尸共享同一组几何体和材质
 * - 实例化渲染：通过矩阵变换实现每个实例的独立位置/旋转
 * - 动画系统：支持行走动画和受伤闪烁效果
 */
import * as THREE from 'three';

// ============================================================================
// 配置参数
// ============================================================================

/**
 * 默认最大渲染数量
 * 限制同时渲染的丧尸实例数量，防止性能问题
 */
const DEFAULT_MAX_COUNT = 100;

/**
 * 身体部件尺寸配置（单位：方块）
 * 基于 Minecraft 丧尸的原版比例设计
 */
const BODY_PART_SIZES = {
  /** 头部尺寸 - 正方体 */
  head: { width: 0.6, height: 0.6, depth: 0.6 },
  /** 身体尺寸 - 略宽于头部 */
  body: { width: 0.55, height: 0.63, depth: 0.45 },
  /** 手臂尺寸 - 细长形状 */
  arm: { width: 0.23, height: 0.8, depth: 0.23 },
  /** 腿部尺寸 - 较粗的腿部 */
  leg: { width: 0.26, height: 1.0, depth: 0.26 }
};

/**
 * 身体部件本地坐标偏移
 * 相对于丧尸基座（脚底）的位置
 */
const BODY_PART_OFFSETS = {
  /** 头部偏移 - 位于身体顶部 */
  head: { x: 0, y: 1.8, z: 0 },
  /** 身体偏移 - 中心位于躯干 */
  body: { x: 0, y: 1.15, z: 0 },
  /** 左臂偏移 - 伸向前方 */
  leftArm: { x: -0.43, y: 1.3, z: 0.3 },
  /** 右臂偏移 - 伸向前方，角度略有不同 */
  rightArm: { x: 0.43, y: 1.3, z: 0.3 },
  /** 左腿偏移 - 轴心在大腿根部 */
  leftLeg: { x: -0.14, y: 0.9, z: 0 },
  /** 右腿偏移 - 轴心在大腿根部 */
  rightLeg: { x: 0.14, y: 0.9, z: 0 }
};

/**
 * 身体部件旋转角度（弧度）
 */
const BODY_PART_ROTATIONS = {
  /** 左臂旋转 - 向前伸出 */
  leftArm: { x: -Math.PI / 2.4, y: 0, z: 0 },
  /** 右臂旋转 - 向前伸出，角度略有不同增加变化感 */
  rightArm: { x: -Math.PI / 2.7, y: 0, z: 0 }
};

/**
 * 丧尸各部件颜色配置
 * 使用 Minecraft 丧尸的经典配色方案
 */
const ZOMBIE_COLORS = {
  /** 头部颜色 - 白色（纹理控制实际颜色） */
  head: 0xffffff,
  /** 身体颜色 - 青绿色（经典丧尸衬衫色） */
  body: 0x037c7c,
  /** 手臂颜色 - 橄榄绿（经典丧尸皮肤色） */
  arm: 0x699058,
  /** 腿部颜色 - 深蓝紫色（经典丧尸裤子色） */
  leg: 0x322b71,
  /** 受伤闪烁颜色 - 红色 */
  flash: 0xff0000
};

/**
 * 行走动画参数配置
 */
const WALK_ANIMATION = {
  /** 动画播放速度（越大摆动越快） */
  speed: 10,
  /** 腿部摆动幅度（弧度，约 22.5 度） */
  legSwingAngle: Math.PI / 8
};

/**
 * 头部纹理配置
 * 马赛克风格的像素纹理
 */
const TEXTURE_CONFIG = {
  /** 每个面的马赛克网格数量 */
  mosaicCount: 8,
  /** 每个马赛克方块的像素大小 */
  mosaicSize: 8,
  /** 头部颜色调色板 */
  headPalette: {
    /** 基础颜色 - 深绿色 */
    base: [64, 107, 48],
    /** 噪点颜色 - 用于增加纹理变化 */
    noise: [
      [48, 80, 36],   // 深绿
      [80, 134, 60],  // 亮绿
      [96, 160, 72]   // 亮黄绿
    ]
  },
  /** 噪点使用概率（30% 的方块会使用噪点颜色） */
  noiseProbability: 0.7,
  /** 基础颜色波动幅度 */
  baseColorVariation: 5
};

/**
 * 受伤闪烁持续时间（毫秒）
 */
const FLASH_DURATION = 200;

// ============================================================================
// 丧尸实例化渲染器类
// ============================================================================

/**
 * 丧尸实例化渲染器类
 *
 * 负责高效渲染大量丧尸实体，使用 InstancedMesh 技术减少 draw call。
 * 支持行走动画、受伤闪烁等视觉效果。
 */
export class ZombieInstancedRenderer {
  /**
   * 构造函数
   * @param {THREE.Scene} scene - Three.js 场景对象
   * @param {number} maxCount - 最大可渲染的丧尸数量
   */
  constructor(scene, maxCount = DEFAULT_MAX_COUNT) {
    // 场景引用
    this.scene = scene;

    // 实例数量限制
    this.maxCount = maxCount;

    // 实例映射：索引 -> 丧尸对象
    this.instanceMap = [];

    // 初始化共享资源（几何体、材质）
    this.initResources();

    // 创建实例化网格
    this.initInstancedMeshes();

    // 将所有网格添加到场景
    this.addToScene();

    // 复用的临时对象（性能优化：避免每帧创建新对象）
    this.dummy = new THREE.Object3D();
    this.parentDummy = new THREE.Object3D();
    this._tempMatrix = new THREE.Matrix4();
    this.color = new THREE.Color();
  }

  // --------------------------------------------------------------------------
  // 初始化方法
  // --------------------------------------------------------------------------

  /**
   * 初始化共享资源
   * 创建所有丧尸实例共用的几何体和材质
   */
  initResources() {
    // 创建头部几何体和纹理
    this.headTextures = this.createHeadTextures();
    this.headGeometry = this.createHeadGeometry();

    // 创建身体几何体
    this.bodyGeometry = new THREE.BoxGeometry(
      BODY_PART_SIZES.body.width,
      BODY_PART_SIZES.body.height,
      BODY_PART_SIZES.body.depth
    );

    // 创建手臂几何体
    this.armGeometry = new THREE.BoxGeometry(
      BODY_PART_SIZES.arm.width,
      BODY_PART_SIZES.arm.height,
      BODY_PART_SIZES.arm.depth
    );

    // 创建腿部几何体（轴心在大腿顶部，便于行走动画）
    this.legGeometry = new THREE.BoxGeometry(
      BODY_PART_SIZES.leg.width,
      BODY_PART_SIZES.leg.height,
      BODY_PART_SIZES.leg.depth
    );
    // 将腿部几何体向下平移，使旋转轴心位于大腿顶部
    this.legGeometry.translate(0, -BODY_PART_SIZES.leg.height / 2, 0);

    // 创建各部件材质（使用白色基础色，便于顶点颜色控制）
    this.headMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.armMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.legMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });

    // 预创建颜色对象（避免每帧创建）
    this.colors = {
      head: new THREE.Color(ZOMBIE_COLORS.head),
      body: new THREE.Color(ZOMBIE_COLORS.body),
      arm: new THREE.Color(ZOMBIE_COLORS.arm),
      leg: new THREE.Color(ZOMBIE_COLORS.leg),
      flash: new THREE.Color(ZOMBIE_COLORS.flash)
    };
  }

  /**
   * 创建头部纹理（有眼睛和无眼睛两个版本）
   * @returns {Object} 包含 withEyes 和 withoutEyes 两个纹理
   */
  createHeadTextures() {
    return {
      withEyes: this.createMosaicTexture('head', true),
      withoutEyes: this.createMosaicTexture('head', false)
    };
  }

  /**
   * 创建头部几何体
   * 为不同面设置材质组，以便正面显示眼睛纹理
   * @returns {THREE.BoxGeometry} 配置好的头部几何体
   */
  createHeadGeometry() {
    const { width, height, depth } = BODY_PART_SIZES.head;
    const geometry = new THREE.BoxGeometry(width, height, depth);

    // BoxGeometry 面顺序：[右, 左, 上, 下, 前, 后]
    // 每个面 2 个三角形，6 个顶点
    // 设置材质组：正面（第 5 面，索引 24-29）使用材质索引 1（有眼睛）
    geometry.clearGroups();

    // 面 0-4：右侧、左侧、顶部、底部、背面 - 使用无眼睛纹理（材质索引 0）
    geometry.addGroup(0, 6, 0);   // 右侧
    geometry.addGroup(6, 6, 0);   // 左侧
    geometry.addGroup(12, 6, 0);  // 顶部
    geometry.addGroup(18, 6, 0);  // 底部
    geometry.addGroup(30, 6, 0);  // 背面

    // 面 5：正面 - 使用有眼睛纹理（材质索引 1）
    geometry.addGroup(24, 6, 1);  // 正面

    return geometry;
  }

  /**
   * 初始化实例化网格
   * 为每个身体部位创建独立的 InstancedMesh
   */
  initInstancedMeshes() {
    // 头部使用材质数组（正面有眼睛，其他面无眼睛）
    const headMaterials = [
      new THREE.MeshLambertMaterial({
        map: this.headTextures.withoutEyes,
        color: 0xffffff
      }),
      new THREE.MeshLambertMaterial({
        map: this.headTextures.withEyes,
        color: 0xffffff
      })
    ];

    // 创建各部位的实例化网格
    this.meshes = {
      head: this.createInstancedMesh(this.headGeometry, headMaterials),
      body: this.createInstancedMesh(this.bodyGeometry, this.bodyMaterial),
      leftArm: this.createInstancedMesh(this.armGeometry, this.armMaterial),
      rightArm: this.createInstancedMesh(this.armGeometry, this.armMaterial),
      leftLeg: this.createInstancedMesh(this.legGeometry, this.legMaterial),
      rightLeg: this.createInstancedMesh(this.legGeometry, this.legMaterial)
    };
  }

  /**
   * 创建单个实例化网格
   * @param {THREE.BufferGeometry} geometry - 几何体
   * @param {THREE.Material|THREE.Material[]} material - 材质或材质数组
   * @returns {THREE.InstancedMesh} 配置好的实例化网格
   */
  createInstancedMesh(geometry, material) {
    const mesh = new THREE.InstancedMesh(geometry, material, this.maxCount);

    // 设置动态更新标记
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // 存储元数据，用于射线检测等
    mesh.userData = { isZombiePart: true, renderer: this };

    // 禁用视锥体剔除（丧尸可能在边缘可见）
    mesh.frustumCulled = false;

    // 设置无限大边界球体，防止射线检测时被剔除
    this.setupInfiniteBoundingSphere(mesh);

    // 初始化实例颜色缓冲区
    this.initializeInstanceColors(mesh);

    return mesh;
  }

  /**
   * 设置无限大边界球体
   * 防止实例被意外剔除
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
   * 初始化实例颜色缓冲区
   * 预分配所有颜色数据，避免运行时扩容
   * @param {THREE.InstancedMesh} mesh - 目标网格
   */
  initializeInstanceColors(mesh) {
    if (!mesh.setColorAt) return;

    const defaultColor = new THREE.Color(0xffffff);
    for (let i = 0; i < this.maxCount; i++) {
      mesh.setColorAt(i, defaultColor);
    }
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
   * 更新所有丧尸的实例化渲染
   * 每帧调用一次，更新所有丧尸的位置、旋转和动画状态
   *
   * @param {Map|Array} zombies - 丧尸对象集合
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(zombies, deltaTime = 0.016) {
    let count = 0;
    this.instanceMap = [];

    // 重置所有网格的实例计数
    this.resetMeshCounts();

    // 将 Map 转换为数组（支持 Map 和 Array 两种输入）
    const zombieList = Array.isArray(zombies) ? zombies : Array.from(zombies.values());

    // 限制渲染数量不超过最大值
    const renderCount = Math.min(zombieList.length, this.maxCount);

    // 更新每个丧尸实例
    for (let i = 0; i < renderCount; i++) {
      const zombie = zombieList[i];
      this.instanceMap[i] = zombie;
      this.updateZombieInstance(zombie, i, deltaTime);
      count++;
    }

    // 通知 Three.js 更新缓冲区
    this.commitMeshUpdates(count);
  }

  /**
   * 重置所有网格的实例计数
   */
  resetMeshCounts() {
    Object.values(this.meshes).forEach(mesh => {
      mesh.count = 0;
    });
  }

  /**
   * 更新单个丧尸实例的渲染状态
   * @param {Object} zombie - 丧尸对象
   * @param {number} index - 实例索引
   * @param {number} deltaTime - 时间增量（秒）
   */
  updateZombieInstance(zombie, index, deltaTime) {
    // 提取基础变换数据
    const { x: px, y: py, z: pz } = zombie.position;
    const ry = zombie.rotation.y;
    const isFlashing = zombie.isFlashing;

    // 计算行走动画
    const legSwing = this.calculateWalkAnimation(zombie, deltaTime);

    // 更新各身体部位
    this.updateBodyParts(zombie, index, px, py, pz, ry, legSwing, isFlashing);
  }

  /**
   * 计算行走动画的腿部摆动角度
   * @param {Object} zombie - 丧尸对象
   * @param {number} deltaTime - 时间增量（秒）
   * @returns {number} 腿部摆动角度（弧度）
   */
  calculateWalkAnimation(zombie, deltaTime) {
    // 检测是否在移动
    const isMoving = Math.abs(zombie.velocity.x) > 0.001 || Math.abs(zombie.velocity.z) > 0.001;

    // 更新动画时间
    if (isMoving) {
      zombie._walkTime = (zombie._walkTime || 0) + deltaTime;
      return Math.sin(zombie._walkTime * WALK_ANIMATION.speed) * WALK_ANIMATION.legSwingAngle;
    } else {
      zombie._walkTime = 0;
      return 0;
    }
  }

  /**
   * 更新丧尸所有身体部位的渲染
   * @param {Object} zombie - 丧尸对象
   * @param {number} index - 实例索引
   * @param {number} px - 基础位置 X
   * @param {number} py - 基础位置 Y
   * @param {number} pz - 基础位置 Z
   * @param {number} ry - 基础旋转 Y
   * @param {number} legSwing - 腿部摆动角度
   * @param {boolean} isFlashing - 是否受伤闪烁
   */
  updateBodyParts(zombie, index, px, py, pz, ry, legSwing, isFlashing) {
    const offsets = BODY_PART_OFFSETS;
    const rotations = BODY_PART_ROTATIONS;

    // 头部
    this.updatePart(
      this.meshes.head, index, px, py, pz, ry,
      offsets.head.x, offsets.head.y, offsets.head.z,
      0, 0, 0,
      isFlashing, 'head'
    );

    // 身体
    this.updatePart(
      this.meshes.body, index, px, py, pz, ry,
      offsets.body.x, offsets.body.y, offsets.body.z,
      0, 0, 0,
      isFlashing, 'body'
    );

    // 左臂
    this.updatePart(
      this.meshes.leftArm, index, px, py, pz, ry,
      offsets.leftArm.x, offsets.leftArm.y, offsets.leftArm.z,
      rotations.leftArm.x, rotations.leftArm.y, rotations.leftArm.z,
      isFlashing, 'arm'
    );

    // 右臂
    this.updatePart(
      this.meshes.rightArm, index, px, py, pz, ry,
      offsets.rightArm.x, offsets.rightArm.y, offsets.rightArm.z,
      rotations.rightArm.x, rotations.rightArm.y, rotations.rightArm.z,
      isFlashing, 'arm'
    );

    // 左腿（向前摆动）
    this.updatePart(
      this.meshes.leftLeg, index, px, py, pz, ry,
      offsets.leftLeg.x, offsets.leftLeg.y, offsets.leftLeg.z,
      legSwing, 0, 0,
      isFlashing, 'leg'
    );

    // 右腿（向后摆动，与左腿反向）
    this.updatePart(
      this.meshes.rightLeg, index, px, py, pz, ry,
      offsets.rightLeg.x, offsets.rightLeg.y, offsets.rightLeg.z,
      -legSwing, 0, 0,
      isFlashing, 'leg'
    );
  }

  /**
   * 提交网格更新到 GPU
   * @param {number} count - 活跃实例数量
   */
  commitMeshUpdates(count) {
    Object.values(this.meshes).forEach(mesh => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    });
  }

  /**
   * 更新单个身体部位的实例化矩阵
   *
   * @param {THREE.InstancedMesh} mesh - 实例化网格
   * @param {number} index - 实例索引
   * @param {number} px - 基础位置 X（丧尸世界坐标）
   * @param {number} py - 基础位置 Y
   * @param {number} pz - 基础位置 Z
   * @param {number} ry - 基础旋转 Y（丧尸朝向）
   * @param {number} offX - 部位本地偏移 X
   * @param {number} offY - 部位本地偏移 Y
   * @param {number} offZ - 部位本地偏移 Z
   * @param {number} rotX - 部位本地旋转 X
   * @param {number} rotY - 部位本地旋转 Y
   * @param {number} rotZ - 部位本地旋转 Z
   * @param {boolean} isFlashing - 是否受伤闪烁
   * @param {string} type - 部位类型（head/body/arm/leg）
   */
  updatePart(mesh, index, px, py, pz, ry, offX, offY, offZ, rotX, rotY, rotZ, isFlashing, type) {
    // 设置本地变换（部位相对于丧尸中心的偏移和旋转）
    this.dummy.position.set(offX, offY, offZ);
    this.dummy.rotation.set(rotX, rotY, rotZ);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();

    // 设置父级变换（丧尸在世界中的位置和旋转）
    this.parentDummy.position.set(px, py, pz);
    this.parentDummy.rotation.set(0, ry, 0);
    this.parentDummy.updateMatrix();

    // 计算最终变换矩阵：父级矩阵 × 本地矩阵
    this._tempMatrix.multiplyMatrices(this.parentDummy.matrix, this.dummy.matrix);
    mesh.setMatrixAt(index, this._tempMatrix);

    // 设置实例颜色（受伤时闪红，否则使用正常颜色）
    const color = isFlashing ? this.colors.flash : this.colors[type];
    mesh.setColorAt(index, color);
  }

  // --------------------------------------------------------------------------
  // 纹理生成方法
  // --------------------------------------------------------------------------

  /**
   * 创建马赛克风格的纹理
   * 生成类似 Minecraft 风格的像素化纹理
   *
   * @param {string} type - 纹理类型，目前仅支持 'head'
   * @param {boolean} addEyes - 是否添加眼睛
   * @returns {THREE.CanvasTexture} 生成的纹理
   */
  createMosaicTexture(type = 'head', addEyes = true) {
    const { mosaicCount, mosaicSize, headPalette, noiseProbability, baseColorVariation } = TEXTURE_CONFIG;
    const size = mosaicCount * mosaicSize;

    // 创建画布
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 绘制马赛克背景
    this.drawMosaicBackground(ctx, size, mosaicSize, headPalette, noiseProbability, baseColorVariation);

    // 添加眼睛（仅正面纹理）
    if (type === 'head' && addEyes) {
      this.drawEyes(ctx, mosaicSize);
    }

    // 创建纹理
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;

    return texture;
  }

  /**
   * 绘制马赛克背景
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   * @param {number} size - 画布总大小
   * @param {number} mosaicSize - 每个马赛克方块的大小
   * @param {Object} palette - 颜色调色板
   * @param {number} noiseProbability - 噪点使用概率
   * @param {number} baseColorVariation - 基础颜色波动幅度
   */
  drawMosaicBackground(ctx, size, mosaicSize, palette, noiseProbability, baseColorVariation) {
    for (let y = 0; y < size; y += mosaicSize) {
      for (let x = 0; x < size; x += mosaicSize) {
        const color = this.generateMosaicColor(palette, noiseProbability, baseColorVariation);
        ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        ctx.fillRect(x, y, mosaicSize, mosaicSize);
      }
    }
  }

  /**
   * 生成单个马赛克方块的颜色
   * @param {Object} palette - 颜色调色板
   * @param {number} noiseProbability - 使用噪点颜色的概率阈值
   * @param {number} baseColorVariation - 基础颜色波动幅度
   * @returns {number[]} RGB 颜色数组
   */
  generateMosaicColor(palette, noiseProbability, baseColorVariation) {
    // 根据概率决定是否使用噪点颜色
    if (Math.random() > noiseProbability) {
      // 使用噪点颜色
      const noiseIndex = Math.floor(Math.random() * palette.noise.length);
      return palette.noise[noiseIndex].map(c => Math.floor(c));
    }

    // 使用基础颜色并添加随机波动
    return palette.base.map(c => {
      const variation = (Math.random() - 0.5) * baseColorVariation;
      return Math.floor(Math.max(0, Math.min(255, c + variation)));
    });
  }

  /**
   * 绘制眼睛
   * 在 8x8 马赛克网格中，眼睛位于第 4 行，第 3 和第 6 列
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   * @param {number} mosaicSize - 每个马赛克方块的大小
   */
  drawEyes(ctx, mosaicSize) {
    // 眼睛位置（8x8 网格中的坐标）
    const leftEyeX = 2 * mosaicSize;   // 第 3 列
    const rightEyeX = 5 * mosaicSize;  // 第 6 列
    const eyeY = 3 * mosaicSize;       // 第 4 行

    // 绘制黑色眼睛
    ctx.fillStyle = 'rgb(0, 0, 0)';
    ctx.fillRect(leftEyeX, eyeY, mosaicSize, mosaicSize);
    ctx.fillRect(rightEyeX, eyeY, mosaicSize, mosaicSize);
  }

  // --------------------------------------------------------------------------
  // 工具方法
  // --------------------------------------------------------------------------

  /**
   * 通过实例 ID 获取对应的丧尸对象
   * 用于射线检测后获取被点击的丧尸
   *
   * @param {number} instanceId - 实例 ID
   * @returns {Object|undefined} 对应的丧尸对象
   */
  getZombieAt(instanceId) {
    return this.instanceMap[instanceId];
  }

  /**
   * 释放所有资源
   * 清理几何体、材质和场景中的网格
   */
  dispose() {
    // 移除并释放所有网格
    Object.values(this.meshes).forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    });

    // 释放材质
    this.headMaterial.dispose();
    this.bodyMaterial.dispose();
    this.armMaterial.dispose();
    this.legMaterial.dispose();

    // 清空引用
    this.instanceMap = [];
  }
}