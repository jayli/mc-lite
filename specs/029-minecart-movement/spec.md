# Feature Specification: Minecart Movement (矿车移动功能)

**Feature Branch**: `029-minecart-movement`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "矿车移动功能：minecart沿铁轨方向移动，ctrl+左键激发前进，ctrl+shift+左键后退，支持转弯、链接、碰撞等行为"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 矿车基础移动 (Priority: P1)

玩家按住 ctrl+左键点击矿车，矿车开始沿铁轨方向前进。移动过程中矿车自动沿铁轨方向移动，遇到弯轨时保持原方向通过。

**Why this priority**: 基础移动是矿车功能的核心价值，没有移动能力矿车只是一个静态装饰物。这是最小可用功能单元。

**Independent Test**: 可以通过放置矿车在铁轨上，按 ctrl+左键激发移动，验证矿车是否沿铁轨方向正确移动。

**Acceptance Scenarios**:

1. **Given** 矿车放置在 sand_train_track 直轨上，**When** 玩家按住 ctrl+左键点击矿车，**Then** 矿车开始沿铁轨方向前进
2. **Given** 矿车正在移动，**When** 矿车经过 sand_train_track_corner 弯轨，**Then** 矿车保持原方向不变继续前进
3. **Given** 矿车正在移动，**When** 矿车前方不是铁轨方块（sand_train_track 或 sand_train_track_corner），**Then** 矿车停止移动
4. **Given** 矿车放置在铁轨上，**When** 玩家按住 ctrl+shift+左键点击矿车，**Then** 矿车开始朝后移动（反方向）
5. **Given** 矿车停止在铁轨上，**When** 玩家再次按 ctrl+左键激发，**Then** 矿车重新开始移动

---

### User Story 2 - 矿车转弯 (Priority: P2)

矿车在移动过程中遇到前方无铁轨但左右侧有铁轨时，自动转弯并继续移动。如果左右两侧同时有铁轨，随机选择一个方向转弯。

**Why this priority**: 转弯是铁轨系统完整体验的必要功能，但可以在基础移动完成后独立测试和实现。

**Independent Test**: 可以通过构建十字形或L形铁轨网络，让矿车移动到交叉点观察转弯行为。

**Acceptance Scenarios**:

1. **Given** 矿车沿直轨移动到达交叉点，**When** 前方无铁轨但左侧有铁轨，**Then** 矿车左转继续移动
2. **Given** 矿车沿直轨移动到达交叉点，**When** 前方无铁轨但右侧有铁轨，**Then** 矿车右转继续移动
3. **Given** 矿车沿直轨移动到达交叉点，**When** 前方无铁轨且左右两侧都有铁轨，**Then** 矿车随机选择左或右转弯继续移动
4. **Given** 矿车沿直轨移动到达十字路口，**When** 四个方向都有铁轨（前方已检查），**Then** 矿车只能选择左或右转弯（不能掉头）

---

### User Story 3 - 矿车链接联动 (Priority: P3)

多个相邻矿车可以链接在一起，当其中一节矿车被激发移动时，所有相连的矿车同时同速同向移动。

**Why this priority**: 链接功能是高级体验增强，模拟真实矿车列车行为，可以在基础移动和转弯完成后独立测试。

**Independent Test**: 可以通过连续放置多个矿车形成列车，激发其中任意一节观察联动行为。

**Acceptance Scenarios**:

1. **Given** 三个矿车 A→B→C 相邻放置在铁轨上，**When** 玩家按 ctrl+左键激发矿车 B，**Then** A、B、C 三节矿车同时同速前进
2. **Given** 三个矿车 A→B→C 相邻放置在铁轨上，**When** 玩家按 ctrl+shift+左键激发矿车 B 后退，**Then** A、B、C 三节矿车同时同速后退
3. **Given** 两节矿车链接移动中，**When** 链接矿车到达铁轨终点停止，**Then** 所有矿车同时停止在各自铁轨位置上
4. **Given** 四节矿车 A→B→C→D 链接，**When** 玩家激发矿车 C，**Then** A、B、C、D 四节矿车全部联动移动

