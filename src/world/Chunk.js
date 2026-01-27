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

/** 区块尺寸 - 每个区块在X和Z方向上的方块数量 */
const CHUNK_SIZE = 16;

// --- Worker 设置 ---
const worldWorker = new Worker(new URL('./WorldWorker.js', import.meta.url), { type: 'module' });
const workerCallbacks = new Map();

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

// 共享几何体定义 - 用于优化渲染性能，避免重复创建相同几何体

/**
 * 构建交叉平面几何体（用于花、藤蔓等植物）
 * 由两个垂直交叉的平面组成，形成十字形状
 * @param {number} offsetY - Y轴偏移，用于调整植物在地面上的高度
 * @returns {THREE.BufferGeometry} 合并后的交叉平面几何体
 */
function buildCrossGeo(offsetY = -0.25) {
  const p1 = new THREE.PlaneGeometry(0.7, 0.7);
  const p2 = new THREE.PlaneGeometry(0.7, 0.7);
  p2.rotateY(Math.PI / 2);
  const merged = BufferGeometryUtils.mergeGeometries([p1, p2]);
  merged.translate(0, offsetY, 0);
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
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;

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
   * 使用 InstancedMesh 优化相同类型方块的渲染性能
   * @param {Object} d - 数据收集对象，包含按类型分类的方块位置数组
   */
  buildMeshes(d) {
    // 创建一个虚拟对象用于计算实例矩阵
    const dummy = new THREE.Object3D();

    // 遍历每种方块类型，为每种类型创建一个 InstancedMesh
    for (const type in d) {
      if (d[type].length === 0) continue;  // 跳过没有方块的类型

      // 获取几何体和材质
      const geometry = geomMap[type] || geomMap['default'];  // 使用默认几何体如果未找到
      const material = materials.getMaterial(type);          // 从材质管理器获取材质
      const mesh = new THREE.InstancedMesh(geometry, material, d[type].length);  // 创建实例网格

      // 存储用户数据，包含方块类型信息
      mesh.userData = { type: type };
      // 如果是箱子，初始化箱子状态对象
      if (type === 'chest') {
        mesh.userData.chests = {};
      }

    // 为每个实例设置位置矩阵
    d[type].forEach((pos, i) => {
      dummy.position.set(pos.x, pos.y, pos.z);  // 设置虚拟对象位置
      dummy.updateMatrix();                     // 更新变换矩阵
      mesh.setMatrixAt(i, dummy.matrix);        // 设置实例矩阵
      // 如果是箱子，初始化该箱子的状态
      if (type === 'chest') {
        mesh.userData.chests[i] = { open: false };
      }
    });

    // 重要：设置完所有实例矩阵后标记需要更新
    mesh.instanceMatrix.needsUpdate = true;

      // 设置阴影：半透明和特殊模型不投射/接收阴影
      if(!['water','swamp_water','cloud','vine','lilypad','flower','short_grass'].includes(type)) {
        mesh.castShadow = true;    // 投射阴影
        mesh.receiveShadow = true; // 接收阴影
      }

      // 将网格添加到区块组中
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
          Math.round(child.position.x) === Math.round(x) &&
          Math.round(child.position.y) === Math.round(y) &&
          Math.round(child.position.z) === Math.round(z)) {
        if (child.geometry) child.geometry.dispose();
        if (child.material && !child.isInstancedMesh) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
        this.group.remove(child);
      }
    }

    // 添加到实心方块集合（用于碰撞检测）
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    const nonSolidTypes = ['air', 'water', 'swamp_water', 'cloud', 'vine', 'lilypad', 'flower', 'short_grass', 'allium'];

    if (!nonSolidTypes.includes(type)) {
      this.solidBlocks.add(key);
    } else {
      this.solidBlocks.delete(key);
    }

    if (type === 'air') return;

    // 获取几何体和材质
    const geometry = geomMap[type] || geomMap['default'];
    const material = materials.getMaterial(type);
    // 创建单个网格
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);                  // 设置位置
    mesh.userData = { type: type };              // 存储方块类型

    // 设置阴影
    if(!nonSolidTypes.includes(type)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    // 添加到区块组中
    this.group.add(mesh);
  }

  /**
   * 移除方块
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   */
  removeBlock(x, y, z) {
    // 从实心方块集合中移除（碰撞检测）
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
    this.solidBlocks.delete(key);
    // 记录持久化变更
    persistenceService.recordChange(x, y, z, 'air');
    // 移除可能存在的动态方块
    this.addBlockDynamic(x, y, z, 'air');
  }
}
