# Quickstart: Manual Save System

## 开发步骤

### 1. 基础架构
- 创建 `src/constants/SaveConfig.js` 定义新数据库 `mc_lite_manual_saves`。
- 创建 `src/workers/ManualSaveWorker.js` 实现异步 IndexedDB 读写。
- 创建 `src/services/ManualSaveService.js` 作为主线程与 Worker 通信的接口。

### 2. UI 集成
- 在 `index.html` 中添加 `save-game-btn` 按钮到设置模态框。
- 在 `index.html` 中添加 `load-save-prompt` 模态框，包含“加载存档”和“新世界”按钮。
- 在 `UIManager.js` 中绑定存档按钮事件，并处理启动时的模态框显示。

### 3. 数据流实现
- 在 `Game.js` 中增加 `saveToDisk()` 方法：提取 `player` 状态和 `persistenceService.cache`。
- 修改 `index.html` 的 `main()` 函数：
  1. 调用 `manualSaveService.checkSaveExists()`。
  2. 如果存在，显示提示框并等待用户选择。
  3. 如果选择加载，获取数据并传给 `new Game(saveData)`。

### 4. 逻辑注入
- 修改 `Player` 构造函数或增加初始化方法，使其支持从存档数据恢复位置。
- 修改 `PersistenceService` 增加一个手动注入缓存的方法，供加载存档时使用。

## 验证流程
1. 进入游戏，挖掘一些方块并放置一些方块。
2. 移动到一个特定的坐标。
3. 打开设置，点击“存档”。
4. 确认出现“存档成功”提示。
5. 刷新页面。
6. 确认出现“发现存档”提示框。
7. 选择“加载存档”，验证位置和方块是否完全一致。
8. 再次刷新，选择“新世界”，验证是否回到了随机出生点且世界恢复初始。
9. 第三次刷新，验证“加载存档”仍然可用（证明新世界没有覆盖存档）。
