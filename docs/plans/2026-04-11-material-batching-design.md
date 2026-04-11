# 材质合批（Material Batching）设计文档

**创建日期**: 2026-04-11  
**目标**: 减少 Draw Call，提升渲染性能  
**优化范围**: 所有实心不透明方块（`isSolid=true && isTransparent=false`）

---

## 1. 问题陈述

### 1.1 当前状态

- 每个 chunk 中，**每种方块类型** = 1 个 InstancedMesh = 1 次 Draw Call
- 材质系统按方块类型缓存材质实例（`MaterialManager.getMaterial(type)`）
- 渲染系统按方块类型创建 InstancedMesh（`ChunkGenerator.buildMeshes()`）

### 1.2 性能瓶颈

假设一个 chunk 包含 20 种不同类型的方块：
- 当前方式：20 个 InstancedMesh → 20 次 Draw Call
- 即使这些方块中有 10 种共享相同的基础材质（如都是 `MeshStandardMaterial` 且纹理相同）

### 1.3 纹理复用分析

通过对 `MaterialManager.js` 的分析，发现以下复用模式：

| 复用组 | 纹理/材质特征 | 方块类型 | 合批潜力 |
|--------|-------------|---------|---------|
| 木板组 | `planks_birch.png` | `planks`, `planks_step` | ⭐⭐ 高 |
| 石材组 | `Cobblestone.png` | `cobblestone`, `cobblestone_step`, `cobblestone_step_updown`, `mossy_stone` | ⭐⭐⭐ 很高 |
| 闪长岩组 | `stone_diorite.png` | `stone_diorite`, `stone_diorite_step`, `polished_diorite` | ⭐⭐⭐ 很高 |
| 黄叶组 | `leaves_yellow.png` | `realistic_yellow_leaves`, `yellow_leaves` | ⭐⭐ 高 |
| 程序化材质组 | `mkMat('#b98e5b')` | `vertical_pillar`, `horizontal_pillar`, `handrail*` | ⭐⭐⭐ 很高 |

---

## 2. 设计方案

### 2.1 方案概述

采用 **按纹理 URL 分组** 的合批策略，结合 **fallback 机制** 处理复杂情况。

**核心思路**：
1. 将使用相同纹理的方块类型合并到同一个 InstancedMesh
2. 引入 `aTextureIndex` 或 `aMaterialId` 属性区分不同方块
3. 自定义 Shader 支持多纹理采样

### 2.2 架构变更

```
┌─────────────────────────────────────────────────────────────────┐
│                     当前架构                                     │
├─────────────────────────────────────────────────────────────────┤
│ 方块类型 → 材质实例 → InstancedMesh                             │
│    dirt   →  matA    →  MeshA (Draw Call 1)                     │
│    stone  →  matB    →  MeshB (Draw Call 2)                     │
│    sand   →  matA    →  MeshC (Draw Call 3) ← 与 dirt 同材质！   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     优化后架构                                   │
├─────────────────────────────────────────────────────────────────┤
│ 纹理组 → 材质实例 → InstancedMesh (含多个方块类型)              │
│  textureA → matA → MeshABC (Draw Call 1)                        │
│             ├─ dirt 实例 (textureIndex=0)                       │
│             ├─ sand 实例 (textureIndex=1)                       │
│             └─ ...                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 核心组件

#### 2.3.1 纹理分组器（Texture Grouper）

**位置**: `src/core/MaterialManager.js`

**职责**: 将方块类型按纹理 URL 分组

```javascript
// 新增方法
class MaterialManager {
  // 获取纹理分组映射
  getTextureGroups() {
    // 返回格式：
    // {
    //   './src/assets/textures/planks_birch.png': ['planks', 'planks_step'],
    //   './src/assets/textures/Cobblestone.png': ['cobblestone', 'cobblestone_step', ...],
    //   ...
    // }
  }
}
```

#### 2.3.2 Worker 端 meshData 生成

**位置**: `src/workers/WorldWorker.js`

**变更**: `buildMeshData()` 按纹理组而非方块类型分组

```javascript
// 当前逻辑
for (const type in d) {
  // 按 type 创建 meshData
}

// 优化后逻辑
const textureGroups = getTextureGroups();
for (const [textureUrl, types] of Object.entries(textureGroups)) {
  // 合并同组内所有类型的 positions
  // 新增 aTextureIndex 属性
}
```

#### 2.3.3 自定义 ShaderMaterial

**位置**: `src/core/MaterialManager.js` 或新建 `src/core/BatchedMaterial.js`

**关键修改**: 在着色器中采样对应纹理

```glsl
// 顶点着色器
attribute float aTextureIndex;
varying float vTextureIndex;
vTextureIndex = aTextureIndex;

// 片元着色器
uniform sampler2D uTextures[MAX_TEXTURES];
varying float vTextureIndex;

