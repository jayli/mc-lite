// src/world/entities/RealisticTree.js
import { realisticTreeManager } from './RealisticTreeManager.js';

export class RealisticTree {
    static generate(x, y, z, chunk) {
        const template = realisticTreeManager.getRandomTemplate();
        if (!template) return;

        // --- Clone Trunk ---
        const trunkMesh = template.trunk.clone();
        trunkMesh.position.set(x, y + template.trunkHeight / 2 - 0.5, z);
        chunk.group.add(trunkMesh);

        // Add blocks for collision
        for (let i = 0; i < Math.ceil(template.trunkHeight); i++) {
            const key = `${Math.round(x)},${Math.round(y + i)},${Math.round(z)}`;
            chunk.solidBlocks.add(key);
        }

        // --- Clone Leaves ---
        const leavesMesh = template.leaves.clone();
        leavesMesh.position.set(x, y, z); // The geometry is already offset relative to the base
        chunk.group.add(leavesMesh);
    }
}
