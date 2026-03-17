# Feature Specification: 海岛炮塔实体

**Feature Branch**: `022-island-battery`
**Created**: 2026-03-17
**Status**: Draft
**Input**: User description: "参照 tank.json 的实现，实现一个新的实体"炮塔"（battery.json），模型数据来自src/world/structers/battery.json，将炮塔生成在海岛上，一个海岛上随机生成一座炮塔。"

## Clarifications

### Session 2026-03-17

- **Q**: 炮塔的可破坏性 → **A**: 可被破坏，不重生（与 tank 一致）

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 探索海岛发现炮塔 (Priority: P1)

玩家在游戏世界中探索，发现海岛上有一座炮塔建筑，增加游戏世界的丰富性和探索乐趣。

**Why this priority**: 这是功能的核心价值，为海岛添加标志性建筑，提升视觉辨识度和游戏体验。

**Independent Test**: 可以通过创建新世界并前往海岛，验证炮塔是否正确生成在海岛上。

**Acceptance Scenarios**:

1. **Given** 新生成的游戏世界，**When** 玩家前往任意海岛，**Then** 可以在海岛上发现一座炮塔建筑
2. **Given** 多个不同的海岛，**When** 玩家逐一探索，**Then** 每个海岛都有且只有一座炮塔

---

### User Story 2 - 炮塔位置随机性 (Priority: P2)

同一世界种子下每次生成的炮塔位置应保持一致，但不同世界种子下海岛上炮塔的具体位置应随机分布。

**Why this priority**: 保持游戏的可重复性（相同种子）同时提供多样性（不同种子）。

**Independent Test**: 使用相同种子多次创建世界，验证炮塔位置一致；使用不同种子验证位置变化。

**Acceptance Scenarios**:

1. **Given** 使用相同世界种子创建多个世界，**When** 检查同一海岛上炮塔位置，**Then** 位置完全一致
2. **Given** 使用不同世界种子创建世界，**When** 检查海岛上炮塔位置，**Then** 位置分布具有随机性

---

### Edge Cases

- 海岛面积较小（接近最小尺寸）时，炮塔是否仍能合理放置？
- 炮塔生成位置是否会与海岛地形冲突？
- **炮塔破坏处理**: 玩家可以像破坏普通方块一样破坏炮塔，炮塔被破坏后不会自动重生，保持玩家对世界的永久改变。重新加载区块时，已破坏的炮塔保持破坏状态，不会重新生成（世界生成时仅创建一次）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须定义一个新的 JSON 实体"炮塔"（battery），使用已有的 battery.json 模型数据
- **FR-002**: 炮塔实体必须通过 StructureLoader 加载器注册，与 tank 实体采用相同的实现模式
- **FR-003**: 每个海岛必须生成且仅生成一座炮塔
- **FR-004**: 炮塔必须生成在海岛的固体地面上（石头区域），而非沙滩边缘
- **FR-005**: 炮塔在海岛上的具体位置必须基于世界种子进行确定性随机计算，确保相同种子下位置一致
- **FR-006**: 系统必须在海岛地形生成完成后，再执行炮塔的生成
- **FR-007**: 炮塔生成位置应避免与海岛中心或其他关键特征（如出生点）过于接近
- **FR-008**: 炮塔必须可以被玩家破坏，破坏后不应自动重生，保持玩家对世界的永久改变

### Key Entities *(include if feature involves data)*

- **炮塔（Battery）**: 由 JSON 数据定义的静态建筑实体，包含基座（iron_ore）、支柱（obsidian）、顶部炮管（iron、horizontal_pillar）等方块组成
- **海岛（Island）**: 海洋中的方形陆地，包含沙滩边缘和石头内部区域，是炮塔的生成载体
- **StructureLoader**: 负责从 JSON 文件加载结构数据的加载器，用于炮塔数据的读取和生成

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% 的海岛都包含一座炮塔建筑（抽样检查至少 10 个海岛）
- **SC-002**: 相同世界种子下，炮塔位置 100% 可复现（重复测试 5 次）
- **SC-003**: 炮塔生成在海岛石头区域的概率 > 95%（排除沙滩边缘区域）
- **SC-004**: 海岛生成时间增加不超过 10%（与无炮塔版本对比）
