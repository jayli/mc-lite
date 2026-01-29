// src/world/Chunk.js
/**
 * 区块管理器 - 负责区块的生成、渲染和管理
 * 使用 InstancedMesh 优化渲染性能，管理区块内的所有方块和实体
 */
import * as THREE from 'three';
import { materials } from '../core/materials/MaterialManager.js';
import { RealisticTree } from './entities/RealisticTree.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { persistenceService } from '../services/PersistenceService.js';
import { SEED } from '../utils/MathUtils.js';
import { faceCullingSystem } from '../core/FaceCullingSystem.js';

/** 区块尺寸 - 每个区块在 X 和 Z 方向上的方块数量 (16x16 是 Voxel 游戏的标准区块大小) */
const CHUNK_SIZE = 16;

// --- Worker 设置 ---
// 使用 Web Worker 处理计算密集型的地形生成，避免阻塞主线程（UI/渲染线程）
const worldWorker = new Worker(new URL('./WorldWorker.js', import.meta.url), { type: 'module' });
const workerCallbacks = new Map(); // 用于跟踪异步生成请求的回调函数

worldWorker.onmessage = (e) => {
  const { cx, cz, d, solidBlocks, realisticTrees } = e.data;
  const key = `${cx},${cz}`;
  if (workerCallbacks.has(key)) {
    workerCallbacks.get(key)({ d, solidBlocks, realisticTrees });
    workerCallbacks.delete(key);
  }
};

worldWorker.onerror = (e) => {
  console.error('WorldWorker Error:', e);
};

// 共享几何体定义 - 用于优化渲染性能，避免在每个区块中重复创建相同的几何体，减少 GPU 内存占用

/**
 * 构建交叉平面几何体（用于花、藤蔓等植物）
 * 由两个垂直交叉的平面组成，形成十字形状，使其在各个角度看都有体积感
 * @param {number} offsetY - Y 轴偏移，用于调整植物模型相对于方块底部的垂直高度
 * @returns {THREE.BufferGeometry} 合并后的交叉平面几何体
 */
function buildCrossGeo(offsetY = -0.25) {
  const p1 = new THREE.PlaneGeometry(0.7, 0.7); // 基础平面尺寸 0.7x0.7
  const p2 = new THREE.PlaneGeometry(0.7, 0.7);
  p2.rotateY(Math.PI / 2); // 绕 Y 轴旋转 90 度
  const merged = BufferGeometryUtils.mergeGeometries([p1, p2]); // 合并几何体减少渲染开销
  merged.translate(0, offsetY, 0); // 应用垂直偏移
  return merged;
}
// 花的几何体（交叉平面，向下偏移0.25单位，使花朵看起来生长在地面上）
const geoFlower = buildCrossGeo(-0.25);
// 藤蔓的几何体（交叉平面，无偏移，使藤蔓看起来附着在方块上）
const geoVine = buildCrossGeo(0);

// 垂落叶片的几何体（顶部对齐到0.5以接触上方方块）
// 高度1.0 -> 半高0.5。需要的偏移：0.5 - 0.5 = 0
// const geoHanging = buildCrossGeo(0); // 未使用

/**
 * 睡莲几何体 - 一个旋转为水平方向的平面
 * 用于沼泽生物群系，浮在水面上
 */
const geoLily = (() => {
  const geo = new THREE.PlaneGeometry(0.8, 0.8);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.48, 0);
  return geo;
})();

/**
 * 仙人掌几何体 - 由主茎和多个分支组成的复杂几何体
 * 用于沙漠生物群系，模拟真实仙人掌的形状
 */
const geoCactus = (() => {
  const geoms = [];
  geoms.push(new THREE.BoxGeometry(0.65, 1, 0.65));
  const la = new THREE.BoxGeometry(0.25, 0.25, 0.25); la.translate(-0.4, 0.1, 0); geoms.push(la);
  const lau = new THREE.BoxGeometry(0.25, 0.4, 0.25); lau.translate(-0.4, 0.35, 0); geoms.push(lau);
  const ra = new THREE.BoxGeometry(0.25, 0.25, 0.25); ra.translate(0.4, -0.1, 0); geoms.push(ra);
  const rau = new THREE.BoxGeometry(0.25, 0.3, 0.25); rau.translate(0.4, 0.1, 0); geoms.push(rau);
  return BufferGeometryUtils.mergeGeometries(geoms);
})();

/** 烟囱几何体 - 一个略窄的圆柱体 */
const geoChimney = new THREE.CylinderGeometry(0.15, 0.15, 2, 8);

/**
 * 几何体映射表 - 将方块类型映射到对应的几何体
 */
const geomMap = {
  'flower': geoFlower,
  'short_grass': geoFlower,
  'allium': geoFlower,
  'vine': geoVine,
  'lilypad': geoLily,
  'cactus': geoCactus,
  'chimney': geoChimney,
  'default': new THREE.BoxGeometry(1, 1, 1)
};

