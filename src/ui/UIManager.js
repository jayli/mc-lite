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
    this.initSettings();
  }

  /**
   * 初始化设置界面逻辑
   */
  initSettings() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const settingsClose = document.getElementById('settings-close');
    const btnPerf = document.getElementById('btn-perf');
    const btnMid = document.getElementById('btn-mid');
    const btnQuality = document.getElementById('btn-quality');

    if (!settingsBtn || !settingsModal || !settingsClose) return;

    // 打开设置
    settingsBtn.onclick = (e) => {
      e.stopPropagation(); // 阻止冒泡，防止触发 body 的 requestPointerLock
      settingsModal.style.display = 'flex';
      this.updateActiveButtons(); // 确保打开时显示正确状态
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    };

    // 关闭设置
    settingsClose.onclick = () => {
      settingsModal.style.display = 'none';
      // 点击确定后，尝试重新锁定鼠标（提升体验）
      document.body.requestPointerLock();
    };

    // 分辨率切换
    btnPerf.onclick = (e) => {
      e.stopPropagation();
      this.game.engine.setResolution(0.4);
      this.hud.showMessage('已切换至性能模式 (0.4x)');
      this.updateActiveButtons();
    };
    btnMid.onclick = (e) => {
      e.stopPropagation();
      this.game.engine.setResolution(0.7);
      this.hud.showMessage('已切换至平衡模式 (0.7x)');
      this.updateActiveButtons();
    };
    btnQuality.onclick = (e) => {
      e.stopPropagation();
      this.game.engine.setResolution(1.0);
      this.hud.showMessage('已切换至画质模式 (1.0x)');
      this.updateActiveButtons();
    };

    // 点击背景关闭
    settingsModal.onclick = (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
        document.body.requestPointerLock();
      }
    };
  }

  /**
   * 更新设置按钮的激活状态样式
   */
  updateActiveButtons() {
    const scale = this.game.engine.resolutionScale;
    const btnPerf = document.getElementById('btn-perf');
    const btnMid = document.getElementById('btn-mid');
    const btnQuality = document.getElementById('btn-quality');

    if (!btnPerf || !btnMid || !btnQuality) return;

    btnPerf.classList.toggle('active', scale === 0.4);
    btnMid.classList.toggle('active', scale === 0.7);
    btnQuality.classList.toggle('active', scale === 1.0);
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
