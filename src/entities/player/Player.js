// src/entities/player/Player.js
/**
 * 玩家类，负责处理玩家状态、输入、物理交互和渲染辅助（如相机位置、手臂）
 */
import * as THREE from 'three';
import { audioManager } from '../../core/AudioManager.js';
import { Physics } from './Physics.js';
import { Inventory } from './Slots.js';
import { getBiome, noise } from '../../utils/MathUtils.js';
import { chestManager } from '../../world/entities/Chest.js';
import { gunModel, mag7Model, minigunModel } from '../../core/Engine.js';
import { Gun, WEAPON_TYPES } from '../weapon/Gun.js';

export class Player {
  /**
    * @param {World} world - 游戏世界对象引用，用于查询方块和更新世界
    * @param {THREE.Camera} camera - 游戏相机对象，玩家视角以此为准
    */
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;

    // 状态与属性
    this.position = new THREE.Vector3().copy(camera.position); // 玩家逻辑位置
    this.rotation = camera.rotation;                           // 玩家旋转 (与相机同步)

    this.physics = new Physics(this, world);                   // 物理计算组件
    this.inventory = new Inventory();                          // 背包系统组件

    // 状态追踪
    this.isStuck = false;          // 是否卡在方块中
    this.bobAmount = 0;            // 当前视角晃动强度 (步行动画)
    this.lastInputDirection = new THREE.Vector3(); // 记录最后的移动输入方向

    // 移动与跳跃属性
    this.velocity = new THREE.Vector3(); // 玩家当前速度向量 (x, y, z)
    this.jumping = false;                // 是否处于跳跃/空中状态
    this.jumpCooldown = 0;               // 跳跃冷却计时
    this.jumpInterval = 0.25;            // 跳跃最小间隔（秒）
    this.spaceKeyReleased = true;        // 空格键是否已松开（防止连跳）

    this.keys = {};                      // 按键状态映射表
    this.setupInput();                   // 初始化输入监听

    this.swingTime = 0;                  // 手臂摆动动画剩余时间
    this.drawProgress = 0;               // 手臂/武器拿出动画进度 (0-1)
    this.cameraPitch = 0;                // 相机俯仰角 (上下看)

