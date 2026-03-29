/**
 * MinecartMovementSystem.js
 * 矿车移动系统 - 处理矿车沿铁轨移动的核心逻辑
 *
 * 职责：
 * - 检测铁轨方块
 * - 计算移动方向
 * - 更新矿车位置
 * - 处理前进/后退逻辑
 */

import { MINECART_SPEED, TRACK_BLOCK_TYPES, MAX_LINKED_MINECARTS } from '../../constants/GameConfig.js';
import { getRotationAngle } from '../../utils/OrientationUtils.js';
import { getBlockProperties } from '../../constants/BlockData.js';
import { minecartCollisionSystem } from './MinecartCollisionSystem.js';

/**
 * 方向向量映射表
 * orientation 0-3 对应 EAST, SOUTH, WEST, NORTH
 */
const DIRECTION_VECTORS = {
  0: { x: 1, z: 0 },   // EAST
  1: { x: 0, z: 1 },   // SOUTH
  2: { x: -1, z: 0 },  // WEST
  3: { x: 0, z: -1 }   // NORTH
};

/**
 * 矿车移动系统类
 */
export class MinecartMovementSystem {
  /**
   * @param {World} world - 世界引用
   */
  constructor(world) {
    this.world = world;
  }

  /**
   * 获取方向向量
   * @param {number} orientation - 朝向 (0-3)
   * @param {string} movementState - 移动状态
   * @returns {{x: number, z: number}}
   */
  getDirectionVector(orientation, movementState) {
    const baseDirection = DIRECTION_VECTORS[orientation] || DIRECTION_VECTORS[0];

    // 后退时反转方向
    if (movementState === 'MOVING_BACKWARD') {
      return { x: -baseDirection.x, z: -baseDirection.z };
    }

    return baseDirection;
  }

  /**
   * 获取左侧方向向量（顺时针旋转90度）
   * @param {number} orientation - 当前朝向 (0-3)
   * @returns {{x: number, z: number}}
   */
  getLeftDirection(orientation) {
    const forward = DIRECTION_VECTORS[orientation] || DIRECTION_VECTORS[0];
    // 左转：顺时针旋转90度 (x, z) -> (-z, x)
    return { x: -forward.z, z: forward.x };
  }

  /**
   * 获取右侧方向向量（逆时针旋转90度）
   * @param {number} orientation - 当前朝向 (0-3)
   * @returns {{x: number, z: number}}
   */
  getRightDirection(orientation) {
    const forward = DIRECTION_VECTORS[orientation] || DIRECTION_VECTORS[0];
    // 右转：逆时针旋转90度 (x, z) -> (z, -x)
    return { x: forward.z, z: -forward.x };
  }

  /**
   * 检测指定位置是否为铁轨方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {boolean}
   */
  hasTrackAt(x, y, z) {
    if (!this.world) return false;

    // 使用 getBlockEntry 获取完整方块信息
    const blockEntry = typeof this.world.getBlockEntry === 'function'
      ? this.world.getBlockEntry(x, y, z)
      : null;

    if (!blockEntry) return false;

    return TRACK_BLOCK_TYPES.includes(blockEntry.type);
  }

  /**
   * 检测指定位置是否为实心方块（用于矿车前方阻挡判断）
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {boolean}
   */
  hasSolidBlockAt(x, y, z) {
    if (!this.world) return false;

    // 优先使用完整条目，避免世界未完全就绪时与渲染数据不一致
    if (typeof this.world.getBlockEntry === 'function') {
      const entry = this.world.getBlockEntry(x, y, z);
      if (!entry || !entry.type || entry.type === 'air') return false;
      return getBlockProperties(entry.type).isSolid === true;
    }

    // 兼容仅提供 getBlock 的场景（测试 mock）
    if (typeof this.world.getBlock === 'function') {
      const type = this.world.getBlock(x, y, z);
      if (!type || type === 'air') return false;
      return getBlockProperties(type).isSolid === true;
    }

    // 最后兜底 world.isSolid
    if (typeof this.world.isSolid === 'function') {
      return this.world.isSolid(x, y, z);
    }

    return false;
  }

  /**
   * 获取矿车当前位置可用的轨道方向
   * @param {Minecart} minecart - 矿车对象
   * @returns {Array<number>} 可用的方向数组（orientation 0-3）
   */
  getAvailableTrackDirections(minecart) {
    const available = [];
    const trackX = Math.floor(minecart.position.x);
    const trackY = Math.floor(minecart.position.y) - 1; // 铁轨在矿车下方
    const trackZ = Math.floor(minecart.position.z);

    // 检查四个方向
    for (let orientation = 0; orientation < 4; orientation++) {
      const dir = DIRECTION_VECTORS[orientation];
      if (this.hasTrackAt(trackX + dir.x, trackY, trackZ + dir.z)) {
        available.push(orientation);
      }
    }

    return available;
  }

