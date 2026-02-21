# Internal API Contracts: Block Orientation System

**Date**: 2026-02-22
**Feature**: 001-block-orientation

## 1. OrientationUtils 模块

**File**: `src/utils/OrientationUtils.js`

### Export: BlockOrientation (枚举)

```javascript
export const BlockOrientation = {
  EAST:  0,
  SOUTH: 1,
  WEST:  2,
  NORTH: 3
};
```

### Export: getRotationAngle(orientation)

获取朝向对应的 Y 轴旋转角度（弧度）。

```javascript
/**
 * @param {number} orientation - 朝向值 (0-3)
 * @returns {number} 旋转角度（弧度）
 */
export function getRotationAngle(orientation) {
  return (orientation || 0) * (Math.PI / 2);
}
```

### Export: nextOrientation(orientation)

计算顺时针旋转后的下一个朝向。

```javascript
/**
 * @param {number} current - 当前朝向 (0-3)
 * @returns {number} 下一个朝向 (0-3)
 */
export function nextOrientation(current) {
  return ((current || 0) + 1) % 4;
}
```

### Export: parseBlockEntry(value)

解析方块数据条目，兼容新旧格式。

```javascript
/**
 * @param {string|object} value - 存储值
 * @returns {{ type: string, orientation: number }} 标准化条目
 */
export function parseBlockEntry(value) {
  if (typeof value === 'string') {
    return { type: value, orientation: 0 };
  }
  return {
    type: value?.type || 'air',
    orientation: value?.orientation ?? 0
  };
}
```

---

## 2. Chunk 类扩展

**File**: `src/world/Chunk.js`

### Method: addBlockDynamic(x, y, z, type, orientation)

扩展方法签名，支持传入朝向参数。

```javascript
/**
 * 动态添加单个方块
 * @param {number} x - 世界坐标 X
 * @param {number} y - 世界坐标 Y
 * @param {number} z - 世界坐标 Z
 * @param {string} type - 方块类型
 * @param {number} [orientation=0] - 朝向 (0-3)
 */
addBlockDynamic(x, y, z, type, orientation = 0) { ... }
```

### Method: getBlockOrientation(x, y, z)

获取指定位置方块的朝向。

```javascript
/**
 * @param {number} x - 世界坐标 X
 * @param {number} y - 世界坐标 Y
 * @param {number} z - 世界坐标 Z
 * @returns {number} 朝向值 (0-3)，方块不存在时返回 0
 */
getBlockOrientation(x, y, z) { ... }
```

---

## 3. World 类扩展

**File**: `src/world/World.js`

### Method: setBlock(x, y, z, type, orientation)

扩展方法签名，支持传入朝向参数。

```javascript
/**
 * 放置方块
 * @param {number} x - 世界坐标 X
 * @param {number} y - 世界坐标 Y
 * @param {number} z - 世界坐标 Z
 * @param {string} type - 方块类型
 * @param {number} [orientation=0] - 朝向 (0-3)
 */
setBlock(x, y, z, type, orientation = 0) { ... }
```

### Method: removeBlockWithOrientation(x, y, z)

移除方块并返回其朝向信息。

```javascript
/**
 * @param {number} x - 世界坐标 X
 * @param {number} y - 世界坐标 Y
 * @param {number} z - 世界坐标 Z
 * @returns {{ type: string, orientation: number }|null} 方块信息
 */
removeBlockWithOrientation(x, y, z) { ... }
```

---

## 4. Player 类扩展

**File**: `src/entities/player/Player.js`

### Property: placementMemory

```javascript
/**
 * 放置记忆，存储每种方块类型上次移除时的朝向
 * @type {Map<string, number>}
 */
this.placementMemory = new Map();
```

### Method: recordPlacementMemory(type, orientation)

记录方块移除时的朝向。

```javascript
/**
 * @param {string} type - 方块类型
 * @param {number} orientation - 朝向 (0-3)
 */
recordPlacementMemory(type, orientation) { ... }
```

### Method: getNextPlacementOrientation(type)

获取下次放置该类型方块的朝向。

```javascript
/**
 * @param {string} type - 方块类型
 * @returns {number} 下次放置的朝向 (0-3)
 */
getNextPlacementOrientation(type) { ... }
```

---

## 5. PersistenceService 扩展

**File**: `src/services/PersistenceService.js`

### Method: recordChange(x, y, z, type, orientation)

扩展方法签名，支持记录朝向。

```javascript
/**
 * 记录方块变更
 * @param {number} x - 世界坐标 X
 * @param {number} y - 世界坐标 Y
 * @param {number} z - 世界坐标 Z
 * @param {string|object} typeOrEntry - 方块类型或完整条目对象
 * @param {number} [orientation] - 朝向（当第一个参数为字符串时使用）
 */
recordChange(x, y, z, typeOrEntry, orientation) { ... }
```

---

## 6. WorldWorker 消息格式

**File**: `src/workers/WorldWorker.js`

### 输入消息 (snapshot.blocks)

```javascript
// 新格式
snapshot.blocks = {
  "x,y,z": { type: "handrailA", orientation: 1 },
  "x,y,z": { type: "stone", orientation: 0 }
};

// 旧格式（兼容）
snapshot.blocks = {
  "x,y,z": "handrailA"
};
```

### 输出消息 (allBlockTypes)

```javascript
// 统一输出新格式
allBlockTypes = {
  "x,y,z": { type: "handrailA", orientation: 1 }
};
```
