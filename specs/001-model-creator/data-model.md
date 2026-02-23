# Data Model: 模型创造台

**Feature**: 模型创造台 (Model Creator)
**Date**: 2026-02-23
**Spec**: [spec.md](./spec.md)

---

## Entities

### 1. ModelBlock (模型方块)

表示创造台上单个方块的数据结构。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| x | integer | 必需 | 相对于创造台中心的 X 偏移量（-20 到 19） |
| y | integer | 必需 | 相对于创造台中心的 Y 偏移量（0 及以上） |
| z | integer | 必需 | 相对于创造台中心的 Z 偏移量（-20 到 19） |
| type | string | 必需 | 方块类型标识符（如 "wood", "stone"） |
| direction | integer | 可选 | Minecraft 标准方向值 (0-5)，默认为 0 |

**方向值定义**:
- 0: 上 (Up)
- 1: 下 (Down)
- 2: 北 (North)
- 3: 南 (South)
- 4: 西 (West)
- 5: 东 (East)

**示例**:
```json
{
  "x": 0,
  "y": 1,
  "z": 0,
  "type": "wood",
  "direction": 2
}
```

---

### 2. ModelData (模型数据)

完整模型的数据结构，包含所有方块的集合。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| blocks | ModelBlock[] | 必需 | 方块数组，不包含 playground_block |
| metadata | Metadata | 可选 | 元数据（创建时间、作者等） |

**示例**:
```json
{
  "blocks": [
    { "x": 0, "y": 0, "z": 0, "type": "stone", "direction": 0 },
    { "x": 0, "y": 1, "z": 0, "type": "wood", "direction": 2 }
  ],
  "metadata": {
    "created": "2026-02-23T10:00:00Z",
    "dimensions": { "width": 3, "height": 2, "depth": 3 }
  }
}
```

---

### 3. Playground (创造台)

运行时创造台对象，非持久化。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| origin | Vector3 | 必需 | 创造台中心的世界坐标 |
| size | number | 固定值 | 40 (40x40) |
| blocks | Map<string, any> | 必需 | 平台上所有方块的引用 |
| isActive | boolean | 必需 | 是否已激活 |

---

## Validation Rules

### ModelBlock 验证

1. **坐标范围**:
   - `x` 必须在 -20 到 19 之间（相对于创造台中心）
   - `y` 必须 >= 0（不能低于创造台平面）
   - `z` 必须在 -20 到 19 之间

2. **类型有效**:
   - `type` 必须是游戏中存在的方块类型
   - `type` 不能是 `playground_block`
   - `type` 不能是 `air`

3. **方向有效**:
   - `direction` 必须是 0-5 之间的整数

---

## State Transitions

### 创造台生命周期

```
[未激活] --(点击"打开创造台")--> [已激活]
                                   |
                                   +--(玩家放置方块)--> [有内容]
                                   |
                                   +--(点击"导出模型")--> [已导出]
```

---

## Relationships

```
ModelData
  └── blocks[] --> ModelBlock
                     ├── type (引用 BlockData.js 中的定义)
                     └── direction (引用 BlockOrientation 枚举)
```

---

## Data Flow

### 导出流程

```
1. 读取创造台上所有方块
       ↓
2. 过滤掉 playground_block
       ↓
3. 计算相对坐标 (世界坐标 - 创造台中心)
       ↓
4. 构建 ModelBlock 数组
       ↓
5. 序列化为 JSON
       ↓
6. 触发浏览器下载
```

### 坐标转换公式

```javascript
// 世界坐标转相对坐标
relativeX = worldX - playgroundCenterX
relativeY = worldY - playgroundCenterY
relativeZ = worldZ - playgroundCenterZ

// 创造台中心为 (originX, originY, originZ)
// 40x40 平台，中心点偏移 20
// X 范围：originX - 20 到 originX + 19
// Z 范围：originZ - 20 到 originZ + 19
```
