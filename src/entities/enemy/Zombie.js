import * as THREE from 'three';

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
    this.speed = 0.02;
    this.perceptionRange = 10; // 感知范围

    // 状态属性
    this.health = 100;
    this.maxHealth = 100;
    this.state = 'idle'; // idle, chasing
    this.isAlive = true;

    // 目标（玩家）
    this.target = null;

    // 创建僵尸几何体（我的世界风格的方块化人体）
    this.mesh = this.createZombieMesh();
  }

  /**
    * 创建我的世界风格的丧尸几何体
    */
  createZombieMesh() {
    const group = new THREE.Group();

    // 材质 - 接近我的世界丧尸的颜色
    const zombieMaterial = new THREE.MeshLambertMaterial({
      color: 0x8EB87B, // 绿色调，符合丧尸外观
      wireframe: false
    });

    // 头部 (1x1x1 方块)
    const headGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const head = new THREE.Mesh(headGeometry, zombieMaterial);
    head.position.set(0, 2.1, 0); // 头部在身体上方 (1.5 + 0.6)
    group.add(head);

    // 身体 (0.75x1x0.5 方块)
    const bodyGeometry = new THREE.BoxGeometry(0.75, 1, 0.5);
    const body = new THREE.Mesh(bodyGeometry, zombieMaterial);
    body.position.set(0, 1.1, 0); // (0.5 + 0.6)
    group.add(body);

    // 左臂 (0.3x0.8x0.3 方块)
    const leftArmGeometry = new THREE.BoxGeometry(0.3, 0.8, 0.3);
    const leftArm = new THREE.Mesh(leftArmGeometry, zombieMaterial);
    leftArm.position.set(-0.55, 1.5, 0); // (0.9 + 0.6)
    group.add(leftArm);

    // 右臂 (0.3x0.8x0.3 方块)
    const rightArmGeometry = new THREE.BoxGeometry(0.3, 0.8, 0.3);
    const rightArm = new THREE.Mesh(rightArmGeometry, zombieMaterial);
    rightArm.position.set(0.55, 1.5, 0); // (0.9 + 0.6)
    group.add(rightArm);

    // 左腿 (0.35x0.8x0.35 方块)
    const leftLegGeometry = new THREE.BoxGeometry(0.35, 0.8, 0.35);
    const leftLeg = new THREE.Mesh(leftLegGeometry, zombieMaterial);
    leftLeg.position.set(-0.19, 0.4, 0); // (-0.2 + 0.6)
    group.add(leftLeg);

    // 右腿 (0.35x0.8x0.35 方块)
    const rightLegGeometry = new THREE.BoxGeometry(0.35, 0.8, 0.35);
    const rightLeg = new THREE.Mesh(rightLegGeometry, zombieMaterial);
    rightLeg.position.set(0.19, 0.4, 0); // (-0.2 + 0.6)
    group.add(rightLeg);

    // 设置userData标记这是一个丧尸，方便射线检测
    group.userData = { type: 'zombie', isZombie: true };

    // 设置全局位置
    group.position.set(this.position.x, this.position.y, this.position.z);

    return group;
  }

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
    * @param {Function} getBlockFunc - 获取方块的函数
    * @param {number} dt - 时间步长
    */
  update(getBlockFunc, dt = 0.016) {
    if (!this.isAlive) return;

    // 1. 预测下一步位置
    let nextX = this.position.x + this.velocity.x;
    let nextZ = this.position.z + this.velocity.z;

    const pX = Math.floor(this.position.x);
    const pY = Math.floor(this.position.y);
    const pZ = Math.floor(this.position.z);

    // 2. 检查前方碰撞 (X方向)
    if (Math.abs(this.velocity.x) > 0) {
      const wallX = Math.floor(nextX + Math.sign(this.velocity.x) * 0.4);
      // 检查身体高度范围内的阻挡 (脚部和腰部)
      if (getBlockFunc(wallX, pY, pZ) || getBlockFunc(wallX, pY + 1, pZ)) {
        // 如果前方有墙，且不能上台阶（头顶也是方块），则停止
        if (getBlockFunc(wallX, pY + 1, pZ)) {
          this.velocity.x = 0;
          nextX = this.position.x;
        }
      }
    }

    // 3. 检查前方碰撞 (Z方向)
    if (Math.abs(this.velocity.z) > 0) {
      const wallZ = Math.floor(nextZ + Math.sign(this.velocity.z) * 0.4);
      if (getBlockFunc(pX, pY, wallZ) || getBlockFunc(pX, pY + 1, wallZ)) {
        if (getBlockFunc(pX, pY + 1, wallZ)) {
          this.velocity.z = 0;
          nextZ = this.position.z;
        }
      }
    }

    // 4. 更新水平位置
    this.position.x = nextX;
    this.position.z = nextZ;

    // 5. 地面检测与重力
    let groundY = -100;
    // 向下探测地面
    for (let y = Math.ceil(this.position.y); y >= Math.floor(this.position.y) - 4; y--) {
      if (getBlockFunc(Math.floor(this.position.x), y, Math.floor(this.position.z))) {
        groundY = y + 1; // 地面高度（方块顶面）
        break;
      }
    }

    // 6. 自动跳跃/上台阶
    // 如果脚下有方块（比如因为水平移动撞进了台阶内部），自动抬升
    const currentBlockY = Math.floor(this.position.y);
    if (getBlockFunc(Math.floor(this.position.x), currentBlockY, Math.floor(this.position.z))) {
      // 如果我们陷在方块里，且上方没有阻挡，抬升到方块上方
      if (!getBlockFunc(Math.floor(this.position.x), currentBlockY + 1, Math.floor(this.position.z))) {
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
    if ((Math.abs(this.velocity.x) > 0 || Math.abs(this.velocity.z) > 0) && this.position.y <= groundY + 0.1) {
      const frontX = Math.floor(this.position.x + this.velocity.x * 2);
      const frontZ = Math.floor(this.position.z + this.velocity.z * 2);

      const blockFront = getBlockFunc(frontX, pY, frontZ);
      const blockAbove = getBlockFunc(frontX, pY + 1, frontZ);

      if (blockFront && !blockAbove) {
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
    */
  flashDamage() {
    // 创建临时红色材质以表示受伤
    const redMaterial = new THREE.MeshLambertMaterial({
      color: 0xFF0000,
      transparent: true,
      opacity: 0.7
    });

    // 应用到所有子网格
    this.mesh.traverse((child) => {
      if (child.isMesh) {
        const originalMaterial = child.material;
        child.material = redMaterial;

        // 0.2秒后恢复原材质
        setTimeout(() => {
          child.material = originalMaterial;
        }, 200);
      }
    });
  }

  /**
    * 死亡处理
    */
  die() {
    this.isAlive = false;
    this.state = 'dead';

    // 可选：播放死亡动画，然后从场景中移除
    setTimeout(() => {
      if (this.mesh.parent) {
        this.mesh.parent.remove(this.mesh);
      }
    }, 1000);
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
