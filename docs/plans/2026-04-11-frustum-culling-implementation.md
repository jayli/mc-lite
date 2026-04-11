# Frustum Culling FPS 优化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 安全地将 Chunk 和 ChunkGenerator 中的 `InstancedMesh.frustumCulled` 设置为 `true`，启用 Three.js 视锥剔除以提升 FPS。

**Architecture:** 在 `InstancedMesh` 和动态 `Mesh` 创建后，立即调用 `computeBoundingBox()` 和 `computeBoundingSphere()` 计算边界体积，确保 Three.js 的视锥剔除能正确工作。

**Tech Stack:** Three.js InstancedMesh, frustum culling, boundingBox/boundingSphere

**参考设计文档:** `docs/plans/2026-04-11-frustum-culling-fps-optimization.md`

---

## 任务列表

### 任务 1：修改 ChunkGenerator.js - 启用 InstancedMesh 视锥剔除

**Files:**
- Modify: `src/world/ChunkGenerator.js:120-127`

**Step 1: 读取目标代码区域**

```javascript
// 当前代码（第 120-127 行）
const mesh = new THREE.InstancedMesh(geometry, material, count);
mesh.frustumCulled = false;

// === 核心优化：直接设置矩阵数据 ===
mesh.instanceMatrix.array.set(matrices);
mesh.instanceMatrix.needsUpdate = true;
```

**Step 2: 修改代码**

将 `frustumCulled` 改为 `true`，并添加边界体积计算：

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

**Step 3: 保存文件**

**Step 4: 运行 lint 检查**

```bash
npm run lint
```

期望：无新增警告

---

### 任务 2：修改 Chunk.js - 启用动态 Mesh 视锥剔除

**Files:**
- Modify: `src/world/Chunk.js:955-960`

**Step 1: 读取目标代码区域**

```javascript
// 当前代码（第 955-960 行）
const mesh = new THREE.Mesh(geometry, material);
mesh.position.set(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5);
mesh.rotation.set(0, getRotationAngle(orientation), 0);
mesh.userData = { type, orientation };
mesh.frustumCulled = false;
```

**Step 2: 修改代码**

将 `frustumCulled` 改为 `true`，并在创建后计算边界体积：

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

**Step 3: 保存文件**

**Step 4: 运行 lint 检查**

```bash
npm run lint
```

期望：无新增警告

---

### 任务 3：功能验证 - Chunk 加载测试

**Step 1: 启动开发服务器**

```bash
npm run start
```

**Step 2: 打开浏览器访问**

```
http://localhost:8080
```

**Step 3: 执行测试场景**

1. 玩家进入世界后静止不动，观察 FPS（期望：60 FPS）
2. 玩家向前移动，加载外围 chunk
3. 观察 FPS 变化（期望：保持 60 FPS 或接近）
4. 玩家停止移动，等待 chunk 加载完成
5. 观察 FPS 是否稳定（期望：稳定在 60 FPS）

**Step 4: 视觉验证**

确认没有以下问题：
- [ ] 方块"闪烁"或"消失"
- [ ] chunk 加载延迟
- [ ] 视野内的方块渲染不及时

---

### 任务 4：功能验证 - 动态交互测试

**Step 1: 测试方块放置**

1. 选择任意方块
2. 放置方块到场景中
3. 观察新方块是否立即显示
4. 移动视角，观察方块是否闪烁

**Step 2: 测试方块挖掘**

1. 挖掘已放置的方块
2. 观察方块是否立即消失
3. 观察相邻方块的补面是否正确

**Step 3: 验证 Raycaster 交互**

1. 对准方块准星应高亮
2. 挖掘距离内的方块应能正确命中

---

### 任务 5：性能验证（可选）

**Step 1: 在浏览器控制台输入以下代码**

```javascript
// 查看渲染统计
const game = window.game;
if (game?.engine?.renderer) {
  const info = game.engine.renderer.info;
  console.log('Draw Calls:', info.render.calls);
  console.log('Triangles:', info.render.triangles);
  console.log('Lines:', info.render.lines);
  console.log('Points:', info.render.points);
}
```

**Step 2: 记录初始状态（1 个 chunk）的 draw calls 数量**

**Step 3: 加载多个 chunk 后再次记录**

**Step 4: 比较数据**

期望：启用视锥剔除后，`Triangles` 数量应减少（视野外的三角形不被渲染）

---

## 回退方案

如果验证失败（功能异常或 FPS 更差）：

**Step 1: 恢复 ChunkGenerator.js**

将 `frustumCulled` 改回 `false`，删除 `computeBoundingBox` 和 `computeBoundingSphere` 调用

**Step 2: 恢复 Chunk.js**

将 `frustumCulled` 改回 `false`，删除边界体积计算

**Step 3: 重新运行验证**

确认回退后功能恢复正常

---

## 验收标准

全部以下条件满足才算完成：

- [ ] ChunkGenerator.js 修改完成，lint 通过
- [ ] Chunk.js 修改完成，lint 通过
- [ ] 静止状态 FPS = 60
- [ ] 加载多个 chunk 后 FPS >= 55（目标 60）
- [ ] 无方块闪烁/消失现象
- [ ] 方块放置/挖掘功能正常
- [ ] Raycaster 交互正常
