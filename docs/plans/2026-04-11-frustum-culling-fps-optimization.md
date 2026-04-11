# Frustum Culling FPS 优化设计

日期：2026-04-11
作者：Claude Code

## 背景

当前游戏中存在 FPS 下降问题：
- 初始状态（玩家未移动）：60 FPS
- 加载外围 chunk 后：下降到 50 FPS 左右
- 原因：所有 `InstancedMesh` 设置了 `frustumCulled = false`，导致视野外的 chunk 仍被渲染

## 问题分析

### 历史回顾

| 提交 | 日期 | 修改 | 原因 |
|------|------|------|------|
| 4343f27 | 2026-04-08 | 首次尝试设为 `true` | 性能优化 |
| ebee952 | 2026-04-08 | 回退为 `false` | 导致 chunk 生成延迟 |

### 根因

上次失败的原因是仅设置了 `frustumCulled = true`，但没有在 `InstancedMesh` 创建/更新后调用 `computeBoundingBox()` 和 `computeBoundingSphere()`。

Three.js 的视锥剔除依赖于对象的边界体积（boundingBox/boundingSphere）。如果边界体积没有正确计算：
- 视野内的对象可能被错误剔除 → "方块更新不及时"
- 视野外的对象仍被渲染 → FPS 下降

## 设计方案

### 改动范围

**修改的文件**：
- `src/world/ChunkGenerator.js` - 批量地形 InstancedMesh
- `src/world/Chunk.js` - 动态方块 Mesh

**不修改的部分**：
- 丧尸、矿车、炮弹渲染器（保持 `frustumCulled = false`）
- 真实感树木渲染器（保持 `frustumCulled = false`）
- 雨滴效果（保持 `frustumCulled = false`）

### 具体改动

#### 1. ChunkGenerator.js（第 121-127 行附近）

在创建 `InstancedMesh` 后，添加边界体积计算：

```javascript
const mesh = new THREE.InstancedMesh(geometry, material, count);
mesh.frustumCulled = true;  // 启用视锥剔除

// === 核心优化：直接设置矩阵数据 ===
mesh.instanceMatrix.array.set(matrices);
mesh.instanceMatrix.needsUpdate = true;

// === 计算边界体积，供视锥剔除使用 ===
mesh.computeBoundingBox();
mesh.computeBoundingSphere();
```

#### 2. Chunk.js（第 955-960 行附近）

在创建动态 Mesh 后，添加边界体积计算：

```javascript
const mesh = new THREE.Mesh(geometry, material);
mesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);
mesh.rotation.set(0, getRotationAngle(orientation), 0);
mesh.userData = { type, orientation };
mesh.frustumCulled = true;  // 启用视锥剔除

// 创建后计算边界体积
if (mesh.geometry) {
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}
```

### 方案选择理由

**为什么只在创建时计算一次？**

Chunk 的 `InstancedMesh` 在以下情况会重建：
- 初始 chunk 生成时
- consolidation 合并优化时

这两种情况都会调用 `buildMeshes` 重新创建 `InstancedMesh`，因此边界体积会在创建时重新计算。

玩家交互时的动态 Mesh：
- 位置固定（创建后不移动）
- 数量较少（只有玩家交互时才会创建）
- 单个 Mesh 的 Three.js 默认会正确计算边界

因此，**创建时一次性计算** 策略足够，不需要在每次更新时重新计算。

## 验证标准

### 功能验证

1. 玩家移动时，新 chunk 加载正常显示
2. 没有方块"闪烁"或"消失"现象
3. 挖掘/放置方块后，视觉更新及时
4. Raycaster 交互（挖掘、放置）正常

### 性能验证

1. 初始状态 FPS 保持 60
2. 加载多个 chunk 后，FPS 稳定在 60（或接近）
3. Three.js 渲染统计：
   - `renderer.info.render.calls` - draw call 数量应减少
   - `renderer.info.render.triangles` - 渲染的三角形数量应减少

## 风险与回退

### 潜在风险

1. **边界体积计算不完整** - 可能导致视野内的方块被错误剔除
2. **动态 Mesh 更新不及时** - 玩家放置方块后，边界体积未更新

### 回退方案

如果验证失败，恢复 `frustumCulled = false` 即可，不影响其他功能。

### 渐进式验证

1. 先在 `ChunkGenerator.js` 中修改，验证 chunk 加载场景
2. 再在 `Chunk.js` 中修改，验证动态交互场景
3. 分别验证两个改动点，便于定位问题
