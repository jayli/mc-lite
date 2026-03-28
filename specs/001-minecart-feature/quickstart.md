# Quickstart: Minecart (矿车系统)

**Branch**: `001-minecart-feature` | **Date**: 2026-03-28

## 概述

矿车系统是一个可放置的实体模块，玩家可以在铁轨上放置矿车，矿车会自动与铁轨方向对齐。本功能暂不包含移动逻辑（后续迭代）。

## 快速测试

### 1. 获取矿车物品

在游戏中按 `E` 打开背包，或使用开发者控制台：

```javascript
// 控制台命令
window.game.player.inventory.add('mine_cart', 1)
```

### 2. 放置矿车

1. 在快捷栏选择矿车物品
2. 找到 `sand_train_track` 或 `sand_train_track_corner` 铁轨方块
3. 右键点击铁轨放置矿车
4. 矿车自动对齐铁轨方向

### 3. 拾取矿车

- 对已放置的矿车右键点击即可拾取

### 4. 验证功能

```javascript
// 控制台检查矿车数量
window.game.minecartManager.minecarts.size

// 检查特定位置是否有矿车
window.game.minecartManager.getMinecartAt(x, y, z)

// 获取所有矿车位置
[...window.game.minecartManager.minecarts.values()].map(m => m.position)
```

## 开发调试

### 启动开发服务器

```bash
npm run start
# 访问 http://localhost:8080
```

### 运行测试

```bash
# 访问测试页面
http://localhost:8080/src/tests/index.html
```

### 关键断点位置

| 文件 | 行号 | 用途 |
|------|------|------|
| `MinecartPlacementHandler.js` | place() | 放置逻辑入口 |
| `MinecartManager.js` | createMinecart() | 矿车创建 |
| `Minecart.js` | createVisuals() | 3D模型构建 |
| `Minecart.js` | destroy() | 销毁清理 |

### 常见问题

**Q: 矿车不显示？**
- 检查材质是否正确加载
- 确认 chunk 已加载
- 查看 console 是否有错误

**Q: 放置失败无提示？**
- 确认目标方块是铁轨类型
- 检查该位置是否已有矿车
- 验证背包是否有矿车物品

**Q: 重启后矿车消失？**
- 检查 PersistenceService 是否正常工作
- 确认 chunk 正确保存

## 文件清单

| 文件 | 用途 |
|------|------|
| `src/actors/minecart/Minecart.js` | 矿车实体类 |
| `src/actors/minecart/MinecartManager.js` | 矿车管理器 |
| `src/actors/minecart/MinecartPlacementHandler.js` | 放置处理器 |
| `src/constants/BlockData.js` | 新增 mine_cart 方块定义 |
| `src/core/Game.js` | 持有 MinecartManager |
| `src/assets/textures/minecart_*.png` | 矿车材质 |

## 后续迭代

以下功能不在当前版本范围：

- [ ] 矿车移动（沿铁轨行驶）
- [ ] 玩家乘坐矿车
- [ ] 矿车碰撞推动
- [ ] 动力矿车（自推进）