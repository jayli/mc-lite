# Implementation Plan: Add Bed Entity

**Branch**: `025-add-bed` | **Date**: 2026-03-19 | **Spec**: [specs/025-add-bed/spec.md](spec.md)
**Input**: Feature specification from `/specs/025-add-bed/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

This feature adds a bed entity to the Minecraft-like voxel game. The bed consists of two adjacent blocks (headboard and footboard), each with a height of 0.5 blocks. The implementation follows the same interception pattern as the turret entity - when a player places a `bed_alias_block`, the system intercepts it and instead places a multi-block bed structure with proper texture mapping.

Technical approach:
1. Define new block types (`bed_head`, `bed_tail`) in BlockData.js with half-height geometry
2. Create multi-face materials in MaterialManager.js for proper texture mapping
3. Implement bed.json structure definition for the entity system
4. Add placement interception logic in PlayerInteraction.js (similar to `tryPlaceTurret`)
5. Register bed in inventory with proper icon

## Technical Context

**Language/Version**: JavaScript (ES2020+), Three.js r160
**Primary Dependencies**: Three.js for 3D rendering, Custom voxel engine
**Storage**: In-memory world data with chunk-based storage, no persistence for beds
**Testing**: Manual testing via game client at http://localhost:8080/src/tests/
**Target Platform**: Modern web browsers with WebGL 2.0 support
**Project Type**: Voxel game (Minecraft clone) - Browser-based 3D game
**Performance Goals**: 60 FPS with <16ms frame time, maintain during bed placement
**Constraints**:
- Memory: Minimal GC pressure, reuse geometries/materials
- Rendering: Use InstancedMesh for efficient batch rendering
- Half-height blocks require custom geometry handling
**Scale/Scope**: Single bed type initially, decorative purpose only (no sleep mechanics)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Gates (from Minecraft-lite Constitution v1.1.0)

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. OO Design & Layering** | ✅ PASS | Block definitions separate from rendering logic; placement logic in PlayerInteraction |
| **II. Memory Efficiency & GC** | ✅ PASS | Bed uses existing InstancedMesh system; no per-frame object creation |
| **III. Proactive Resource Release** | ✅ PASS | Bed blocks follow standard chunk lifecycle; auto-destroyed when out of view distance |
| **IV. WebGL/Three.js Performance** | ✅ PASS | Two blocks use existing instancing; textures preloaded |
| **V. Simplicity & Core** | ✅ PASS | Decorative bed only; no complex mechanics like sleeping |
| **VI. Resource Management** | ✅ PASS | Bed textures already in src/assets/textures/bed/ directory |

### Design Decisions Aligned with Constitution

1. **Block-based entity**: Bed uses two standard blocks rather than custom mesh to leverage existing rendering pipeline (InstancedMesh optimization)
2. **Texture reuse**: Uses existing texture files from minecraft-bundles (already copied to src/)
3. **No persistent state**: Bed is purely visual; no save/restore logic needed
4. **Half-height geometry**: Custom geometry type for 0.5 height to maintain consistent collision and rendering

## Project Structure

### Documentation (this feature)

```text
specs/025-add-bed/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (design decisions)
├── data-model.md        # Phase 1 output (entity structure)
├── quickstart.md        # Phase 1 output (manual testing guide)
├── contracts/           # N/A - no external interfaces
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── constants/
│   └── BlockData.js          # Add bed_head, bed_tail block definitions
├── core/
│   ├── MaterialManager.js    # Add bed material registrations
│   └── Game.js               # Add bed to default inventory
├── actors/player/
│   └── PlayerInteraction.js  # Add tryPlaceBed() method
├── world/
│   ├── structures/
│   │   └── bed.json          # Bed entity structure definition
│   └── entity-system/
│       └── StructureLoader.js # May need bed loader registration
└── assets/
    └── textures/
        └── bed/              # Existing texture files
            ├── Bed_(back_texture)_JE2_BE2.png
            ├── Bed_(front_texture)_JE2_BE2.png
            ├── Bed_(top_texture)_JE1_BE1.png
            ├── Bed_(bottom_texture)_JE1_BE1.png
            ├── Bed_(top_side_texture)_JE2_BE2.png
            └── Bed_(bottom_side_texture)_JE2_BE2.png
```

**Structure Decision**: Single project structure following existing conventions. Bed implemented as JSON entity similar to turret, with block definitions and materials registered in their respective systems.

## Complexity Tracking

> No constitution violations; standard implementation pattern following turret precedent.

| Component | Complexity | Justification |
|-----------|------------|---------------|
| Block definitions | Low | Standard BlockData.js entries with custom geometryType |
| Materials | Medium | Multi-face materials for proper texture mapping on each face |
| Placement logic | Low | Clone of tryPlaceTurret pattern, adapted for 2-block horizontal layout |
| JSON entity | Low | Simple 2-block structure similar to existing entities |

## Phase 0: Research & Design Decisions

*Completed - see research.md for details*

Key decisions:
1. **Geometry approach**: Use `geometryType: 'half_block'` to indicate 0.5 height for both bed_head and bed_tail
2. **Texture mapping**: Each face uses specific texture file; connection face uses transparent material
3. **Placement validation**: Check both blocks are available, player not colliding, valid ground beneath
4. **Orientation**: Headboard faces player (opposite of player look direction), footboard extends behind

## Phase 1: Data Model & Contracts

*Completed - see data-model.md for entity structure*

Key entities:
- **bed_head**: Headboard block, half-height, textured on 5 faces (front, sides, top; bottom transparent; back invisible)
- **bed_tail**: Footboard block, half-height, textured on 5 faces (back, sides, top; bottom transparent; front invisible)
- **bed.json**: Structure defining relative positions of head and tail blocks

## Next Steps

1. Run `/speckit.tasks` to generate implementation tasks
2. Implement following task order
3. Test via game client

