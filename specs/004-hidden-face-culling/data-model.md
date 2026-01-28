# Data Model: 隐藏面剔除优化

**Feature**: 004-hidden-face-culling
**Date**: 2026-01-28

## 核心实体

### 1. 方块 (Block)

**描述**: 游戏世界的基本构建单元，具有位置、类型和可见面状态。

**属性**:
- `position`: Vector3 - 世界坐标位置
- `type`: string - 方块类型标识符（如"grass", "stone", "water"）
- `faceVisibility`: number (8-bit integer) - 可见面位掩码
- `isTransparent`: boolean - 是否为透明/半透明方块（计算属性）

**可见面位掩码设计**:
```
位位置: 0-5 对应六个面
0: 上 (top)      - Y+ 方向
1: 下 (bottom)   - Y- 方向
2: 北 (north)    - Z- 方向
3: 南 (south)    - Z+ 方向
4: 西 (west)     - X- 方向
5: 东 (east)     - X+ 方向
6-7: 保留 (未来扩展)
```

**位掩码值**:
- `0b00000001` (1): 上面可见
- `0b00000010` (2): 下面可见
- `0b00000100` (4): 北面可见
- `0b00001000` (8): 南面可见
- `0b00010000` (16): 西面可见
- `0b00100000` (32): 东面可见
- `0b00111111` (63): 所有面可见
- `0b00000000` (0): 所有面隐藏（理论上不应出现）

### 2. 区块 (Chunk)

**描述**: 16x16x256的方块集合，是渲染和管理的单元。

**属性**:
- `cx`, `cz`: number - 区块坐标
- `blocks`: Array[16][16][256] of Block - 方块三维数组
- `faceCullingData`: Uint8Array - 可见面状态压缩存储（可选优化）

**关系**:
- 包含 16×16×256 = 65,536 个方块
- 与相邻区块有边界关系（北、南、西、东）

### 3. 隐藏面剔除系统 (FaceCullingSystem)

**描述**: 管理所有方块的可见面状态计算和更新。

**属性**:
- `enabled`: boolean - 系统是否启用
- `transparentBlockTypes`: Set<string> - 透明方块类型集合
- `stats`: object - 性能统计信息
- `debugMode`: boolean - 调试模式标志

**方法**:
- `calculateFaceVisibility(block, neighbors)`: 计算单个方块的可见面
- `updateChunk(chunk)`: 更新整个区块的可见面状态
- `updateBlock(position)`: 更新单个方块及其相邻方块
- `updateNeighbors(position)`: 更新指定位置周围6个相邻方块
- `batchUpdate(positions)`: 批量更新多个方块
- `toggleDebug()`: 切换调试模式
- `getStats()`: 获取性能统计

### 4. 性能统计 (PerformanceStats)

**描述**: 记录隐藏面剔除系统的性能指标。

**属性**:
- `totalBlocksProcessed`: number - 处理的方块总数
- `facesCulled`: number - 剔除的面总数
- `facesRendered`: number - 渲染的面总数
- `updateTime`: number - 上次更新时间（毫秒）
- `errorCount`: number - 错误计数
- `lastError`: string - 最后错误信息
- `optimizationRate`: number - 优化率（剔除面/总面数）

## 状态转换

### 方块可见面状态计算

**输入**:
- 当前方块类型
- 六个相邻位置的方块类型（上、下、北、南、西、东）

**规则**:
1. 如果相邻位置为空（空气），则对应面可见
2. 如果相邻位置为固体方块，则对应面隐藏
3. 如果相邻位置为透明方块，则对应面可见
4. 如果当前方块为透明方块，所有面都可见（简化规则）

**伪代码**:
```javascript
function calculateFaceVisibility(block, neighbors) {
  let mask = 0;

  // 检查六个方向
  if (shouldShowFace(block, neighbors.top)) mask |= 0b00000001; // 上
  if (shouldShowFace(block, neighbors.bottom)) mask |= 0b00000010; // 下
  if (shouldShowFace(block, neighbors.north)) mask |= 0b00000100; // 北
  if (shouldShowFace(block, neighbors.south)) mask |= 0b00001000; // 南
  if (shouldShowFace(block, neighbors.west)) mask |= 0b00010000; // 西
  if (shouldShowFace(block, neighbors.east)) mask |= 0b00100000; // 东

  return mask;
}

function shouldShowFace(currentBlock, neighborBlock) {
  // 透明方块的所有面都可见
  if (currentBlock.isTransparent) return true;

  // 没有相邻方块（空气）-> 面可见
  if (!neighborBlock) return true;

  // 相邻方块是透明的 -> 面可见
  if (neighborBlock.isTransparent) return true;

  // 相邻方块是固体的 -> 面隐藏
  return false;
}
```

### 系统状态

**正常模式**:
- `enabled`: true
- `debugMode`: false
- 算法正常运行，性能统计更新

**调试模式**:
- `enabled`: true
- `debugMode`: true
- 显示可视化调试信息
- 记录详细性能数据

**降级模式**:
- `enabled`: false
- `debugMode`: false
- 算法禁用，所有面都渲染
- 记录错误信息和降级原因

## 数据验证规则

### 可见面状态一致性检查

1. **边界检查**: 位掩码值必须在 0-63 范围内
2. **对称性检查**: 如果方块A的东面对方块B可见，则方块B的西面应对方块A可见
3. **透明方块检查**: 透明方块的位掩码应为 63（所有面可见）
4. **孤立方块检查**: 完全被包围的固体方块位掩码应为 0

### 性能指标验证

1. **优化率合理性**: `optimizationRate` 应在 0.3-0.7 范围内（30%-70%面被剔除）
2. **更新时间**: `updateTime` 应小于 16ms（60FPS的一帧时间）
3. **错误率**: `errorCount` 增长应缓慢或为零

## 存储考虑

### 内存优化

1. **位掩码压缩**: 使用Uint8Array存储整个区块的可见面状态
   - 每个方块1字节，一个区块65,536字节（~64KB）
   - 相比存储完整面数据（6个布尔值×1字节=6字节）节省83%内存

2. **懒加载**: 可见面状态在区块加载时计算，而不是预计算所有区块

3. **缓存**: 频繁访问的相邻关系可以缓存

### 持久化

1. **与区块数据一起存储**: 可见面状态作为区块元数据的一部分
2. **增量保存**: 只保存修改过的区块
3. **版本控制**: 数据结构版本号，支持未来格式变更

## 扩展性考虑

### 未来功能支持

1. **更多面类型**: 保留位6-7用于未来扩展（如斜面、楼梯面）
2. **动态透明度**: 支持方块的透明度随时间变化
3. **高级剔除算法**: 支持视锥体剔除、遮挡剔除等高级技术
4. **多线程计算**: 支持Web Worker并行计算可见面状态