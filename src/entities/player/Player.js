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

    // 碰撞检测偏移量，用于防止穿模（可微调）
    this.collisionOffset = 0.3;

    // 初始出生点逻辑
    let spawnFound = false;
    for (let i = 0; i < 1000; i++) {
      const tx = (Math.random() - 0.5) * 20000;
      const tz = (Math.random() - 0.5) * 20000;

      const biome = getBiome(tx, tz);
      // 尝试在森林或平原生物群系出生
      if (biome === 'FOREST' || biome === 'PLAINS') {
        // 计算预估地形高度，确保不在水面上（海平面约 -1.5）
        const h = Math.floor(noise(tx, tz, 0.08) + noise(tx, tz, 0.02) * 3);
        if (h > -0.5) {
          this.position.set(tx, 70, tz);
          spawnFound = true;
          break;
        }
      }
    }
    if (!spawnFound) this.position.set(0, 70, 0);

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

    // 镜头晃动（bobbing）相关参数
    this.bobbing_timer = 0;
    this.bobbing_intensity = 0.05; // 晃动幅度
    this.bobbing_speed = 0.2;     // 晃动速度
    this.bob_offset = new THREE.Vector2(); // 用于平滑处理晃动偏移

    // 初始化爆炸 Worker
    this.explosionWorker = new Worker(new URL('../../workers/ExplosionWorker.js', import.meta.url), { type: 'module' });
    this.explosionWorker.onmessage = (e) => this.handleExplosionResult(e.data);

    // --- 音频系统初始化 ---
    audioManager.init(this.camera);

    // 追踪引燃中的 TNT
    this.ignitingTNTs = new Set();
  }

  /**
   * 设置输入监听器
   */
  setupInput() {
    window.addEventListener('keydown', e => this.keys[e.code] = true);
    window.addEventListener('keyup', e => this.keys[e.code] = false);
    window.addEventListener('mousedown', e => this.interact(e)); // 传递完整事件对象

    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement === document.body) {
        this.rotation.y -= e.movementX * 0.002;
        this.cameraPitch -= e.movementY * 0.002;
        // 限制仰角范围
        this.cameraPitch = Math.max(-1.5, Math.min(1.5, this.cameraPitch));
      }
    });
    this.bgmStarted = false;
    document.body.addEventListener('click', () => {
      // 请求鼠标锁定
      if (document.pointerLockElement !== document.body) document.body.requestPointerLock();

      // 首次点击启动背景音乐
      if (!this.bgmStarted) {
        audioManager.playBGM('bgm', 0.15);
        this.bgmStarted = true;
      }
    });
  }

  /**
   * 检查带偏移的碰撞
   * @param {number} x - 目标X坐标
   * @param {number} z - 目标Z坐标
   * @param {number} dx - X轴移动方向（可选）
   * @param {number} dz - Z轴移动方向（可选）
   * @returns {boolean} - 是否发生碰撞
   */
  _checkCollisionWithOffset(x, z, dx = 0, dz = 0) {
    const offset = this.collisionOffset;

    // 检查中心点 - 使用排除脚部支撑的碰撞检测
    if (this.physics.checkCollisionForMovement(x, z)) {
      return true;
    }

    var rat = 0.7;
    // 基础偏移点：8个方向（4个正交 + 4个对角线）
    const baseOffsetPoints = [
      [x + offset, z],           // 东
      [x - offset, z],           // 西
      [x, z + offset],           // 南
      [x, z - offset],           // 北
      [x + offset * rat, z + offset * rat],  // 东南
      [x + offset * rat, z - offset * rat],  // 东北
      [x - offset * rat, z + offset * rat],  // 西南
      [x - offset * rat, z - offset * rat],  // 西北
    ];

    // 检查所有基础偏移点
    for (const [ox, oz] of baseOffsetPoints) {
      if (this.physics.checkCollisionForMovement(ox, oz)) {
        return true;
      }
    }

    // 如果有移动方向，执行射线检测防止穿模
    if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
      const startX = this.position.x;
      const startZ = this.position.z;
      const endX = x;
      const endZ = z;

      // 计算距离
      const distX = endX - startX;
      const distZ = endZ - startZ;
      const distance = Math.sqrt(distX * distX + distZ * distZ);

      if (distance > 0) {
        // 沿着移动方向进行射线采样
        const steps = Math.ceil(distance / (offset * 0.5)); // 每半个偏移量采样一次
        const stepSize = 1.0 / Math.max(1, steps);

        for (let i = 1; i <= steps; i++) {
          const t = i * stepSize;
          const sampleX = startX + distX * t;
          const sampleZ = startZ + distZ * t;

          // 在采样点周围进行偏移检测
          for (const [ox, oz] of baseOffsetPoints) {
            // 将偏移点从目标位置调整到采样位置
            const offsetFromSampleX = ox - x + sampleX;
            const offsetFromSampleZ = oz - z + sampleZ;

            if (this.physics.checkCollisionForMovement(offsetFromSampleX, offsetFromSampleZ)) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * 检查是否可以上一级台阶（X轴方向）
   * @param {number} nextX - 目标X坐标
   * @returns {boolean} - 是否可以上台阶
   */
  _canStepUpX(nextX) {
    const floorY = Math.floor(this.position.y);
    const deltaX = nextX - this.position.x;
    const threshold = 0.1;  // 移动阈值

    // 如果移动太小，不检查上台阶
    if (Math.abs(deltaX) < threshold) {
      return false;
    }

    // 根据移动方向确定目标整数位置
    let targetX;
    if (deltaX > 0) {
      targetX = Math.floor(this.position.x) + 1;  // 向右移动
    } else {
      targetX = Math.floor(this.position.x) - 1;  // 向左移动
    }

    return (
      this.physics.isSolid(targetX, floorY, this.position.z) &&
      !this.physics.isSolid(targetX, floorY + 1, this.position.z) &&
      !this.physics.isSolid(this.position.x, floorY + 2, this.position.z)
    );
  }

  /**
   * 检查是否可以上一级台阶（Z轴方向）
   * @param {number} nextZ - 目标Z坐标
   * @returns {boolean} - 是否可以上台阶
   */
  _canStepUpZ(nextZ) {
    const floorY = Math.floor(this.position.y);
    const deltaZ = nextZ - this.position.z;
    const threshold = 0.01;  // 移动阈值

    // 如果移动太小，不检查上台阶
    if (Math.abs(deltaZ) < threshold) {
      return false;
    }

    // 根据移动方向确定目标整数位置
    let targetZ;
    if (deltaZ > 0) {
      targetZ = Math.floor(this.position.z) + 1;  // 向前移动
    } else {
      targetZ = Math.floor(this.position.z) - 1;  // 向后移动
    }

    return (
      this.physics.isSolid(this.position.x, floorY, targetZ) &&
      !this.physics.isSolid(this.position.x, floorY + 1, targetZ) &&
      !this.physics.isSolid(this.position.x, floorY + 2, this.position.z)
    );
  }

  /**
   * 检查是否可以下一级台阶（X轴方向）
   * @param {number} nextX - 目标X坐标
   * @returns {boolean} - 是否可以下台阶
   */
  _canStepDownX(nextX) {
    const floorY = Math.floor(this.position.y);
    const deltaX = nextX - this.position.x;
    const threshold = 0.01;

    if (Math.abs(deltaX) < threshold) {
      return false;
    }

    // 根据移动方向确定目标整数位置
    let targetX;
    if (deltaX > 0) {
      targetX = Math.floor(this.position.x) + 1;  // 向右移动
    } else {
      targetX = Math.floor(this.position.x) - 1;  // 向左移动
    }

    // 下台阶条件：目标位置没有方块，但目标位置下方有方块支撑
    // 且玩家当前位置到目标位置没有障碍
    return (
      !this.physics.isSolid(targetX, floorY, this.position.z) &&
      !this.physics.isSolid(targetX, floorY + 1, this.position.z) &&
      this.physics.isSolid(targetX, floorY - 1, this.position.z)
    );
  }

  /**
   * 检查是否可以下一级台阶（Z轴方向）
   * @param {number} nextZ - 目标Z坐标
   * @returns {boolean} - 是否可以下台阶
   */
  _canStepDownZ(nextZ) {
    const floorY = Math.floor(this.position.y);
    const deltaZ = nextZ - this.position.z;
    const threshold = 0.01;

    if (Math.abs(deltaZ) < threshold) {
      return false;
    }

    // 根据移动方向确定目标整数位置
    let targetZ;
    if (deltaZ > 0) {
      targetZ = Math.floor(this.position.z) + 1;  // 向前移动
    } else {
      targetZ = Math.floor(this.position.z) - 1;  // 向后移动
    }

    // 下台阶条件：目标位置没有方块，但目标位置下方有方块支撑
    return (
      !this.physics.isSolid(this.position.x, floorY, targetZ) &&
      !this.physics.isSolid(this.position.x, floorY + 1, targetZ) &&
      this.physics.isSolid(this.position.x, floorY - 1, targetZ)
    );
  }

  /**
   * 每帧更新逻辑
   */
  update() {
    // 更新相机仰角
    this.camera.rotation.x = this.cameraPitch;

    // 记录移动前的位置，用于判断实际位移
    const oldX = this.position.x;
    const oldZ = this.position.z;

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

    // 完整移动检测（防止对角线穿模）
    let nextX = this.position.x + dx;
    let nextZ = this.position.z + dz;

    // 首先检查完整移动是否碰撞
    const hasCollisionFull = this._checkCollisionWithOffset(nextX, nextZ, dx, dz);

    if (hasCollisionFull) {
      // 完整移动有碰撞，改为逐轴检查和应用位移，以实现更可靠的墙壁滑动

      // 1. 尝试在 X 轴上移动
      const collisionX = this._checkCollisionWithOffset(nextX, this.position.z, dx, 0);
      if (!collisionX) {
        this.position.x = nextX;
      } else if (this._canStepUpX(nextX)) { // 如果X轴被阻挡，检查是否可以上台阶
        this.position.y += 1.0;
        this.position.x = nextX;
      } else if (this._canStepDownX(nextX)) { // 或下台阶
        this.position.x = nextX;
      }

      // 2. 尝试在 Z 轴上移动 (注意：这次检查是基于可能已经更新过的 X 坐标)
      const collisionZ = this._checkCollisionWithOffset(this.position.x, nextZ, 0, dz);
      if (!collisionZ) {
        this.position.z = nextZ;
      } else if (this._canStepUpZ(nextZ)) { // 如果Z轴被阻挡，检查是否可以上台阶
        this.position.y += 1.0;
        this.position.z = nextZ;
      } else if (this._canStepDownZ(nextZ)) { // 或下台阶
        this.position.z = nextZ;
      }
    } else {
      // 完整移动没有碰撞，允许移动
      this.position.x = nextX;
      this.position.z = nextZ;
    }

    // Y轴物理（重力与地面检测）
    let gy = -100;
    const px = Math.floor(this.position.x);
    const pz = Math.floor(this.position.z);
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
    // 1.65: 玩家眼睛的垂直偏移高度（相机高度）
    // 0.25: lerp 的平滑系数，值越小相机跟随越平缓，值越大越实时
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, this.position.y + 1.65, 0.25);

    // 计算实际位移
    const actualDx = this.position.x - oldX;
    const actualDz = this.position.z - oldZ;

    this.updateArm();
    this.updateCameraBob(actualDx, actualDz, hasCollisionFull);
  }

  /**
   * 播放脚步声，根据环境选择水声或陆地声
   */
  playFootstepSound() {
    const px = Math.floor(this.position.x);
    const py = Math.floor(this.position.y);
    const pz = Math.floor(this.position.z);
    const blockType = this.world.getBlock(px, py, pz);

    if (blockType === 'water') {
      // 切换到循环的水面音效
      audioManager.stopSound('running_land');
      audioManager.playSound('running_water', 0.25, true);
    } else {
      // 切换到循环的陆地音效
      audioManager.stopSound('running_water');
      audioManager.playSound('running_land', 0.2, true);
    }
  }

  /**
   * 处理交互逻辑（左键挖掘，右键放置/打开）
   * @param {MouseEvent} e - 鼠标事件对象
   */
  interact(e) {
    if (document.pointerLockElement !== document.body) return;

    const button = e.button;
    this.raycaster.setFromCamera(this.center, this.camera);

    // 获取所有可交互的区块物体
    const targets = [];
    for (const chunk of this.world.chunks.values()) {
      targets.push(chunk.group);
    }

    const hits = this.raycaster.intersectObjects(targets, true);

    if (button === 2) { // 右键点击 - 放置方块或打开交互容器 (如箱子)
      const slot = this.inventory.getSelected();
      const heldItem = slot ? slot.item : null;

      if (hits.length > 0 && hits[0].distance < 9) { // 9: 最大交互距离 (格)
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

          const px = Math.floor(targetPos.x + normal.x);
          const py = Math.floor(targetPos.y + normal.y);
          const pz = Math.floor(targetPos.z + normal.z);

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

        // 处理功能组合键 (Ctrl + 左键)
        if (e.ctrlKey) {
          if (type === 'tnt') {
            let pos = new THREE.Vector3();
            if (m.isInstancedMesh) {
              const dummy = new THREE.Matrix4();
              m.getMatrixAt(instanceId, dummy);
              dummy.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
            } else {
              pos.copy(m.position);
            }
            const key = `${pos.x},${pos.y},${pos.z}`;
            if (!this.ignitingTNTs.has(key)) {
              this.ignitingTNTs.add(key);
              this.explode(pos.x, pos.y, pos.z);
              this.swing();
            }
          }
          // 只要按住了 Ctrl，无论是否是 TNT，都阻止常规挖掘动作
          return;
        }

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
      const possible = ['diamond', 'gold', 'apple', 'bookbox', 'planks'];
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
      y >= this.position.y && y <= this.position.y + 1.9) {
      return false;
    }

    // 添加到世界
    this.world.setBlock(x, y, z, type);
    this.inventory.remove(type, 1);
    audioManager.playSound('put', 0.3);
    return true;
  }

  /**
    * 移除方块并生成掉落物和粒子
    */
  removeBlock(hit) {
    let m = hit.object;
    const instanceId = hit.instanceId;

    // 向上查找实体父节点，确保能正确识别 Rook 等复合实体
    let entity = m;
    while (entity && !entity.userData.isEntity && entity.parent) {
      if (entity.isInstancedMesh || entity.type === 'Scene') break;
      entity = entity.parent;
    }
    if (entity && entity.userData.isEntity) {
      m = entity;
    }

    const type = m.userData.type || 'unknown';

    // 不可破坏方块检查
    if (type === 'end_stone') return;

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
      const x = Math.floor(pos.x);
      const y = Math.floor(pos.y);
      const z = Math.floor(pos.z);
      this.world.removeBlock(x, y, z);
      audioManager.playSound('delete_get', 0.3);

      // 给予物品
      const type = m.userData.type;
      if (type !== 'water' && type !== 'cloud') {
        this.inventory.add(type === 'grass' ? 'dirt' : type, 1);
      }
    } else {
      // --- 处理标准网格 (非 InstancedMesh) ---

      // 检查是否为我们定义的实体 (如 Rook)
      if (m.userData.isEntity) {
        // 1. 如果实体有关联的碰撞块，则使用专用的无副作用函数移除它们
        if (m.userData.collisionBlocks && Array.isArray(m.userData.collisionBlocks)) {
          m.userData.collisionBlocks.forEach(blockPos => {
            this.world.removeBlockCollider(blockPos.x, blockPos.y, blockPos.z);
          });
        }

        // 2. 移除实体本身的可视化模型
        if (m.parent) {
          m.parent.remove(m);
        }

        // 3. 生成粒子效果
        this.spawnParticles(m.position, m.userData.type || 'stone'); // 使用石头作为后备粒子类型

        // 4. (可选) 给予物品 - 这里暂时不给，因为没有定义 rook 的掉落物

      } else {
        // --- 如果是普通的动态方块 (非实体) ---
        this.world.removeBlock(Math.floor(m.position.x), Math.floor(m.position.y), Math.floor(m.position.z));
        audioManager.playSound('delete_get', 0.3);
        this.spawnParticles(m.position, m.userData.type);
        if (m.parent) m.parent.remove(m);

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
  }

  /**
   * 处理从 Worker 返回的爆炸计算结果
   */
  handleExplosionResult(data) {
    const { action, payload } = data;
    if (action === 'explosionResult') {
      const { blocksToDestroy, tntToIgnite, center } = payload;

      // 1. 追踪引燃中的 TNT
      const ignitingKeys = new Set(this.ignitingTNTs);
      tntToIgnite.forEach(tnt => ignitingKeys.add(`${tnt.x},${tnt.y},${tnt.z}`));

      // 2. 执行批量销毁
      // 过滤掉不可破坏方块和正在引燃中的 TNT
      const validDestruction = blocksToDestroy.filter(p => {
        const key = `${p.x},${p.y},${p.z}`;
        if (ignitingKeys.has(key)) return false;

        const type = this.world.getBlock(p.x, p.y, p.z);
        if (!type) return false;
        if (type === 'end_stone') {
          const below = this.world.getBlock(p.x, p.y - 1, p.z);
          if (!below) return false;
        }
        return true;
      });

      this.world.removeBlocksBatch(validDestruction);

      // 3. 调度连锁反应
      tntToIgnite.forEach(tnt => {
        const key = `${tnt.x},${tnt.y},${tnt.z}`;
        if (this.ignitingTNTs.has(key)) return;

        this.ignitingTNTs.add(key);

        setTimeout(() => {
          // 在爆炸时刻移除方块
          this.world.removeBlock(tnt.x, tnt.y, tnt.z);
          this.ignitingTNTs.delete(key);
          this.explode(tnt.x, tnt.y, tnt.z);
        }, tnt.delay);
      });

      // 4. 视觉与听觉效果
      const centerPos = new THREE.Vector3(center.x + 0.5, center.y + 0.5, center.z + 0.5);
      if (this.world.spawnExplosionParticles) {
        this.world.spawnExplosionParticles(centerPos);
      }

      // 播放爆炸音效 (使用 AudioManager)
      audioManager.playSound('explosion', 0.4);
    }
  }

  /**
   * 执行 TNT 爆炸逻辑
   */
  explode(x, y, z) {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);

    // 在正式计算爆炸前，确保移除方块（如果是手动触发）
    const key = `${bx},${by},${bz}`;
    if (this.world.getBlock(bx, by, bz) === 'tnt') {
      this.world.removeBlock(bx, by, bz);
      this.ignitingTNTs.delete(key);
    }

    // 收集周围区块的 Deltas 发送给 Worker
    const nearbyDeltas = {};

    // 只需要 5x5x5 范围涉及的方块状态
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          const tx = bx + dx;
          const ty = by + dy;
          const tz = bz + dz;
          const type = this.world.getBlock(tx, ty, tz);
          if (type) nearbyDeltas[`${tx},${ty},${tz}`] = type;
        }
      }
    }

    this.explosionWorker.postMessage({
      action: 'calculateExplosion',
      payload: { x, y, z, nearbyDeltas }
    });
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
      const rx = Math.floor(rayPos.x);
      const ry = Math.floor(rayPos.y);
      const rz = Math.floor(rayPos.z);

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

  /**
   * 更新镜头晃动效果
   * @param {number} dx - X轴上的实际移动量
   * @param {number} dz - Z轴上的实际移动量
   * @param {boolean} isObstructed - 玩家的预期移动是否被阻挡
   */
  updateCameraBob(dx, dz, isObstructed) {
    // 只有在实际移动、不在跳跃中、且未被障碍物阻挡时，才应用晃动效果
    const isMovingFreely = (Math.abs(dx) > 0 || Math.abs(dz) > 0) && !this.jumping && !isObstructed;

    let targetBobX = 0;
    let targetBobY = 0;

    if (isMovingFreely) {
      // 检查环境变化（陆地 vs 水面）
      const px = Math.floor(this.position.x);
      const py = Math.floor(this.position.y);
      const pz = Math.floor(this.position.z);
      const currentInWater = this.world.getBlock(px, py, pz) === 'water';

      if (this.lastInWater !== undefined && this.lastInWater !== currentInWater) {
        // 环境发生即时改变，切断之前的音效
        if (currentInWater) {
          audioManager.stopSound('running_land');
        } else {
          audioManager.stopSound('running_water');
        }
      }
      this.lastInWater = currentInWater;

      // 如果在自由移动，则启动对应的循环音效
      this.playFootstepSound();

      // 如果在自由移动，则更新晃动计时器并计算目标偏移
      const oldTimer = this.bobbing_timer;

      targetBobX = Math.sin(this.bobbing_timer) * this.bobbing_intensity;
      targetBobY = Math.cos(this.bobbing_timer * 2) * this.bobbing_intensity * 0.5;
    } else {
      // 如果停止移动或被阻挡，重置计时器并停止移动音效
      this.bobbing_timer = 0;
      audioManager.stopSound('running_land');
      audioManager.stopSound('running_water');
    }

    // 使用线性插值 (Lerp) 平滑地将当前的晃动偏移过渡到目标偏移
    // 当停止移动时，目标偏移为0，这将使镜头平滑地恢复到中心位置
    const lerpFactor = 0.3; // 插值系数，控制恢复速度
    this.bob_offset.x = THREE.MathUtils.lerp(this.bob_offset.x, targetBobX, lerpFactor);
    this.bob_offset.y = THREE.MathUtils.lerp(this.bob_offset.y, targetBobY, lerpFactor);

    // 将最终平滑处理过的偏移量应用到相机
    this.camera.position.x += this.bob_offset.x;
    this.camera.position.y += this.bob_offset.y;
  }
}
