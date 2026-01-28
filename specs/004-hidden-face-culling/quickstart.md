# Quick Start: 隐藏面剔除优化

**Feature**: 004-hidden-face-culling
**Date**: 2026-01-28

## 概述

隐藏面剔除优化通过减少不可见面的渲染来提升游戏帧率。本指南介绍如何集成、使用和调试该功能。

## 快速集成

### 1. 安装依赖

无需额外依赖，功能基于现有Three.js系统构建。

### 2. 核心文件结构

```
src/core/FaceCullingSystem.js      # 隐藏面剔除系统
src/world/Chunk.js                 # 区块管理（需要修改）
src/world/World.js                 # 世界管理（需要修改）
```

### 3. 初始化系统

```javascript
// 在游戏初始化阶段
import { FaceCullingSystem } from './core/FaceCullingSystem.js';

// 创建系统实例
const faceCullingSystem = new FaceCullingSystem();

// 配置透明方块类型
faceCullingSystem.setTransparentTypes(['air', 'water', 'glass', 'ice', 'stained_glass']);

// 启用系统
faceCullingSystem.enable();
```

### 4. 与现有系统集成

```javascript
// 修改Chunk.js - 在区块加载时计算可见面
class Chunk {
  constructor(cx, cz) {
    // ... 现有代码 ...

    // 计算初始可见面状态
    if (faceCullingSystem.enabled) {
      faceCullingSystem.updateChunk(this);
    }
  }

  // 方块操作时更新可见面
  setBlock(x, y, z, type) {
    // ... 现有方块设置逻辑 ...

    // 更新可见面状态
    if (faceCullingSystem.enabled) {
      const position = new THREE.Vector3(
        this.cx * CHUNK_SIZE + x,
        y,
        this.cz * CHUNK_SIZE + z
      );
      faceCullingSystem.updateBlock(position);
    }
  }
}
```

## 使用方法

### 基本操作

```javascript
// 启用/禁用系统
faceCullingSystem.enable();
faceCullingSystem.disable();

// 切换调试模式
faceCullingSystem.toggleDebug();

// 获取性能统计
const stats = faceCullingSystem.getStats();
console.log(`优化率: ${(stats.optimizationRate * 100).toFixed(1)}%`);
console.log(`剔除面数: ${stats.facesCulled}`);
```

### 方块操作

系统会自动处理以下情况：
1. **放置方块**: 更新新方块及其相邻方块的可见面
2. **移除方块**: 更新相邻方块的可见面
3. **批量操作**: 支持多个方块同时操作的高效更新
4. **区块加载**: 新加载区块的初始可见面计算

### 透明方块处理

系统自动识别透明方块类型：
- 空气 (air)
- 水 (water)
- 玻璃 (glass)
- 冰 (ice)
- 染色玻璃 (stained_glass)

透明方块的相邻面不会被剔除，确保正确视觉效果。

## 调试和监控

### 调试视图

启用调试模式后，可以看到：
- **红色线框**: 被剔除的面（不渲染）
- **绿色线框**: 可见的面（正常渲染）
- **透明方块高亮**: 特殊标记透明方块

```javascript
// 启用调试视图
faceCullingSystem.toggleDebug();

// 或直接设置
faceCullingSystem.setDebugMode(true);
```

### 性能面板

系统提供实时性能数据：
- **帧率提升**: 显示优化前后的帧率对比
- **面剔除统计**: 显示剔除面数和优化率
- **更新耗时**: 显示可见面计算时间
- **错误计数**: 显示算法错误次数

```javascript
// 获取详细统计
const stats = faceCullingSystem.getStats();
console.table({
  '总方块数': stats.totalBlocksProcessed,
  '剔除面数': stats.facesCulled,
  '渲染面数': stats.facesRendered,
  '优化率': `${(stats.optimizationRate * 100).toFixed(1)}%`,
  '更新时间': `${stats.updateTime.toFixed(2)}ms`,
  '错误数': stats.errorCount
});
```

### 控制台命令

