# AO 修复管理器设计文档

**日期**: 2026-03-06
**作者**: Claude Code
**状态**: 已批准

## 问题描述

在 FrozenMountain 山体内使用 Mag7 破坏岩石块时，被破坏区域相邻的方块部分面缺少 AO（环境光遮蔽）阴影渲染。

### 根本原因分析

1. **Mag7 射击流程**：分批删除方块（每批 5 个，间隔 50ms）
2. **AO 更新机制**：使用 1000ms 防抖定时器统一处理
3. **Consolidation 机制**：同样在 1000ms 后触发，将动态网格合并到实例化网格
4. **竞态条件**：如果方块在 AO 更新前就被 consolidation 从 `dynamicMeshes` 移到 `instancedMeshes`，这些方块的 AO 就不会被更新

### 现有代码的局限

- `_updateNeighborsAOInBatch` 只处理 `dynamicMeshes`
- 没有机制处理 consolidation 后的 `instancedMeshes` 的 AO 更新
- 多次快速批量删除时，AO 更新可能丢失

## 解决方案

创建独立的 **AO 修复管理器（AORepairManager）**，作为兜底机制确保批量删除后 AO 阴影正确渲染。

## 架构设计

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/core/AORepairManager.js` | AO 修复管理器核心类 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/world/World.js` | 在 `removeBlocksBatch` 中调用 `recordBatchRemoval` |
| `src/world/World.js` | 在构造函数中初始化 `AORepairManager` 实例 |

## 详细设计

### AORepairManager 类

```javascript
export class AORepairManager {
  constructor(world)

  // 记录批量删除
  recordBatchRemoval(positions)

  // 调度修复（防抖）
  scheduleRepair()

  // 执行修复
  executeRepair()

  // 修复单个区块
  repairChunk(chunk, affectedKeys)

  // 修复动态网格
  repairDynamicMesh(mesh, x, y, z, chunk)

  // 修复实例化网格
  repairInstancedMesh(instancedMesh, chunk, affectedKeys)

  // 计算 AO 数据
  calculateAOPacked(x, y, z, chunk)
}
```

### 核心数据结构

```javascript
// 待修复的区块映射
// key: "cx,cz", value: Set of affected block keys "x,y,z"
this.pendingChunkRepairs = new Map()

// 防抖定时器
this.repairTimer = null

// 配置
this.REPAIR_DELAY = 2000  // 2 秒后开始修复
this.NEIGHBOR_RADIUS = 1   // 3x3x3 范围
```

### 关键流程

#### 1. 记录批量删除流程

```
recordBatchRemoval(positions)
  ↓
对每个位置，收集 3x3x3 邻居
  ↓
按区块分组，存入 pendingChunkRepairs
  ↓
调用 scheduleRepair()
```

#### 2. 执行修复流程

```
executeRepair()
  ↓
遍历每个待修复的区块
  ↓
对每个区块：
  ├─ 修复 dynamicMeshes
  └─ 修复 instancedMeshes
  ↓
清空 pendingChunkRepairs
```

#### 3. 修复 instancedMesh 流程

```
repairInstancedMesh(instancedMesh, chunk, affectedKeys)
  ↓
遍历 instancedMesh 的所有实例
  ↓
如果实例位置在 affectedKeys 中
  ↓
重新计算 AO
  ↓
更新 aAoLow 和 aAoHigh 属性
  ↓
标记 needsUpdate = true
```

## 实现细节

### AO 计算逻辑

复用 `Chunk.js` 中 `_createDynamicBlockMesh` 和 `_updateNeighborsAOInBatch` 的 AO 计算逻辑：

- 使用相同的 `isOccluding` 函数
- 使用相同的 AO 角落计算逻辑
- 确保 FrozenMountain 山体内的未加载区域处理一致

### 性能优化

- 只重新计算受影响区域的方块（3x3x3）
- 使用 Set 去重，避免重复计算
- 如果受影响方块太多（> 200），考虑分批处理（当前版本暂不实现）

### 容错处理

- 检查 chunk 是否存在
- 检查 mesh 是否存在
- 检查 blockData 是否有效
- 检查方块类型是否适用 AO（实心、不透明）

## 集成点

### World.js 修改

在 `removeBlocksBatch` 方法末尾添加：

```javascript
if (this.aoRepairManager) {
  this.aoRepairManager.recordBatchRemoval(positions);
}
```

### 初始化

在 World 构造函数中添加：

```javascript
this.aoRepairManager = new AORepairManager(this);
```

## 测试计划

1. **基本测试**：在 FrozenMountain 山体内使用 Mag7 射击，验证相邻方块的 AO 阴影是否正确
2. **多次射击测试**：测试多次快速射击的情况
3. **跨区块测试**：测试跨区块的批量删除
4. **TNT 测试**：验证 TNT 爆炸后 AO 是否也能正确修复（可选）

## 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 修复延迟期间 AO 不正确 | 中 | 高 | 接受，2 秒延迟在可接受范围内 |
| 额外的计算开销 | 低 | 中 | 只在批量删除后执行一次，可接受 |
| 引入新 bug | 中 | 低 | 作为兜底机制，不修改现有敏感流程 |

## 替代方案考虑

1. **主动同步方案**：修改现有流程确保 AO 计算和 consolidation 同步 - 风险较高，暂不采用
2. **简单延迟修复**：在 Player 中直接加定时器 - 不够优雅，难以复用

---

**审批状态**: 已批准
**下一步**: 创建实施计划并开始编码
