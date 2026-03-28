/**
 * MinecartManager.js
 * 矿车管理器 - 管理所有矿车的创建、更新和销毁
 */

import { Minecart } from './Minecart.js';
import { MAX_MINECARTS } from '../../constants/GameConfig.js';
import { PERSISTENCE_CONFIG } from '../../constants/PersistenceConfig.js';
import * as THREE from 'three';

export class MinecartManager {
  /**
   * @param {THREE.Scene} scene - Three.js 场景
   * @param {World} world - 世界引用
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    // 存储所有矿车 Map<id, Minecart>
    this.minecarts = new Map();

    // 位置索引：key: "x,y,z" -> minecartId
    this.positionIndex = new Map();

    // 配置
    this.maxMinecarts = MAX_MINECARTS;
  }

  /**
   * 获取持久化服务（优先测试注入）
   * @returns {object|null}
   */
  getPersistenceService() {
    return globalThis._persistenceService || this.world?.persistenceService || null;
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
    // 检查矿车数量上限
    if (this.minecarts.size >= this.maxMinecarts) {
      return { canPlace: false, reason: '矿车数量已达上限' };
    }

    // 检查位置是否已被占用
    const posKey = this.getPositionKey({ x, y, z });
    if (this.positionIndex.has(posKey)) {
      return { canPlace: false, reason: '该铁轨已有矿车' };
    }

    return { canPlace: true };
  }

  /**
   * 获取指定位置的矿车
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @returns {Minecart|null}
   */
  getMinecartAt(x, y, z) {
    const posKey = this.getPositionKey({ x, y, z });
    const minecartId = this.positionIndex.get(posKey);
    if (minecartId) {
      return this.minecarts.get(minecartId) || null;
    }
    return null;
  }

  /**
   * 创建矿车
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position - 位置
   * @param {number} orientation - 朝向 (0-3)
   * @returns {Minecart|null}
   */
  createMinecart(position, orientation) {
    const pos = this.normalizePosition(position);

    // 检查是否可以放置
    const { canPlace, reason } = this.canPlaceAt(pos.x, pos.y, pos.z);
    if (!canPlace) {
      console.warn(`[MinecartManager] 无法创建矿车: ${reason}`);
      return null;
    }

    // 创建矿车实例
    const minecart = new Minecart({
      id: this.generateId(),
      position: new THREE.Vector3(pos.x, pos.y, pos.z),
      orientation: orientation,
      scene: this.scene,
      world: this.world,
      onDestroy: (id) => this.onMinecartDestroyed(id)
    });

    // 设置归属 chunk
    minecart.chunkKey = this.getChunkKeyByPosition(pos);

    // 添加到管理结构
    this.minecarts.set(minecart.id, minecart);
    const posKey = this.getPositionKey(pos);
    this.positionIndex.set(posKey, minecart.id);

    // 持久化
    this.saveMinecartToSnapshot(minecart);

    return minecart;
  }

  /**
   * 移除矿车
   * @param {string} minecartId - 矿车ID
   * @returns {boolean}
   */
  removeMinecart(minecartId) {
    const minecart = this.minecarts.get(minecartId);
    if (!minecart) {
      console.warn(`[MinecartManager] 矿车不存在: ${minecartId}`);
      return false;
    }

    // 从持久化快照移除
    this.removeMinecartFromSnapshot(minecart);

    // 从位置索引移除
    const posKey = this.getPositionKey(minecart.position);
    this.positionIndex.delete(posKey);

    // 从管理结构移除
    this.minecarts.delete(minecartId);

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
    // 从管理结构移除（如果尚未移除）
    const minecart = this.minecarts.get(minecartId);
    if (minecart) {
      const posKey = this.getPositionKey(minecart.position);
      this.positionIndex.delete(posKey);
      this.minecarts.delete(minecartId);
    }
  }

  /**
   * 确保持久化快照中存在矿车列表
   * @param {string} chunkKey
   * @returns {object|null}
   */
  ensureChunkSnapshot(chunkKey) {
    const persistence = this.getPersistenceService();
    if (!persistence?.cache) return null;

    let chunkData = persistence.cache.get(chunkKey);
    if (!chunkData) {
      chunkData = { blocks: {}, entities: {} };
      persistence.cache.set(chunkKey, chunkData);
    }
    if (!chunkData.entities) chunkData.entities = {};
    if (!Array.isArray(chunkData.entities.minecarts)) {
      chunkData.entities.minecarts = [];
    }
    return chunkData;
  }

  /**
   * 将矿车写入归属 Chunk 快照
   * @param {Minecart} minecart
   */
  saveMinecartToSnapshot(minecart) {
    const persistence = this.getPersistenceService();
    if (!persistence) return;

    const entry = minecart.toJSON();
    const chunkKey = this.getChunkKeyByPosition(entry);
    const chunkData = this.ensureChunkSnapshot(chunkKey);
    if (!chunkData) return;

    const list = chunkData.entities.minecarts;
    const posKey = this.getPositionKey(entry);
    const idx = list.findIndex(item => this.getPositionKey(item) === posKey);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.push(entry);
    }

    const [cx, cz] = chunkKey.split(',').map(Number);
    persistence.saveChunkData?.(cx, cz, chunkData);
  }

  /**
   * 从归属 Chunk 快照中移除矿车
   * @param {Minecart} minecart
   */
  removeMinecartFromSnapshot(minecart) {
    const persistence = this.getPersistenceService();
    if (!persistence) return;

    const entry = minecart.toJSON();
    const chunkKey = this.getChunkKeyByPosition(entry);
    const chunkData = this.ensureChunkSnapshot(chunkKey);
    if (!chunkData) return;

    const list = chunkData.entities.minecarts;
    const posKey = this.getPositionKey(entry);
    const idx = list.findIndex(item => this.getPositionKey(item) === posKey);
    if (idx >= 0) {
      list.splice(idx, 1);
    }

    const [cx, cz] = chunkKey.split(',').map(Number);
    persistence.saveChunkData?.(cx, cz, chunkData);
  }

  /**
   * 从快照恢复矿车
   * @param {string} chunkKey - Chunk 键
   * @param {Object} chunkData - Chunk 数据
   */
  restoreFromSnapshot(chunkKey, chunkData) {
    if (!chunkData?.entities?.minecarts) return;

    const minecartsData = chunkData.entities.minecarts;
    for (const data of minecartsData) {
      // 检查是否已存在
      const posKey = this.getPositionKey(data);
      if (this.positionIndex.has(posKey)) continue;

      // 创建矿车实例
      const minecart = Minecart.fromJSON(data, this.scene, this.world);
      minecart.chunkKey = chunkKey;
      minecart.onDestroy = (id) => this.onMinecartDestroyed(id);

      // 添加到管理结构
      this.minecarts.set(minecart.id, minecart);
      this.positionIndex.set(posKey, minecart.id);
    }
  }

  /**
   * 更新所有矿车
   * @param {number} deltaTime - 时间增量（秒）
   */
  update(deltaTime) {
    for (const minecart of this.minecarts.values()) {
      minecart.update(deltaTime);
    }
  }

  /**
   * 销毁所有矿车
   */
  destroyAll() {
    for (const minecart of this.minecarts.values()) {
      minecart.destroy();
    }
    this.minecarts.clear();
    this.positionIndex.clear();
  }

  /**
   * 获取矿车数量
   * @returns {number}
   */
  getCount() {
    return this.minecarts.size;
  }
}