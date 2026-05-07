/**
 * MinecartManager.js
 * 矿车管理器 — 纯行为层（数据由 SpecialEntitiesShadowStore 管理）
 */

import { Minecart } from './Minecart.js';
import { MinecartMovementSystem } from './MinecartMovementSystem.js';
import { minecartLinkDetector } from './MinecartLinkDetector.js';
import { MAX_MINECARTS } from '../../constants/GameConfig.js';
import { PERSISTENCE_CONFIG } from '../../constants/PersistenceConfig.js';
import * as THREE from 'three';

export class MinecartManager {
  /**
   * @param {THREE.Scene} scene - Three.js 场景
   * @param {World} world - 世界引用
   * @param {MinecartInstancedRenderer} renderer - 可选的渲染器实例
   * @param {SpecialEntitiesShadowStore} shadowStore - 特殊实体影子存储
   * @param {ShadowSyncDispatcher} dispatcher - 异步同步调度器
   */
  constructor(scene, world, renderer = null, shadowStore, dispatcher) {
    this.scene = scene;
    this.world = world;
    this.renderer = renderer;
    this.shadowStore = shadowStore;
    this.dispatcher = dispatcher;

    // 活跃的矿车行为实例 Map<id, Minecart>（仅用于 update 循环）
    this.activeMinecarts = new Map();

    // 位置索引：key: "x,y,z" -> minecartId
    this.positionIndex = new Map();

    // 配置
    this.maxMinecarts = MAX_MINECARTS;

    // 移动系统
    this.movementSystem = new MinecartMovementSystem(world);
  }

  setRenderer(renderer) {
    this.renderer = renderer;
  }

