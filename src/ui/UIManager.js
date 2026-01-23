// src/ui/UIManager.js
import { HUD } from './HUD.js';
import { InventoryUI } from './Inventory.js';

/**
 * UI管理器 - 负责协调所有UI组件的初始化和更新
 * 作为UI系统的总控制器，管理HUD和背包界面
 */
export class UIManager {
  /**
   * 创建UI管理器实例
   * @param {Object} game - 游戏主对象，用于访问游戏状态和玩家数据
   */
  constructor(game) {
    this.game = game;
    this.hud = new HUD(game);        // 平视显示器
    this.inventoryUI = new InventoryUI(game); // 背包界面
  }

  /**
   * 更新所有UI组件
   * @param {number} dt - 时间增量（秒）
   */
  update(dt) {
    this.hud.update();  // 更新HUD显示
    // 注意：背包界面只在打开时更新，由用户交互触发
  }
}
