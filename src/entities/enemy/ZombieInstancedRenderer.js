import * as THREE from 'three';

/**
 * 丧尸实例化渲染器类
 * 使用 Three.js 的 InstancedMesh 技术高效渲染大量丧尸
 * 支持最多 maxCount 个丧尸的实例化渲染
 */
export class ZombieInstancedRenderer {
  /**
   * 构造函数
   * @param {THREE.Scene} scene - Three.js 场景对象
   * @param {number} maxCount - 最大可渲染的丧尸数量，默认 100
   */
  constructor(scene, maxCount = 100) {
    this.scene = scene;
    this.maxCount = maxCount;
    this.instanceMap = []; // 映射实例ID到丧尸对象

    // 创建共享几何体和材质
    this.initResources();

    // 创建实例化网格
    this.initInstancedMeshes();

    // 添加到场景
    this.addToScene();

    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  /**
   * 初始化资源 - 创建几何体和材质
   */
  initResources() {
    // 1. 头部纹理和材质 - 创建两个纹理：有眼睛（正面）和无眼睛（其他面）
    const headTextureWithEyes = this.createMosaicTexture('head', true);
    const headTextureWithoutEyes = this.createMosaicTexture('head', false);
    this.headMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
    });
    this.headGeometry = this.createHeadGeometry(); // 创建带材质组的头部几何体