  /**
   * 规范化坐标（避免浮点误差造成索引失效）
   * @param {{x:number,y:number,z:number}} pos
   * @returns {{x:number,y:number,z:number}}
   */
  normalizePosition(pos) {
    return {
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z)
    };
  }

  /**
   * 位置索引键
   * @param {{x:number,y:number,z:number}} pos
   * @returns {string}
   */
  getPositionKey(pos) {
    const p = this.normalizePosition(pos);
    return `${p.x},${p.y},${p.z}`;
  }

  /**
   * 坐标归属 Chunk 键
   * @param {{x:number,y:number,z:number}} pos
   * @returns {string}
   */
  getChunkKeyByPosition(pos) {
    const p = this.normalizePosition(pos);
    const cx = Math.floor(p.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
    const cz = Math.floor(p.z / PERSISTENCE_CONFIG.CHUNK_SIZE);
    return `${cx},${cz}`;
  }

  /**
   * 生成唯一ID
   * @returns {string}
   */
  generateId() {
    return `minecart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 检查是否可以在指定位置创建矿车
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {{canPlace: boolean, reason?: string}}
   */
  canPlaceAt(x, y, z) {
    if (this.activeMinecarts.size >= this.maxMinecarts) {
      return { canPlace: false, reason: '矿车数量已达上限' };
    }

    const posKey = this.getPositionKey({ x, y, z });
    if (this.positionIndex.has(posKey)) {
      return { canPlace: false, reason: '该铁轨已有矿车' };
    }

    return { canPlace: true };
  }

  getMinecartAt(x, y, z) {
    const posKey = this.getPositionKey({ x, y, z });
    const minecartId = this.positionIndex.get(posKey);
    if (minecartId) {
      return this.activeMinecarts.get(minecartId) || null;
    }
    return null;
  }

  /**
   * 更新矿车的位置索引（移动后调用）
   * @param {Minecart} minecart - 矿车对象
   * @param {{x: number, y: number, z: number}} oldPos - 旧位置
   */
  updateMinecartPositionIndex(minecart, oldPos) {
    // 移除旧位置索引
    const oldPosKey = this.getPositionKey(oldPos);
    this.positionIndex.delete(oldPosKey);

    // 添加新位置索引
    const newPosKey = this.getPositionKey(minecart.position);
    this.positionIndex.set(newPosKey, minecart.id);
  }

  /**
   * 创建矿车
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position - 位置
   * @param {number} orientation - 朝向 (0-3)
   * @returns {Minecart|null}
   */
  createMinecart(position, orientation) {
    const pos = this.normalizePosition(position);

    const { canPlace, reason } = this.canPlaceAt(pos.x, pos.y, pos.z);
    if (!canPlace) {
      console.warn(`[MinecartManager] 无法创建矿车: ${reason}`);
      return null;
    }

    const minecart = new Minecart({
      id: this.generateId(),
      position: new THREE.Vector3(pos.x, pos.y, pos.z),
      orientation,
      world: this.world,
      onDestroy: (id) => this.onMinecartDestroyed(id)
    });

    if (this.movementSystem) {
      const availableDirs = this.movementSystem.getAvailableTrackDirections(minecart);
      if (availableDirs.length > 0) {
        let bestDir = availableDirs[0];
        let minDiff = 4;
        for (const dir of availableDirs) {
          const diff = Math.min(Math.abs(dir - orientation), 4 - Math.abs(dir - orientation));
          if (diff < minDiff) {
            minDiff = diff;
            bestDir = dir;
          }
        }
        minecart.orientation = bestDir;
      }
    }

    minecart.chunkKey = this.getChunkKeyByPosition(pos);

    this.activeMinecarts.set(minecart.id, minecart);
    const posKey = this.getPositionKey(pos);
    this.positionIndex.set(posKey, minecart.id);

    // 写入 ShadowStore
    if (this.shadowStore) {
      const cx = Math.floor(pos.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
      const cz = Math.floor(pos.z / PERSISTENCE_CONFIG.CHUNK_SIZE);
      this.shadowStore.addEntity('minecart', cx, cz, minecart.id, minecart.toJSON());
      if (this.dispatcher) this.dispatcher.markDirty(cx, cz);
    }

    return minecart;
  }

  /**
   * 移除矿车
   * @param {string} minecartId - 矿车ID
   * @returns {boolean}
   */
  removeMinecart(minecartId) {
    const minecart = this.activeMinecarts.get(minecartId);
    if (!minecart) {
      console.warn(`[MinecartManager] 矿车不存在: ${minecartId}`);
      return false;
    }

    // 从 ShadowStore 移除
    if (this.shadowStore) {
      const cx = Math.floor(minecart.position.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
      const cz = Math.floor(minecart.position.z / PERSISTENCE_CONFIG.CHUNK_SIZE);
      this.shadowStore.removeEntity('minecart', cx, cz, minecartId);
      if (this.dispatcher) this.dispatcher.markDirty(cx, cz);
    }

    // 从位置索引移除
    const posKey = this.getPositionKey(minecart.position);
    this.positionIndex.delete(posKey);

    // 从管理结构移除
    this.activeMinecarts.delete(minecartId);

    // 销毁矿车
    minecart.destroy();

    return true;
  }

  /**
   * 拾取矿车
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @param {Object} inventory - 玩家背包
   * @returns {boolean}
   */
  pickUp(x, y, z, inventory) {
    const minecart = this.getMinecartAt(x, y, z);
    if (!minecart) {
      return false;
    }

    // 使用 MinecartLinkDetector 断开链接关系
    // 这会停止所有链接矿车并清理链接关系
    minecartLinkDetector.breakLinks(minecart, this);

    // 确保当前矿车也已停止
    minecart.movementState = 'IDLE';
    minecart.velocity = { x: 0, z: 0 };

    // 添加到背包
    if (inventory && typeof inventory.add === 'function') {
      inventory.add('mine_cart', 1);
    }

    // 移除矿车
    this.removeMinecart(minecart.id);

    return true;
  }

  /**
   * 矿车销毁回调
   * @param {string} minecartId - 矿车ID
   */
  onMinecartDestroyed(minecartId) {
    const minecart = this.activeMinecarts.get(minecartId);
    if (minecart) {
      const posKey = this.getPositionKey(minecart.position);
      this.positionIndex.delete(posKey);

      // 从 ShadowStore 移除
      if (this.shadowStore) {
        const cx = Math.floor(minecart.position.x / PERSISTENCE_CONFIG.CHUNK_SIZE);
        const cz = Math.floor(minecart.position.z / PERSISTENCE_CONFIG.CHUNK_SIZE);
        this.shadowStore.removeEntity('minecart', cx, cz, minecartId);
        if (this.dispatcher) this.dispatcher.markDirty(cx, cz);
      }
    }
    this.activeMinecarts.delete(minecartId);
  }

  /**
   * 从 ShadowStore 恢复矿车实例（支持分帧）
   * @param {number} cx - Chunk X
   * @param {number} cz - Chunk Z
   * @param {number} [startIndex=0] - 起始索引
   * @param {number} [maxCount=3] - 本帧最多恢复数量
   * @returns {boolean} 是否还有更多矿车待恢复
   */
  restoreMinecartsForChunk(cx, cz, startIndex = 0, maxCount = 3) {
    if (!this.shadowStore) return false;
    const minecarts = this.shadowStore.getAllEntities('minecart', cx, cz);
    if (minecarts.length === 0) return false;

    const currentChunkKey = `${cx},${cz}`;
    let restored = 0;
    let i = startIndex;

    for (; i < minecarts.length && restored < maxCount; i++) {
      const item = minecarts[i];
      if (!item?.position) continue;
      if (this.getChunkKeyByPosition(item.position) !== currentChunkKey) continue;

      if (item.id && this.activeMinecarts.has(item.id)) continue;
      const posKey = this.getPositionKey(item.position);
      if (this.positionIndex.has(posKey)) continue;

      const minecart = Minecart.fromJSON(item, this.world);
      minecart.chunkKey = currentChunkKey;
      minecart.onDestroy = (id) => this.onMinecartDestroyed(id);

      this.activeMinecarts.set(minecart.id, minecart);
      this.positionIndex.set(posKey, minecart.id);

      console.log(`[MinecartManager] 恢复矿车: ${minecart.id} 位置: (${item.x}, ${item.y}, ${item.z})`);
      restored++;
    }

    while (i < minecarts.length) {
      const item = minecarts[i];
      if (item?.position && this.getChunkKeyByPosition(item.position) === currentChunkKey) {
        return true;
      }
      i++;
    }
    return false;
  }

  /**
   * 停止指定 Chunk 内所有矿车的运动
   * Chunk 卸载时调用，确保矿车状态被保存
   */
  stopMinecartsForChunk(cx, cz) {
    const chunkKey = `${cx},${cz}`;
    const minecartsToStop = [];

    for (const minecart of this.activeMinecarts.values()) {
      if (minecart.chunkKey === chunkKey) {
        minecartsToStop.push(minecart);
      }
    }

    if (minecartsToStop.length === 0) return;

    for (const minecart of minecartsToStop) {
      if (minecart.movementState !== 'IDLE') {
        minecart.movementState = 'IDLE';
        minecart.velocity = { x: 0, z: 0 };
        console.log(`[MinecartManager] 停止矿车 ${minecart.id} 运动，Chunk ${chunkKey} 卸载`);
      }

      // 更新 ShadowStore 中的状态
      if (this.shadowStore) {
        this.shadowStore.addEntity('minecart', cx, cz, minecart.id, minecart.toJSON());
        if (this.dispatcher) this.dispatcher.markDirty(cx, cz);
      }
    }

    console.log(`[MinecartManager] Chunk ${chunkKey} 卸载，已停止 ${minecartsToStop.length} 个矿车`);
  }

  /**
   * 更新所有矿车
   * @param {number} deltaTime - 时间增量（秒）
   * @param {Function} getRotationAngle - 获取旋转角度的函数
   * @param {Player} player - 玩家对象（用于碰撞检测）
   */
  update(deltaTime, getRotationAngle, player = null) {
    if (this.movementSystem) {
      this.movementSystem.updateAll(this.activeMinecarts, deltaTime, this, player);
    }

    for (const minecart of this.activeMinecarts.values()) {
      minecart.update(deltaTime);
    }

    if (this.renderer && getRotationAngle) {
      this.renderer.update(this.activeMinecarts, getRotationAngle);
    }
  }

  destroyAll() {
    for (const minecart of this.activeMinecarts.values()) {
      minecart.destroy();
    }
    this.activeMinecarts.clear();
    this.positionIndex.clear();
  }

  getCount() {
    return this.activeMinecarts.size;
  }
}