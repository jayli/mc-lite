// src/ui/UIManager.js
import { HUD } from './HUD.js';
import { InventoryUI } from './Inventory.js';
import { playgroundService } from '../services/PlaygroundService.js';

/**
 * UI 管理器 - 负责协调所有 UI 组件的初始化和更新
 * 作为 UI 系统的总控制器，管理 HUD 和背包界面
 */
export class UIManager {
  /**
   * 创建 UI 管理器实例
   * @param {Object} game - 游戏主对象，用于访问游戏状态和玩家数据
   */
  constructor(game) {
    this.game = game;
    this.hud = new HUD(game);        // 平视显示器
    this.inventoryUI = new InventoryUI(game); // 背包界面
    // 玩家原始位置存储（闪现前的位置）
    this.originalPlayerPosition = null;
    this.hasTeleported = false;
    // 手动记录的位置（优先级更高）
    this.savedPlayerPosition = null;
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
    const btnSave = document.getElementById('btn-save-game');
    const btnGunDestroyOn = document.getElementById('btn-gun-destroy-on');
    const btnGunDestroyOff = document.getElementById('btn-gun-destroy-off');
    const btnZombie20 = document.getElementById('btn-zombie-20');
    const btnZombie30 = document.getElementById('btn-zombie-30');
    const btnZombie50 = document.getElementById('btn-zombie-50');
    const btnCreatePlayground = document.getElementById('btn-create-playground');
    const btnExportModel = document.getElementById('btn-export-model');
    const btnTeleportFrozen = document.getElementById('btn-teleport-frozen');
    const btnTeleportPyramid = document.getElementById('btn-teleport-pyramid');
    const btnTeleportIsland = document.getElementById('btn-teleport-island');
    const btnTeleportSnow = document.getElementById('btn-teleport-snow');
    const btnReturnOrigin = document.getElementById('btn-return-origin');
    const btnRecordPosition = document.getElementById('btn-record-position');

    // 防重复点击锁
    let isPlaygroundOperationInProgress = false;

    if (!settingsBtn || !settingsModal || !settingsClose) return;

    // 初始化创造台服务（延迟到 world 可用时）
    if (this.game && this.game.world) {
      playgroundService.initialize(this.game.world);
      // 检测是否存在创造台并更新按钮状态
      this.updatePlaygroundButtonState();
    }

    // 打开设置
    settingsBtn.onclick = (e) => {
      e.stopPropagation(); // 阻止冒泡，防止触发 body 的 requestPointerLock

      // 确保创造台服务已初始化
      if (!playgroundService.world && this.game && this.game.world) {
        playgroundService.initialize(this.game.world);
      }

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

    // 枪械破坏设置
    if (btnGunDestroyOn && btnGunDestroyOff) {
      btnGunDestroyOn.onclick = (e) => {
        e.stopPropagation();
        this.game.canGunsDestroyBlocks = true;
        this.hud.showMessage('已开启枪械破坏方块');
        this.updateActiveButtons();
      };
      btnGunDestroyOff.onclick = (e) => {
        e.stopPropagation();
        this.game.canGunsDestroyBlocks = false;
        this.hud.showMessage('已关闭枪械破坏方块');
        this.updateActiveButtons();
      };
    }

    // 丧尸数量设置
    if (btnZombie20 && btnZombie30 && btnZombie50) {
      btnZombie20.onclick = (e) => {
        e.stopPropagation();
        this.game.maxActiveZombies = 20;
        this.game.enemyManager.maxActiveZombies = 20;
        this.hud.showMessage('已设置丧尸数量上限为 20 个');
        this.updateActiveButtons();
      };
      btnZombie30.onclick = (e) => {
        e.stopPropagation();
        this.game.maxActiveZombies = 30;
        this.game.enemyManager.maxActiveZombies = 30;
        this.hud.showMessage('已设置丧尸数量上限为 30 个');
        this.updateActiveButtons();
      };
      btnZombie50.onclick = (e) => {
        e.stopPropagation();
        this.game.maxActiveZombies = 50;
        this.game.enemyManager.maxActiveZombies = 50;
        this.hud.showMessage('已设置丧尸数量上限为 50 个');
        this.updateActiveButtons();
      };
    }

    // 手动存档按钮处理
    if (btnSave) {
      btnSave.onclick = async (e) => {
        e.stopPropagation();
        btnSave.disabled = true;
        btnSave.innerText = '正在存档...';

        try {
          await this.game.saveToDisk();
          this.hud.showMessage('游戏存档成功！');
        } catch (error) {
          console.error('Save failed:', error);
          this.hud.showMessage('存档失败，请重试');
        } finally {
          btnSave.disabled = false;
          btnSave.innerText = '保存当前进度 (存档)';
        }
      };
    }

    // 创造台功能按钮处理
    if (btnCreatePlayground) {
      btnCreatePlayground.onclick = async (e) => {
        e.stopPropagation();

        // 防止重复点击
        if (isPlaygroundOperationInProgress) {
          return;
        }
        isPlaygroundOperationInProgress = true;

        // 确保创造台服务已初始化
        if (!playgroundService.world && this.game && this.game.world) {
          playgroundService.initialize(this.game.world);
        }

        // 获取玩家位置
        const playerPos = this.game.player?.position || this.game.engine.camera.position;

        if (playgroundService.isPlaygroundActive) {
          // 关闭创造台
          const result = playgroundService.closePlayground(playerPos);
          if (result.success) {
            this.hud.showMessage('创造台已关闭');
            btnCreatePlayground.disabled = false;
            btnCreatePlayground.style.background = '#4a90e2';
            btnCreatePlayground.innerText = '打开创造台';
            // 隐藏导出模型按钮
            if (btnExportModel) {
              btnExportModel.style.display = 'none';
            }
          } else if (result.error === 'PLAYER_IN_PLAYGROUND') {
            this.hud.showMessage('请离开创造台区域后再关闭');
          } else {
            this.hud.showMessage('关闭失败：' + result.error);
          }
        } else {
          // 创建创造台
          const result = playgroundService.createPlayground(playerPos);
          if (result.success) {
            this.hud.showMessage('创造台已创建');
            // 更新按钮为关闭状态
            btnCreatePlayground.style.background = '#e74c3c';
            btnCreatePlayground.innerText = '关闭创造台';
            // 显示导出模型按钮
            if (btnExportModel) {
              btnExportModel.style.display = 'block';
            }
          } else {
            if (result.error === 'PLAYGROUND_EXISTS') {
              this.hud.showMessage('创造台已存在');
            } else if (result.error === 'NO_SPACE') {
              this.hud.showMessage('无法找到合适的空间，请移动位置');
            } else {
              this.hud.showMessage('创建失败：' + result.error);
            }
          }
        }

        // 重置操作锁
        isPlaygroundOperationInProgress = false;
      };
    }

    if (btnExportModel) {
      btnExportModel.onclick = (e) => {
        e.stopPropagation();
        const result = playgroundService.exportModel();
        if (result.success) {
          this.hud.showMessage('模型导出成功');
        } else {
          this.hud.showMessage('导出失败：' + result.error);
        }
      };
    }

    // 闪现到地标按钮处理
    this.updateReturnButtonState(); // 初始化返回按钮状态

    if (btnTeleportFrozen) {
      btnTeleportFrozen.onclick = (e) => {
        e.stopPropagation();
        this.teleportToLandmark('frozen', settingsModal);
      };
    }
    if (btnTeleportPyramid) {
      btnTeleportPyramid.onclick = (e) => {
        e.stopPropagation();
        this.teleportToLandmark('pyramid', settingsModal);
      };
    }
    if (btnTeleportIsland) {
      btnTeleportIsland.onclick = (e) => {
        e.stopPropagation();
        this.teleportToLandmark('island', settingsModal);
      };
    }
    if (btnTeleportSnow) {
      btnTeleportSnow.onclick = (e) => {
        e.stopPropagation();
        this.teleportToLandmark('snow', settingsModal);
      };
    }
    if (btnReturnOrigin) {
      btnReturnOrigin.onclick = (e) => {
        e.stopPropagation();
        this.returnToOriginalPosition(settingsModal);
      };
    }
    if (btnRecordPosition) {
      btnRecordPosition.onclick = (e) => {
        e.stopPropagation();
        this.recordCurrentPosition(settingsModal);
      };
    }

    // 点击背景关闭
    settingsModal.onclick = (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
        document.body.requestPointerLock();
      }
    };
  }

