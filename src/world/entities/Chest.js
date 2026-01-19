// src/world/entities/Chest.js
import * as THREE from 'three';
import { materials } from '../../core/materials/MaterialManager.js';

export class Chest {
    constructor() {
        this.chestAnimations = [];
    }

    spawnChestAnimation(pos, parent) {
        const group = new THREE.Group();
        group.position.copy(pos);

        const mat = materials.getMaterial('chest');
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), mat);
        body.position.y = 0.3;

        const pivot = new THREE.Group();
        pivot.position.set(0, 0.6, -0.4);

        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.8), mat);
        lid.position.set(0, 0.1, 0.4);

        pivot.add(lid);
        group.add(body, pivot);
        parent.add(group);

        this.chestAnimations.push({
            mesh: group,
            lid: pivot,
            opening: true,
            t: 0
        });

        return { mesh: group, lid: pivot, opening: true, t: 0 };
    }

    update(dt) {
        for (let i = this.chestAnimations.length - 1; i >= 0; i--) {
            const c = this.chestAnimations[i];

            if (!c.mesh.parent) {
                this.chestAnimations.splice(i, 1);
                continue;
            }

            if (c.opening && c.t < 1) {
                // Using dt for frame-rate independent animation
                c.t = Math.min(1, c.t + (dt * 3)); // 3 units per second
                c.lid.rotation.x = THREE.MathUtils.lerp(0, -1.9, c.t);
            }
        }
    }

    removeChestAnimation(index) {
        if (index >= 0 && index < this.chestAnimations.length) {
            const anim = this.chestAnimations[index];
            if (anim.mesh.parent) {
                anim.mesh.parent.remove(anim.mesh);
            }
            this.chestAnimations.splice(index, 1);
        }
    }
}

export const chestManager = new Chest();