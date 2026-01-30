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
    this.player.inventory.add('stone', 1000);
    this.player.inventory.add('dirt', 1000);
    this.player.inventory.add('planks', 1000);
    this.player.inventory.add('wood', 1000);
    this.player.inventory.add('glass_block', 1000);
    this.player.inventory.add('cobblestone', 1000);
    this.player.inventory.add('blue_planks', 1000);
    this.player.inventory.add('glass_blink', 1000);
    this.player.inventory.add('end_stone', 1000);
    this.player.inventory.add('green_planks', 1000);
    this.player.inventory.add('hay_bale', 1000);
    this.player.inventory.add('moss', 1000);
    this.player.inventory.add('bookbox', 1000);
    this.player.inventory.add('mossy_stone', 1000);
    this.player.inventory.add('oak_planks', 1000);
    this.player.inventory.add('swamp_grass', 1000);
    this.player.inventory.add('bricks', 1000);
    this.player.inventory.add('white_planks', 1000);
    this.player.inventory.add('birch_log', 1000);
    this.player.inventory.add('obsidian', 1000);
    this.player.inventory.add('sand', 1000);
    this.player.inventory.add('grass', 1000);
    this.player.inventory.add('dark_planks', 1000);
    this.player.inventory.add('diamond', 1000);
    this.player.inventory.add('gold', 1000);
    this.player.inventory.add('gold_ore', 1000);
    this.player.inventory.add('leaves', 1000);
    this.player.inventory.add('flower', 1000);
    this.player.inventory.add('short_grass', 1000);
    this.player.inventory.add('allium', 1000);
    this.player.inventory.add('gold_block', 1000);
    this.player.inventory.add('emerald', 1000);
    this.player.inventory.add('amethyst', 1000);
    this.player.inventory.add('debris', 1000);
    this.player.inventory.add('iron', 1000);
    this.player.inventory.add('iron_ore', 1000);
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
      // 性能优化：只有当玩家移动超过一定阈值时才更新灯光和天空的位置
      // 这可以显著减少每帧重复的矩阵计算和光源更新，同时减少阴影在微小移动时的抖动
      const distSq = this.player.position.distanceToSquared(this.engine._lastUpdatePos);
      if (distSq > 25) { // 阈值设定为 5个单位距离的平方 (5 * 5 = 25)，即移动超过5格时才同步位置

        // 太阳位置：使太阳始终在距离玩家 150 单位远的位置同步移动，模拟无限远的效果
        if (this.engine.sunSprite) {
          this.engine.sunSprite.position.copy(this.player.position)
            .addScaledVector(this.engine.sunDirection, 150);
        }

        // 天空球位置：始终以玩家为中心，确保玩家无论移动多远都无法到达天空边界
        /* if (this.engine.skyMesh) {
          this.engine.skyMesh.position.copy(this.player.position);
        } */

        // 光源位置：同步移动阴影投射光源，60 是光源相对于玩家的偏移距离，确保阴影覆盖玩家周围区域
        if (this.engine.light) {
          this.engine.light.position.copy(this.player.position)
            .addScaledVector(this.engine.sunDirection, 60);
          this.engine.light.target.position.copy(this.player.position); // 光源始终指向玩家

          // 更新记录位置，用于下一次距离检测
          this.engine._lastUpdatePos.copy(this.player.position);
        }
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
