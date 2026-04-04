/**
 * Chunk地形生成模块
 * 负责区块生成、实体生成等功能
 */
import * as THREE from 'three';
import { getBlockProperties, createBlockPropsResolver } from '../constants/BlockData.js';
import { getRotationAngle } from '../utils/OrientationUtils.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { persistenceService } from '../services/PersistenceService.js';
import { materials } from '../core/MaterialManager.js';
import { geomMap, worldWorker, workerCallbacks } from './ChunkConsolidation.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;
const getMaterials = () => globalThis._materials || materials;

// 获取方块属性函数 - 优先使用测试环境的模拟
const getBlockProps = createBlockPropsResolver(getBlockProperties);
// 阴影投射白名单规则：所有“实心且可渲染”的方块都允许投射阴影
const isSolidShadowCaster = (props) => props.isSolid && props.isRendered !== false;
const isGlassType = (type) => typeof type === 'string' && type.includes('glass');

export function extendChunk(Chunk) {
  /**
   * 生成区块内容
   * 将计算压力较大的地形和结构生成逻辑分解到 Worker 线程中执行
   */
  Chunk.prototype.gen = async function() {
    // 0. 加载持久化全量数据 (快照)
    const snapshot = await getPersistenceService().getChunkData(this.cx, this.cz);

    return new Promise((resolve) => {
      const callbackKey = `${this.cx},${this.cz}`;

      // 注册 Worker 回调
      workerCallbacks.set(callbackKey, (data) => {
        this.acceptWorkerResult(data);
        this.world?.onChunkWorkerReady?.(this);
        resolve();
      });

      // 4. 发送生成请求到 Worker
      worldWorker.postMessage({
        cx: this.cx,
        cz: this.cz,
        seed: WORLD_CONFIG.SEED,
        snapshot
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
    * @param {number} orientation - 方块朝向（0-3），默认为 0
    */
  Chunk.prototype.add = function(x, y, z, type, dObj = null, solid = true, orientation = 0) {
    // 生成方块的唯一键（用于碰撞检测和持久化覆盖检查）
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

    // 如果提供了数据收集对象，将方块位置按类型分类存储
    if (dObj) {
      if (!dObj[type]) dObj[type] = [];
      dObj[type].push({ x, y, z, orientation: orientation || 0 });
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
   * @param {boolean} skipEntities - 是否跳过实体生成逻辑（用于合并优化）
   */
  Chunk.prototype.buildMeshes = function(d) {
    // 创建一个虚拟对象用于计算每个实例的变换矩阵 (Matrix4)
    const dummy = new THREE.Object3D();
    const currentChunkKey = `${this.cx},${this.cz}`;

    // 渲染去重：小型实体（tree、gunman 等）可能跨 Chunk 渲染
    // 当坐标所属 Chunk 已就绪且有相同类型方块时，跳过当前 Chunk 的重复渲染
    const shouldRenderPos = (pos, blockType) => {
      const ix = Math.floor(pos.x);
      const iy = Math.floor(pos.y);
      const iz = Math.floor(pos.z);
      const coordCx = Math.floor(ix / 16);
      const coordCz = Math.floor(iz / 16);
      const coordChunkKey = `${coordCx},${coordCz}`;

      // 坐标归属当前 Chunk：始终渲染
      if (coordChunkKey === currentChunkKey) return true;

      // 跨 Chunk 方块：若坐标所属 Chunk 已就绪且存在同类型方块，则跳过（去重）
      // 关键：必须比较类型，否则坐标所属 Chunk 的不同方块（如地形方块）会错误地隐藏跨区块树叶
      const coordChunk = this.world?.chunks?.get(coordChunkKey);
      if (coordChunk?.isReady) {
        const key = `${ix},${iy},${iz}`;
        const coordEntry = coordChunk.blockData?.[key];
        if (coordEntry !== undefined) {
          const coordType = typeof coordEntry === 'string' ? coordEntry : coordEntry.type;
          if (coordType === blockType) {
            return false;
          }
        }
      }

      // 坐标所属 Chunk 未加载或没有同类型方块时保留渲染
      return true;
    };

    // 遍历每种方块类型，为每种类型创建一个 InstancedMesh
    for (const type in d) {
      const props = getBlockProps(type);
      if (d[type].length === 0 || !props.isRendered) continue;  // 跳过没有任何实例或不需渲染的方块类型

      // 检查是否已存在相同类型的 InstancedMesh（如树叶在合并时被保留）
      const existingMesh = this.group.children.find(c => c.isInstancedMesh && c.userData.type === type);
      if (existingMesh) continue; // 跳过已存在的类型，避免重复创建

      const renderPositions = d[type].filter(shouldRenderPos);
      if (renderPositions.length === 0) continue;

      // 从材质管理器和几何体映射表获取资源
      const geometry = geomMap[props.geometryType] || geomMap['default'];
      const material = getMaterials().getMaterial(type);
      // 创建实例化网格：指定几何体、材质和实例总数
      const mesh = new THREE.InstancedMesh(geometry, material, renderPositions.length);
      mesh.frustumCulled = false;

      // --- 添加 AO 属性 ---
      // AO 适用于所有实心且不透明的方块
      if (props.isSolid && !props.isTransparent) {
        const aoLowArray = new Float32Array(renderPositions.length);
        const aoHighArray = new Float32Array(renderPositions.length);
        const orientationArray = new Float32Array(renderPositions.length);
        renderPositions.forEach((pos, i) => {
          aoLowArray[i] = pos.aoLow || 0;
          aoHighArray[i] = pos.aoHigh || 0;
          orientationArray[i] = pos.orientation || 0;
        });
        // 必须在 geometry 上克隆或者直接设置，InstancedMesh 共享 geometry 会有问题
        // 但这里我们使用的是共享几何体，所以我们需要为每个 InstancedMesh 唯一的属性
        // 实际上 InstancedBufferAttribute 就是为此设计的
        mesh.geometry = geometry.clone(); // 克隆几何体以拥有独立的属性
        mesh.geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(aoLowArray, 1));
        mesh.geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(aoHighArray, 1));
        mesh.geometry.setAttribute('aOrientation', new THREE.InstancedBufferAttribute(orientationArray, 1));
      }

      // 存储元数据，便于后续通过 Raycaster 进行交互识别
      mesh.userData = { type: type };
      if (type === 'chest') {
        mesh.userData.chests = {}; // 如果是箱子，初始化一个子对象存储每个箱子的开启状态
      }

      // 为每个实例设置位置矩阵
      // 跳过树木类型，因为树木的 instanceIndexMap 已经在 createInstancedTreesForChunk 中设置
      if (type !== 'realistic_trunk' && type !== 'realistic_leaves') {
        this.instanceIndexMap[type] = new Map();
      }
      renderPositions.forEach((pos, i) => {
        // 核心偏移：将模型中心对齐到方块中心 (增加 0.5 偏移)
        dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
        // 应用朝向旋转（如果有）
        const orientation = pos.orientation || 0;
        dummy.rotation.set(0, getRotationAngle(orientation), 0);
        dummy.updateMatrix();                     // 根据位置和旋转生成变换矩阵
        mesh.setMatrixAt(i, dummy.matrix);        // 将矩阵写入实例化缓冲区

        const posKey = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
        this.instanceIndexMap[type].set(posKey, i);

        if (type === 'chest') {
          mesh.userData.chests[i] = { open: false }; // 初始化对应索引箱子的状态
        }
      });

      // 重要：标记 instanceMatrix 需要更新，否则 GPU 不会重新加载数据
      mesh.instanceMatrix.needsUpdate = true;

      // 阴影配置优化
      if(props.isShadowEnabled) {
        if (isGlassType(type)) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        } else {
          mesh.castShadow = isSolidShadowCaster(props);
          mesh.receiveShadow = true; // 开启实时阴影接收
        }
      }

      // 将实例化网格添加到区块的分组中
      this.group.add(mesh);
    }
  }
}
