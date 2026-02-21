# Implementation Plan: Block Orientation System

**Branch**: `001-block-orientation` | **Date**: 2026-02-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-block-orientation/spec.md`

## Summary

为所有可放置方块添加水平朝向属性（东南西北），实现"移除-放置时顺时针旋转90度"的核心功能。技术方案：扩展方块数据结构为 `{ type, orientation }` 格式，通过矩阵变换在 InstancedMesh 层面实现几何体旋转，同时保持对旧存档的向后兼容。

## Technical Context

**Language/Version**: JavaScript (ES6 Modules)
**Primary Dependencies**: Three.js (WebGL 3D 引擎)
**Storage**: IndexedDB (通过 PersistenceService)
**Testing**: 手动测试 + 性能监控 (按 P 键)
**Target Platform**: 现代浏览器 (WebGL 2.0)
**Project Type**: 单项目 (游戏应用)
**Performance Goals**: 60 FPS，1000+ 方块无卡顿
**Constraints**: 不影响现有 Face Culling、InstancedMesh 合并性能
**Scale/Scope**: 所有可放置方块类型 (~50+ 种)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 检查项 | 状态 |
|------|--------|------|
| I. 面向对象与逻辑分层 | 朝向逻辑封装在独立模块，不污染渲染层 | ✅ Pass |
| II. 内存效率与垃圾回收 | 不在每帧创建新对象，使用预分配矩阵 | ✅ Pass |
| III. 主动资源释放 | 无新增需释放资源，复用现有机制 | ✅ Pass |
| IV. WebGL/Three.js 性能优化 | 通过矩阵变换实现旋转，不增加 Draw Call | ✅ Pass |
| V. 简洁性与核心机制 | 仅添加朝向属性，最小化改动范围 | ✅ Pass |
| VI. 资源管理与学习参考 | 不涉及外部资源 | ✅ Pass |

**Gate Result**: PASS - 无宪法违规

## Project Structure

### Documentation (this feature)

```text
specs/001-block-orientation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── constants/
│   └── BlockData.js          # 扩展: 方块属性配置
├── services/
│   └── PersistenceService.js # 修改: 存档读写兼容
├── world/
│   ├── Chunk.js              # 修改: 渲染旋转 + 数据存储
│   └── World.js              # 修改: 放置/移除接口
├── entities/player/
│   └── Player.js             # 修改: 放置记忆逻辑
└── utils/
    └── OrientationUtils.js   # 新增: 朝向计算工具
```

**Structure Decision**: 在现有单项目结构中扩展，新增 `OrientationUtils.js` 工具模块，修改 `Chunk.js`、`World.js`、`Player.js`、`PersistenceService.js` 和 `BlockData.js`。

## Complexity Tracking

> 无宪法违规需要记录