  /**
   * 更新创造台按钮状态
   * 根据 playgroundService.isPlaygroundActive 设置按钮显示
   */
  updatePlaygroundButtonState() {
    const btnCreatePlayground = document.getElementById('btn-create-playground');
    const btnExportModel = document.getElementById('btn-export-model');

    if (!btnCreatePlayground) return;

    if (playgroundService.isPlaygroundActive) {
      // 创造台已存在，显示"关闭创造台"按钮
      btnCreatePlayground.disabled = false;
      btnCreatePlayground.style.background = '#e74c3c';
      btnCreatePlayground.innerText = '关闭创造台';
      // 显示导出模型按钮
      if (btnExportModel) {
        btnExportModel.style.display = 'block';
      }
    } else {
      // 创造台不存在，显示"打开创造台"按钮
      btnCreatePlayground.disabled = false;
      btnCreatePlayground.style.background = '#4a90e2';
      btnCreatePlayground.innerText = '打开创造台';
      // 隐藏导出模型按钮
      if (btnExportModel) {
        btnExportModel.style.display = 'none';
      }
    }
  }

  /**
   * 更新设置按钮的激活状态样式
   */
  updateActiveButtons() {
    const scale = this.game.engine.resolutionScale;
    const btnPerf = document.getElementById('btn-perf');
    const btnMid = document.getElementById('btn-mid');
    const btnQuality = document.getElementById('btn-quality');
    const btnGunDestroyOn = document.getElementById('btn-gun-destroy-on');
    const btnGunDestroyOff = document.getElementById('btn-gun-destroy-off');
    const btnZombie20 = document.getElementById('btn-zombie-20');
    const btnZombie30 = document.getElementById('btn-zombie-30');
    const btnZombie50 = document.getElementById('btn-zombie-50');

    if (!btnPerf || !btnMid || !btnQuality) return;

    btnPerf.classList.toggle('active', scale === 0.4);
    btnMid.classList.toggle('active', scale === 0.7);
    btnQuality.classList.toggle('active', scale === 1.0);

    if (btnGunDestroyOn && btnGunDestroyOff) {
      btnGunDestroyOn.classList.toggle('active', this.game.canGunsDestroyBlocks);
      btnGunDestroyOff.classList.toggle('active', !this.game.canGunsDestroyBlocks);
    }

    if (btnZombie20 && btnZombie30 && btnZombie50) {
      btnZombie20.classList.toggle('active', this.game.maxActiveZombies === 20);
      btnZombie30.classList.toggle('active', this.game.maxActiveZombies === 30);
      btnZombie50.classList.toggle('active', this.game.maxActiveZombies === 50);
    }

    // 更新创造台按钮状态
    this.updatePlaygroundButtonState();
  }

