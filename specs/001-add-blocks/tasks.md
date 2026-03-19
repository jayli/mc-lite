# Implementation Tasks: 添加新方块类型

**Feature**: 添加新方块类型 | **Branch**: `001-add-blocks` | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

---

## Dependencies & Execution Flow

```
Phase 1: Setup
    ↓
Phase 2: BlockData Registration (US1)
    ↓
Phase 3: Material Registration (US2)
    ↓
Phase 4: Texture Preloading (US3)
    ↓
Phase 5: Verification & Polish
```

**Parallel Execution Opportunities**:
- Within Phase 2: Tasks T002-T008 can run in parallel (different block entries)
- Within Phase 3: Tasks T010-T016 can run in parallel (different material registrations)
- Within Phase 4: Tasks T018-T020 can run in parallel (texture URL additions)

---

## Phase 1: Setup

**Goal**: Verify all texture files exist before implementation

**Independent Test**: All 30 texture files exist in `src/assets/textures/`

- [x] T001 Verify all 30 texture files exist in src/assets/textures/ directory

---

## Phase 2: User Story 1 - BlockData Registration

**Goal**: 在 BlockData.js 中注册 30 种新方块类型

**Independent Test**: BlockData.js 包含所有 30 种新方块定义，属性与 stone 一致

- [x] T002 [P] [US1] Add deepslate block definition in src/constants/BlockData.js
- [x] T003 [P] [US1] Add deepslate_diamond_ore block definition in src/constants/BlockData.js
- [x] T004 [P] [US1] Add glowstone block definition in src/constants/BlockData.js
- [x] T005 [P] [US1] Add oxidized_cut_copper block definition in src/constants/BlockData.js
- [x] T006 [P] [US1] Add weathered_cut_copper block definition in src/constants/BlockData.js
- [x] T007 [P] [US1] Add lava block definition in src/constants/BlockData.js
- [x] T008 [P] [US1] Add remaining 24 block definitions in src/constants/BlockData.js

---

## Phase 3: User Story 2 - Material Registration

**Goal**: 在 MaterialManager.js 中注册 30 种新材质

**Independent Test**: MaterialManager.js 包含所有 30 种新材质定义

- [x] T009 [US2] Add deepslate material registration in src/core/MaterialManager.js
- [x] T010 [P] [US2] Add deepslate_diamond_ore material registration in src/core/MaterialManager.js
- [x] T011 [P] [US2] Add glowstone material registration in src/core/MaterialManager.js
- [x] T012 [P] [US2] Add oxidized_cut_copper material registration in src/core/MaterialManager.js
- [x] T013 [P] [US2] Add weathered_cut_copper material registration in src/core/MaterialManager.js
- [x] T014 [P] [US2] Add lava material registration in src/core/MaterialManager.js
- [x] T015 [P] [US2] Add remaining 24 material registrations in src/core/MaterialManager.js

---

## Phase 4: User Story 3 - Texture Preloading

**Goal**: 在 initializeMaterials() 中预加载所有新纹理

**Independent Test**: 所有 30 个新纹理 URL 添加到 textureUrls 数组

- [x] T016 [US3] Add first 10 texture URLs to preload list in src/core/MaterialManager.js
- [x] T017 [P] [US3] Add next 10 texture URLs to preload list in src/core/MaterialManager.js
- [x] T018 [P] [US3] Add final 10 texture URLs to preload list in src/core/MaterialManager.js

---

## Phase 5: Verification & Polish

**Goal**: 验证所有实现正确，运行 lint 检查

**Independent Test**: 游戏启动正常，新方块可放置显示

- [x] T019 Run npm run lint to verify code quality
- [x] T020 Start dev server and verify no console errors
- [x] T021 Verify all 30 new blocks appear in creative mode
- [x] T022 Verify block placement displays correct textures
- [x] T023 Verify blocks have proper collision (solid)

---

## Implementation Strategy

### MVP Scope
完成所有 3 个用户故事的所有任务，确保 30 种新方块可用。

### Naming Convention Reference

| 纹理文件 | 方块类型名 | 材质注册名 |
|-----------|-----------|-----------|
| Deepslate.png | deepslate | deepslate |
| Deepslate_Diamond_Ore.png | deepslate_diamond_ore | deepslate_diamond_ore |
| Glowstone.png | glowstone | glowstone |
| Oxidized_Cut_Copper.png | oxidized_cut_copper | oxidized_cut_copper |
| Weathered_Cut_Copper.png | weathered_cut_copper | weathered_cut_copper |
| Lava.png | lava | lava |
| Block_of_Quartz.png | block_of_quartz | block_of_quartz |
| Brain_Coral_Block.png | brain_coral_block | brain_coral_block |
| Block_of_Amber.png | block_of_amber | block_of_amber |
| Floatato.png | floatato | floatato |
| Clay.png | clay | clay |
| End_Stone_Bricks.png | end_stone_bricks | end_stone_bricks |
| Smooth_Stone.png | smooth_stone | smooth_stone |
| Smooth_Stone_1.png | smooth_stone_1 | smooth_stone_1 |
| Snow.png | snow_block | snow_block |
| Light_Gray_Cloth.png | light_gray_cloth | light_gray_cloth |
| Nether_Bricks.png | nether_bricks | nether_bricks |
| Nether_Bricks_1.png | nether_bricks_1 | nether_bricks_1 |
| Nether_Gold_Ore.png | nether_gold_ore | nether_gold_ore |
| Netherrack.png | netherrack | netherrack |
| Oak_Planks_1.png | oak_planks_1 | oak_planks_1 |
| Ochre_Froglight.png | ochre_froglight | ochre_froglight |
| Polished_Blackstone_Bricks.png | polished_blackstone_bricks | polished_blackstone_bricks |
| Pink_Wool.png | pink_wool | pink_wool |
| Polished_Deepslate.png | polished_deepslate | polished_deepslate |
| Quartz_Bricks.png | quartz_bricks | quartz_bricks |
| Stone_Bricks.png | stone_bricks | stone_bricks |
| Tuff_Bricks.png | tuff_bricks | tuff_bricks |
| Acacia_Planks.png | acacia_planks | acacia_planks |
| Bedrock.png | bedrock | bedrock |

### Block Property Template
所有新方块使用相同属性：
```javascript
'block_name': { orientationEnabled: false }
```

### Material Registration Template
```javascript
materials.registerMaterial('block_name', {
  textureUrl: './src/assets/textures/TextureFile.png'
});
```

### Texture Preload Template
```javascript
'./src/assets/textures/TextureFile.png',
```
