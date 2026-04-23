# StreamingPerf N 键开关设计

## 目标
按 **N** 键开启或关闭 `StreamingPerf` 控制台的读秒日志输出，并移除 HUD 面板中的装配队列数据显示。

## 方案
采用方案 A：最小改动，在 HUD 类中添加标志位，在 Game.js 中监听 N 键切换。

## 变更点

### 1. HUD.js
- 删除 `renderStreamingPerf` 中更新 `this.perfEl.innerHTML` 的逻辑，不再在面板上显示装配队列数据。
- 添加 `_streamingPerfLogEnabled` 布尔属性，默认 `true`。
- `renderStreamingPerf` 中仅当 `_streamingPerfLogEnabled` 为 `true` 时执行 `console.log('[StreamingPerf]', snapshot)`。
- 初始化时清空 `perfEl` 内容，防止旧数据残留。

### 2. Game.js
- 在 `keydown` 事件监听中加入 `e.code === 'KeyN' && !e.repeat` 分支。
- 切换 `this.hud._streamingPerfLogEnabled = !this.hud._streamingPerfLogEnabled`。
- 可选：通过 `this.hud.showMessage(...)` 给用户一个状态反馈提示。

### 3. 测试
- `test-hud.js` 中移除对 `perfEl.textContent` 包含装配队列相关文本的断言（因面板不再显示）。
- 新增测试：验证切换 `_streamingPerfLogEnabled` 后，`renderStreamingPerf` 是否抑制/允许 console.log 输出。

## 验收标准
- [ ] 按 N 键可切换控制台 `[StreamingPerf]` 日志的输出与关闭。
- [ ] HUD 性能面板不再显示装配队列、flush 等数据。
- [ ] 默认状态下日志保持输出（与现有行为一致）。
- [ ] lint 检查通过。