/**
 * 区块类 - 负责单个区块的生成、管理和渲染
 * 使用 InstancedMesh 优化相同类型方块的渲染性能
 */
export class Chunk {
  /**
   * 创建区块实例
   * @param {number} cx - 区块的X坐标（区块坐标）
   * @param {number} cz - 区块的Z坐标（区块坐标）
   */
  constructor(cx, cz) {
    this.cx = cx;                    // 区块的X坐标（区块坐标）
    this.cz = cz;                    // 区块的Z坐标（区块坐标）
    this.group = new THREE.Group();  // Three.js 组，包含区块内所有网格
    this.keys = [];                  // 区块标识符（当前未使用）
    this.solidBlocks = new Set();    // 实心方块的集合，用于碰撞检测
    this.isReady = false;            // 区块是否已完成生成
    this.gen();                      // 生成区块内容
  }

  /**
   * 生成区块内容
   * 将计算压力较大的地形和结构生成逻辑分解到 Worker 线程中执行
   */
  async gen() {
    // 0. 加载持久化增量数据
    const deltasMap = await persistenceService.getDeltas(this.cx, this.cz);
    // 将 Map 转换为对象以便通过 postMessage 发送
    const deltas = Object.fromEntries(deltasMap);

    return new Promise((resolve) => {
      const callbackKey = `${this.cx},${this.cz}`;

      // 注册 Worker 回调
      workerCallbacks.set(callbackKey, (data) => {
        const { d, solidBlocks, realisticTrees } = data;

        // 1. 同步实心方块数据 (用于碰撞检测)
        solidBlocks.forEach(k => this.solidBlocks.add(k));

        // 2. 构建渲染网格 (InstancedMesh)
        this.buildMeshes(d);

        // 3. 处理真实感树木 (在主线程生成，因为涉及复杂 Mesh 克隆)
        realisticTrees.forEach(pos => {
          RealisticTree.generate(pos.x, pos.y, pos.z, this, null);
        });

        this.isReady = true;
        resolve();
      });

      // 4. 发送生成请求到 Worker
      worldWorker.postMessage({
        cx: this.cx,
        cz: this.cz,
        seed: SEED,
        deltas
      });
    });
  }

  /**
    * 添加方块到区块中
    * @param {number} x - 世界坐标X
    * @param {number} y - 世界坐标Y
    * @param {number} z - 世界坐标Z
    * @param {string} type - 方块类型（如 'dirt', 'stone', 'wood' 等）
    * @param {Object} dObj - 数据收集对象（用于批量构建网格），如果为null则不收集
    * @param {boolean} solid - 是否为实心方块（影响碰撞检测）
    */
  add(x, y, z, type, dObj = null, solid = true) {
    // 生成方块的唯一键（用于碰撞检测和持久化覆盖检查）
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

    // 如果该位置在当前区块生成期间有持久化增量覆盖，则跳过原始生成逻辑
    if (this._tempDeltas && this._tempDeltas.has(key)) return;

    // 如果提供了数据收集对象，将方块位置按类型分类存储
    if (dObj) {
      if (!dObj[type]) dObj[type] = [];
      dObj[type].push({ x, y, z });
    }
    // 如果是实心方块，添加到实心方块集合中
    if (solid) {
      this.solidBlocks.add(key);
    }
  }

  /**
   * 构建所有网格 - 将收集的方块位置转换为 Three.js 网格
   * 使用 InstancedMesh 优化相同类型方块的渲染性能：
   * 1. 对于每个方块类型，只创建一个 InstancedMesh 实例。
   * 2. 通过一次 Draw Call 渲染该区块内所有的该类方块。
   * @param {Object} d - 数据收集对象，包含按类型分类的方块位置数组
   */
  buildMeshes(d) {
    // 创建一个虚拟对象用于计算每个实例的变换矩阵 (Matrix4)
    const dummy = new THREE.Object3D();

    // 遍历每种方块类型，为每种类型创建一个 InstancedMesh
    for (const type in d) {
      if (d[type].length === 0) continue;  // 跳过没有任何实例的方块类型

      // 从材质管理器和几何体映射表获取资源
      const geometry = geomMap[type] || geomMap['default'];
      const material = materials.getMaterial(type);
      // 创建实例化网格：指定几何体、材质和实例总数
      const mesh = new THREE.InstancedMesh(geometry, material, d[type].length);

      // 存储元数据，便于后续通过 Raycaster 进行交互识别
      mesh.userData = { type: type };
      if (type === 'chest') {
        mesh.userData.chests = {}; // 如果是箱子，初始化一个子对象存储每个箱子的开启状态
      }

    // 为每个实例设置位置矩阵
    d[type].forEach((pos, i) => {
      // 核心偏移：将模型中心对齐到方块中心 (增加 0.5 偏移)
      dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      dummy.updateMatrix();                     // 根据位置生成变换矩阵
      mesh.setMatrixAt(i, dummy.matrix);        // 将矩阵写入实例化缓冲区
      if (type === 'chest') {
        mesh.userData.chests[i] = { open: false }; // 初始化对应索引箱子的状态
      }
    });

    // 重要：标记 instanceMatrix 需要更新，否则 GPU 不会重新加载数据
    mesh.instanceMatrix.needsUpdate = true;

      // 阴影配置优化：半透明物体、植物和云朵默认不投射/接收阴影，以节省渲染开销并避免视觉错误
      if(!['water','swamp_water','cloud','vine','lilypad','flower','short_grass'].includes(type)) {
        mesh.castShadow = true;    // 开启实时阴影投射
        mesh.receiveShadow = true; // 开启实时阴影接收
      }

      // 将实例化网格添加到区块的分组中
      this.group.add(mesh);
    }
  }

