// src/world/World.js
import * as THREE from 'three';
import { Chunk } from './Chunk.js';
import { materials } from '../core/materials/MaterialManager.js';
import { chestManager } from './entities/Chest.js';

const CHUNK_SIZE = 16;
const RENDER_DIST = 3;

export class World {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map(); // Key: "cx,cz" -> Chunk
        this.activeParticles = [];
    }

    update(playerPos = new THREE.Vector3(), dt = 0) { // Default for safety
        const cx = Math.floor(playerPos.x / CHUNK_SIZE);
        const cz = Math.floor(playerPos.z / CHUNK_SIZE);

        // Load new chunks
        for (let i = -RENDER_DIST; i <= RENDER_DIST; i++) {
            for (let j = -RENDER_DIST; j <= RENDER_DIST; j++) {
                const key = `${cx + i},${cz + j}`;
                if (!this.chunks.has(key)) {
                    const chunk = new Chunk(cx + i, cz + j);
                    this.chunks.set(key, chunk);
                    this.scene.add(chunk.group);
                }
            }
        }

        // Unload old chunks
        for (const [key, chunk] of this.chunks) {
            if (Math.abs(chunk.cx - cx) > RENDER_DIST + 1 || Math.abs(chunk.cz - cz) > RENDER_DIST + 1) {
                this.scene.remove(chunk.group);
                chunk.dispose();
                this.chunks.delete(key);
            }
        }

        // Update particles
        for (let i = this.activeParticles.length - 1; i >= 0; i--) {
            const p = this.activeParticles[i];
            p.userData.life -= 0.02;
            p.position.add(p.userData.vel);
            p.userData.vel.y -= 0.01;
            p.scale.setScalar(p.userData.life);
            if (p.userData.life <= 0) {
                this.scene.remove(p);
                // p.geometry.dispose(); // Shared geometry, do not dispose
                // p.material.dispose(); // Shared material, do not dispose (if using manager)
                // Actually, particles use basic material created on fly often.
                if (p.material.dispose) p.material.dispose();
                this.activeParticles.splice(i, 1);
            }
        }

        // Update chest animations
        chestManager.update(dt);
    }

    spawnParticles(pos, type) {
        const matDef = materials.getMaterial(type);
        // Extract color from material if possible, or lookup
        // Simplified: just use a basic material with approximate color
        const color = matDef.color || 0xffffff;
        const mat = new THREE.MeshBasicMaterial({ color: color });
        const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1); // Small particle

        for (let i = 0; i < 5; i++) {
            const p = new THREE.Mesh(geometry, mat);
            p.position.copy(pos).addScalar((Math.random() - 0.5) * 0.8);
            p.userData = { vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2), life: 1.0 };
            this.scene.add(p);
            this.activeParticles.push(p);
        }
    }

    isSolid(x, y, z) {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        const chunk = this.chunks.get(key);
        if (!chunk) return false;

        const blockKey = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
        return chunk.solidBlocks.has(blockKey);
    }

    setBlock(x, y, z, type) {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        let chunk = this.chunks.get(key);

        if (!chunk) {
            // Should create chunk if doesn't exist? Or ignore?
            // Usually we only place in loaded chunks.
            return;
        }

        // Add logical block
        // For refactor parity, main.js just pushed mesh to scene.
        // Chunk.js adds to local tracking.
        // We need to actually add a mesh instance or a single mesh.
        // Chunk architecture here uses InstancedMesh for initial gen.
        // Dynamic blocks should probably be separate or managed.
        // Simple approach: Chunk.addBlock(x,y,z,type) -> adds single Mesh to group.
        // Rebuilding whole chunk instanced mesh is too expensive for single block place.
        chunk.addBlockDynamic(x, y, z, type);
    }

    removeBlock(x, y, z) {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const key = `${cx},${cz}`;
        const chunk = this.chunks.get(key);
        if (chunk) {
            chunk.removeBlock(x, y, z);
        }
    }
}
