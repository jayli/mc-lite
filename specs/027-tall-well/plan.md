# Implementation Plan: Tall Well 结构生成

**Branch**: `027-tall-well` | **Date**: 2026-03-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/027-tall-well/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

在 City 地图中新增 tall_well 结构生成逻辑，参照 pavilion 的生成方式，包括 footprint 计算、避免重叠机制、后置填充和兜底生成。需要修改 StructureLoader.js 注册 tall_well 加载器，修改 WorldWorker.js 集成生成逻辑。

## Technical Context

**Language/Version**: JavaScript (ES2020+)
**Primary Dependencies**: Three.js (WebGL 渲染), 自定义 WorldWorker
**Storage**: N/A (纯客户端，无持久化)
**Testing**: 浏览器测试 http://localhost:8080/src/tests/index.html
**Target Platform**: 现代 Web 浏览器，支持 WebGL 2.0
**Project Type**: 3D 体素游戏 (Minecraft 克隆)
**Performance Goals**: 结构生成时间 < 10ms
**Constraints**: 避免内存泄漏，及时释放 GPU 资源
**Scale/Scope**: City 地图装饰性结构

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 面向对象与逻辑分层 | ✅ PASS | 修改遵循现有 StructureLoader/WorldWorker 分层 |
| II. 内存效率与垃圾回收 | ✅ PASS | 仅添加配置和生成逻辑，不增加临时对象 |
| III. 主动资源释放 | ✅ PASS | 不新增需要释放的资源 |
| IV. WebGL/Three.js 性能优化 | ✅ PASS | 复用现有 InstancedMesh 机制 |
| V. 简洁性与核心机制 | ✅ PASS | 参照现有 pavilion 实现，保持简洁 |
| VI. 资源管理与学习参考 | ✅ PASS | 不涉及外部资源引用 |

## Project Structure

### Documentation (this feature)

```text
specs/027-tall-well/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output (不需要，无技术选型问题)
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (不需要，无外部接口)
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code (repository root)

```text
src/
├── world/
│   ├── structures/
│   │   └── tall_well.json      # 新增结构数据文件
│   └── entity-system/
│       └── StructureLoader.js  # 修改：注册 tall_well 加载器
└── workers/
    └── WorldWorker.js          # 修改：集成 tall_well 生成逻辑
```

**Structure Decision**: 参照 pavilion 的实现模式，在 StructureLoader.js 注册加载器，在 WorldWorker.js 实现生成逻辑。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

N/A - 所有原则检查通过

## Phase 0: Research

本功能无技术选型问题，直接复用现有 pavilion 实现模式。

**决策**: 直接复用 pavilion 的生成逻辑模式
**理由**: 用户明确要求"与 pavilion.json 相同的生成方式"
**替代方案**: 无

## Phase 1: Design

### Data Model

见 [data-model.md](data-model.md)

### Implementation Notes

1. **StructureLoader.js 修改**:
   - 添加 `tallWell` 到 structureLoaders 对象
   - 添加 `tallWell.load()` 到 preloadAllStructures 函数

2. **WorldWorker.js 修改**:
   - 导入 tallWell 加载器
   - 添加 `CITY_TALL_WELL_CHANCE` 常量 (与 pavilion 相同概率)
   - 添加 `cityTallWellFootprintCells` Set 用于记录占用
   - 实现 footprint 计算函数
   - 实现 `isTallWellFootprintReserved` 检查函数
   - 实现 `reserveTallWellFootprint` 预留函数
   - 实现 `isTallWellSpaceClear` 空间检查函数
   - 实现 `canPlaceCityTallWell` 综合判断函数
   - 实现 `queueCityTallWell` 队列函数
   - 实现 `generateTallWell` 生成函数
   - 在 pavilion 生成之后调用 tall_well 生成逻辑
   - 在兜底机制中尝试生成 tall_well

3. **避免重叠策略**:
   - tall_well 和 pavilion 共用 footprint 检查机制
   - tall_well 生成时检查 pavilion 的占用记录
   - 两者的预留 Set 可以分开管理，但检查时需要互相检查

## Phase 2: Tasks

待 `/speckit.tasks` 命令生成
