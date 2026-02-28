// src/world/entity-system/RealisticTreeManager.js
// 真实树木模板管理器模块
// 创建可重用的树木模板以供高效生成
import * as THREE from 'three';
import { materials } from '../../core/MaterialManager.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 真实树木模板管理器类
 * 管理多个树木模板，初始化时创建多个随机树木几何体
 */
class RealisticTreeManager {
  constructor() {
    this.templates = [];
    // 实例化渲染支持：按区块存储待合并的树木数据
    this.chunkTreeData = new Map(); // key: "cx,cz" -> [{x, y, z, templateIndex}]
  }

  /**
   * 初始化树木模板
   * 创建指定数量的随机树木模板
   */
  init() {
    const templateCount = 5;
    for (let i = 0; i < templateCount; i++) {
      this.templates.push(this._createTreeTemplate());
    }
    console.log(`Generated ${this.templates.length} realistic tree templates.`);
  }

  /**
   * 获取随机树木模板
   * @returns {Object|null} 树木模板对象，包含trunk、leaves和trunkHeight属性
   */
  getRandomTemplate() {
    if (this.templates.length === 0) {
      console.error("Tree templates not initialized!");
      return null;
    }
    return this.templates[Math.floor(Math.random() * this.templates.length)];
  }

  /**
   * 获取模板索引（用于实例化时引用特定模板）
   * @returns {number} 模板索引
   */
  getRandomTemplateIndex() {
    if (this.templates.length === 0) {
      return -1;
    }
    return Math.floor(Math.random() * this.templates.length);
  }

  /**
   * 记录树木到区块数据（用于后续实例化合并）
   * @param {number} cx - 区块 X 坐标
   * @param {number} cz - 区块 Z 坐标
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   * @param {number} z - 世界坐标 Z
   * @param {number} templateIndex - 模板索引
   */
  addTreeToChunk(cx, cz, x, y, z, templateIndex) {
    const chunkKey = `${cx},${cz}`;
    if (!this.chunkTreeData.has(chunkKey)) {
      this.chunkTreeData.set(chunkKey, []);
    }
    this.chunkTreeData.get(chunkKey).push({ x, y, z, templateIndex });
  }

  /**
   * 获取区块的树木数据
   * @param {number} cx - 区块 X 坐标
   * @param {number} cz - 区块 Z 坐标
   * @returns {Array|null} 树木数据数组
   */
  getChunkTreeData(cx, cz) {
    const chunkKey = `${cx},${cz}`;
    return this.chunkTreeData.get(chunkKey) || null;
  }

  /**
   * 清除区块的树木数据（合并后调用）
   * @param {number} cx - 区块 X 坐标
   * @param {number} cz - 区块 Z 坐标
   */
  clearChunkTreeData(cx, cz) {
    const chunkKey = `${cx},${cz}`;
    this.chunkTreeData.delete(chunkKey);
  }

  /**
   * 为指定区块创建实例化树木网格
   * @param {number} cx - 区块 X 坐标
   * @param {number} cz - 区块 Z 坐标
   * @param {THREE.Group} chunkGroup - 区块组对象
   * @param {Set} chunkSolidBlocks - 区块碰撞集合
   * @param {Map} instanceIndexMap - 实例索引映射（用于移除方块时查找）
   * @returns {Object|null} 包含树干和树叶 InstancedMesh 的对象
   */
  createInstancedTreesForChunk(cx, cz, chunkGroup, chunkSolidBlocks = null, instanceIndexMap = null) {
    const treeData = this.getChunkTreeData(cx, cz);
    if (!treeData || treeData.length === 0) {
      return null;
    }

    const trunkMat = materials.getMaterial('realistic_trunk_procedural');
    const leavesMat = materials.getMaterial('realistic_oak_leaves');
    const dummy = new THREE.Object3D();

    // 初始化实例索引映射
    if (instanceIndexMap) {
      instanceIndexMap['realistic_trunk'] = new Map();
      instanceIndexMap['realistic_leaves'] = new Map();
    }

    // 为每个模板创建实例化网格
    for (let tIdx = 0; tIdx < this.templates.length; tIdx++) {
      const treesForTemplate = treeData.filter(t => t.templateIndex === tIdx);
      if (treesForTemplate.length === 0) continue;

      const template = this.templates[tIdx];

      // --- 创建树干 InstancedMesh ---
      const trunkGeo = template.trunk.geometry;
      const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treesForTemplate.length);
      trunkMesh.castShadow = true;
      trunkMesh.receiveShadow = true;
      trunkMesh.userData = { type: 'realistic_trunk', isTreePart: true };

      treesForTemplate.forEach((tree, i) => {
        dummy.position.set(
          tree.x + 0.5,
          tree.y + template.trunkHeight / 2 - 0.5,
          tree.z + 0.5
        );
        dummy.rotation.set(template.trunk.rotation.x, template.trunk.rotation.y, template.trunk.rotation.z);
        dummy.scale.copy(template.trunk.scale);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(i, dummy.matrix);

        // 记录树干底部位置到索引映射（用于移除时查找）
        if (instanceIndexMap && instanceIndexMap['realistic_trunk']) {
          const posKey = `${Math.floor(tree.x)},${Math.floor(tree.y)},${Math.floor(tree.z)}`;
          instanceIndexMap['realistic_trunk'].set(posKey, i);
        }
      });
      trunkMesh.instanceMatrix.needsUpdate = true;
      chunkGroup.add(trunkMesh);

      // --- 创建树叶 InstancedMesh ---
      const leavesGeo = template.leaves.geometry;
      const leavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, treesForTemplate.length);
      leavesMesh.castShadow = true;
      leavesMesh.userData = { type: 'realistic_leaves', isTreePart: true };

