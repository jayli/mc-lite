// src/actors/weapon/Gun.js
import * as THREE from 'three';
import { audioManager } from '../../core/AudioManager.js';

// 武器类型常量
export const WEAPON_TYPES = {
  ARM: 0,    // 手臂
  GUN: 1,    // 普通枪
  MAG7: 2,   // 散弹枪
  MINIGUN: 3 // 机枪
};

// 武器详细配置
export const GUN_CONFIGS = {
  [WEAPON_TYPES.GUN]: {
    name: 'Gun',
    fireRate: 0.09,        // 射击间隔（秒），越小射速越快
    recoil: 0.05,          // 射击时的后坐力偏移量（向后移动的距离）
    sound: 'gun_fire',     // 射击音效名称
    volume: 0.09,          // 音效音量 (0.0 - 1.0)
    scale: new THREE.Vector3(0.09, 0.09, 0.09),       // 武器模型的缩放比例
    position: new THREE.Vector3(0.3, -0.85, -0.4),    // 武器在相机空间的默认位置 (x, y, z)
    rotation: new THREE.Vector3(0, 0, 0),             // 武器在相机空间的默认旋转
    muzzleOffset: new THREE.Vector3(0.3, -0.82, -0.44), // 枪口相对于相机的偏移量，用于计算枪口火花
    localStart: new THREE.Vector3(0.3, -0.33, -0.98),   // 弹道轨迹在相机空间的起始点
    tracerColor: 0xffff00,    // 弹道轨迹颜色
    tracerOpacity: 0.8,       // 弹道轨迹初始透明度
    tracerThickness: 1,       // 弹道轨迹粗细
    tracerLifetime: 0.1       // 弹道轨迹持续时间（秒）
  },
  [WEAPON_TYPES.MAG7]: {
    name: 'MAG7',
    fireRate: 1.5,
    recoil: 0.15,
    sound: 'mag7_fire',
    volume: 0.2,
    scale: new THREE.Vector3(1.3, 1.3, 1.3),
    position: new THREE.Vector3(0.44, -0.5, -0.8),
    rotation: new THREE.Vector3(0, -Math.PI / 2, 0),
    muzzleOffset: new THREE.Vector3(0.3, -0.82, -0.44), // 复用 Gun 的大致计算
    localStart: new THREE.Vector3(0.55, -0.4, -1.8),
    tracerColor: 0xff6600,
    tracerOpacity: 1.0,
    tracerThickness: 6,
    tracerLifetime: 0.15,
    isShotgun: true,
    chainDelay: 7  // 连锁击毁延迟（毫秒），给 AO 计算留出时间
  },
  [WEAPON_TYPES.MINIGUN]: {
    name: 'Minigun',
    fireRate: 0.07,
    recoil: 0,
    sound: 'minigun_fire',
    volume: 0.15,
    scale: new THREE.Vector3(0.5, 0.5, 0.5),
    position: new THREE.Vector3(0.48, -0.56, 0.6),
    rotation: new THREE.Vector3(-Math.PI / 2, -Math.PI / 2, -Math.PI),
    muzzleOffset: new THREE.Vector3(0.3, -0.82, -0.44), // 复用 Gun 的大致计算
    localStart: new THREE.Vector3(0.5, -0.5, -1.8),
    tracerColor: 0xffff00,
    tracerOpacity: 0.8,
    tracerThickness: 0.5,
    tracerLifetime: 0.08,
    hasSpin: true
  }
};

/**
 * Gun 类
 * 抽象武器逻辑，处理模型渲染、射击效果和状态更新
 */
export class Gun {
  /**
   * @param {number} type - 武器类型 (WEAPON_TYPES)
   * @param {THREE.Group} sourceModel - 武器原始模型
   * @param {THREE.Camera} camera - 挂载到的相机对象
   * @param {World} world - 游戏世界引用
   */
  constructor(type, sourceModel, camera, world) {
    this.type = type;             // 当前武器类型
    this.config = GUN_CONFIGS[type]; // 当前武器对应的配置
    this.camera = camera;         // 玩家相机
    this.world = world;           // 游戏世界

    // 模型处理
    this.mesh = sourceModel.clone(); // 克隆模型以供独立更新
    this.mesh.userData.sourceModel = sourceModel;
    this.mesh.visible = true;

    if (this.type === WEAPON_TYPES.MINIGUN) {
      this.mesh.rotation.order = 'YXZ'; // 解决加特林旋转时的万向锁问题
    }

    this.camera.add(this.mesh); // 将武器添加到相机，实现随动效果

    // 状态
    this.recoilOffset = 0;   // 当前后坐力导致的偏移值
    this.drawProgress = 0;   // 切枪/拿起动画的进度 (0.0 到 1.0)
    this.spinRotation = 0;   // 加特林枪管当前的旋转角度
    this.spinSpeed = 0;      // 加特林枪管的旋转速度

    // 性能优化：复用向量
    this._muzzleOffset = new THREE.Vector3();
    this._muzzlePos = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._tempVector = new THREE.Vector3();
  }

  /**
   * 销毁武器
   */
  destroy() {
    if (this.mesh) {
      this.camera.remove(this.mesh);
      this.mesh = null;
    }
  }

  /**
   * 更新武器每帧状态
   */
  update(dt, isShooting) {
    if (!this.mesh) return;

    // 1. 拿起动画
    if (this.drawProgress < 1) {
      this.drawProgress = Math.min(1, this.drawProgress + dt * 4);
    }
    const drawYOffset = Math.pow(1 - this.drawProgress, 2) * 1.2;

    // 2. 更新位置与后坐力
    this.mesh.position.copy(this.config.position);
    this.mesh.position.y -= drawYOffset;
    this.mesh.position.z += this.recoilOffset;

    // 3. 更新旋转
    this.mesh.rotation.x = this.config.rotation.x;
    this.mesh.rotation.y = this.config.rotation.y;
    this.mesh.rotation.z = this.config.rotation.z;

    // 4. Minigun 特有旋转
    if (this.config.hasSpin) {
      if (isShooting) {
        this.spinSpeed = THREE.MathUtils.lerp(this.spinSpeed, 25 * dt, 0.1);
      } else {
        this.spinSpeed = THREE.MathUtils.lerp(this.spinSpeed, 0, 0.15);
      }
      this.spinRotation += this.spinSpeed;
      this.mesh.rotation.x += this.spinRotation;
    }

    this.mesh.scale.copy(this.config.scale);

    // 逐渐恢复后坐力
    this.recoilOffset = THREE.MathUtils.lerp(this.recoilOffset, 0, 0.2);
  }

  /**
   * 触发开火效果
   */
  onFire(hitPoint = null) {
    // 1. 设置后坐力
    this.recoilOffset = this.config.recoil;

    // 2. 播放音效
    audioManager.playSound(this.config.sound, this.config.volume);

    // 3. 计算枪口位置
    this._muzzleOffset.copy(this.config.muzzleOffset);
    this._muzzleOffset.applyQuaternion(this.camera.quaternion);
    this._muzzlePos.copy(this.camera.position).add(this._muzzleOffset);

    // 4. 确定目标点
    if (hitPoint) {
      this._targetPos.copy(hitPoint);
    } else {
      this.camera.getWorldDirection(this._direction);
      this._targetPos.copy(this.camera.position).add(this._direction.multiplyScalar(40));
    }

    return {
      start: this._muzzlePos.clone(),
      end: this._targetPos.clone(),
      config: this.config
    };
  }
}
