# 将 buildMeshes 移至 Worker - 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 消除 chunk 加载时的主线程阻塞，将 InstancedMesh 构建移至 Worker

**Architecture:** Worker 使用 Three.js 预计算矩阵和 AO 数据，通过 Transferable 传输 TypedArray，主线程只做简单装配

**Tech Stack:** JavaScript, Three.js, Web Workers, Transferable Objects

---

## 前置检查

### Task 0: 验证当前状态

**Files:**
- Read: `src/workers/WorldWorker.js`
- Read: `src/world/ChunkGenerator.js`
- Read: `src/world/ChunkConsolidation.js`

**Step 1: 确认文件存在**

Run:
```bash
ls -la src/workers/WorldWorker.js src/world/ChunkGenerator.js src/world/ChunkConsolidation.js
```

Expected: 三个文件都存在

---

## Phase 1: Worker 端修改

### Task 1: 在 Worker 中导入 Three.js

**Files:**
- Modify: `src/workers/WorldWorker.js:1-30`

**Step 1: 添加 Three.js 导入**

在文件顶部添加：
```javascript
import * as THREE from 'three';
import { getRotationAngle } from '../utils/OrientationUtils.js';
```

**Step 2: 验证导入语法正确**

Run:
```bash
grep -n "import.*THREE" src/workers/WorldWorker.js
```

Expected:
```
1: import * as THREE from 'three';
```

**Step 3: Commit**

```bash
git add src/workers/WorldWorker.js
git commit -m "feat(worker): import Three.js for matrix computation"
```

---

### Task 2: 在 Worker 中添加 buildMeshData 函数

**Files:**
- Modify: `src/workers/WorldWorker.js`（在 `generateChunk` 函数之前添加）

**Step 1: 添加辅助函数**

在文件末尾 `onmessage` 函数之前添加：

```javascript
/**
 * 构建 Mesh 数据（用于 Worker 中预计算）
 * @param {Object} fakeChunk - 模拟的 chunk 对象
 * @param {Object} d - 渲染数据 {type: [positions]}
 * @param {number} cx - chunk X
 * @param {number} cz - chunk Z
 * @returns {Array} meshDataArray
 */
function buildMeshData(fakeChunk, d, cx, cz) {
  const meshDataArray = [];
  const dummy = new THREE.Object3D();

  for (const type in d) {
    const positions = d[type];
    if (positions.length === 0) continue;

    const count = positions.length;
    const matrices = new Float32Array(count * 16);
    const aoLow = new Float32Array(count);
    const aoHigh = new Float32Array(count);
    const orientation = new Float32Array(count);
    const instanceIndexMap = {};

    for (let i = 0; i < count; i++) {
      const pos = positions[i];

      // 计算矩阵
      dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      dummy.rotation.set(0, getRotationAngle(pos.orientation || 0), 0);
      dummy.updateMatrix();

      // 存储矩阵（16 个元素）
      matrices.set(dummy.matrix.elements, i * 16);

      // AO 和朝向
      aoLow[i] = pos.aoLow || 0;
      aoHigh[i] = pos.aoHigh || 0;
      orientation[i] = pos.orientation || 0;

      // 索引映射
      const posKey = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      instanceIndexMap[posKey] = i;
    }

    meshDataArray.push({
      type, count, matrices, aoLow, aoHigh, orientation,
      instanceIndexMap
    });
  }

  return meshDataArray;
}
```

**Step 2: 验证函数添加成功**

Run:
```bash
grep -n "function buildMeshData" src/workers/WorldWorker.js
```

Expected: 显示行号

**Step 3: Commit**

```bash
git add src/workers/WorldWorker.js
git commit -m "feat(worker): add buildMeshData function for pre-computing matrices"
```

---

### Task 3: 修改 Worker 的 postMessage 调用

**Files:**
- Modify: `src/workers/WorldWorker.js`（找到 postMessage 的位置，约 1646 行）

**Step 1: 定位 postMessage**

找到：
```javascript
postMessage({
  cx, cz, callbackKey, d, solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys,
  structureCenters,
  snapshot: {...}
});
```

**Step 2: 修改为使用 meshData 并添加 Transferable**

