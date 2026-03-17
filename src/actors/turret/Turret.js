/**
 * Turret.js
 * 炮塔类 - 管理炮塔的检测、瞄准和射击逻辑
 */

import * as THREE from 'three';
import { shortestAngleDiff, lerpAngle, angleTo, distance, normalizeAngle } from '../../utils/MathUtils.js';

// 炮塔配置常量
const TURRET_CONFIG = {
  DETECTION_RANGE: 50,      // 检测范围（格）
  ROTATION_SPEED: Math.PI / 2, // 旋转速度（90度/秒 = π/2 弧度/秒）
  PITCH_SPEED: Math.PI / 3,    // 俯仰角速度（60度/秒）
  FIRE_COOLDOWN: 500,       // 射击冷却时间（毫秒）
  FIRE_ANGLE_THRESHOLD: 0.26, // 射击角度阈值（15度 ≈ 0.26弧度）
  MAX_PITCH_ANGLE: Math.PI / 4, // 最大俯仰角（45度 = π/4 弧度）
};

export class Turret {
  /**
   * @param {Object} params - 初始化参数
   * @param {string} params.id - 唯一标识符
   * @param {THREE.Vector3} params.position - 炮塔位置（方块坐标）
   * @param {World} params.world - 世界引用
   * @param {THREE.Scene} params.scene - Three.js 场景
   * @param {Function} params.onFire - 射击回调
   */
  constructor(params) {
    this.id = params.id;
    this.position = params.position.clone();
    this.world = params.world;
    this.scene = params.scene;
    this.onFire = params.onFire || null;

    // 状态
    this.state = 'ACTIVE'; // 'ACTIVE' | 'DESTROYED'

    // 旋转相关
    this.currentRotation = 0; // 当前 Y 轴旋转角度（偏航角，弧度）
    this.targetRotation = 0;  // 目标 Y 轴旋转角度（偏航角，弧度）
    this.currentPitch = 0;    // 当前 X 轴旋转角度（俯仰角，弧度）
    this.targetPitch = 0;     // 目标 X 轴旋转角度（俯仰角，弧度）

    // 目标
    this.targetEnemy = null;

    // 射击相关
    this.lastFireTime = 0;

    // 结构方块列表（相对坐标）
    this.structureBlocks = this.calculateStructureBlocks();

    // 旋转中心（pivot）位置 - obsidian 柱子顶端
    // 根据 turret.json 结构，最上层 obsidian 在相对坐标 (0, 3, 0)
    // StructureLoader.generateBlocks: worldX = x + block.x (block.x 已归一化)
    // turret.json 中 x/z 范围是 -1,0,1，y 归一化后范围是 1,2,3
    // obsidian 上 (0,3,0): worldX = position.x + 0, worldY = position.y + (3-1), worldZ = position.z + 0
    this.pivotPosition = new THREE.Vector3(
      this.position.x + 0.5,      // jsonX=0 → +0
      this.position.y + 3.2,  // jsonY=3 → +2 (bottomY=1)
      this.position.z + 0.5       // jsonZ=0 → +0
    );

    // Three.js 对象
    this.pivotObject = null; // 旋转节点（Y轴 - 偏航角）
    this.pitchObject = null; // 俯仰节点（X轴 - 俯仰角）
    this.turretMeshes = [];  // 炮塔顶部的4个方块 Mesh

    // 初始化视觉表现
    this.createVisuals();
  }

