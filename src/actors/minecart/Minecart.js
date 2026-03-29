/**
 * Minecart.js
 * 矿车实体类 - 仅存储数据状态，渲染由 MinecartInstancedRenderer 处理
 */

import * as THREE from 'three';

// 矿车配置常量
export const MINECART_CONFIG = {
  // 车斗尺寸 (约 0.8x0.4x0.8 方块)
  BODY_SIZE: { width: 0.9, height: 0.8, depth: 0.9 },
  // 车轮尺寸
  WHEEL_RADIUS: 0.2,
  WHEEL_HEIGHT: 0.1,
  // 车轮轴距 (前后轮间距)
  WHEELBASE: 0.6,
  // 轮距 (左右轮间距)
  TRACK_WIDTH: 0.6,
  // 整体高度 (车斗底部到车轮底部)
  TOTAL_HEIGHT: 0.9,
  // 碰撞盒尺寸
  BOUNDING_BOX: { width: 1.0, height: 0.9, depth: 1.0 }
};

/**
 * 矿车移动状态枚举
 */
export const MinecartMovementState = {
  IDLE: 'IDLE',
  MOVING_FORWARD: 'MOVING_FORWARD',
  MOVING_BACKWARD: 'MOVING_BACKWARD'
};

export class Minecart {
  /**
   * @param {Object} params - 初始化参数
   * @param {string} params.id - 唯一标识符
   * @param {THREE.Vector3} params.position - 矿车位置（方块坐标）
   * @param {number} params.orientation - 朝向 (0-3: EAST/SOUTH/WEST/NORTH)
   * @param {World} params.world - 世界引用
   */
  constructor(params) {
    this.id = params.id;
    this.position = params.position.clone();
    this.orientation = params.orientation || 0;
    this.world = params.world;

    // 基础状态
    this.state = 'PLACED'; // 'PLACED' | 'PICKED_UP' | 'DESTROYED'

    // 移动状态
    this.movementState = MinecartMovementState.IDLE;
    this.velocity = { x: 0, z: 0 };
    this.lastTrackPosition = null;

    // 链接状态
    this.linkedMinecarts = new Set();

    // 回调
    this.onDestroy = params.onDestroy || null;

    // 归属 chunk 键
    this.chunkKey = null;
  }

  /**
   * 获取碰撞边界盒
   * @returns {THREE.Box3}
   */
  getBoundingBox() {
    const { width, height, depth } = MINECART_CONFIG.BOUNDING_BOX;
    const min = new THREE.Vector3(
      this.position.x + (1 - width) / 2,
      this.position.y,
      this.position.z + (1 - depth) / 2
    );
    const max = new THREE.Vector3(
      this.position.x + (1 + width) / 2,
      this.position.y + height,
      this.position.z + (1 + depth) / 2
    );
    return new THREE.Box3(min, max);
  }

  /**
   * 更新矿车状态 (每帧调用)
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    if (this.state === 'DESTROYED') return;

    // 确保最近铁轨位置已初始化（用于回弹）
    if (!this.lastTrackPosition) {
      this.lastTrackPosition = {
        x: Math.floor(this.position.x),
        y: Math.floor(this.position.y),
        z: Math.floor(this.position.z)
      };
    }

    // 移动逻辑由 MinecartMovementSystem 处理
    // lastTrackPosition 在 MinecartMovementSystem 中更新（成功移动到新格子时）
  }

  /**
   * 销毁矿车
   */
  destroy() {
    if (this.state === 'DESTROYED') return;

    this.state = 'DESTROYED';

    // 清理链接关系
    this.linkedMinecarts.clear();

    // 通知管理器移除自己
    if (this.onDestroy) {
      this.onDestroy(this.id);
    }
  }

  /**
   * 获取矿车当前状态
   * @returns {Object}
   */
  getState() {
    return {
      id: this.id,
      state: this.state,
      position: this.position,
      orientation: this.orientation,
      movementState: this.movementState
    };
  }

  /**
   * 序列化为持久化格式
   * @returns {Object}
   */
  toJSON() {
    const json = {
      id: this.id,
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      orientation: this.orientation
    };

    // 如果有移动状态，也保存
    if (this.movementState !== MinecartMovementState.IDLE) {
      json.movementState = this.movementState;
    }

    // 保存最近铁轨位置
    if (this.lastTrackPosition) {
      json.lastTrackX = this.lastTrackPosition.x;
      json.lastTrackY = this.lastTrackPosition.y;
      json.lastTrackZ = this.lastTrackPosition.z;
    }

    return json;
  }

  /**
   * 从持久化数据恢复
   * @param {Object} data - 持久化数据
   * @param {World} world - 世界引用
   * @returns {Minecart}
   */
  static fromJSON(data, world) {
    const minecart = new Minecart({
      id: data.id,
      position: new THREE.Vector3(data.x, data.y, data.z),
      orientation: data.orientation,
      world
    });

    // 恢复移动状态
    if (data.movementState) {
      minecart.movementState = data.movementState;
    }

    // 恢复最近铁轨位置
    if (data.lastTrackX !== undefined) {
      minecart.lastTrackPosition = {
        x: data.lastTrackX,
        y: data.lastTrackY,
        z: data.lastTrackZ
      };
    }

    return minecart;
  }
}