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
import { gunModel } from '../../core/Engine.js';

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

    // 物理与相机状态追踪
    this.isStuck = false;
    this.currentStepHeight = 0; // 用于平滑 Y 轴台阶过渡
    this.bobAmount = 0;         // 当前晃动强度
    this.lastInputDirection = new THREE.Vector3(); // 记录最后的输入方向

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
    this.jumpCooldown = 0; // 跳跃冷却时间（秒）
    this.jumpInterval = 0.25; // 连跳最小间隔（秒）
    this.spaceKeyReleased = true; // 追踪空格键是否已释放，用于防止跳台阶后的非预期连跳

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

    // 持枪系统 (Feature 009)
    this.isHoldingGun = false;
    this.gun = null;
    this.tracers = []; // 初始化追踪线数组
    this.isShooting = false; // 是否正在射击 (按住左键)
    this.shootCooldown = 0;  // 射击冷却计时器
    this.shootInterval = 0.15; // 连发间隔 (150ms) jayli
    this.gunRecoil = 0;      // 枪支后坐力偏移量
    console.log('Player 初始化，当前 Engine.gunModel 状态:', !!gunModel);
  }

  /**
   * 设置输入监听器
   */
  setupInput() {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyR') {
        this.isHoldingGun = !this.isHoldingGun;
        console.log('持枪状态切换(keydown):', this.isHoldingGun);
      }
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Space') {
        this.spaceKeyReleased = true;
      }
    });
    window.addEventListener('mousedown', e => this.interact(e)); // 传递完整事件对象
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.isShooting = false;
    });

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
   * 尝试执行上台阶逻辑 (T009, T010)
   * @param {number} nx - 目标 X
   * @param {number} nz - 目标 Z
   * @returns {boolean} 是否成功跨越台阶
   */
  tryStepUp(nx, nz) {
    // 1. 首先判断当前位置脚下是否有实心支撑 (使用 AABB 多点探测确保边缘支撑也能触发)
    // 这能防止在跳跃过程中因“踩空”而误将前方高层方块判定为台阶，解决 3 层墙跳跃误上顶的 bug
    const feetY = Math.floor(this.position.y - 0.01);
    let isSupported = false;
    const halfW = this.physics.playerWidth / 2;
    // 探测 5 个点：中心 + 4 个角（稍微收缩以避免蹭墙判定）
    const checkCoords = [
      [this.position.x, this.position.z],
      [this.position.x - halfW + 0.05, this.position.z - halfW + 0.05],
      [this.position.x + halfW - 0.05, this.position.z - halfW + 0.05],
      [this.position.x - halfW + 0.05, this.position.z + halfW - 0.05],
      [this.position.x + halfW - 0.05, this.position.z + halfW - 0.05]
    ];
    for (const [cx, cz] of checkCoords) {
      if (this.physics.isSolid(cx, feetY, cz)) {
        isSupported = true;
        break;
      }
    }
    if (!isSupported) return false;

    // 2. T010: 跳跃状态下允许跨越 2 级台阶。
    // 注意：这里的 stepY 必须相对于当前的支撑面 (feetY + 1) 计算
    const maxStep = (this.jumping && this.velocity.y > 0) ? 2.0 : 1.0;
    const currentFloorY = feetY + 1;

    for (let h = 1; h <= maxStep; h++) {
      const stepY = currentFloorY + h;
      // 检查步进后的位置是否会卡住
      if (!this.physics.checkAABB(nx, stepY, nz)) {
        // 还要确保玩家不会在跨越过程中穿过天花板
        if (!this.physics.checkAABB(this.position.x, stepY, this.position.z)) {
          this.position.y = stepY;
          this.position.x = nx;
          this.position.z = nz;
          this.velocity.y = 0; // 踏上台阶后抵消垂直速度

          // 如果是跳跃过程中跨越了 2 级台阶，强制要求释放空格才能再次跳跃
          if (h > 1.0) {
            this.spaceKeyReleased = false;
          }
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 检查头顶碰撞 (T012)
   */
  checkCeilingBump() {
    if (this.velocity.y > 0) {
      if (this.physics.checkAABB(this.position.x, this.position.y + 0.1, this.position.z)) {
        // 头顶撞到东西
        this.velocity.y = -0.01; // 给予微小的下弹速度
        return true;
      }
    }
    return false;
  }

  /**
   * 应用坑道自动对中逻辑 (T008)
   */
  applyTunnelCentering() {
    const px = this.position.x;
    const pz = this.position.z;
    const py = this.position.y;
    const floorX = Math.floor(px);
    const floorZ = Math.floor(pz);
    const floorY = Math.floor(py + 0.1); // 采样高度略高于底部

    // 检查 X 轴向的坑道 (前后都有墙)
    const northSolid = this.physics.isSolid(floorX, floorY, floorZ - 1);
    const southSolid = this.physics.isSolid(floorX, floorY, floorZ + 1);
    const northHeadSolid = this.physics.isSolid(floorX, floorY + 1, floorZ - 1);
    const southHeadSolid = this.physics.isSolid(floorX, floorY + 1, floorZ + 1);

    if ((northSolid && southSolid) || (northHeadSolid && southHeadSolid)) {
      // 在 Z 轴上对中
      this.position.z = THREE.MathUtils.lerp(this.position.z, floorZ + 0.5, 0.1);
    }

    // 检查 Z 轴向的坑道 (左右都有墙)
    const westSolid = this.physics.isSolid(floorX - 1, floorY, floorZ);
    const eastSolid = this.physics.isSolid(floorX + 1, floorY, floorZ);
    const westHeadSolid = this.physics.isSolid(floorX - 1, floorY + 1, floorZ);
    const eastHeadSolid = this.physics.isSolid(floorX + 1, floorY + 1, floorZ);

    if ((westSolid && eastSolid) || (westHeadSolid && eastHeadSolid)) {
      // 在 X 轴上对中
      this.position.x = THREE.MathUtils.lerp(this.position.x, floorX + 0.5, 0.1);
    }
  }

  /**
   * 相机碰撞保护 (T013, T014)
   * 确保相机在靠近墙壁旋转时不会穿模
   */
  applyCameraBumper() {
    const yaw = this.rotation.y;
    const bumperDist = 0.25; // 探测距离
    const cameraHalfWidth = 0.2; // 相机半宽

    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;

    const eyeY = this.position.y + 1.65;
    const floorY = Math.floor(eyeY);

    // 探测三个点
    const points = [
      { x: this.position.x + fwdX * bumperDist, z: this.position.z + fwdZ * bumperDist },
      { x: this.position.x + fwdX * bumperDist - rightX * cameraHalfWidth, z: this.position.z + fwdZ * bumperDist - rightZ * cameraHalfWidth },
      { x: this.position.x + fwdX * bumperDist + rightX * cameraHalfWidth, z: this.position.z + fwdZ * bumperDist + rightZ * cameraHalfWidth }
    ];

    for (const p of points) {
      if (this.physics.isSolid(Math.floor(p.x), floorY, Math.floor(p.z))) {
        // 发现探测点在墙内，将逻辑位置反向推离墙壁
        const pushForce = 0.05;
        this.position.x -= fwdX * pushForce;
        this.position.z -= fwdZ * pushForce;
        return true;
      }
    }
    return false;
  }

  /**
   * 每帧更新逻辑
   * @param {number} dt - 自上一帧以来的时间差（秒）
   */
  update(dt = 0.016) {
    // 1. 更新相机仰角 (Pitch)
    this.camera.rotation.x = this.cameraPitch;

    // 2. 限制 dt 防止物理穿模
    dt = Math.min(dt, 0.1);

    // 3. 记录旧位置
    const oldX = this.position.x;
    const oldZ = this.position.z;

    // 4. 输入驱动速度
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

    // 归一化输入并应用速度
    const inputLen = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (inputLen > 0) {
      this.velocity.x = (inputX / inputLen) * speed;
      this.velocity.z = (inputZ / inputLen) * speed;
      this.lastInputDirection.set(inputX / inputLen, 0, inputZ / inputLen);
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // --- 水平移动与碰撞处理 (T005, T006, T007) ---
    const isCurrentlyStuck = this.physics.checkAABB(this.position.x, this.position.y, this.position.z);
    this.isStuck = isCurrentlyStuck;

    if (!isCurrentlyStuck) {
      // 分轴尝试移动以实现滑动效果 (Sliding) (T019: dt 集成)
      let nextX = this.position.x + this.velocity.x * dt;
      let nextZ = this.position.z + this.velocity.z * dt;

      // 预先检查对角线移动是否会发生碰撞
      const hasCollisionFull = this.physics.checkAABB(nextX, this.position.y, nextZ, true);

      if (hasCollisionFull) {
        // 应用凸角惩罚 (T007)
        const penalty = this.physics.getCornerPenalty(this.velocity.x, this.velocity.z);

        // 尝试 X 轴移动
        if (!this.physics.checkAABB(nextX, this.position.y, this.position.z, true)) {
          this.position.x = nextX;
          this.velocity.x = this.physics.applyFriction(this.velocity.x);
        } else {
          // X 轴被阻挡，尝试上台阶 (T009)
          if (!this.tryStepUp(nextX, this.position.z)) {
            this.velocity.x = 0;
          }
        }

        // 尝试 Z 轴移动
        if (!this.physics.checkAABB(this.position.x, this.position.y, nextZ, true)) {
          this.position.z = nextZ;
          this.velocity.z = this.physics.applyFriction(this.velocity.z);
        } else {
          // Z 轴被阻挡，尝试上台阶 (T009)
          if (!this.tryStepUp(this.position.x, nextZ)) {
            this.velocity.z = 0;
          }
        }

        // 应用凸角速度惩罚
        if (penalty < 1.0) {
          this.position.x = oldX + (this.position.x - oldX) * penalty;
          this.position.z = oldZ + (this.position.z - oldZ) * penalty;
        }
      } else {
        // 无碰撞，直接移动
        this.position.x = nextX;
        this.position.z = nextZ;
      }
    } else {
      // 处于卡死状态，允许微小移动以尝试脱困 (Push-out 逻辑)
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
    }

    // --- T008: 坑道自动对中 ---
    if (inputLen > 0) {
      this.applyTunnelCentering();
    }

    // --- T013, T014: 相机保护 ---
    this.applyCameraBumper();

    // --- Y 轴物理 (T012: 头顶检测) ---
    this.checkCeilingBump();

    let gy = -100;
    const px = Math.floor(this.position.x);
    const pz = Math.floor(this.position.z);
    const py = Math.floor(this.position.y);

    for(let k=0; k<=4; k++) {
      if(this.physics.isSolid(px, py - k, pz)) {
        gy = py - k + 1;
        break;
      }
    }
    if(gy === -100) {
      gy = Math.floor(noise(px, pz) * 0.5) + 1;
    }

    this.position.y += this.velocity.y * dt;

    if (this.position.y < gy) {
      // 落地
      this.position.y = gy;
      this.velocity.y = 0;
      this.jumping = false;
    } else {
      this.velocity.y += this.physics.gravity * dt;
      // 终端速度限制
      if (this.velocity.y < this.physics.terminalVelocity) {
        this.velocity.y = this.physics.terminalVelocity;
      }
    }

    // 5. 更新跳跃冷却
    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= dt;
    }

    if (this.keys['Space'] && !this.jumping && this.jumpCooldown <= 0 && this.spaceKeyReleased) {
      this.velocity.y = this.physics.jumpForce;
      this.jumping = true;
      this.jumpCooldown = this.jumpInterval; // 设置冷却间隔
      this.spaceKeyReleased = false; // 触发跳跃后，标记为已消耗按键
    }

    if (this.position.y < -20) {
      this.position.y = 60;
      this.velocity.y = 0;
    }

    // 相机跟随与平滑处理 (T011: Y 轴插值)
    this.camera.position.x = this.position.x;
    this.camera.position.z = this.position.z;
    // 使用插值确保上下台阶不抖动
    const targetCamY = this.position.y + 1.65;
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCamY, 0.2);

    // --- T018: 兜底推回 ---
    this.physics.applyPushOut();

    // 计算实际位移用于音效和晃动
    const actualDx = this.position.x - oldX;
    const actualDz = this.position.z - oldZ;

    this.updateArm();
    this.updateGun();
    this.handleShooting(dt); // 处理连发逻辑
    this.updateCameraBob(actualDx, actualDz, dt, isCurrentlyStuck);
    this.updateTracers(dt);
  }

  /**
   * 处理连发逻辑
   */
  handleShooting(dt) {
    if (this.shootCooldown > 0) {
      this.shootCooldown -= dt;
    }

    if (this.isHoldingGun && this.isShooting && this.shootCooldown <= 0) {
      // 获取所有可交互的区块物体
      const targets = [];
      for (const chunk of this.world.chunks.values()) {
        targets.push(chunk.group);
      }
      this.executeShot(targets);
      this.shootCooldown = this.shootInterval;
    }
  }

  /**
   * 执行单次射击计算
   */
  executeShot(targets) {
    // 使用更长的射线探测距离 (40)
    this.raycaster.far = 40;
    this.raycaster.setFromCamera(this.center, this.camera);
    const gunHits = this.raycaster.intersectObjects(targets, true);
    this.raycaster.far = Infinity; // 恢复默认值

    if (gunHits.length > 0) {
      const hit = gunHits[0];
      this.shoot(hit);

      // 检查命中的方块类型
      const m = hit.object;
      const type = m.userData.type || 'unknown';

      if (type === 'tnt') {
        const instanceId = hit.instanceId;
        let pos = new THREE.Vector3();
        if (m.isInstancedMesh) {
          const dummy = new THREE.Matrix4();
          m.getMatrixAt(instanceId, dummy);
          dummy.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
        } else {
          pos.copy(m.position);
        }

        const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
        if (!this.ignitingTNTs.has(key)) {
          this.ignitingTNTs.add(key);
          this.explode(pos.x, pos.y, pos.z);
        }
      } else {
        this.removeBlock(hit);
      }
    } else {
      this.shoot(null);
    }
  }

  /**
   * 更新枪支状态 (Feature 009)
   */
  updateGun() {
    // 增加状态检查日志（频率限制，防止刷屏）
    if (!this.gun && !this._lastGunLog || Date.now() - this._lastGunLog > 5000) {
      console.log('持枪系统检查: this.gun=', !!this.gun, 'gunModel=', !!gunModel);
      this._lastGunLog = Date.now();
    }

    if (!this.gun && gunModel) {
      console.log('检测到枪支模型已加载，正在克隆并添加到相机...');
      this.gun = gunModel.clone();
      this.camera.add(this.gun);

      // 调整位置和旋转 (根据经验微调)
      // X: 0.3 (右), Y: -0.3 (下), Z: -0.4 (前) - 距离更近更中心
      this.gun.position.set(0.3, -0.85, -0.4);

      // 暂时移除旋转，看看模型原始朝向
      this.gun.rotation.y = 0;

      // 进一步增大缩放比例，确保能看到
      this.gun.scale.set(0.09, 0.09, 0.09);

      console.log('枪支模型已挂载到相机，位置:', this.gun.position);
    }

    if (this.gun) {
      this.gun.visible = this.isHoldingGun;

      // 应用后坐力到位置 (向后偏移 Z 轴)
      this.gun.position.set(0.3, -0.85, -0.4 + this.gunRecoil);

      // 逐渐恢复后坐力
      this.gunRecoil = THREE.MathUtils.lerp(this.gunRecoil, 0, 0.2);
    }
  }

  /**
   * 执行射击交互
   */
  shoot(hit) {
    // 0. 触发枪支后坐力位移
    this.gunRecoil = 0.05;

    // 1. 计算枪口的大致世界坐标 (基于枪支在相机中的偏移)
    // Y 调整为 -0.82 以匹配枪管高度，Z 调整为 -0.44 使起点处于枪口内侧（实现遮挡感）
    const muzzleOffset = new THREE.Vector3(0.3, -0.82, -0.44);
    muzzleOffset.applyQuaternion(this.camera.quaternion);
    const muzzlePos = new THREE.Vector3().copy(this.camera.position).add(muzzleOffset);

    // 2. 确定目标点
    let targetPos;
    if (hit) {
      targetPos = hit.point;
    } else {
      // 如果没打中，射向 40 米远处
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      targetPos = new THREE.Vector3().copy(this.camera.position).add(direction.multiplyScalar(40));
    }

    // 3. 生成示踪线
    this.spawnTracer(muzzlePos, targetPos);

    // 4. 播放射击音效
    audioManager.playSound('gun_fire', 0.15); // jayli
  }

  /**
   * 生成示踪线效果
   */
  spawnTracer(start, end) {
    const distance = start.distanceTo(end);
    const geometry = new THREE.BoxGeometry(0.05, 0.05, 1);
    // 将几何体向 Z 正方向移动 0.5，使原点位于盒子的一端起始处
    geometry.translate(0, 0, 0.5);

    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.8
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(start);
    mesh.lookAt(end);
    mesh.scale.set(1, 1, distance);

    this.world.scene.add(mesh);

    // 计算起点相对于相机的本地偏移 (需与 shoot 方法中的 muzzleOffset 保持一致)
    const localStart = new THREE.Vector3(0.3, -0.33, -0.98);

    this.tracers.push({
      mesh: mesh,
      lifetime: 0.1, // 持续 0.1 秒
      maxLifetime: 0.1,
      localStart: localStart, // 存储本地起点偏移
      worldEnd: end.clone()   // 存储固定的世界落点
    });
  }

  /**
   * 更新并清理示踪线
   */
  updateTracers(dt) {
    const tempStart = new THREE.Vector3();

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.lifetime -= dt;

      if (tracer.lifetime <= 0) {
        this.world.scene.remove(tracer.mesh);
        tracer.mesh.geometry.dispose();
        tracer.mesh.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        // 动态更新起点：使其始终相对于当前相机位置固定
        tempStart.copy(tracer.localStart);
        tempStart.applyQuaternion(this.camera.quaternion);
        tempStart.add(this.camera.position);

        // 更新示踪线网格
        tracer.mesh.position.copy(tempStart);
        tracer.mesh.lookAt(tracer.worldEnd);
        const newDist = tempStart.distanceTo(tracer.worldEnd);
        tracer.mesh.scale.set(1, 1, newDist);

        tracer.mesh.material.opacity = (tracer.lifetime / tracer.maxLifetime) * 0.8;
      }
    }
  }

  /**
   * 更新镜头晃动效果 (T015)
   * @param {number} dx - X 实际位移
   * @param {number} dz - Z 实际位移
   * @param {number} dt - 时间增量
   * @param {boolean} isObstructed - 是否被卡住
   */
  updateCameraBob(dx, dz, dt, isObstructed) {
    // 计算预期位移量
    const inputSpeed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);
    const expectedDist = inputSpeed * dt;
    const actualDist = Math.sqrt(dx * dx + dz * dz);

    // 判定是否为“全速前进”：实际位移达到预期的 95% 以上
    // 同时也需要满足正在移动且未在跳跃中
    const isMoving = actualDist > 0.001;
    const isFullSpeed = inputSpeed > 0 && actualDist > expectedDist * 0.95;

    // 只有在全速移动、未在跳跃、且未被阻挡（包括侧滑导致的减速）时才晃动
    const shouldBob = isMoving && isFullSpeed && !this.jumping && !isObstructed;

    if (shouldBob) {
      this.bobbing_timer += this.bobbing_speed;
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, this.bobbing_intensity, 0.1);
    } else {
      this.bobbing_timer = 0;
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, 0, 0.2);
    }

    const bobX = Math.sin(this.bobbing_timer) * this.bobAmount;
    const bobY = Math.cos(this.bobbing_timer * 2) * this.bobAmount * 0.5;

    // 应用平滑后的偏移
    this.bob_offset.x = THREE.MathUtils.lerp(this.bob_offset.x, bobX, 0.3);
    this.bob_offset.y = THREE.MathUtils.lerp(this.bob_offset.y, bobY, 0.3);

    this.camera.position.x += this.bob_offset.x;
    this.camera.position.y += this.bob_offset.y;

    // 处理脚步声
    if (shouldBob) {
      this.playFootstepSound();
    } else {
      audioManager.stopSound('running_land');
      audioManager.stopSound('running_water');
    }
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
    } else if (button === 0) { // 左键点击 - 挖掘或射击
      // 射击逻辑 (Feature 009)
      if (this.isHoldingGun) {
        this.isShooting = true;
        // 只有在冷却结束时才发射第一枪（防止点击过快导致的频率异常，虽然通常 interval 很大）
        if (this.shootCooldown <= 0) {
          this.executeShot(targets);
          this.shootCooldown = this.shootInterval;
        }
        return; // 射击后跳过常规挖掘逻辑
      }

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

    // 检查是否与玩家自身碰撞 (AABB 碰撞检测)
    // 玩家占据的空间：[x - 0.3, x + 0.3], [y, y + 1.8], [z - 0.3, z + 0.3] (略微缩小判定区以提升放置体验)
    // 方块占据的空间：[x, x + 1], [y, y + 1], [z, z + 1]
    const playerMinX = this.position.x - 0.3;
    const playerMaxX = this.position.x + 0.3;
    const playerMinZ = this.position.z - 0.3;
    const playerMaxZ = this.position.z + 0.3;
    const playerMinY = this.position.y;
    const playerMaxY = this.position.y + 1.8;

    const blockMinX = x;
    const blockMaxX = x + 1;
    const blockMinY = y;
    const blockMaxY = y + 1;
    const blockMinZ = z;
    const blockMaxZ = z + 1;

    if (playerMinX < blockMaxX && playerMaxX > blockMinX &&
        playerMinY < blockMaxY && playerMaxY > blockMinY &&
        playerMinZ < blockMaxZ && playerMaxZ > blockMinZ) {
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
    if (this.isHoldingGun) {
      this.arm.visible = false;
      return;
    }
    if (this.swingTime > 0) {
      this.arm.visible = true;
      this.arm.rotation.x = -Math.PI / 2 + Math.sin(this.swingTime * 0.3);
      this.swingTime--;
    } else {
      this.arm.visible = false;
    }
  }
}