替换为：
```javascript
// 构建 mesh 数据（包含预计算的矩阵和 AO）
const meshData = buildMeshData(fakeChunk, d, cx, cz);

// 收集可传输的 buffer
const transferables = [];
for (const data of meshData) {
  transferables.push(
    data.matrices.buffer,
    data.aoLow.buffer,
    data.aoHigh.buffer,
    data.orientation.buffer
  );
}

postMessage({
  cx, cz, callbackKey,
  meshData,  // 替换原来的 d
  solidBlocks, realisticTrees, modGunMan, rovers, allBlockTypes, visibleKeys,
  structureCenters,
  snapshot: {
    meta: {
      ownershipVersion: OWNERSHIP_SCHEMA_VERSION
    },
    blocks: blocksForSnapshot,
    entities: {
      realisticTrees,
      modGunMan,
      rovers,
      zombieNests: savedSnapshot?.entities?.zombieNests || []
    }
  }
}, transferables);
```

**Step 3: 验证修改**

Run:
```bash
grep -n "meshData" src/workers/WorldWorker.js | head -5
```

Expected: 显示 meshData 的使用位置

**Step 4: Commit**

```bash
git add src/workers/WorldWorker.js
git commit -m "feat(worker): return meshData with Transferable TypedArrays"
```

---

## Phase 2: 主线程修改

### Task 4: 重写主线程的 buildMeshes 函数

**Files:**
- Modify: `src/world/ChunkGenerator.js:85-206`

**Step 1: 备份原函数（注释掉）**

将原 `buildMeshes` 函数注释掉（用于参考），然后添加新实现：

```javascript
Chunk.prototype.buildMeshes = function(meshDataArray) {
  // 防御性检查：确保数据格式正确
  if (!Array.isArray(meshDataArray)) {
    console.warn('buildMeshes received legacy data format, expected array');
    return;
  }

  // 创建虚拟对象用于宝箱等特殊处理
  const dummy = new THREE.Object3D();

  // 遍历每种方块类型的 mesh 数据
  for (const data of meshDataArray) {
    const { type, count, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;

    const props = getBlockProps(type);
    if (!props.isRendered || count === 0) continue;

    // 获取几何体和材质
    const geometry = geomMap[props.geometryType] || geomMap['default'];
    const material = getMaterials().getMaterial(type);

    // 创建 InstancedMesh
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.userData = { type };

    // === 核心优化：直接设置矩阵数据 ===
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

    // === 设置 AO 属性（已预计算）===
    if (props.isSolid && !props.isTransparent) {
      // 克隆几何体以拥有独立属性
      mesh.geometry = geometry.clone();
      mesh.geometry.setAttribute('aAoLow',
        new THREE.InstancedBufferAttribute(aoLow, 1));
      mesh.geometry.setAttribute('aAoHigh',
        new THREE.InstancedBufferAttribute(aoHigh, 1));
      mesh.geometry.setAttribute('aOrientation',
        new THREE.InstancedBufferAttribute(orientation, 1));
    }

    // 阴影配置
    if (props.isShadowEnabled) {
      if (isGlassType(type)) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else {
        mesh.castShadow = isSolidShadowCaster(props);
        mesh.receiveShadow = true;
      }
    }

    // 存储索引映射（用于后续交互）
    if (type !== 'realistic_trunk' && type !== 'realistic_leaves') {
      this.instanceIndexMap[type] = new Map(Object.entries(instanceIndexMap));
    }

    // 宝箱特殊处理
    if (type === 'chest') {
      mesh.userData.chests = {};
      for (let i = 0; i < count; i++) {
        mesh.userData.chests[i] = { open: false };
      }
    }

    // 添加到场景
    this.group.add(mesh);
  }
};
```

**Step 2: 验证修改**

Run:
```bash
grep -n "meshDataArray" src/world/ChunkGenerator.js | head -3
```

Expected: 显示新函数参数

**Step 3: Commit**

```bash
git add src/world/ChunkGenerator.js
git commit -m "feat(chunk): rewrite buildMeshes to use pre-computed mesh data"
```

---

### Task 5: 修改 Consolidation 流程适配

**Files:**
- Modify: `src/world/ChunkConsolidation.js:386`

**Step 1: 找到 _applyConsolidateResult 中的 buildMeshes 调用**

找到：
```javascript
this.buildMeshes(d);
```

**Step 2: 修改为使用 meshData**

替换为：
```javascript
this.buildMeshes(data.meshData || {});
```

