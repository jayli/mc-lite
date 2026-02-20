import * as THREE from 'three';
import { getBlockProperties } from '../../constants/BlockData.js';

/**
 * 辅助函数：判断方块是否为障碍物
 * @param {string} blockType - 方块类型
 * @returns {boolean} 是否为障碍物
 */
function isObstacle(blockType) {
  if (!blockType) return false;
  return getBlockProperties(blockType).isSolid;
}

/**
 * 丧尸实体类 - 符合我的世界原版风格的敌人
 * 尺寸：1x1x2 方块单位
 * 功能：追踪玩家、碰撞检测、生命值管理
 */
export class Zombie {
  constructor(position = { x: 0, y: 0, z: 0 }) {
    // 基础属性
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.rotation = { x: 0, y: 0, z: 0 };

    // 物理属性
    this.width = 0.6;  // 略小于1个方块，便于移动
    this.height = 1.8; // 2个方块高度
    this.speed = 0.02; // 丧尸移动速度
    this.perceptionRange = 50; // 感知范围

    // 状态属性
    this.health = 100;
    this.maxHealth = 100;
    this.state = 'idle'; // idle, chasing
    this.isAlive = true;

    // 唯一标识符
    this.id = THREE.MathUtils.generateUUID();

    // 目标（玩家）
    this.target = null;

    // 视觉状态
    this.isFlashing = false;

    // 创建僵尸逻辑容器 (不再包含几何体，由InstancedRenderer渲染)
    this.mesh = this.createZombieMesh();
  }

  /**
    * 创建我的世界风格的丧尸逻辑容器
    * 注意：为了性能优化，现在使用 InstancedMesh 渲染，这里只返回一个空的 Group 用于逻辑兼容
    */
  createZombieMesh() {
    const group = new THREE.Group();

    // 设置userData标记这是一个丧尸，方便射线检测（虽然射线检测现在主要针对InstancedMesh）
    group.userData = { type: 'zombie', isZombie: true, zombieId: this.id };

    // 设置全局位置
    group.position.set(this.position.x, this.position.y, this.position.z);

    return group;
  }

  // 移除了 createMosaicTexture 方法，已迁移至 ZombieInstancedRenderer

  /**
    * 设置期望速度（由Worker计算得出）
    * @param {number} vx - X轴速度
    * @param {number} vz - Z轴速度
    */
  setDesiredVelocity(vx, vz) {
    this.velocity.x = vx;
    this.velocity.z = vz;

    // 更新朝向（Y轴旋转）
    if (Math.abs(this.velocity.x) > 0.001 || Math.abs(this.velocity.z) > 0.001) {
      this.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
      this.mesh.rotation.y = this.rotation.y;
    }
  }