      treesForTemplate.forEach((tree, i) => {
        dummy.position.set(
          tree.x + 0.5,
          tree.y,
          tree.z + 0.5
        );
        dummy.rotation.set(0, 0, 0); // 树叶使用世界旋转
        dummy.scale.copy(template.leaves.scale);
        dummy.updateMatrix();
        leavesMesh.setMatrixAt(i, dummy.matrix);

        // 记录树叶位置到索引映射（用于移除时查找）
        if (instanceIndexMap && instanceIndexMap['realistic_leaves']) {
          const posKey = `${Math.floor(tree.x)},${Math.floor(tree.y)},${Math.floor(tree.z)}`;
          instanceIndexMap['realistic_leaves'].set(posKey, i);
        }
      });
      leavesMesh.instanceMatrix.needsUpdate = true;
      chunkGroup.add(leavesMesh);

      // 添加碰撞数据
      if (chunkSolidBlocks) {
        treesForTemplate.forEach(tree => {
          for (let i = 0; i < Math.ceil(template.trunkHeight); i++) {
            const key = `${Math.floor(tree.x)},${Math.floor(tree.y + i)},${Math.floor(tree.z)}`;
            chunkSolidBlocks.add(key);
          }
        });
      }
    }

    // 清除已处理的数据
    this.clearChunkTreeData(cx, cz);

    return { trunkCount: treeData.length };
  }

  /**
   * 创建单个树木模板（私有方法）
   * @returns {Object} 树木模板对象，包含trunk、leaves和trunkHeight属性
   * @private
   */
  _createTreeTemplate() {
    // 这与RealisticTree.js中的生成逻辑相同，但现在用于创建可重用的模板
    const trunkHeight = 7 + Math.random() * 3;
    const trunkRadius = 0.35 + Math.random() * 0.15;

    // 树干
    const trunkGeo = new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.2, trunkHeight, 8);
    const trunkMat = materials.getMaterial('realistic_trunk_procedural');
    const trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    trunkMesh.userData = { type: 'realistic_trunk', health: 5, isTreePart: true };

    // 树叶
    const leavesMat = materials.getMaterial('realistic_oak_leaves');
    const leafSize = 2 + Math.random() * 1.5; // 较小的叶片平面
    const leafCount = 70; // 更多叶片平面
    const canopyRadius = 3.5;
    const leafGeometries = [];
    const dummy = new THREE.Object3D();

    // 生成多个随机分布的叶片平面
    for (let i = 0; i < leafCount; i++) {
      const leafGeo = new THREE.PlaneGeometry(leafSize, leafSize);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.position.set(
        (Math.random() - 0.5) * canopyRadius * 2,
        trunkHeight + (Math.random() - 0.5) * 2.5, // 稍微扩大垂直分布
        (Math.random() - 0.5) * canopyRadius * 2
      );
      dummy.updateMatrix();
      leafGeo.applyMatrix4(dummy.matrix);
      leafGeometries.push(leafGeo);
    }

    // 合并所有叶片几何体以提高渲染性能
    const mergedLeavesGeo = BufferGeometryUtils.mergeGeometries(leafGeometries);
    const leavesMesh = new THREE.Mesh(mergedLeavesGeo, leavesMat);
    leavesMesh.castShadow = true;
    leavesMesh.userData = { type: 'realistic_leaves', health: 2, isTreePart: true };

    return { trunk: trunkMesh, leaves: leavesMesh, trunkHeight };
  }
}

// 真实树木管理器实例
export const realisticTreeManager = new RealisticTreeManager();
