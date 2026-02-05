# Feature Specification: Player Physics and Collision Refactor

**Feature Branch**: `005-player-physics-refactor`
**Created**: 2026-02-05
**Status**: Draft
**Input**: User description: "现在代码中的碰撞检测、上下台阶的逻辑bug较多，且fps不是最优，我希望你给我出一个更简洁，更健壮且性能更好的方案完全替换掉现有的方案。碰撞检测的要求是不要穿模。玩家的身体是包裹在1x1x2个方块的空间内。你的重构时要考虑这几个场景：1. 上下台阶的平滑、准确和流畅。玩家只能上一级台阶，跳跃时可以上两级台阶。2. 发生碰撞时不要让镜头穿模，考虑到镜头有一个宽度，碰撞发生后，如果静止时，左右转动镜头不要误发生镜头的穿模 3. 如果斜向跑向一个垂直的墙角凸角，也要考虑防碰撞。斜向行走跟墙角凸角碰撞后，需要进入贴墙滑动，滑动速度适度减慢。4. 蹭墙前进和后退，确保流畅不穿模 5. 坑道（玩家在一个一格宽的坑道内）内前进或后退时，缓动到坑道中心位置。6. 跳跃时遇到头顶有实心方块的时候，阻挡跳跃，给一个微小的上跳被阻挡动作即可。7. 作为兜底逻辑，如果万一发生穿模，则只能让玩家“穿出”，不能让玩家更加“穿入方块更深”。防止用户粘连到方块上。8. 对于rovar、gun_man 和 RealisticTree、烟囱 这类特殊模型有透明碰撞方块包裹，透明防碰撞方块也需要参与碰撞检测。9. 半脸碰撞，当玩家沿着一层台阶紧贴边缘且蹭着边缘前进时，当台阶二层有方块时，防止因为镜头有一个宽度导致错误的穿模。10. 树叶、玻璃作为实心方块，也要参与碰撞检测。11. 镜头晃动模拟用户跑动效果，静止后就停止晃动，发生碰撞时停止晃动。上下台阶的过程中停止晃动，其他场景满速跑动时要有镜头晃动的特效。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Robust Movement and Collision (Priority: P1)

As a player, I want to move around the world without getting stuck or clipping through solid blocks (including glass and leaves), so that the gameplay feels professional and immersive.

**Why this priority**: Core movement is the most fundamental mechanic of the game. If it fails, the game is unplayable.

**Independent Test**: Can be tested by walking against various block types (stone, glass, leaves) at different angles and ensuring the player is stopped correctly without visual jitter or clipping.

**Acceptance Scenarios**:

1. **Given** a solid wall, **When** the player walks directly into it, **Then** the player stops at the boundary and the camera does not penetrate the wall.
2. **Given** a solid wall, **When** the player slides along it at an angle, **Then** movement is smooth and follows the wall surface.
3. **Given** a convex corner, **When** walking diagonally into the corner, **Then** the player slides around it smoothly with a slight speed reduction.
4. **Given** a 1x1 tunnel, **When** moving through it, **Then** the player is gently centered and does not clip through the side walls.

---

### User Story 2 - Smooth Vertical Navigation (Priority: P2)

As a player, I want to step up and down single-block elevation changes smoothly without needing to jump, and be able to jump over two-block heights, so that navigating the terrain is fluid.

**Why this priority**: Minecraft-style navigation relies heavily on "step-up" logic. Manual jumping for every block is tedious.

**Independent Test**: Can be tested by walking towards a 1-block high ledge and ensuring the player moves onto it smoothly, and jumping at a 2-block high ledge to clear it.

**Acceptance Scenarios**:

1. **Given** a 1-block height difference, **When** walking forward, **Then** the player ascends the block smoothly without a jarring transition.
2. **Given** a 2-block height difference, **When** jumping while moving forward, **Then** the player clears the obstacle.
3. **Given** a 1-block drop, **When** walking off the edge, **Then** the player steps down smoothly (if the drop is only 1 block).
4. **Given** a low ceiling, **When** jumping, **Then** the jump is cut short with a subtle "bump" animation and the player does not clip into the ceiling.

---

### User Story 3 - Immersive Visuals and Camera Behavior (Priority: P3)

