# StreamingPerf N 键开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 N 键切换 StreamingPerf 控制台日志的读秒输出，并移除 HUD 面板中的装配队列数据显示。

**Architecture:** 在 HUD 类中新增布尔标志位 `_streamingPerfLogEnabled`，默认 `true`，控制 `console.log` 的输出；删除 `perfEl.innerHTML` 的面板更新逻辑。在 Game.js 的 `keydown` 事件监听中增加 `KeyN` 分支来切换该标志位。

**Tech Stack:** Vanilla JS, 项目自定义测试框架 (`src/tests/runner.js`), ESLint

---

### Task 1: 修改 HUD.js — 移除面板显示并添加日志开关标志

**Files:**
- Modify: `src/ui/HUD.js:44-104`
- Test: `src/tests/test-hud.js`

- [ ] **Step 1: 修改 HUD 构造函数**

在 `src/ui/HUD.js` 的 `constructor` 中，在 `perfStats` 声明之后添加 `_streamingPerfLogEnabled` 标志，并初始化时清空 `perfEl`：

```javascript
    this.perfStats = {
      updateFPS: 0,
      renderHotbar: 0,
      renderStreamingPerf: 0
    };

    this._streamingPerfLogEnabled = true; // N 键控制日志输出
    if (this.perfEl) {
      this.perfEl.innerHTML = ''; // 清空旧数据
    }
```

- [ ] **Step 2: 修改 renderStreamingPerf 方法**

将 `renderStreamingPerf` 修改为不再更新面板，只根据标志位决定是否输出 `console.log`：

```javascript
  renderStreamingPerf(now = performance.now()) {
    if (!this.perfEl) return;

    const snapshot = this.game?.world?.consumeStreamingPerfSnapshot?.(now);
    if (!snapshot) return;

    if (this._streamingPerfLogEnabled) {
      console.log('[StreamingPerf]', snapshot);
    }
  }
```

即删除原来的 `this.perfEl.innerHTML = this.formatStreamingPerf(snapshot);` 和 `console.log` 的无条件输出，把 `console.log` 包进 `if (this._streamingPerfLogEnabled)`。

- [ ] **Step 3: 运行 HUD 测试，确认现有测试失败（面板断言应失败）**

Run: `npm run lint`
Expected: lint 通过（此时还未改测试）

打开浏览器访问 `http://localhost:8080/src/tests/index.html`，运行 HUD 测试。
Expected: 测试 `流式性能面板只在每秒快照到达时刷新并输出日志` 失败，因为 `perfEl.textContent` 不再包含装配队列文本。

- [ ] **Step 4: Commit**

```bash
git add src/ui/HUD.js
git commit -m "feat(hud): remove perf panel display and gate console log behind flag"
```

---

### Task 2: 修改 test-hud.js — 更新测试以匹配新行为

**Files:**
- Modify: `src/tests/test-hud.js`

- [ ] **Step 1: 重写 HUD 测试**

将原测试中的面板内容断言替换为日志开关行为的断言。最终测试代码：

```javascript
import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { HUD } from '../ui/HUD.js';

function createSlot(item = null, count = 0) {
  return {
    item,
    count,
    isEmpty() {
      return !this.item || this.count <= 0;
    }
  };
}

describe('HUD', (test) => {
  test('StreamingPerf 日志默认开启且可通过标志位关闭', () => {
    const originalBody = document.body.innerHTML;
    const originalConsoleLog = console.log;
    const logs = [];

    document.body.innerHTML = `
      <div id="hud">
        <div id="perf"></div>
        <div id="msg"></div>
      </div>
      <div id="hotbar"></div>
    `;

    console.log = (...args) => {
      logs.push(args);
    };

    try {
      const snapshot = {
        phase: 'runtime-streaming',
        assemblyQueue: 4,
        mutationQueueBlocks: 120,
        mutationQueueTasks: 3,
        flushBlocksPerSec: 480,
        flushMaxMs: 1.8,
        flushLastProcessedBlocks: 240,
        flushBudgetOps: 600,
        flushBudgetMs: 2,
        deferredPatchChunks: 2,
        deferredPatchBlocks: 40,
        consolidatingChunks: 1,
        loadingChunks: 3,
        readyChunks: 10,
        totalChunks: 14
      };
      const game = {
        player: {
          inventory: {
            selectedSlot: 0,
            slots: [createSlot('stone', 64), createSlot(), createSlot(), createSlot(), createSlot()]
          }
        },
        world: {
          consumeStreamingPerfSnapshot() {
            return snapshot;
          }
        }
      };

      const hud = new HUD(game);
      hud.renderHotbar = () => {};

      // 默认开启：应输出日志，但面板为空
      hud.update(1000);
      assertEqual(document.getElementById('perf').textContent, '', '面板不应再显示装配数据');
      assertEqual(logs.length, 1, '默认状态下应输出一次日志');
      assertTrue(logs[0][0] === '[StreamingPerf]', '日志前缀应为 [StreamingPerf]');

      // 关闭日志
      hud._streamingPerfLogEnabled = false;
      logs.length = 0;
      hud.update(2000);
      assertEqual(logs.length, 0, '关闭标志后不应输出日志');

      // 再次开启
      hud._streamingPerfLogEnabled = true;
      hud.update(3000);
      assertEqual(logs.length, 1, '重新开启后应再次输出日志');
    } finally {
      console.log = originalConsoleLog;
      document.body.innerHTML = originalBody;
    }
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

打开浏览器访问 `http://localhost:8080/src/tests/index.html`，运行 HUD 测试。
Expected: 全部通过。

