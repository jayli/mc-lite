# Implementation Plan: 地图持久化与动态增量存储 (World Persistence)

**Branch**: `001-world-persistence` | **Date**: 2026-01-24 | **Spec**: [/specs/001-world-persistence/spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-world-persistence/spec.md`

## Summary

实现基于区块的增量修改持久化系统。通过记录玩家对方块的挖掘和放置行为（Deltas），在区块加载时动态应用这些修改。技术上优先使用 **IndexedDB** 实现会话内（In-session）的高效存储，结合**内存缓存层**确保玩家离开并返回区域后世界状态的一致性，同时满足高性能渲染（60 FPS）和内存回收的要求。

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (WebGL 2.0), IndexedDB API
**Storage**: IndexedDB (Primary), LocalStorage (Fallback)
**Testing**: Manual testing (as per CLAUDE.md, no automated tests configured)
**Target Platform**: Modern Web Browsers
**Project Type**: Single Web Project (Pure Frontend)
**Performance Goals**: 60 FPS maintenance; Reload time increase < 20%
**Constraints**: < 100MB memory (excluding assets); Session-only persistence (per clarification)
**Scale/Scope**: Support > 10,000 block modifications per session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. 面向对象与逻辑分层**: 持久化逻辑已封装为独立的 `PersistenceService.js`，与 `World.js` 和 `Chunk.js` 通过明确定义的接口（见 `contracts/`）解耦。
- [x] **II. 内存效率与垃圾回收**: 采用异步 IndexedDB 存储，内存中仅保留活跃区块的 Deltas，区块卸载时触发 Flush 释放内存。
- [x] **III. 主动资源释放**: 确保区块卸载时同步保存修改，并清理相关缓存对象。
- [x] **IV. WebGL/Three.js 性能优化**: 应用持久化修改集成在 `Chunk.js` 的 `gen()` 构建阶段，避免运行时的额外重绘开销。
- [x] **V. 简洁性与核心机制**: 仅记录增量（Deltas），不存储未修改的地形数据。

## Project Structure

### Documentation (this feature)

```text
specs/001-world-persistence/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: Technical decisions
├── data-model.md        # Phase 1: Entity definitions
├── quickstart.md        # Phase 1: Implementation overview
├── contracts/           # Phase 1: Internal service interfaces
└── checklists/          # Quality validation
```

### Source Code (repository root)

```text
src/
├── services/
│   └── PersistenceService.js  # New: Handles IndexedDB/LocalStorage logic
├── World.js                   # Update: Orchestrates chunk loading/saving
├── Chunk.js                   # Update: Applies deltas during mesh generation
├── Player.js                  # Update: Triggers save on block interaction
└── constants/
    └── PersistenceConfig.js   # New: Storage keys and limits
```

**Structure Decision**: 采用单项目结构（Single Project），在 `src/services/` 下新增持久化服务，并修改现有核心类以支持数据流集成。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 无 | - | - |
