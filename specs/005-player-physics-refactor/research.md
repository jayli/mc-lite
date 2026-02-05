# Research Findings: Player Physics and Collision Refactor

## Decision: Swept AABB with Slide Response
- **Rationale**: Pure voxel-based sampling is prone to tunneling at high speeds and jittery corners. A Swept AABB approach (or multi-point sampling along the movement vector) ensures zero tunneling and smooth sliding.
- **Alternatives considered**: 
  - Raycasting only: Too expensive for a full body box and fails at corners.
  - Simple discrete collision: Buggy at high FPS/low speed combinations.

## Decision: Two-Stage Vertical Navigation
- **Rationale**: Step-up logic needs to be predictive. We check if horizontal movement is blocked, then check if the blocking voxel can be stepped over.
- **Rules**:
  - Max step height: 1.0 (1 block).
  - Max jump step: 2.0 (2 blocks) if `velocity.y > 0`.

## Decision: Camera Bumper with Yaw-Aware Padding
- **Rationale**: To prevent near-plane clipping during rotation, we define a "camera width" (approx 0.3m). When rotating head near a wall, we use a separate collision check that pushes the *player* back slightly if the camera's theoretical edges hit a wall.
- **Implementation**: Check 3 points at head level: Center, Left (-Yaw direction), Right (+Yaw direction).

## Decision: Corridors & Corners
- **Rationale**: 
  - Convex corners: Apply a friction coefficient (speed * 0.7) when sliding around sharp corners.
  - Tunnels: Apply a centering force (lerp) towards the voxel center when movement is predominantly in one axis inside a narrow space.

## Decision: Entity Collision Interface
- **Rationale**: Current `isSolid` only checks voxels. We will extend `Physics.js` or `World.js` to query an `EntityCollider` registry.
- **Integration**: Special models (Rover, etc.) already place 'collider' blocks. We will ensure the physics system treats 'collider', 'leaves', and 'glass' as solid for player physics.

## Decision: Procedural Bobbing States
- **Rationale**: Bobbing should be a function of horizontal speed and state.
- **States**: 
  - RUNNING: Sine wave bobbing.
  - STEPPING/COLLIDING: Lerp bobbing intensity to 0.
  - AIRBORNE: Bobbing stopped.
