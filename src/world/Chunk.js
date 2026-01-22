// src/world/Chunk.js
import * as THREE from 'three';
import { materials } from '../core/materials/MaterialManager.js';
import { terrainGen } from './TerrainGen.js';
import { Cloud } from './entities/Cloud.js';
import { Tree } from './entities/Tree.js';
import { RealisticTree } from './entities/RealisticTree.js';
import { Island } from './entities/Island.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const CHUNK_SIZE = 16;

// Shared Geometries
// Flower/Vine (Cross)
function buildCrossGeo(offsetY = -0.25) {
    const p1 = new THREE.PlaneGeometry(0.7, 0.7);
    const p2 = new THREE.PlaneGeometry(0.7, 0.7);
    p2.rotateY(Math.PI / 2);
    const merged = BufferGeometryUtils.mergeGeometries([p1, p2]);
    merged.translate(0, offsetY, 0);
    return merged;
}
const geoFlower = buildCrossGeo(-0.25);
const geoVine = buildCrossGeo(0);
// Hanging foliage (top aligned to 0.5 to touch block above)
// Height 1.0 -> half height 0.5. Offset needed: 0.5 - 0.5 = 0
// const geoHanging = buildCrossGeo(0); // Not used, replaced by geoAzaleaHangingCube

// Azalea hanging element - four vertical planes only (no top/bottom faces)
const geoAzaleaHangingCube = (() => {
    const faceSize = 1.0; // Square face to match block size (1:1)
    const faceWidth = faceSize;
    const faceHeight = faceSize;

    // Create four vertical planes facing outward
    // +X facing plane (east)
    const planeXPos = new THREE.PlaneGeometry(faceWidth, faceHeight);
    planeXPos.rotateY(Math.PI / 2); // Face +X direction
    planeXPos.translate(faceWidth / 2, 0, 0);

    // -X facing plane (west)
    const planeXNeg = new THREE.PlaneGeometry(faceWidth, faceHeight);
    planeXNeg.rotateY(-Math.PI / 2); // Face -X direction
    planeXNeg.translate(-faceWidth / 2, 0, 0);

    // +Z facing plane (north)
    const planeZPos = new THREE.PlaneGeometry(faceWidth, faceHeight);
    // Already faces +Z by default
    planeZPos.translate(0, 0, faceWidth / 2);

    // -Z facing plane (south)
    const planeZNeg = new THREE.PlaneGeometry(faceWidth, faceHeight);
    planeZNeg.rotateY(Math.PI); // Face -Z direction
    planeZNeg.translate(0, 0, -faceWidth / 2);

    // Merge all planes
    const merged = BufferGeometryUtils.mergeGeometries([planeXPos, planeXNeg, planeZPos, planeZNeg]);

    // Position geometry so top edge aligns with block top (y = +0.5)
    // Each plane's local origin is at its center, so top edge is at y = faceHeight/2
    // We want top at y = +0.5, so we need to shift up by:
    // shift = desired_top - current_top = 0.5 - faceHeight/2
    // With faceHeight = 1.0, shift = 0.5 - 0.5 = 0 (no translation needed)
    merged.translate(0, 0.5 - faceHeight/2, 0);

    return merged;
})();

// Lilypad
const geoLily = (() => {
    const geo = new THREE.PlaneGeometry(0.8, 0.8);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -0.48, 0);
    return geo;
})();

// Cactus
const geoCactus = (() => {
    const geoms = [];
    geoms.push(new THREE.BoxGeometry(0.65, 1, 0.65));
    const la = new THREE.BoxGeometry(0.25, 0.25, 0.25); la.translate(-0.4, 0.1, 0); geoms.push(la);
    const lau = new THREE.BoxGeometry(0.25, 0.4, 0.25); lau.translate(-0.4, 0.35, 0); geoms.push(lau);
    const ra = new THREE.BoxGeometry(0.25, 0.25, 0.25); ra.translate(0.4, -0.1, 0); geoms.push(ra);
    const rau = new THREE.BoxGeometry(0.25, 0.3, 0.25); rau.translate(0.4, 0.1, 0); geoms.push(rau);
    return BufferGeometryUtils.mergeGeometries(geoms);
})();

const geomMap = {
    'flower': geoFlower,
    'vine': geoVine,
    'azalea_hanging': geoAzaleaHangingCube,
    'lilypad': geoLily,
    'cactus': geoCactus,
    'default': new THREE.BoxGeometry(1, 1, 1)
};

