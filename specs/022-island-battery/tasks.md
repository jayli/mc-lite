# Tasks: 海岛炮塔实体

**Feature**: 海岛炮塔实体 (022-island-battery)
**Branch**: `022-island-battery`
**Created**: 2026-03-17
**Template Version**: 1.0

---

## Summary

实现海岛炮塔实体功能：参照 tank 实体模式，将 battery.json 注册为新的结构实体，在每个海岛上生成一座炮塔。

### Task Statistics

| Metric | Count |
|--------|-------|
| Total Tasks | 14 |
| Parallel Tasks | 3 |
| Stories | 2 (P1: US1, P2: US2) |

---

## Phase 1: Setup

**Goal**: 验证项目状态和资源可用性

### Tasks

- [x] T001 验证 battery.json 文件存在且格式正确，位于 `src/world/structures/battery.json`

---

## Phase 2: Foundational

**Goal**: 注册炮塔实体到实体系统，使其可被生成系统使用

**Prerequisites**: Phase 1 complete

### Tasks

- [x] T002 在 `src/world/entity-system/StructureLoader.js` 中添加 battery 结构加载器到 `structureLoaders` 对象
- [x] T003 在 `src/world/entity-system/StructureLoader.js` 的 `preloadAllStructures()` 中添加 battery 预加载
- [x] T004 [P] 在 `src/world/entity-system/EntityManager.js` 的 `initStructures()` 中注册 battery 实体（参考 tank 模式，biomes: ['OCEAN'], probability: 1.0）
- [x] T005 在 `src/world/entity-system/EntityManager.js` 的 `initSpecial()` 中设置 battery 的 loader 引用

---

## Phase 3: User Story 1 - 探索海岛发现炮塔

**Story Goal**: 玩家可以在每个海岛上发现一座炮塔建筑
**Priority**: P1
**Independent Test**: 创建新世界并前往海岛，验证炮塔存在且每个海岛只有一座
**Prerequisites**: Phase 2 complete

### Tasks

- [x] T006 [US1] 在 `src/workers/maps/IslandMap.js` 中实现 `calculateBatteryPosition(islandCx, islandCz, seed)` 函数，返回海岛石头区域内的随机位置
- [x] T007 [US1] 在 `src/workers/maps/IslandMap.js` 中实现 `generateBatteryForIsland(islandCx, islandCz, seed, fakeChunk, dPlaceholder)` 函数，使用 StructureLoader 生成炮塔
- [x] T008 [US1] 修改 `src/workers/maps/IslandMap.js` 的 `generateIsland()` 函数，在岛屿生成完成后调用 `generateBatteryForIsland()`
- [x] T009 [US1] 在 `src/core/Game.js` 中确保 battery 结构在初始化时被预加载（检查 `preloadAllStructures()` 调用）

---

## Phase 4: User Story 2 - 炮塔位置随机性

**Story Goal**: 相同世界种子下炮塔位置一致，不同种子下位置随机
**Priority**: P2
**Independent Test**: 使用相同种子多次创建世界，验证位置一致；使用不同种子验证位置变化
**Prerequisites**: Phase 3 complete

### Tasks

- [x] T010 [US2] 验证 `calculateBatteryPosition()` 使用确定性随机算法：`seededRandom(islandCx + 1000, islandCz + 1000, seed)`
- [x] T011 [US2] 添加位置偏移缓存机制确保相同输入产生相同输出，在 `src/workers/maps/IslandMap.js` 中添加注释说明算法

---

## Phase 5: Polish & Cross-Cutting Concerns

**Goal**: 边界情况处理和验证

**Prerequisites**: Phase 4 complete

### Tasks

- [x] T012 处理小海岛边界情况：在 `calculateBatteryPosition()` 中确保即使海岛较小也能找到合适位置（距离中心 3-8 格范围内）
- [ ] T013 [P] 验证炮塔可破坏性：启动游戏并手动破坏炮塔方块，验证破坏后不会重生
- [x] T014 [P] 运行 ESLint 检查：`npm run lint`，修复任何新增的代码规范问题

---

## Dependencies

```
Phase 1
  ↓
Phase 2 (T002-T005 可并行)
  ↓
Phase 3 (US1 - 核心功能)
  ↓
Phase 4 (US2 - 确定性随机)
  ↓
Phase 5 (验证和 polish)
```

### Story Dependencies

- **US1 (P1)** 必须先完成，**US2 (P2)** 依赖于 US1 的实现
- US1 的完成标志是可以在海岛上看到生成的炮塔
- US2 的完成标志是相同种子下位置可复现

---

## Parallel Execution Examples

### Within Phase 2 (Foundational)

```bash
# Agent A: StructureLoader 修改
- T002: 添加 battery 加载器
- T003: 添加预加载

# Agent B: EntityManager 修改
- T004: 注册 battery 实体
- T005: 设置 loader 引用
```

### Within Phase 5 (Polish)

```bash
# Agent A: 边界处理
- T012: 小海岛边界情况

# Agent B: 验证
- T013: 可破坏性验证
- T014: ESLint 检查
```

---

## Implementation Strategy

### MVP Scope

**最小可行产品**: 完成 Phase 1-3 (T001-T009)，实现：
- battery 结构加载器注册
- EntityManager 实体注册
- 海岛生成时生成一座炮塔
- 炮塔生成在石头区域

MVP 完成后即可进行测试验证，US2 的确定性随机可作为增强功能后续实现。

### Incremental Delivery

1. **第一阶段**: Setup + Foundational (T001-T005)
   - 输出：battery 实体已注册，可被系统识别

2. **第二阶段**: US1 核心功能 (T006-T009)
   - 输出：每个海岛都有可见的炮塔建筑

3. **第三阶段**: US2 增强 (T010-T011)
   - 输出：位置确定性随机，相同种子可复现

4. **第四阶段**: Polish (T012-T014)
   - 输出：边界情况处理，代码质量检查通过

---

## Verification Checklist

- [ ] 所有海岛都包含一座炮塔（抽样检查至少 3 个海岛）
- [ ] 炮塔生成在石头区域（非沙滩边缘）
- [ ] 相同种子下位置一致
- [ ] 不同种子下位置不同
- [ ] 炮塔可被破坏且破坏后不重生
- [ ] `npm run lint` 无错误

---

## Notes

### Technical Context

- **Language**: JavaScript (ES6+ Modules)
- **Key Files**: StructureLoader.js, EntityManager.js, IslandMap.js
- **Pattern**: 复用 tank 实体的 JsonEntity + StructureLoader 模式
- **Constraints**: 每个海岛仅生成一座，位置在石头区域

### Risk Areas

- 海岛尺寸较小时的放置问题（已在 T012 处理）
- 跨区块渲染（crossChunkDist: 8 已设置）
- 与现有 tank 实体的冲突（biomes 不同，无冲突）
