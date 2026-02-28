/**
 * 丧尸实体类
 *
 * 符合 Minecraft 原版风格的敌人实体，具有以下特性：
 * - 尺寸：约 1x1x2 方块单位（宽 x 深 x 高）
 * - 行为：追踪玩家、碰撞检测、生命值管理
 * - 物理模拟：重力、碰撞检测、自动跳跃
 *
 * 渲染说明：
 * 实际渲染由 ZombieInstancedRenderer 处理，此类仅维护逻辑状态。
 * AI 决策由 EnemyWorker 在 Web Worker 中异步处理。
 */
import * as THREE from 'three';
import { getBlockProperties } from '../../constants/BlockData.js';

// ============================================================================
// 配置参数
// ============================================================================

/**
 * 丧尸物理属性配置
 */
const PHYSICS_CONFIG = {
  /** 碰撞箱宽度（方块单位） */
  width: 0.6,
  /** 碰撞箱高度（方块单位） */
  height: 1.8,
  /** 移动速度（方块/帧） */
  speed: 0.02,
  /** 感知范围（方块） */
  perceptionRange: 50,
  /** 碰撞检测安全距离（防止穿模） */
  collisionPadding: 0.2,
  /** 重力加速度 */
  gravity: 0.08,
  /** 跳跃初速度 */
  jumpVelocity: 0.4,
  /** 台阶抬升速度 */
  stepUpSpeed: 0.2,
  /** 地面检测深度（向下探测的方块数） */
  groundCheckDepth: 4
};

/**
 * 生命值配置
 */
const HEALTH_CONFIG = {
  /** 初始生命值 */
  initialHealth: 100,
  /** 最大生命值 */
  maxHealth: 100
};

/**
 * 受伤闪烁配置
 */
const FLASH_CONFIG = {
  /** 闪烁持续时间（毫秒） */
  duration: 200
};

/**
 * 丧尸状态枚举
 */
const ZOMBIE_STATES = {
  /** 空闲状态 - 未检测到玩家 */
  IDLE: 'idle',
  /** 追逐状态 - 正在追踪玩家 */
  CHASING: 'chasing',
  /** 死亡状态 */
  DEAD: 'dead'
};

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 判断方块是否为障碍物（固态方块）
 *
 * @param {string} blockType - 方块类型标识符
 * @returns {boolean} 是否为障碍物
 */
function isObstacle(blockType) {
  if (!blockType) return false;
  return getBlockProperties(blockType).isSolid;
}

// ============================================================================
// 丧尸实体类
// ============================================================================

/**
 * 丧尸实体类
 *
 * 维护丧尸的状态和行为，包括：
 * - 位置、速度、旋转
 * - 生命值和状态
 * - 物理模拟（重力、碰撞、跳跃）
 * - 受伤反馈
 */
export class Zombie {
  /**
   * 构造函数
   * @param {Object} position - 初始位置 {x, y, z}
   */
  constructor(position = { x: 0, y: 0, z: 0 }) {
    // =======================================================================
    // 基础属性
    // =======================================================================

    /** 位置坐标（世界坐标） */
    this.position = { ...position };

    /** 速度向量 */
    this.velocity = { x: 0, y: 0, z: 0 };

    /** 旋转角度（弧度） */
    this.rotation = { x: 0, y: 0, z: 0 };

    // =======================================================================
    // 物理属性
    // =======================================================================

    /** 碰撞箱宽度 */
    this.width = PHYSICS_CONFIG.width;

    /** 碰撞箱高度 */
    this.height = PHYSICS_CONFIG.height;

    /** 移动速度 */
    this.speed = PHYSICS_CONFIG.speed;

    /** 感知范围 */
    this.perceptionRange = PHYSICS_CONFIG.perceptionRange;

    // =======================================================================
    // 状态属性
    // =======================================================================

    /** 当前生命值 */
    this.health = HEALTH_CONFIG.initialHealth;

    /** 最大生命值 */
    this.maxHealth = HEALTH_CONFIG.maxHealth;

    /** 当前状态 */
    this.state = ZOMBIE_STATES.IDLE;

    /** 存活标记 */
    this.isAlive = true;

    /** 唯一标识符 */
    this.id = THREE.MathUtils.generateUUID();

    /** 目标（玩家引用，由外部设置） */
    this.target = null;

    // =======================================================================
    // 视觉状态
    // =======================================================================

    /** 受伤闪烁标记 */
    this.isFlashing = false;

    /** 闪烁超时句柄 */
    this.flashTimeout = null;

    // =======================================================================
    // 逻辑容器（用于兼容性）
    // =======================================================================

    /** 创建逻辑容器网格 */
    this.mesh = this.createZombieMesh();
  }