export class Chunk {
    constructor(cx, cz) {
        this.cx = cx;
        this.cz = cz;
        this.group = new THREE.Group();
        this.keys = [];
        this.solidBlocks = new Set();
        this.gen();
    }

    gen() {
        // 初始化所有可能的类型数组，类似原始代码中的逻辑
        const d = {};
        const allTypes = ['grass', 'dirt', 'stone', 'sand', 'wood', 'planks', 'leaves', 'water', 'cactus',
                         'flower', 'chest', 'bed', 'carBody', 'wheel', 'cloud', 'sky_stone', 'sky_grass',
                         'sky_wood', 'sky_leaves', 'moss', 'azalea_log', 'azalea_leaves', 'azalea_hanging', 'swamp_water',
                         'swamp_grass', 'vine', 'lilypad', 'diamond', 'gold', 'apple', 'gold_apple', 'god_sword'];
        for(const type of allTypes) {
            d[type] = [];
        }

        const centerBiome = terrainGen.getBiome(this.cx * CHUNK_SIZE, this.cz * CHUNK_SIZE);

        for (let x = 0; x < CHUNK_SIZE; x++) {
            for (let z = 0; z < CHUNK_SIZE; z++) {
                const wx = this.cx * CHUNK_SIZE + x;
                const wz = this.cz * CHUNK_SIZE + z;

                const h = terrainGen.generateHeight(wx, wz, centerBiome);
                const wLvl = -2;

                if (h < wLvl) {
                    // Underwater
                    const water = centerBiome === 'SWAMP' ? 'swamp_water' : 'water';
                    this.add(wx, h, wz, 'sand', d);
                    for (let k = 1; k <= 3; k++) this.add(wx, h - k, wz, 'sand', d);
                    for (let y = h + 1; y <= wLvl; y++) this.add(wx, y, wz, water, d, false);

                    if (centerBiome === 'SWAMP' && Math.random() < 0.08) {
                        this.add(wx, wLvl + 1, wz, 'lilypad', d, false);
                    }
                    // Shipwreck in deep water
                    if (h < -6 && Math.random() < 0.003) {
                        this.structure('ship', wx, h + 1, wz, d);
                    }
                } else {
                    // Surface
                    let surf = 'grass', sub = 'dirt';
                    if (centerBiome === 'DESERT') { surf = 'sand'; sub = 'sand'; }
                    if (centerBiome === 'AZALEA') { surf = 'moss'; sub = 'dirt'; }
                    if (centerBiome === 'SWAMP') { surf = 'swamp_grass'; sub = 'dirt'; }

                    this.add(wx, h, wz, surf, d);
                    this.add(wx, h - 1, wz, sub, d);
                    for (let k = 2; k <= 12; k++) this.add(wx, h - k, wz, 'stone', d);

                    // Vegetation
                    if (centerBiome === 'FOREST') {
                        if (Math.random() < 0.05) {
                            if (Math.random() < 0.15) { // 15% chance for a realistic tree
                                RealisticTree.generate(wx, h + 1, wz, this);
                            } else {
                                Tree.generate(wx, h + 1, wz, this, 'big', d);
                            }
                        }
                    } else if (centerBiome === 'AZALEA') {
                        if (Math.random() < 0.06) Tree.generate(wx, h + 1, wz, this, 'azalea', d);
                    } else if (centerBiome === 'SWAMP') {
                        if (Math.random() < 0.03) Tree.generate(wx, h + 1, wz, this, 'swamp', d);
                    } else if (centerBiome === 'DESERT') {
                        if (Math.random() < 0.01) this.add(wx, h + 1, wz, 'cactus', d);
                        if (Math.random() < 0.001) this.structure('rover', wx, h + 1, wz, d);
                    } else {
                        if (Math.random() < 0.005) Tree.generate(wx, h + 1, wz, this, 'default', d);
                        if (Math.random() < 0.05) this.add(wx, h + 1, wz, 'flower', d, false);
                        if (Math.random() < 0.001) this.structure('house', wx, h + 1, wz, d);
                    }
                }

                if (terrainGen.shouldGenerateCloud(wx, wz)) {
                    Cloud.generate(wx, 55, wz, this, d);
                }
            }
        }

        // Sky Islands
        if (Math.random() < 0.15) {
            const islandY = 40 + Math.floor(Math.random() * 30);
            const centerWx = this.cx * CHUNK_SIZE + 8;
            const centerWz = this.cz * CHUNK_SIZE + 8;
            Island.generate(centerWx, islandY, centerWz, this, d);
        }

        this.buildMeshes(d);
    }

