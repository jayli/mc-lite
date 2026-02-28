// src/actors/player/Player.js
/**
 * 玩家类，负责处理玩家状态、输入、物理交互和渲染辅助（如相机位置、手臂）
 */
import * as THREE from 'three';
import { audioManager } from '../../core/AudioManager.js';
import { Physics } from './Physics.js';
import { Inventory } from './Slots.js';
import { getBiome, noise, WORLD_CONFIG } from '../../utils/MathUtils.js';
import { chestManager } from '../../world/entities/Chest.js';
import { gunModel, mag7Model, minigunModel } from '../../core/Engine.js';
import { Gun, WEAPON_TYPES } from '../weapon/Gun.js';
import { getBlockProperties } from '../../constants/BlockData.js';
import { nextOrientation } from '../../utils/OrientationUtils.js';

/**
 * 获取指定区域内的雪地中心位置
 * @param {number} regionX - 区域 X 坐标
 * @param {number} regionZ - 区域 Z 坐标
 * @param {number} seed - 世界种子
 * @returns {Object} 雪地中心位置 {centerX, centerZ}
 */
function getSnowLandCenter(regionX, regionZ, seed) {
  const regionSize = 400;

  // 计算该区域的金字塔中心（使用与 Pyramid.js 相同的算法）
  const randX = Math.abs(Math.sin(seed * 1.5 + regionX * 0.1));
  const randZ = Math.abs(Math.sin(seed * 2.5 + regionZ * 0.1));
  const offsetX = Math.floor(randX * 300) + 100;
  const offsetZ = Math.floor(randZ * 300) + 100;

  const pyramidCx = regionX * regionSize + offsetX;
  const pyramidCz = regionZ * regionSize + offsetZ;

  // 雪地位移 = 金字塔位置 + (160, 0) 偏移
  // 金字塔半宽 28 + 间隔 100 + 雪地半宽 28 = 156，使用 160 确保有足够间隔
  const snowLandCx = pyramidCx + 160;
  const snowLandCz = pyramidCz;

  return {
    centerX: snowLandCx,
    centerZ: snowLandCz
  };
}

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

    // 玩家移动状态跟踪
    this.lastPosition = new THREE.Vector3().copy(this.position); // 上一帧的位置
    this.isMoving = false;         // 是否在移动
    this.moveCheckInterval = 0;    // 碰撞检测间隔计数器
    this.moveCheckFrequency = 1;   // 碰撞检测频率 (每几帧检查一次)

    // 初始出生点逻辑
    let spawnFound = false;

    // 首先尝试在雪地附近出生：直接获取一个区域的雪地中心
    // 选择 0,0 区域附近的雪地
    const slInfo = getSnowLandCenter(0, 0, WORLD_CONFIG.SEED);

    // 在雪地附近（但不在雪地正上方）选择一个出生点
    // 在雪地边缘外 10-20 格的位置出生
    const angle = Math.random() * Math.PI * 2;
    const dist = 15 + Math.random() * 10;
    const spawnX = slInfo.centerX + Math.cos(angle) * dist;
    const spawnZ = slInfo.centerZ + Math.sin(angle) * dist;

    const biome = getBiome(spawnX, spawnZ);
    // 确保出生点不在水里
    const h = Math.floor(noise(spawnX, spawnZ, 0.08) + noise(spawnX, spawnZ, 0.02) * 3);
    if (h > -0.5) {
      this.position.set(spawnX, 70, spawnZ); // 出生点海拔高度保持 70 不变
      spawnFound = true;
    }

    // 如果没找到雪地附近的合适出生点，使用原有逻辑
    if (!spawnFound) {
      for (let i = 0; i < 1000; i++) {
        const tx = (Math.random() - 0.5) * 20000;
        const tz = (Math.random() - 0.5) * 20000;

        const biome = getBiome(tx, tz);
        // 尝试在森林或平原生物群系出生
        if (biome === 'FOREST' || biome === 'PLAINS') {
          // 计算预估地形高度，确保不在水面上（海平面约 -1.5）
          const h = Math.floor(noise(tx, tz, 0.08) + noise(tx, tz, 0.02) * 3);
          if (h > -0.5) {
            this.position.set(tx, 70, tz); // 出生点海拔高度
            spawnFound = true;
            break;
          }
        }
      }
    }

    if (!spawnFound) this.position.set(0, 70, 0); // 出生点海拔高度

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

    // 放置记忆 - 存储上次移除方块的位置和朝向，用于判断是否在同一位置放置相同方块
    this.lastRemovedBlock = null; // { x, y, z, type, orientation }

    // 全局朝向记忆 - 按物品类型存储上次使用的朝向
    // 当放置方块方向改变后，后续同类型方块都沿用该朝向
    this.placementOrientationMemory = new Map(); // { 'handrail': 1, 'pillar': 2, ... }

    // 持枪系统 (Refactored)
    this.weaponMode = WEAPON_TYPES.ARM; // 当前选择的武器模式 (0: 手臂, 1: 手枪, 2: MAG7, 3: 加特林)
    this.weapon = null;                 // 当前处于激活状态的 Gun 实例
    this.tracers = [];                  // 当前在场景中的所有弹道轨迹
    this.isShooting = false;            // 是否正处于射击按下状态
    this.shootCooldown = 0;             // 射击冷却剩余时间

    // 性能优化：池与复用
    this._tempVector = new THREE.Vector3();              // 临时向量对象，用于避免频繁创建新向量
    this._direction = new THREE.Vector3();               // 临时方向向量，用于存储计算中的方向
    this._dummyMatrix = new THREE.Matrix4();             // 临时矩阵对象，用于转换操作
    this._dummyQuaternion = new THREE.Quaternion();      // 临时四元数对象，用于旋转操作
    this._dummyScale = new THREE.Vector3();              // 临时缩放向量，用于提取变换矩阵中的缩放分量
    this._zeroVector = new THREE.Vector3(0, 0, 0);      // 零向量常量，用于重置变换

    this.tracerPool = [];
    this.tracerInfoPool = [];

    this.tracerGeometry = new THREE.BoxGeometry(0.05, 0.05, 1);  // 子弹/激光轨迹的几何体（细长的盒子形状）
    this.tracerGeometry.translate(0, 0, 0.5);                   // 将几何体沿Z轴向前偏移0.5单位，使轨迹从前面开始延伸
    this.tracerMaterial = new THREE.MeshBasicMaterial({         // 轨迹材质配置
      color: 0xffff00,                                         // 黄色轨迹
      transparent: true,                                        // 启用透明度
      opacity: 0.8                                             // 透明度为0.8
    });

    this.mag7TracerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });

    this.mag7Timeouts = [];
  }

  /**
   * 初始化玩家输入控制系统
   * 监听键盘和鼠标事件，处理按键状态和视角控制
   */
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
    document.addEventListener('click', () => {
      // 检查背包是否打开，如果打开则不请求指针锁定
      const inventoryModal = document.getElementById('inventory-modal');
      const isInventoryOpen = inventoryModal && window.getComputedStyle(inventoryModal).display !== 'none';

      if (!isInventoryOpen && document.pointerLockElement !== document.body) {
        document.body.requestPointerLock();
      }

      if (!this.bgmStarted) {
        audioManager.playBGM('bgm', 0.15);
        this.bgmStarted = true;
      }
    });
  }

  /**
   * 更新玩家状态
   * 处理玩家移动、物理计算、碰撞检测和相机控制
   * @param {number} dt - 时间步长
   */
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

    // 检查玩家是否移动
    const positionDiff = this.position.distanceTo(this.lastPosition);
    const movementThreshold = 0.01;
    this.isMoving = positionDiff > movementThreshold || Math.abs(this.velocity.x) > 0.01 || Math.abs(this.velocity.z) > 0.01;

    // 更新位置用于下一次比较
    this.lastPosition.copy(this.position);

    // 每隔一定帧数才进行一次碰撞检测（如果玩家未移动）
    const shouldCheckCollision = this.isMoving || (this.moveCheckInterval % this.moveCheckFrequency === 0);
    let isCurrentlyStuck = false;

    if (shouldCheckCollision) {
      isCurrentlyStuck = this.physics.checkAABB(this.position.x, this.position.y, this.position.z);
    }
    this.isStuck = isCurrentlyStuck;

    if (!isCurrentlyStuck) {
      let nextX = this.position.x + this.velocity.x * dt;
      let nextZ = this.position.z + this.velocity.z * dt;

      if (shouldCheckCollision) {
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
        // 如果不需要碰撞检测，直接更新位置
        this.position.x = nextX;
        this.position.z = nextZ;
      }
    } else {
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
    }

    // 只在移动时才应用隧道自动居中
    if (inputLen > 0) this.physics.applyTunnelCentering();

    // 只在移动时才应用相机避碰检查，除非玩家卡住
    if (this.isMoving || this.isStuck) {
      this.physics.applyCameraBumper();
    }
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

    // 只在移动时或卡住时才应用推挤修正
    if (this.isMoving || this.isStuck) {
      this.physics.applyPushOut();
    }

    const actualDx = this.position.x - oldX;
    const actualDz = this.position.z - oldZ;

    // 增加 moveCheckInterval 计数器
    this.moveCheckInterval++;

    this.updateArm(dt);
    this.updateWeapon(dt);
    this.handleShooting(dt);
    this.updateCameraBob(actualDx, actualDz, dt, isCurrentlyStuck);
    this.updateTracers(dt);
  }

  /**
   * 获取交互目标对象
   * 返回当前可交互的方块和物体列表
   * @returns {Array} 交互目标对象数组
   */
  getInteractionTargets() {
    const targets = [];
    for (const chunk of this.world.chunks.values()) targets.push(chunk.group);

    // 添加丧尸作为交互目标（如果游戏有敌人管理器）
    if (this.game && this.game.enemyManager) {
      // 从EnemyManager获取渲染网格（InstancedMesh）
      if (typeof this.game.enemyManager.getRenderMeshes === 'function') {
        const renderMeshes = this.game.enemyManager.getRenderMeshes();
        targets.push(...renderMeshes);
      }

      // 从EnemyManager获取所有敌人实例
      const enemies = this.game.enemyManager.getAllEnemies();
      for (const enemy of enemies) {
        if (enemy.mesh) {
          targets.push(enemy.mesh);
        }
      }
    }

    chestManager.chestAnimations.forEach(anim => {
      if (anim.mesh) targets.push(anim.mesh);
    });
    return targets;
  }

  /**
   * 处理射击逻辑
   * 根据当前武器类型和射击状态执行相应的射击操作
   * @param {number} dt - 时间步长
   */
  handleShooting(dt) {
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.weapon && this.isShooting && this.shootCooldown <= 0) {
      if (this.weaponMode === WEAPON_TYPES.GUN || this.weaponMode === WEAPON_TYPES.MINIGUN) {
        this.executeShot(this.getInteractionTargets());
        this.shootCooldown = this.weapon.config.fireRate;
      }
    }
  }

  /**
   * 更新武器状态
   * 处理武器切换、创建和更新
   * @param {number} dt - 时间步长
   */
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

  /**
   * 执行射击动作
   * 发射子弹并生成轨迹效果
   * @param {Array} targets - 交互目标对象数组
   */
  executeShot(targets) {
    this.raycaster.far = 40;
    this.raycaster.setFromCamera(this.center, this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    this.raycaster.far = Infinity;

    // Debug logging for raycasting
    if (this.game && this.game.showDebugInfo) {
      console.log(`[Raycast] targets: ${targets.length}, hits: ${hits.length}`);
      if (hits.length > 0) {
        const hit = hits[0];
        console.log(`[Raycast] Hit[0]:`, hit.object.userData, hit.object.isInstancedMesh, hit.instanceId);
      }
    }

    // 当枪械不能破坏方块时，实心方块可以阻挡子弹
    const canGunsDestroyBlocks = this.game?.canGunsDestroyBlocks !== false;

    let finalHit = null; // The actual hit point for tracer
    let hasHitSolid = false;

    // Iterate through hits to find the first solid object (Zombie or Block)
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const obj = hit.object;

      // 1. Check if Zombie
      let isZombie = false;
      if (obj.userData?.renderer || obj.userData?.isZombie || obj.parent?.userData?.isZombie) {
        isZombie = true;
      }

      if (isZombie) {
        // Hit a zombie!
        finalHit = hit;
        hasHitSolid = true;

        if (this.game && this.game.enemyManager) {
          const damage = this.weaponMode === WEAPON_TYPES.MINIGUN ? 35 : 25;
          let enemyUuid;

          if (obj.userData?.renderer) {
             const zombie = obj.userData.renderer.getZombieAt(hit.instanceId);
             if (zombie) enemyUuid = zombie.id;
          } else {
             enemyUuid = obj.uuid;
             if (!obj.userData?.isZombie && obj.parent?.userData?.isZombie) {
               enemyUuid = obj.parent.uuid;
             }
             if (obj.parent?.userData?.zombieId) enemyUuid = obj.parent.userData.zombieId;
             if (obj.userData?.zombieId) enemyUuid = obj.userData.zombieId;
          }

          if (enemyUuid) {
            this.game.enemyManager.applyDamageToEnemy(enemyUuid, damage);
            console.log(`[Combat] 击中丧尸，造成 ${damage} 点伤害！`);
          }
        }
        break; // Bullet stops at zombie
      }

      // 2. Check if Block (Terrain/Other)
      // Determine if it's a solid block
      // Calculate block coordinate slightly inside the hit face
      const p = hit.point.clone().addScaledVector(hit.face.normal, -0.01);
      const bx = Math.floor(p.x);
      const by = Math.floor(p.y);
      const bz = Math.floor(p.z);
      const blockType = this.world.getBlock(bx, by, bz);

      if (blockType && blockType !== 'air') {
        // 优先检查是否是 TNT 方块，无论是否是实心都触发爆炸
        if (blockType === 'tnt') {
          finalHit = hit;
          hasHitSolid = true;
          // Ignite TNT logic
          if (obj.isInstancedMesh) {
            obj.getMatrixAt(hit.instanceId, this._dummyMatrix);
            this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
          } else {
            this._tempVector.copy(obj.position);
          }
          const key = `${Math.floor(this._tempVector.x)},${Math.floor(this._tempVector.y)},${Math.floor(this._tempVector.z)}`;
          if (!this.ignitingTNTs.has(key)) {
            this.ignitingTNTs.add(key);
            this.explode(this._tempVector.x, this._tempVector.y, this._tempVector.z);
          }
          break;
        }

        const props = getBlockProperties(blockType);
        // 花和草可以被枪械摧毁
        const isDestructiblePlant = blockType === 'flower' || blockType === 'short_grass' || blockType === 'allium';

        if (props.isSolid || blockType === 'cloud') {
          // Hit a solid block or cloud block (not TNT)
          finalHit = hit;
          hasHitSolid = true;

          if (canGunsDestroyBlocks) {
            this.removeBlock(hit);
          }
          // If not canGunsDestroyBlocks, we just stop here (blocked)
          break;
        } else if (isDestructiblePlant && canGunsDestroyBlocks) {
          // 花和草可以被枪械摧毁，但射线继续穿透
          this.removeBlock(hit);
        }
        // If not solid and not cloud and not destructible plant (e.g. water), continue ray to find what's behind
      } else {
        // Hit something else (chest, TNT, etc.)?
        // TNT and Chests are meshes but usually handled via removeBlock logic or specialized logic
        // If it's a mesh entity, we treat it as solid for now
        const type = obj.userData.type || 'unknown';
        if (type === 'tnt' || type === 'chest') {
           finalHit = hit;
           hasHitSolid = true;
           if (type === 'tnt') {
              // Ignite TNT logic (copied from original)
              if (obj.isInstancedMesh) {
                obj.getMatrixAt(hit.instanceId, this._dummyMatrix);
                this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
              } else {
                this._tempVector.copy(obj.position);
              }
              const key = `${Math.floor(this._tempVector.x)},${Math.floor(this._tempVector.y)},${Math.floor(this._tempVector.z)}`;
              if (!this.ignitingTNTs.has(key)) {
                this.ignitingTNTs.add(key);
                this.explode(this._tempVector.x, this._tempVector.y, this._tempVector.z);
              }
           } else if (canGunsDestroyBlocks) {
              this.removeBlock(hit);
           }
           break;
        }
      }
    }

    const effect = this.weapon.onFire(finalHit ? finalHit.point : null);
    this.spawnTracer(effect.start, effect.end, effect.config);
  }

  /**
   * 执行散弹枪射击
   * 特殊处理散弹枪的多重射击效果
   */
  executeMag7Shot() {
    this.mag7Timeouts.forEach(t => clearTimeout(t));
    this.mag7Timeouts = [];

    // Mag7 散弹枪设计初衷是破坏一切，不受 canGunsDestroyBlocks 限制

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

    // 检查是否击中丧尸 - Mag7在射程内直接消灭
    for (const hit of hits) {
      const obj = hit.object;

      // Check for InstancedMesh zombie
      if (obj.userData?.renderer) {
        if (this.game?.enemyManager) {
          const zombie = obj.userData.renderer.getZombieAt(hit.instanceId);
          if (zombie) {
            this.game.enemyManager.applyDamageToEnemy(zombie.id, 999);
            console.log(`[Combat] Mag7 击中丧尸，直接消灭！`);
            break;
          }
        }
      }

      // 检查是否是丧尸（直接或者父级是丧尸）
      else if (obj.userData?.isZombie || obj.parent?.userData?.isZombie) {
        if (this.game?.enemyManager) {
          let enemyUuid = obj.uuid;
          if (obj.userData?.isZombie) enemyUuid = obj.uuid;
          else if (obj.parent?.userData?.isZombie) enemyUuid = obj.parent.uuid;

          if (obj.userData?.zombieId) enemyUuid = obj.userData.zombieId;
          if (obj.parent?.userData?.zombieId) enemyUuid = obj.parent.userData.zombieId;

          // Mag7直接消灭丧尸
          this.game.enemyManager.applyDamageToEnemy(enemyUuid, 999);
          console.log(`[Combat] Mag7 击中丧尸，直接消灭！`);
        }
        break; // 击中一个丧尸后停止
      }

      // 检查是否击中小汽车 (rover)
      else if (obj.userData?.type === 'rover' || obj.parent?.userData?.type === 'rover') {
        const car = obj.userData?.type === 'rover' ? obj : obj.parent;
        if (car && car.userData.collisionBlocks) {
          // 移除碰撞方块
          this.world.removeBlocksBatch(car.userData.collisionBlocks);
          console.log(`[Combat] Mag7 击中小汽车，移除 ${car.userData.collisionBlocks.length} 个碰撞方块`);
        }
        // 移除小汽车模型
        if (car && car.parent) {
          car.parent.remove(car);
          console.log(`[Combat] Mag7 击中小汽车，模型已移除`);
        }
        break; // 击中一个后停止
      }
    }

    const hit = hits.length > 0 ? hits[0] : null;
    const effect = this.weapon.onFire(hit ? hit.point : null);
    this.spawnTracer(effect.start, effect.end, effect.config);
  }

  /**
   * 生成轨迹效果
   * 创建子弹或激光的轨迹可视化效果
   * @param {THREE.Vector3} start - 起始点
   * @param {THREE.Vector3} end - 结束点
   * @param {Object} config - 配置对象
   */
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

  /**
   * 更新轨迹效果
   * 更新所有活动轨迹的生命周期和外观
   * @param {number} dt - 时间步长
   */
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

  /**
   * 更新相机晃动效果
   * 实现步行时的视角摇摆效果
   * @param {number} dx - X轴移动距离
   * @param {number} dz - Z轴移动距离
   * @param {number} dt - 时间步长
   * @param {boolean} isObstructed - 是否受阻
   */
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

  /**
   * 播放脚步声
   * 根据当前所在方块类型播放相应的脚步声
   */
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

  /**
   * 处理交互事件
   * 处理鼠标点击事件，实现方块挖掘、放置和射击功能
   * @param {Event} e - 鼠标事件
   */
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
          // 统一使用 hit.point 计算点击的面，确保旋转方块的正确性
          const blockPos = this._getBlockPositionFromHit(hit);
          if (this.tryPlaceBlock(blockPos.x, blockPos.y, blockPos.z, heldItem)) this.swing();
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
        this.removeBlock(hit, true);
        this.swing();
      } else {
        this.swing();
      }
    }
  }

  /**
   * 打开宝箱
   * 处理宝箱的打开动画和奖励发放
   * @param {THREE.Mesh} mesh - 宝箱网格对象
   * @param {number} instanceId - 实例ID
   * @param {THREE.Vector3} pos - 宝箱位置
   */

  /**
   * 从射线检测击中信息计算放置位置
   * 使用 hit.point 计算点击的面，确保旋转方块的正确性
   * @param {Object} hit - 射线检测击中信息
   * @returns {{ x: number, y: number, z: number }} 放置位置
   */
  _getBlockPositionFromHit(hit) {
    const m = hit.object;
    // 获取方块的世界空间位置
    let blockWorldPos;
    if (m.isInstancedMesh) {
      m.getMatrixAt(hit.instanceId, this._dummyMatrix);
      this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
      blockWorldPos = this._tempVector;
    } else {
      blockWorldPos = m.position;
    }

    const blockX = Math.floor(blockWorldPos.x);
    const blockY = Math.floor(blockWorldPos.y);
    const blockZ = Math.floor(blockWorldPos.z);

    // 计算击中点相对于方块中心 (块中心 +0.5) 的偏移
    const dx = hit.point.x - (blockX + 0.5);
    const dy = hit.point.y - (blockY + 0.5);
    const dz = hit.point.z - (blockZ + 0.5);

    // 找到绝对值最大的轴，确定点击的面
    const absX = Math.abs(dx), absY = Math.abs(dy), absZ = Math.abs(dz);
    let nx = 0, ny = 0, nz = 0;
    if (absX >= absY && absX >= absZ) {
      nx = dx > 0 ? 1 : -1;
    } else if (absY >= absX && absY >= absZ) {
      ny = dy > 0 ? 1 : -1;
    } else {
      nz = dz > 0 ? 1 : -1;
    }

    return {
      x: Math.floor(blockWorldPos.x + nx),
      y: Math.floor(blockWorldPos.y + ny),
      z: Math.floor(blockWorldPos.z + nz)
    };
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

  /**
   * 尝试放置方块
   * 检查位置有效性并放置方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @param {string} type - 方块类型
   * @returns {boolean} 是否成功放置
   */
  tryPlaceBlock(x, y, z, type) {
    if (this.physics.isSolid(x, y, z)) return false;
    if (this.position.x - 0.3 < x + 1 && this.position.x + 0.3 > x && this.position.y < y + 1 && this.position.y + 1.8 > y && this.position.z - 0.3 < z + 1 && this.position.z + 0.3 > z) return false;
    // 获取放置朝向（只有在同一位置移除并放置相同方块时才旋转）
    const orientation = this.getPlacementOrientation(x, y, z, type);
    // 放置后清除移除记忆
    this.clearRemovedBlock();
    this.world.setBlock(x, y, z, type, orientation);
    this.inventory.remove(type, 1);
    audioManager.playSound('put', 0.3);
    return true;
  }

  /**
   * 记录方块移除时的位置和朝向
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {string} type - 方块类型
   * @param {number} orientation - 朝向 (0-3)
   */
  recordRemovedBlock(x, y, z, type, orientation) {
    this.lastRemovedBlock = { x, y, z, type, orientation };
  }

  /**
   * 清除移除方块的记忆（在放置方块后或非同一位置放置时调用）
   */
  clearRemovedBlock() {
    this.lastRemovedBlock = null;
  }

  /**
   * 获取放置方块的朝向
   * 使用全局朝向记忆：每种物品类型都记住上次使用的朝向
   * 当在同一位置移除并重新放置相同方块时，顺时针旋转 90 度并更新记忆
   * @param {number} x - 放置位置 X
   * @param {number} y - 放置位置 Y
   * @param {number} z - 放置位置 Z
   * @param {string} type - 方块类型
   * @returns {number} 放置的朝向 (0-3)
   */
  getPlacementOrientation(x, y, z, type) {
    // 检查是否在同一位置放置相同类型的方块（用于旋转）
    const isRebuildingSameBlock = this.lastRemovedBlock &&
        this.lastRemovedBlock.x === x &&
        this.lastRemovedBlock.y === y &&
        this.lastRemovedBlock.z === z &&
        this.lastRemovedBlock.type === type;

    // 获取该物品类型上次记住的朝向
    const lastOrientation = this.placementOrientationMemory.get(type);

    let newOrientation;

    if (isRebuildingSameBlock) {
      // 同一位置、相同类型，顺时针旋转 90 度
      newOrientation = nextOrientation(this.lastRemovedBlock.orientation);
      // 更新记忆
      this.placementOrientationMemory.set(type, newOrientation);
    } else if (lastOrientation !== undefined) {
      // 有记忆，沿用记忆的朝向
      newOrientation = lastOrientation;
    } else {
      // 没有记忆，使用默认朝东
      newOrientation = 0;
    }

    return newOrientation;
  }

  /**
   * 移除方块
   * 挖掘指定位置的方块
   * @param {Object} hit - 点击命中信息
   * @param {boolean} isHandBreak - 是否是徒手破坏（用于播放不同特效）
   */
  removeBlock(hit, isHandBreak = false) {
    let m = hit.object;
    while (m && !m.userData.isEntity && !m.userData.type && m.parent && !m.isInstancedMesh && m.type !== 'Scene') m = m.parent;
    const type = m.userData.type || 'unknown';

    // 检查是否为不可破坏方块
    if (type === 'end_stone' || type === 'playground_block' || type === 'playground_center_block') return;

    if (m.isInstancedMesh) {
      m.getMatrixAt(hit.instanceId, this._dummyMatrix);
      this._dummyMatrix.decompose(this._tempVector, this._dummyQuaternion, this._dummyScale);
      // 记录方块位置和朝向到放置记忆
      const bx = Math.floor(this._tempVector.x), by = Math.floor(this._tempVector.y), bz = Math.floor(this._tempVector.z);
      const entry = this.world.getBlockEntry(bx, by, bz);
      if (entry) {
        this.recordRemovedBlock(bx, by, bz, entry.type, entry.orientation);
      }
      this._dummyMatrix.scale(this._zeroVector);
      m.setMatrixAt(hit.instanceId, this._dummyMatrix);
      m.instanceMatrix.needsUpdate = true;
      // 徒手破坏时使用新的破碎特效，否则使用原有粒子特效
      if (isHandBreak) {
        this.world.spawnBlockCrashParticles(this._tempVector);
      } else {
        this.spawnParticles(this._tempVector, type);
      }
      this.world.removeBlock(bx, by, bz);
      audioManager.playSound('delete_get', 0.3);
      if (type !== 'water' && type !== 'cloud') this.inventory.add(type === 'grass' ? 'dirt' : type, 1);
    } else {
      if (m.userData.isEntity) {
        if (m.userData.collisionBlocks) m.userData.collisionBlocks.forEach(p => this.world.removeBlockCollider(p.x, p.y, p.z));
        if (m.parent) m.parent.remove(m);
        // 徒手破坏时使用新的破碎特效，否则使用原有粒子特效
        if (isHandBreak) {
          this.world.spawnBlockCrashParticles(m.position);
        } else {
          this.spawnParticles(m.position, type || 'stone');
        }
        if (type === 'chest') {
          this.world.removeBlock(Math.floor(m.position.x), Math.floor(m.position.y), Math.floor(m.position.z));
          this.inventory.add('chest', 1);
          audioManager.playSound('delete_get', 0.3);
        }
      } else {
        const bx = Math.floor(m.position.x), by = Math.floor(m.position.y), bz = Math.floor(m.position.z);
        // 记录方块位置和朝向到放置记忆
        const entry = this.world.getBlockEntry(bx, by, bz);
        if (entry) {
          this.recordRemovedBlock(bx, by, bz, entry.type, entry.orientation);
        }
        this.world.removeBlock(bx, by, bz);
        audioManager.playSound('delete_get', 0.3);
        // 徒手破坏时使用新的破碎特效，否则使用原有粒子特效
        if (isHandBreak) {
          this.world.spawnBlockCrashParticles(m.position);
        } else {
          this.spawnParticles(m.position, type);
        }
        if (m.parent) m.parent.remove(m);
        if (type === 'realistic_trunk') this.inventory.add('wood', 1);
        else if (type === 'realistic_leaves') { if (Math.random() < 0.8) this.inventory.add('leaves', 1); }
        else this.inventory.add(type, 1);
      }
    }
  }

  /**
   * 处理爆炸结果
   * 处理由Worker返回的爆炸计算结果
   * @param {Object} data - 爆炸结果数据
   */
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

      // 新增：TNT爆炸伤害范围内的丧尸
      if (this.game && this.game.enemyManager) {
        const explosionCenter = new THREE.Vector3(center.x + 0.5, center.y + 0.5, center.z + 0.5);
        const explosionRadius = 4; // 爆炸伤害范围（方块单位）
        const explosionDamage = 50; // 爆炸伤害值

        const allZombies = this.game.enemyManager.getAllEnemies();
        for (const zombie of allZombies) {
          const zombiePos = new THREE.Vector3(zombie.position.x, zombie.position.y + zombie.height / 2, zombie.position.z);
          const distance = explosionCenter.distanceTo(zombiePos);

          if (distance <= explosionRadius) {
            // 使用 EnemyManager 的 applyDamageToEnemy 方法，同时更新本地和 Worker 中的血量
            this.game.enemyManager.applyDamageToEnemy(zombie.id, explosionDamage);
            console.log(`[Explosion] 丧尸在爆炸范围内，造成 ${explosionDamage} 点伤害！`);
          }
        }
      }

      this._tempVector.set(center.x + 0.5, center.y + 0.5, center.z + 0.5);
      if (this.world.spawnExplosionParticles) this.world.spawnExplosionParticles(this._tempVector);
      audioManager.playSound('explosion', 0.4);
    }
  }

  /**
   * 引爆TNT
   * 计算并执行TNT爆炸效果
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   */
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

  /**
   * 生成粒子效果
   * 在指定位置生成粒子效果
   * @param {THREE.Vector3} pos - 位置
   * @param {string} type - 粒子类型
   */
  spawnParticles(pos, type) { if (this.world.spawnParticles) this.world.spawnParticles(pos, type); }

  /**
   * 执行天空放置
   * 在视线方向上寻找合适位置放置方块
   * @param {string} type - 方块类型
   */
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

  /**
   * 执行挥臂动作
   * 播放挥臂动画
   */
  swing() { this.swingTime = 10; }

  /**
   * 更新手臂状态
   * 控制玩家第一人称手臂的动画和位置
   * @param {number} dt - 时间步长
   */
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
