// src/ui/Inventory.js
import { materials } from '../core/materials/MaterialManager.js';

/**
 * 物品颜色配置表（与HUD.js中的相同）
 * 确保UI中物品颜色的一致性
 */
const ITEMS = {
  'dirt': { col: '#5D4037' }, 'stone': { col: '#757575' }, 'wood': { col: '#5D4037' }, 'birch_log': { col: '#F0EAD6' },
  'sand': { col: '#E6C288' }, 'planks': { col: '#C19A6B' }, 'oak_planks': { col: '#C19A6B' }, 'white_planks': { col: '#F0F0F0' }, 'cactus': { col: '#2E8B57' },
  'diamond': { col: '#00FFFF' }, 'gold': { col: '#FFD700' }, 'apple': { col: '#FF0000' },
  'flower': { col: '#FF4444' }, 'short_grass': { col: '#559944' }, 'car': { col: '#333333' },
  'cloud': { col: '#FFFFFF' }, 'sky_stone': { col: '#DDDDDD' }, 'sky_wood': { col: '#DDA0DD' },
  'gold_apple': { col: '#FFD700' }, 'god_sword': { col: '#9400D3' },
  'moss': { col: '#4B6E31' }, 'azalea_log': { col: '#635338' },
  'cobblestone': { col: '#8B8B8B' },
  'obsidian': { col: '#2E2E2E' },
  'mossy_stone': { col: '#6B8E23' },
  'blue_planks': { col: '#4A90E2' },
  'end_stone': { col: '#DEE0A3' },
  'green_planks': { col: '#4B6E31' },
  'hay_bale': { col: '#F5DEB3' },
  'azalea_leaves': { col: '#4A6B30' }, 'azalea_flowers': { col: '#7A9B50' },
  'vine': { col: '#355E3B' }, 'lilypad': { col: '#228B22' }
};

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
      if (e.code === 'KeyZ') this.toggle();
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

      // 使用Canvas生成物品图标（与HUD相同）
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      const itemDef = ITEMS[slot.item] || { col: '#fff' }; // 获取物品颜色配置，默认白色

      // 尝试从材质管理器获取贴图
      let iconDrawn = false;
      const mat = materials.getMaterial(slot.item);
      if (mat) {
        const texture = Array.isArray(mat) ? mat[0].map : mat.map;
        if (texture) {
          const imgObj = texture.image || (texture.source && texture.source.data);
          if (imgObj) {
            ctx.drawImage(imgObj, 4, 4, 24, 24);
            iconDrawn = true;
          }
        }
      }

      if (!iconDrawn) {
        // 绘制物品图标（基于颜色配置 fallback）
        ctx.fillStyle = itemDef.col;
        ctx.fillRect(4, 4, 24, 24);
      }

      ctx.strokeStyle = '#000';
      ctx.strokeRect(4, 4, 24, 24);

      // 创建图像元素和数量显示
      const img = document.createElement('img');
      img.src = c.toDataURL();

      const countSpan = document.createElement('span');
      countSpan.className = 'count';
      countSpan.innerText = slot.count;

      // 点击物品槽选择该物品
      div.onclick = () => {
        inventory.selectedSlot = idx;
        this.render(); // 重新渲染以更新选中状态
      };

      div.append(img, countSpan);
      this.gridEl.appendChild(div);
    });
  }
}
