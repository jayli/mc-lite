# Feature Specification: Minecart (矿车系统)

**Feature Branch**: `001-minecart-feature`
**Created**: 2026-03-28
**Status**: Draft
**Input**: User description: "矿车是可以在铁轨上移动的小车，长宽高都是一个方格尺寸，透明实心，可参与碰撞，和树叶方块一样。矿车的造型是一个车斗加四个小轮，不参与 faceculling 和 instancedMesh管理，车轮的轴距是8/10个方块宽度单位。矿车可以被玩家放置，但只能放置在sand_train_track方块上，且矿车的方向要跟sand_train_track方向相同。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 放置矿车 (Priority: P1)

玩家手持矿车物品，在铁轨方块上右键放置矿车。矿车自动与铁轨方向对齐，玩家可以站在矿车上。

**Why this priority**: 放置是矿车功能的基础入口，没有放置能力后续移动功能无法使用。这是最小可用功能单元。

**Independent Test**: 可以通过在已有铁轨上放置矿车并验证矿车位置、方向是否正确来独立测试。

**Acceptance Scenarios**:

1. **Given** 玩家手持矿车物品，**When** 玩家对 sand_train_track 方块右键点击，**Then** 矿车出现在铁轨上方，方向与铁轨一致
2. **Given** 玩家手持矿车物品，**When** 玩家对非铁轨方块右键点击，**Then** 矿车不被放置，显示提示"只能在铁轨上放置"
3. **Given** 矿车已放置在铁轨上，**When** 玩家跳跃站上矿车，**Then** 玩家可以稳定站在矿车车斗内
4. **Given** 矿车已放置在铁轨上，**When** 玩家对矿车位置右键，**Then** 矿车被拾取回到玩家物品栏

---

### User Story 2 - 矿车3D模型渲染 (Priority: P2)

矿车以独特的3D模型渲染（车斗+四轮），不使用常规方块的 instancedMesh 渲染方式，保持独立的视觉效果。

**Why this priority**: 矿车的视觉呈现是用户体验的核心，但渲染系统可以独立开发，不依赖放置功能完成后即可测试。

**Independent Test**: 可以通过创建矿车模型并添加到场景中，验证其几何结构、材质、尺寸是否符合设计。

**Acceptance Scenarios**:

1. **Given** 矿车实体被创建，**When** 系统渲染矿车，**Then** 显示一个车斗（上开口箱形）和四个车轮（圆柱体）
2. **Given** 矿车模型渲染，**When** 查看车轮位置，**Then** 四个车轮轴距为 0.8 方块宽度（前后轮间距）
3. **Given** 矿车被放置在不同方向铁轨上，**When** 渲染更新，**Then** 矿车模型正确旋转对应铁轨朝向（东/南/西/北）
4. **Given** 矿车位于场景中，**When** 观察矿车，**Then** 车斗材质透明实心（类似树叶材质属性），车轮材质为金属质感

---

### User Story 3 - 矿车碰撞与物理交互 (Priority: P3)

矿车作为透明实心物体参与物理碰撞，玩家和物品可以与矿车产生物理交互。

**Why this priority**: 碰撞功能是放置功能的基础支撑，但独立于渲染和移动逻辑，可以在放置功能完成后进行测试和优化。

**Independent Test**: 可以通过放置矿车后让玩家尝试穿越矿车位置，验证碰撞边界和物理响应。

**Acceptance Scenarios**:

1. **Given** 矿车已放置，**When** 玩家尝试穿越矿车所在位置，**Then** 玩家被矿车阻挡，无法直接穿过
2. **Given** 矩车已放置，**When** 矿车周围有其他方块，**Then** 矿车不参与 faceculling 计算（相邻面独立显示）
3. **Given** 玩家站在矿车上，**When** 玩家跳跃，**Then** 玩家可以跳下矿车（高度差正常计算）

---

### Edge Cases

