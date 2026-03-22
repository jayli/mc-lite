/**
 * Turret.js
 * 炮塔类 - 管理炮塔的检测、瞄准和射击逻辑
 */

import * as THREE from 'three';
import { shortestAngleDiff, lerpAngle, angleTo, distance, normalizeAngle } from '../../utils/MathUtils.js';
import { getBlockProperties } from '../../constants/BlockData.js';

// 炮塔配置常量
export const TURRET_CONFIG = {
  // --- 检测与瞄准 ---
  DETECTION_RANGE: 50,      // 检测范围（格）
  ROTATION_SPEED: Math.PI / 2, // 旋转速度（90度/秒 = π/2 弧度/秒）
  PITCH_SPEED: Math.PI / 3,    // 俯仰角速度（60度/秒）
  FIRE_COOLDOWN: 500,       // 射击冷却时间（毫秒）
  FIRE_ANGLE_THRESHOLD: 0.26, // 射击角度阈值（15度 ≈ 0.26弧度）
  MAX_PITCH_ANGLE: Math.PI / 4, // 最大俯仰角（45度 = π/4 弧度）

  // --- 结构尺寸 ---
  PIVOT_HEIGHT_OFFSET: 3.3,   // 旋转中心高度偏移（相对于底座 position.y）

  // --- 炮塔主体外观（楔形结构） ---
  TURRET_TOWER_SIZE: {
    FRONT: [1.6, 1.2, 0.4],      // 前装甲板 [宽, 高, 深]
    SIDE: [0.8, 1.0, 1.5],       // 侧装甲板 [宽, 高, 深]
    TOP: [1.6, 0.3, 1.5],        // 顶装甲板 [宽, 高, 深]
    BACK: [1.6, 1.2, 0.3],       // 后装甲板 [宽, 高, 深]
  },
  TURRET_TOWER_COLOR: {
    MAIN: 0xcccccc,   // 浅灰色主体
    DARK: 0xbbbbbb,   // 中灰色后板
  },
  TURRET_TOWER_POS: {
    FRONT: [0, -0.2, 0.6],       // 前板相对位置
    LEFT: [-0.8, -0.1, -0.2],    // 左板相对位置
    RIGHT: [0.8, -0.1, -0.2],    // 右板相对位置
    TOP: [0, 0.6, -0.2],         // 顶板相对位置
    BACK: [0, -0.2, -0.95],      // 后板相对位置
  },

  // --- 炮管系统配置 ---
  GUN_BARREL_SIZE: {
    LENGTH: 3.0,           // 炮管长度
    DIAMETER: 0.3,         // 炮管直径
  },
  GUN_ROOT_SIZE: [0.6, 0.6, 0.4],  // 炮管根部尺寸
  GUN_SIGHT_SIZE: [0.3, 0.3, 0.4], // 瞄准器尺寸
  GUN_COLOR: {
    BARREL: 0x222222,      // 黑色炮管
    ROOT: 0xeeeeee,        // 白色根部
    SIGHT: 0x3366cc,       // 蓝色瞄准器
  },
  GUN_POS: {
    BARREL_Z: 2.0,         // 炮管 Z 偏移
    ROOT_Z: 0.5,           // 根部 Z 偏移
    SIGHT_Y: 0.5,          // 瞄准器 Y 偏移
    SIGHT_Z: 0.3,          // 瞄准器 Z 偏移
  },

  // --- 炮口位置（新炮管更长） ---
  MUZZLE_OFFSET_Z: 3.5,    // 炮口在炮管最前端

  // --- 炮弹参数 ---
  PROJECTILE_SPEED: 40,     // 炮弹飞行速度（格/秒）
  MAX_KILL_DISTANCE: 50,    // 炮弹最大飞行距离（格）

  // --- 目标参数 ---
  ENEMY_BODY_OFFSET_Y: 1.2, // 瞄准丧尸上半身的 Y 偏移（胸部位置）
  LOS_SAMPLE_STEP: 0.5,     // 视线采样步长（格）
  LOS_START_EPSILON: 0.1,   // 起点偏移，避免采样到炮塔自身
  LOS_TARGET_EPSILON: 0.35, // 终点容差，避免目标贴身方块误判
  TARGET_REACQUIRE_INTERVAL: 120, // 目标重选间隔（毫秒）
  TARGET_LOS_RECHECK_INTERVAL: 100 // 当前目标 LOS 复查间隔（毫秒）
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

    // 回调
    this.onDestroy = params.onDestroy || null; // 炮塔销毁时的回调

    // 旋转相关 - 使用传入的初始朝向
    const initialRotation = params.initialRotation || 0;
    this.defaultRotation = initialRotation; // 默认朝向（没有目标时的朝向，由放置位置决定）
    this.currentRotation = initialRotation; // 当前 Y 轴旋转角度（偏航角，弧度）
    this.targetRotation = initialRotation;  // 目标 Y 轴旋转角度（偏航角，弧度）
    this.currentPitch = 0;                  // 当前 X 轴旋转角度（俯仰角，弧度）
    this.targetPitch = 0;                   // 目标 X 轴旋转角度（俯仰角，弧度）

    // 目标
    this.targetEnemy = null;

    // 射击相关
    this.lastFireTime = 0;
    this._lastTargetSearchTime = 0;
    this._lastTargetLosCheckTime = 0;

    // 完整性检查降频计数器
    this._integrityCheckCounter = 0;
    this._integrityCheckInterval = 30; // 每 30 帧检查一次（约 0.5 秒）
    this._lastIntegrityResult = true;  // 缓存上次检查结果

    // 结构方块列表（相对坐标）
    this.structureBlocks = this.calculateStructureBlocks();
    this._occlusionTypeCache = new Map();

    // 旋转中心（pivot）位置
    // position.y 是底座下方一格的位置（即放置炮塔的地面层）
    // 方块坐标（下移一格后）:
    //   - iron_ore 底座: worldY = position.y
    //   - obsidian 下: worldY = position.y + 1
    //   - obsidian 上: worldY = position.y + 2
    // pivot 保持在原来的高度，使枪位置与之前一致
    this.pivotPosition = new THREE.Vector3(
      this.position.x + 0.5,
      this.position.y + TURRET_CONFIG.PIVOT_HEIGHT_OFFSET,
      this.position.z + 0.5
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
    // 底座 3x3 iron_ore (world y=position.y)
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        blocks.push(new THREE.Vector3(x, 0, z));
      }
    }
    // obsidian 柱子 (world y=position.y+1, position.y+2)
    blocks.push(new THREE.Vector3(0, 1, 0));
    blocks.push(new THREE.Vector3(0, 2, 0));

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
   * 创建炮塔顶部的楔形结构（替代原来的简单枪造型）
   * 现代化海军炮塔风格：楔形主体 + 细长炮管 + 蓝色瞄准器
   */
  createTurretTopBlocks() {
    console.log(`[Turret ${this.id}] 创建现代化楔形炮塔...`);

    // === 创建炮塔主体（楔形结构） ===

    // 1. 前装甲板（倾斜前表面）
    const frontGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.FRONT);
    const mainMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.TURRET_TOWER_COLOR.MAIN });
    const front = new THREE.Mesh(frontGeometry, mainMaterial);
    front.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.FRONT);
    this.pitchObject.add(front);
    this.turretMeshes.push(front);

    // 2. 左侧装甲板
    const leftGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.SIDE);
    const left = new THREE.Mesh(leftGeometry, mainMaterial);
    left.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.LEFT);
    this.pitchObject.add(left);
    this.turretMeshes.push(left);

    // 3. 右侧装甲板
    const rightGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.SIDE);
    const right = new THREE.Mesh(rightGeometry, mainMaterial);
    right.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.RIGHT);
    this.pitchObject.add(right);
    this.turretMeshes.push(right);

    // 4. 顶部装甲板
    const topGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.TOP);
    const top = new THREE.Mesh(topGeometry, mainMaterial);
    top.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.TOP);
    this.pitchObject.add(top);
    this.turretMeshes.push(top);

    // 5. 后装甲板（深色）
    const backGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.TURRET_TOWER_SIZE.BACK);
    const darkMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.TURRET_TOWER_COLOR.DARK });
    const back = new THREE.Mesh(backGeometry, darkMaterial);
    back.position.set(...TURRET_CONFIG.TURRET_TOWER_POS.BACK);
    this.pitchObject.add(back);
    this.turretMeshes.push(back);

    // === 创建炮管系统 ===

    // 6. 炮管（细长圆柱）
    const barrelGeometry = new THREE.CylinderGeometry(
      TURRET_CONFIG.GUN_BARREL_SIZE.DIAMETER / 2,
      TURRET_CONFIG.GUN_BARREL_SIZE.DIAMETER / 2,
      TURRET_CONFIG.GUN_BARREL_SIZE.LENGTH,
      12
    );
    // 旋转圆柱使其沿 Z 轴延伸
    barrelGeometry.rotateX(Math.PI / 2);
    const barrelMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.GUN_COLOR.BARREL });
    const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
    barrel.position.set(0, 0, TURRET_CONFIG.GUN_POS.BARREL_Z);
    this.pitchObject.add(barrel);
    this.turretMeshes.push(barrel);

    // 7. 炮管根部（白色连接机构）
    const rootGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.GUN_ROOT_SIZE);
    const rootMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.GUN_COLOR.ROOT });
    const root = new THREE.Mesh(rootGeometry, rootMaterial);
    root.position.set(0, 0, TURRET_CONFIG.GUN_POS.ROOT_Z);
    this.pitchObject.add(root);
    this.turretMeshes.push(root);

    // 8. 蓝色瞄准器（光学传感器）
    const sightGeometry = new THREE.BoxGeometry(...TURRET_CONFIG.GUN_SIGHT_SIZE);
    const sightMaterial = new THREE.MeshLambertMaterial({ color: TURRET_CONFIG.GUN_COLOR.SIGHT });
    const sight = new THREE.Mesh(sightGeometry, sightMaterial);
    sight.position.set(0, TURRET_CONFIG.GUN_POS.SIGHT_Y, TURRET_CONFIG.GUN_POS.SIGHT_Z);
    this.pitchObject.add(sight);
    this.turretMeshes.push(sight);

    console.log(`[Turret ${this.id}] 炮塔创建完成: 5个主体部件 + 3个炮管部件`);
  }

  /**
   * 更新炮塔状态
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Array} enemies - 丧尸列表
   */
  update(deltaTime, enemies) {
    if (this.state === 'DESTROYED') return;

    // 自愈：如果视觉节点意外丢失，在炮塔仍存活时自动恢复
    this.ensureVisuals();

    // 降频检查结构完整性
    this._integrityCheckCounter++;
    if (this._integrityCheckCounter >= this._integrityCheckInterval) {
      this._integrityCheckCounter = 0;
      this._lastIntegrityResult = this.checkIntegrity();
    }
    if (!this._lastIntegrityResult) {
      this.destroy();
      return;
    }

    // 寻找目标（带降频与目标保持）
    this.updateTargetSelection(enemies);

    // 旋转瞄准
    this.updateRotation(deltaTime);

    // 尝试射击
    this.tryFire();
  }

  /**
   * 方块查询（优先使用快速路径）
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {string|null}
   */
  getBlockForTurret(x, y, z) {
    if (!this.world) return null;
    if (this.world.getBlockFast) return this.world.getBlockFast(x, y, z);
    return this.world.getBlock ? this.world.getBlock(x, y, z) : null;
  }

  /**
   * 检查指定坐标所属 Chunk 是否已加载且可查询
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isChunkLoadedForPosition(x, z) {
    if (!this.world?.chunks) return false;
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const chunk = this.world.chunks.get(`${cx},${cz}`);
    return !!(chunk && chunk.isReady);
  }

  /**
   * 自愈视觉节点：避免因异常清理导致“炮身消失”
   */
  ensureVisuals() {
    if (this.state === 'DESTROYED' || !this.scene) return;

    const visualsMissing = !this.pivotObject || !this.pitchObject || this.turretMeshes.length === 0;
    if (visualsMissing) {
      if (this.pivotObject?.parent) {
        this.pivotObject.parent.remove(this.pivotObject);
      }
      this.pivotObject = null;
      this.pitchObject = null;
      this.turretMeshes = [];
      this.createVisuals();
      if (this.pivotObject) this.pivotObject.rotation.y = this.currentRotation;
      if (this.pitchObject) this.pitchObject.rotation.x = -this.currentPitch;
      return;
    }

    // 避免节点被外部逻辑移出场景后不再显示
    if (this.pivotObject.parent !== this.scene) {
      this.scene.add(this.pivotObject);
    }
    if (this.pitchObject.parent !== this.pivotObject) {
      this.pivotObject.add(this.pitchObject);
    }
  }

  /**
   * 检查炮塔结构完整性
   * 检查 obsidian 柱子是否完整
   * 方块坐标（下移一格后）:
   *   - obsidian 下: worldY = position.y + 1
   *   - obsidian 上: worldY = position.y + 2
   * @returns {boolean}
   */
  checkIntegrity() {
    // position.y 是底座下方一格的位置
    // obsidian 柱子位于 position.y + 1 和 position.y + 2
    const obsidianWorldX = this.position.x;
    const obsidianWorldZ = this.position.z;

    const criticalBlocks = [
      { x: obsidianWorldX, y: this.position.y + 1, z: obsidianWorldZ, label: 'obsidian下' },
      { x: obsidianWorldX, y: this.position.y + 2, z: obsidianWorldZ, label: 'obsidian上' }
    ];

    for (const worldPos of criticalBlocks) {
      // 关键修复：远离后 Chunk 可能被卸载，未加载状态不应判定为结构损坏
      if (!this.isChunkLoadedForPosition(worldPos.x, worldPos.z)) {
        continue;
      }

      const block = this.getBlockForTurret(worldPos.x, worldPos.y, worldPos.z);
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
    let minDistanceSq = TURRET_CONFIG.DETECTION_RANGE * TURRET_CONFIG.DETECTION_RANGE;

    for (const enemy of enemies) {
      if (!enemy.isActive || enemy.isDead) continue;

      const dx = enemy.position.x - this.pivotPosition.x;
      const dy = enemy.position.y - this.pivotPosition.y;
      const dz = enemy.position.z - this.pivotPosition.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq >= minDistanceSq) continue;
      if (!this.hasLineOfSightToEnemy(enemy)) continue;

      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        nearestEnemy = enemy;
      }
    }

    this.targetEnemy = nearestEnemy;

    // 计算目标旋转角度（偏航角和俯仰角）
    if (this.targetEnemy) {
      // 瞄准丧尸的上半身（胸部位置）
      const targetPos = {
        x: this.targetEnemy.position.x,
        y: this.targetEnemy.position.y + TURRET_CONFIG.ENEMY_BODY_OFFSET_Y,
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
      // 没有目标时恢复到默认朝向（由放置位置决定）
      this.targetRotation = this.defaultRotation;
      this.targetPitch = 0;
    }
  }

  /**
   * 更新目标选择（降低每帧全量 LOS 计算开销）
   * @param {Array} enemies - 丧尸列表
   */
  updateTargetSelection(enemies) {
    const now = Date.now();
    const hasEnemies = Array.isArray(enemies) && enemies.length > 0;
    const hasTarget = !!this.targetEnemy;

    if (hasTarget) {
      if (!this.targetEnemy.isActive || this.targetEnemy.isDead) {
        this.targetEnemy = null;
      } else {
        const dx = this.targetEnemy.position.x - this.pivotPosition.x;
        const dy = this.targetEnemy.position.y - this.pivotPosition.y;
        const dz = this.targetEnemy.position.z - this.pivotPosition.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const rangeSq = TURRET_CONFIG.DETECTION_RANGE * TURRET_CONFIG.DETECTION_RANGE;
        if (distSq > rangeSq) {
          this.targetEnemy = null;
        } else if (now - this._lastTargetLosCheckTime >= TURRET_CONFIG.TARGET_LOS_RECHECK_INTERVAL) {
          this._lastTargetLosCheckTime = now;
          if (!this.hasLineOfSightToEnemy(this.targetEnemy)) {
            this.targetEnemy = null;
          }
        }
      }
    }

    // 场上没有丧尸时，不进行目标扫描，避免空转开销
    if (!hasEnemies) {
      if (!this.targetEnemy) {
        this.targetRotation = this.defaultRotation;
        this.targetPitch = 0;
      }
      return;
    }

    // 有目标时：仅在达到重选间隔后才允许切换目标
    // 无目标时：同样按重选间隔扫描，避免每帧全量 LOS
    if (now - this._lastTargetSearchTime >= TURRET_CONFIG.TARGET_REACQUIRE_INTERVAL) {
      this.findTarget(enemies);
      this._lastTargetSearchTime = now;
      this._lastTargetLosCheckTime = now;
    } else if (!this.targetEnemy) {
      // 没有目标但尚未到重选时间，维持默认朝向
      this.targetRotation = this.defaultRotation;
      this.targetPitch = 0;
    } else {
      // 保持当前目标时也需要持续刷新瞄准角
      const targetPos = {
        x: this.targetEnemy.position.x,
        y: this.targetEnemy.position.y + TURRET_CONFIG.ENEMY_BODY_OFFSET_Y,
        z: this.targetEnemy.position.z
      };
      this.targetRotation = angleTo(this.pivotPosition, targetPos);
      const dx = targetPos.x - this.pivotPosition.x;
      const dy = targetPos.y - this.pivotPosition.y;
      const dz = targetPos.z - this.pivotPosition.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);
      let pitch = Math.atan2(dy, horizontalDist);
      pitch = Math.max(-TURRET_CONFIG.MAX_PITCH_ANGLE, Math.min(TURRET_CONFIG.MAX_PITCH_ANGLE, pitch));
      this.targetPitch = pitch;
    }
  }

  /**
   * 判断方块类型是否会阻挡炮塔视线
   * @param {string|null} blockType - 方块类型
   * @returns {boolean}
   */
  isBlockOccluding(blockType) {
    if (!blockType || blockType === 'air') return false;
    const cached = this._occlusionTypeCache.get(blockType);
    if (cached !== undefined) return cached;

    const props = getBlockProperties(blockType);
    const result = props.isSolid && !props.isTransparent;
    this._occlusionTypeCache.set(blockType, result);
    return result;
  }

  /**
   * 判断炮塔到敌人是否有无遮挡视线
   * 规则：仅“实心且不透明”方块会阻挡；未加载区块（null）视为无遮挡
   * @param {Object} enemy - 丧尸对象
   * @returns {boolean}
   */
  hasLineOfSightToEnemy(enemy) {
    if (!enemy || !enemy.position || !this.world || !this.world.getBlock) return false;

    const targetX = enemy.position.x;
    const targetY = enemy.position.y + TURRET_CONFIG.ENEMY_BODY_OFFSET_Y;
    const targetZ = enemy.position.z;

    const dx = targetX - this.pivotPosition.x;
    const dy = targetY - this.pivotPosition.y;
    const dz = targetZ - this.pivotPosition.z;
    const totalDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 目标极近时直接视为可见
    if (totalDistance <= TURRET_CONFIG.LOS_START_EPSILON) {
      return true;
    }

    const dirX = dx / totalDistance;
    const dirY = dy / totalDistance;
    const dirZ = dz / totalDistance;

    const startDistance = TURRET_CONFIG.LOS_START_EPSILON;
    const endDistance = Math.max(startDistance, totalDistance - TURRET_CONFIG.LOS_TARGET_EPSILON);
    const step = TURRET_CONFIG.LOS_SAMPLE_STEP;

    let lastX = Number.NaN;
    let lastY = Number.NaN;
    let lastZ = Number.NaN;

    for (let d = startDistance; d <= endDistance; d += step) {
      const sx = this.pivotPosition.x + dirX * d;
      const sy = this.pivotPosition.y + dirY * d;
      const sz = this.pivotPosition.z + dirZ * d;

      const bx = Math.floor(sx);
      const by = Math.floor(sy);
      const bz = Math.floor(sz);

      // 采样步长可能在同一体素内重复，跳过重复查询
      if (bx === lastX && by === lastY && bz === lastZ) continue;
      lastX = bx;
      lastY = by;
      lastZ = bz;

      const block = this.getBlockForTurret(bx, by, bz);
      if (this.isBlockOccluding(block)) {
        return false;
      }
    }

    return true;
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

    // 射击瞬间复核 LOS，确保不对遮挡目标开火
    if (!this.hasLineOfSightToEnemy(this.targetEnemy)) {
      this.targetEnemy = null;
      this.targetRotation = this.defaultRotation;
      this.targetPitch = 0;
      return;
    }

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

    // 计算炮口位置（枪口在 MUZZLE_OFFSET_Z 处）
    // 注意：visualRotationX = -this.currentPitch 才是实际的旋转角度
    const visualRotationX = -this.currentPitch;
    const barrelOffset = new THREE.Vector3(0, 0, TURRET_CONFIG.MUZZLE_OFFSET_Z);
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

    // 通知管理器移除自己
    if (this.onDestroy) {
      this.onDestroy(this.id);
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