**Step 3: 验证**

Run:
```bash
grep -n "meshData" src/world/ChunkConsolidation.js
```

Expected: 显示修改位置

**Step 4: Commit**

```bash
git add src/world/ChunkConsolidation.js
git commit -m "fix(consolidation): use meshData instead of d for buildMeshes"
```

---

## Phase 3: 验证与测试

### Task 6: 运行 lint 检查

**Step 1: 运行 ESLint**

Run:
```bash
npm run lint
```

Expected: 无新增错误

**Step 2: 修复任何 lint 错误**

如果有错误，根据提示修复。

**Step 3: Commit（如果需要修复）**

```bash
git add -A
git commit -m "style: fix lint errors"
```

---

### Task 7: 手动测试验证

**Step 1: 启动开发服务器**

Run:
```bash
npm run start
```

**Step 2: 打开浏览器并测试**

- 访问 http://localhost:8080
- 按 F12 打开 DevTools
- 切换到 Performance 标签
- 点击录制，移动角色进入新 chunk
- 停止录制，检查是否有长任务（Long Task）

**Step 3: 功能验证清单**

- [ ] 地形正确显示（草地、泥土、石头等）
- [ ] AO 阴影正确显示（方块角落有阴影）
- [ ] 可以挖掘方块
- [ ] 可以放置方块
- [ ] 宝箱可以打开/关闭
- [ ] 移动时没有明显卡顿

---

### Task 8: 性能对比测试（可选但推荐）

**Step 1: 创建简单性能测试脚本**

Create: `src/tests/test-buildmeshes-perf.js`

```javascript
// 简单的性能测试：对比优化前后的 buildMeshes 耗时

export function testBuildMeshesPerformance() {
  console.log('Testing buildMeshes performance...');

  // 模拟 meshData
  const meshData = [];
  const types = ['grass', 'stone', 'dirt'];

  for (const type of types) {
    const count = 1000; // 每类型 1000 个方块
    const matrices = new Float32Array(count * 16);
    const aoLow = new Float32Array(count);
    const aoHigh = new Float32Array(count);
    const orientation = new Float32Array(count);
    const instanceIndexMap = {};

    // 填充模拟数据
    for (let i = 0; i < count; i++) {
      // 模拟矩阵数据（identity 矩阵）
      matrices[i * 16] = 1;
      matrices[i * 16 + 5] = 1;
      matrices[i * 16 + 10] = 1;
      matrices[i * 16 + 15] = 1;

      aoLow[i] = 0.5;
      aoHigh[i] = 0.8;
      orientation[i] = 0;
      instanceIndexMap[`${i},0,0`] = i;
    }

    meshData.push({
      type, count, matrices, aoLow, aoHigh, orientation,
      instanceIndexMap
    });
  }

  // 测量时间
  const start = performance.now();

  // 注意：这里需要在有 Chunk 实例的环境下运行
  // 实际测试应在浏览器控制台中运行：
  // const chunk = window.game.world.chunks.values().next().value;
  // chunk.buildMeshes(meshData);

  const end = performance.now();
  console.log(`buildMeshes took ${end - start}ms for ${meshData.length} types`);

  return { duration: end - start, typeCount: meshData.length };
}
```

**Step 2: 在浏览器控制台测试**

```javascript
// 找到已加载的 chunk
const chunk = window.game.world.chunks.values().next().value;

// 测试 buildMeshes 性能
const start = performance.now();
// 调用构建（如果有新的 meshData）
const end = performance.now();
console.log(`Time: ${end - start}ms`);
```

**Step 3: Commit 测试文件**

```bash
git add src/tests/test-buildmeshes-perf.js
git commit -m "test: add buildMeshes performance test"
```

---

## 回滚方案

如果出现问题，按以下步骤回滚：

```bash
# 查看提交历史
git log --oneline -10

# 回滚到修改前的状态
git reset --hard <commit-before-changes>

# 或者逐个撤销
git revert <commit-hash>
```

---

## 总结

完成以上任务后：
1. Worker 将预计算所有矩阵和 AO 数据
2. 主线程 `buildMeshes` 将只执行简单的数据装配
3. chunk 加载期间 FPS 应保持 60
4. 游戏体验将更加流畅

**预估修改文件数**: 3
**预估代码行数变化**: +150/-100
**预估实施时间**: 30-45 分钟
