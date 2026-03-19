# Feature Specification: 添加新方块类型

**Feature Branch**: `024-add-blocks`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "我要增加一些新的方块，石头块的材料在src/assets/textures目录中，要增加的方块有：Deepslate.png, Deepslate_Diamond_Ore.png, Glowstone.png, Oxidized_Cut_Copper.png, Weathered_Cut_Copper.png, Lava.png, Block_of_Quartz.png, Brain_Coral_Block.png, Block_of_Amber.png, Floatato.png, Clay.png, End_Stone_Bricks.png, Smooth_Stone.png, Smooth_Stone_1.png, Snow.png, Light_Gray_Cloth.png, Nether_Bricks.png, Nether_Bricks_1.png, Nether_Gold_Ore.png, Netherrack.png, Oak_Planks_1.png, Ochre_Froglight.png, Polished_Blackstone_Bricks.png, Pink_Wool.png, Polished_Deepslate.png, Quartz_Bricks.png, Stone_Bricks.png, Tuff_Bricks.png, Acacia_Planks.png, Bedrock.png。这些方块的属性跟stone是一样的"

## 用户场景与测试 *(mandatory)*

### 用户故事 1 - 新增方块可见性 (Priority: P1)

玩家在游戏中可以看到并使用新增的 30 种方块类型进行建造。

**Why this priority**: 这是核心功能，新增方块必须能被正确渲染和放置。

**Independent Test**: 在创造模式下，玩家可以从方块选择器中找到所有新方块，放置后能看到正确的纹理显示。

**Acceptance Scenarios**:

1. **Given** 游戏已启动且玩家处于创造模式，**When** 玩家打开方块选择界面，**Then** 能看到所有 30 种新方块在列表中
2. **Given** 玩家选择了新方块，**When** 玩家在场景中放置方块，**Then** 方块显示为对应的纹理
3. **Given** 新方块已放置在场景中，**When** 玩家从不同角度观察，**Then** 方块显示正常的 AO 阴影效果

---

### 用户故事 2 - 方块属性一致性 (Priority: P1)

所有新方块的物理和渲染属性与 stone 方块保持一致。

**Why this priority**: 确保游戏玩法一致性，新方块应当遵循与石头相同的规则（实心、不透明、不可旋转）。

**Independent Test**: 验证新方块的碰撞检测、透明度设置和旋转行为与 stone 一致。

**Acceptance Scenarios**:

1. **Given** 新方块放置在地面上，**When** 玩家尝试穿过方块，**Then** 玩家被阻挡（实心属性生效）
2. **Given** 新方块相邻放置，**When** 系统渲染时，**Then** 相邻面被正确剔除（不透明属性生效）
3. **Given** 玩家手持新方块放置，**When** 点击右键，**Then** 方块放置时不会随玩家朝向旋转（orientationEnabled=false）

---

### 用户故事 3 - 纹理正确加载 (Priority: P2)

所有新方块的纹理文件被正确预加载和显示。

**Why this priority**: 纹理是视觉效果的基础，需要确保无丢失或错位。

**Independent Test**: 检查浏览器网络面板，确认所有纹理文件被请求且 HTTP 200 返回。

**Acceptance Scenarios**:

1. **Given** 游戏正在加载，**When** 初始化材质系统时，**Then** 所有 30 个新纹理文件被预加载
2. **Given** 纹理加载完成，**When** 查看新方块，**Then** 无粉色默认材质（未找到纹理的降级显示）出现

---

### Edge Cases

- 如果纹理文件不存在或损坏，系统应优雅降级显示默认材质
- 方块名称大小写敏感，确保代码中的名称与纹理文件名一致
- 避免因新增大量纹理导致内存占用过高（考虑纹理压缩）

## 需求 *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须在 `BlockData.js` 中注册 30 种新方块类型
- **FR-002**: 每种新方块的属性必须与 `stone` 保持一致（`orientationEnabled: false`）
- **FR-003**: 系统必须在 `MaterialManager.js` 中为每种新方块注册材质定义
- **FR-004**: 所有新纹理文件必须在 `initializeMaterials()` 函数中被预加载
- **FR-005**: 方块名称映射必须遵循 snake_case 约定（如 `Deepslate.png` → `deepslate`）
- **FR-006**: 所有新方块必须正确应用 AO（环境光遮蔽）阴影效果
- **FR-007**: 系统必须支持方块在创造模式界面中显示和选择

### Key Entities

- **BlockType**: 方块类型定义，包含物理属性（isSolid, isTransparent）和渲染属性（orientationEnabled, isAOEnabled）
- **MaterialDefinition**: 材质定义，包含纹理 URL、透明设置和渲染参数

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 所有 30 种新方块可以在游戏中被放置和显示
- **SC-002**: 新方块加载后无纹理丢失（粉色材质出现率为 0%）
- **SC-003**: 新方块的渲染性能与现有 stone 方块相当（帧率差异 < 5%）
- **SC-004**: 新方块的碰撞检测正确率 100%（玩家无法穿过实心方块）

## Assumptions

- 所有纹理文件已存在于 `src/assets/textures/` 目录中
- 纹理文件格式为 PNG，命名与提供的列表一致
- 新方块不需要特殊的几何体类型（统一使用默认 box 类型）
- 新方块不需要发光效果（Glowstone 虽然名称带 glow，但使用普通材质渲染）