  // --------------------------------------------------------------------------
  // 初始化方法
  // --------------------------------------------------------------------------

  /**
   * 创建丧尸逻辑容器
   *
   * 注意：为了性能优化，实际渲染由 ZombieInstancedRenderer 处理。
   * 此处返回一个空的 Group 用于逻辑兼容和位置追踪。
   *
   * @returns {THREE.Group} 逻辑容器 Group
   */
  createZombieMesh() {
    const group = new THREE.Group();

    // 设置元数据标记，便于射线检测识别
    group.userData = {
      type: 'zombie',
      isZombie: true,
      zombieId: this.id
    };

    // 设置初始位置
    group.position.set(this.position.x, this.position.y, this.position.z);

    return group;
  }

  // --------------------------------------------------------------------------
  // 速度控制
  // --------------------------------------------------------------------------

  /**
   * 设置期望速度
   *
   * 由 Worker 计算得出的移动速度，包含 AI 寻路和排斥力。
   * 同时更新丧尸朝向。
   *
   * @param {number} vx - X 轴速度分量
   * @param {number} vz - Z 轴速度分量
   */
  setDesiredVelocity(vx, vz) {
    this.velocity.x = vx;
    this.velocity.z = vz;

    // 更新朝向（Y 轴旋转），仅在移动时更新
    if (Math.abs(this.velocity.x) > 0.001 || Math.abs(this.velocity.z) > 0.001) {
      this.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
      this.mesh.rotation.y = this.rotation.y;
    }
  }

  // --------------------------------------------------------------------------
  // 物理更新
  // --------------------------------------------------------------------------

  /**
   * 物理更新 - 主线程执行
   *
   * 处理碰撞检测、重力、自动跳跃等物理行为。
   * 注意：AI 速度计算和排斥力已在 Worker 中完成。
   *
   * @param {Function} getBlockFunc - 获取方块的函数，签名：getBlockFunc(x, y, z) => blockType
   * @param {number} dt - 时间步长（秒），默认约 60 FPS
   */
  update(getBlockFunc, dt = 0.016) {
    if (!this.isAlive) return;

    // 提取速度分量
    const { velocityX, velocityZ } = this.extractVelocityComponents();

    // 预测下一步位置
    let { nextX, nextZ } = this.predictNextPosition(velocityX, velocityZ);

    // 碰撞检测
    const collisionResult = this.checkCollisions(
      nextX, nextZ, velocityX, velocityZ, getBlockFunc
    );
    nextX = collisionResult.nextX;
    nextZ = collisionResult.nextZ;

    // 更新水平位置
    this.position.x = nextX;
    this.position.z = nextZ;

    // 地面检测与重力处理
    this.handleGroundAndGravity(getBlockFunc);

    // 自动跳跃处理
    this.handleAutoJump(velocityX, velocityZ, getBlockFunc);

    // 同步网格位置
    this.syncMeshPosition();
  }

  /**
   * 提取速度分量
   * @returns {Object} 速度分量 {velocityX, velocityZ}
   */
  extractVelocityComponents() {
    return {
      velocityX: this.velocity.x,
      velocityZ: this.velocity.z
    };
  }

  /**
   * 预测下一步位置
   * @param {number} velocityX - X 轴速度
   * @param {number} velocityZ - Z 轴速度
   * @returns {Object} 预测位置 {nextX, nextZ}
   */
  predictNextPosition(velocityX, velocityZ) {
    return {
      nextX: this.position.x + velocityX,
      nextZ: this.position.z + velocityZ
    };
  }

