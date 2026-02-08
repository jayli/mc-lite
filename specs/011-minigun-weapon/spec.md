# Feature Specification: Minigun Weapon

**Feature Branch**: `011-minigun-weapon`
**Created**: 2026-02-08
**Status**: Draft
**Input**: User description: "新增 Minigun 武器，包含模型加载、按 R 键切换、切换音效与动画，并支持连发射击。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 武器切换与模型显示 (Priority: P1)

作为一名玩家，我希望能够通过按 R 键切换到 Minigun，并看到它的 3D 模型正确显示在手中，这样我就能使用这把新武器。

**Why this priority**: 这是新武器的基础，没有模型显示和切换逻辑，玩家无法使用该功能。

**Independent Test**: 可以通过在游戏中按 R 键循环切换武器，观察是否出现了 Minigun 的模型。

**Acceptance Scenarios**:

1. **Given** 玩家当前手持 Mag7 武器，**When** 玩家按下 R 键，**Then** 玩家手中显示 Minigun 的 3D 模型。
2. **Given** 玩家当前手持 Minigun 武器，**When** 玩家按下 R 键，**Then** 玩家手中显示手臂（徒手状态）。

---

### User Story 2 - 连发射击逻辑 (Priority: P1)

作为一名玩家，我希望按住左键时 Minigun 能以极快的频率持续射击，以便在战斗中输出大量火力。

**Why this priority**: 连发是 Minigun 的核心特性，决定了其作为武器的独特性。

**Independent Test**: 按住鼠标左键，观察示踪线是否以固定的高频率持续生成。

**Acceptance Scenarios**:

1. **Given** 玩家手持 Minigun，**When** 玩家按住鼠标左键，**Then** 武器持续发射子弹，生成高频率的示踪线效果。
2. **Given** 玩家正在连发射击，**When** 玩家松开鼠标左键，**Then** 武器立即停止射击。

---

### User Story 3 - 切换与射击反馈 (Priority: P2)

作为一名玩家，我希望在切换到 Minigun 或射击时能听到相应的音效，并看到拿起武器的动画，增强沉浸感。

**Why this priority**: 音效和动画是提升游戏打击感和沉浸感的关键。

**Independent Test**: 切换武器时收听是否有上膛声，射击时收听是否有射击声，并观察模型是否有从下方弹出的动画。

**Acceptance Scenarios**:

1. **Given** 玩家切换到 Minigun，**When** 切换动作发生，**Then** 播放武器上膛音效，且模型执行从屏幕下方升起的拿起动画。
2. **Given** 玩家使用 Minigun 射击，**When** 触发射击，**Then** 播放专属的机枪射击音效，且模型伴随微小的后坐力抖动。

---

### Edge Cases

- 当玩家快速连续按下 R 键时，武器模型和动画是否会发生重叠或卡顿？
- 在射击过程中突然切换武器，连发逻辑是否会正确中断？

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须支持加载 `src/world/assets/mod/minugun.glb` 模型并进行标准化处理。
- **FR-002**: 玩家必须能够通过按 R 键在徒手、普通枪、Mag7 和 Minigun 之间循环切换。
- **FR-003**: 切换到 Minigun 时，必须触发 0.25 秒左右的平滑拿起动画。
- **FR-004**: 系统必须播放武器上膛（加载）音效。
- **FR-005**: 按住左键时，Minigun 必须以约 0.05 秒的间隔（比普通枪更快）执行连发射击。
- **FR-006**: 射击时必须生成黄色或橙色的示踪线效果，并播放射击音效。
- **FR-007**: 射击必须能与环境互动（挖掘方块或引燃 TNT）。

### Key Entities

- **WeaponMode**: 定义玩家当前的武装状态（增加 MINIGUN 状态）。
- **MinigunModel**: 存储 Minigun 的 3D 网格资源。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 切换武器后，模型加载与动画开始的延迟必须小于 50 毫秒。
- **SC-002**: Minigun 的连发频率应稳定在每秒 15-20 发左右。
- **SC-003**: 100% 的射击动作必须伴随相应的音效和视觉反馈（示踪线）。
- **SC-004**: 玩家可以在不刷新页面的情况下无限制地循环切换所有武器。
