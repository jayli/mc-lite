# Implementation Plan: Chunk Optimization (Background Consolidation)

**Branch**: `007-chunk-optimization` | **Date**: 2026-02-05 | **Spec**: [/specs/007-chunk-optimization/spec.md](/specs/007-chunk-optimization/spec.md)
**Input**: Feature specification from `/specs/007-chunk-optimization/spec.md`

## Summary

实现区块渲染的“后台合并”优化。主要需求是解决玩家在放置大量方块后 FPS 下降的问题。技术方案是在玩家操作后，先以单个 Mesh 形式提供即时反馈，随后通过 Web Worker (`WorldWorker.js`) 在后台计算全量区块的优化数据（包括隐藏面剔除 Face Culling 和环境光遮蔽 AO），最后将碎片化的 Mesh 合并回 `InstancedMesh` 管理。

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (WebGL 2.0)
**Storage**: IndexedDB (via `PersistenceService.js`)
**Testing**: Manual Performance Profiling (Draw Calls & FPS)
**Target Platform**: Modern Web Browsers (WebGL 2.0 supported)
**Project Type**: Single project (Pure Frontend)
**Performance Goals**: 60 FPS baseline, Draw Calls per chunk reduced to near-initial state
**Constraints**: <1s debounce for consolidation, 16x16xH chunk size, async Worker processing
**Scale/Scope**: World with dynamic chunk loading/unloading (RENDER_DIST=3)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How handled/Justification |
|-----------|--------|---------------------------|
| I. OO Design & Layering | Pass | 保持 `Chunk.js` 逻辑清晰，将计算密集型逻辑隔离在 Worker 中。 |
| II. Memory Efficiency & GC | Pass | 通过合并 `InstancedMesh` 减少对象数量，及时销毁单体 Mesh。 |
| III. Proactive Resource Release | Pass | 确保在合并替换时显式调用旧 Mesh 的 `dispose()` 方法。 |
| IV. Performance Optimization | Pass | 核心目标是通过 `InstancedMesh` 和 `Face Culling` 减少 Draw Calls。 |
| V. Simplicity & Core | Pass | 利用现有的 `WorldWorker` 逻辑，避免重写复杂的渲染合并算法。 |

## Project Structure

### Documentation (this feature)

```text
specs/007-chunk-optimization/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── checklists/          # Quality checklists
│   └── requirements.md
└── tasks.md             # Phase 2 output (to be generated)
```

### Source Code (repository root)

```text
src/
├── core/
│   └── face-culling/
│       └── FaceCullingSystem.js
├── world/
│   ├── Chunk.js         # 主要修改点：管理合并逻辑、计数器和定时器
│   ├── World.js         # 辅助修改：确保 Snapshot 数据传递正确
│   └── WorldWorker.js   # 辅助修改：支持全量合并计算请求
└── services/
    └── PersistenceService.js # 确保 Snapshot 数据实时性
```

**Structure Decision**: 采用 Single project 结构，主要集中在 `src/world/` 目录下的核心逻辑修改。

## Complexity Tracking

> *No violations found*
