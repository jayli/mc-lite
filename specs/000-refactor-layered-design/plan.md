# Implementation Plan: Refactor Layered Design

**Branch**: `001-refactor-layered-design` | **Date**: 2026-01-19 | **Spec**: [Link](./spec.md)
**Input**: Feature specification from `/specs/001-refactor-layered-design/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Refactor the existing monolithic `index.html` based Three.js Minecraft clone into a modular, layered architecture (Core, World, Entities, UI). This includes extracting physical entity logic (clouds, trees), separating inventory logic, introducing player equipment slots, and designing a texture/material abstraction layer, all while maintaining strict feature parity.

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (via Import Map/CDN)
**Storage**: In-memory (runtime state), potentially localStorage for persistence (future)
**Testing**: Manual verification (Visual/Functional parity)
**Target Platform**: Modern Web Browsers (WebGL 2.0 support)
**Project Type**: Single Page Web Application (No build step)
**Performance Goals**: 60 FPS, Stable memory usage (GC friendly)
**Constraints**: No build tools (Webpack/Vite), pure ESM, maintain existing feature set exactly.
**Scale/Scope**: Refactoring ~800 LOC from single file into ~10-15 modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. 面向对象与逻辑分层**: PASSED. This refactor explicitly aligns with this principle by breaking the monolith.
- **II. 内存效率与垃圾回收**: PASSED. Modularization allows better lifecycle management (dispose methods).
- **III. 主动资源释放**: PASSED. `World` and `Chunk` modules will encapsulate disposal logic.
- **IV. WebGL/Three.js 性能优化**: PASSED. InstancedMesh usage is preserved/encapsulated.
- **V. 简洁性与核心机制**: PASSED. Refactor focuses on structure without adding unnecessary features.

## Project Structure

### Documentation (this feature)

```text
specs/001-refactor-layered-design/
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
├── core/
│   ├── Game.js          # Main entry point/loop
│   ├── Engine.js        # Three.js setup (Scene, Camera, Renderer)
│   └── materials/       # Texture/Material definitions
│       └── MaterialManager.js
├── world/
│   ├── World.js         # World management
│   ├── Chunk.js         # Chunk logic
│   ├── TerrainGen.js    # Noise & Biome logic
│   └── entities/        # Physical entities
│       ├── Cloud.js
│       ├── Tree.js
│       └── Island.js
├── entities/
│   └── player/
│       ├── Player.js    # Player logic
│       ├── Physics.js   # Physics/Collision
│       └── Slots.js     # Equipment slots
├── ui/
│   ├── UIManager.js     # UI Orchestrator
│   ├── HUD.js           # Crosshair, Hotbar
│   └── Inventory.js     # Inventory Logic & UI
└── utils/
    └── MathUtils.js     # Helper functions
```

**Structure Decision**: Adopted a domain-driven directory structure (`core`, `world`, `entities`, `ui`) as per the "Layered Design" requirement.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |
