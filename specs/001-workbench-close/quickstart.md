# Quickstart: 关闭创造台功能

**Feature**: 关闭创造台功能
**Date**: 2026-03-14

## 开发环境准备

```bash
# 启动开发服务器
npm run start

# 访问游戏
open http://localhost:8080

# 访问测试页面
open http://localhost:8080/src/tests/index.html
```

## 功能测试流程

### 测试 1: 正常关闭流程

1. 启动游戏，进入任意地图
2. 按 `Esc` 或点击设置按钮 (⚙) 打开设置
3. 点击 **"打开创造台"** 按钮
4. 等待创造台创建完成（约 1-2 秒）
5. 确认按钮变为 **"关闭创造台"** 且可点击
6. 确认导出按钮显示
7. 点击 **"关闭创造台"**
8. 验证：
   - 显示消息 "创造台已关闭"
   - 创造台方块消失
   - 按钮恢复为 "打开创造台"
   - 导出按钮隐藏

### 测试 2: 玩家在区域内警告

1. 创建创造台
2. 走到创造台平台上
3. 打开设置，点击 **"关闭创造台"**
4. 验证：
   - 显示警告消息 "请离开创造台区域后再关闭"
   - 创造台未被关闭
   - 玩家位置不变
5. 离开创造台区域
6. 再次点击关闭，验证成功

### 测试 3: 重新创建

1. 关闭创造台后
2. 立即点击 **"打开创造台"**
3. 验证新的创造台可以正常创建
4. 验证新创造台功能完整

### 测试 4: 回归测试

1. 关闭创造台后：
   - 测试射击功能 (左键挖掘/射击)
   - 测试丧尸生成 (X 键)
   - 测试存档功能 (设置中保存)
   - 测试其他设置项 (分辨率、丧尸数量)

## 关键代码位置

| 文件 | 行号范围 | 职责 |
|------|----------|------|
| `src/services/PlaygroundService.js` | 220-280 (预估) | 新增 `closePlayground()` 和 `isPlayerInPlayground()` |
| `src/ui/UIManager.js` | 152-200 (预估) | 修改按钮点击处理和状态更新 |
| `src/ui/UIManager.js` | 240-250 (预估) | 修改 `updateActiveButtons()` |

## 调试技巧

```javascript
// 在浏览器控制台中访问
window.game                    // 游戏实例
window.game.world              // 世界实例
playgroundService.isPlaygroundActive    // 创造台状态
playgroundService.playgroundBlocks.size // 方块数量
playgroundService.playgroundOrigin      // 原点坐标

// 快速测试关闭
game.uiManager.playgroundService.closePlayground()
```

## 性能检查点

- 关闭创造台时帧率不应低于 54 FPS (60 FPS 的 90%)
- 1600 个方块删除应在 1 秒内完成
- 内存占用不应持续增长 (可通过 Chrome DevTools Memory 面板检查)
