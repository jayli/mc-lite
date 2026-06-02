# WebGLRenderer → WebGPURenderer 迁移实施计划（v3: Spike-First）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将渲染引擎从 `THREE.WebGLRenderer` 迁移到 `THREE.WebGPURenderer`（强制 WebGL 后端），同时将所有自定义着色器从 GLSL/onBeforeCompile 迁移到 TSL 节点系统。

**Architecture:** 先通过 3 个技术 spike 验证 TSL API 在关键场景下的可行性，再执行全量迁移。使用 `forceWebGL: true` 确保浏览器兼容性。

**Tech Stack:** Three.js r184 (`three.webgpu.js` + `three.tsl.js`), TSL Node System, WebGPURenderer + WebGLBackend

---

## 技术背景

### WebGPURenderer 材质转换管线

```
MeshStandardMaterial → library.fromMaterial() → MeshStandardNodeMaterial → NodeBuilder → GLSL(WebGL)/WGSL(WebGPU)
ShaderMaterial → 无映射 → error + 空 NodeMaterial（渲染失败）
```

**不兼容项：**
- `onBeforeCompile()` — 不被调用（`src/core/MaterialManager.js:327`）
- `ShaderMaterial` / `RawShaderMaterial` — 无 Node 映射（`src/core/BatchedMaterial.js:14`, `src/core/Engine.js:607`, `src/world/effects/RainEffect.js:82`）