- 矿车放置在弯轨（sand_train_track_corner）上时，读取弯轨的 orientation 值确定方向
- 矿车放置在已被其他矿车占用的铁轨位置时，拒绝放置并显示提示"该铁轨已有矿车"
- 矿车被爆炸/破坏摧毁后直接消失，无物品掉落
- 矿车绑定到所在铁轨的 chunk，随 chunk 加载/卸载进行持久化

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 允许玩家手持矿车物品（mine_cart）在 sand_train_track 方块上放置矿车实体
- **FR-002**: 系统 MUST 在放置矿车时自动获取下方铁轨方块的 orientation 值并同步矿车方向（支持直轨和弯轨）
- **FR-003**: 系统 MUST 拒绝在非铁轨方块（非 sand_train_track 或 sand_train_track_corner）上放置矿车
- **FR-003a**: 系统 MUST 检查目标铁轨位置是否已有矿车，若已占用则拒绝放置并提示"该铁轨已有矿车"
- **FR-004**: 系统 MUST 创建矿车 3D 模型，包含车斗（上开口箱形，尺寸约 0.8x0.4x0.8 方块）和四个车轮（圆柱体，轴距 0.8 方块宽度）
- **FR-005**: 系统 MUST 将矿车作为独立实体渲染，不参与 Chunk 的 instancedMesh 合并机制
- **FR-006**: 系统 MUST 将矿车设置为透明实心碰撞体（isTransparent: true, isSolid: true），类似树叶方块属性
- **FR-007**: 系统 MUST 使矿车不参与 faceculling 计算，相邻方块面独立显示
- **FR-008**: 系统 MUST 允许玩家右键点击已放置的矿车进行拾取
- **FR-009**: 系统 MUST 支持矿车实体的持久化存储（位置、方向），矿车绑定到所在铁轨的 chunk，随 chunk 加载/卸载
- **FR-010**: 矿车尺寸 MUST 限制在 1x1x1 方块空间内（边界盒）
- **FR-011**: 矿车被爆炸或破坏摧毁时 MUST 直接消失，不产生物品掉落
- **FR-012**: 系统 MUST 在背包系统中注册矿车物品（类型名 mine_cart），使用 Invicon_Minecart.png 作为物品图标

### Key Entities

- **Minecart (矿车)**: 独立3D实体，包含车斗和四轮组件，占用1方块空间，有位置和朝向属性，可被放置、拾取、碰撞
- **MinecartManager**: 管理所有矿车实体的生命周期（创建、更新、销毁、持久化）
- **MinecartPlacementHandler**: 处理矿车放置逻辑（约束检查、方向同步、放置执行）
- **铁轨方块**: sand_train_track 和 sand_train_track_corner，矿车放置的必要载体，携带 orientation 属性

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 玩家可以在 3 秒内完成矿车的放置操作（从点击到矿车出现）
- **SC-002**: 矿车放置成功率达到 100%（在合法铁轨位置上）
- **SC-003**: 矿车模型正确渲染，车轮轴距误差不超过 5%（目标 0.8 方块宽度）
- **SC-004**: 矿车碰撞边界准确，玩家无法穿越矿车实体
- **SC-005**: 矿车放置在非法位置时，系统在 1 秒内反馈提示信息
- **SC-006**: 矿车持久化后重启游戏，矿车恢复到原位置和原方向

## Clarifications

### Session 2026-03-28

- Q: 弯轨（sand_train_track_corner）上的矿车方向如何处理？ → A: 弯轨有独立的 orientation，矿车读取弯轨方向值
- Q: 矿车放置在已被其他矿车占用的铁轨位置时如何处理？ → A: 拒绝放置，显示提示"该铁轨已有矿车"
- Q: 车轮轴距精确值应采用哪个？ → A: 保持"约0.8"的模糊表述，允许实现时微调
- Q: 矿车被爆炸/破坏摧毁后如何处理？ → A: 矿车被摧毁后直接消失（无掉落）
- Q: 矿车在多 chunk 跨越时如何持久化？ → A: 矿车绑定到所在铁轨的 chunk，随 chunk 加载/卸载
- Q: 矿车物品如何在背包中注册？ → A: 使用 mine_cart 类型名，图标文件 Invicon_Minecart.png

## Assumptions

- 矿车放置后暂不实现移动功能（后续版本迭代）
- 铁轨方块的 orientation 属性已正确实现（参考现有 BlockOrientation 系统）
- 矿车使用现有材质系统（MaterialManager）中的材质或新增专属材质
- 矿车拾取后直接回到玩家快捷栏/背包，不涉及复杂物品分配逻辑
- 矿车不支持堆叠，每个物品槽位最多一个矿车