  /**
    * 物理更新 - 在主线程执行，利用World数据进行碰撞检测
    * 注意：排斥力和AI速度计算已在Worker中完成，这里直接使用this.velocity
    * @param {Function} getBlockFunc - 获取方块的函数
    * @param {number} dt - 时间步长
    */
  update(getBlockFunc, dt = 0.016) {
    if (!this.isAlive) return;

    // Worker已经计算了AI速度+排斥力，直接使用this.velocity
    const velocityX = this.velocity.x;
    const velocityZ = this.velocity.z;

    // 1. 预测下一步位置
    let nextX = this.position.x + velocityX;
    let nextZ = this.position.z + velocityZ;

    const pY = Math.floor(this.position.y);

    const padding = 0.2; // 安全距离，防止穿模
    const checkRadius = this.width / 2 + padding;

    // 2. 检查前方碰撞 (X方向)
    if (Math.abs(velocityX) > 0) {
      const wallX = Math.floor(nextX + Math.sign(velocityX) * checkRadius);

      // 检查Z轴宽度范围内的所有可能方块，防止手臂穿模
      const zMin = Math.floor(this.position.z - checkRadius);
      const zMax = Math.floor(this.position.z + checkRadius);
      let collision = false;

      for (let z = zMin; z <= zMax; z++) {
        // 只要头部高度有阻挡，就视为墙壁碰撞
        if (isObstacle(getBlockFunc(wallX, pY + 1, z))) {
          collision = true;
          break;
        }
      }

      if (collision) {
        this.velocity.x = 0;
        nextX = this.position.x;
      }
    }

    // 3. 检查前方碰撞 (Z方向)
    if (Math.abs(this.velocity.z) > 0) {
      const wallZ = Math.floor(nextZ + Math.sign(this.velocity.z) * checkRadius);

      // 检查X轴宽度范围内的所有可能方块，防止手臂穿模
      const xMin = Math.floor(this.position.x - checkRadius);
      const xMax = Math.floor(this.position.x + checkRadius);
      let collision = false;

      for (let x = xMin; x <= xMax; x++) {
        // 只要头部高度有阻挡，就视为墙壁碰撞
        if (isObstacle(getBlockFunc(x, pY + 1, wallZ))) {
          collision = true;
          break;
        }
      }

      if (collision) {
        this.velocity.z = 0;
        nextZ = this.position.z;
      }
    }

    // 4. 更新水平位置
    this.position.x = nextX;
    this.position.z = nextZ;

    // 5. 地面检测与重力
    let groundY = -100;
    // 向下探测地面
    for (let y = Math.ceil(this.position.y); y >= Math.floor(this.position.y) - 4; y--) {
      if (isObstacle(getBlockFunc(Math.floor(this.position.x), y, Math.floor(this.position.z)))) {
        groundY = y + 1; // 地面高度（方块顶面）
        break;
      }
    }

    // 6. 自动跳跃/上台阶
    // 如果脚下有方块（比如因为水平移动撞进了台阶内部），自动抬升
    const currentBlockY = Math.floor(this.position.y);
    if (isObstacle(getBlockFunc(Math.floor(this.position.x), currentBlockY, Math.floor(this.position.z)))) {
      // 如果我们陷在方块里，且上方没有阻挡，抬升到方块上方
      if (!isObstacle(getBlockFunc(Math.floor(this.position.x), currentBlockY + 1, Math.floor(this.position.z)))) {
        groundY = currentBlockY + 1;
      }
    }

    // 重力应用
    if (this.position.y > groundY) {
      this.velocity.y -= 0.08; // 模拟重力
      this.position.y += this.velocity.y;

      // 落地检测
      if (this.position.y < groundY) {
        this.position.y = groundY;
        this.velocity.y = 0;
      }
    } else if (this.position.y < groundY) {
      // 平滑上台阶 / 修正位置
      this.position.y += 0.2;
      if (this.position.y > groundY) this.position.y = groundY;
      this.velocity.y = 0;
    }

    // 7. 处理跳跃（如果前方有阻挡且上方空闲）
    if ((Math.abs(velocityX) > 0 || Math.abs(velocityZ) > 0) && this.position.y <= groundY + 0.1) {
      const frontX = Math.floor(this.position.x + velocityX * 2);
      const frontZ = Math.floor(this.position.z + velocityZ * 2);
      const eyeY = Math.floor(this.position.y) + 1; // 眼睛高度

      const blockFront = getBlockFunc(frontX, eyeY, frontZ);
      const blockAbove = getBlockFunc(frontX, eyeY + 1, frontZ);

      if (isObstacle(blockFront) && !isObstacle(blockAbove)) {
        // 尝试跳上台阶
        this.velocity.y = 0.4;
        this.position.y += 0.1; // 稍微抬起一点以触发重力循环
      }
    }

    // 更新 Mesh 位置
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
  }

  /**
    * 应用伤害
    * @param {number} damage - 伤害值
    */
  takeDamage(damage) {
    if (!this.isAlive) return;

    this.health -= damage;

    // 视觉反馈 - 闪红
    this.flashDamage();

    if (this.health <= 0) {
      this.die();
    }
  }

  /**
    * 伤害时的视觉反馈
    * 现在只设置状态标志，由ZombieInstancedRenderer处理实际渲染颜色
    */
  flashDamage() {
    this.isFlashing = true;

    // 0.2秒后恢复
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => {
      this.isFlashing = false;
    }, 200);
  }

  /**
    * 死亡处理
    */
  die() {
    this.isAlive = false;
    this.state = 'dead';

    // 逻辑移除由Manager处理
    // 视觉移除由Renderer处理
  }

  /**
    * 获取丧尸的边界框用于碰撞检测
    */
  getBoundingBox() {
    return {
      minX: this.position.x - this.width / 2,
      maxX: this.position.x + this.width / 2,
      minY: this.position.y - this.height / 2,
      maxY: this.position.y + this.height / 2,
      minZ: this.position.z - this.width / 2,
      maxZ: this.position.z + this.width / 2
    };
  }
}
