// src/entities/player/Physics.js
import * as THREE from 'three';
import { noise } from '../../utils/MathUtils.js';

export class Physics {
    constructor(player, world) {
        this.player = player;
        this.world = world;
        this.gravity = -0.015;
        this.terminalVelocity = -1.0;
        this.playerHeight = 1.1;
        this.jumpForce = 0.22;
        this.speed = 0.12;
    }

    checkCollision(nx, nz) {
        // Simple AABB / Voxel collision
        // Checks foot level and head level
        const x = nx;
        const z = nz;
        const y1 = Math.floor(this.player.position.y);
        const y2 = Math.floor(this.player.position.y + this.playerHeight * 0.8);

        return this.isSolid(x, y1, z) || this.isSolid(x, y2, z);
    }

    isSolid(x, y, z) {
        // Need to query World/Chunk system
        // For refactor parity, we rely on the World's chunk data or solid block map
        // The original logic used a global `solidBlocks` Map.
        // We need to implement `world.isSolid(x,y,z)` or similar.
        // Let's assume World exposes this for now or we build it.
        // Since World manages Chunks, we should ask World.
        // BUT, Chunks hold the data locally now in `solidBlocks` Set.

        // Let's implement a helper in World or here to look up chunks.
        return this.world.isSolid(x, y, z);
    }

    update(dt) {
        // Physics update called by Player
        // This class might just provide helpers or handle velocity integration
    }
}