  /**
   * 根据轨道方向调整矿车朝向
   * @param {Minecart} minecart - 矿车对象
   * @param {string} movementState - 移动状态
   * @returns {boolean} 是否可以移动
   */
  alignMinecartToTrack(minecart, movementState) {
    const availableDirections = this.getAvailableTrackDirections(minecart);

    if (availableDirections.length === 0) {
      // 没有相邻轨道，无法移动
      return false;
    }

    // 计算矿车当前的移动方向（考虑前进/后退）
    const currentOrientation = minecart.orientation;
    const isForward = movementState === 'MOVING_FORWARD';

    // 检查当前朝向方向是否有轨道
    const forwardDirection = currentOrientation;
    const backwardDirection = (currentOrientation + 2) % 4; // 反方向

    const hasForwardTrack = availableDirections.includes(forwardDirection);
    const hasBackwardTrack = availableDirections.includes(backwardDirection);

    // 如果前进方向有轨道，直接使用当前朝向
    if (isForward && hasForwardTrack) {
      return true;
    }

    // 如果后退方向有轨道
    if (!isForward && hasBackwardTrack) {
      return true;
    }

    // 当前朝向方向没有轨道，需要调整朝向
    // 选择一个可用的方向
    if (availableDirections.length > 0) {
      // 优先选择与当前朝向最接近的方向（避免180度大转弯）
      let bestDirection = availableDirections[0];
      let minDiff = 4;

      for (const dir of availableDirections) {
        // 计算方向差异（0-3）
        const diff = Math.min(
          Math.abs(dir - currentOrientation),
          4 - Math.abs(dir - currentOrientation)
        );
        if (diff < minDiff) {
          minDiff = diff;
          bestDirection = dir;
        }
      }

      // 设置新的朝向
      minecart.orientation = bestDirection;
      return true;
    }

    return false;
  }

  /**
   * 检测矿车前方是否有铁轨
   * @param {Minecart} minecart - 矿车对象
   * @returns {boolean}
   */
  hasTrackAhead(minecart) {
    const direction = this.getDirectionVector(minecart.orientation, minecart.movementState);
    const frontX = Math.floor(minecart.position.x) + direction.x;
    const frontZ = Math.floor(minecart.position.z) + direction.z;
    const trackY = Math.floor(minecart.position.y) - 1; // 铁轨在矿车下方

    return this.hasTrackAt(frontX, trackY, frontZ);
  }

  /**
   * 检测转弯方向
   * @param {Minecart} minecart - 矿车对象
   * @param {{x: number, y: number, z: number}} trackPos - 当前铁轨位置
   * @returns {{turn: 'left'|'right'|null, newOrientation: number|null}}
   */
  checkTurn(minecart, trackPos) {
    // 获取矿车的移动方向（前进或后退）
    const isMovingForward = minecart.movementState === 'MOVING_FORWARD';

    // 根据移动方向计算左右检查方向
    // 后退时左右方向需要反转
    let leftDir, rightDir;
    if (isMovingForward) {
      leftDir = this.getLeftDirection(minecart.orientation);
      rightDir = this.getRightDirection(minecart.orientation);
    } else {
      // 后退时左右反转
      leftDir = this.getRightDirection(minecart.orientation);
      rightDir = this.getLeftDirection(minecart.orientation);
    }

    const trackY = trackPos.y - 1;

    const hasLeftTrack = this.hasTrackAt(
      trackPos.x + leftDir.x,
      trackY,
      trackPos.z + leftDir.z
    );

    const hasRightTrack = this.hasTrackAt(
      trackPos.x + rightDir.x,
      trackY,
      trackPos.z + rightDir.z
    );

    if (hasLeftTrack && hasRightTrack) {
      // 两侧都有铁轨，随机选择
      const turnLeft = Math.random() < 0.5;
      const newOrientation = this.calculateNewOrientation(minecart.orientation, turnLeft ? 'left' : 'right');
      return { turn: turnLeft ? 'left' : 'right', newOrientation };
    }

    if (hasLeftTrack) {
      const newOrientation = this.calculateNewOrientation(minecart.orientation, 'left');
      return { turn: 'left', newOrientation };
    }

    if (hasRightTrack) {
      const newOrientation = this.calculateNewOrientation(minecart.orientation, 'right');
      return { turn: 'right', newOrientation };
    }

    return { turn: null, newOrientation: null };
  }

  /**
   * 计算转弯后的新朝向
   * @param {number} currentOrientation - 当前朝向 (0-3)
   * @param {string} turnDirection - 转弯方向 ('left' | 'right')
   * @returns {number}
   */
  calculateNewOrientation(currentOrientation, turnDirection) {
    if (turnDirection === 'left') {
      // 左转：在当前坐标系下 orientation 加 1
      return (currentOrientation + 1) % 4;
    } else {
      // 右转：在当前坐标系下 orientation 减 1
      return (currentOrientation + 3) % 4; // +3 等同于 -1 mod 4
    }
  }

