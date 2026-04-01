/**
 * 光源管理器
 * 负责追踪发光方块并创建对应的 PointLight
 * 支持动态方块和合并后的 InstancedMesh 两种场景
 */

import * as THREE from 'three';
import { getBlockProperties } from '../constants/BlockData.js';

/**
 * 光源配置
 * 根据方块类型定义不同的光源参数
 */
const LIGHT_CONFIGS = {
  'hanging_lamp': {
    color: '#FFE4B5',      // 柔和暖黄色
    intensity: 0.8,        // 光源强度
    distance: 5,           // 照亮半径（方块数）
    decay: 2               // 光照衰减
  },
  'glowstone': {
    color: '#FFAA33',      // 萤石橙色光
    intensity: 0.6,
    distance: 8,
    decay: 2
  },
  'ochre_froglight': {
    color: '#FFDD77',      // 赭色蛙明灯暖黄光
    intensity: 0.5,
    distance: 6,
    decay: 2
  },
  'lava': {
    color: '#FF3300',      // 岩浆红橙色光
    intensity: 0.7,
    distance: 10,
    decay: 2
  }
};

/**
 * 默认光源配置
 */
const DEFAULT_LIGHT_CONFIG = {
  color: '#FFFFFF',
  intensity: 0.5,
  distance: 5,
  decay: 2
};

/**
 * 光源管理器类
 */
export class LightSourceManager {
  /**
   * 构造函数
   * @param {THREE.Scene} scene - Three.js 场景对象
   */
  constructor(scene) {
    this.scene = scene;
    this.lights = new Map();  // 光源映射表：key -> PointLight
  }

  /**
   * 判断方块是否为光源
   * @param {string} type - 方块类型
   * @returns {boolean}
   */
  isLightSource(type) {
    const props = getBlockProperties(type);
    return props.isLightSource === true;
  }

  /**
   * 获取方块的光源配置
   * @param {string} type - 方块类型
   * @returns {Object} 光源配置对象
   */
  getLightConfig(type) {
    return LIGHT_CONFIGS[type] || DEFAULT_LIGHT_CONFIG;
  }

  /**
   * 添加光源
   * @param {number} x - 方块 X 坐标（世界坐标）
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {string} type - 方块类型
   */
  addLight(x, y, z, type) {
    const key = `${x},${y},${z}`;

    // 如果已存在光源，先移除
    if (this.lights.has(key)) {
      this.removeLight(x, y, z);
    }

    const config = this.getLightConfig(type);

    // 创建 PointLight
    const light = new THREE.PointLight(
      new THREE.Color(config.color),
      config.intensity,
      config.distance,
      config.decay
    );

    // 设置光源位置（灯体中心）
    // 吊灯灯体在方块正中间
    const offsetY = type === 'hanging_lamp' ? 0 : 0.5;
    light.position.set(x + 0.5, y + offsetY + 0.5, z + 0.5);

    // 添加到场景
    this.scene.add(light);

    // 存储到映射表
    this.lights.set(key, { light, type });
  }

  /**
   * 移除光源
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   */
  removeLight(x, y, z) {
    const key = `${x},${y},${z}`;

    if (!this.lights.has(key)) return;

    const { light } = this.lights.get(key);

    // 从场景移除
    this.scene.remove(light);

    // 释放资源
    light.dispose();

    // 从映射表删除
    this.lights.delete(key);
  }

  /**
   * 更新光源（方块类型变化时）
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {string} newType - 新方块类型（如果为空则移除光源）
   */
  updateLight(x, y, z, newType) {
    // 如果新方块不是光源，移除光源
    if (!newType || !this.isLightSource(newType)) {
      this.removeLight(x, y, z);
      return;
    }

    // 如果是光源，添加/更新
    this.addLight(x, y, z, newType);
  }

  /**
   * 批量添加光源（用于区块加载时）
   * @param {Array<{x: number, y: number, z: number, type: string}>} blocks - 方块位置和类型数组
   */
  addLightsBatch(blocks) {
    for (const block of blocks) {
      if (this.isLightSource(block.type)) {
        this.addLight(block.x, block.y, block.z, block.type);
      }
    }
  }

  /**
   * 批量移除光源（用于区块卸载时）
   * @param {Array<{x: number, y: number, z: number}>} positions - 方块位置数组
   */
  removeLightsBatch(positions) {
    for (const pos of positions) {
      this.removeLight(pos.x, pos.y, pos.z);
    }
  }

  /**
   * 清除所有光源
   */
  clearAllLights() {
    for (const { light } of this.lights.values()) {
      this.scene.remove(light);
      light.dispose();
    }
    this.lights.clear();
  }

  /**
   * 获取光源数量
   * @returns {number}
   */
  getLightCount() {
    return this.lights.size;
  }
}