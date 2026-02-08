# Implementation Plan: Codebase Refactoring

**Branch**: `012-codebase-refactor` | **Date**: 2026-02-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-codebase-refactor/spec.md`

## Summary

The primary requirement is to refactor the existing codebase to improve maintainability and readability without changing any functionality. This involves extracting logic from monolithic classes (Player.js) into specialized components (Gun.js, Physics.js), standardizing asset locations, and consolidating configuration constants.

The technical approach involves:
1. Moving all world assets to a root-level `src/assets` directory.
2. Creating a `Gun` class abstraction for weapon logic.
3. Decoupling collision detection from the `Player` class into `Physics.js`.
4. Updating all internal references to match the new file structure.

## Technical Context

**Language/Version**: JavaScript (ES6 Modules)
**Primary Dependencies**: Three.js (via CDN)
**Storage**: IndexedDB (via PersistenceService.js)
**Testing**: Manual functional testing (gameplay verification)
**Target Platform**: Modern Web Browsers (WebGL 2.0)
**Project Type**: Single project (Vanilla JS / Three.js)
**Performance Goals**: Maintain 60 FPS and current draw call efficiency
**Constraints**: ES6 Module structure, CDN-loaded Three.js, No build step
**Scale/Scope**: Core engine and entity refactor (~10-15 files affected)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **OO Design & Layering**: The plan specifically addresses this by breaking down `Player.js` and creating cleaner abstractions (`Gun.js`).
- [x] **Memory Efficiency**: Refactoring will maintain the current InstancedMesh and consolidation logic.
- [x] **Resource Release**: Asset movement doesn't affect the chunk unloading/disposal logic.
- [x] **Performance Optimization**: Changes are logic-focused and won't increase draw calls.
- [x] **Simplicity**: Extracting logic reduces the complexity of individual files.
- [x] **Resource Management**: Moving assets to `src/assets` aligns with the principle of not using external bundles directly.

## Project Structure

### Documentation (this feature)

```text
specs/012-codebase-refactor/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (N/A for this refactor)
└── checklists/
    └── requirements.md  # Spec validation
```

### Source Code (repository root)

```text
src/
├── assets/              # NEW: Consolidated assets (moved from src/world/assets)
│   ├── mod/             # Models (including renamed minigun.glb)
│   ├── textures/        # Textures
│   └── sfx/             # Sound effects
├── core/
│   ├── Engine.js        # Updated: Constants moved to top
│   ├── Game.js
│   ├── FaceCullingSystem.js
│   └── MaterialManager.js # MOVED: From src/core/materials/
├── entities/
│   ├── player/
│   │   ├── Player.js    # Refactored: Gun/Physics logic extracted
│   │   └── Physics.js   # Updated: Collision logic relocated here
│   └── weapon/
│       └── Gun.js       # NEW: Weapon abstraction
├── utils/
│   └── FaceCullingUtils.js # MOVED/RENAMED: From src/core/face-culling-utils.js
└── world/               # Assets directory removed from here
```

**Structure Decision**: Single project structure maintained with improved organization of core modules and entities.

## Complexity Tracking

> **No Constitution Check violations found.**
