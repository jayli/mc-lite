# Implementation Plan: Player Physics and Collision Refactor

**Feature Branch**: `005-player-physics-refactor`
**Created**: 2026-02-05
**Status**: Planning

## Technical Context

### Existing Systems
- **Player.js**: Main loop and input handling. Currently contains some inline collision logic.
- **Physics.js**: Utility class for gravity and basic point-collision.
- **World.js**: Provides `isSolid(x, y, z)` for voxel checking. Treat 'leaves', 'glass_block', 'collider' as solid for player.

### Dependencies
- **Three.js**: Used for Vector math and camera transformation.

### Unknowns & Risks
- **Special Entity Querying**: Need to ensure `isSolid` or a new method correctly accounts for entities like the Rover. *Decision: Use 'collider' blocks placed by entities as the primary mechanism.*

## Constitution Check

- **Principle I (OO Design)**: Refactor will move collision logic into `Physics.js` or a dedicated `MovementProcessor`.
- **Principle II (Memory Efficiency)**: Avoid creating `Vector3` instances in the `update` loop. Reuse class-level variables.
- **Principle IV (Performance)**: Optimize `isSolid` calls by checking local neighborhood.

## Phase 0: Research (Completed)
- See [research.md](./research.md) for architectural decisions.

## Phase 1: Design (Completed)
- Data model defined in [data-model.md](./data-model.md).
- Voxel solidity map updated to include glass and leaves.

## Phase 2: Implementation Steps

### Task 1: Core Physics Refactor
- Implement `Swept AABB` or multi-point sampling in `Physics.js`.
- Replace discrete position updates with velocity-based integration.
- Implement sliding collision response.

### Task 2: Vertical Navigation (Step-up/down)
- Implement predictive step-up logic for 1-block height.
- Integrate jump-height check for 2-block step-up.
- Ensure smooth Y-axis interpolation during steps.

### Task 3: Camera Width & Clipping Prevention
- Implement the "Camera Bumper" logic with head-rotation awareness.
- Verify 360-degree rotation near walls does not cause clipping.

### Task 4: Corridor & Corner Polishing
- Implement the auto-centering logic for 1-block wide tunnels.
- Add friction to convex corner sliding.

### Task 5: Visuals & Bobbing
- Overhaul `updateCameraBob` to use lerped intensity based on state.
- Ensure bobbing stops during collision or stepping.

### Task 6: Safety & Recovery
- Implement "Push-out" logic for deep clipping scenarios.
- Add frame-rate independence (dt handling).
