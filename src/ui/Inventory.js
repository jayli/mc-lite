// src/ui/Inventory.js
import { HUD } from './HUD.js';

function isDisplayNone(elementId) {
  const element = document.getElementById(elementId);
  if (!element) {
    return null; // 或者抛出错误
  }
  // 获取计算后的样式
  const computedStyle = window.getComputedStyle(element);
  return computedStyle.display === 'none';
}

/**
 * 背包界面管理器
 * 负责背包的打开/关闭、渲染和交互
 */
export class InventoryUI {
  /**
   * 创建背包界面实例
   * @param {Object} game - 游戏主对象
   */
  constructor(game) {
    this.game = game;
    this.modalEl = document.getElementById('inventory-modal');
    this.gridEl = document.getElementById('inventory-grid');
    this.isOpen = false;

    this.setupEvents();
  }

  /**
   * 设置键盘事件监听
   * - Z键：切换背包打开/关闭
   * - 数字键1-5：选择快捷栏物品
   */
  setupEvents() {
    window.addEventListener('keydown', (e) => {
      // 按下 I 键关闭信息看板
      if (e.code === 'KeyI') {
        var hud = document.getElementById("hud");
        var msg = document.getElementById("msg");
        if (hud) {
          if (isDisplayNone("hud")) {
            hud.style.display = "block";
          } else {
            hud.style.display = "none";
          }
        }
        if (msg) {
          if (isDisplayNone("msg")) {
            msg.style.display = "block";
          } else {
            msg.style.display = "none";
          }
        }
        return;
      }
      if (e.code === 'KeyZ' || (e.code === 'Escape' && this.isOpen)) this.toggle();
      // 快捷栏选择键（数字键1-5）
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
        if (this.game.player) {
          this.game.player.inventory.selectedSlot = parseInt(e.code.replace('Digit', '')) - 1;
          // 如果背包打开，重新渲染以更新选中状态
          if (this.isOpen) this.render();
        }
      }
    });
  }

  /**
   * 切换背包的打开/关闭状态
   * 打开时解除指针锁定，关闭时重新锁定
   */
  toggle() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      document.exitPointerLock(); // 解除指针锁定，允许鼠标操作UI
      if (this.modalEl) this.modalEl.style.display = 'flex';
      this.render(); // 渲染背包内容
    } else {
      if (this.modalEl) this.modalEl.style.display = 'none';
      document.body.requestPointerLock(); // 重新锁定指针，恢复游戏控制
    }
  }

  /**
   * 渲染背包网格
   * 显示所有非空的物品槽，允许点击选择物品
   */
  render() {
    if (!this.isOpen || !this.gridEl || !this.game.player) return; // 检查背包是否打开且元素存在

    const inventory = this.game.player.inventory;
    this.gridEl.innerHTML = '';

    inventory.slots.forEach((slot, idx) => {
      // 只渲染非空的物品槽
      if (slot.isEmpty()) return;

      const div = document.createElement('div');
      div.className = 'slot';
      if (idx === inventory.selectedSlot) div.style.borderColor = '#FFFF00';

      // 使用缓存生成的图标（与HUD共享）
      const img = document.createElement('img');
      // 特定物品使用自定义图标
      if (slot.item === 'handrail') {
        img.src = 'src/assets/textures/handrail.png';
      } else if (slot.item === 'handrailA') {
        img.src = 'src/assets/textures/handrailA.png';
      } else if (slot.item === 'handrailB') {
        img.src = 'src/assets/textures/handrailB.png';
      } else if (slot.item === 'pillar') {
        img.src = 'src/assets/textures/pillar.png';
      } else if (slot.item === 'planks_step') {
        img.src = 'src/assets/textures/Oak_Planks_step.png';
      } else {
        img.src = HUD.generateIcon(slot.item);
      }

      // 添加物品名称标签
      const nameLabel = document.createElement('div');
      nameLabel.className = 'item-name';
      nameLabel.innerText = slot.item;

      const countSpan = document.createElement('span');
      countSpan.className = 'count';
      countSpan.innerText = slot.count;

      // 点击物品槽选择该物品
      div.onclick = (e) => {
        e.preventDefault();
        inventory.selectedSlot = idx;
        this.render(); // 重新渲染以更新选中状态
      };

      div.append(nameLabel, img, countSpan);
      this.gridEl.appendChild(div);
    });
  }
}