  /**
   * 更新所有 UI 组件
   * @param {number} dt - 时间增量（秒）
   */
  update(dt) {
    this.hud.update();  // 更新 HUD 显示
    // 注意：背包界面只在打开时更新，由用户交互触发
  }

  /**
   * 闪现到地标
   * @param {string} landmarkType - 地标类型：'frozen' | 'pyramid' | 'island' | 'snow'
   * @param {HTMLElement} settingsModal - 设置模态框元素
   */
  teleportToLandmark(landmarkType, settingsModal) {
    if (!this.game || !this.game.player) return;

    // 1. 记录当前位置
    this.originalPlayerPosition = {
      x: this.game.player.position.x,
      y: this.game.player.position.y,
      z: this.game.player.position.z
    };
    this.hasTeleported = true;

    // 2. 计算目标位置
    const target = this.game.player.getNearestLandmarkPosition(landmarkType);

    if (!target) {
      this.hud.showMessage('未找到该地标，请尝试移动到其他地方再试');
      return;
    }

    // 3. 获取地表高度
    const surfaceY = this.game.player.getSurfaceHeight(target.x, target.z);

    // 4. 关闭设置面板
    settingsModal.style.display = 'none';

    // 5. 执行闪现（目标 Y 坐标为地表 +10）
    this.game.player.teleportTo(target.x, surfaceY + 10, target.z);

    // 6. 更新返回按钮状态
    this.updateReturnButtonState();

    // 7. 显示提示信息
    const landmarkNames = {
      'frozen': '冰封山峰',
      'pyramid': '金字塔',
      'island': '海岛',
      'snow': '雪地'
    };
    this.hud.showMessage(`已闪现到${landmarkNames[landmarkType] || '目的地'}`);
  }

  /**
   * 返回原位置
   * @param {HTMLElement} settingsModal - 设置模态框元素
   */
  returnToOriginalPosition(settingsModal) {
    // 优先返回手动记录的位置
    const targetPos = this.savedPlayerPosition || this.originalPlayerPosition;
    if (!targetPos || !this.game || !this.game.player) return;

    // 关闭设置面板
    settingsModal.style.display = 'none';

    // 执行返回
    this.game.player.teleportTo(
      targetPos.x,
      targetPos.y,
      targetPos.z
    );

    // 清空记录的位置
    this.savedPlayerPosition = null;
    this.originalPlayerPosition = null;
    this.hasTeleported = false;
    this.updateReturnButtonState();

    this.hud.showMessage('已返回原位置');
  }

  /**
   * 记录当前位置
   * @param {HTMLElement} settingsModal - 设置模态框元素
   */
  recordCurrentPosition(settingsModal) {
    if (!this.game || !this.game.player) return;

    // 记录当前位置
    this.savedPlayerPosition = {
      x: this.game.player.position.x,
      y: this.game.player.position.y,
      z: this.game.player.position.z
    };

    this.updateReturnButtonState();
    this.hud.showMessage('已记录当前位置');
  }

  /**
   * 更新返回按钮状态
   */
  updateReturnButtonState() {
    const btnReturn = document.getElementById('btn-return-origin');
    if (btnReturn) {
      const hasPosition = this.savedPlayerPosition || this.originalPlayerPosition;
      btnReturn.disabled = !hasPosition;
      btnReturn.style.background = hasPosition ? '#4a90e2' : '#999';
    }
  }
}