---

### User Story 4 - 矿车碰撞 (Priority: P4)

运动中的矿车与静止矿车碰撞时，静止矿车被推动同向运动；两个相向运动的矿车碰撞时，双方同时停止并回弹到最近铁轨位置。

**Why this priority**: 碰撞是物理交互的高级功能，可以在链接功能完成后独立测试，丰富游戏物理体验。

**Independent Test**: 可以通过放置两个矿车相对运动或一静一动，观察碰撞后的行为。

**Acceptance Scenarios**:

1. **Given** 矿车 A 正向运动，**When** 矿车 A 碰撞到静止矿车 B，**Then** 矿车 B 开始与矿车 A 同向运动
2. **Given** 矿车 A 正向运动，矿车 B 反向运动，**When** 两矿车相向碰撞，**Then** 两矿车同时停止
3. **Given** 两矿车相向碰撞停止，**When** 停止位置不是标准方块坐标，**Then** 两矿车各自回弹到刚刚经过的铁轨上方
4. **Given** 两列链接矿车 A→B→C 和 D→E→F 相向运动碰撞，**When** 发生碰撞，**Then** 两列矿车所有成员各自回弹到最近铁轨位置

---

### Edge Cases

- 矿车在弯轨上被激发时，方向由矿车当前朝向决定（已由 028-minecart-feature 定义）
- 矿车到达十字路口但所有横向方向都无铁轨时，矿车停止
- 矿车链接跨越弯轨时，各矿车保持独立朝向但同速移动
- 矿车被拾取时如果正在移动，立即停止移动
- 矿车在 chunk 卸载边界移动时，触发 chunk 加载或矿车停止
- 链接矿车中某一节被拾取时，链接断开，其余矿车停止移动
- 碰撞后回弹时，矿车朝向保持不变

## Requirements *(mandatory)*

### Functional Requirements

**激发机制**
- **FR-001**: 系统 MUST 检测玩家按住 ctrl 键 + 左键点击矿车的输入组合
- **FR-002**: 系统 MUST 在 ctrl+左键激发时让矿车向前移动（移动方向由矿车当前朝向决定）
- **FR-003**: 系统 MUST 检测玩家按住 ctrl+shift 键 + 左键点击矿车的输入组合
- **FR-004**: 系统 MUST 在 ctrl+shift+左键激发时让矿车向后移动（与当前朝向相反）

**前进逻辑**
- **FR-005**: 系统 MUST 检测矿车下方铁轨方块（sand_train_track 或 sand_train_track_corner）
- **FR-006**: 系统 MUST 检测矿车前方相邻铁轨方块是否存在
- **FR-007**: 系统 MUST 在前方有铁轨时让矿车移动到前方铁轨位置
- **FR-008**: 系统 MUST 在矿车经过 sand_train_track_corner 弯轨时保持矿车原方向不变

**停止逻辑**
- **FR-009**: 系统 MUST 在矿车前方无铁轨方块时让矿车停止移动
- **FR-010**: 系统 MUST 确保停止的矿车位置在标准方块坐标点上（整数坐标）

**转弯逻辑**
- **FR-011**: 系统 MUST 在矿车前方无铁轨但左侧有铁轨时执行左转弯
- **FR-012**: 系统 MUST 在矿车前方无铁轨但右侧有铁轨时执行右转弯
- **FR-013**: 系统 MUST 在左右两侧同时有铁轨时随机选择一个方向转弯
- **FR-014**: 系统 MUST 在转弯时更新矿车朝向为新移动方向

