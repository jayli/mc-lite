# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

**Primary Requirement**: 参照 tank.json 实现新的实体"炮塔"（battery），使用已存在的 battery.json 模型数据，在每个海岛上随机生成一座炮塔。

**Technical Approach**: 完全复用现有的 JsonEntity + StructureLoader 架构：
1. 在 `StructureLoader.js` 中注册 battery 结构加载器
2. 在 `EntityManager.js` 中注册 battery 实体（概率 1.0，每个海岛必生成）
3. 在 `IslandMap.js` 的 `generateIsland()` 中集成炮塔生成逻辑
4. 使用确定性随机算法基于世界种子计算炮塔位置
5. 确保炮塔生成在石头区域（避开沙滩边缘）

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (WebGL rendering), Custom Entity System
**Storage**: IndexedDB (world persistence), JSON files (structure definitions)
**Testing**: Browser-based test suite at `/src/tests/index.html`
**Target Platform**: Modern Web Browsers (WebGL 2.0 support required)
**Project Type**: 3D Voxel Game (Minecraft clone) - Pure client-side
**Performance Goals**: 60 FPS, <100ms chunk generation time, minimal GC pressure
**Constraints**: Memory efficient (proactive resource release), no server-side logic
**Scale/Scope**: Single player, world seed-based generation, 3-chunk render distance

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| I. 面向对象与逻辑分层 | ✅ PASS | 使用现有 EntityManager/StructureLoader 架构，符合分层设计 |
| II. 内存效率与垃圾回收 | ✅ PASS | 炮塔作为静态结构，不产生运行时临时对象 |
| III. 主动资源释放 | ✅ PASS | 区块卸载时自动销毁，符合视距外销毁原则 |
| IV. WebGL/Three.js 性能优化 | ✅ PASS | 复用现有 InstancedMesh 渲染系统 |
| V. 简洁性与核心机制 | ✅ PASS | 仅添加实体注册和生成逻辑，无过度设计 |
| VI. 资源管理与学习参考 | ✅ PASS | 使用已有的 JSON 结构文件，无外部资源依赖 |

**Gate Result**: ✅ **PASS** - All principles satisfied. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── world/
│   ├── entity-system/
│   │   ├── StructureLoader.js    # 添加 battery 加载器
│   │   └── EntityManager.js      # 注册 battery 实体
│   ├── entities/
│   │   └── Island.js             # 可能修改：添加炮塔生成调用
│   └── structures/
│       └── battery.json          # 已存在，炮塔模型数据
├── workers/
│   ├── WorldWorker.js            # 可能修改：海岛生成时触发炮塔生成
│   └── maps/
│       └── IslandMap.js          # 可能修改：生成炮塔位置计算
├── core/
│   └── Game.js                   # 可能修改：预加载 battery 结构
└── constants/
    └── BlockData.js              # 参考：方块属性定义

tests/
├── index.html                    # 测试入口
└── test-chunk.js                 # 可能需要添加炮塔生成测试
```

**Structure Decision**: 使用现有的实体系统和 StructureLoader 架构。主要修改点集中在：
1. `StructureLoader.js` - 添加 battery 结构加载器
2. `EntityManager.js` - 注册 battery 实体（参考 tank 模式）
3. `IslandMap.js` - 在海岛生成时计算炮塔位置并生成

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
