// src/world/entities/RealisticTreeManager.js
// 真实树木模板管理器模块
// 创建可重用的树木模板以供高效生成
import * as THREE from 'three';
import { materials } from '../../core/materials/MaterialManager.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 真实树木模板管理器类
 * 管理多个树木模板，初始化时创建多个随机树木几何体
 */
class RealisticTreeManager {
    constructor() {
        this.templates = [];
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