void main() {
  vec4 color;
  if (vTextureIndex < 0.5) color = texture2D(uTextures[0], vUv);
  else if (vTextureIndex < 1.5) color = texture2D(uTextures[1], vUv);
  // ...
  gl_FragColor = color;
}
```

### 2.4 复杂情况处理

#### 2.4.1 多面材质

问题：`grass` 方块有 3 种不同纹理（侧面、顶部、底部）

**方案**: 拆分为多个"虚拟类型"

```javascript
// 逻辑拆分
'grass_side' → 侧面纹理
'grass_top'   → 顶部纹理
'grass_bottom' → 底部纹理

// 在 buildMeshData 中根据面索引分别处理
```

#### 2.4.2 程序化材质

问题：`mkMat('#b98e5b')` 等纯色材质没有 textureUrl

**方案**: 按颜色值分组

```javascript
// 将颜色值视为"虚拟纹理 URL"
'#b98e5b' → ['vertical_pillar', 'horizontal_pillar', ...]
```

---

## 3. 实施步骤

### 阶段一：基础设施（改动最小）

1. **统计纹理分组**: 在 `MaterialManager` 中实现 `getTextureGroups()`
2. **验证合批潜力**: 输出日志，显示预期 Draw Call 减少量
3. **不改动渲染逻辑**

**验收标准**: 能输出纹理分组报告，无功能变更

### 阶段二：Worker 端分组

1. 修改 `WorldWorker.js:buildMeshData()` 按纹理组输出
2. 添加 `aTextureIndex` 属性
3. 修改 `ChunkGenerator.js:buildMeshes()` 按组创建 Mesh

**验收标准**: 功能正常，Draw Call 减少

### 阶段三：自定义 Shader

1. 创建 `BatchedMaterial.js` 支持多纹理采样
2. 处理多面材质的特殊情况
3. 处理透明方块（排除在合批外）

**验收标准**: 所有方块渲染正常，无黑闪/错乱

---

## 4. 预期收益

### 4.1 Draw Call 减少估算

基于当前材质统计：

| 场景 | 当前 Draw Call | 优化后 Draw Call | 减少比例 |
|------|--------------|-----------------|---------|
| 单一材质 chunk | 20 | 8 | 60% |
| 混合材质 chunk | 35 | 15 | 57% |
| 复杂材质 chunk | 50 | 25 | 50% |

### 4.2 性能提升

- **GPU 负载**: 减少 50-60% 的 Draw Call
- **FPS**: 预计提升 5-15 FPS（取决于场景复杂度）
- **内存**: 材质实例减少，但纹理图集可能增加内存（阶段二）

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 多面材质处理复杂 | 中 | 阶段一先排除，后续迭代 |
| Shader 兼容性 | 高 | 保留 fallback，逐步切换 |
| AO 着色器耦合 | 中 | 仔细测试 `onBeforeCompile` 注入 |
| 透明方块顺序 | 高 | 排除透明方块，保持原有逻辑 |

---

## 6. 验收标准

1. **功能正确**: 所有方块渲染正常，无黑闪、无错位
2. **性能提升**: Draw Call 减少 40%+
3. **代码质量**: 改动集中，不影响现有材质系统
4. **可回滚**: 保留配置开关，可随时切回旧逻辑

---

## 7. 相关文件

| 文件 | 变更内容 |
|------|---------|
| `src/core/MaterialManager.js` | 新增 `getTextureGroups()`，创建 `BatchedMaterial` |
| `src/workers/WorldWorker.js` | 修改 `buildMeshData()` 按纹理分组 |
| `src/world/ChunkGenerator.js` | 修改 `buildMeshes()` 支持多纹理合批 |
| `src/world/ChunkConsolidation.js` | 可能需要调整 AO Worker 通信 |

---

## 8. 附录：纹理复用详细统计

### 8.1 高频复用纹理（4+ 方块）

| 纹理 | 方块列表 |
|------|---------|
| `Cobblestone.png` | `cobblestone`, `cobblestone_step`, `cobblestone_step_updown`, `mossy_stone` |

### 8.2 中频复用纹理（2-3 方块）

| 纹理 | 方块列表 |
|------|---------|
| `planks_birch.png` | `planks`, `planks_step` |
| `stone_diorite.png` | `stone_diorite`, `stone_diorite_step`, `polished_diorite` |
| `leaves_yellow.png` | `realistic_yellow_leaves`, `yellow_leaves` |

### 8.3 程序化材质复用

| 颜色值 | 方块列表 |
|--------|---------|
| `#b98e5b` | `vertical_pillar`, `horizontal_pillar`, `handrail`, `handrailA`, `handrailB` |

### 8.4 单一纹理方块（无复用）

共约 80+ 种方块使用独立纹理，如 `gold_ore`, `diamond`, `emerald`, `obsidian` 等。
