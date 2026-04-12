# Quickstart: 跨 Chunk 材质合批验证

## 启动游戏

```bash
npm run start
# 浏览器打开 http://localhost:8080
```

## 验证方法

### 1. 查看合批统计

游戏加载完成后，打开浏览器控制台（F12），输入：

```javascript
window.game.batchManager.getStats()
```

输出示例：
```
=== 跨 Chunk 合批统计 ===
启用状态: true
总 Draw Call: 15
总实例数: 28456
活跃区块: 49
纹理组数: 15

各组详情:
  [stone]      区块: 42  实例: 8920
  [grass_top]  区块: 39  实例: 6340
  [dirt]       区块: 41  实例: 5100
  ...
```

### 2. 对比优化前后

```javascript
// 关闭合批（回退到逐 Chunk 渲染）
window.game.batchManager.enabled = false

// 等待几秒观察帧率变化后重新开启
window.game.batchManager.enabled = true
```

### 3. 查看渲染器 draw call 数

```javascript
// Three.js 渲染信息
window.game.engine.renderer.info.render.calls
```

### 4. 验证方块操作正确性

在区块边界处：
1. 放置方块 → 应立即显示，无闪烁
2. 移除方块 → 应立即消失，无残影
3. 快速连续操作 → 画面保持一致

## 预期结果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| Draw Call（视距3） | ~490 | ~15-20 |
| 帧率影响 | 基线 | 不低于基线 |
| 方块操作 | 正确 | 正确（无变化） |
