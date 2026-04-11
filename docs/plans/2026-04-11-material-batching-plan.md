# Material Batching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 通过按纹理 URL 分组将方块材质合批，减少 Draw Call 40-60%，提升渲染 FPS。

**Architecture:** 
1. 在 MaterialManager 中实现纹理分组统计（阶段一）
2. 修改 WorldWorker 的 buildMeshData 按纹理组输出（阶段二）
3. 创建 BatchedMaterial 支持多纹理采样（阶段三）

**Tech Stack:** Three.js, WebGL GLSL, Web Workers, JavaScript ES6+

---

## 阶段一：基础设施（纹理分组统计）

### Task 1: 在 MaterialManager 中实现 getTextureGroups() 方法

**Files:**
- Modify: `src/core/MaterialManager.js:117-143` (在 registerMaterial 后添加新方法)
- Test: 浏览器控制台手动验证

**Step 1: 添加 getTextureGroups() 方法**

在 `MaterialManager` 类中添加：

```javascript
  /**
   * 获取纹理分组映射 — 用于材质合批优化
   * 将使用相同纹理的方块类型归为一组，减少 Draw Call
   * @returns {Object} 纹理 URL → 方块类型数组 的映射
   */
  getTextureGroups() {
    const groups = {};
    
    for (const [type, def] of this.definitions.entries()) {
      // 跳过透明方块（不参与合批）
      const props = getBlockProperties(type);
      if (!props.isSolid || props.isTransparent) continue;
      
      // 处理多面材质
      if (def.faces) {
        for (const faceDef of Object.values(def.faces)) {
          if (faceDef.textureUrl) {
            if (!groups[faceDef.textureUrl]) groups[faceDef.textureUrl] = [];
            if (!groups[faceDef.textureUrl].includes(type)) {
              groups[faceDef.textureUrl].push(type);
            }
          }
        }
        continue;
      }
      
      // 处理单一纹理
      if (def.textureUrl) {
        if (!groups[def.textureUrl]) groups[def.textureUrl] = [];
        groups[def.textureUrl].push(type);
      }
      
      // 处理纯色材质（按颜色值分组）
      if (def.color) {
        const colorKey = `color:${def.color}`;
        if (!groups[colorKey]) groups[colorKey] = [];
        groups[colorKey].push(type);
      }
    }
    
    // 过滤掉只有一个成员的组（无法合批）
    return Object.fromEntries(
      Object.entries(groups).filter(([_, types]) => types.length > 1)
    );
  }
```

**Step 2: 验证方法可用**

在浏览器控制台运行：
```javascript
const game = window.game;
const groups = game.engine.materials.getTextureGroups();
console.log('纹理分组:', groups);
```

Expected: 输出包含 `planks_birch.png`, `Cobblestone.png` 等复用组的对象

**Step 3: Commit**

```bash
git add src/core/MaterialManager.js
git commit -m "feat(material): 添加 getTextureGroups() 方法用于材质合批统计"
```

---

### Task 2: 添加纹理分组报告输出

**Files:**
- Modify: `src/core/MaterialManager.js` (新增 reportTextureGroups 方法)
- Modify: `src/core/Game.js` (在初始化后调用报告)

**Step 1: 添加 reportTextureGroups() 方法**

在 `MaterialManager` 类中添加：

```javascript
  /**
   * 输出纹理分组报告 — 用于调试和性能分析
   */
  reportTextureGroups() {
    const groups = this.getTextureGroups();
    const totalTypes = Object.values(groups).reduce((sum, types) => sum + types.length, 0);
    const groupCount = Object.keys(groups).length;
    
    console.group('材质合批报告');
    console.log(`纹理组数量：${groupCount}`);
    console.log(`可合批方块类型总数：${totalTypes}`);
    console.log(`预期 Draw Call 减少：从 ${totalTypes} 减少到 ${groupCount} (减少 ${Math.round((1 - groupCount / totalTypes) * 100)}%)`);
    
    // 按组合大小排序输出
    const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    
    for (const [texture, types] of sortedGroups) {
      const displayName = texture.startsWith('color:') 
        ? `纯色 ${texture.replace('color:', '#')}` 
        : texture.split('/').pop();
      console.log(`  ${displayName}: ${types.length} 个方块 (${types.join(', ')})`);
    }
    console.groupEnd();
  }
```