    add(x, y, z, type, dObj = null, solid = true) {
        if (dObj) {
            if (!dObj[type]) dObj[type] = [];
            dObj[type].push({ x, y, z });
        }
        const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
        if (solid) this.solidBlocks.add(key);
    }

    structure(type, x, y, z, dObj) {
        if (type === 'house') {
            for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) this.add(x + i, y - 1, z + j, 'stone', dObj);
            for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
                if (Math.abs(i) === 2 || Math.abs(j) === 2) {
                    if (i === 0 && j === 2) continue;
                    if ((i === -2 || i === 2) && j === 0) {
                        this.add(x + i, y, z + j, 'planks', dObj);
                        this.add(x + i, y + 2, z + j, 'planks', dObj);
                    } else {
                        for (let h = 0; h < 3; h++) this.add(x + i, y + h, z + j, 'planks', dObj);
                    }
                }
            }
            for (let h = 0; h < 3; h++) for (let i = -2 + h; i <= 2 - h; i++) {
                this.add(x + i, y + 3 + h, z - 2 + h, 'wood', dObj);
                this.add(x + i, y + 3 + h, z + 2 - h, 'wood', dObj);
            }
            for (let j = -1; j <= 1; j++) this.add(x, y + 5, z + j, 'wood', dObj);
            this.add(x - 1, y, z - 1, 'bed', dObj, false);
            this.add(x + 1, y, z - 1, 'chest', dObj);
        } else if (type === 'rover') {
            this.add(x - 1, y, z - 1, 'wheel', dObj);
            this.add(x + 1, y, z - 1, 'wheel', dObj);
            this.add(x - 1, y, z + 1, 'wheel', dObj);
            this.add(x + 1, y, z + 1, 'wheel', dObj);
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 2; dz++) this.add(x + dx, y + 1, z + dz, 'carBody', dObj);
            this.add(x, y + 2, z, 'chest', dObj);
        } else if (type === 'ship') {
            for (let dz = -3; dz <= 3; dz++) for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) === 2 || Math.abs(dz) === 3) {
                    this.add(x + dx, y + 1, z + dz, 'wood', dObj);
                    this.add(x + dx, y + 2, z + dz, 'planks', dObj);
                } else {
                    this.add(x + dx, y, z + dz, 'planks', dObj);
                }
            }
            for (let i = 0; i < 5; i++) this.add(x, y + i, z, 'wood', dObj);
            this.add(x, y + 1, z + 2, 'chest', dObj);
        }
    }

    buildMeshes(d) {
        const dummy = new THREE.Object3D();

        for (const type in d) {
            if (d[type].length === 0) continue;

            const geometry = geomMap[type] || geomMap['default'];
            const material = materials.getMaterial(type);
            const mesh = new THREE.InstancedMesh(geometry, material, d[type].length);

            mesh.userData = { type: type };
            if (type === 'chest') {
                mesh.userData.chests = {};
            }

            d[type].forEach((pos, i) => {
                dummy.position.set(pos.x, pos.y, pos.z);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                if (type === 'chest') {
                    mesh.userData.chests[i] = { open: false };
                }
            });

            // Important: Mark instance matrix as needing update after setting all matrices
            mesh.instanceMatrix.needsUpdate = true;

            // 半透明和特殊模型不投阴影
            if(!['water','swamp_water','cloud','vine','azalea_hanging','lilypad','flower'].includes(type)) {
                mesh.castShadow = true;
                mesh.receiveShadow = true;
            }

            this.group.add(mesh);
        }
    }

    dispose() {
        this.group.children.forEach(c => {
            if (c.geometry) c.geometry.dispose();
            // Dispose material only for non-instanced meshes, as instanced ones share materials
            if (!c.isInstancedMesh && c.material) {
                if (Array.isArray(c.material)) {
                    c.material.forEach(m => m.dispose());
                } else {
                    c.material.dispose();
                }
            }
        });
        this.group.clear();
    }

    addBlockDynamic(x, y, z, type) {
        const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
        this.solidBlocks.add(key);

        const geometry = geomMap[type] || geomMap['default'];
        const material = materials.getMaterial(type);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.userData = { type: type };
        mesh.castShadow = !material.transparent;
        mesh.receiveShadow = !material.transparent;

        this.group.add(mesh);
    }

    removeBlock(x, y, z) {
        const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
        this.solidBlocks.delete(key);
        // Visual removal logic handled by Player/Game interaction
    }
}
