# Feature Specification: Tall Well 结构生成

**Feature Branch**: `027-tall-well`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "添加 tall_well.json 结构生成逻辑，与 pavilion.json 相同的生成方式，在 pavilion 之后生成，相同概率，不重叠"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - City 地图生成 Tall Well (Priority: P1)

在 City 地图中，系统会在 pavilion 生成之后，以相同概率尝试生成 tall_well 结构。Tall Well 应该与 pavilion 有相同的生成规则和避免重叠机制。

**Why this priority**: Tall Well 是 City 地图的装饰性建筑，增加场景多样性，是此功能的核心目标。

**Independent Test**: 可以在 City 地图中观察 tall_well 是否生成，且不与 pavilion 或其他建筑重叠。

**Acceptance Scenarios**:

1. **Given** City 地图已加载，**When** 区块生成时，**Then** tall_well 应该按照与 pavilion 相同的概率生成
2. **Given** 一个候选位置，**When** pavilion 已在该位置占用，**Then** tall_well 不应生成
3. **Given** tall_well 生成，**When** 观察其与 pavilion 的关系，**Then** 两者不应重叠

---

### User Story 2 - Tall Well 避免与其他结构重叠 (Priority: P1)

Tall Well 生成时需要检查周围是否有其他建筑（包括 pavilion、filler house、flower bed、tree 等），避免重叠放置。

**Why this priority**: 确保生成质量，避免建筑相互穿插的视觉问题。

**Independent Test**: 可以通过检查生成日志或观察游戏场景验证 tall_well 是否与其他结构保持距离。

**Acceptance Scenarios**:

1. **Given** 一个位置靠近已有建筑，**When** 尝试生成 tall_well，**Then** 应该被拒绝并寻找其他位置
2. **Given** tall_well 已生成，**When** 检查其周围空间，**Then** 应该与其他主要建筑保持安全距离

---

### Edge Cases

- 当 City 地图中没有足够空间时，tall_well 应该如何处理？→ 使用与 pavilion 相同的兜底机制
- 当 tall_well 和 pavilion 同时竞争同一位置时，如何处理？→ pavilion 先生成，tall_well 后生成，检查是否冲突
- 当 tall_well 的 JSON 数据加载失败时？→ 优雅失败，不影响其他结构生成

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须在 StructureLoader.js 中注册 tall_well 结构加载器
- **FR-002**: 系统必须在 WorldWorker.js 中导入 tall_well 加载器
- **FR-003**: 系统必须在 WorldWorker.js 的预加载列表中包含 tall_well.load()
- **FR-004**: 系统必须计算 tall_well 的底部占用区域（footprint），用于碰撞检测
- **FR-005**: 系统必须实现 tall_well 专用占用单元格记录机制（tallWellFootprintCells）
- **FR-006**: 系统必须实现检查 tall_well 占用区域是否已被预留的函数 isTallWellFootprintReserved
- **FR-007**: 系统必须实现预留 tall_well 占用区域的函数 reserveTallWellFootprint
- **FR-008**: 系统必须实现检查 tall_well 放置空间是否清空的函数 isTallWellSpaceClear
- **FR-009**: 系统必须实现检查是否可以放置 tall_well 的综合函数 canPlaceCityTallWell，需要检查：是否靠近主要建筑、filler house、flower bed、tree 等
- **FR-010**: 系统必须实现 queueCityTallWell 函数，将 tall_well 生成任务加入队列
- **FR-011**: 系统必须实现 generateTallWell 函数，调用 tallWell.generate() 从 JSON 数据生成结构
- **FR-012**: 系统必须在 City 后置填充阶段，在 pavilion 生成之后尝试生成 tall_well
- **FR-013**: 系统必须使用与 pavilion 相同的生成概率（CITY_TALL_WELL_CHANCE = CITY_FLOWER_BED_CHANCE * 6）
- **FR-014**: 系统必须在兜底机制中，若 pavilion 未成功生成时，也尝试生成 tall_well
- **FR-015**: tall_well 生成逻辑必须参考 pavilion 的避免重叠机制，确保不与 pavilion 重叠

### Key Entities *(include if feature involves data)*

- **TallWell Structure**: 基于 JSON 文件的数据驱动结构，包含方块定义
- **TallWell Footprint**: 结构的底部占用区域，用于碰撞避免
- **City Tall Well Candidates**: City 核心区候选点列表

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在 City 地图中，tall_well 按照预期概率生成（与 pavilion 相同）
- **SC-002**: tall_well 与 pavilion 或其他结构不发生重叠
- **SC-003**: tall_well 生成成功率与 pavilion 相当
- **SC-004**: tall_well 生成不导致性能下降（生成时间 < 10ms）

## Assumptions

- tall_well.json 文件已存在于 src/world/structures/ 目录
- tall_well 结构的尺寸与 pavilion 相近，可以使用类似的 footprint 计算逻辑
- City 地图的生成逻辑保持当前实现不变
