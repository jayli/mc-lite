# AO 修复管理器实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 AO 修复管理器，作为兜底机制确保 Mag7 等批量删除方块后 AO 阴影正确渲染。

**Architecture:** 创建独立的 AORepairManager 类，监听批量删除事件，收集受影响区域，延迟执行全面修复，同时处理 dynamicMeshes 和 instancedMeshes。

**Tech Stack:** Three.js, ES6+ Modules, Web Workers (现有架构保持不变)

---

## 前置检查

先阅读相关文件，确保理解现有代码：
- `src/world/Chunk.js` - 特别是 `_updateNeighborsAOInBatch` 方法 (1634-1753行)
- `src/utils/AOUtils.js` - AO 计算工具函数
- `src/world/World.js` - `removeBlocksBatch` 方法

---

### Task 1: 创建 AORepairManager 核心类

**Files:**
- Create: `src/core/AORepairManager.js`

**Step 1: 创建基础类结构**

```javascript
// src/core/AORepairManager.js
// AO 修复管理器 - 兜底机制确保批量删除后 AO 阴影正确渲染

import { getBlockProperties } from '../constants/BlockData.js';
import { CHUNK_SIZE } from '../utils/MathUtils.js';

/**
 * AO 修复管理器类
 * 监听批量删除事件，收集受影响区域，延迟执行全面修复
 */
export class AORepairManager {
  /**
   * 构造函数
   * @param {Object} world - World 实例
   */
  constructor(world) {
    this.world = world;

    // 待修复的区块映射
    // key: "cx,cz", value: Set of affected block keys "x,y,z"
    this.pendingChunkRepairs = new Map();

    // 防抖定时器
    this.repairTimer = null;

    // 配置
    this.REPAIR_DELAY = 2000;  // 2 秒后开始修复
    this.NEIGHBOR_RADIUS = 1;   // 3x3x3 范围

    console.log('AORepairManager initialized');
  }

  /**
   * 记录批量删除操作
   * @param {Array<{x,y,z}>} positions - 被删除的方块位置数组
   */
  recordBatchRemoval(positions) {
    if (!positions || positions.length === 0) return;

    // 对每个删除的方块，收集受影响的 3x3x3 区域
    for (const pos of positions) {
      const x = Math.floor(pos.x);
      const y = Math.floor(pos.y);
      const z = Math.floor(pos.z);

      // 收集 3x3x3 邻居
      for (let dx = -this.NEIGHBOR_RADIUS; dx <= this.NEIGHBOR_RADIUS; dx++) {
        for (let dy = -this.NEIGHBOR_RADIUS; dy <= this.NEIGHBOR_RADIUS; dy++) {
          for (let dz = -this.NEIGHBOR_RADIUS; dz <= this.NEIGHBOR_RADIUS; dz++) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;

            // 按区块分组
            const cx = Math.floor(nx / CHUNK_SIZE);
            const cz = Math.floor(nz / CHUNK_SIZE);
            const chunkKey = `${cx},${cz}`;
            const blockKey = `${nx},${ny},${nz}`;

            // 添加到待修复集合
            if (!this.pendingChunkRepairs.has(chunkKey)) {
              this.pendingChunkRepairs.set(chunkKey, new Set());
            }
            this.pendingChunkRepairs.get(chunkKey).add(blockKey);
          }
        }
      }
    }

    // 调度修复
    this.scheduleRepair();
  }

  /**
   * 调度修复任务（防抖）
   */
  scheduleRepair() {
    if (this.repairTimer) {
      clearTimeout(this.repairTimer);
    }

    this.repairTimer = setTimeout(() => {
      this.executeRepair();
    }, this.REPAIR_DELAY);
  }

  /**
   * 执行修复
   */
  executeRepair() {
    console.log(`[AORepairManager] Starting repair for ${this.pendingChunkRepairs.size} chunks`);

    // 遍历每个待修复的区块
    for (const [chunkKey, affectedKeys] of this.pendingChunkRepairs) {
      const [cx, cz] = chunkKey.split(',').map(Number);
      const chunk = this.world.chunks.get(chunkKey);

      if (chunk && chunk.isReady) {
        this.repairChunk(chunk, affectedKeys);
      }
    }

    // 清空待修复队列
    this.pendingChunkRepairs.clear();
    this.repairTimer = null;

    console.log('[AORepairManager] Repair completed');
  }

  /**
   * 修复单个区块
   * @param {Object} chunk - Chunk 实例
   * @param {Set<string>} affectedKeys - 受影响的方块 key 集合
   */
  repairChunk(chunk, affectedKeys) {
    // 修复动态网格
    for (const [blockKey, mesh] of chunk.dynamicMeshes || []) {
      if (affectedKeys.has(blockKey)) {
        const [x, y, z] = blockKey.split(',').map(Number);
        this.repairDynamicMesh(mesh, x, y, z, chunk);
      }
    }

    // 修复实例化网格
    for (const child of chunk.group.children) {
      if (child.isInstancedMesh) {
        this.repairInstancedMesh(child, chunk, affectedKeys);
      }
    }
  }

  /**
   * 修复动态网格
   * @param {THREE.Mesh} mesh - 动态网格
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {Object} chunk - Chunk 实例
   */
  repairDynamicMesh(mesh, x, y, z, chunk) {
    const key = `${x},${y},${z}`;
    const type = chunk.blockData[key];
    if (!type) return;

    const typeStr = typeof type === 'string' ? type : type.type;
    const props = getBlockProperties(typeStr);
    if (!props.isSolid || props.isTransparent) return;

    // 重新计算 AO
    const { aoLow, aoHigh } = this.calculateAOPacked(x, y, z, chunk);

    // 应用到 mesh
    const count = mesh.geometry.attributes.position?.count || 0;
    if (count === 0) return;

    const aoLowArray = new Float32Array(count);
    const aoHighArray = new Float32Array(count);
    aoLowArray.fill(aoLow);
    aoHighArray.fill(aoHigh);

    let aoLowAttr = mesh.geometry.getAttribute('aAoLow');
    let aoHighAttr = mesh.geometry.getAttribute('aAoHigh');

    if (!aoLowAttr) {
      mesh.geometry.setAttribute('aAoLow', new THREE.BufferAttribute(aoLowArray, 1));
    } else {
      aoLowAttr.array.set(aoLowArray);
      aoLowAttr.needsUpdate = true;
    }

    if (!aoHighAttr) {
      mesh.geometry.setAttribute('aAoHigh', new THREE.BufferAttribute(aoHighArray, 1));
    } else {
      aoHighAttr.array.set(aoHighArray);
      aoHighAttr.needsUpdate = true;
    }
  }

  /**
   * 修复实例化网格
   * @param {THREE.InstancedMesh} instancedMesh - 实例化网格
   * @param {Object} chunk - Chunk 实例
   * @param {Set<string>} affectedKeys - 受影响的方块 key 集合
   */
  repairInstancedMesh(instancedMesh, chunk, affectedKeys) {
    const instanceCount = instancedMesh.count;
    if (instanceCount === 0) return;

    const type = instancedMesh.userData.type;
    const props = getBlockProperties(type);
    if (!props.isSolid || props.isTransparent) return;

    // 获取或创建 AO 属性
    let aoLowAttr = instancedMesh.getAttribute('aAoLow');
    let aoHighAttr = instancedMesh.getAttribute('aAoHigh');
    let vertexIdAttr = instancedMesh.getAttribute('aVertexId');

    if (!aoLowAttr) {
      aoLowAttr = new THREE.BufferAttribute(new Float32Array(instanceCount), 1);
      instancedMesh.setAttribute('aAoLow', aoLowAttr);
    }
    if (!aoHighAttr) {
      aoHighAttr = new THREE.BufferAttribute(new Float32Array(instanceCount), 1);
      instancedMesh.setAttribute('aAoHigh', aoHighAttr);
    }
    if (!vertexIdAttr) {
      vertexIdAttr = new THREE.BufferAttribute(new Float32Array(instanceCount), 1);
      instancedMesh.setAttribute('aVertexId', vertexIdAttr);
    }

    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    let needsUpdate = false;
    const typeMap = chunk.instanceIndexMap?.[type];

    // 遍历所有实例
    for (let i = 0; i < instanceCount; i++) {
      instancedMesh.getMatrixAt(i, dummy);
      pos.setFromMatrixPosition(dummy);
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      const z = Math.round(pos.z);
      const key = `${x},${y},${z}`;

      // 如果这个实例在受影响列表中
      if (affectedKeys.has(key)) {
        // 确认方块仍然存在且适用 AO
        const blockType = chunk.blockData[key];
        if (!blockType) continue;

        // 重新计算 AO
        const { aoLow, aoHigh } = this.calculateAOPacked(x, y, z, chunk);

        // 更新属性
        aoLowAttr.array[i] = aoLow;
        aoHighAttr.array[i] = aoHigh;
        vertexIdAttr.array[i] = i;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      aoLowAttr.needsUpdate = true;
      aoHighAttr.needsUpdate = true;
      vertexIdAttr.needsUpdate = true;
    }
  }

  /**
   * 计算方块的 AO 数据（打包格式）
   * 复用 Chunk.js 中的逻辑，确保一致性
   * @param {number} x - 方块 X 坐标
   * @param {number} y - 方块 Y 坐标
   * @param {number} z - 方块 Z 坐标
   * @param {Object} chunk - Chunk 实例
   * @returns {Object} { aoLow, aoHigh }
   */
  calculateAOPacked(x, y, z, chunk) {
    // 辅助函数：判断是否遮挡（与 Chunk.js 中一致）
    const isOccluding = (ox, oy, oz) => {
      const cx = Math.floor(ox / CHUNK_SIZE);
      const cz = Math.floor(oz / CHUNK_SIZE);
      let targetChunk = (cx === chunk.cx && cz === chunk.cz)
        ? chunk
        : this.world.chunks.get(`${cx},${cz}`);

      if (!targetChunk) return true;

      const oKey = `${Math.floor(ox)},${Math.floor(oy)},${Math.floor(oz)}`;
      const entry = targetChunk.blockData[oKey];

      if (entry) {
        const t = typeof entry === 'string' ? entry : entry.type;
        const p = getBlockProperties(t);
        return p.isSolid && !p.isTransparent;
      }

      if (targetChunk.isReady) {
        return false;
      } else {
        return true;
      }
    };

    // 辅助函数：计算 AO 值（与 Chunk.js 中一致）
    const getAOValue = (side1, side2, corner) => {
      const s1 = side1 ? 1 : 0;
      const s2 = side2 ? 1 : 0;
      const c = (side1 || side2) ? (corner ? 1 : 0) : 0;
      if (s1 && s2) return 0;
      return 3 - (s1 + s2 + c);
    };

    // 计算每个面的 AO
    const getAOForFace = (faceIdx) => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const iz = Math.floor(z);
      const aos = new Uint8Array(4).fill(3);

      // AO_NEIGHBOR_OFFSETS 的简化版本（直接内联逻辑）
      if (faceIdx === 0) { // px (+X side)
        aos[0] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix+1, iy, iz+1), isOccluding(ix+1, iy+1, iz+1));
        aos[1] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix+1, iy, iz-1), isOccluding(ix+1, iy+1, iz-1));
        aos[2] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix+1, iy, iz+1), isOccluding(ix+1, iy-1, iz+1));
        aos[3] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix+1, iy, iz-1), isOccluding(ix+1, iy-1, iz-1));
      } else if (faceIdx === 1) { // nx (-X side)
        aos[0] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix-1, iy, iz-1), isOccluding(ix-1, iy+1, iz-1));
        aos[1] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix-1, iy, iz+1), isOccluding(ix-1, iy+1, iz+1));
        aos[2] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix-1, iy, iz-1), isOccluding(ix-1, iy-1, iz-1));
        aos[3] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix-1, iy, iz+1), isOccluding(ix-1, iy-1, iz+1));
      } else if (faceIdx === 2) { // py (+Y top)
        aos[0] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix, iy+1, iz-1), isOccluding(ix-1, iy+1, iz-1));
        aos[1] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix, iy+1, iz-1), isOccluding(ix+1, iy+1, iz-1));
        aos[2] = getAOValue(isOccluding(ix-1, iy+1, iz), isOccluding(ix, iy+1, iz+1), isOccluding(ix-1, iy+1, iz+1));
        aos[3] = getAOValue(isOccluding(ix+1, iy+1, iz), isOccluding(ix, iy+1, iz+1), isOccluding(ix+1, iy+1, iz+1));
      } else if (faceIdx === 3) { // ny (-Y bottom)
        aos[0] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix, iy-1, iz+1), isOccluding(ix-1, iy-1, iz+1));
        aos[1] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix, iy-1, iz+1), isOccluding(ix+1, iy-1, iz+1));
        aos[2] = getAOValue(isOccluding(ix-1, iy-1, iz), isOccluding(ix, iy-1, iz-1), isOccluding(ix-1, iy-1, iz-1));
        aos[3] = getAOValue(isOccluding(ix+1, iy-1, iz), isOccluding(ix, iy-1, iz-1), isOccluding(ix+1, iy-1, iz-1));
      } else if (faceIdx === 4) { // pz (+Z side)
        aos[0] = getAOValue(isOccluding(ix-1, iy, iz+1), isOccluding(ix, iy+1, iz+1), isOccluding(ix-1, iy+1, iz+1));
        aos[1] = getAOValue(isOccluding(ix+1, iy, iz+1), isOccluding(ix, iy+1, iz+1), isOccluding(ix+1, iy+1, iz+1));
        aos[2] = getAOValue(isOccluding(ix-1, iy, iz+1), isOccluding(ix, iy-1, iz+1), isOccluding(ix-1, iy-1, iz+1));
        aos[3] = getAOValue(isOccluding(ix+1, iy, iz+1), isOccluding(ix, iy-1, iz+1), isOccluding(ix+1, iy-1, iz+1));
      } else if (faceIdx === 5) { // nz (-Z side)
        aos[0] = getAOValue(isOccluding(ix+1, iy, iz-1), isOccluding(ix, iy+1, iz-1), isOccluding(ix+1, iy+1, iz-1));
        aos[1] = getAOValue(isOccluding(ix-1, iy, iz-1), isOccluding(ix, iy+1, iz-1), isOccluding(ix-1, iy+1, iz-1));
        aos[2] = getAOValue(isOccluding(ix+1, iy, iz-1), isOccluding(ix, iy-1, iz-1), isOccluding(ix+1, iy-1, iz-1));
        aos[3] = getAOValue(isOccluding(ix-1, iy, iz-1), isOccluding(ix, iy-1, iz-1), isOccluding(ix-1, iy-1, iz-1));
      }
      return aos;
    };

    // 计算所有 6 个面
    let aoLow = 0;
    let aoHigh = 0;
    for (let f = 0; f < 6; f++) {
      const aos = getAOForFace(f);
      for (let v = 0; v < 4; v++) {
        const vertexIdx = f * 4 + v;
        const aoVal = aos[v];
        if (vertexIdx < 12) {
          aoLow |= (aoVal << (vertexIdx * 2));
        } else {
          aoHigh |= (aoVal << ((vertexIdx - 12) * 2));
        }
      }
    }

    return { aoLow, aoHigh };
  }

  /**
   * 清理资源
   */
  dispose() {
    if (this.repairTimer) {
      clearTimeout(this.repairTimer);
      this.repairTimer = null;
    }
    this.pendingChunkRepairs.clear();
    console.log('AORepairManager disposed');
  }
}
```

