# Feature Specification: 模型创造台 (Model Creator)

**Feature Branch**: `001-model-creator`
**Created**: 2026-02-23
**Status**: Ready for Planning
**Input**: 新需求编号 015，将游戏中创造的模型（各种方块的组合）导出为 JSON 文件，作为原始模型参与世界地图构建

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 打开创造台 (Priority: P1)

玩家在游戏过程中，可以通过设置面板中的"打开创造台"按钮，在玩家身边的空地上生成一个由灰色方块 (playground_block) 组成的 40x40 正方形平台，作为模型创建的基础区域。

**Why this priority**: 这是整个功能的基础，没有创造台平台，后续的模型创建和导出都无法进行。这是 MVP 功能。

**Independent Test**: 点击按钮后，可以在玩家身边空地上看到一个 40x40 的灰色方块平台，平台创建后按钮变为不可点击状态。

**Acceptance Scenarios**:

1. **Given** 玩家在游戏中且设置面板已打开，**When** 玩家点击"打开创造台"按钮，**Then** 在玩家身边空地上生成一个 40x40 的灰色方块平台
2. **Given** 创造台已经创建，**When** 玩家再次尝试点击"打开创造台"按钮，**Then** 按钮处于置灰不可点击状态
3. **Given** 创造台已生成，**When** 玩家观察平台上的方块，**Then** 所有平台方块均为灰色 (playground_block)

---

### User Story 2 - 在创造台上创建模型 (Priority: P2)

玩家可以在创造台平台上自由放置各种方块，创建自定义的模型结构（如树木、建筑等）。

**Why this priority**: 这是核心价值功能，允许玩家实际创建模型。只有创建模型后才能导出。

**Independent Test**: 玩家可以在平台上放置方块，方块正常显示并可被后续操作识别。

**Acceptance Scenarios**:

1. **Given** 创造台已生成，**When** 玩家使用游戏内的方块放置机制在平台上放置方块，**Then** 方块被正确放置在平台上的指定位置
2. **Given** 玩家在平台上创建了模型结构，**When** 玩家观察模型，**Then** 所有方块按照玩家放置的位置和方向正确显示

---

### User Story 3 - 导出模型为 JSON 文件 (Priority: P3)

玩家通过点击"导出模型"按钮，将创造台上所有非 playground_block 的方块组合导出为一个名为 model.json 的文件，文件包含方块位置、方向、类型等信息。

**Why this priority**: 这是功能的最终目标，将玩家创建的模型持久化为 JSON 文件，供后续世界生成使用。

**Independent Test**: 点击导出按钮后，生成一个 model.json 文件，文件内容包含所有方块的完整信息。

**Acceptance Scenarios**:

1. **Given** 玩家在创造台上创建了模型，**When** 玩家点击"导出模型"按钮，**Then** 生成一个名为 model.json 的文件
2. **Given** 玩家点击导出按钮，**When** 检查生成的 JSON 文件内容，**Then** 文件包含所有非 playground_block 方块的位置、方向、类型信息
3. **Given** 创造台上没有任何非 playground_block 方块，**When** 玩家点击"导出模型"按钮，**Then** 生成一个空的或包含空数组的 JSON 文件

---

### Edge Cases

- **玩家身边没有足够空间**: 当玩家正前方 5-10 格范围内没有足够 40x40 的平坦区域时，系统应自动寻找最近的合适位置或提示玩家移动位置
- **玩家处于空中或水中**: 创造台应生成在玩家正前方水平面上的安全位置
- **方块被破坏**: 玩家在创造台上放置的方块被 TNT、机枪或其他方式破坏后，导出的 JSON 反映当前状态（即只导出当前存在的方块）
- **多次导出**: 玩家多次点击"导出模型"按钮，将覆盖之前的 model.json 文件

---

## Clarifications

### Session 2026-02-23

- Q: 导出的 JSON 使用什么坐标系统？ → A: 相对坐标（相对于创造台中心点）
- Q: 方块方向使用什么格式表示？ → A: Minecraft 标准方向值 (0-5)
- Q: 导出文件如何交付给玩家？ → A: 浏览器下载

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须在设置面板中提供"打开创造台"按钮
- **FR-002**: 系统必须在设置面板中提供"导出模型"按钮
- **FR-003**: 当玩家点击"打开创造台"按钮时，系统必须在玩家正前方 5-10 格处的水平地面生成一个 40x40 的正方形平台
- **FR-004**: 创造台平台必须由灰色 playground_block 方块组成
- **FR-005**: 构成创造台基础的 40x40 playground_block 方块必须不可被消除、TNT 炸毁或机枪消除（玩家在平台上放置的方块不受此保护）
- **FR-006**: 创造台创建后，"打开创造台"按钮必须置灰为不可点击状态
- **FR-007**: 系统必须允许玩家在创造台平台上放置各种方块
- **FR-008**: 当玩家点击"导出模型"按钮时，系统必须生成一个名为 model.json 的文件并通过浏览器下载交付给玩家
- **FR-009**: 导出的 JSON 文件必须包含所有非 playground_block 方块的相对位置信息（相对于创造台中心的 x, y, z 偏移量）
- **FR-010**: 导出的 JSON 文件必须包含所有非 playground_block 方块的方向信息（使用 Minecraft 标准方向值 0-5）
- **FR-011**: 导出的 JSON 文件必须包含所有非 playground_block 方块的类型信息
- **FR-012**: 创造台暂时只能创建，不能被隐藏或关闭


### Assumptions and Dependencies

- **方块类型**: 游戏中已存在或需要添加 `playground_block` 方块类型
- **文件下载**: 浏览器支持通过 JavaScript 触发文件下载
- **游戏状态**: 玩家在点击按钮时必须处于可交互的游戏状态
- **空间检测**: 系统需要具备检测玩家正前方是否有足够空间的能力

### Key Entities *(include if feature involves data)*

- **创造台 (Playground)**: 由 40x40 个 playground_block 方块组成的单层正方形平台，作为模型创建的基础区域
- **模型 (Model)**: 由玩家在创造台上放置的各种方块组成的结构集合
- **模型数据 (Model Data)**: 描述模型中每个方块的位置、方向、类型等信息的数据结构
- **playground_block**: 灰色的特殊方块类型，用于构成创造台平台，具有不可破坏属性
- **model.json**: 导出的模型文件格式，包含以下结构：
  - `blocks`: 方块数组，每个元素包含：
    - `x`, `y`, `z`: 相对于创造台中心的坐标偏移量（整数）
    - `type`: 方块类型标识符（字符串）
    - `direction`: Minecraft 标准方向值（0-5，其中 0=上，1=下，2=北，3=南，4=西，5=东）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 玩家能够在 5 秒内成功打开创造台（从点击按钮到平台完全生成）
- **SC-002**: 创造台生成后，100% 的 playground_block 方块对 TNT、机枪和玩家破坏具有免疫力
- **SC-003**: 玩家可以在创造台上自由放置方块，放置成功率达到 100%
- **SC-004**: 导出模型时，JSON 文件必须 100% 准确地包含所有非 playground_block 方块的信息
- **SC-005**: 导出的 JSON 文件格式必须有效，能够被标准 JSON 解析器解析
