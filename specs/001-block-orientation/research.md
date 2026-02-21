# Research: Block Orientation System

**Date**: 2026-02-22
**Feature**: 001-block-orientation

## 1. 现有数据结构分析

### Decision: 扩展现有 blockData 格式为对象类型

**当前格式**:
```javascript
// Chunk.js blockData 存储格式
this.blockData = {};  // Key: "x,y,z" -> Value: "blockType" (字符串)
```

**目标格式**:
```javascript
this.blockData = {};  // Key: "x,y,z" -> Value: { type: "blockType", orientation: 0-3 }
```

**Rationale**:
- 最小化改动，保持现有 key 格式不变
- 向后兼容：读取时检测值类型，字符串则赋予默认朝向
- 内存开销：每个方块增加 1 个数字属性，影响可忽略

**Alternatives Considered**:
1. *分离存储*: 单独 Map 存储朝向 - 拒绝，增加查找复杂度
2. *位运算压缩*: 将朝向编码进类型字符串 - 拒绝，降低可读性

## 2. Three.js InstancedMesh 旋转方案

### Decision: 在 setMatrixAt 时应用 Y 轴旋转

**实现方式**:
```javascript
// 在 Chunk.js buildMeshes 和 addBlockDynamic 中
const dummy = new THREE.Object3D();
const rotationY = (orientation || 0) * (Math.PI / 2);  // 0, 90, 180, 270 度
dummy.rotation.set(0, rotationY, 0);
dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
dummy.updateMatrix();
mesh.setMatrixAt(i, dummy.matrix);
```

**Rationale**:
- 复用现有 dummy 对象模式，不增加新对象创建
- 矩阵变换在 GPU 端执行，性能影响极小
- 与现有 InstancedMesh 架构完全兼容

**Alternatives Considered**:
1. *几何体预旋转*: 为每个朝向创建 4 个几何体 - 拒绝，显存占用增加 4 倍
2. *着色器旋转*: 在顶点着色器中旋转 - 拒绝，增加着色器复杂度

## 3. Face Culling 兼容性

### Decision: 朝向不影响 Face Culling 逻辑

**分析结果**:
- Face Culling 基于方块类型的 `isTransparent` 属性判断
- 朝向仅影响视觉旋转，不改变方块的物理/透明属性
- 无需修改 `FaceCullingSystem.js` 和 `FaceCullingWorker.js`

**Rationale**:
- 旋转不改变方块的碰撞体和透明度
- 邻居检测逻辑完全独立于朝向

## 4. 后台合并（Consolidation）兼容性

### Decision: 在 Worker 消息中传递朝向信息

**改动点**:
- `WorldWorker.js`: 处理 snapshot 中的对象格式
- `Chunk.js consolidate()`: 传递完整 blockData（含朝向）

**实现要点**:
```javascript
// Worker 间通信格式
snapshot: {
  blocks: { "x,y,z": { type: "stone", orientation: 0 } }
}
```

**Rationale**:
- Worker 已处理 snapshot，只需适配新格式
- 序列化/反序列化开销可忽略

## 5. PersistenceService 兼容性

### Decision: 存档格式升级为对象类型

**兼容策略**:
```javascript
// 读取时兼容处理
function parseBlockData(value) {
  if (typeof value === 'string') {
    return { type: value, orientation: 0 };  // 旧格式，默认朝东
  }
  return value;  // 新格式
}
```

**写入格式**:
```javascript
// 统一写入新格式
{ type: "handrailA", orientation: 1 }
```

**Rationale**:
- 一次升级，永久兼容
- 旧存档自动升级为新格式

## 6. 放置记忆实现方案

### Decision: 在 Player 类中维护 Map

**实现方式**:
```javascript
// Player.js
this.placementMemory = new Map();  // Key: blockType, Value: orientation (0-3)

// 移除方块时记录
onBlockRemoved(type, orientation) {
  this.placementMemory.set(type, orientation);
}

// 放置方块时计算新朝向
getNextOrientation(type) {
  const last = this.placementMemory.get(type);
  if (last === undefined) return 0;  // 默认朝东
  return (last + 1) % 4;  // 顺时针旋转 90 度
}
```

**Rationale**:
- 放置记忆与玩家实例绑定
- 会话结束自动重置（不持久化）

## 7. 需修改文件清单

| 文件 | 改动类型 | 改动内容 |
|------|----------|----------|
| `src/constants/BlockData.js` | 扩展 | 添加 `supportsOrientation` 属性标识 |
| `src/utils/OrientationUtils.js` | 新增 | 朝向枚举、计算函数 |
| `src/world/Chunk.js` | 修改 | blockData 格式、渲染旋转、Worker 通信 |
| `src/world/World.js` | 修改 | setBlock/removeBlock 接口传递朝向 |
| `src/entities/player/Player.js` | 修改 | 放置记忆逻辑 |
| `src/services/PersistenceService.js` | 修改 | 兼容旧格式读取 |
| `src/workers/WorldWorker.js` | 修改 | snapshot 格式适配 |

## 8. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 旧存档不兼容 | 高 | 充分测试兼容性读取 |
| 性能下降 | 中 | 使用预分配矩阵，避免每帧创建对象 |
| Face Culling 异常 | 低 | 朝向不影响透明度判断 |

## 9. 测试计划

1. **兼容性测试**: 加载旧版本存档，验证方块正常显示
2. **旋转测试**: 移除-放置循环，验证朝向正确旋转
3. **持久化测试**: 保存-加载，验证朝向保持
4. **性能测试**: 1000 个带朝向方块场景，验证帧率
