// src/entities/player/Player.js
import * as THREE from 'three';
import { Physics } from './Physics.js';
import { Inventory } from './Slots.js';
import { getBiome, noise } from '../../utils/MathUtils.js';
import { chestManager } from '../../world/entities/Chest.js';

export class Player {
    constructor(world, camera) {
        this.world = world;
        this.camera = camera;
        // Decouple logic position from camera for smoothing
        this.position = new THREE.Vector3().copy(camera.position);
        this.rotation = camera.rotation;

        this.physics = new Physics(this, world);
        this.inventory = new Inventory();

        // Initial spawn logic
        let spawnFound = false;
        for (let i = 0; i < 1000; i++) {
            const tx = (Math.random() - 0.5) * 20000;
            const tz = (Math.random() - 0.5) * 20000;
            if (getBiome(tx, tz) === 'FOREST' || getBiome(tx, tz) === 'PLAINS') {
                this.position.set(tx, 60, tz);
                spawnFound = true;
                break;
            }
        }
        if (!spawnFound) this.position.set(0, 60, 0);

        this.velocity = new THREE.Vector3();
        this.jumping = false;

        this.keys = {};
        this.setupInput();

        // Add Arm
        this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xeebb99 }));
        this.arm.position.set(0.6, -0.6, -1.2);
        this.arm.rotation.x = 0.2;
        this.arm.visible = false;
        this.camera.add(this.arm);

        this.swingTime = 0;
        this.cameraPitch = 0;

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.center = new THREE.Vector2(0, 0);
    }

    setupInput() {
        window.addEventListener('keydown', e => this.keys[e.code] = true);
        window.addEventListener('keyup', e => this.keys[e.code] = false);
        window.addEventListener('mousedown', e => this.interact(e.button)); // Add interact listener

        document.addEventListener('mousemove', e => {
            if (document.pointerLockElement === document.body) {
                this.rotation.y -= e.movementX * 0.002;
                this.cameraPitch -= e.movementY * 0.002;
                this.cameraPitch = Math.max(-1.5, Math.min(1.5, this.cameraPitch));
            }
        });
        document.body.addEventListener('click', () => {
            // Simplified pointer lock request, UI manager should handle this better later
            if (document.pointerLockElement !== document.body) document.body.requestPointerLock();
        });
    }

    update(dt) {
        // Rotation handled by mouse event directly updating camera/player props
        this.camera.rotation.x = this.cameraPitch;

        // Input Movement
        const speed = this.physics.speed;
        let dx = 0, dz = 0;

        if (this.keys['ArrowUp'] || this.keys['KeyW']) {
            dx -= Math.sin(this.rotation.y) * speed;
            dz -= Math.cos(this.rotation.y) * speed;
        }
        if (this.keys['ArrowDown'] || this.keys['KeyS']) {
            dx += Math.sin(this.rotation.y) * speed;
            dz += Math.cos(this.rotation.y) * speed;
        }
        if (this.keys['KeyA']) {
            dx -= Math.cos(this.rotation.y) * speed;
            dz += Math.sin(this.rotation.y) * speed;
        }
        if (this.keys['KeyD']) {
            dx += Math.cos(this.rotation.y) * speed;
            dz -= Math.sin(this.rotation.y) * speed;
        }

        // Physics X
        let nextX = this.position.x + dx;
        if (this.physics.checkCollision(nextX, this.position.z)) {
             // Basic step up logic
             if (this.physics.isSolid(nextX, Math.floor(this.position.y), this.position.z) &&
                !this.physics.isSolid(nextX, Math.floor(this.position.y)+1, this.position.z) &&
                !this.physics.isSolid(this.position.x, Math.floor(this.position.y)+2, this.position.z)) {
                 this.position.y += 1.0;
                 this.position.x = nextX;
             }
        } else {
            this.position.x = nextX;
        }

        // Physics Z
        let nextZ = this.position.z + dz;
        if (this.physics.checkCollision(this.position.x, nextZ)) {
             if (this.physics.isSolid(this.position.x, Math.floor(this.position.y), nextZ) &&
                !this.physics.isSolid(this.position.x, Math.floor(this.position.y)+1, nextZ) &&
                !this.physics.isSolid(this.position.x, Math.floor(this.position.y)+2, this.position.z)) {
                 this.position.y += 1.0;
                 this.position.z = nextZ;
             }
        } else {
            this.position.z = nextZ;
        }

        // Physics Y (Gravity)
        // Check ground
        let gy = -100;
        const px = Math.round(this.position.x);
        const pz = Math.round(this.position.z);
        const py = Math.floor(this.position.y);

        for(let k=0; k<=4; k++) {
            if(this.physics.isSolid(px, py - k, pz)) {
                gy = py - k + 1;
                break;
            }
        }
        // Fallback ground (noise) if chunk not loaded or logic fails
        if(gy === -100) {
             gy = Math.floor(noise(px, pz) * 0.5) + 1;
        }

        this.position.y += this.velocity.y;

        if (this.position.y < gy) {
            this.position.y = gy;
            this.velocity.y = 0;
            this.jumping = false;
        } else {
            this.velocity.y += this.physics.gravity;
        }

        if (this.keys['Space'] && !this.jumping) {
            this.velocity.y = this.physics.jumpForce;
            this.jumping = true;
        }

        // Void respawn
        if (this.position.y < -20) {
            this.position.y = 60;
            this.velocity.y = 0;
        }

        // Camera follow with smoothing
        this.camera.position.x = this.position.x;
        this.camera.position.z = this.position.z;
        this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.position.y + 1.0, 0.25);

        this.updateArm();
    }

    interact(button) {
        if (document.pointerLockElement !== document.body) return;

        this.raycaster.setFromCamera(this.center, this.camera);

        // We need solid blocks for interaction? Or the meshes?
        // Original raycasted against `interactables` (Meshes) and `placedMeshes`.
        // In this refactor, meshes are in `world.chunks`.
        // We need a way to get all interactable meshes from World.
        // Assuming World exposes a method or we traverse scene.
        // Let's iterate loaded chunks and get their groups.
        const targets = [];
        for (const chunk of this.world.chunks.values()) {
            targets.push(chunk.group);
        }

        // Raycast against all chunk groups (which contain InstancedMeshes)
        // Note: raycaster.intersectObjects with recursive true might be slow if many objects,
        // but Chunk groups contain InstancedMeshes which are few.
        const hits = this.raycaster.intersectObjects(targets, true);

        if (button === 2) { // Right Click - Place
            const slot = this.inventory.getSelected();
            const heldItem = slot ? slot.item : null;

            if (hits.length > 0 && hits[0].distance < 5) {
                const hit = hits[0];
                const dummy = new THREE.Matrix4();
                const m = hit.object;
                const instanceId = hit.instanceId;

                // Check if clicked block is a chest
                const type = m.userData.type || 'unknown';
                if (type === 'chest' && m.isInstancedMesh) {
                    let targetPos = new THREE.Vector3();
                    m.getMatrixAt(instanceId, dummy);
                    dummy.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
                    const info = m.userData.chests[instanceId];
                    if (!info.open) {
                        this.openChest(m, instanceId, targetPos);
                        this.swing();
                        return;
                    }
                }

                // Handle placement against block face
                if (heldItem && this.inventory.has(heldItem)) {
                    const normal = hit.face.normal;
                    // Get position of hit block
                    let targetPos = new THREE.Vector3();
                    if (m.isInstancedMesh) {
                        m.getMatrixAt(instanceId, dummy);
                        dummy.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
                    } else {
                        targetPos.copy(m.position);
                    }

                    const px = Math.round(targetPos.x + normal.x);
                    const py = Math.round(targetPos.y + normal.y);
                    const pz = Math.round(targetPos.z + normal.z);

                    if (this.tryPlaceBlock(px, py, pz, heldItem)) {
                        this.swing();
                    }
                }
            } else if (heldItem && this.inventory.has(heldItem)) {
                // Sky placement (Void bridging)
                // Simplified raycast stepping
                this.doSkyPlace(heldItem);
            }
        } else if (button === 0) { // Left Click - Mine
            if (hits.length > 0 && hits[0].distance < 5) {
                const hit = hits[0];
                const m = hit.object;
                const instanceId = hit.instanceId;
                const type = m.userData.type || 'unknown';
                if (type === 'chest' && m.isInstancedMesh) {
                    let targetPos = new THREE.Vector3();
                    const dummy = new THREE.Matrix4();
                    m.getMatrixAt(instanceId, dummy);
                    dummy.decompose(targetPos, new THREE.Quaternion(), new THREE.Vector3());
                    const info = m.userData.chests[instanceId];
                    if (!info.open) {
                        this.openChest(m, instanceId, targetPos);
                        this.swing();
                        return;
                    }
                }
                this.removeBlock(hit);
                this.swing();
            } else {
                this.swing();
            }
        }
    }

    openChest(mesh, instanceId, pos) {
        const info = mesh.userData.chests[instanceId];
        if (!info || info.open) return;
        info.open = true;

        // Create chest animation instead of hiding
        const chestAnim = chestManager.spawnChestAnimation(pos, this.world.scene);

        // Remove the original chest block from the instanced mesh
        const dummy = new THREE.Matrix4();
        mesh.getMatrixAt(instanceId, dummy);
        dummy.scale(new THREE.Vector3(0, 0, 0));
        mesh.setMatrixAt(instanceId, dummy);
        mesh.instanceMatrix.needsUpdate = true;

        // Determine drops based on height (sky chest vs normal)
        let drops = [];
        if (pos.y > 60) {
            drops = ['diamond', 'god_sword', 'gold_apple'];
            // Show message via HUD
            if (this.game && this.game.ui && this.game.ui.hud) {
                this.game.ui.hud.showMessage(`发现天域宝藏！获得: 钻石, 神剑, 金苹果!`);
            }
        } else {
            const possible = ['diamond', 'gold', 'apple', 'bed', 'planks'];
            const item = possible[Math.floor(Math.random() * possible.length)];
            drops = [item, item];
            if (this.game && this.game.ui && this.game.ui.hud) {
                this.game.ui.hud.showMessage(`你打开了箱子，发现了: ${item} x2`);
            }
        }
        drops.forEach(item => this.inventory.add(item, 1));
    }

    tryPlaceBlock(x, y, z, type) {
        if (this.physics.isSolid(x, y, z)) return false;

        // Collision check with player
        if (x >= this.position.x - 0.5 && x <= this.position.x + 0.5 &&
            z >= this.position.z - 0.5 && z <= this.position.z + 0.5 &&
            y >= this.position.y - 0.5 && y <= this.position.y + 1.2) {
            return false;
        }

        // Add to World
        this.world.setBlock(x, y, z, type);
        this.inventory.remove(type, 1);
        return true;
    }

    removeBlock(hit) {
        const m = hit.object;
        const instanceId = hit.instanceId;
        const dummy = new THREE.Matrix4();

        let pos = new THREE.Vector3();
        if (m.isInstancedMesh) {
            m.getMatrixAt(instanceId, dummy);
            dummy.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());

            // "Remove" by scaling to 0 (Legacy trick)
            dummy.scale(new THREE.Vector3(0, 0, 0));
            m.setMatrixAt(instanceId, dummy);
            m.instanceMatrix.needsUpdate = true;

            // Spawn Particles
            this.spawnParticles(pos, m.userData.type);

            // Logic remove
            const x = Math.round(pos.x);
            const y = Math.round(pos.y);
            const z = Math.round(pos.z);
            this.world.removeBlock(x, y, z);

            // Give item
            const type = m.userData.type;
            if (type !== 'water' && type !== 'cloud') {
                this.inventory.add(type === 'grass' ? 'dirt' : type, 1);
            }
        } else {
            // Standard Mesh (placed block)
            this.world.removeBlock(Math.round(m.position.x), Math.round(m.position.y), Math.round(m.position.z));

            // Spawn Particles
            this.spawnParticles(m.position, m.userData.type);

            m.parent.remove(m); // Remove from scene/chunk group

            // Give item
            this.inventory.add(m.userData.type, 1);
        }
    }

    spawnParticles(pos, type) {
        // Need access to scene to add particles.
        // World has scene ref, or Engine.
        // Assuming World exposes scene or addParticle method.
        // Let's assume we can add to World or call a global/shared particle spawner.
        // For refactor, let's inject a ParticleSystem or ask World to spawn.
        if (this.world.spawnParticles) {
            this.world.spawnParticles(pos, type);
        }
    }

    doSkyPlace(type) {
        const origin = this.camera.position.clone();
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);

        const step = 0.1;
        const maxDist = 5;
        const rayPos = origin.clone();

        for(let d=0; d<maxDist; d+=step) {
            rayPos.add(direction.clone().multiplyScalar(step));
            const rx = Math.round(rayPos.x);
            const ry = Math.round(rayPos.y);
            const rz = Math.round(rayPos.z);

            if (!this.physics.isSolid(rx, ry, rz)) {
                // Check neighbors
                if (this.physics.isSolid(rx+1, ry, rz) || this.physics.isSolid(rx-1, ry, rz) ||
                    this.physics.isSolid(rx, ry+1, rz) || this.physics.isSolid(rx, ry-1, rz) ||
                    this.physics.isSolid(rx, ry, rz+1) || this.physics.isSolid(rx, ry, rz-1)) {
                    if (this.tryPlaceBlock(rx, ry, rz, type)) {
                        this.swing();
                        return;
                    }
                }
            } else {
                break;
            }
        }
    }

    swing() {
        this.swingTime = 10;
    }

    updateArm() {
        if (this.swingTime > 0) {
            this.arm.visible = true;
            this.arm.rotation.x = -Math.PI / 2 + Math.sin(this.swingTime * 0.3);
            this.swingTime--;
        } else {
            this.arm.visible = false;
        }
    }
}
