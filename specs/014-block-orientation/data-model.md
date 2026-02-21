# Data Model: Block Orientation System

**Date**: 2026-02-22
**Feature**: 014-block-orientation

## 1. 枚举定义

### BlockOrientation

方块朝向枚举，表示方块在水平面上的四个方向。

```javascript
// src/utils/OrientationUtils.js
export const BlockOrientation = {
  EAST:  0,  // 朝东 (默认)
  SOUTH: 1,  // 朝南
  WEST:  2,  // 朝西
  NORTH: 3   // 朝北
};

// 旋转角度映射
export const OrientationAngle = {
  0: 0,           // EAST  -> 0°
  1: Math.PI / 2, // SOUTH -> 90°
  2: Math.PI,     // WEST  -> 180°
  3: Math.PI * 1.5 // NORTH -> 270°
};
```

## 2. 数据结构

### BlockDataEntry (扩展)

单个方块的数据条目，存储在世界 blockData 映射中。

```typescript
interface BlockDataEntry {
  type: string;        // 方块类型，如 "handrailA", "stone"
  orientation?: number; // 朝向值 0-3，可选，默认 0
}
```

**存储示例**:
```javascript
// 新格式 (推荐)
blockData["10,5,20"] = { type: "handrailA", orientation: 1 };

// 旧格式 (兼容)
blockData["10,5,21"] = "handrailA";  // 等价于 { type: "handrailA", orientation: 0 }
```

### PlacementMemory

放置记忆，存储每种方块类型上次移除时的朝向。

```javascript
// Player.js 内部
class Player {
  placementMemory = new Map();  // Key: blockType (string), Value: orientation (0-3)
}
```

**生命周期**:
- 创建: 玩家实例化时
- 更新: 移除方块时记录朝向
- 使用: 放置方块时计算新朝向
- 销毁: 会话结束时自动清空（不持久化）

## 3. 存储位置

### 内存存储

| 数据 | 位置 | 格式 |
|------|------|------|
| 方块数据 | `Chunk.blockData` | `Map<string, BlockDataEntry>` |
| 放置记忆 | `Player.placementMemory` | `Map<string, number>` |

### 持久化存储 (IndexedDB)

| 数据 | Store | 格式 |
|------|-------|------|
| 方块数据 | world-deltas | `{ key: "cx,cz", blocks: {...}, entities: {...} }` |

**blocks 字段格式**:
```javascript
{
  "10,5,20": { type: "handrailA", orientation: 1 },
  "11,5,20": { type: "stone", orientation: 0 }
}
```

## 4. 状态转换

### 朝向旋转

```
移除方块 (朝东, 0) -> 记录到 placementMemory
放置同类型方块 -> 计算新朝向 (0+1)%4 = 1 (朝南)
```

**旋转规则**:
```javascript
function nextOrientation(current) {
  return (current + 1) % 4;
}
```

### 方块生命周期

```
放置 -> blockData[key] = { type, orientation }
      -> InstancedMesh 更新矩阵（含旋转）

移除 -> 记录 placementMemory.set(type, orientation)
      -> delete blockData[key]
      -> InstancedMesh 隐藏实例

保存 -> PersistenceService 写入 IndexedDB（含 orientation）

加载 -> 兼容读取，字符串转对象，默认 orientation=0
```

## 5. 兼容性规则

### 读取兼容

```javascript
function parseBlockEntry(value) {
  if (typeof value === 'string') {
    // 旧格式：纯字符串
    return { type: value, orientation: 0 };
  }
  if (typeof value === 'object' && value.type) {
    // 新格式：对象
    return { type: value.type, orientation: value.orientation ?? 0 };
  }
  return null;  // 无效数据
}
```

### 写入格式

统一写入新格式对象：
```javascript
{ type: "handrailA", orientation: 1 }
```

## 6. 数据校验

### 朝向值校验

```javascript
function isValidOrientation(value) {
  return Number.isInteger(value) && value >= 0 && value <= 3;
}
```

### 方块类型校验

```javascript
function supportsOrientation(type) {
  // 所有可放置方块都支持朝向
  const props = getBlockProperties(type);
  return props.isRendered && type !== 'air';
}
```