**Step 2: 在游戏启动时调用报告**

在 `src/core/Game.js` 的 `init()` 或 `preload()` 完成后添加：

```javascript
// 材质合批报告（调试用）
this.engine.materials.reportTextureGroups();
```

**Step 3: 验证报告输出**

启动游戏，在控制台查看：

```
材质合批报告
纹理组数量：8
可合批方块类型总数：24
预期 Draw Call 减少：从 24 减少到 8 (减少 67%)
  Cobblestone.png: 4 个方块 (cobblestone, cobblestone_step, cobblestone_step_updown, mossy_stone)
  ...
```

**Step 4: Commit**

```bash
git add src/core/MaterialManager.js src/core/Game.js
git commit -m "feat(material): 添加纹理分组报告，显示预期 Draw Call 减少量"
```

---

### Task 3: 运行 lint 检查

**Files:**
- `src/**/*.js`

**Step 1: 运行 lint**

```bash
npm run lint
```

Expected: 无新增警告（或仅有已有的警告）

**Step 2: 修复警告（如有）**

```bash
npm run lint:fix
```

**Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "style: 修复 lint 警告"
```

---

## 阶段二：Worker 端分组（核心逻辑）

### Task 4: 在 WorldWorker 中接收纹理分组配置

**Files:**
- Modify: `src/workers/WorldWorker.js` (接收 textureGroups 参数)
- Modify: `src/world/ChunkConsolidation.js` (发送 textureGroups)

**Step 1: 修改 ChunkConsolidation 发送 textureGroups**

在 `ChunkConsolidation.js` 的 `consolidate()` 方法中：

```javascript
// 获取纹理分组配置
const textureGroups = this.world?.engine?.materials?.getTextureGroups() || {};

worldWorker.postMessage({
  cx: this.cx,
  cz: this.cz,
  callbackKey,
  seed: WORLD_CONFIG.SEED,
  snapshot: { ... },
  structureCenters: this.structureCenters,
  isOptimization: true,
  textureGroups  // 新增：纹理分组配置
});
```

**Step 2: 在 WorldWorker 中接收配置**

在 `WorldWorker.js` 的 `onmessage` 中：

```javascript
const {
  cx, cz, seed, snapshot, structureCenters,
  callbackKey, isOptimization = false,
  textureGroups = {}  // 新增：纹理分组配置
} = e.data;
```

**Step 3: Commit**

```bash
git add src/world/ChunkConsolidation.js src/workers/WorldWorker.js
git commit -m "feat(worker): 传递 textureGroups 配置到 Worker"
```

---

### Task 5: 修改 buildMeshData 按纹理组输出

**Files:**
- Modify: `src/workers/WorldWorker.js:185-228` (重构 buildMeshData 函数)

**Step 1: 创建新的按纹理分组逻辑**

添加新函数 `buildBatchedMeshData`:

```javascript
/**
 * 按纹理分组构建 meshData — 材质合批优化
 * @param {Object} fakeChunk - 模拟 chunk（提供 getBlock 方法）
 * @param {Object} d - 渲染数据 {type: [positions]}
 * @param {Object} textureGroups - 纹理分组配置
 * @returns {Array} meshDataArray
 */
