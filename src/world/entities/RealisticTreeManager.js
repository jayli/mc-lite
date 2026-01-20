// src/world/entities/RealisticTreeManager.js
import * as THREE from 'three';
import { materials } from '../../core/materials/MaterialManager.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

class RealisticTreeManager {
    constructor() {
        this.templates = [];
    }

    init() {
        const templateCount = 5;
        for (let i = 0; i < templateCount; i++) {
            this.templates.push(this._createTreeTemplate());
        }
        console.log(`Generated ${this.templates.length} realistic tree templates.`);
    }

    getRandomTemplate() {
        if (this.templates.length === 0) {
            console.error("Tree templates not initialized!");
            return null;
        }
        return this.templates[Math.floor(Math.random() * this.templates.length)];
    }

    _createTreeTemplate() {
        // This is the same generation logic from RealisticTree.js,
        // but now it's used to create reusable templates.
        const trunkHeight = 7 + Math.random() * 3;
        const trunkRadius = 0.35 + Math.random() * 0.15;

        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.2, trunkHeight, 8);
        const trunkMat = materials.getMaterial('realistic_trunk_procedural');
        const trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
        trunkMesh.castShadow = true;
        trunkMesh.receiveShadow = true;
        trunkMesh.userData = { type: 'realistic_trunk', health: 5, isTreePart: true };

        // Leaves
        const leavesMat = materials.getMaterial('realistic_oak_leaves');
        const leafSize = 2 + Math.random() * 1.5; // Smaller leaf planes
        const leafCount = 70; // More leaf planes
        const canopyRadius = 3.5;
        const leafGeometries = [];
        const dummy = new THREE.Object3D();

        for (let i = 0; i < leafCount; i++) {
            const leafGeo = new THREE.PlaneGeometry(leafSize, leafSize);
            dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            dummy.position.set(
                (Math.random() - 0.5) * canopyRadius * 2,
                trunkHeight + (Math.random() - 0.5) * 2.5, // Widen vertical spread slightly
                (Math.random() - 0.5) * canopyRadius * 2
            );
            dummy.updateMatrix();
            leafGeo.applyMatrix4(dummy.matrix);
            leafGeometries.push(leafGeo);
        }

        const mergedLeavesGeo = BufferGeometryUtils.mergeGeometries(leafGeometries);
        const leavesMesh = new THREE.Mesh(mergedLeavesGeo, leavesMat);
        leavesMesh.castShadow = true;
        leavesMesh.userData = { type: 'realistic_leaves', health: 2, isTreePart: true };

        return { trunk: trunkMesh, leaves: leavesMesh, trunkHeight };
    }
}

export const realisticTreeManager = new RealisticTreeManager();
