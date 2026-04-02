# Quickstart: 下雨功能开关

**Feature**: 001-rain-toggle
**Date**: 2026-04-02

## 开发者快速入门

### 1. 理解功能

在游戏配置菜单中新增"下雨"按钮，点击后切换下雨视觉效果。雨滴在玩家周围50米范围内以每秒10-15米速度落下。

### 2. 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `index.html` | 修改 | 添加下雨按钮 HTML 元素 |
| `src/ui/UIManager.js` | 修改 | 添加下雨按钮事件绑定 |
| `src/core/Game.js` | 修改 | 添加 rainState 和 rainEffect 管理 |
| `src/world/effects/RainEffect.js` | 新增 | 下雨效果类（核心实现） |

### 3. HTML 修改（index.html）

在"TNT破坏方块"区域添加下雨按钮：

```html
<!-- 在第105-108行的 setting-combined-box 内添加 -->
<div class="setting-combined-col">
  <span class="setting-title">下雨:</span>
  <button id="btn-rain-toggle" class="btn-small btn-status-toggle">点击开启</button>
</div>
```

位置：在 `btn-tnt-destroy-toggle` 的 `setting-combined-col` 之后，作为新的 `setting-combined-col`。

### 4. UIManager.js 修改

添加按钮引用和事件处理：

```javascript
// 在 initSettings() 中添加按钮引用
const btnRainToggle = document.getElementById('btn-rain-toggle');

// 添加点击事件处理（参考 btnTntDestroyToggle 实现）
if (btnRainToggle) {
  btnRainToggle.onclick = (e) => {
    e.stopPropagation();
    // 防抖检查（100-200ms）
    const now = Date.now();
    if (this.game.rainState.lastToggleTime &&
        now - this.game.rainState.lastToggleTime < 150) {
      return;
    }
    this.game.rainState.lastToggleTime = now;

    // 切换状态
    this.game.toggleRain();
    this.updateActiveButtons();
  };
}

// 在 updateActiveButtons() 中添加按钮状态更新
if (btnRainToggle) {
  const isEnabled = this.game.rainState.enabled;
  btnRainToggle.classList.toggle('active', isEnabled);
  btnRainToggle.innerText = isEnabled ? '点击关闭' : '点击开启';
}
```

### 5. Game.js 修改

添加下雨状态和切换方法：

```javascript
// 在 constructor() 中添加
this.rainState = { enabled: false, lastToggleTime: 0 };
this.rainEffect = null;

// 添加切换方法
toggleRain() {
  this.rainState.enabled = !this.rainState.enabled;
  if (this.rainState.enabled) {
    // 开启下雨
    this.rainEffect = new RainEffect(this.engine.scene);
    this.ui.hud.showMessage('已开启下雨');
  } else {
    // 关闭下雨
    if (this.rainEffect) {
      this.rainEffect.dispose();
      this.rainEffect = null;
    }
    this.ui.hud.showMessage('已关闭下雨');
  }
}

// 在 update() 循环中添加雨滴更新
if (this.rainEffect && this.rainState.enabled) {
  this.rainEffect.update(this.player.position, dt);
}
```

### 6. RainEffect.js 实现（核心）

```javascript
// src/world/effects/RainEffect.js
import * as THREE from 'three';

export class RainEffect {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.particleCount = options.particleCount || 75;
    this.radius = options.radius || 50;
    this.speed = options.speed || 12;

    this.initParticles();
  }

  initParticles() {
    this.positions = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount);

    // 初始化位置和速度
    for (let i = 0; i < this.particleCount; i++) {
      this.resetParticle(i);
      this.velocities[i] = this.speed + Math.random() * 3;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position',
      new THREE.BufferAttribute(this.positions, 3));

    this.material = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: 0.1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);
  }

  resetParticle(i, playerPos = { x: 0, y: 0, z: 0 }) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * this.radius;
    const x = playerPos.x + Math.cos(angle) * r;
    const y = playerPos.y + 30 + Math.random() * 20; // 从高处落下
    const z = playerPos.z + Math.sin(angle) * r;

    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
  }

  update(playerPos, dt) {
    for (let i = 0; i < this.particleCount; i++) {
      // 落下
      this.positions[i * 3 + 1] -= this.velocities[i] * dt;

      // 检查是否落到地面以下
      if (this.positions[i * 3 + 1] < playerPos.y - 5) {
        this.resetParticle(i, playerPos);
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
```

### 7. 测试验证

1. 启动开发服务器：`npm run start`
2. 打开游戏：http://localhost:8080
3. 打开配置菜单（右上角设置按钮）
4. 点击"下雨"按钮，观察雨滴效果
5. 再次点击，验证雨滴消失
6. 快速连续点击，验证防抖生效

### 8. 性能检查

- 打开浏览器性能监控（按 P 键）
- 开启下雨后观察帧率变化
- 验证帧率下降不超过10%