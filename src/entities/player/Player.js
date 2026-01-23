// src/entities/player/Player.js
/**
 * 玩家类，负责处理玩家状态、输入、物理交互和渲染辅助（如相机位置、手臂）
 */
import * as THREE from 'three';
import { Physics } from './Physics.js';
import { Inventory } from './Slots.js';
import { getBiome, noise } from '../../utils/MathUtils.js';
import { chestManager } from '../../world/entities/Chest.js';

export class Player {
  /**
    * @param {World} world - 游戏世界对象
    * @param {THREE.Camera} camera - 游戏相机对象
    */
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;

    // 将逻辑位置与相机解耦，以便后续实现平滑处理
    this.position = new THREE.Vector3().copy(camera.position);
    this.rotation = camera.rotation;

    this.physics = new Physics(this, world);
    this.inventory = new Inventory();

    // 初始出生点逻辑
    let spawnFound = false;
    for (let i = 0; i < 1000; i++) {
      const tx = (Math.random() - 0.5) * 20000;
      const tz = (Math.random() - 0.5) * 20000;
      // 尝试在森林或平原生物群系出生
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

    // 添加第一人称手臂模型
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xeebb99 }));
    this.arm.position.set(0.6, -0.6, -1.2);
    this.arm.rotation.x = 0.2;
    this.arm.visible = false;
    this.camera.add(this.arm);

    this.swingTime = 0;
    this.cameraPitch = 0;

    // 交互系统相关
    this.raycaster = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
  }

  /**
   * 设置输入监听器
   */
  setupInput() {
    window.addEventListener('keydown', e => this.keys[e.code] = true);
    window.addEventListener('keyup', e => this.keys[e.code] = false);
    window.addEventListener('mousedown', e => this.interact(e.button)); // Add interact listener

    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === document.body) {
        this.rotation.y -= e.movementX * 0.002;
        this.cameraPitch -= e.movementY * 0.002;
        // 限制仰角范围
        this.cameraPitch = Math.max(-1.5, Math.min(1.5, this.cameraPitch));
      }
    });
    document.body.addEventListener('click', () => {
      // 请求鼠标锁定
      if (document.pointerLockElement !== document.body) document.body.requestPointerLock();
    });
  }

  /**
   * 每帧更新逻辑
   */
  update() {
    // 更新相机仰角
    this.camera.rotation.x = this.cameraPitch;

    // 输入驱动移动
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

    // X轴物理/碰撞
    let nextX = this.position.x + dx;
    if (this.physics.checkCollision(nextX, this.position.z)) {
      // 基础自动上坡逻辑
      if (this.physics.isSolid(nextX, Math.floor(this.position.y), this.position.z) &&
        !this.physics.isSolid(nextX, Math.floor(this.position.y)+1, this.position.z) &&
        !this.physics.isSolid(this.position.x, Math.floor(this.position.y)+2, this.position.z)) {
        this.position.y += 1.0;
        this.position.x = nextX;
      }
    } else {
      this.position.x = nextX;
    }

    // Z轴物理/碰撞
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

    // Y轴物理（重力与地面检测）
    let gy = -100;
    const px = Math.round(this.position.x);
    const pz = Math.round(this.position.z);
    const py = Math.floor(this.position.y);

    // 向下寻找地面
    for(let k=0; k<=4; k++) {
      if(this.physics.isSolid(px, py - k, pz)) {
        gy = py - k + 1;
        break;
      }
    }
    // 如果区块未加载或逻辑失效，使用高度图作为备选地面
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

    // 跳跃控制
    if (this.keys['Space'] && !this.jumping) {
      this.velocity.y = this.physics.jumpForce;
      this.jumping = true;
    }

    // 掉入虚空重生
    if (this.position.y < -20) {
      this.position.y = 60;
      this.velocity.y = 0;
    }

    // 相机跟随与平滑处理
    this.camera.position.x = this.position.x;
    this.camera.position.z = this.position.z;
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.position.y + 1.0, 0.25);

    this.updateArm();
  }

  /**
   * 处理交互逻辑（左键挖掘，右键放置/打开）
   * @param {number} button - 鼠标按键
   */
  interact(button) {
    if (document.pointerLockElement !== document.body) return;

    this.raycaster.setFromCamera(this.center, this.camera);

    // 获取所有可交互的区块物体
    const targets = [];
    for (const chunk of this.world.chunks.values()) {
      targets.push(chunk.group);
    }

    const hits = this.raycaster.intersectObjects(targets, true);

    if (button === 2) { // 右键点击 - 放置或打开
      const slot = this.inventory.getSelected();
      const heldItem = slot ? slot.item : null;

      if (hits.length > 0 && hits[0].distance < 9) {
        const hit = hits[0];
        const dummy = new THREE.Matrix4();
        const m = hit.object;
        const instanceId = hit.instanceId;

        // 检查是否点击了箱子
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

        // 处理方块放置
        if (heldItem && this.inventory.has(heldItem)) {
          const normal = hit.face.normal;
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
        // 虚空搭路辅助（空中放置）
        this.doSkyPlace(heldItem);
      }
    } else if (button === 0) { // 左键点击 - 挖掘
      if (hits.length > 0 && hits[0].distance < 9) {
        const hit = hits[0];
        const m = hit.object;
        const instanceId = hit.instanceId;
        const type = m.userData.type || 'unknown';

        // 处理箱子挖掘（如果未打开则直接打开）
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

  /**
    * 打开箱子逻辑
    */
  openChest(mesh, instanceId, pos) {
    const info = mesh.userData.chests[instanceId];
    if (!info || info.open) return;
    info.open = true;

    // 生成箱子开启旋转动画
    chestManager.spawnChestAnimation(pos, this.world.scene);

    // 从实例化网格中“移除”原始箱子方块
    const dummy = new THREE.Matrix4();
    mesh.getMatrixAt(instanceId, dummy);
    dummy.scale(new THREE.Vector3(0, 0, 0));
    mesh.setMatrixAt(instanceId, dummy);
    mesh.instanceMatrix.needsUpdate = true;

    // 根据高度确定掉落物品（天域宝藏 vs 普通）
    let drops = [];
    if (pos.y > 60) {
      drops = ['diamond', 'god_sword', 'gold_apple'];
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

  /**
    * 尝试在指定位置放置方块
    */
  tryPlaceBlock(x, y, z, type) {
    // 如果位置已有实心方块，无法放置
    if (this.physics.isSolid(x, y, z)) return false;

    // 检查是否与玩家自身碰撞
    if (x >= this.position.x - 0.5 && x <= this.position.x + 0.5 &&
      z >= this.position.z - 0.5 && z <= this.position.z + 0.5 &&
      y >= this.position.y - 0.5 && y <= this.position.y + 1.2) {
      return false;
    }

    // 添加到世界
    this.world.setBlock(x, y, z, type);
    this.inventory.remove(type, 1);
    return true;
  }

  /**
    * 移除方块并生成掉落物和粒子
    */
  removeBlock(hit) {
    const m = hit.object;
    const instanceId = hit.instanceId;
    const dummy = new THREE.Matrix4();

    let pos = new THREE.Vector3();
    if (m.isInstancedMesh) {
      m.getMatrixAt(instanceId, dummy);
      dummy.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());

      // 通过缩放为0实现“视觉移除”
      dummy.scale(new THREE.Vector3(0, 0, 0));
      m.setMatrixAt(instanceId, dummy);
      m.instanceMatrix.needsUpdate = true;

      // 生成挖掘粒子
      this.spawnParticles(pos, m.userData.type);

      // 逻辑移除
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      const z = Math.round(pos.z);
      this.world.removeBlock(x, y, z);

      // 给予物品
      const type = m.userData.type;
      if (type !== 'water' && type !== 'cloud') {
        this.inventory.add(type === 'grass' ? 'dirt' : type, 1);
      }
    } else {
      // 处理标准网格方块
      this.world.removeBlock(Math.round(m.position.x), Math.round(m.position.y), Math.round(m.position.z));
      this.spawnParticles(m.position, m.userData.type);
      m.parent.remove(m);

      const type = m.userData.type;
      if (type === 'realistic_trunk') {
        this.inventory.add('wood', 1);
      } else if (type === 'realistic_leaves') {
        if (Math.random() < 0.8) this.inventory.add('leaves', 1);
      } else {
        this.inventory.add(type, 1);
      }
    }
  }

  /**
   * 生成挖掘粒子效果
   */
  spawnParticles(pos, type) {
    if (this.world.spawnParticles) {
      this.world.spawnParticles(pos, type);
    }
  }

  /**
    * 空中/虚空放置方块逻辑
    */
  doSkyPlace(type) {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);

    const step = 0.1;
    const maxDist = 9;
    const rayPos = origin.clone();

    const neighborOffsets = [
      [1, 0, 0],   // 东
      [-1, 0, 0],  // 西
      [0, 1, 0],   // 上
      [0, -1, 0],  // 下
      [0, 0, 1],   // 南
      [0, 0, -1]   // 北
    ];

    for(let d=0; d<maxDist; d+=step) {
      rayPos.add(direction.clone().multiplyScalar(step));
      const rx = Math.round(rayPos.x);
      const ry = Math.round(rayPos.y);
      const rz = Math.round(rayPos.z);

      if (!this.physics.isSolid(rx, ry, rz)) {
        let hasSolidNeighbor = false;
        let allInvisible = true;

        for (const [dx, dy, dz] of neighborOffsets) {
          const nx = rx + dx;
          const ny = ry + dy;
          const nz = rz + dz;
          if (this.physics.isSolid(nx, ny, nz)) {
            hasSolidNeighbor = true;
            const normal = new THREE.Vector3(dx, dy, dz).normalize();
            const dot = direction.dot(normal);
            if (dot > 0.01) {
              allInvisible = false;
              break;
            }
          }
        }

        if (hasSolidNeighbor && allInvisible) {
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

  /**
   * 挥动手臂动作
   */
  swing() {
    this.swingTime = 10;
  }

  /**
   * 更新手臂动画
   */
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
