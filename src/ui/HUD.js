// src/ui/HUD.js
import { materials } from '../core/materials/MaterialManager.js';

// 物品颜色配置表 - 用于UI渲染（颜色查找）
// 在实际应用中，这些配置可能来自统一的物品管理器
const ITEMS = {
  'dirt': { col: '#5D4037' }, 'stone': { col: '#757575' }, 'wood': { col: '#5D4037' }, 'birch_log': { col: '#F0EAD6' },
  'sand': { col: '#E6C288' }, 'planks': { col: '#C19A6B' }, 'oak_planks': { col: '#C19A6B' }, 'white_planks': { col: '#F0F0F0' }, 'cactus': { col: '#2E8B57' },
  'diamond': { col: '#00FFFF' }, 'gold': { col: '#FFD700' }, 'apple': { col: '#FF0000' },
  'flower': { col: '#FF4444' }, 'short_grass': { col: '#559944' }, 'car': { col: '#333333' },
  'cloud': { col: '#FFFFFF' }, 'sky_stone': { col: '#DDDDDD' }, 'sky_wood': { col: '#DDA0DD' },
  'gold_apple': { col: '#FFD700' }, 'god_sword': { col: '#9400D3' },
  'moss': { col: '#4B6E31' }, 'azalea_log': { col: '#635338' }, 'yellow_leaves': { col: '#FFD700' },
  'cobblestone': { col: '#8B8B8B' },
  'obsidian': { col: '#2E2E2E' },
  'glass_blink': { col: '#E0F7FA' },
  'mossy_stone': { col: '#6B8E23' },
  'blue_planks': { col: '#4A90E2' },
  'end_stone': { col: '#DEE0A3' },
  'green_planks': { col: '#4B6E31' },
  'hay_bale': { col: '#F5DEB3' },
  'azalea_leaves': { col: '#4A6B30' }, 'azalea_flowers': { col: '#7A9B50' },
  'vine': { col: '#355E3B' }, 'lilypad': { col: '#228B22' }
};

/**
 * 平视显示器（HUD）管理器
 * 负责显示游戏中的实时信息，包括快捷栏和消息提示
 */
export class HUD {
  /**
   * 创建HUD实例
   * @param {Object} game - 游戏主对象
   */
  constructor(game) {
    this.game = game;
    this.hotbarEl = document.getElementById('hotbar');
    this.msgEl = document.getElementById('msg');
    this.hudEl = document.getElementById('hud');

    // FPS 相关变量
    this.lastTime = performance.now();
    this.frames = 0;
    this.fps = 0;

    // 性能监控变量
    this.jankCount = 0;
    this.longTaskCount = 0;
    this.lastFrameTime = performance.now();

    // 监听主线程长任务 (Long Tasks)
    if (window.PerformanceObserver) {
      const observer = new PerformanceObserver((list) => {
        this.longTaskCount += list.getEntries().length;
      });
      try {
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        console.warn('PerformanceObserver longtask observation not supported');
      }
    }
  }

  /**
   * 更新HUD显示
   * 在游戏主循环中调用，更新所有HUD元素
   */
  update() {
    if (!this.game.player) return; // 确保玩家对象存在

    // 检测 Jank (掉帧)
    const now = performance.now();
    const frameDuration = now - this.lastFrameTime;
    if (frameDuration > 33.3) { // 低于 30FPS 的帧视为 Jank
      this.jankCount++;
    }
    this.lastFrameTime = now;

    // 计算并更新 FPS
    this.updateFPS();

    this.renderHotbar();           // 渲染快捷栏
  }

  /**
   * 计算帧率并每秒更新一次显示
   */
  updateFPS() {
    this.frames++;
    const now = performance.now();

    if (now >= this.lastTime + 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));

      let statsText = `FPS: ${this.fps}`;

      // 尝试获取内存信息 (仅限 Chromium 浏览器)
      if (performance.memory) {
        const memoryUsed = Math.round(performance.memory.usedJSHeapSize / 1048576); // 转换为 MB
        statsText += ` | 内存: ${memoryUsed}MB`;
      }

      // 紧跟在 Mem 后面显示性能指标
      if (this.msgEl) {
        const info = this.game.engine.renderer.info.render;
        const perfText = ` | 卡顿: ${this.jankCount} | 长任务: ${this.longTaskCount} | 调用数: ${info.calls} | 三角形数量: ${info.triangles}`;
        this.msgEl.textContent = statsText + perfText;
        this.msgEl.style.opacity = 1; // 确保可见
      }

      // 重置计数器
      this.frames = 0;
      this.jankCount = 0;
      this.longTaskCount = 0;
      this.lastTime = now;
    }
  }

  /**
   * 渲染快捷栏
   * 显示玩家背包的前5个物品槽，高亮显示当前选中的物品
   */
  renderHotbar() {
    if (!this.hotbarEl) return;
    const inventory = this.game.player.inventory;
    const selectedSlot = inventory.selectedSlot;

    this.hotbarEl.innerHTML = '';
    // 显示前5个物品槽作为快捷栏
    for (let i = 0; i < 5; i++) {
      const slot = inventory.slots[i];
      const div = document.createElement('div');
      div.className = 'slot' + (i === selectedSlot ? ' selected' : '');

      if (!slot.isEmpty()) {
        // 如果物品槽非空，则渲染物品图标
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

        div.append(img, countSpan);
      }
      this.hotbarEl.appendChild(div);
    }
  }

  /**
   * 显示临时消息
   * @param {string} text - 要显示的消息文本
   * 消息会在2秒后自动淡出
   */
  showMessage(text) {
    if (!this.msgEl) return;
    this.msgEl.innerText = text;
    this.msgEl.style.opacity = 1;
    // 2秒后淡出
    setTimeout(() => {
      this.msgEl.style.opacity = 0;
    }, 2000);
  }
}
