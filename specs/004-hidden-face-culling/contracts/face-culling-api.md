# Face Culling System API Contract

**Feature**: 004-hidden-face-culling
**Date**: 2026-01-28
**Type**: JavaScript Module Interface

## 概述

隐藏面剔除系统提供程序化接口，用于管理方块可见面状态的计算、更新和监控。

## 核心接口

### FaceCullingSystem 类

```typescript
class FaceCullingSystem {
  // 构造函数
  constructor(config?: FaceCullingConfig);

  // 系统控制
  enable(): void;
  disable(): void;
  isEnabled(): boolean;

  // 配置管理
  setTransparentTypes(types: string[]): void;
  addTransparentType(type: string): void;
  removeTransparentType(type: string): void;
  getTransparentTypes(): string[];

  // 可见面计算
  calculateFaceVisibility(block: Block, neighbors: NeighborBlocks): number;
  updateChunk(chunk: Chunk): void;
  updateBlock(position: Vector3): void;
  updateNeighbors(position: Vector3): void;
  batchUpdate(positions: Vector3[]): void;
  forceUpdate(): void;

  // 调试和监控
  toggleDebug(): void;
  setDebugMode(enabled: boolean): void;
  isDebugMode(): boolean;
  getStats(): PerformanceStats;
  resetStats(): void;

  // 错误处理
  getLastError(): string | null;
  getErrorCount(): number;
  clearErrors(): void;

  // 事件系统
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  emit(event: string, data?: any): void;
}
```

## 数据类型

### FaceCullingConfig

```typescript
interface FaceCullingConfig {
  enabled?: boolean;              // 初始启用状态，默认true
  debugMode?: boolean;            // 调试模式，默认false
  transparentTypes?: string[];    // 透明方块类型列表
  updateThreshold?: number;       // 更新耗时阈值(ms)，默认16
  errorLimit?: number;            // 错误次数限制，默认10
  batchSize?: number;            // 批量更新大小，默认64
  cacheNeighbors?: boolean;       // 缓存相邻关系，默认true
  lazyUpdate?: boolean;          // 懒更新，默认true
}
```

### Block

```typescript
interface Block {
  position: Vector3;              // 世界坐标位置
  type: string;                   // 方块类型标识符
  faceVisibility?: number;        // 可见面位掩码（0-63）
  isTransparent?: boolean;        // 是否为透明方块
}
```

### NeighborBlocks

```typescript
interface NeighborBlocks {
  top?: Block | null;     // 上方方块 (Y+)
  bottom?: Block | null;  // 下方方块 (Y-)
  north?: Block | null;   // 北方方块 (Z-)
  south?: Block | null;   // 南方方块 (Z+)
  west?: Block | null;    // 西方方块 (X-)
  east?: Block | null;    // 东方方块 (X+)
}
```

### PerformanceStats

```typescript
interface PerformanceStats {
  enabled: boolean;               // 系统是否启用
  debugMode: boolean;             // 调试模式状态
  totalBlocksProcessed: number;   // 处理的方块总数
  facesCulled: number;           // 剔除的面总数
  facesRendered: number;         // 渲染的面总数
  optimizationRate: number;      // 优化率 (0-1)
  updateTime: number;            // 上次更新时间(ms)
  lastUpdateTime: number;        // 最后更新时间戳
  errorCount: number;            // 错误计数
  lastError: string | null;      // 最后错误信息
  isDegraded: boolean;           // 是否已降级
  degradeReason: string | null;  // 降级原因
}
```

### Vector3

```typescript
interface Vector3 {
  x: number;
  y: number;
  z: number;
}
```

## 方法详细说明

### 系统控制

#### `enable(): void`
启用隐藏面剔除系统。如果系统之前被禁用，会重新计算所有加载区块的可见面状态。

**前置条件**: 无
**后置条件**: `isEnabled() === true`
**副作用**: 可能触发大量计算

#### `disable(): void`
禁用隐藏面剔除系统。所有面都会渲染，但系统状态保持。

**前置条件**: 无
**后置条件**: `isEnabled() === false`
**副作用**: 帧率可能下降

#### `isEnabled(): boolean`
检查系统是否启用。

**返回**: `true`如果系统启用，`false`如果禁用

### 配置管理

#### `setTransparentTypes(types: string[]): void`
设置透明方块类型列表。

**参数**:
- `types`: 透明方块类型标识符数组

**前置条件**: 无
**后置条件**: `getTransparentTypes()`返回新列表
**副作用**: 可能触发可见面重新计算

#### `addTransparentType(type: string): void`
添加单个透明方块类型。

**参数**:
- `type`: 方块类型标识符

**前置条件**: 无
**后置条件**: 类型添加到透明类型集合
**副作用**: 可能触发可见面重新计算

#### `removeTransparentType(type: string): void`
移除透明方块类型。

**参数**:
- `type`: 方块类型标识符

**前置条件**: 类型存在于透明类型集合
**后置条件**: 类型从透明类型集合移除
**副作用**: 可能触发可见面重新计算

#### `getTransparentTypes(): string[]`
获取当前透明方块类型列表。

**返回**: 透明方块类型标识符数组

### 可见面计算

#### `calculateFaceVisibility(block: Block, neighbors: NeighborBlocks): number`
计算单个方块的可见面位掩码。