参考：[Three.js WebGPURenderer 文档](https://threejs.org/manual/en/webgpurenderer)

### Import Map 规范

```json
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.tsl.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/",
    "stats": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/stats.module.js"
  }
}
```

- `three` → `three.webgpu.js`（完整 Three.js + WebGPURenderer + NodeMaterial 类）
- `three/tsl` → `three.tsl.js`（TSL 函数导出：`Fn`, `attribute`, `varying`, `vertexStage` 等）
- `three/webgpu` → `three.webgpu.js`（**必需**：`three.webgpu.js` 内部会 import 'three/webgpu'，缺少此映射会导致模块解析失败。Spike 1 验证时发现此问题。）

### 导入规则

| 来源 | 导出内容 | 示例 |
|------|---------|------|
| `'three'` | Three.js 核心类 + WebGPURenderer + NodeMaterial 系列 | `import { WebGPURenderer, MeshStandardNodeMaterial, NodeMaterial } from 'three'` |
| `'three/tsl'` | TSL 节点函数 | `import { attribute, varying, vertexStage, Fn, uniform, materialColor } from 'three/tsl'` |

**切勿从 `'three/tsl'` 导入 `NodeMaterial`/`MeshStandardNodeMaterial` 等类。** 它们是 class，来自 `three.webgpu.js`（即 `'three'`）。

### TSL 关键 API（已确认在 r184 three.tsl.js 中导出）

| API | 用途 | 解决的问题 |
|-----|------|-----------|
| `attribute(name, nodeType)` | 按名称读取 geometry 上的 attribute（含 InstancedBufferAttribute） | AO 的 `aAoLow`/`aAoHigh`/`aOrientation`/`aVertexId` |
| `vertexStage(node)` | 标记节点在顶点阶段计算 | AO 必须在 vertex 阶段 remap |
| `varying(node, name)` | 创建 varying 传递 vertex→fragment | AO 值从顶点传到片元 |
| `materialColor` | 获取材质原始 color * map 结果 | 不覆盖纹理，只叠加 AO |
| `texture(tex, uvNode)` | 纹理采样 | BatchedMaterial 多纹理选择 |
| `If(condition, ifBlock)` | 条件分支 | 纹理索引选择、AO remap 分支 |
| `Discard` | 片元丢弃 | 水面遮罩区域裁切 |
| `Fn({})` | 定义可调用的 TSL 函数 | 组织复杂着色逻辑 |

**注意 `attribute()` 参数顺序：** `attribute(name, nodeType)`，例如 `attribute('aAoLow', 'float')`。这与直觉的 `(type, name)` 相反。

**`attribute()` vs `instancedBufferAttribute()`：** 项目已在 geometry 上通过 `setAttribute('aAoLow', new THREE.InstancedBufferAttribute(...))` 设置属性。TSL 的 `attribute('aAoLow', 'float')` 会按名称查找 geometry attribute，无论它是普通 `BufferAttribute` 还是 `InstancedBufferAttribute`。`instancedBufferAttribute(bufferAttr, type, stride)` 则用于包装一个尚未挂在 geometry 上的裸 `InstancedBufferAttribute` 对象为 TSL 节点——不适合本项目场景。

---

## Phase 0: 技术 Spike（验证 TSL API 可行性）

### Spike 1: MeshStandardNodeMaterial + InstancedMesh + AO Attribute

**目标：** 验证以下关键链路在 `WebGPURenderer({ forceWebGL: true })` 下工作：
1. `MeshStandardNodeMaterial` + `map`（纹理）正常显示
2. `InstancedMesh` + `geometry.setAttribute('name', new InstancedBufferAttribute(...))` 可通过 `attribute('name', 'float')` 在 TSL 中按名读取
3. `vertexStage()` + `varying()` 可以将顶点计算结果传递到 fragment
4. 在 fragment 中用 AO 值 darken `materialColor`，**不丢失纹理**
5. `material.clone()` 后 `colorNode`、共享 uniform 引用是否保留

**Files:**
- Create: `test/spike-ao-node.html`（独立测试页，不影响主游戏）

- [ ] **Step 1: 创建独立测试页面**

```html
<!DOCTYPE html>
<html>
<head><title>Spike: AO NodeMaterial</title></head>
<body>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.tsl.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { attribute, varying, vertexStage,
         float, Fn, uniform, mix, materialColor } from 'three/tsl';

async function main() {
  // 1. WebGPURenderer + forceWebGL
  const renderer = new THREE.WebGPURenderer({ forceWebGL: true });
  await renderer.init();
  renderer.setSize(800, 600);
  document.body.appendChild(renderer.domElement);
  console.log('Backend:', renderer.backend.constructor.name);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 100);
  camera.position.set(3, 3, 3);
  camera.lookAt(0, 0, 0);

  // 2. 纹理加载（test/ 目录下需用绝对路径或相对到项目根）
  const tex = new THREE.TextureLoader().load('../src/assets/textures/grass_carried.png');

  // 3. MeshStandardNodeMaterial + map（来自 'three'，不是 'three/tsl'）
  const mat = new THREE.MeshStandardNodeMaterial({ map: tex });

  // 4. 模拟项目现状：通过 geometry.setAttribute 设置 InstancedBufferAttribute
  //    然后用 attribute('aAoValue', 'float') 按名读取
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const aoData = new Float32Array([1.0, 0.5, 0.2, 0.8]);
  geo.setAttribute('aAoValue', new THREE.InstancedBufferAttribute(aoData, 1));

  // 5. TSL: 用 attribute(name, type) 读取 instanced attribute
  const aAoValue = attribute('aAoValue', 'float');

  // 6. vertexStage 计算 + varying 传递
  const vAo = varying(vertexStage(aAoValue), 'vAo');

  // 7. 叠加到 materialColor（不替代，而是乘算）
  const uAoEnabled = uniform(1.0);
  mat.colorNode = Fn(() => {
    const baseColor = materialColor;
    return mix(baseColor, baseColor.mul(vAo), uAoEnabled);
  })();

  // 8. InstancedMesh
  const mesh = new THREE.InstancedMesh(geo, mat, 4);
  const m = new THREE.Matrix4();
  [[0,0,0],[2,0,0],[0,0,2],[2,0,2]].forEach((pos, i) => {
    m.setPosition(...pos);
    mesh.setMatrixAt(i, m);
  });
  scene.add(mesh);

  // 9. 验证 material.clone() — 模拟动态方块 clone 场景
  const clonedMat = mat.clone();
  const cloneGeo = new THREE.BoxGeometry(1, 1, 1);
  cloneGeo.setAttribute('aAoValue', new THREE.InstancedBufferAttribute(
    new Float32Array([0.3, 0.7, 1.0, 0.4]), 1
  ));
  const cloneMesh = new THREE.InstancedMesh(cloneGeo, clonedMat, 4);
  [[4,0,0],[6,0,0],[4,0,2],[6,0,2]].forEach((pos, i) => {
    m.setPosition(...pos);
    cloneMesh.setMatrixAt(i, m);
  });
  scene.add(cloneMesh);

  // 光源
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 5, 5);
  scene.add(dirLight);

  // 渲染
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  // 10. 3 秒后切换 uAoEnabled → 验证共享 uniform toggle
  setTimeout(() => {
    console.log('Toggle AO off');
    uAoEnabled.value = 0.0;
    setTimeout(() => {
      console.log('Toggle AO on');
      uAoEnabled.value = 1.0;
    }, 2000);
  }, 3000);

  console.log('Spike 1 验证点:');
  console.log('  - 左侧 4 方块: 纹理 + AO 明暗差异（index 2 最暗 0.2）');
  console.log('  - 右侧 4 方块（clone）: 纹理 + AO 明暗差异');
  console.log('  - 3s 后 AO 关闭 → 5s 后 AO 恢复（两组都应响应）');
}
main();
</script>
</body>
</html>
```

- [ ] **Step 2: 运行验证**

Run: `npm run start`，浏览器打开 `http://localhost:8080/test/spike-ao-node.html`

**通过条件：**
- Console 输出 `Backend: WebGLBackend`，无 error
- 左侧 4 个方块都有草地纹理，明暗不同（AO=0.2 的明显偏暗）
- 右侧 4 个方块（clone 材质）同样有纹理+AO
- 3s 后两组方块 AO 同时关闭（变亮），5s 后同时恢复
- `uniform(1.0)` 写法可用（比 `uniform(float(1.0))` 更简洁）

**失败应对：**
- 如果 `attribute('aAoValue', 'float')` 不能读到 InstancedBufferAttribute → 尝试 `instancedBufferAttribute(geo.getAttribute('aAoValue'), 'float', 1)`
- 如果 `materialColor` 节点不包含纹理 → 改用 `texture(mat.map, uv()).mul(mat.color)` 显式采样
- 如果 `vertexStage` + `varying` 不正确 → 直接在 fragment 读取 attribute（性能降低但可行）
- 如果 `clone()` 后 colorNode 丢失或 uniform 不共享 → 需要手动在 clone 后重新 `applyAOToMaterial(clonedMat, uAoEnabled)`
- 如果 `uniform(1.0)` 不工作 → 回退到 `uniform(float(1.0))`

- [ ] **Step 3: 扩展验证 — 完整 AO remap 逻辑**

在通过 Step 2 后，扩展测试加入完整 AO remap 逻辑：
- 24 个顶点的 `aVertexId`（per-vertex `BufferAttribute`，用 `attribute('aVertexId', 'float')` 读取）
- `aAoLow` + `aAoHigh` 打包格式（per-instance `InstancedBufferAttribute`，用 `attribute('aAoLow', 'float')` 读取）
- `aOrientation` 旋转 remap
- 验证结果与原 GLSL 一致

---

### Spike 2: BatchedMaterial TSL 多纹理选择

**目标：** 验证在 TSL 中用 per-instance attribute 选择不同纹理的方案（If 分支）。

**Files:**
- Create: `test/spike-batched-texture.html`

- [ ] **Step 1: 创建独立测试页面**

```html
<!DOCTYPE html>
<html>
<head><title>Spike: Batched Texture Selection</title></head>
<body>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.tsl.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { Fn, float, int, attribute, texture, uv, vec3, vec2,
         If, mod, floor, uniform } from 'three/tsl';

async function main() {
  const renderer = new THREE.WebGPURenderer({ forceWebGL: true });
  await renderer.init();
  renderer.setSize(800, 600);
  document.body.appendChild(renderer.domElement);
  console.log('Backend:', renderer.backend.constructor.name);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 100);
  camera.position.set(4, 4, 4);
  camera.lookAt(0, 0, 0);

  // 加载 3 种纹理（模拟 batched 场景的不同方块纹理）
  const loader = new THREE.TextureLoader();
  const texGrass = loader.load('../src/assets/textures/grass_carried.png');
  const texStone = loader.load('../src/assets/textures/stone.png');
  const texSand  = loader.load('../src/assets/textures/sand.png');

  // MeshBasicNodeMaterial（保持 unlit，与当前 BatchedMaterial 视觉一致）
  const mat = new THREE.MeshBasicNodeMaterial();

  // 模拟项目现状：geometry 上设置 per-instance aTextureIndex
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const instanceCount = 6;
  // 每个实例一个 textureIndex：0, 1, 2, 0, 1, 2
  const texIndices = new Float32Array([0, 1, 2, 0, 1, 2]);
  geo.setAttribute('aTextureIndex', new THREE.InstancedBufferAttribute(texIndices, 1));

  // 方案 A：If 分支选择纹理
  const aTextureIndex = attribute('aTextureIndex', 'float');

  // colorNode 返回 vec3（Batched 方块不透明，不需要 alpha）
  mat.colorNode = Fn(() => {
    const result = vec3(1.0, 0.0, 1.0).toVar(); // 默认品红色（debug：未命中任何分支）
    const idx = int(aTextureIndex);
    If(idx.equal(0), () => { result.assign(texture(texGrass, uv()).rgb); });
    If(idx.equal(1), () => { result.assign(texture(texStone, uv()).rgb); });
    If(idx.equal(2), () => { result.assign(texture(texSand, uv()).rgb); });
    return result;
  })();

  // InstancedMesh
  const mesh = new THREE.InstancedMesh(geo, mat, instanceCount);
  const m = new THREE.Matrix4();
  [[0,0,0],[2,0,0],[4,0,0],[0,0,2],[2,0,2],[4,0,2]].forEach((pos, i) => {
    m.setPosition(...pos);
    mesh.setMatrixAt(i, m);
  });
  scene.add(mesh);

  // 光源（MeshBasicNodeMaterial 不受光照影响，但加上方便对比）
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  console.log('Spike 2 验证点:');
  console.log('  - 6 个方块分别显示 草/石/沙/草/石/沙 纹理');
  console.log('  - 无品红色方块（品红 = textureIndex 未命中任何分支）');
  console.log('  - Console 无 shader 编译 error');
}
main();
</script>
</body>
</html>
```

- [ ] **Step 2: 运行验证**

Run: `npm run start`，浏览器打开 `http://localhost:8080/test/spike-batched-texture.html`

**通过条件：**
- 6 个方块按 index 显示对应纹理（无品红色 debug 块）
- Console 无 shader 编译错误
- 无 error/warning

**失败应对：**
- If 分支编译过慢（>16 纹理时） → 使用 Texture Atlas 方案（UV 偏移）：
  ```javascript
  // atlas UV 计算示例
  const atlasSize = float(4); // 4x4 atlas
  const atlasUV = Fn(() => {
    const idx = float(aTextureIndex);
    const col = mod(idx, atlasSize);
    const row = floor(idx.div(atlasSize));
    return uv().mul(vec2(1.0).div(atlasSize)).add(vec2(col, row).div(atlasSize));
  })();
  ```
- `attribute('aTextureIndex', 'float')` 读取失败 → 参考 Spike 1 的 fallback 方案

- [ ] **Step 3: 确认 BatchedMaterial 实际使用路径 + textureIndex 语义**

`src/world/ChunkGenerator.js:173` 调用 `getBatchedMaterial(textureUrl, blockTypes)`。需要确认：
- 哪些方块类型走 batched 路径 vs `GlobalInstancedMeshManager` 按类型分组路径
- batched 路径中每个 batch 最多包含多少种纹理
- 这决定了 If 分支方案是否可接受（≤16 种可以接受，>16 需要 atlas）
- **确认 aTextureIndex 与材质内部 textures 的索引空间一致**：`src/workers/WorldWorker.js:375` 生成的 textureIndex 是全局索引还是 batch 内局部索引？`src/core/MaterialManager.js:208` 给每个 batched material 传入的 blockTypes 纹理列表如何与 index 对应？迁移时必须确保两者一致，否则纹理会错位。**执行约束：如果发现 Worker 生成全局 index 而材质使用 batch 局部 textures，优先修正 Worker/MaterialManager 的索引映射逻辑使两端一致，不要在 shader 层做 index 转换绕过——否则后续维护难以理解**

---

### Spike 3: 水面 + 雨滴 NodeMaterial 验证

**目标：** 验证以下 TSL 特性组合：
1. `NodeMaterial` + `transparent` + `Discard`（水面遮罩）
2. `positionWorld` / `cameraPosition` / `modelViewMatrix` 内置节点（水面光照计算）
3. `LineSegments` + `NodeMaterial` + `positionNode`（雨滴位移）
4. uniform 每帧更新（`uTime.value = ...`）

**Files:**
- Create: `test/spike-water-rain.html`

- [ ] **Step 1: 水面最小验证**

```javascript
import * as THREE from 'three'; // NodeMaterial 来自 three（即 three.webgpu.js）
import { Fn, uniform, float, vec3, positionWorld, positionLocal, cameraPosition,
         sin, mod, length, smoothstep, Discard, mix, attribute } from 'three/tsl';

const waterMat = new THREE.NodeMaterial();
waterMat.transparent = true;
waterMat.depthWrite = false;
waterMat.side = THREE.DoubleSide;
waterMat.lights = false;

const uTime = uniform(0);
const uOpacity = uniform(0.7);

// colorNode 只管 RGB（r184 中 colorNode 类型为 vec3）
waterMat.colorNode = Fn(() => {
  const worldPos = positionWorld;
  const dist = length(worldPos.xz.sub(cameraPosition.xz));

  // 测试 Discard
  Discard(dist.greaterThan(50.0));

  // 水面颜色
  return vec3(0.3, 0.5, 0.9);
})();

// opacityNode 单独管 alpha（透明度 + 波浪动画）
waterMat.opacityNode = Fn(() => {
  const worldPos = positionWorld;
  const wave = sin(worldPos.x.mul(1.5).add(uTime.mul(5.0))).mul(0.1);
  return uOpacity.add(wave);
})();

// animate 中：uTime.value += 0.016;
```

**验证点：**
- 水面半透明可见（opacityNode 生效）
- 超过 50 单位被 discard（无渲染）
- 波浪动画随时间变化（opacity 随 sin 波动）
- `positionWorld` 和 `cameraPosition` 返回正确的世界坐标

**额外验证：colorNode 返回 vec4 是否也能工作**
- 如果 `colorNode = vec4(r,g,b,a)` 也能正确处理透明度，记录下来
- 优先方案：`colorNode` 管 RGB + `opacityNode` 管 alpha（分离更清晰，与 r184 文档类型一致）

- [ ] **Step 2: 雨滴（LineSegments + positionNode）验证**

```javascript
const rainMat = new THREE.NodeMaterial(); // NodeMaterial 来自 'three'
rainMat.transparent = true;
rainMat.depthWrite = false;
rainMat.lights = false;

const uTime = uniform(0);
const aPhase = attribute('aPhase', 'float');

rainMat.positionNode = Fn(() => {
  const pos = positionLocal.toVar();
  const fall = mod(uTime.mul(10.0).add(aPhase), float(20.0));
  pos.y.assign(pos.y.sub(fall));
  return pos;
})();

// colorNode 为 vec3（RGB），opacityNode 管透明度
rainMat.colorNode = vec3(1.0, 1.0, 1.0);
rainMat.opacityNode = float(0.6);

// 使用 LineSegments
const lines = new THREE.LineSegments(geometry, rainMat);
```

**验证点：**
- `LineSegments` 正常渲染（不是 Mesh）
- 顶点按 `positionNode` 位移下落
- uniform 更新驱动动画
- 雨滴半透明（opacityNode = 0.6 生效）

- [ ] **Step 3: 运行并记录结果**

Run: `npm run start`，浏览器打开 `http://localhost:8080/test/spike-water-rain.html`

**通过条件：**
- 水面半透明 + discard + 波浪动画
- 雨滴线段正常下落

**失败应对：**
- `Discard` 不工作 → 改用 `alphaTest` + opacity=0
- `positionNode` 对 LineSegments 无效 → 改用 `vertexNode` 或计算后直接改 position attribute
- `positionWorld` 在 fragment 中不可用 → 用 `varying(positionWorld)` 显式传递

---

## Phase A: 全量迁移（Spike 全部通过后执行）

### 前置条件
- Spike 1 通过 → AO 方案确定
- Spike 2 通过 → BatchedMaterial 方案确定
- Spike 3 通过 → 水面/雨滴方案确定

### Task 1: 切换构建包 + Renderer + 异步初始化

**Files:**
- Modify: `index.html:192-199` (import map)
- Modify: `index.html:240, 321` (**两条** Game 创建路径都需要 await)
- Modify: `src/tests/index.html:321` (import map，当前仍指向 three@0.160.0)
- Modify: `src/tests/test-face-culling.html:53` (import map，当前仍指向 three@0.160.0)
- Modify: `src/core/Engine.js:141-154` (Renderer 构造)
- Modify: `src/core/Engine.js` (添加 `initRenderer()`, render 就绪检查)
- Modify: `src/core/Game.js` (暴露 `initEngine()`)

**注意：** 测试页的 import map 必须同步更新，否则 `node command/run-tests.js` 加载测试页时，源码模块 `import ... from 'three/tsl'` 会解析失败。测试页 import map 需要包含 `three`、`three/tsl`、`three/webgpu`、`three/addons/` 全部条目。

- [ ] **Step 1: 修改 import map**

```json
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.tsl.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/",
    "stats": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/stats.module.js"
  }
}
```

- [ ] **Step 2: Engine.js — 替换 Renderer**

```javascript
this.renderer = new THREE.WebGPURenderer({
  forceWebGL: true,
  antialias: false,
  powerPreference: "high-performance"
});
this._rendererReady = false;
```

保留后续 shadowMap/toneMapping 配置不变。

- [ ] **Step 3: Engine.js — 异步 init + 就绪检查**

```javascript
async initRenderer() {
  await this.renderer.init();
  this._rendererReady = true;
  console.log(`[Engine] Renderer ready, backend: ${this.renderer.backend?.constructor?.name}`);
}

render(dt) {
  if (!this._rendererReady) return;
  // ...原有渲染逻辑
}
```

- [ ] **Step 4: Game.js — 暴露异步初始化**

```javascript
async initEngine() {
  await this.engine.initRenderer();
}
```

- [ ] **Step 5: index.html — 两条启动路径都 await**

`index.html:240` (modal 路径):
```javascript
const game = new Game();
await game.initEngine();
```

`index.html:321` (无 modal fallback):
```javascript
const game = new Game();
await game.initEngine();
game.start();
```

- [ ] **Step 6: 验证**

此时画面预期大面积异常（AO 丢失、ShaderMaterial 失效），但：
- Console 输出 `[Engine] Renderer ready, backend: WebGLBackend`
- 无 crash / 无无限循环
- 基础 MeshStandardMaterial（无 onBeforeCompile 的简单材质）应能渲染

**如果旧 ShaderMaterial 导致 WebGPURenderer 直接报错（而非静默失败），不临时绕过或注释掉，继续完成 Task 2~5 的材质迁移即可——迁移完成后这些 ShaderMaterial 自然被 NodeMaterial 替代。**

---

### Task 2: AO 系统迁移

**Files:**
- Create: `src/core/AONodeSystem.js`
- Modify: `src/core/MaterialManager.js`

**核心设计（基于 Spike 1 验证结果，attribute 参数顺序以 Spike 验证为准）：**

```javascript
// src/core/AONodeSystem.js
import { Fn, float, attribute, varying, vertexStage,
         uniform, mix, mod, floor, pow, If, materialColor } from 'three/tsl';

// per-vertex 属性（几何体上的 BufferAttribute）
// attribute(name, nodeType) — 注意参数顺序：名称在前，类型在后
const aVertexId = attribute('aVertexId', 'float');

// per-instance 属性（geometry 上的 InstancedBufferAttribute，同样用 attribute() 按名读取）
const aAoLow = attribute('aAoLow', 'float');
const aAoHigh = attribute('aAoHigh', 'float');
const aOrientation = attribute('aOrientation', 'float');

// AO remap + 解码逻辑（在 vertex 阶段计算）
const aoComputed = Fn(({ vertexId, aoLow, aoHigh, orientation }) => {
  // remapAoVertexId 的 TSL 实现
  // 具体实现由 Spike 1 Step 3 验证后填入
  // ...
  // 最终返回 float [0.1, 1.0]
})({ vertexId: aVertexId, aoLow: aAoLow, aoHigh: aAoHigh, orientation: aOrientation });

// 标记为顶点阶段计算，通过 varying 传递到 fragment
const vAo = varying(vertexStage(aoComputed), 'vAo');

/**
 * 为材质注入 AO 效果
 * 关键：使用 materialColor 获取原始 color*map 结果，不破坏纹理
 */
export function applyAOToMaterial(material, uAoEnabled) {
  material.colorNode = Fn(() => {
    const base = materialColor; // 包含 material.color × material.map 的完整结果
    return mix(base, base.mul(vAo), uAoEnabled);
  })();
}
```

- [ ] **Step 1: 实现 AONodeSystem.js**

完整翻译 `remapTopCorner`、`remapBottomCorner`、`remapSideFace`、`remapAoVertexId`、`getAo` 为 TSL。

翻译策略：
- GLSL 的 `if (x < 0.5)` → TSL 的 `If(x.lessThan(0.5), ...)`
- GLSL 的 `mod(a, b)` → TSL 的 `mod(a, b)`
- GLSL 的 `pow(4.0, n)` → TSL 的 `pow(float(4.0), n)`
- GLSL 的 `floor(x)` → TSL 的 `floor(x)`

- [ ] **Step 2: 修改 MaterialManager._createMaterial**

将 `MeshStandardMaterial` 改为 `MeshStandardNodeMaterial`：
```javascript
import { MeshStandardNodeMaterial } from 'three';
import { applyAOToMaterial } from './AONodeSystem.js';

// 在 _createMaterial 中：
const mat = new MeshStandardNodeMaterial({
  map: texture,
  transparent: def.transparent || false,
  // ...其他属性
});

if (useAO) {
  applyAOToMaterial(mat, this._uAoEnabled);
}
```

- [ ] **Step 3: 删除 _applyShaderModifications，更新 _syncAOShaderState**

```javascript
constructor() {
  // ...
  this._uAoEnabled = uniform(1.0); // 共享 uniform，所有材质引用同一个
}

_syncAOShaderState(enabled) {
  this._uAoEnabled.value = enabled ? 1.0 : 0.0;
}
```

- [ ] **Step 4: 验证矩阵（AO 专项）**

| 场景 | 检查项 |
|------|--------|
| 新世界启动 | 方块有纹理 + AO 暗角 |
| 放置方块 | 新方块周围 AO 更新 |
| 删除方块 | 相邻方块 AO 变化 |
| consolidation 触发 | consolidation 后 AO 不丢失 |
| GlobalInstancedMesh resize | `ensureCapacity()` 后 AO 正常 |
| AO toggle (O 键) | 按 O 切换 AO 开/关 |
| 加载存档 | 加载后 AO 正确 |
| 不同 orientation | 旋转方块 AO 对称正确 |
| **material.clone()** | 动态方块 clone 后 colorNode/AO/纹理/toggle 正常（`src/world/Chunk.js:2456`） |

**material.clone() 风险说明：** `Chunk.js:2456` 创建动态方块时会 `clone()` 材质。NodeMaterial clone 后 `colorNode`、共享 `uAoEnabled` uniform 引用是否保留，由 Spike 1 Step 1 验证。如果 clone 后 colorNode 丢失或 uniform 不共享，需要在 clone 后重新调用 `applyAOToMaterial(clonedMat, this._uAoEnabled)`。

---

### Task 3: BatchedMaterial 迁移

**Files:**
- Modify: `src/core/BatchedMaterial.js`

**迁移目标：** 当前 `BatchedMaterial` 是 unlit `ShaderMaterial`（无光照计算）。迁移目标为 `MeshBasicNodeMaterial`（保持 unlit 视觉一致），而非 `MeshStandardNodeMaterial`（PBR 会改变观感且增加开销）。如果后续希望纳入 PBR/阴影，属于 Phase B 的独立决策。

**方案选择（由 Spike 2 确定）：**
- 方案 A: If 分支（适用于 ≤16 纹理）
- 方案 B: Texture Atlas（适用于 >16 纹理或编译过慢）

实际调用路径：`ChunkGenerator.js:173` → `MaterialManager.getBatchedMaterial(textureUrl, blockTypes)`

- [ ] **Step 1: 确认 batch 中纹理数量上限**

从 `getTextureGroups()` 返回值推断每个 batch 包含多少种纹理。

- [ ] **Step 2: 实现 MeshBasicNodeMaterial 版本**

基于 Spike 2 验证的方案实现。需要同时处理：
- 纹理选择（`attribute('aTextureIndex', 'float')` + If 分支或 atlas UV）
- AO 叠加：BatchedMaterial 的 geometry 同样有 `aAoLow`/`aAoHigh`/`aOrientation`/`aVertexId` attribute。`AONodeSystem.js` 导出的 `vAo` 是模块级 TSL 节点，直接在 BatchedMaterial 的 `colorNode` 中引用即可——TSL 节点是声明式图结构，同一个节点可被多个材质的 colorNode 引用。只要 geometry 上存在同名 attribute，shader 编译时会自动绑定。

- [ ] **Step 3: 纹理色彩空间与采样策略**

生产实现中 BatchedMaterial 的纹理必须继续复用 `MaterialManager` 的缓存纹理和 `_applyTextureSampling()` 采样策略（`colorSpace = THREE.SRGBColorSpace`、`magFilter`、`minFilter` 等）。Spike 2 的 `TextureLoader().load()` 未设 colorSpace，仅用于验证 TSL 逻辑正确性。Task 3 实际实现时应从 `MaterialManager.textureCache` 获取已配置的纹理，避免 BatchedMaterial 迁移后颜色与普通方块材质不一致。

- [ ] **Step 4: 验证**

确认 batched chunk 中方块纹理正确、AO 正确、颜色与 GlobalInstancedMesh 渲染的同类方块一致（无色差）。

---

### Task 4: 水面 Shader 迁移

**Files:**
- Modify: `src/core/Engine.js:604-711`

**基于 Spike 3 验证结果实现。**

关键对照表：

| 原 GLSL | TSL 等价 |
|---------|----------|
| `vWorldPosition = (modelMatrix * vec4(pos,1)).xyz` | `positionWorld` |
| `cameraPosition` (内置) | `cameraPosition` (TSL 内置) |
| `gl_Position = projectionMatrix * mvPosition` | 自动处理 |
| `discard` | `Discard(condition)` |
| `texture2D(...)` | `texture(tex, uv())` |
| `smoothstep(a, b, x)` | `smoothstep(a, b, x)` |

- [ ] **Step 1: 重写 createWaterPlane**

将 `ShaderMaterial` 替换为 `NodeMaterial`，用 TSL `Fn` 实现逻辑。**按 Spike 3 结论分离职责：`colorNode` 负责 RGB（水面颜色、Fresnel、sun specular），`opacityNode` 负责 alpha（`uOpacity * waterFade * edgeFade`）。不要把 alpha 塞进 colorNode 返回 vec4。**

- [ ] **Step 2: 更新所有 uniform 引用点**

`render()`、`setVisualStyle()`、`applySurfaceFogFromStyle()` 中的 `this.waterMaterial.uniforms.xxx.value` 改为 `this._waterUniforms.xxx.value`。

- [ ] **Step 3: 验证**

| 场景 | 检查项 |
|------|--------|
| 靠近海洋 | 水面可见、波浪动画 |
| 远离海洋 | 水面不渲染（遮罩正确） |
| 岸边 | 边缘淡出 |
| 水下 | 雾效切换 |
| 切换风格 | 颜色/雾参数跟随 |

---

### Task 5: 雨滴 Shader 迁移

**Files:**
- Modify: `src/world/effects/RainEffect.js`

**基于 Spike 3 验证结果实现。**

- [ ] **Step 1: 替换 ShaderMaterial 为 NodeMaterial**

用 `positionNode` + TSL `Fn` 实现顶点位移。

- [ ] **Step 2: 验证 LineSegments 兼容性**

确认 `THREE.LineSegments(geometry, nodeMaterial)` 正常渲染。

- [ ] **Step 3: 验证**

开启下雨 → 雨滴下落 → 跟随玩家 → 碰地面停止

---

### Task 6: 全面集成验证

**手动验证：**
- [ ] **浏览器 Console 检查** — 无 error/warning（除了已知的 deprecation）
- [ ] **存档加载路径** — AO、纹理、水面、阴影正常
- [ ] **新世界路径** — 同上
- [ ] **AO 开关 (O 键)** — toggle 生效
- [ ] **动态方块** — 放置/删除后临时 Mesh 正确 → consolidation 后 InstancedMesh 正确
- [ ] **动态方块 clone** — clone 材质后 AO/纹理/toggle 正常（验证 Spike 1 结论在实际游戏中成立）
- [ ] **跨 Chunk** — 边界 AO 正确
- [ ] **BatchedMaterial** — batched chunk 纹理正确（unlit 视觉与迁移前一致）
- [ ] **环境风格** — 早晨/阴天/黑夜切换
- [ ] **水面** — 波浪、反射、遮罩、水下
- [ ] **下雨** — 开启/关闭/效果正确
- [ ] **阴影** — 开启/关闭
- [ ] **帧率** — 不低于迁移前

**自动化验证：**

前置条件：自动化测试依赖开发服务器已运行。`command/run-tests.js` 本身不会启动服务器。

```bash
# 终端 1：启动开发服务器
npm run start

# 终端 2：运行测试（服务器就绪后）
node command/run-tests.js --verbose
```

- [ ] **测试套件** — `node command/run-tests.js --verbose` 通过
- [ ] **Lint** — `npm run lint` 无新增警告
- [ ] **Playwright Console 检查** — 启动游戏后收集 5s 内的 console.error/console.warn，断言无 shader 编译错误、无 "NodeMaterial" 相关 warning。WebGPURenderer 的 shader 编译失败常表现为 console warning 而非 crash，人工看画面容易漏。

---

## 风险与降级

| 风险 | Spike 覆盖 | 降级方案 |
|------|-----------|---------|
| `attribute('name', 'float')` 不能读 InstancedBufferAttribute | Spike 1 | 改用 `instancedBufferAttribute(geo.getAttribute('name'), 'float', 1)` |
| `materialColor` 不含 map 结果 | Spike 1 | 显式 `texture(mat.map, uv()).mul(mat.color)` |
| `vertexStage` + `varying` 链路断 | Spike 1 | fragment 直接读 attribute（性能降低） |
| `material.clone()` 后 colorNode/uniform 丢失 | Spike 1 | clone 后重新 `applyAOToMaterial(clonedMat, uAoEnabled)` |
| `uniform(1.0)` 简写不工作 | Spike 1 | 回退到 `uniform(float(1.0))` |
| If 分支纹理选择编译慢 | Spike 2 | Texture Atlas 方案 |
| `Discard` 在 NodeMaterial 中无效 | Spike 3 | `opacity = 0` + `alphaTest` |
| `LineSegments` + `positionNode` 不兼容 | Spike 3 | 保持 CPU 更新 position attribute |
| `WebGPURenderer` shadowMap 行为差异 | Task 6 | 微调 bias/normalBias |

---

## 关于 Commit

遵循项目规则：**不自动提交**。每个 Task 结束后标记为检查点，等待明确指令再提交。

---

## 未来 Phase B（不在本次范围）

- 移除 `forceWebGL: true`，启用 WebGPU 后端
- 验证 WebGPU 后端下所有功能
- 利用 compute shader 替代 AOWorker / FaceCullingWorker