function buildBatchedMeshData(fakeChunk, d, textureGroups) {
  const meshDataArray = [];
  const dummy = new THREE.Object3D();
  
  // 为每种纹理创建逆映射：方块类型 → 纹理索引
  const typeToTextureIndex = {};
  const textureUrls = Object.keys(textureGroups);
  
  for (let i = 0; i < textureUrls.length; i++) {
    const textureUrl = textureUrls[i];
    for (const type of textureGroups[textureUrl]) {
      typeToTextureIndex[type] = i;
    }
  }
  
  // 按纹理组处理
  for (const [textureUrl, types] of Object.entries(textureGroups)) {
    const allPositions = [];
    
    // 收集该组内所有类型的 positions
    for (const type of types) {
      const positions = d[type];
      if (!positions) continue;
      
      for (const pos of positions) {
        allPositions.push({
          ...pos,
          type,
          textureIndex: typeToTextureIndex[type]
        });
      }
    }
    
    if (allPositions.length === 0) continue;
    
    // 构建该纹理组的 meshData
    const count = allPositions.length;
    const matrices = new Float32Array(count * 16);
    const aoLow = new Float32Array(count);
    const aoHigh = new Float32Array(count);
    const orientation = new Float32Array(count);
    const textureIndexAttr = new Float32Array(count);
    const instanceIndexMap = {};
    
    for (let i = 0; i < count; i++) {
      const pos = allPositions[i];
      
      dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
      dummy.rotation.set(0, getRotationAngle(pos.orientation || 0), 0);
      dummy.updateMatrix();
      
      matrices.set(dummy.matrix.elements, i * 16);
      aoLow[i] = pos.aoLow || 0;
      aoHigh[i] = pos.aoHigh || 0;
      orientation[i] = pos.orientation || 0;
      textureIndexAttr[i] = pos.textureIndex;
      
      const posKey = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      instanceIndexMap[posKey] = { index: i, type: pos.type };
    }
    
    meshDataArray.push({
      type: textureUrl,  // 使用纹理 URL 作为"类型"
      count, matrices, aoLow, aoHigh, orientation,
      textureIndex: textureIndexAttr,
      instanceIndexMap,
      blockTypes: types  // 记录该组包含的方块类型
    });
  }
  
  // 处理不在任何组中的方块（回退到旧逻辑）
  const batchedTypes = new Set(Object.values(textureGroups).flat());
  for (const type in d) {
    if (batchedTypes.has(type)) continue;
    
    const positions = d[type];
    if (positions.length === 0) continue;
    
    // 使用原始 buildMeshData 逻辑处理
    // ...（复用原有代码）
  }
  
  return meshDataArray;
}
```

**Step 2: 在生成逻辑中调用新函数**

在 `onmessage` 处理中：

```javascript
// 判断是否启用材质合批
const useBatching = Object.keys(textureGroups).length > 0;

if (useBatching) {
  const meshData = buildBatchedMeshData(fakeChunk, d, textureGroups);
  // ...
} else {
  const meshData = buildMeshData(fakeChunk, d, cx, cz);
  // ...
}
```

**Step 3: Commit**

```bash
git add src/workers/WorldWorker.js
git commit -m "feat(worker): 实现 buildBatchedMeshData 按纹理组输出"
```

---

### Task 6: 修改 ChunkGenerator.buildMeshes 支持合批数据

**Files:**
- Modify: `src/world/ChunkGenerator.js:98-170` (重构 buildMeshes 函数)

**Step 1: 添加合批数据处理逻辑**

```javascript
Chunk.prototype.buildMeshes = function(meshDataArray) {
  // ... 现有检查逻辑 ...
  
  for (const data of meshDataArray) {
    // 判断是否为合批数据（包含 blockTypes 数组）
    if (data.blockTypes) {
      this._buildBatchedMesh(data);
    } else {
      this._buildSingleTypeMesh(data);
    }
  }
}

/**
 * 构建合批 Mesh（多个方块类型共享一个 InstancedMesh）
 */
