# Implementation Plan: FPS Optimization through Voxel Reduction

**Branch**: `001-fps-optimization` | **Date**: 2026-01-28 | **Spec**: [specs/001-fps-optimization/spec.md](specs/001-fps-optimization/spec.md)
**Input**: Feature specification from `/specs/001-fps-optimization/spec.md`

## Summary

This plan optimizes the game's performance by reducing the number of blocks generated and rendered in three specific areas:
1. **Tree Leaves**: Removing internal leaf blocks that are not visible.
2. **Seabed**: Simplifying underwater terrain to 2 layers (sand + indestructible end_stone).
3. **Underground**: Generating 40% air pockets (caves) in deep terrestrial terrain.

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (WebGL 2.0)
**Storage**: IndexedDB (Persistence for modifications)
**Testing**: Manual FPS observation via HUD, voxel count verification.
**Target Platform**: Modern Web Browsers
**Project Type**: Single project
**Performance Goals**: Stable 60+ FPS on MacBook.
**Constraints**: Visual fidelity must be preserved from the surface.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Layering)**: PASS. Changes are confined to the world generation and player interaction layers.
- **Principle IV (Optimization)**: PASS. Directly addresses `InstancedMesh` performance.
- **Principle V (Simplicity)**: PASS. Avoids complex algorithms in favor of direct geometric/probabilistic checks.

## Project Structure

### Documentation (this feature)

```text
specs/001-fps-optimization/
├── plan.md              # This file
├── research.md          # Technical analysis
├── data-model.md        # Voxel layout changes
├── quickstart.md        # Verification guide
└── tasks.md             # Implementation tasks
```

### Source Code (repository root)

```text
src/
├── entities/
│   └── player/
│       └── Player.js           # Mining restrictions
└── world/
    ├── WorldWorker.js          # Hollows and Seabed generation
    └── entities/
        └── Tree.js             # Leaf pruning logic
```

**Structure Decision**: Standard single project structure. Focus on `src/world/` for reduction logic and `src/entities/player/` for mining logic.

## Phase 1: Design & Contracts

### Data Model (`data-model.md`)
- **Block types**: Uses existing `sand` and `end_stone`.
- **Seabed mapping**: Column height `h < -2` triggers ocean optimization.

### Contracts
- No changes to public API or cross-module contracts.

## Phase 2: Implementation Steps

### Step 1: Leaf Pruning Logic in `Tree.js`
- Create a local 3D grid in `Tree.generate` to pre-calculate block placement.
- Implement neighbor-check (6 directions) to skip "buried" leaf blocks.
- Apply to `default`, `skyTree`, `big`, and `azalea` tree types.

### Step 2: Seabed Optimization in `WorldWorker.js`
- Modify `if (h < wLvl)` block.
- Place `sand` at `y=h`.
- Place `end_stone` at `y=h-1`.
- Ensure no blocks are added below `h-1`.

### Step 3: Inland Hollows in `WorldWorker.js`
- 引入 `noise(wx + 500, wz + 500, 0.03)` 来确定大面积连续的“矿洞列”。
- 在矿洞列中提高空气生成概率（70%），非矿洞列保留低概率随机空气（10%），使整体空心率维持在 ~40% 左右。

### Step 4: Mining Restrictions in `Player.js`
- Modify `Player.removeBlock`.
- Add guard: `if (type === 'end_stone') return;`.
- Ensure `end_stone` is indestructible regardless of how it's hit.