**链接逻辑**
- **FR-015**: 系统 MUST 检测相邻铁轨上的矿车形成链接关系（前后相邻）
- **FR-016**: 系统 MUST 在激发某一节矿车时同步激发所有链接矿车
- **FR-017**: 系统 MUST 确保链接矿车同速同向移动（速度一致）
- **FR-018**: 系统 MUST 在矿车被拾取时断开该矿车的链接关系

**碰撞逻辑**
- **FR-019**: 系统 MUST 检测运动矿车与静止矿车的碰撞
- **FR-020**: 系统 MUST 在运动矿车碰撞静止矿车时让静止矿车同向运动
- **FR-021**: 系统 MUST 检测两个相向运动矿车的碰撞
- **FR-022**: 系统 MUST 在相向碰撞时让双方矿车同时停止
- **FR-023**: 系统 MUST 在碰撞停止位置非标准方块坐标时让矿车回弹到最近铁轨上方
- **FR-024**: 系统 MUST 在多节链接矿车相向碰撞时让所有矿车各自回弹

**移动速度**
- **FR-025**: 矿车移动速度 MUST 为 1 方块/秒（可配置）

**链接限制**
- **FR-026**: 矿车链接 MUST 最多支持 10 节矿车

**资源消耗**
- **FR-027**: 矿车移动 MUST 不消耗玩家任何资源

**渲染优化**
- **FR-028**: 矿车渲染 MUST 使用 InstancedMesh 批量渲染技术，参照 ZombieInstancedRenderer 实现
- **FR-029**: 系统 MUST 共享所有矿车的几何体和材质，避免每个矿车实例重复创建
- **FR-030**: 系统 MUST 支持矿车移动时实时更新 InstancedMesh 矩阵（位置、旋转）

### Key Entities

- **MinecartMovementState**: 矿车移动状态（静止/前进/后退），当前铁轨位置，移动方向
- **MinecartLink**: 矿车链接关系，记录相邻矿车的前后关系
- **MinecartCollision**: 矿车碰撞检测结果，碰撞位置、碰撞双方、碰撞类型
- **TrackDetection**: 铁轨检测结果，前方/左侧/右侧铁轨存在状态

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 玩家按 ctrl+左键激发矿车后，矿车在 1 秒内开始移动
- **SC-002**: 矿车移动过程中经过连续铁轨时无停顿，移动流畅度达到每秒至少 1 个方块距离
- **SC-003**: 矿车转弯决策响应时间小于 0.5 秒（到达交叉点到选择方向）
- **SC-004**: 链接矿车联动延迟小于 0.1 秒（激发到所有矿车同步移动）
- **SC-005**: 矿车碰撞检测准确率达到 100%（不漏检不误检）
- **SC-006**: 矿车碰撞后回弹位置误差不超过 0.1 方块单位（回弹到最近铁轨上方）
- **SC-007**: 矿车停止后位置与标准方块坐标误差不超过 0.01 方块单位

## Clarifications

### Session 2026-03-29

- Q: 矿车移动速度具体数值？ → A: 1 方块/秒
- Q: 矿车链接范围是否有限制？ → A: 最多链接 10 节
- Q: 矿车移动是否消耗玩家任何资源？ → A: 不消耗任何资源
- Q: 矿车渲染是否使用 InstancedMesh 优化？ → A: 是，参照 ZombieInstancedRenderer 实现批量渲染优化

## Assumptions

- 铁轨方块 sand_train_track 和 sand_train_track_corner 已正确实现（参考 028-minecart-feature）
- 矿车放置功能已完成（028-minecart-feature）
- 矿车朝向系统已实现（矿车 orientation 属性）
- 碰撞检测使用现有物理系统或新增独立碰撞检测逻辑
- 矿车移动使用定时器或帧更新驱动（不使用物理引擎驱动）
- "相邻矿车"定义为前后相邻铁轨位置上的矿车（同一条铁轨线上的连续矿车）
- 矿车渲染使用 InstancedMesh 批量渲染，参照 ZombieInstancedRenderer 实现