  /**
   * 碰撞检测
   *
   * @param {number} nextX - 预测的 X 坐标
   * @param {number} nextZ - 预测的 Z 坐标
   * @param {number} velocityX - X 轴速度
   * @param {number} velocityZ - Z 轴速度
   * @param {Function} getBlockFunc - 获取方块的函数
   * @returns {Object} 修正后的位置 {nextX, nextZ}
   */
  checkCollisions(nextX, nextZ, velocityX, velocityZ, getBlockFunc) {
    const pY = Math.floor(this.position.y);
    const checkRadius = this.width / 2 + PHYSICS_CONFIG.collisionPadding;

    // X 轴碰撞检测
    if (Math.abs(velocityX) > 0) {
      const collisionX = this.checkAxisCollision(
        nextX, this.position.z,
        velocityX, 0,
        pY, checkRadius, getBlockFunc
      );
      if (collisionX) {
        this.velocity.x = 0;
        nextX = this.position.x;
      }
    }

    // Z 轴碰撞检测
    if (Math.abs(velocityZ) > 0) {
      const collisionZ = this.checkAxisCollision(
        this.position.x, nextZ,
        0, velocityZ,
        pY, checkRadius, getBlockFunc
      );
      if (collisionZ) {
        this.velocity.z = 0;
        nextZ = this.position.z;
      }
    }

    return { nextX, nextZ };
  }

  /**
   * 检测单轴碰撞
   *
   * @param {number} x - X 坐标
   * @param {number} z - Z 坐标
   * @param {number} velocityX - X 轴速度（其中一个为 0）
   * @param {number} velocityZ - Z 轴速度（其中一个为 0）
   * @param {number} pY - 丧尸脚部 Y 坐标（取整）
   * @param {number} checkRadius - 检测半径
   * @param {Function} getBlockFunc - 获取方块的函数
   * @returns {boolean} 是否发生碰撞
   */
  checkAxisCollision(x, z, velocityX, velocityZ, pY, checkRadius, getBlockFunc) {
    // 计算检测范围
    let wallPos, minPos, maxPos;
    if (velocityX !== 0) {
      // X 轴移动检测
      wallPos = Math.floor(x + Math.sign(velocityX) * checkRadius);
      minPos = Math.floor(z - checkRadius);
      maxPos = Math.floor(z + checkRadius);
    } else {
      // Z 轴移动检测
      wallPos = Math.floor(z + Math.sign(velocityZ) * checkRadius);
      minPos = Math.floor(x - checkRadius);
      maxPos = Math.floor(x + checkRadius);
    }

    // 检测碰撞箱范围内的所有方块
    for (let i = minPos; i <= maxPos; i++) {
      const blockX = velocityX !== 0 ? wallPos : i;
      const blockZ = velocityZ !== 0 ? wallPos : i;

      // 检查头部高度（pY + 1）是否有障碍
      if (isObstacle(getBlockFunc(blockX, pY + 1, blockZ))) {
        return true;
      }
    }

    return false;
  }

  /**
   * 地面检测与重力处理
   *
   * @param {Function} getBlockFunc - 获取方块的函数
   */
  handleGroundAndGravity(getBlockFunc) {
    // 向下探测地面
    const groundY = this.findGround(getBlockFunc);

    // 处理陷入方块的情况（台阶抬升）
    const adjustedGroundY = this.handleStepUp(groundY, getBlockFunc);

    // 应用重力或抬升
    this.applyGravityOrStepUp(adjustedGroundY);
  }

  /**
   * 向下探测地面
   *
   * @param {Function} getBlockFunc - 获取方块的函数
   * @returns {number} 地面高度（方块顶面），未找到返回 -100
   */
  findGround(getBlockFunc) {
    let groundY = -100;
    const startX = Math.floor(this.position.x);
    const startZ = Math.floor(this.position.z);

    // 从当前位置向下探测
    for (let y = Math.ceil(this.position.y); y >= Math.floor(this.position.y) - PHYSICS_CONFIG.groundCheckDepth; y--) {
      if (isObstacle(getBlockFunc(startX, y, startZ))) {
        groundY = y + 1; // 地面高度 = 方块顶面
        break;
      }
    }

    return groundY;
  }

  /**
   * 处理台阶抬升
   *
   * 如果丧尸陷入方块内部，自动抬升到方块上方。
   *
   * @param {number} groundY - 当前检测到的地面高度
   * @param {Function} getBlockFunc - 获取方块的函数
   * @returns {number} 调整后的地面高度
   */
  handleStepUp(groundY, getBlockFunc) {
    const currentBlockY = Math.floor(this.position.y);
    const startX = Math.floor(this.position.x);
    const startZ = Math.floor(this.position.z);

    // 检查是否陷入方块
    if (isObstacle(getBlockFunc(startX, currentBlockY, startZ))) {
      // 检查上方是否有空间
      if (!isObstacle(getBlockFunc(startX, currentBlockY + 1, startZ))) {
        return currentBlockY + 1;
      }
    }

    return groundY;
  }