    // 2. 身体材质
    this.bodyMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff // 使用白色以便顶点颜色控制最终颜色
    });
    this.bodyGeometry = new THREE.BoxGeometry(0.55, 0.63, 0.45);

    // 3. 手臂材质
    this.armMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff // 使用白色以便顶点颜色控制最终颜色
    });
    this.armGeometry = new THREE.BoxGeometry(0.23, 0.8, 0.23);

    // 4. 腿部材质
    this.legMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff // 使用白色以便顶点颜色控制最终颜色
    });
    this.legGeometry = new THREE.BoxGeometry(0.26, 1, 0.26);

    // 颜色定义
    this.colors = {
      head: new THREE.Color(0xffffff),
      body: new THREE.Color(0x037c7c),
      arm: new THREE.Color(0x699058),
      leg: new THREE.Color(0x322b71),
      flash: new THREE.Color(0xff0000)
    };

    // 存储头部纹理
    this.headTextures = {
      withEyes: headTextureWithEyes,
      withoutEyes: headTextureWithoutEyes
    };
  }

  /**
   * 创建头部几何体
   * 创建带材质组的几何体，以便为不同面应用不同材质
   */
  createHeadGeometry() {
    // BoxGeometry 的组成：每个面有 2 个三角形，每个三角形有 3 个顶点
    // 总共有 6 个面，12 个三角形，36 个顶点
    // 面顺序：[右,左,上,下,前,后]，每个面有6个顶点（2个三角形）
    const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);

    // 重新分配面的材质索引
    geometry.clearGroups();

    // 面 0：右侧（x+）- 2个三角形，6个顶点
    geometry.addGroup(0, 6, 0);
    // 面 1：左侧（x-）- 2个三角形，6个顶点
    geometry.addGroup(6, 6, 0);
    // 面 2：顶部（y+）- 2个三角形，6个顶点
    geometry.addGroup(12, 6, 0);
    // 面 3：底部（y-）- 2个三角形，6个顶点
    geometry.addGroup(18, 6, 0);
    // 面 4：正面（z+）- 2个三角形，6个顶点（我们希望这面显示眼睛）
    geometry.addGroup(24, 6, 1);
    // 面 5：背面（z-）- 2个三角形，6个顶点
    geometry.addGroup(30, 6, 0);

    return geometry;
  }

  /**
   * 初始化实例化网格
   */
  initInstancedMeshes() {
    // 创建 InstancedMesh 的辅助函数
    const createMesh = (geo, mat) => {
      const mesh = new THREE.InstancedMesh(geo, mat, this.maxCount);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData = { isZombiePart: true, renderer: this };
      mesh.frustumCulled = false; // 禁用视锥体剔除，防止丧尸消失

      // 初始化边界球体为无限大，防止射线检测时剔除
      // 我们同时设置几何体和网格的边界球体以确保兼容性
      if (!mesh.geometry.boundingSphere) {
        mesh.geometry.computeBoundingSphere();
      }
      mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

      // 初始化 instanceColor 以确保其存在并具有正确大小
      // 使用 maxCount 而不是当前数量来预分配缓冲区
      if (mesh.setColorAt) {
        // 初始化为白色
        const color = new THREE.Color(0xffffff);
        for (let i = 0; i < this.maxCount; i++) {
          mesh.setColorAt(i, color);
        }
      }

      return mesh;
    };

    // 头部需要使用材质数组，其他部分使用单一材质
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

    this.meshes = {
      head: createMesh(this.headGeometry, headMaterials),
      body: createMesh(this.bodyGeometry, this.bodyMaterial),
      leftArm: createMesh(this.armGeometry, this.armMaterial),
      rightArm: createMesh(this.armGeometry, this.armMaterial),
      leftLeg: createMesh(this.legGeometry, this.legMaterial),
      rightLeg: createMesh(this.legGeometry, this.legMaterial)
    };
  }

  /**
   * 将所有实例化网格添加到场景
   */
  addToScene() {
    Object.values(this.meshes).forEach(mesh => {
      this.scene.add(mesh);
    });
  }

  /**
   * 更新所有丧尸的实例化渲染
   * @param {Map|Array} zombies - 丧尸对象集合（Map 或 Array）
   */
  update(zombies) {
    let count = 0;
    this.instanceMap = [];

    // 重置计数
    Object.values(this.meshes).forEach(mesh => {
      mesh.count = 0;
    });

    // 遍历所有丧尸（处理 Map 或 Array）
    const zombieList = Array.isArray(zombies) ? zombies : Array.from(zombies.values());

    // 限制渲染数量不超过最大值
    const renderCount = Math.min(zombieList.length, this.maxCount);

    for (let i = 0; i < renderCount; i++) {
      const zombie = zombieList[i];
      this.instanceMap[i] = zombie;

      // 基础变换（丧尸位置和旋转）
      const px = zombie.position.x;
      const py = zombie.position.y;
      const pz = zombie.position.z;
      const ry = zombie.rotation.y; // Y轴旋转

      // 确定颜色（受伤时闪红）
      const isFlashing = zombie.isFlashing;

      // --- 头部 ---
      // 本地坐标: (0, 1.8, 0)
      this.updatePart(this.meshes.head, i, px, py, pz, ry, 0, 1.8, 0, 0, 0, 0, isFlashing, 'head');

      // --- 身体 ---
      // 本地坐标: (0, 1.15, 0)
      this.updatePart(this.meshes.body, i, px, py, pz, ry, 0, 1.15, 0, 0, 0, 0, isFlashing, 'body');

      // --- 左臂 ---
      // 本地坐标: (-0.43, 1.3, 0.3), X轴旋转 = -PI/2.4
      this.updatePart(this.meshes.leftArm, i, px, py, pz, ry, -0.43, 1.3, 0.3, -Math.PI / 2.4, 0, 0, isFlashing, 'arm');

      // --- 右臂 ---
      // 本地坐标: (0.43, 1.3, 0.3), X轴旋转 = -PI/2.7
      this.updatePart(this.meshes.rightArm, i, px, py, pz, ry, 0.43, 1.3, 0.3, -Math.PI / 2.7, 0, 0, isFlashing, 'arm');

      // --- 左腿 ---
      // 本地坐标: (-0.14, 0.4, 0)
      this.updatePart(this.meshes.leftLeg, i, px, py, pz, ry, -0.14, 0.4, 0, 0, 0, 0, isFlashing, 'leg');

      // --- 右腿 ---
      // 本地坐标: (0.14, 0.4, 0)
      this.updatePart(this.meshes.rightLeg, i, px, py, pz, ry, 0.14, 0.4, 0, 0, 0, 0, isFlashing, 'leg');

      count++;
    }

    // 更新计数并通知 Three.js 更新缓冲区
    Object.values(this.meshes).forEach(mesh => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  /**
   * 更新单个身体部位的实例化矩阵
   * @param {THREE.InstancedMesh} mesh - 实例化网格
   * @param {number} index - 实例索引
   * @param {number} px - 基础位置X
   * @param {number} py - 基础位置Y
   * @param {number} pz - 基础位置Z
   * @param {number} ry - 基础旋转Y
   * @param {number} offX - 部位偏移X
   * @param {number} offY - 部位偏移Y
   * @param {number} offZ - 部位偏移Z
   * @param {number} rotX - 部位旋转X
   * @param {number} rotY - 部位旋转Y
   * @param {number} rotZ - 部位旋转Z
   * @param {boolean} isFlashing - 是否闪烁红色（受伤）
   * @param {string} type - 部位类型（head/body/arm/leg）
   */
  updatePart(mesh, index, px, py, pz, ry, offX, offY, offZ, rotX, rotY, rotZ, isFlashing, type) {
    this.dummy.position.set(offX, offY, offZ);
    this.dummy.rotation.set(rotX, rotY, rotZ);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix(); // 局部矩阵

    // 优化：复用父级 dummy 对象
    if (!this.parentDummy) this.parentDummy = new THREE.Object3D();

    this.parentDummy.position.set(px, py, pz);
    this.parentDummy.rotation.set(0, ry, 0); // 丧尸基础只绕Y轴旋转
    this.parentDummy.updateMatrix();

    // 矩阵乘法：父级 * 局部
    if (!this._tempMatrix) this._tempMatrix = new THREE.Matrix4();
    this._tempMatrix.multiplyMatrices(this.parentDummy.matrix, this.dummy.matrix);

    mesh.setMatrixAt(index, this._tempMatrix);

    // 颜色
    const color = isFlashing ? this.colors.flash : this.colors[type];
    mesh.setColorAt(index, color);
  }

  /**
   * 创建马赛克风格的纹理
   * @param {string} type - 类型，默认 'head'
   * @param {boolean} addEyes - 是否添加眼睛，默认 true
   * @returns {THREE.CanvasTexture} 生成的纹理
   */
  createMosaicTexture(type = 'head', addEyes = true) {
    const mosaicCount = 8; // 每个面 8x8 个马赛克
    const mosaicSize = 8; // 每个马赛克方块 8 像素
    const size = mosaicCount * mosaicSize; // 64x64
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const palettes = {
      head: { base: [64, 107, 48], noise: [[48, 80, 36], [80, 134, 60], [96, 160, 72]] },
    };

    const palette = palettes[type] || palettes.head;

    for (let y = 0; y < size; y += mosaicSize) {
      for (let x = 0; x < size; x += mosaicSize) {
        const useNoise = Math.random() > 0.7; // 降低噪音使用概率至 30%
        let color;
        if (useNoise) {
          const noiseIndex = Math.floor(Math.random() * palette.noise.length);
          color = palette.noise[noiseIndex];
        } else {
          const variation = 5; // 降低基础颜色波动幅度
          color = [
            Math.max(0, Math.min(255, palette.base[0] + (Math.random() - 0.5) * variation)),
            Math.max(0, Math.min(255, palette.base[1] + (Math.random() - 0.5) * variation)),
            Math.max(0, Math.min(255, palette.base[2] + (Math.random() - 0.5) * variation))
          ];
        }
        ctx.fillStyle = `rgb(${Math.floor(color[0])}, ${Math.floor(color[1])}, ${Math.floor(color[2])})`;
        ctx.fillRect(x, y, mosaicSize, mosaicSize);
      }
    }

    // 添加眼睛（黑色马赛克方块）
    if (type === 'head' && addEyes) {
      // 每只眼睛大小为 1 个马赛克颗粒
      const eyeSize = mosaicSize; // 8 像素

      // 8x8 网格中，眼睛位置：垂直居中（第 3-4 行），水平对称分布（第 2 列和第 6 列）
      const leftEyeX = 2 * mosaicSize; // 第 3 列起始位置
      const rightEyeX = 5 * mosaicSize; // 第 6 列起始位置
      const eyeY = 3 * mosaicSize; // 第 4 行起始位置（垂直居中）

      // 左眼
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillRect(leftEyeX, eyeY, eyeSize, eyeSize);

      // 右眼
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillRect(rightEyeX, eyeY, eyeSize, eyeSize);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /**
   * 通过实例ID获取对应的丧尸对象
   * @param {number} instanceId - 实例ID
   * @returns {Object} 对应的丧尸对象
   */
  getZombieAt(instanceId) {
    return this.instanceMap[instanceId];
  }

  /**
   * 释放资源
   */
  dispose() {
    Object.values(this.meshes).forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      // 共享材质的释放（如果需要）
    });
    this.headMaterial.dispose();
    this.bodyMaterial.dispose();
    this.armMaterial.dispose();
    this.legMaterial.dispose();
  }
}
