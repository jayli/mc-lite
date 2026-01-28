# Implementation Plan: Block-based Land Caves

**Branch**: `003-land-caves` | **Date**: 2026-01-28 | **Spec**: [specs/003-land-caves/spec.md](specs/003-land-caves/spec.md)
**Input**: Feature specification from `/specs/003-land-caves/spec.md`

## Summary

This plan implements large, rectangular contiguous land caves using a seed-based approach within the world generator. It also reinforces the world foundation with a solid 2-layer bedrock system, where the final layer is indestructible `end_stone`.

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (WebGL 2.0)
**Storage**: IndexedDB (for world modifications)
**Testing**: Manual deep-level exploration, bedrock mining verification.
**Target Platform**: Modern Web Browsers
**Project Type**: Single project
**Performance Goals**: Stabilize FPS by reducing total active voxel instances via larger hollow volumes.
**Constraints**: Absolute solid bottom layers (no "void leakage").

## Constitution Check

- **Principle I (Layering)**: PASS. Logic remains within `world` worker generation.
- **Principle IV (Performance)**: PASS. Large contiguous hollows are more efficient for instance management than sparse holes.
- **Principle V (Simplicity)**: PASS. Uses simple AABB seed checks rather than complex 3D noise for box shapes.

## Project Structure

### Documentation (this feature)

```text
specs/003-land-caves/
├── plan.md              # This file
├── research.md          # Implementation decisions
├── data-model.md        # Bedrock and Cave parameters
├── quickstart.md        # Verification guide
└── tasks.md             # Implementation tasks
```

### Source Code (repository root)

```text
src/
├── entities/
│   └── player/
│       └── Player.js           # Bedrock protection logic
└── world/
    └── WorldWorker.js          # Core cave generation logic
```

**Structure Decision**: Single project. Focus on `src/world/WorldWorker.js` for generation and `src/entities/player/Player.js` for mining interaction.

## Phase 1: Design & Contracts

### Data Model (`data-model.md`)
- **Cave Constants**: `ROOMS_PER_CHUNK` and `MAX_ROOM_SIZE`.
- **Bedrock Layer**: Strictly `end_stone` at `y = h - 12`.
- **Protection Layer**: Strictly solid at `y = h - 11`.

## Phase 2: Implementation Steps

### Step 1: Pre-calculation of Room Seeds in `WorldWorker.js`
- Generate `ROOMS_PER_CHUNK` random seeds per chunk.
- Each seed includes `cx, cy, cz` (center) and `w, h, d` (dimensions).

### Step 2: Update Terrestrial Generation Loop
- Update the loop from `k=2` to `12`.
- `k=12`: `end_stone`.
- `k=11`: Solid.
- `2 <= k <= 10`: Check if `(wx, h-k, wz)` is inside any room AABB. If yes, generate `air`.

### Step 3: Bedrock Protection in `Player.js`
- Ensure `end_stone` is correctly identified and mining is cancelled.