在浏览器开发者工具中可用：
```javascript
// 全局访问
window.faceCullingSystem

// 常用命令
window.faceCullingSystem.toggleDebug()      // 切换调试
window.faceCullingSystem.getStats()         // 获取统计
window.faceCullingSystem.forceUpdate()      // 强制全量更新
```

## 故障排除

### 常见问题

#### 1. 视觉错误（面错误显示/隐藏）

**症状**: 方块面应该显示但被隐藏，或应该隐藏但显示

**解决步骤**:
1. 启用调试模式检查可见面状态
2. 验证透明方块类型配置
3. 检查相邻方块关系计算
4. 使用`forceUpdate()`重新计算

#### 2. 性能下降

**症状**: 启用优化后帧率反而下降

**解决步骤**:
1. 检查算法执行时间（`stats.updateTime`）
2. 验证批量更新是否正常工作
3. 检查是否有过多错误导致降级
4. 考虑减少更新范围或优化数据结构

#### 3. 内存使用增加

**症状**: 内存使用明显增加

**解决步骤**:
1. 验证位掩码存储是否正确实现
2. 检查是否有内存泄漏（区块卸载时是否释放）
3. 监控`faceCullingData`数组大小

### 优雅降级

当系统检测到以下问题时会自动降级：
- 算法执行时间超过阈值（>16ms）
- 连续计算错误超过限制
- 内存使用异常

降级后：
1. 所有面都会渲染（禁用优化）
2. 错误信息记录到控制台
3. 游戏保持可玩状态

手动降级：
```javascript
faceCullingSystem.disable();
console.warn('隐藏面剔除已禁用:', faceCullingSystem.lastError);
```

## 性能测试

### 基准测试场景

1. **密集山脉**: 测试大量固体方块的优化效果
2. **森林区域**: 测试植物和透明方块的混合场景
3. **建筑内部**: 测试封闭空间的优化效果
4. **水下场景**: 测试透明方块（水）的特殊处理

### 预期性能指标

- **帧率提升**: 密集区域至少30%提升
- **内存增加**: 每个区块~64KB（可接受）
- **计算时间**: 单次更新<5ms，批量更新<16ms
- **优化率**: 30%-70%的面被剔除

### 测试命令

```javascript
// 运行性能测试
function runPerformanceTest() {
  const beforeFPS = getCurrentFPS();

  // 执行测试场景
  testScenario('mountain');
  testScenario('forest');
  testScenario('building');

  const afterFPS = getCurrentFPS();
  const improvement = ((afterFPS - beforeFPS) / beforeFPS * 100).toFixed(1);

  console.log(`帧率提升: ${improvement}%`);
  console.log('详细统计:', faceCullingSystem.getStats());
}
```

## 高级配置

### 自定义透明方块

```javascript
// 添加自定义透明方块类型
faceCullingSystem.addTransparentType('custom_glass');
faceCullingSystem.addTransparentType('magic_ice');

// 移除透明方块类型
faceCullingSystem.removeTransparentType('water'); // 谨慎使用
```

### 性能调优参数

```javascript
// 调整算法参数
faceCullingSystem.setConfig({
  updateThreshold: 16,      // 更新耗时阈值（ms）
  errorLimit: 10,           // 错误次数限制
  batchSize: 64,            // 批量更新大小
  cacheNeighbors: true,     // 是否缓存相邻关系
  lazyUpdate: true          // 是否懒更新
});
```

### 事件监听

```javascript
// 监听系统事件
faceCullingSystem.on('enabled', () => console.log('系统已启用'));
faceCullingSystem.on('disabled', (reason) => console.log('系统已禁用:', reason));
faceCullingSystem.on('error', (error) => console.error('系统错误:', error));
faceCullingSystem.on('update', (stats) => console.log('状态更新:', stats));
```

## 下一步

1. **集成测试**: 验证与现有系统的兼容性
2. **性能验证**: 确保达到30%帧率提升目标
3. **用户体验测试**: 确保无视觉错误
4. **监控部署**: 在生产环境监控性能指标