  /**
   * 清理资源 - 释放几何体和材质，防止内存泄漏
   * 在区块不再需要时调用
   */
  dispose() {
    // 遍历组中的所有子对象
    this.group.children.forEach(c => {
      // 清理几何体
      if (c.geometry) c.geometry.dispose();
      // 只清理非实例网格的材质，因为实例网格共享材质
      if (!c.isInstancedMesh && c.material) {
        if (Array.isArray(c.material)) {
          // 如果是材质数组，清理每个材质
          c.material.forEach(m => m.dispose());
        } else {
          // 如果是单个材质，直接清理
          c.material.dispose();
        }
      }
    });
    // 清空组，移除所有子对象
    this.group.clear();
  }

  /**
   * 动态添加单个方块（与批量生成相对）
   * 用于游戏运行时玩家放置方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string} type - 方块类型
   */
  /**
   * 动态添加单个方块（与批量生成相对）
   * 用于游戏运行时玩家放置方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string} type - 方块类型
   */
  addBlockDynamic(x, y, z, type) {
    // 检查并移除该位置已有的动态方块（实现位移/替换逻辑）
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (!child.isInstancedMesh &&
          Math.floor(child.position.x) === Math.floor(x) &&
          Math.floor(child.position.y) === Math.floor(y) &&
          Math.floor(child.position.z) === Math.floor(z)) {
        if (child.geometry) child.geometry.dispose();
        if (child.material && !child.isInstancedMesh) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
        this.group.remove(child);
      }
    }

    // 添加到实心方块集合（用于碰撞检测）
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const nonSolidTypes = ['air', 'water', 'swamp_water', 'cloud', 'vine', 'lilypad', 'flower', 'short_grass', 'allium'];

    if (!nonSolidTypes.includes(type)) {
      this.solidBlocks.add(key);
    } else {
      this.solidBlocks.delete(key);
    }

    // 对于空气方块，只更新隐藏面剔除，不创建网格
    if (type !== 'air') {
      // 获取几何体和材质
      const geometry = geomMap[type] || geomMap['default'];
      const material = materials.getMaterial(type);
      // 创建单个网格
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5); // 增加 0.5 偏移
      mesh.userData = { type: type };              // 存储方块类型

      // 设置阴影
      if(!nonSolidTypes.includes(type)) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }

      // 添加到区块组中
      this.group.add(mesh);
    }

    // 隐藏面剔除更新
    if (faceCullingSystem && faceCullingSystem.isEnabled()) {
      const position = new THREE.Vector3(x, y, z);
      const block = { type };

      // 创建简单的邻居数据（实际实现需要从世界数据获取）
      // 这里使用占位符，实际集成将在World.js中完成
      const neighbors = {
        top: null, bottom: null, north: null, south: null, west: null, east: null
      };

      faceCullingSystem.updateBlock(position, block, neighbors);

      // 更新相邻方块的可见面状态
      faceCullingSystem.updateNeighbors(position, (neighborPos) => {
        // 这里需要实现从世界数据获取邻居方块数据
        // 返回null表示无法获取数据，跳过更新
        return null;
      });
    }
  }

  /**
   * 移除方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   */
  removeBlock(x, y, z) {
    // 从实心方块集合中移除（碰撞检测）
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    this.solidBlocks.delete(key);
    // 记录持久化变更
    persistenceService.recordChange(x, y, z, 'air');
    // 移除可能存在的动态方块
    this.addBlockDynamic(x, y, z, 'air');

    // 隐藏面剔除更新：更新相邻方块的可见面状态
    if (faceCullingSystem && faceCullingSystem.isEnabled()) {
      const position = new THREE.Vector3(x, y, z);

      // 更新相邻方块的可见面状态（因为移除了方块，邻居的面可能变得可见）
      faceCullingSystem.updateNeighbors(position, (neighborPos) => {
        // 这里需要实现从世界数据获取邻居方块数据
        // 返回null表示无法获取数据，跳过更新
        return null;
      });
    }
  }
}
