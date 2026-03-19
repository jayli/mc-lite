# Implementation Plan: 添加新方块类型

**Branch**: `024-add-blocks` | **Date**: 2026-03-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/024-add-blocks/spec.md`

## Summary

在现有的 Minecraft-lite 游戏中添加 30 种新方块类型。所有新方块使用已存在的纹理文件，属性与现有 `stone` 方块保持一致（实心、不透明、不可旋转）。实施涉及在 `BlockData.js` 注册方块属性、在 `MaterialManager.js` 注册材质定义，以及预加载纹理文件。

## Technical Context

**Language/Version**: JavaScript ES2020+ (浏览器原生支持)
**Primary Dependencies**: Three.js (WebGL 渲染)
**Storage**: N/A (纯客户端，无持久化变更)
**Testing**: 浏览器访问 `http://localhost:8080/src/tests/index.html`
**Target Platform**: 现代 Web 浏览器 (WebGL 2.0)
**Project Type**: 3D 体素游戏 (Minecraft 克隆)
**Performance Goals**: 60 FPS，Draw Call 最小化 via InstancedMesh
**Constraints**: 内存占用稳定，避免垃圾回收卡顿
**Scale/Scope**: 30 种新方块，遵循现有代码模式

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. OO Design & Layering | ✅ PASS | 遵循现有 BlockData/MaterialManager 分层 |
| II. Memory Efficiency | ✅ PASS | 新增方块复用现有 InstancedMesh 渲染机制 |
| III. Proactive Resource Release | ✅ PASS | 无新增资源管理需求，使用现有 Chunk 释放机制 |
| IV. WebGL/Three.js 性能 | ✅ PASS | 新增材质使用现有纹理缓存，不增加 Draw Call |
| V. Simplicity & Core | ✅ PASS | 直接添加配置，无过度工程 |
| VI. Resource Management | ✅ PASS | 纹理已存在于 src/assets/textures/ |

## Project Structure

### Documentation (this feature)

```text
specs/024-add-blocks/
├── plan.md              # This file
├── spec.md              # Feature specification
├── checklists/          # Quality checklists
│   └── requirements.md
└── tasks.md             # Phase 2 output (from /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── constants/
│   └── BlockData.js          # 添加 30 种新方块类型定义
├── core/
│   └── MaterialManager.js    # 注册材质定义 + 预加载纹理
└── assets/
    └── textures/             # 30 个新纹理文件已存在
```

**Structure Decision**: 单项目结构，修改两个核心文件完成方块添加。

## Implementation Approach

### 修改文件 1: `src/constants/BlockData.js`

在 `BLOCK_DATA` 对象中添加 30 种新方块，每种遵循 `stone` 的模式：

```javascript
'deepslate': { orientationEnabled: false },
'deepslate_diamond_ore': { orientationEnabled: false },
// ... 其他 28 种
```

### 修改文件 2: `src/core/MaterialManager.js`

1. **注册材质定义**（在文件底部添加）：

```javascript
materials.registerMaterial('deepslate', {
  textureUrl: './src/assets/textures/Deepslate.png'
});
// ... 其他 29 种
```

2. **预加载纹理**（添加到 `textureUrls` 数组）：

```javascript
const textureUrls = [
  // ... 现有纹理
  './src/assets/textures/Deepslate.png',
  './src/assets/textures/Deepslate_Diamond_Ore.png',
  // ... 其他 28 个
];
```

### 命名映射表

| 纹理文件名 | 方块类型名 |
|-----------|-----------|
| Deepslate.png | deepslate |
| Deepslate_Diamond_Ore.png | deepslate_diamond_ore |
| Glowstone.png | glowstone |
| Oxidized_Cut_Copper.png | oxidized_cut_copper |
| Weathered_Cut_Copper.png | weathered_cut_copper |
| Lava.png | lava |
| Block_of_Quartz.png | block_of_quartz |
| Brain_Coral_Block.png | brain_coral_block |
| Block_of_Amber.png | block_of_amber |
| Floatato.png | floatato |
| Clay.png | clay |
| End_Stone_Bricks.png | end_stone_bricks |
| Smooth_Stone.png | smooth_stone |
| Smooth_Stone_1.png | smooth_stone_1 |
| Snow.png | snow_block |
| Light_Gray_Cloth.png | light_gray_cloth |
| Nether_Bricks.png | nether_bricks |
| Nether_Bricks_1.png | nether_bricks_1 |
| Nether_Gold_Ore.png | nether_gold_ore |
| Netherrack.png | netherrack |
| Oak_Planks_1.png | oak_planks_1 |
| Ochre_Froglight.png | ochre_froglight |
| Polished_Blackstone_Bricks.png | polished_blackstone_bricks |
| Pink_Wool.png | pink_wool |
| Polished_Deepslate.png | polished_deepslate |
| Quartz_Bricks.png | quartz_bricks |
| Stone_Bricks.png | stone_bricks |
| Tuff_Bricks.png | tuff_bricks |
| Acacia_Planks.png | acacia_planks |
| Bedrock.png | bedrock |

> **注意**: `Snow.png` 映射为 `snow_block` 以避免与现有的 `snow` 方块冲突。

## Testing Strategy

1. **启动开发服务器**: `npm run start`
2. **访问游戏**: http://localhost:8080
3. **验证列表**: 创造模式界面显示所有 30 种新方块
4. **验证放置**: 每种方块能正确放置并显示纹理
5. **验证属性**: 方块实心（玩家不能穿过）、不可旋转

## Risk Assessment

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 纹理文件不存在 | 低 | 中 | 加载时显示粉色材质，不崩溃 |
| 名称冲突 | 低 | 中 | Snow.png 改为 snow_block |
| 内存增加 | 低 | 低 | 30 个纹理约 2-5MB，可接受 |

## Next Step

运行 `/speckit.tasks` 生成具体任务列表。
