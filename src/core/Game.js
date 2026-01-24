// src/core/Game.js
// 游戏主类，负责协调游戏引擎、世界、玩家和UI的初始化与运行循环

import { Engine } from './Engine.js';
import { World } from '../world/World.js';
import { UIManager } from '../ui/UIManager.js';
import { Player } from '../entities/player/Player.js';
import { realisticTreeManager } from '../world/entities/RealisticTreeManager.js';

/**
 * 游戏主类，负责初始化游戏核心组件并管理游戏循环
 */
export class Game {
  /**
   * 构造函数，初始化游戏引擎、世界、玩家和UI
   */
    constructor() {
  // 初始化游戏引擎（Three.js 场景、相机、渲染器等）
  this.engine = new Engine();
  // 初始化游戏世界（地形、区块等）
  this.world = new World(this.engine.scene);
  // 初始化玩家角色
  this.player = new Player(this.world, this.engine.camera);
  this.player.game = this; // 将游戏实例传递给玩家对象
  this.ui = new UIManager(this); // 初始化UI管理器，传递游戏实例
  this.isRunning = false; // 游戏运行状态标志

  this.lastTime = 0; // 用于计算时间差的时间戳

  // 初始化树木管理器（用于生成逼真树木）
  realisticTreeManager.init();

  // 初始化玩家背包，添加默认物品
  this.player.inventory.add('dirt', 1000);
  this.player.inventory.add('wood', 1000);
}

/**
 * 启动游戏循环
 */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop();
    }

/**
 * 停止游戏循环
 */
    stop() {
        this.isRunning = false;
    }

/**
 * 游戏主循环，使用 requestAnimationFrame 实现循环调用
 * 计算时间差并调用更新和渲染方法
 */
    loop() {
        if (!this.isRunning) return;
        requestAnimationFrame(() => this.loop());

const time = performance.now();
const dt = (time - this.lastTime) / 1000; // 计算时间差（秒）
this.lastTime = time;

this.update(dt); // 更新游戏状态
this.render();   // 渲染场景
    }

  /**
   * 更新游戏状态
   * @param {number} dt - 时间差（秒），自上一帧以来的时间
   */
    update(dt) {
        if (this.player) this.player.update(dt); // 更新玩家状态（移动、物理等）
        if (this.world && this.player) this.world.update(this.player.position, dt); // 更新世界状态（区块加载等）
        if (this.ui) this.ui.update(dt); // 更新UI

  // 更新光源与太阳位置使其跟随玩家
  if (this.player) {
    // 太阳位置：玩家位置 + 太阳方向 * 150 (保持在远景)
    if (this.engine.sunSprite) {
      this.engine.sunSprite.position.copy(this.player.position).addScaledVector(this.engine.sunDirection, 150);
    }

    // 光源位置：玩家位置 + 太阳方向 * 50 (确保阴影覆盖玩家周围区域)
    if (this.engine.light) {
      this.engine.light.position.copy(this.player.position).addScaledVector(this.engine.sunDirection, 50);
      this.engine.light.target.position.copy(this.player.position);
      this.engine.light.target.updateMatrixWorld();
    }
  }
    }

  /**
   * 渲染游戏场景
   */
    render() {
        this.engine.render(); // 调用引擎渲染方法
    }
}