  /**
   * 应用重力或台阶抬升
   *
   * @param {number} groundY - 地面高度
   */
  applyGravityOrStepUp(groundY) {
    if (this.position.y > groundY) {
      // 在空中：应用重力
      this.velocity.y -= PHYSICS_CONFIG.gravity;
      this.position.y += this.velocity.y;

      // 落地检测
      if (this.position.y < groundY) {
        this.position.y = groundY;
        this.velocity.y = 0;
      }
    } else if (this.position.y < groundY) {
      // 需要抬升：平滑上台阶
      this.position.y += PHYSICS_CONFIG.stepUpSpeed;
      if (this.position.y > groundY) {
        this.position.y = groundY;
      }
      this.velocity.y = 0;
    }
  }

  /**
   * 处理自动跳跃
   *
   * 当前方有障碍但上方有空间时，尝试跳上台阶。
   *
   * @param {number} velocityX - X 轴速度
   * @param {number} velocityZ - Z 轴速度
   * @param {Function} getBlockFunc - 获取方块的函数
   */
  handleAutoJump(velocityX, velocityZ, getBlockFunc) {
    // 仅在移动且在地面上时检测
    if (Math.abs(velocityX) <= 0 && Math.abs(velocityZ) <= 0) return;
    if (this.position.y > Math.floor(this.position.y) + 0.1) return;

    // 检测前方方块
    const frontX = Math.floor(this.position.x + velocityX * 2);
    const frontZ = Math.floor(this.position.z + velocityZ * 2);
    const eyeY = Math.floor(this.position.y) + 1; // 眼睛高度

    const blockFront = getBlockFunc(frontX, eyeY, frontZ);
    const blockAbove = getBlockFunc(frontX, eyeY + 1, frontZ);

    // 前方有障碍但上方空闲：尝试跳跃
    if (isObstacle(blockFront) && !isObstacle(blockAbove)) {
      this.velocity.y = PHYSICS_CONFIG.jumpVelocity;
      this.position.y += 0.1; // 稍微抬起以触发重力循环
    }
  }

  /**
   * 同步网格位置
   */
  syncMeshPosition() {
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
  }

  // --------------------------------------------------------------------------
  // 伤害与死亡
  // --------------------------------------------------------------------------

  /**
   * 应用伤害
   *
   * @param {number} damage - 伤害值
   */
  takeDamage(damage) {
    if (!this.isAlive) return;

    // 扣除生命值
    this.health -= damage;

    // 触发视觉反馈
    this.flashDamage();

    // 检查死亡
    if (this.health <= 0) {
      this.die();
    }
  }

  /**
   * 伤害视觉反馈
   *
   * 设置闪烁状态，由 ZombieInstancedRenderer 渲染为红色。
   */
  flashDamage() {
    this.isFlashing = true;

    // 清除之前的定时器
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
    }

    // 设置恢复定时器
    this.flashTimeout = setTimeout(() => {
      this.isFlashing = false;
    }, FLASH_CONFIG.duration);
  }

  /**
   * 死亡处理
   */
  die() {
    this.isAlive = false;
    this.state = ZOMBIE_STATES.DEAD;

    // 清理定时器
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }

    // 逻辑移除由 ZombieManager 处理
    // 视觉移除由 ZombieInstancedRenderer 处理
  }

  // --------------------------------------------------------------------------
  // 工具方法
  // --------------------------------------------------------------------------

  /**
   * 获取丧尸的边界框
   *
   * 用于碰撞检测。
   *
   * @returns {Object} 边界框 {minX, maxX, minY, maxY, minZ, maxZ}
   */
  getBoundingBox() {
    const halfWidth = this.width / 2;
    return {
      minX: this.position.x - halfWidth,
      maxX: this.position.x + halfWidth,
      minY: this.position.y - this.height / 2,
      maxY: this.position.y + this.height / 2,
      minZ: this.position.z - halfWidth,
      maxZ: this.position.z + halfWidth
    };
  }
}