  /**
   * 更新单个矿车的位置
   * @param {Minecart} minecart - 矿车对象
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Map<string, Minecart>} allMinecarts - 所有矿车集合（用于链接矿车同步）
   * @param {MinecartManager} manager - 矿车管理器（用于碰撞检测）
   */
  update(minecart, deltaTime, allMinecarts, manager) {
    // 静止状态不更新
    if (minecart.movementState === 'IDLE') {
      return;
    }

    const speed = MINECART_SPEED;
    const direction = this.getDirectionVector(minecart.orientation, minecart.movementState);

    // 轨道判定使用“最近轨道中心”（round），避免 floor 导致的前后方向 0.5 格偏差
    const currentTrackX = Math.round(minecart.position.x);
    const currentTrackZ = Math.round(minecart.position.z);

    // 位置索引仍使用 floor 坐标（与 MinecartManager 的占用索引保持一致）
    const currentX = Math.floor(minecart.position.x);
    const currentY = Math.floor(minecart.position.y);
    const currentZ = Math.floor(minecart.position.z);
    const trackY = currentY - 1;

    // 计算矿车相对当前轨道中心的位置（范围约为 [-0.5, 0.5]）
    const localX = minecart.position.x - currentTrackX;
    const localZ = minecart.position.z - currentTrackZ;

    // 计算移动后的新位置
    const newX = minecart.position.x + direction.x * speed * deltaTime;
    const newZ = minecart.position.z + direction.z * speed * deltaTime;

    // 使用当前轨道中心为基准计算新位置相对坐标
    const newLocalX = newX - currentTrackX;
    const newLocalZ = newZ - currentTrackZ;

    // 检测是否跨越轨道中心（前进/后退都在穿过中心时触发终点检查）
    const crossedCenterX = (
      (direction.x > 0 && localX <= 0 && newLocalX > 0) ||
      (direction.x < 0 && localX >= 0 && newLocalX < 0)
    );
    const crossedCenterZ = (
      (direction.z > 0 && localZ <= 0 && newLocalZ > 0) ||
      (direction.z < 0 && localZ >= 0 && newLocalZ < 0)
    );

    // 只有在移动方向上跨越中心时才检查
    const shouldCheck = (direction.x !== 0 && crossedCenterX) || (direction.z !== 0 && crossedCenterZ);

    if (shouldCheck) {
      // 检查前方格子
      const frontX = currentTrackX + direction.x;
      const frontZ = currentTrackZ + direction.z;

      // 检查前方是否有轨道
      const hasFrontTrack = this.hasTrackAt(frontX, trackY, frontZ);

      if (!hasFrontTrack) {
        // 前方没有轨道，检查是否可以转弯
        const turnResult = this.checkTurn(minecart, { x: currentTrackX, y: currentY, z: currentTrackZ });

        if (turnResult.turn) {
          // 可以转弯，更新朝向，停在当前位置
          minecart.orientation = turnResult.newOrientation;
          this.syncLinkedMinecartsOrientation(minecart, turnResult.newOrientation, allMinecarts);
          return;
        } else {
          // 无法转弯，停止并吸附到当前轨道格中心
          this.stopMinecartAtCell(minecart, currentTrackX, currentY, currentTrackZ, manager);
          return;
        }
      }

      // 检查前方是否有矿车阻挡
      const otherMinecart = manager ? manager.getMinecartAt(frontX, currentY, frontZ) : null;
      if (otherMinecart && !minecart.linkedMinecarts.has(otherMinecart.id)) {
        // 有阻挡，停止并吸附到当前轨道格中心
        this.stopMinecartAtCell(minecart, currentTrackX, currentY, currentTrackZ, manager);
        return;
      }

      // 检查前方是否有实心方块阻挡（即使有轨道也不能穿过）
      if (this.hasSolidBlockAt(frontX, currentY, frontZ)) {
        this.stopMinecartAtCell(minecart, currentTrackX, currentY, currentTrackZ, manager);
        return;
      }
    }

    // 没有阻挡，继续移动
    const oldPos = { x: minecart.position.x, y: minecart.position.y, z: minecart.position.z };
    minecart.position.x = newX;
    minecart.position.z = newZ;

    // 如果进入新格子，更新位置索引
    if (Math.floor(newX) !== currentX || Math.floor(newZ) !== currentZ) {
      if (manager && typeof manager.updateMinecartPositionIndex === 'function') {
        manager.updateMinecartPositionIndex(minecart, oldPos);
      }
      minecart.lastTrackPosition = { x: currentX, y: currentY, z: currentZ };
    }
  }

