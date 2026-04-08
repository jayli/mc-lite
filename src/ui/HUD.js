// src/ui/HUD.js
import { materials } from '../core/MaterialManager.js';
import { createItemIcon } from '../utils/ItemIconUtils.js';

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
  'marble': { col: '#F2F0E6' },
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
  static iconCache = new Map();

  /**
   * 创建HUD实例
   * @param {Object} game - 游戏主对象
   */
  constructor(game) {
    this.game = game;
    this.hotbarEl = document.getElementById('hotbar');  // 快捷栏DOM元素，用于显示和选择物品
    this.msgEl = document.getElementById('msg');        // 消息显示DOM元素，用于显示系统提示信息
    this.hudEl = document.getElementById('hud');        // HUD容器DOM元素，用于承载所有界面元素

    // FPS 相关变量
    this.lastTime = performance.now();
    this.frames = 0;
    this.fps = 0;

    // 性能监控变量
    this.jankCount = 0;
    this.longTaskCount = 0;
    this.lastFrameTime = performance.now();

    // 渲染节流控制 - 使用布尔标志位 + 目标时间戳避免每帧创建定时器
    this._lastHotbarRenderTime = 0;
    this._throttledRenderQueued = false;  // 是否有待执行的渲染请求
    this._hotbarRenderTargetTime = 0;     // 计划执行的时间戳

    // 快捷栏状态缓存（避免 JSON.stringify）
    this._lastSelectedSlot = -1;
    this._lastSlotItems = null;

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

    // 只有在开启调试模式时才进行性能监控
    if (this.game.showDebugInfo) {
      // 检测 Jank (掉帧)
      const now = performance.now();
      const frameDuration = now - this.lastFrameTime;
      if (frameDuration > 33.3) { // 低于 30FPS 的帧视为 Jank
        this.jankCount++;
      }
      this.lastFrameTime = now;

      // 计算并更新 FPS
      const t1 = performance.now();
      this.updateFPS();
      const t2 = performance.now();

      this.renderHotbar();           // 渲染快捷栏
      const t3 = performance.now();

      // 记录子任务耗时，供 UIManager 读取
      this.perfStats = {
        updateFPS: t2 - t1,
        renderHotbar: t3 - t2
      };
    } else {
      // 非调试模式下，只执行优化的快捷栏渲染
      this.renderHotbar();
    }
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
   * 生成物品图标并缓存
   * @param {string} item - 物品名称
   * @returns {string} - Data URL
   */
  static generateIcon(item) {
    if (this.iconCache.has(item)) {
      return this.iconCache.get(item);
    }

    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d');
    const itemDef = ITEMS[item] || { col: '#fff' };

    let iconDrawn = false;
    const mat = materials.getMaterial(item);
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
      ctx.fillStyle = itemDef.col;
      ctx.fillRect(4, 4, 24, 24);
    }

    ctx.strokeStyle = '#000';
    ctx.strokeRect(4, 4, 24, 24);

    const dataUrl = c.toDataURL();
    this.iconCache.set(item, dataUrl);
    return dataUrl;
  }

  /**
   * 渲染快捷栏
   * 显示玩家背包的前5个物品槽，高亮显示当前选中的物品
   */
  renderHotbar() {
    if (!this.hotbarEl) return;

    // --- 渲染节流优化 (300ms 节流间隔，UI 非关键路径) ---
    const now = performance.now();
    const timeSinceLastRender = now - this._lastHotbarRenderTime;

    if (timeSinceLastRender < 300) {
      // 如果已经有一个等待中的渲染，就不再设置
      if (!this._throttledRenderQueued) {
        this._throttledRenderQueued = true;
        this._hotbarRenderTargetTime = this._lastHotbarRenderTime + 300;
        requestAnimationFrame(() => {
          this._throttledRenderQueued = false;
          // 再次检查时间，确保达到节流间隔
          if (performance.now() >= this._hotbarRenderTargetTime) {
            this.renderHotbar();
          }
        });
      }
      return;
    }
    this._lastHotbarRenderTime = now;
    this._throttledRenderQueued = false;
    // --- 节流结束 ---

    const inventory = this.game.player.inventory;
    const selectedSlot = inventory.selectedSlot;

    // --- 状态检测优化 ---
    // 快速比较：检查选中槽位和前5个槽位的物品/数量是否有变化
    let stateChanged = false;

    // 1. 检查选中槽位
    if (this._lastSelectedSlot !== selectedSlot) {
      stateChanged = true;
      this._lastSelectedSlot = selectedSlot;
    }

    // 2. 检查前5个槽位的物品和数量
    if (!stateChanged) {
      for (let i = 0; i < 5; i++) {
        const slot = inventory.slots[i];
        const lastItem = this._lastSlotItems?.[i];
        if (!lastItem || lastItem.item !== slot.item || lastItem.count !== slot.count) {
          stateChanged = true;
          break;
        }
      }
    }

    // 3. 如果有变化，更新缓存
    if (stateChanged) {
      this._lastSlotItems = inventory.slots.slice(0, 5).map(s => ({ item: s.item, count: s.count }));
    } else {
      // 状态没变，跳过渲染
      return;
    }
    // --- 优化结束 ---

    this.hotbarEl.innerHTML = '';
    // 显示前5个物品槽作为快捷栏
    for (let i = 0; i < 5; i++) {
      const slot = inventory.slots[i];
      const div = document.createElement('div');
      div.className = 'slot' + (i === selectedSlot ? ' selected' : '');

      if (!slot.isEmpty()) {
        // 使用缓存生成的图标（与 Inventory.js 共享逻辑）
        const img = document.createElement('img');
        createItemIcon(img, slot.item, HUD.generateIcon.bind(HUD));

        // 添加物品名称标签（仅在调试模式下显示）
        let nameLabel = null;
        if (this.game.showDebugInfo) {
          nameLabel = document.createElement('div');
          nameLabel.className = 'item-name';
          nameLabel.innerText = slot.item;
        }

        const countSpan = document.createElement('span');
        countSpan.className = 'count';
        countSpan.innerText = slot.count;

        if (nameLabel) {
          div.append(nameLabel, img, countSpan);
        } else {
          div.append(img, countSpan);
        }
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