**参数**:
- `block`: 要计算的方块
- `neighbors`: 六个相邻位置的方块

**返回**: 6位位掩码（0-63），表示哪些面可见

**算法**:
1. 如果`block.isTransparent`为true，返回63（所有面可见）
2. 对每个方向，如果相邻位置为空或透明，对应位设为1
3. 否则对应位设为0

#### `updateChunk(chunk: Chunk): void`
更新整个区块的可见面状态。

**参数**:
- `chunk`: 要更新的区块

**前置条件**: 区块已加载，系统启用
**后置条件**: 区块内所有方块的`faceVisibility`更新
**性能**: O(n)，n为区块内方块数

#### `updateBlock(position: Vector3): void`
更新单个方块及其相邻方块的可见面状态。

**参数**:
- `position`: 方块世界坐标

**前置条件**: 位置有效，系统启用
**后置条件**: 目标方块和6个相邻方块的`faceVisibility`更新
**性能**: O(1)

#### `updateNeighbors(position: Vector3): void`
更新指定位置周围6个相邻方块的可见面状态。

**参数**:
- `position`: 中心位置

**前置条件**: 位置有效，系统启用
**后置条件**: 6个相邻方块的`faceVisibility`更新
**性能**: O(1)

#### `batchUpdate(positions: Vector3[]): void`
批量更新多个方块的可见面状态。

**参数**:
- `positions`: 位置数组

**前置条件**: 所有位置有效，系统启用
**后置条件**: 所有位置及其相邻方块的`faceVisibility`更新
**性能**: O(n)，但比单独调用`updateBlock`高效

#### `forceUpdate(): void`
强制重新计算所有加载区块的可见面状态。

**前置条件**: 系统启用
**后置条件**: 所有区块的可见面状态重新计算
**性能**: 高开销，谨慎使用

### 调试和监控

#### `toggleDebug(): void`
切换调试模式。

**前置条件**: 无
**后置条件**: `isDebugMode()`状态取反
**副作用**: 可能影响渲染性能

#### `setDebugMode(enabled: boolean): void`
设置调试模式。

**参数**:
- `enabled`: 是否启用调试模式

**前置条件**: 无
**后置条件**: `isDebugMode() === enabled`

#### `isDebugMode(): boolean`
检查是否处于调试模式。

**返回**: `true`如果调试模式启用

#### `getStats(): PerformanceStats`
获取性能统计信息。

**返回**: 当前性能统计对象

#### `resetStats(): void`
重置性能统计。

**前置条件**: 无
**后置条件**: 所有统计计数器归零

### 错误处理

#### `getLastError(): string | null`
获取最后错误信息。

**返回**: 错误描述字符串，或`null`如果没有错误

#### `getErrorCount(): number`
获取错误计数。

**返回**: 累计错误次数

#### `clearErrors(): void`
清除错误记录。

**前置条件**: 无
**后置条件**: 错误计数归零，最后错误清空

### 事件系统

系统支持以下事件：

#### `enabled`
系统启用时触发。

**数据**: 无

#### `disabled`
系统禁用时触发。

**数据**: `{ reason: string }` - 禁用原因

#### `error`
发生错误时触发。

**数据**: `{ error: string, count: number }` - 错误信息和累计计数

#### `update`
可见面状态更新完成时触发。

**数据**: `PerformanceStats` - 更新后的统计信息

#### `degraded`
系统降级时触发。

**数据**: `{ reason: string, stats: PerformanceStats }` - 降级原因和当前统计

## 使用示例

### 基本使用
```javascript
const system = new FaceCullingSystem();

// 配置透明方块
system.setTransparentTypes(['air', 'water', 'glass', 'ice']);

// 启用系统
system.enable();

// 监听事件
system.on('update', (stats) => {
  console.log(`优化率: ${(stats.optimizationRate * 100).toFixed(1)}%`);
});

// 更新单个方块
system.updateBlock(new THREE.Vector3(10, 64, 20));
```

### 批量操作
```javascript
// 批量放置方块时
const positions = [
  new THREE.Vector3(10, 64, 20),
  new THREE.Vector3(11, 64, 20),
  new THREE.Vector3(10, 65, 20)
];

system.batchUpdate(positions);
```

### 调试和监控
```javascript
// 启用调试
system.toggleDebug();

// 获取统计
const stats = system.getStats();
if (stats.optimizationRate < 0.3) {
  console.warn('优化率低于预期:', stats);
}

// 检查错误
if (stats.errorCount > 0) {
  console.error('系统错误:', system.getLastError());
}
```

## 错误代码

### 系统错误
- `E001`: 算法执行超时
- `E002`: 内存分配失败
- `E003`: 无效方块位置
- `E004`: 区块数据损坏
- `E005`: 位掩码计算错误

### 配置错误
- `C001`: 无效透明方块类型
- `C002`: 配置参数超出范围
- `C003`: 重复类型定义

### 性能警告
- `W001`: 优化率低于阈值
- `W002`: 更新耗时过长
- `W003`: 错误率过高

## 兼容性说明

### Three.js 版本
- 需要 Three.js r158+
- 支持 WebGL 2.0
- 与 InstancedMesh 兼容

### 浏览器支持
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### 内存要求
- 每个区块额外 ~64KB
- 系统本身 ~100KB
- 总内存增加 < 1MB