- [ ] **Step 3: Commit**

```bash
git add src/tests/test-hud.js
git commit -m "test(hud): update tests for streaming perf log toggle"
```

---

### Task 3: 修改 Game.js — 添加 N 键监听

**Files:**
- Modify: `src/core/Game.js:101-107`

- [ ] **Step 1: 在 keydown 事件监听器中插入 N 键分支**

在 `KeyL` 处理之后、`KeyP` 处理之前插入以下代码：

```javascript
      if (e.code === 'KeyN' && !e.repeat) {
        if (this.ui?.hud) {
          this.ui.hud._streamingPerfLogEnabled = !this.ui.hud._streamingPerfLogEnabled;
          const state = this.ui.hud._streamingPerfLogEnabled ? '开启' : '关闭';
          this._showTransientHudMessage(`StreamingPerf: ${state}`);
        }
      }
```

注意 `Game.js` 中 `this.hud` 的引用方式：实际通过 `this.ui.hud` 访问（参见 `KeyP` 处理中的 `this.ui && this.ui.hud && this.ui.hud.msgEl`）。如果 `this.hud` 直接存在，则优先使用 `this.hud`。

经代码确认，Game.js 中既有 `this.ui`（UIManager 实例），也有 `this.hud` 引用（可能直接挂载在 Game 上）。从现有代码看 `this.ui.hud` 和 `this.hud` 可能指向同一对象。为安全起见，使用：

```javascript
      if (e.code === 'KeyN' && !e.repeat) {
        const hud = this.hud || this.ui?.hud;
        if (hud) {
          hud._streamingPerfLogEnabled = !hud._streamingPerfLogEnabled;
          const state = hud._streamingPerfLogEnabled ? '开启' : '关闭';
          console.log(`[StreamingPerf] 日志已${state}`);
          this._showTransientHudMessage(`StreamingPerf: ${state}`);
        }
      }
```

- [ ] **Step 2: 运行 lint 检查**

Run: `npm run lint`
Expected: 通过，无新增警告。

- [ ] **Step 3: 在浏览器中手动验证**

启动开发服务器：`npm run start`
打开 `http://localhost:8080/index.html`
进入游戏后按 N 键，观察：
1. 控制台 `[StreamingPerf]` 日志是否随 N 键切换输出/停止。
2. 是否出现 `StreamingPerf: 开启/关闭` 的 HUD 消息提示。
3. 性能面板（perf）是否不再显示任何装配数据。

- [ ] **Step 4: Commit**

```bash
git add src/core/Game.js
git commit -m "feat(game): toggle streaming perf log with N key"
```

---

## Self-Review

**1. Spec coverage:**
- 删除 HUD 面板装配数据 ✅ Task 1 Step 2
- N 键控制台日志开关 ✅ Task 3 Step 1
- 默认开启 ✅ Task 1 Step 1

**2. Placeholder scan:** 无 TBD/TODO/"implement later"。

**3. Type consistency:** `_streamingPerfLogEnabled` 在 Task 1 定义，Task 2 测试和 Task 3 切换中均使用同一属性名。