**Step 2: 验证文件创建成功**

检查文件是否存在于正确位置。

---

### Task 2: 集成到 World.js

**Files:**
- Modify: `src/world/World.js`

**Step 1: 导入 AORepairManager**

在文件顶部的 import 区域添加：

```javascript
import { AORepairManager } from '../core/AORepairManager.js';
```

**Step 2: 在构造函数中初始化**

在 World 构造函数中，在合适的位置（比如在其他系统初始化之后）添加：

```javascript
// 初始化 AO 修复管理器
this.aoRepairManager = new AORepairManager(this);
```

**Step 3: 在 removeBlocksBatch 中调用 recordBatchRemoval**

找到 `removeBlocksBatch` 方法（大约 188 行），在方法末尾添加：

```javascript
// 记录批量删除，触发 AO 修复
if (this.aoRepairManager) {
  this.aoRepairManager.recordBatchRemoval(positions);
}
```

**完整的 removeBlocksBatch 应该像这样：**

```javascript
removeBlocksBatch(positions, isBatch = true) {
  // 将坐标按区块分组，减少跨区块调用次数，提升性能
  const chunkGroups = new Map();
  positions.forEach(p => {
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cz = Math.floor(p.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!chunkGroups.has(key)) {
      chunkGroups.set(key, []);
    }
    chunkGroups.get(key).push(p);
  });

  // 针对每个区块执行批量删除优化
  for (const [key, chunkPosList] of chunkGroups) {
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.removeBlocksBatch(chunkPosList, isBatch);
    }
  }

  // 批量模式：在所有区块处理完成后，统一触发待处理的 Face Culling 更新
  // 使用防抖定时器，确保连续多次调用时只在最后一次完成后处理
  if (isBatch) {
    for (const [key, chunk] of this.chunks) {
      if (chunk.pendingBatchFaceCullingUpdates?.size > 0) {
        chunk._scheduleBatchFaceCullingUpdate();
      }
    }
  }

  // 记录批量删除，触发 AO 修复
  if (this.aoRepairManager) {
    this.aoRepairManager.recordBatchRemoval(positions);
  }
}
```

