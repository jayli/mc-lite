/**
 * Chunk地形生成模块
 * 负责区块生成、实体生成等功能
 */
import * as THREE from 'three';
import { RealisticTree } from './entities/RealisticTree.js';
import { getBlockProperties, createBlockPropsResolver } from '../constants/BlockData.js';
import { getRotationAngle } from '../utils/OrientationUtils.js';
import { WORLD_CONFIG } from '../utils/MathUtils.js';
import { persistenceService } from '../services/PersistenceService.js';
import { materials } from '../core/MaterialManager.js';
import { carModel, gunManModel } from '../core/Engine.js';
import { geomMap, worldWorker, workerCallbacks } from './ChunkConsolidation.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;
const getMaterials = () => globalThis._materials || materials;
const getCarModel = () => globalThis._carModel || carModel;
const getGunManModel = () => globalThis._gunManModel || gunManModel;

// 获取方块属性函数 - 优先使用测试环境的模拟
const getBlockProps = createBlockPropsResolver(getBlockProperties);

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
        const { d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys, snapshot: newSnapshot, structureCenters } = data;

        // 1. 同步全量方块数据和可见性状态 (完全替换，确保剔除状态同步)
        if (allBlockTypes) this.blockData = allBlockTypes;
        if (visibleKeys) {
          this.visibleKeys = new Set(visibleKeys);
        }
        if (solidBlocks) {
          this.solidBlocks = new Set(solidBlocks);
        }

        // 1.1 保存结构中心列表，用于跨 Chunk 碰撞体生成
        this.structureCenters = structureCenters || [];

        // 1.2 保存实体快照，用于后续合并
        this.entities.realisticTrees = realisticTrees || [];
        this.entities.modGunMan = modGunMan || [];
        this.entities.rovers = rovers || [];

        // 2. 构建渲染网格 (InstancedMesh)
        this.buildMeshes(d);

        // 3. 处理真实感树木 (在主线程生成，因为涉及复杂 Mesh 克隆)
        // 使用实例化渲染优化：记录树木数据，后续批量创建 InstancedMesh
        realisticTrees.forEach(pos => {
          RealisticTree.generate(pos.x, pos.y, pos.z, this, null, true);
        });

        // 3.0 创建实例化树木网格（替换克隆的 Mesh）
        const instancedResult = RealisticTree.createInstancedForChunk(this);
        if (instancedResult) {
          console.log(`Chunk ${this.cx},${this.cz}: Created ${instancedResult.trunkCount} instanced trees`);
        }

        // 3.1 处理模型人 (gun_man.glb)
        if (modGunMan && modGunMan.length > 0 && getGunManModel()) {
          modGunMan.forEach(pos => {
            const gm = getGunManModel().clone();
            if (!gm) return; // 测试环境中可能为 null
            gm.userData.isEntity = true;
            gm.userData.type = 'modGunMan';
            gm.position.set(pos.x + 0.5, pos.y, pos.z + 0.5);

            // 确保可见性
            gm.traverse(child => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.frustumCulled = false;
              }
            });

            // 添加碰撞体：1x1x2
            const collisionBlocks = [];
            for (let dy = 0; dy < 2; dy++) {
              collisionBlocks.push({ x: pos.x, y: pos.y + dy, z: pos.z });
            }

            // 批量应用碰撞块
            collisionBlocks.forEach(b => {
              this.addBlockDynamic(b.x, b.y, b.z, 'collider');
            });

            gm.userData.collisionBlocks = collisionBlocks;
            this.group.add(gm);
          });
        }

        // 3.1 处理火星车模型
        if (rovers && rovers.length > 0 && getCarModel()) {
          rovers.forEach(pos => {
            const car = getCarModel().clone();
            if (!car) return; // 测试环境中可能为 null
            car.userData.isEntity = true;
            car.userData.type = 'rover';
            // 放置在方块顶部中心，注意模型已经处理过，基座在 (0,0,0)
            car.position.set(pos.x + 0.5, pos.y, pos.z + 0.5);

            // 添加碰撞体：火星车尺寸为 5x3x3 (长Z, 高Y, 宽X)
            // 我们以 pos 为基准，模型居中放置
            const collisionBlocks = [];
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = 0; dy < 3; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                  collisionBlocks.push({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz });
                  this.addBlockDynamic(pos.x + dx, pos.y + dy, pos.z + dz, 'collider');
                }
              }
            }
            car.userData.collisionBlocks = collisionBlocks;
            this.group.add(car);
          });
        }

        // 4. 重要：在生成完成后，立即保存快照数据
        if (newSnapshot) {
          const persistence = getPersistenceService();
          // 合并策略：保留缓存中现有的 entities（如炮塔），Worker 只负责 blocks
          // 因为 Worker 不会保留所有实体类型（如 turrets）
          const chunkKey = `${this.cx},${this.cz}`;
          const existingData = persistence?.cache?.get?.(chunkKey);
          if (existingData?.entities) {
            // 保留 Worker 返回的 entities，但补充缓存中有而 Worker 没有的实体类型
            newSnapshot.entities = {
              ...existingData.entities,
              ...newSnapshot.entities,
              // 确保这些实体类型不会被 Worker 的空数组覆盖
              turrets: existingData.entities.turrets || newSnapshot.entities?.turrets || []
            };
          }

          // 先更新内存缓存，避免刚加载完成后立刻修改时写入不到缓存
          // 测试环境的 mock persistence 可能没有 cache 字段，需要兼容
          if (persistence?.cache?.set) {
            persistence.cache.set(chunkKey, newSnapshot);
          }
          persistence?.saveChunkData?.(this.cx, this.cz, newSnapshot);
        }

        // 5. 恢复该 Chunk 中的丧尸巢穴运行时实例（直接按快照记录重建，无需扫描）
        const zombieNests = newSnapshot?.entities?.zombieNests;
        if (Array.isArray(zombieNests) && zombieNests.length > 0) {
          this.world?.zombieNestManager?.restoreNestsForChunk?.(this.cx, this.cz, zombieNests);
        }

        // 6. 恢复该 Chunk 中的炮塔运行时实例（直接按快照记录重建，无需扫描）
        const turrets = newSnapshot?.entities?.turrets;
        if (Array.isArray(turrets) && turrets.length > 0) {
          this.world?.turretManager?.restoreTurretsForChunk?.(this.cx, this.cz, turrets);
        }

        this.isReady = true;
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

    // 遍历每种方块类型，为每种类型创建一个 InstancedMesh
    for (const type in d) {
      const props = getBlockProps(type);
      if (d[type].length === 0 || !props.isRendered) continue;  // 跳过没有任何实例或不需渲染的方块类型

      // 从材质管理器和几何体映射表获取资源
      const geometry = geomMap[props.geometryType] || geomMap['default'];
      const material = getMaterials().getMaterial(type);
      // 创建实例化网格：指定几何体、材质和实例总数
      const mesh = new THREE.InstancedMesh(geometry, material, d[type].length);

      // --- 添加 AO 属性 ---
      // AO 适用于所有实心且不透明的方块
      if (props.isSolid && !props.isTransparent) {
        const aoLowArray = new Float32Array(d[type].length);
        const aoHighArray = new Float32Array(d[type].length);
        d[type].forEach((pos, i) => {
          aoLowArray[i] = pos.aoLow || 0;
          aoHighArray[i] = pos.aoHigh || 0;
        });
        // 必须在 geometry 上克隆或者直接设置，InstancedMesh 共享 geometry 会有问题
        // 但这里我们使用的是共享几何体，所以我们需要为每个 InstancedMesh 唯一的属性
        // 实际上 InstancedBufferAttribute 就是为此设计的
        mesh.geometry = geometry.clone(); // 克隆几何体以拥有独立的属性
        mesh.geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(aoLowArray, 1));
        mesh.geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(aoHighArray, 1));
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
      d[type].forEach((pos, i) => {
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
        mesh.castShadow = true;    // 开启实时阴影投射
        mesh.receiveShadow = true; // 开启实时阴影接收
      }

      // 将实例化网格添加到区块的分S组中
      this.group.add(mesh);
    }
  }
}
