# Feature Specification: 009-player-gun

**Feature Branch**: `009-009-player-gun`
**Created**: 2026-02-06
**Status**: Draft
**Input**: 实现玩家手持枪支效果，支持 'R' 键切换状态，模型位于 src/world/assets/mod/gun.gltf

## User Scenarios & Testing

### User Story 1 - 持枪切换 (Priority: P1)

作为玩家，我希望通过按下 'R' 键在空手和持枪状态之间切换，以便根据需要选择是否装备武器。

**Why this priority**: 这是核心交互功能，决定了玩家是否能进入持枪状态。

**Independent Test**: 进入游戏后按下 'R' 键，观察模型是否出现；再次按下，观察模型是否消失。

**Acceptance Scenarios**:

1. **Given** 玩家处于空手状态, **When** 按下 'R' 键, **Then** 枪支模型出现在视野右下角。
2. **Given** 玩家处于持枪状态, **When** 按下 'R' 键, **Then** 枪支模型从视野中消失，恢复空手状态。

---

### User Story 2 - 第一人称持枪视觉效果 (Priority: P2)

作为玩家，当我持有枪支时，我希望看到枪支始终位于视野的右下角，且枪口正对前方，以模拟真实的第一人称射击视角。

**Why this priority**: 这是提升游戏沉浸感的关键视觉体验。

**Independent Test**: 在持枪状态下转动视角和移动，观察枪支模型是否保持在屏幕右下角且方向正确。

**Acceptance Scenarios**:

1. **Given** 玩家处于持枪状态, **When** 移动或旋转相机, **Then** 枪支模型跟随相机同步移动，始终保持在屏幕右下角相对位置。
2. **Given** 玩家持枪, **When** 观察枪口方向, **Then** 枪口应指向相机正前方。

---

## Requirements

### Functional Requirements

- **FR-001**: 系统必须从 `src/world/assets/mod/gun.gltf` 加载枪支模型。
- **FR-002**: 枪支模型必须作为相机的子对象或同步跟随相机，以实现第一人称效果。
- **FR-003**: 必须监听 'KeyR' 输入以切换持枪状态。
- **FR-004**: 持枪时，默认的手臂模型（Player.arm）应被隐藏或调整以避免视觉冲突。
- **FR-005**: 枪支模型的初始缩放和旋转必须经过校准，确保在 75 FOV 下显示正常。

### Key Entities

- **Gun**: 表示枪支的可视化模型，具有开启/关闭状态。
- **Player**: 玩家实体，管理输入和相机。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 'R' 键切换状态的响应延迟低于 100ms。
- **SC-002**: 枪支模型加载后，渲染帧率（FPS）下降不超过 5%。
- **SC-003**: 枪支位置在不同分辨率下均能保持在视野边缘，不遮挡中心准星。