**Step 4: 在 dispose 中清理（可选）**

如果 World 有 dispose 方法，添加：

```javascript
if (this.aoRepairManager) {
  this.aoRepairManager.dispose();
}
```

---

### Task 3: 验证导入 THREE

**Files:**
- Verify: `src/core/AORepairManager.js`

确保 AORepairManager.js 中导入了 THREE：

```javascript
import * as THREE from 'three';
```

（需要添加到文件顶部）

---

### Task 4: 测试验证

**Files:**
- Manual test in browser

**Step 1: 启动开发服务器**

```bash
npm run start
```

**Step 2: 手动测试**

1. 进入游戏，切换到 Mag7（按 2 或 3，取决于按键配置）
2. 找到 FrozenMountain 地图
3. 进入山体内
4. 使用 Mag7 射击岩石块
5. 等待 2 秒，观察相邻方块的 AO 阴影是否正确渲染
6. 测试多次快速射击

**Step 3: 检查控制台**

确保没有错误，看到类似：
```
AORepairManager initialized
[AORepairManager] Starting repair for X chunks
[AORepairManager] Repair completed
```

---

### Task 5: 代码审查与优化

**Files:**
- Review: `src/core/AORepairManager.js`

**检查项：**
1. 确保没有遗漏的边界情况
2. 确保性能优化到位（使用 Set 去重）
3. 确保容错处理完善
4. 确保日志输出合理

---

## 总结

这个实施计划创建了一个独立的 AO 修复管理器，作为兜底机制确保批量删除后 AO 阴影正确渲染。关键特点：

1. 不修改现有敏感流程（减少风险）
2. 同时处理 dynamicMeshes 和 instancedMeshes
3. 使用防抖延迟 2 秒执行，确保所有批量操作完成
4. 可以复用到 TNT 等其他批量删除场景