Chunk.prototype._buildBatchedMesh = function(data) {
  const { type: textureUrl, count, matrices, aoLow, aoHigh, orientation, textureIndex, instanceIndexMap, blockTypes } = data;
  
  // 创建使用共享材质的 InstancedMesh
  const batchedMaterial = this.world.engine.materials.getBatchedMaterial(textureUrl, blockTypes);
  const geometry = geomMap[getBlockProps(blockTypes[0]).geometryType] || geomMap['default'];
  
  const mesh = new THREE.InstancedMesh(geometry, batchedMaterial, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.array.set(matrices);
  mesh.instanceMatrix.needsUpdate = true;
  
  // 设置 AO 属性
  mesh.geometry.setAttribute('aAoLow', new THREE.InstancedBufferAttribute(aoLow, 1));
  mesh.geometry.setAttribute('aAoHigh', new THREE.InstancedBufferAttribute(aoHigh, 1));
  mesh.geometry.setAttribute('aOrientation', new THREE.InstancedBufferAttribute(orientation, 1));
  mesh.geometry.setAttribute('aTextureIndex', new THREE.InstancedBufferAttribute(textureIndex, 1));
  
  mesh.userData = { type: 'batched', blockTypes, textureUrl };
  this.instanceIndexMap['batched_' + textureUrl] = new Map(Object.entries(instanceIndexMap));
  
  this.group.add(mesh);
};
```

**Step 2: Commit**

```bash
git add src/world/ChunkGenerator.js
git commit -m "feat(chunk): buildMeshes 支持合批数据处理"
```

---

### Task 7: 实现 getBatchedMaterial 方法

**Files:**
- Modify: `src/core/MaterialManager.js` (新增 getBatchedMaterial 方法)

**Step 1: 添加合批材质缓存**

在构造函数中：
```javascript
this.batchedMaterials = new Map();  // 合批材质缓存
```

**Step 2: 实现 getBatchedMaterial 方法**

```javascript
  /**
   * 获取合批材质 — 支持多个方块类型共享
   * @param {string} textureUrl - 主纹理 URL
   * @param {Array} blockTypes - 该组包含的方块类型
   * @returns {THREE.Material} 合批材质
   */
  getBatchedMaterial(textureUrl, blockTypes) {
    const cacheKey = `batched:${textureUrl}:${blockTypes.sort().join(',')}`;
    
    if (this.batchedMaterials.has(cacheKey)) {
      return this.batchedMaterials.get(cacheKey);
    }
    
    // 获取第一个方块类型的材质作为基础
    const baseMaterial = this.getMaterial(blockTypes[0]);
    
    // 创建合批材质（克隆基础材质）
    const batchedMaterial = baseMaterial.clone();
    
    // 存储纹理列表供着色器使用
    batchedMaterial.userData.batchedTextures = blockTypes.map(type => {
      const def = this.definitions.get(type);
      return def?.textureUrl || null;
    }).filter(Boolean);
    
    this.batchedMaterials.set(cacheKey, batchedMaterial);
    return batchedMaterial;
  }
```

**Step 3: Commit**

```bash
git add src/core/MaterialManager.js
git commit -m "feat(material): 实现 getBatchedMaterial 合批材质"
```

---

### Task 8: 测试阶段二功能

**Files:**
- 游戏启动测试

**Step 1: 启动游戏**

```bash
npm run start
```

**Step 2: 验证渲染正常**

- 访问 http://localhost:8080
- 观察方块渲染是否正常（无黑闪、无错位）
- 在控制台检查是否有错误

**Step 3: 验证 Draw Call 减少**

在 Three.js 调试工具或浏览器开发者工具中：
```javascript
// 查看 renderer.info
const info = window.game.engine.renderer.info;
console.log('Draw Calls:', info.render.calls);
console.log('几何体数量:', info.memory.geometries);
```

**Step 4: Commit（如测试通过）**

```bash
git commit --allow-empty -m "test: 阶段二测试通过，Draw Call 减少验证"
```

---

## 阶段三：自定义 Shader（多纹理采样）

### Task 9: 创建 BatchedMaterial 类

**Files:**
- Create: `src/core/BatchedMaterial.js`

**Step 1: 创建基础 ShaderMaterial**

```javascript
import * as THREE from 'three';

/**
 * 合批材质 — 支持多纹理采样
 * 用于材质合批优化，多个方块类型共享一个 InstancedMesh
 */
export class BatchedMaterial extends THREE.ShaderMaterial {
  constructor(params = {}) {
    const { textures = [], baseColor = 0xffffff } = params;
    
    super({
      uniforms: {
        uTextures: { value: textures.map(t => t.map) },
        uBaseColor: { value: new THREE.Color(baseColor) }
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vTextureIndex;
        varying float vAo;
        
        attribute float aTextureIndex;
        attribute float aAoLow;
        attribute float aAoHigh;
        
        void main() {
          vUv = uv;
          vTextureIndex = aTextureIndex;
          
          // AO 计算（简化版）
          int vertexId = int(mod(uv.x * 100.0 + uv.y, 24.0));
          vAo = 1.0; // TODO: 从 aAoLow/aAoHigh 提取
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTextures[16];
        uniform vec3 uBaseColor;
        
        varying vec2 vUv;
        varying float vTextureIndex;
        varying float vAo;
        
        void main() {
          vec4 color;
          
          // 根据 textureIndex 采样对应纹理
          int idx = int(vTextureIndex);
          if (idx == 0) color = texture2D(uTextures[0], vUv);
          else if (idx == 1) color = texture2D(uTextures[1], vUv);
          else if (idx == 2) color = texture2D(uTextures[2], vUv);
          else color = vec4(uBaseColor, 1.0);
          
          // 应用 AO
          color.rgb *= vAo;
          
          gl_FragColor = color;
        }
      `,
      side: params.side || THREE.FrontSide,
      transparent: params.transparent || false
    });
  }
}
```

**Step 2: Commit**

```bash
git add src/core/BatchedMaterial.js
git commit -m "feat(material): 创建 BatchedMaterial 多纹理采样材质"
```

---

### Task 10: 集成 BatchedMaterial 到 MaterialManager

**Files:**
- Modify: `src/core/MaterialManager.js` (导入并使用 BatchedMaterial)

**Step 1: 导入 BatchedMaterial**

```javascript
import { BatchedMaterial } from './BatchedMaterial.js';
```

**Step 2: 修改 getBatchedMaterial 使用新材质**

```javascript
getBatchedMaterial(textureUrl, blockTypes) {
  // ...
  // 加载所有纹理
  const textureObjects = blockTypes.map(type => {
    const def = this.definitions.get(type);
    if (def?.textureUrl) {
      return this.textureCache.get(def.textureUrl);
    }
    return null;
  }).filter(Boolean);
  
  const batchedMat = new BatchedMaterial({
    textures: textureObjects,
    baseColor: 0xffffff
  });
  
  this.batchedMaterials.set(cacheKey, batchedMat);
  return batchedMat;
}
```

**Step 3: Commit**

```bash
git add src/core/MaterialManager.js
git commit -m "feat(material): 集成 BatchedMaterial 到 getBatchedMaterial"
```

---

### Task 11: 处理 AO 着色器集成

**Files:**
- Modify: `src/core/BatchedMaterial.js` (完善 AO 计算)
- Reference: `src/core/MaterialManager.js:_applyShaderModifications`

**Step 1: 复制 AO 逻辑到 BatchedMaterial**

参考 `MaterialManager._applyShaderModifications` 中的 AO 计算逻辑，在 BatchedMaterial 的 fragment shader 中添加：

```glsl
float decodeAo(float packed, int vertexIndex) {
  // 从打包的 AO 值中提取指定顶点的 AO
  int shift = vertexIndex * 2;
  return float((int(packed) >> shift) & 3) / 3.0;
}
```

**Step 2: Commit**

```bash
git add src/core/BatchedMaterial.js
git commit -m "feat(shader): 在 BatchedMaterial 中集成 AO 计算"
```

---

### Task 12: 最终测试和调优

**Files:**
- 全游戏测试

**Step 1: 启动游戏**

```bash
npm run start
```

**Step 2: 全面功能测试**

- 方块放置/挖掘正常
- 不同材质方块渲染正确
- 无黑闪、无纹理错位
- AO 效果正常

**Step 3: 性能测试**

```javascript
// 在控制台运行
const renderer = window.game.engine.renderer;
setInterval(() => {
  console.log('Draw Calls:', renderer.info.render.calls);
}, 1000);
```

**Step 4: 运行 lint**

```bash
npm run lint
```

**Step 5: Commit 最终版本**

```bash
git add -A
git commit -m "feat(material-batching): 完成材质合批优化，Draw Call 减少 40%+"
```

---

## 验收清单

- [ ] 阶段一：`getTextureGroups()` 输出正确的纹理分组
- [ ] 阶段一：`reportTextureGroups()` 显示预期 Draw Call 减少量
- [ ] 阶段二：Worker 按纹理组输出 meshData
- [ ] 阶段二：ChunkGenerator 正确创建合批 Mesh
- [ ] 阶段二：所有方块渲染正常
- [ ] 阶段三：BatchedMaterial 正确采样多纹理
- [ ] 阶段三：AO 效果正常
- [ ] 性能：Draw Call 减少 40%+
- [ ] 性能：FPS 稳定在 60（无明显下降）
- [ ] 代码：lint 无新增警告