As a player, I want the camera to bob while I run and behave correctly during collisions (including rotation at walls), so that I feel connected to my character's physical presence.

**Why this priority**: Improves game feel and "juice," making the world feel more solid and the character more alive.

**Independent Test**: Can be tested by running in open areas to see bobbing, and standing against a wall while rotating the camera to ensure no clipping occurs.

**Acceptance Scenarios**:

1. **Given** the player is running on flat ground, **When** not colliding with anything, **Then** the camera exhibits a rhythmic bobbing effect.
2. **Given** the player is standing still, **When** rotating the camera near a wall, **Then** the camera width is respected and no clipping occurs.
3. **Given** the player starts climbing a step or hits a wall, **When** moving, **Then** camera bobbing pauses to maintain visual clarity during the transition/collision.

---

### User Story 4 - Special Entity Interactivity (Priority: P4)

As a player, I want to interact with complex objects (Rovers, Gun-men, Trees) and have them behave as physical obstacles, so that the world feels consistent.

**Why this priority**: Essential for world consistency; special models shouldn't be "ghosts."

**Independent Test**: Walk into a RealisticTree or Rover and ensure collision occurs at the defined bounding boxes.

**Acceptance Scenarios**:

1. **Given** a RealisticTree or Rover, **When** the player attempts to walk through its invisible collision box, **Then** movement is blocked as if it were a solid block.

---

### Edge Cases

- **"Half-face" collision**: When sliding along the very edge of a ledge with a block at the head level in the next column, ensure the camera width doesn't cause a false collision.
- **Deep Clipping Recovery**: If the player somehow ends up inside a block (e.g., due to a teleport or world generation change), the system must push them out to the nearest open space rather than pulling them deeper.
- **Corner Jitter**: Rapidly changing between sliding along two perpendicular walls in a corner.
- **High FPS/Low FPS**: Physics must remain consistent regardless of the frame rate (frame-rate independent physics).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST treat player as a 0.6x1.8x0.6 (approx) axis-aligned bounding box (AABB) within a 1x2x1 block space.
- **FR-002**: System MUST implement "step-up" logic for 1-block height differences during horizontal movement.
- **FR-003**: System MUST allow 2-block "step-up" ONLY during an active jump.
- **FR-004**: System MUST perform sweep-tests or multi-point sampling to prevent "tunneling" (passing through walls at high speeds).
- **FR-005**: System MUST implement sliding collision response for all solid blocks, including transparent ones like glass and leaves.
- **FR-006**: System MUST respect a "camera width" buffer to prevent near-plane clipping when the player rotates their head near a wall.
- **FR-007**: System MUST query the world for both voxel-based blocks and special entity collision boxes (Rover, Gun-man, etc.).
- **FR-008**: System MUST implement a "push-out" recovery logic that always moves the player toward the shortest path to an empty voxel if stuck.
- **FR-009**: System MUST provide a procedural camera bobbing effect that scales with movement speed and disables during steps or collisions.
- **FR-010**: System MUST implement auto-centering logic when the player is moving through a narrow (1-block wide) corridor.

### Key Entities *(include if feature involves data)*

- **PlayerAABB**: Represents the physical bounds of the player (width, height, depth).
- **CollisionResult**: Data structure containing collision state (occurred, normal, depth, step-up eligible).
- **WorldCollider**: Interface to query block and entity solidity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero reported instances of "stuck in wall" or "falling through floor" during standard traversal tests.
- **SC-002**: Movement logic maintains 60+ FPS on target hardware by optimizing spatial queries (e.g., caching local block states).
- **SC-003**: 100% success rate for 1-block auto-stepping during forward movement on uneven terrain.
- **SC-004**: No visual "see-through-world" artifacts when the camera is rotated 360 degrees while the player is flush against a corner.
- **SC-005**: Camera bobbing transitions smoothly (lerp) between active and inactive states in under 200ms.

## Assumptions

- We assume the `Physics.js` and `World.js` provide a reliable way to check if a voxel (x, y, z) is solid.
- We assume the special entities (Rover, etc.) expose their collision bounds in a way that can be queried by the physics system.
- Frame-rate independence will be handled using a fixed time-step or `delta` time.