    // 添加第一人称手臂模型
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xeebb99 }));
    this.arm.position.set(0.6, -0.6, -1.2);
    this.arm.rotation.x = 0.2;
    this.arm.visible = false;
    this.camera.add(this.arm);

    // 交互系统
    this.raycaster = new THREE.Raycaster(); // 用于射线检测（挖掘、放置、射击）
    this.center = new THREE.Vector2(0, 0);  // 屏幕中心点坐标

    // 镜头晃动（Head Bobbing）相关
    this.bobbing_timer = 0;        // 晃动周期计时器
    this.bobbing_intensity = 0.05; // 基础晃动强度
    this.bobbing_speed = 0.2;      // 基础晃动速度
    this.bob_offset = new THREE.Vector2(); // 最终应用到相机的偏移量

    // 初始化爆炸 Worker
    this.explosionWorker = new Worker(new URL('../../workers/ExplosionWorker.js', import.meta.url), { type: 'module' });
    this.explosionWorker.onmessage = (e) => this.handleExplosionResult(e.data);

    // 音频系统初始化
    audioManager.init(this.camera);

    // 追踪引燃中的 TNT
    this.ignitingTNTs = new Set();

    // 持枪系统 (Refactored)
    this.weaponMode = WEAPON_TYPES.ARM; // 当前选择的武器模式 (0: 手臂, 1: 手枪, 2: MAG7, 3: 加特林)
    this.weapon = null;                 // 当前处于激活状态的 Gun 实例
    this.tracers = [];                  // 当前在场景中的所有弹道轨迹
    this.isShooting = false;            // 是否正处于射击按下状态
    this.shootCooldown = 0;             // 射击冷却剩余时间

    // 性能优化：池与复用
    this._tempVector = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._dummyMatrix = new THREE.Matrix4();
    this._dummyQuaternion = new THREE.Quaternion();
    this._dummyScale = new THREE.Vector3();
    this._zeroVector = new THREE.Vector3(0, 0, 0);

    this.tracerPool = [];
    this.tracerInfoPool = [];

    this.tracerGeometry = new THREE.BoxGeometry(0.05, 0.05, 1);
    this.tracerGeometry.translate(0, 0, 0.5);
    this.tracerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.8
    });

    this.mag7TracerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });

    this.mag7Timeouts = [];
  }

  setupInput() {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyR') {
        this.weaponMode = (this.weaponMode + 1) % 4;
        this.isShooting = false;
        if (this.weaponMode !== WEAPON_TYPES.ARM) {
          audioManager.playSound('gun_load', 0.4);
        }
      }
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Space') {
        this.spaceKeyReleased = true;
      }
    });
    window.addEventListener('mousedown', e => this.interact(e));
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.isShooting = false;
    });

    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === document.body) {
        this.rotation.y -= e.movementX * 0.002;
        this.cameraPitch -= e.movementY * 0.002;
        this.cameraPitch = Math.max(-1.5, Math.min(1.5, this.cameraPitch));
      }
    });

    this.bgmStarted = false;
    document.body.addEventListener('click', () => {
      if (document.pointerLockElement !== document.body) document.body.requestPointerLock();
      if (!this.bgmStarted) {
        audioManager.playBGM('bgm', 0.15);
        this.bgmStarted = true;
      }
    });
  }

  update(dt = 0.016) {
    this.camera.rotation.x = this.cameraPitch;
    dt = Math.min(dt, 0.1);

    const oldX = this.position.x;
    const oldZ = this.position.z;

    const speed = this.physics.speed;
    let inputX = 0;
    let inputZ = 0;

    if (this.keys['ArrowUp'] || this.keys['KeyW']) {
      inputX -= Math.sin(this.rotation.y);
      inputZ -= Math.cos(this.rotation.y);
    }
    if (this.keys['ArrowDown'] || this.keys['KeyS']) {
      inputX += Math.sin(this.rotation.y);
      inputZ += Math.cos(this.rotation.y);
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      inputX -= Math.cos(this.rotation.y);
      inputZ += Math.sin(this.rotation.y);
    }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      inputX += Math.cos(this.rotation.y);
      inputZ -= Math.sin(this.rotation.y);
    }

    const inputLen = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (inputLen > 0) {
      this.velocity.x = (inputX / inputLen) * speed;
      this.velocity.z = (inputZ / inputLen) * speed;
      this.lastInputDirection.set(inputX / inputLen, 0, inputZ / inputLen);
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    const isCurrentlyStuck = this.physics.checkAABB(this.position.x, this.position.y, this.position.z);
    this.isStuck = isCurrentlyStuck;

    if (!isCurrentlyStuck) {
      let nextX = this.position.x + this.velocity.x * dt;
      let nextZ = this.position.z + this.velocity.z * dt;
      const hasCollisionFull = this.physics.checkAABB(nextX, this.position.y, nextZ, true);

      if (hasCollisionFull) {
        const penalty = this.physics.getCornerPenalty(this.velocity.x, this.velocity.z);
        if (!this.physics.checkAABB(nextX, this.position.y, this.position.z, true)) {
          this.position.x = nextX;
          this.velocity.x = this.physics.applyFriction(this.velocity.x);
        } else if (!this.physics.tryStepUp(nextX, this.position.z)) {
          this.velocity.x = 0;
        }

        if (!this.physics.checkAABB(this.position.x, this.position.y, nextZ, true)) {
          this.position.z = nextZ;
          this.velocity.z = this.physics.applyFriction(this.velocity.z);
        } else if (!this.physics.tryStepUp(this.position.x, nextZ)) {
          this.velocity.z = 0;
        }

        if (penalty < 1.0) {
          this.position.x = oldX + (this.position.x - oldX) * penalty;
          this.position.z = oldZ + (this.position.z - oldZ) * penalty;
        }
      } else {
        this.position.x = nextX;
        this.position.z = nextZ;
      }
    } else {
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
    }

    if (inputLen > 0) this.physics.applyTunnelCentering();
    this.physics.applyCameraBumper();
    this.physics.checkCeilingBump();

    let gy = -100;
    const px = Math.floor(this.position.x);
    const pz = Math.floor(this.position.z);
    const py = Math.floor(this.position.y);

    for(let k=0; k<=4; k++) {
      const blockType = this.world.getBlock(px, py - k, pz);
      if(this.physics.isSolid(px, py - k, pz) || blockType === 'cloud') {
        gy = py - k + 1;
        break;
      }
    }
    if(gy === -100) gy = Math.floor(noise(px, pz) * 0.5) + 1;

    this.position.y += this.velocity.y * dt;
    if (this.position.y < gy) {
      this.position.y = gy;
      this.velocity.y = 0;
      this.jumping = false;
    } else {
      this.velocity.y += this.physics.gravity * dt;
      if (this.velocity.y < this.physics.terminalVelocity) this.velocity.y = this.physics.terminalVelocity;
    }

    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    if (this.keys['Space'] && !this.jumping && this.jumpCooldown <= 0 && this.spaceKeyReleased) {
      this.velocity.y = this.physics.jumpForce;
      this.jumping = true;
      this.jumpCooldown = this.jumpInterval;
      this.spaceKeyReleased = false;
    }

    if (this.position.y < -20) {
      this.position.y = 60;
      this.velocity.y = 0;
    }

    this.camera.position.x = this.position.x;
    this.camera.position.z = this.position.z;
    const targetCamY = this.position.y + 1.65;
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCamY, 0.2);

    this.physics.applyPushOut();

    const actualDx = this.position.x - oldX;
    const actualDz = this.position.z - oldZ;

    this.updateArm(dt);
    this.updateWeapon(dt);
    this.handleShooting(dt);
    this.updateCameraBob(actualDx, actualDz, dt, isCurrentlyStuck);
    this.updateTracers(dt);
  }

  getInteractionTargets() {
    const targets = [];
    for (const chunk of this.world.chunks.values()) targets.push(chunk.group);
    chestManager.chestAnimations.forEach(anim => {
      if (anim.mesh) targets.push(anim.mesh);
    });
    return targets;
  }

  handleShooting(dt) {
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.weapon && this.isShooting && this.shootCooldown <= 0) {
      if (this.weaponMode === WEAPON_TYPES.GUN || this.weaponMode === WEAPON_TYPES.MINIGUN) {
        this.executeShot(this.getInteractionTargets());
        this.shootCooldown = this.weapon.config.fireRate;
      }
    }
  }

  updateWeapon(dt) {
    const targetModel = this.weaponMode === WEAPON_TYPES.GUN ? gunModel :
                      (this.weaponMode === WEAPON_TYPES.MAG7 ? mag7Model :
                      (this.weaponMode === WEAPON_TYPES.MINIGUN ? minigunModel : null));

    if (this.weapon && (this.weapon.type !== this.weaponMode || !targetModel)) {
      this.weapon.destroy();
      this.weapon = null;
    }

    if (!this.weapon && targetModel) {
      this.weapon = new Gun(this.weaponMode, targetModel, this.camera, this.world);
    }

    if (this.weapon) {
      this.weapon.update(dt, this.isShooting);
    }
  }

  executeShot(targets) {
    this.raycaster.far = 40;
    this.raycaster.setFromCamera(this.center, this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    this.raycaster.far = Infinity;

    const hit = hits.length > 0 ? hits[0] : null;
    const effect = this.weapon.onFire(hit ? hit.point : null);
    this.spawnTracer(effect.start, effect.end, effect.config);

    if (hit) {
      const m = hit.object;
      const type = m.userData.type || 'unknown';
      if (type === 'tnt') {
        if (m.isInstancedMesh) {
          m.getMatrixAt(hit.instanceId, this._dummyMatrix);
          this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
        } else {
          this._tempVector.copy(m.position);
        }
        const key = `${Math.floor(this._tempVector.x)},${Math.floor(this._tempVector.y)},${Math.floor(this._tempVector.z)}`;
        if (!this.ignitingTNTs.has(key)) {
          this.ignitingTNTs.add(key);
          this.explode(this._tempVector.x, this._tempVector.y, this._tempVector.z);
        }
      } else {
        this.removeBlock(hit);
      }
    }
  }

  executeMag7Shot() {
    this.mag7Timeouts.forEach(t => clearTimeout(t));
    this.mag7Timeouts = [];

    const right = new THREE.Vector3(), up = new THREE.Vector3(), dir = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, dir);
    dir.negate();

    const blocksByDistance = new Map();
    const origin = this.camera.position;

    for (let d = 1; d <= 10; d += 0.5) {
      const distanceStep = Math.floor((d - 1) / 2);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          this._tempVector.copy(origin).addScaledVector(dir, d).addScaledVector(right, i).addScaledVector(up, j);
          const bx = Math.floor(this._tempVector.x), by = Math.floor(this._tempVector.y), bz = Math.floor(this._tempVector.z);
          const type = this.world.getBlock(bx, by, bz);
          if (type && type !== 'end_stone') {
            const key = `${bx},${by},${bz}`;
            if (!blocksByDistance.has(distanceStep)) blocksByDistance.set(distanceStep, []);
            const group = blocksByDistance.get(distanceStep);
            if (!group.some(b => b.key === key)) group.push({ x: bx, y: by, z: bz, key: key });
          }
        }
      }
    }

    const sortedDistances = Array.from(blocksByDistance.keys()).sort((a, b) => a - b);
    if (sortedDistances.length > 0) {
      const firstGroup = blocksByDistance.get(sortedDistances[0]);
      const midBlock = firstGroup[Math.floor(firstGroup.length / 2)];
      this._tempVector.set(midBlock.x + 0.5, midBlock.y + 0.5, midBlock.z + 0.5);
      this.spawnParticles(this._tempVector, 'stone');

      sortedDistances.forEach((dist, index) => {
        const group = blocksByDistance.get(dist);
        const timeoutId = setTimeout(() => {
          this.world.removeBlocksBatch(group);
          this.mag7Timeouts = this.mag7Timeouts.filter(id => id !== timeoutId);
        }, index * 90);
        this.mag7Timeouts.push(timeoutId);
      });
    }

    this.raycaster.far = 10;
    this.raycaster.setFromCamera(this.center, this.camera);
    const hits = this.raycaster.intersectObjects(this.getInteractionTargets(), true);
    this.raycaster.far = Infinity;

    const hit = hits.length > 0 ? hits[0] : null;
    const effect = this.weapon.onFire(hit ? hit.point : null);
    this.spawnTracer(effect.start, effect.end, effect.config);
  }

  spawnTracer(start, end, config) {
    const distance = start.distanceTo(end);
    let mesh;
    if (this.tracerPool.length > 0) {
      mesh = this.tracerPool.pop();
      mesh.visible = true;
    } else {
      mesh = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial);
    }

    mesh.material = config.isShotgun ? this.mag7TracerMaterial : this.tracerMaterial;
    mesh.scale.set(config.tracerThickness, config.tracerThickness, distance);
    mesh.position.copy(start);
    mesh.lookAt(end);
    this.world.scene.add(mesh);

    let info = this.tracerInfoPool.length > 0 ? this.tracerInfoPool.pop() : { mesh: null, worldEnd: new THREE.Vector3() };
    info.mesh = mesh;
    info.lifetime = config.tracerLifetime;
    info.maxLifetime = info.lifetime;
    info.localStart = config.localStart;
    info.worldEnd.copy(end);
    info.thickness = config.tracerThickness;
    this.tracers.push(info);
  }

  updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.lifetime -= dt;
      if (tracer.lifetime <= 0) {
        this.world.scene.remove(tracer.mesh);
        tracer.mesh.visible = false;
        this.tracerPool.push(tracer.mesh);
        this.tracerInfoPool.push(tracer);
        this.tracers.splice(i, 1);
      } else {
        this._tempVector.copy(tracer.localStart).applyQuaternion(this.camera.quaternion).add(this.camera.position);
        tracer.mesh.position.copy(this._tempVector);
        tracer.mesh.lookAt(tracer.worldEnd);
        tracer.mesh.scale.set(tracer.thickness, tracer.thickness, this._tempVector.distanceTo(tracer.worldEnd));
        tracer.mesh.material.opacity = (tracer.lifetime / tracer.maxLifetime);
      }
    }
  }

  updateCameraBob(dx, dz, dt, isObstructed) {
    const inputSpeed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
    const expectedDist = inputSpeed * dt;
    const actualDist = Math.sqrt(dx * dx + dz * dz);
    const isMoving = actualDist > 0.001;
    const isFullSpeed = inputSpeed > 0 && actualDist > expectedDist * 0.95;
    const shouldBob = isMoving && isFullSpeed && !this.jumping && !isObstructed;

    if (shouldBob) {
      this.bobbing_timer += this.bobbing_speed;
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, this.bobbing_intensity, 0.1);
      this.playFootstepSound();
    } else {
      this.bobbing_timer = 0;
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, 0, 0.2);
      audioManager.stopSound('running_land');
      audioManager.stopSound('running_water');
    }

    const bobX = Math.sin(this.bobbing_timer) * this.bobAmount;
    const bobY = Math.cos(this.bobbing_timer * 2) * this.bobAmount * 0.5;
    this.bob_offset.x = THREE.MathUtils.lerp(this.bob_offset.x, bobX, 0.3);
    this.bob_offset.y = THREE.MathUtils.lerp(this.bob_offset.y, bobY, 0.3);

    this.camera.position.x += this.bob_offset.x;
    this.camera.position.y += this.bob_offset.y;
  }

  playFootstepSound() {
    const blockType = this.world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y), Math.floor(this.position.z));
    if (blockType === 'water') {
      audioManager.stopSound('running_land');
      audioManager.playSound('running_water', 0.25, true);
    } else {
      audioManager.stopSound('running_water');
      audioManager.playSound('running_land', 0.2, true);
    }
  }

  interact(e) {
    if (document.pointerLockElement !== document.body) return;
    const button = e.button;
    this.raycaster.setFromCamera(this.center, this.camera);
    const targets = this.getInteractionTargets();
    const hits = this.raycaster.intersectObjects(targets, true);

    if (button === 2) {
      const heldItem = this.inventory.getSelected()?.item;
      if (hits.length > 0 && hits[0].distance < 9) {
        const hit = hits[0], m = hit.object, instanceId = hit.instanceId;
        if (m.userData.type === 'chest' && m.isInstancedMesh) {
          m.getMatrixAt(instanceId, this._dummyMatrix);
          this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
          if (!m.userData.chests[instanceId].open) {
            this.openChest(m, instanceId, this._tempVector);
            this.swing();
            return;
          }
        }
        if (heldItem && this.inventory.has(heldItem)) {
          if (m.isInstancedMesh) {
            m.getMatrixAt(instanceId, this._dummyMatrix);
            this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
          } else {
            this._tempVector.copy(m.position);
          }
          if (this.tryPlaceBlock(Math.floor(this._tempVector.x + hit.face.normal.x), Math.floor(this._tempVector.y + hit.face.normal.y), Math.floor(this._tempVector.z + hit.face.normal.z), heldItem)) this.swing();
        }
      } else if (heldItem && this.inventory.has(heldItem)) {
        this.doSkyPlace(heldItem);
      }
    } else if (button === 0) {
      if (this.weaponMode !== WEAPON_TYPES.ARM) {
        this.isShooting = true;
        if (this.shootCooldown <= 0) {
          if (this.weaponMode === WEAPON_TYPES.MAG7) {
            this.executeMag7Shot();
            this.shootCooldown = 1.5;
          } else {
            this.executeShot(targets);
            this.shootCooldown = this.weapon.config.fireRate;
          }
        }
        return;
      }
      if (hits.length > 0 && hits[0].distance < 9) {
        const hit = hits[0], m = hit.object, type = m.userData.type || 'unknown';
        if (e.ctrlKey) {
          if (type === 'tnt') {
            if (m.isInstancedMesh) {
              m.getMatrixAt(hit.instanceId, this._dummyMatrix);
              this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
            } else {
              this._tempVector.copy(m.position);
            }
            if (!this.ignitingTNTs.has(`${this._tempVector.x},${this._tempVector.y},${this._tempVector.z}`)) {
              this.ignitingTNTs.add(`${this._tempVector.x},${this._tempVector.y},${this._tempVector.z}`);
              this.explode(this._tempVector.x, this._tempVector.y, this._tempVector.z);
              this.swing();
            }
          }
          return;
        }
        if (type === 'chest' && m.isInstancedMesh) {
          m.getMatrixAt(hit.instanceId, this._dummyMatrix);
          this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
          if (!m.userData.chests[hit.instanceId].open) {
            this.openChest(m, hit.instanceId, this._tempVector);
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
    chestManager.spawnChestAnimation(pos, this.world.scene);
    mesh.getMatrixAt(instanceId, this._dummyMatrix);
    this._dummyMatrix.scale(this._zeroVector);
    mesh.setMatrixAt(instanceId, this._dummyMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    const drops = pos.y > 60 ? ['diamond', 'god_sword', 'gold_apple'] : [['diamond', 'gold', 'apple', 'bookbox', 'planks'][Math.floor(Math.random() * 5)]].concat([['diamond', 'gold', 'apple', 'bookbox', 'planks'][Math.floor(Math.random() * 5)]]);
    drops.forEach(item => this.inventory.add(item, 1));
  }

  tryPlaceBlock(x, y, z, type) {
    if (this.physics.isSolid(x, y, z)) return false;
    if (this.position.x - 0.3 < x + 1 && this.position.x + 0.3 > x && this.position.y < y + 1 && this.position.y + 1.8 > y && this.position.z - 0.3 < z + 1 && this.position.z + 0.3 > z) return false;
    this.world.setBlock(x, y, z, type);
    this.inventory.remove(type, 1);
    audioManager.playSound('put', 0.3);
    return true;
  }

  removeBlock(hit) {
    let m = hit.object;
    while (m && !m.userData.isEntity && m.parent && !m.isInstancedMesh && m.type !== 'Scene') m = m.parent;
    const type = m.userData.type || 'unknown';
    if (type === 'end_stone') return;
    if (m.isInstancedMesh) {
      m.getMatrixAt(hit.instanceId, this._dummyMatrix);
      this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
      this._dummyMatrix.scale(this._zeroVector);
      m.setMatrixAt(hit.instanceId, this._dummyMatrix);
      m.instanceMatrix.needsUpdate = true;
      this.spawnParticles(this._tempVector, type);
      this.world.removeBlock(Math.floor(this._tempVector.x), Math.floor(this._tempVector.y), Math.floor(this._tempVector.z));
      audioManager.playSound('delete_get', 0.3);
      if (type !== 'water' && type !== 'cloud') this.inventory.add(type === 'grass' ? 'dirt' : type, 1);
    } else {
      if (m.userData.isEntity) {
        if (m.userData.collisionBlocks) m.userData.collisionBlocks.forEach(p => this.world.removeBlockCollider(p.x, p.y, p.z));
        if (m.parent) m.parent.remove(m);
        this.spawnParticles(m.position, type || 'stone');
        if (type === 'chest') {
          this.world.removeBlock(Math.floor(m.position.x), Math.floor(m.position.y), Math.floor(m.position.z));
          this.inventory.add('chest', 1);
          audioManager.playSound('delete_get', 0.3);
        }
      } else {
        const bx = Math.floor(m.position.x), by = Math.floor(m.position.y), bz = Math.floor(m.position.z);
        this.world.removeBlock(bx, by, bz);
        audioManager.playSound('delete_get', 0.3);
        this.spawnParticles(m.position, type);
        if (m.parent) m.parent.remove(m);
        if (type === 'realistic_trunk') this.inventory.add('wood', 1);
        else if (type === 'realistic_leaves') { if (Math.random() < 0.8) this.inventory.add('leaves', 1); }
        else this.inventory.add(type, 1);
      }
    }
  }

  handleExplosionResult(data) {
    if (data.action === 'explosionResult') {
      const { blocksToDestroy, tntToIgnite, center } = data.payload;
      const ignitingKeys = new Set(this.ignitingTNTs);
      tntToIgnite.forEach(tnt => ignitingKeys.add(`${tnt.x},${tnt.y},${tnt.z}`));
      this.world.removeBlocksBatch(blocksToDestroy.filter(p => {
        if (ignitingKeys.has(`${p.x},${p.y},${p.z}`)) return false;
        const type = this.world.getBlock(p.x, p.y, p.z);
        return type && (type !== 'end_stone' || this.world.getBlock(p.x, p.y - 1, p.z));
      }));
      tntToIgnite.forEach(tnt => {
        const key = `${tnt.x},${tnt.y},${tnt.z}`;
        if (this.ignitingTNTs.has(key)) return;
        this.ignitingTNTs.add(key);
        setTimeout(() => {
          this.world.removeBlock(tnt.x, tnt.y, tnt.z);
          this.ignitingTNTs.delete(key);
          this.explode(tnt.x, tnt.y, tnt.z);
        }, tnt.delay);
      });
      this._tempVector.set(center.x + 0.5, center.y + 0.5, center.z + 0.5);
      if (this.world.spawnExplosionParticles) this.world.spawnExplosionParticles(this._tempVector);
      audioManager.playSound('explosion', 0.4);
    }
  }

  explode(x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (this.world.getBlock(bx, by, bz) === 'tnt') {
      this.world.removeBlock(bx, by, bz);
      this.ignitingTNTs.delete(`${bx},${by},${bz}`);
    }
    const nearbyDeltas = {};
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++)
        for (let dz = -3; dz <= 3; dz++) {
          const tx = bx + dx, ty = by + dy, tz = bz + dz;
          const type = this.world.getBlock(tx, ty, tz);
          if (type) nearbyDeltas[`${tx},${ty},${tz}`] = type;
        }
    this.explosionWorker.postMessage({ action: 'calculateExplosion', payload: { x, y, z, nearbyDeltas } });
  }

  spawnParticles(pos, type) { if (this.world.spawnParticles) this.world.spawnParticles(pos, type); }

  doSkyPlace(type) {
    const origin = this.camera.position;
    this.camera.getWorldDirection(this._direction);
    const step = 0.1, maxDist = 9;
    this._tempVector.copy(origin);
    const neighborOffsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for(let d=0; d<maxDist; d+=step) {
      this._tempVector.addScaledVector(this._direction, step);
      const rx = Math.floor(this._tempVector.x), ry = Math.floor(this._tempVector.y), rz = Math.floor(this._tempVector.z);
      if (!this.physics.isSolid(rx, ry, rz)) {
        let hasSolidNeighbor = false, allInvisible = true;
        for (const [dx, dy, dz] of neighborOffsets) {
          if (this.physics.isSolid(rx + dx, ry + dy, rz + dz)) {
            hasSolidNeighbor = true;
            if (this._direction.dot(new THREE.Vector3(dx, dy, dz).normalize()) > 0.01) { allInvisible = false; break; }
          }
        }
        if (hasSolidNeighbor && allInvisible) { if (this.tryPlaceBlock(rx, ry, rz, type)) { this.swing(); return; } }
      } else break;
    }
  }

  swing() { this.swingTime = 10; }

  updateArm(dt) {
    if (this.weaponMode !== WEAPON_TYPES.ARM) { this.arm.visible = false; return; }
    this.arm.visible = true;
    if (this.drawProgress < 1) this.drawProgress = Math.min(1, this.drawProgress + dt * 4);
    this.arm.position.set(0.07, -0.10 - Math.pow(1 - this.drawProgress, 2) * 0.5, -0.12);
    this.arm.scale.set(0.1, 0.1, 0.1);
    if (this.swingTime > 0) {
      this.arm.rotation.x = -0.8 - Math.sin((10 - this.swingTime) / 10 * Math.PI) * 0.87;
      this.swingTime--;
    } else this.arm.rotation.x = -0.8;
  }
}