  /**
   * 计算炮塔结构的所有方块相对坐标
   * @returns {Array<THREE.Vector3>}
   */
  calculateStructureBlocks() {
    const blocks = [];
    // 底座 3x3 iron_ore (y=1, x/z: -1,0,1)
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        blocks.push(new THREE.Vector3(x, 1, z));
      }
    }
    // obsidian 柱子 (y=2,3, x=0, z=0)
    blocks.push(new THREE.Vector3(0, 2, 0));
    blocks.push(new THREE.Vector3(0, 3, 0));

    return blocks;
  }

  /**
   * 创建炮塔的视觉表现
   */
  createVisuals() {
    console.log(`[Turret ${this.id}] 创建视觉表现，pivot位置:`, this.pivotPosition);

    // 创建外部旋转节点（pivot）- 负责 Y 轴偏航角旋转
    this.pivotObject = new THREE.Object3D();
    this.pivotObject.position.copy(this.pivotPosition);
    this.scene.add(this.pivotObject);

    // 创建内部俯仰节点（pitch）- 负责 X 轴俯仰角旋转
    this.pitchObject = new THREE.Object3D();
    this.pivotObject.add(this.pitchObject);

    // 创建炮塔顶部的枪
    this.createTurretTopBlocks();

    console.log(`[Turret ${this.id}] 视觉表现创建完成，mesh数量:`, this.turretMeshes.length);
  }

  /**
   * 创建炮塔顶部的枪（替代原来的 iron + horizontal_pillar 4个方块）
   * 以 obsidian 柱子顶端为旋转中心，枪从中心向前后延伸
   */
  createTurretTopBlocks() {
    console.log(`[Turret ${this.id}] 创建枪的 mesh...`);

    // 枪把（后方）- 模拟原来 iron 方块的体积
    const handleGeometry = new THREE.BoxGeometry(0.8, 0.8, 2);
    const handleMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 });

    const handle = new THREE.Mesh(handleGeometry, handleMaterial);
    handle.position.set(0, 0, -0.5); // 后方延伸
    this.pitchObject.add(handle);
    this.turretMeshes.push(handle);

    // 枪管（前方）- 更细长的枪管
    const barrelGeometry = new THREE.BoxGeometry(0.4, 0.4, 2.5);
    const barrelMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });

    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.position.set(0, 0, 1.75); // 前方延伸
    this.pitchObject.add(barrel);
    this.turretMeshes.push(barrel);

    // 枪口装饰
    const muzzleGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.3);
    const muzzleMaterial = new THREE.MeshLambertMaterial({ color: 0x222222 });

    const muzzle = new THREE.Mesh(muzzleGeometry, muzzleMaterial);
    muzzle.position.set(0, 0, 3.1); // 枪口
    this.pitchObject.add(muzzle);
    this.turretMeshes.push(muzzle);

    console.log(`[Turret ${this.id}] 枪创建完成: 枪把+枪管+枪口`);
  }

  /**
   * 更新炮塔状态
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Array} enemies - 丧尸列表
   */
  update(deltaTime, enemies) {
    if (this.state === 'DESTROYED') return;

    // 检查结构完整性
    if (!this.checkIntegrity()) {
      this.destroy();
      return;
    }

    // 寻找目标
    this.findTarget(enemies);

    // 旋转瞄准
    this.updateRotation(deltaTime);

    // 尝试射击
    this.tryFire();

    // 调试：每60帧输出一次状态
    this._debugFrame = (this._debugFrame || 0) + 1;
    if (this._debugFrame % 60 === 0) {
      console.log(`[Turret ${this.id}] 敌人数量: ${enemies?.length || 0}, 目标: ${this.targetEnemy ? '有' : '无'}, 旋转: ${this.currentRotation.toFixed(2)}`);
    }
  }

  /**
   * 检查炮塔结构完整性
   * 检查 obsidian 柱子是否完整
   * 注意：StructureLoader.generateBlocks: worldX = x + block.x, worldY = y + (block.y - bottomY)
   * turret.json 中 bottomY=1，所以 worldY = position.y + block.y - 1
   * @returns {boolean}
   */
  checkIntegrity() {
    // obsidian 柱子在 JSON 中是 (0, 2, 0) 和 (0, 3, 0)
    // block.x=0, block.z=0，所以 worldX = position.x, worldZ = position.z
    // worldY = position.y + block.y - 1
    //   - block.y=2 (obsidian下): worldY = position.y + 1
    //   - block.y=3 (obsidian上): worldY = position.y + 2
    const obsidianWorldX = this.position.x;
    const obsidianWorldZ = this.position.z;

    const criticalBlocks = [
      { x: obsidianWorldX, y: this.position.y + 1, z: obsidianWorldZ, label: 'obsidian下' },
      { x: obsidianWorldX, y: this.position.y + 2, z: obsidianWorldZ, label: 'obsidian上' }
    ];

    for (const worldPos of criticalBlocks) {
      const block = this.world.getBlock(worldPos.x, worldPos.y, worldPos.z);
      // 首次检查或调试时输出
      if (this._firstIntegrityCheck === undefined) {
        console.log(`[Turret ${this.id}] 检查 ${worldPos.label} (${worldPos.x},${worldPos.y},${worldPos.z}): ${block || 'air'}`);
      }
      if (!block || block === 'air') {
        if (this._firstIntegrityCheck === undefined) {
          console.log(`[Turret ${this.id}] 完整性检查失败: ${worldPos.label} 缺失`);
          this._firstIntegrityCheck = false;
        }
        return false;
      }
    }
    if (this._firstIntegrityCheck === undefined) {
      console.log(`[Turret ${this.id}] 完整性检查通过`);
      this._firstIntegrityCheck = true;
    }
    return true;
  }

  /**
   * 寻找最近的丧尸作为目标
   * @param {Array} enemies - 丧尸列表
   */
  findTarget(enemies) {
    let nearestEnemy = null;
    let minDistance = TURRET_CONFIG.DETECTION_RANGE;

    for (const enemy of enemies) {
      if (!enemy.isActive || enemy.isDead) continue;

      const dist = distance(this.pivotPosition, enemy.position);
      if (dist < minDistance) {
        minDistance = dist;
        nearestEnemy = enemy;
      }
    }

    this.targetEnemy = nearestEnemy;

    // 计算目标旋转角度（偏航角和俯仰角）
    if (this.targetEnemy) {
      // 瞄准丧尸的上半身（胸部位置），而不是脚底
      // 丧尸 height=1.8，上半身中心大约在 y + 1.2 处
      const targetPos = {
        x: this.targetEnemy.position.x,
        y: this.targetEnemy.position.y + 1.2,
        z: this.targetEnemy.position.z
      };

      // 计算水平方向的偏航角（Y轴旋转）
      this.targetRotation = angleTo(this.pivotPosition, targetPos);

      // 计算垂直方向的俯仰角（X轴旋转）
      const dx = targetPos.x - this.pivotPosition.x;
      const dy = targetPos.y - this.pivotPosition.y;
      const dz = targetPos.z - this.pivotPosition.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);

      // 计算俯仰角并限制在 ±45° 范围内
      let pitch = Math.atan2(dy, horizontalDist);
      pitch = Math.max(-TURRET_CONFIG.MAX_PITCH_ANGLE, Math.min(TURRET_CONFIG.MAX_PITCH_ANGLE, pitch));
      this.targetPitch = pitch;
    } else {
      // 没有目标时恢复到默认朝向（0度）
      this.targetRotation = 0;
      this.targetPitch = 0;
    }
  }

  /**
   * 更新旋转（平滑转向目标）
   * @param {number} deltaTime - 时间增量（秒）
   */
  updateRotation(deltaTime) {
    // ---- 更新偏航角（Y轴旋转）----
    const angleDiff = shortestAngleDiff(this.currentRotation, this.targetRotation);
    const maxRotation = TURRET_CONFIG.ROTATION_SPEED * deltaTime;
    const rotationStep = Math.max(-maxRotation, Math.min(maxRotation, angleDiff));

    this.currentRotation += rotationStep;
    this.currentRotation = normalizeAngle(this.currentRotation);

    // ---- 更新俯仰角（X轴旋转）----
    const pitchDiff = this.targetPitch - this.currentPitch;
    const maxPitch = TURRET_CONFIG.PITCH_SPEED * deltaTime;
    const pitchStep = Math.max(-maxPitch, Math.min(maxPitch, pitchDiff));

    this.currentPitch += pitchStep;
    // 限制俯仰角在范围内（双重保险）
    this.currentPitch = Math.max(-TURRET_CONFIG.MAX_PITCH_ANGLE, Math.min(TURRET_CONFIG.MAX_PITCH_ANGLE, this.currentPitch));

    // 更新视觉表现（注意：取反俯仰角，因为Three.js旋转方向与atan2结果相反）
    if (this.pivotObject) {
      this.pivotObject.rotation.y = this.currentRotation;
    }
    if (this.pitchObject) {
      this.pitchObject.rotation.x = -this.currentPitch;
    }
  }

  /**
   * 尝试射击
   */
  tryFire() {
    // 检查是否有目标
    if (!this.targetEnemy) return;

    // 检查冷却
    const now = Date.now();
    if (now - this.lastFireTime < TURRET_CONFIG.FIRE_COOLDOWN) return;

    // 检查偏航角是否对准（夹角 < 15度）
    const yawDiff = Math.abs(shortestAngleDiff(this.currentRotation, this.targetRotation));
    if (yawDiff > TURRET_CONFIG.FIRE_ANGLE_THRESHOLD) return;

    // 检查俯仰角是否对准（夹角 < 15度）
    const pitchDiff = Math.abs(this.currentPitch - this.targetPitch);
    if (pitchDiff > TURRET_CONFIG.FIRE_ANGLE_THRESHOLD) return;

    // 发射！
    this.fire();
  }

  /**
   * 发射炮弹
   */
  fire() {
    this.lastFireTime = Date.now();

    // 计算炮口位置（枪口在 z=3.1 处）
    // 注意：visualRotationX = -this.currentPitch 才是实际的旋转角度
    const visualRotationX = -this.currentPitch;
    const barrelOffset = new THREE.Vector3(0, 0, 3.1);
    barrelOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), visualRotationX);  // 俯仰角（X轴）
    barrelOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.currentRotation); // 偏航角（Y轴）
    const muzzlePosition = new THREE.Vector3().copy(this.pivotPosition).add(barrelOffset);

    // 计算发射方向（必须与视觉旋转一致）
    const direction = new THREE.Vector3(0, 0, 1);
    direction.applyAxisAngle(new THREE.Vector3(1, 0, 0), visualRotationX);  // 俯仰角（X轴）
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.currentRotation); // 偏航角（Y轴）

    // 调用回调
    if (this.onFire) {
      this.onFire({
        position: muzzlePosition,
        direction: direction,
        turretId: this.id
      });
    }
  }

  /**
   * 销毁炮塔
   */
  destroy() {
    if (this.state === 'DESTROYED') return;

    this.state = 'DESTROYED';
    this.targetEnemy = null;

    // 恢复默认朝向
    this.targetRotation = 0;
    this.targetPitch = 0;
    if (this.pivotObject) {
      this.pivotObject.rotation.y = 0;
    }
    if (this.pitchObject) {
      this.pitchObject.rotation.x = 0;
    }

    // 清理视觉表现
    if (this.pivotObject) {
      this.scene.remove(this.pivotObject);
      this.turretMeshes.forEach(mesh => {
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      });
      this.turretMeshes = [];
      this.pitchObject = null;
      this.pivotObject = null;
    }
  }

  /**
   * 获取炮塔当前状态
   * @returns {Object}
   */
  getState() {
    return {
      id: this.id,
      state: this.state,
      position: this.position,
      rotation: this.currentRotation,
      pitch: this.currentPitch,
      hasTarget: !!this.targetEnemy,
      targetDistance: this.targetEnemy ? distance(this.pivotPosition, this.targetEnemy.position) : null
    };
  }
}
