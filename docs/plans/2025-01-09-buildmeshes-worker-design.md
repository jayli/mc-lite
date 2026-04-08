# 设计文档：将 buildMeshes 移至 Worker

**日期**: 2025-01-09
**目标**: 消除 chunk 加载时的主线程阻塞，提升游戏流畅度

## 1. 概述

### 当前问题
- `buildMeshes` 在主线程同步执行，遍历每个方块设置矩阵
- 4096 个方块 × 矩阵计算 = 50-150ms 主线程阻塞
- 移动时产生明显卡顿

### 预期收益
- chunk 加载期间 FPS 保持在 60
- 消除移动时的"瞬移"感
- 更快的世界加载速度

## 2. 架构设计

```
┌─────────────────┐         ┌──────────────────┐
│   WorldWorker   │         │   主线程 Chunk   │
├─────────────────┤         ├──────────────────┤
│ 1. 生成地形数据 │         │ 1. 接收 meshData │
│    (已有)       │         │                  │
│                 │         │ 2. new           │
│ 2. 创建 Matrix4 │────────▶│    InstancedMesh │──▶ GPU
│    计算矩阵     │ 传输    │                  │
│                 │         │ 3. 直接设置      │
│ 3. 计算 AO      │         │    instanceMatrix│
│    (getAOForFace)│        │    .array        │
│                 │         │                  │
│ 4. 打包为       │         │ 4. 设置 AO       │
│    Float32Array │         │    InstancedBuffer│
│    (可 transfer)│         │                  │
└─────────────────┘         └──────────────────┘
```

### 关键变更
- Worker 导入完整 Three.js 用于矩阵计算
- 不再返回 `d={type: [positions]}`，而是返回预计算的 TypedArray
- 主线程 `buildMeshes()` 从 ~200 行循环简化为 ~20 行数据装配

## 3. 数据格式

### Worker 返回格式（新）

```typescript
interface MeshBuildData {
  type: string;                    // 方块类型如 'grass'
  count: number;                   // 实例数量
  matrices: Float32Array;          // 16 * count 元素，矩阵数据
  aoLow: Float32Array;             // count 元素
  aoHigh: Float32Array;            // count 元素
  orientation: Float32Array;       // count 元素
  instanceIndexMap: Record<string, number>;  // posKey -> index
}

interface WorkerResponse {
  cx: number;
  cz: number;
  callbackKey: string;
  meshData: MeshBuildData[];       // 每种方块类型一个
  visibleKeys: string[];
  solidBlocks: string[];
  // ... 其他现有字段
}
```

### 传输方式

```javascript
// Worker 端
const transferables = [
  matrices.buffer,
  aoLow.buffer,
  aoHigh.buffer,
  orientation.buffer
];
postMessage(data, transferables);

// 注意：transferables 传输后，Worker 端数组被清空（zero-copy）
```

## 4. 主线程 buildMeshes 新实现

```javascript
// src/world/ChunkGenerator.js
Chunk.prototype.buildMeshes = function(meshDataArray) {
  if (!Array.isArray(meshDataArray)) {
    console.warn('buildMeshes received legacy data format');
    return;
  }

  const dummy = new THREE.Object3D();

  for (const data of meshDataArray) {
    const { type, count, matrices, aoLow, aoHigh, orientation, instanceIndexMap } = data;

    const props = getBlockProps(type);
    if (!props.isRendered || count === 0) continue;

    const geometry = geomMap[props.geometryType] || geomMap['default'];
    const material = getMaterials().getMaterial(type);

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.userData = { type };

    // 核心优化：直接设置矩阵数据
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;

    // 设置 AO 属性（已预计算）
    if (props.isSolid && !props.isTransparent) {
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
      mesh.castShadow = isSolidShadowCaster(props);
      mesh.receiveShadow = true;
    }

    // 存储索引映射
    this.instanceIndexMap[type] = new Map(Object.entries(instanceIndexMap));

    // 宝箱特殊处理
    if (type === 'chest') {
      mesh.userData.chests = {};
      for (let i = 0; i < count; i++) {
        mesh.userData.chests[i] = { open: false };
      }
    }

    this.group.add(mesh);
  }
};
```

## 5. Worker 端实现

```javascript
// src/workers/WorldWorker.js
import * as THREE from 'three';

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

// 收集可传输 buffer
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
  meshData,
  visibleKeys, solidBlocks,
  // ... 其他字段
}, transferables);
```

## 6. Consolidation 流程适配

```javascript
// src/world/ChunkConsolidation.js
Chunk.prototype._applyConsolidateResult = function(data, consolidatedCount, consolidatedMeshKeys) {
  // ... 原有逻辑 ...

  // 关键变更：data.d 改为 data.meshData
  this.buildMeshes(data.meshData);

  // ... 后续逻辑不变 ...
};
```

## 7. 错误处理

```javascript
// Worker 端
postMessage(data, transferables);
// 传输后不要访问 matrices 等数组！

// 主线程防御式编程
buildMeshes(meshDataArray) {
  if (!meshDataArray?.[0]?.matrices) {
    console.error('Invalid mesh data format');
    return;
  }
  // ...
}
```

## 8. 测试验证

### 性能测试
- 使用 Chrome DevTools Performance 录制 chunk 加载
- 对比优化前后的主线程阻塞时间
- 目标：从 50-150ms 降至 < 5ms

### 功能测试
- 验证所有方块类型正确渲染
- 验证 AO 阴影正确显示
- 验证方块交互（挖掘/放置）正常
- 验证 consolidation 后状态正确

### 兼容性测试
- 旧存档加载
- 跨浏览器（Chrome/Firefox/Safari）

## 9. 预期效果

| 项目 | 当前 | 优化后 |
|------|------|--------|
| 主线程阻塞 | 50-150ms | < 5ms |
| FPS 波动 | 明显卡顿 | 稳定 60 |
| Worker 体积 | ~100KB | ~600KB（+Three.js）|
| 内存传输 | JSON 对象 | TypedArray（零拷贝）|

## 10. 相关文件

- `src/workers/WorldWorker.js` - Worker 矩阵计算
- `src/world/ChunkGenerator.js` - 简化的 buildMeshes
- `src/world/ChunkConsolidation.js` - Consolidation 适配

---

**设计确认**: 2025-01-09
**下一步**: 调用 writing-plans skill 创建实施计划