  /**
   * 检查是否与链接矿车碰撞
   * @param {Minecart} minecart - 当前矿车
   * @param {number} newX - 新 X 坐标
   * @param {number} newY - 新 Y 坐标
   * @param {number} newZ - 新 Z 坐标
   * @param {Map<string, Minecart>} allMinecarts - 所有矿车集合
   * @returns {boolean}
   */
  checkCollisionWithLinkedMinecarts(minecart, newX, newY, newZ, allMinecarts) {
    if (!allMinecarts || minecart.linkedMinecarts.size === 0) return false;

    for (const linkedId of minecart.linkedMinecarts) {
      const linked = allMinecarts.get(linkedId);
      if (linked) {
        const linkedX = Math.floor(linked.position.x);
        const linkedZ = Math.floor(linked.position.z);
        if (linkedX === newX && linkedZ === newZ && Math.floor(linked.position.y) === newY) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 同步链接矿车的朝向
   * @param {Minecart} minecart - 领头矿车
   * @param {number} newOrientation - 新朝向
   * @param {Map<string, Minecart>} allMinecarts - 所有矿车集合
   */
  syncLinkedMinecartsOrientation(minecart, newOrientation, allMinecarts) {
    if (!allMinecarts || minecart.linkedMinecarts.size === 0) return;

    for (const linkedId of minecart.linkedMinecarts) {
      const linked = allMinecarts.get(linkedId);
      if (linked && linked.movementState === minecart.movementState) {
        // 链接矿车跟随相同的转弯（但可能需要延迟一帧）
        // 这里简单同步朝向，实际转弯会在各自到达交叉点时发生
        // 注意：不立即同步朝向，让每个矿车在到达自己的交叉点时独立转弯
        // 这样可以保持列车的连贯性
      }
    }
  }

  /**
   * 停止矿车及其所有链接矿车
   * @param {Minecart} minecart - 矿车对象
   * @param {Map<string, Minecart>} allMinecarts - 所有矿车集合
   * @param {MinecartManager} manager - 矿车管理器
   */
  stopMinecartAndLinked(minecart, allMinecarts, manager) {
    // 先停止当前矿车
    this.stopMinecart(minecart, manager);

    // 停止所有链接矿车
    if (!allMinecarts || minecart.linkedMinecarts.size === 0) return;

    for (const linkedId of minecart.linkedMinecarts) {
      const linked = allMinecarts.get(linkedId);
      if (linked && linked.movementState !== 'IDLE') {
        this.stopMinecart(linked, manager);
      }
    }
  }

  /**
   * 停止矿车
   * @param {Minecart} minecart - 矿车对象
   * @param {MinecartManager} manager - 矿车管理器
   */
  stopMinecart(minecart, manager) {
    // 保存旧位置
    const oldPos = { x: minecart.position.x, y: minecart.position.y, z: minecart.position.z };

    minecart.movementState = 'IDLE';
    minecart.velocity = { x: 0, z: 0 };

    // 对齐到整数坐标
    if (minecart.lastTrackPosition) {
      minecart.position.x = minecart.lastTrackPosition.x;
      minecart.position.z = minecart.lastTrackPosition.z;
    } else {
      minecart.position.x = Math.floor(minecart.position.x);
      minecart.position.z = Math.floor(minecart.position.z);
    }

    // 更新位置索引
    if (manager && typeof manager.updateMinecartPositionIndex === 'function') {
      manager.updateMinecartPositionIndex(minecart, oldPos);
    }
  }

  /**
   * 立即停止矿车并吸附到指定轨道格
   * @param {Minecart} minecart - 矿车对象
   * @param {number} x - 轨道格 X
   * @param {number} y - 矿车当前 Y
   * @param {number} z - 轨道格 Z
   * @param {MinecartManager} manager - 矿车管理器
   */
  stopMinecartAtCell(minecart, x, y, z, manager) {
    const oldPos = { x: minecart.position.x, y: minecart.position.y, z: minecart.position.z };

    minecart.movementState = 'IDLE';
    minecart.velocity = { x: 0, z: 0 };
    minecart.position.x = x;
    minecart.position.z = z;
    minecart.lastTrackPosition = { x, y, z };

    if (manager && typeof manager.updateMinecartPositionIndex === 'function') {
      manager.updateMinecartPositionIndex(minecart, oldPos);
    }
  }

  /**
   * 更新所有矿车
   * @param {Map<string, Minecart>} minecarts - 矿车集合
   * @param {number} deltaTime - 时间增量（秒）
   * @param {MinecartManager} manager - 矿车管理器（用于碰撞检测）
   */
  updateAll(minecarts, deltaTime, manager) {
    for (const minecart of minecarts.values()) {
      this.update(minecart, deltaTime, minecarts, manager);
    }
  }
}
