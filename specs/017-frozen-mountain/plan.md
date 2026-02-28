# Implementation Plan: Frozen Mountain Custom Map

**Branch**: `017-frozen-mountain` | **Date**: 2026-02-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-frozen-mountain/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add a new custom map type: a tall frozen mountain with mysterious interior caves, located near snow_land regions. The mountain will have layered block composition (snow_grass → dirt → stone), be larger than Pyramid, and follow the existing custom map API pattern established by Pyramid.js and SnowLand.js.

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (existing)
**Storage**: N/A (procedural generation only)
**Testing**: Manual in-game verification (existing pattern)
**Target Platform**: Modern Web Browser with WebGL 2.0
**Project Type**: Game feature (3D voxel world generation)
**Performance Goals**: Maintain 60 FPS, no significant chunk loading delays
**Constraints**: Must follow existing custom map API pattern, reuse existing cave generation logic
**Scale/Scope**: Single new map module + integration in WorldWorker.js

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Core Principles Review

| Principle | Status | Notes |
|-----------|--------|-------|
| I. OO Design & Layering | ✅ PASS | Follows existing map module pattern, logic stays in WorldWorker/maps layer |
| II. Memory Efficiency & GC | ✅ PASS | Reuses existing chunk/block system, no per-frame allocations |
| III. Active Resource Release | ✅ PASS | No new GPU resources created, uses existing block types |
| IV. WebGL/Three.js Optimization | ✅ PASS | Uses existing InstancedMesh rendering, no new Draw Calls |
| V. Simplicity & Core | ✅ PASS | Focused on map generation, follows YAGNI |
| VI. Resource Management | ✅ PASS | No new resources needed, uses existing block types |

### Technical Constraints Review

| Constraint | Status | Notes |
|------------|--------|-------|
| WebGL 2.0 Browser | ✅ PASS | No new requirements beyond existing |
| Three.js Engine | ✅ PASS | Uses existing rendering pipeline |
| Memory Management | ✅ PASS | Follows existing chunk loading/unloading |

**GATE STATUS**: ✅ PASSED - Constitution Check passed, may proceed.

## Project Structure

### Documentation (this feature)

```text
specs/017-frozen-mountain/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - research findings and decisions
├── data-model.md        # Phase 1 output - data model and entities
├── quickstart.md        # Phase 1 output - quickstart guide
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created yet)
```

### Source Code (repository root)

```text
src/
├── workers/
│   ├── WorldWorker.js       # Modified: Import and integrate FrozenMountain
│   └── maps/
│       ├── Pyramid.js        # Reference: Existing map pattern
│       ├── SnowLand.js       # Reference: Existing snow biome map
│       └── FrozenMountain.js # NEW: Frozen mountain generation (to be created)
```

**Structure Decision**: Follows existing single-project structure. New map module added to `src/workers/maps/` alongside Pyramid.js and SnowLand.js. Integration in `WorldWorker.js` follows the exact same pattern as the other maps.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations - Constitution Check fully passed.

---

## Phase 0: Research & Decisions

**Completed**: research.md created with all key decisions documented.

### Key Decisions Summary

1. **API Pattern**: Follow Pyramid/SnowLand pattern
   - `getFrozenMountainInfo(wx, wz, seed, terrainGen)`
   - `generateFrozenMountain(wx, wz, h, fmInfo, fakeChunk, dPlaceholder)`

2. **Placement**: -160 X offset from Pyramid (opposite SnowLand), same 400x400 region

3. **Size**: 60x60 blocks base (larger than Pyramid's 40x40)

4. **Shape**: Conical with configurable steepness

5. **Caves**: Reuse WorldWorker's room logic, scoped to mountain

6. **Layers**: snow_grass → dirt (2-3) → stone → end_stone foundation

7. **Integration**: After SnowLand in WorldWorker priority chain

---

## Phase 1: Design & Contracts

**Completed**: data-model.md and quickstart.md created.

### Data Model

Key entities defined:
- `FrozenMountainInfo` - Info object returned by getFrozenMountainInfo()
- Block layer configuration - snow_grass → dirt → stone → end_stone
- Mountain cave room - 3D bounds for cave chambers
- Generation parameters - configurable constants

### Interface Contracts

N/A - This is an internal feature following existing internal APIs. The module will conform to the existing custom map interface already defined by Pyramid.js and SnowLand.js.

### Post-Design Constitution Check

Re-evaluating Constitution after design:

| Principle | Status | Notes |
|-----------|--------|-------|
| I. OO Design & Layering | ✅ PASS | Single-module implementation, clean separation |
| II. Memory Efficiency & GC | ✅ PASS | No new memory patterns introduced |
| III. Active Resource Release | ✅ PASS | No new GPU resources |
| IV. WebGL/Three.js Optimization | ✅ PASS | Uses existing instanced rendering |
| V. Simplicity & Core | ✅ PASS | Focused, minimal scope |
| VI. Resource Management | ✅ PASS | No new resources |

**GATE STATUS**: ✅ PASSED - Constitution remains satisfied after design.
