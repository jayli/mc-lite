# Feature Specification: FPS Optimization through Voxel Reduction

**Feature Branch**: `000-fps-optimization`
**Created**: 2026-01-28
**Status**: Draft
**Input**: User description: "我需要提升游戏运行的 fps，现在帧率在 macbook 上是 40 不到，我希望能提升到至少60以上。现在我发现瓶颈在于渲染方块的数量太多。我希望能适当的减少一些方块的数量，我有两个思路，第一是去掉正常的（非RealisticTree）的树（包括森林里的树和草地里的树）的树叶模块中不接触空气的树叶方块，第二是将海平面以下的沙块只留两层，第一层是沙块sand，里面第二层是end_stone，在海水里的end_stone是不可被挖的，这样海水区域的深部的方块都不用再渲染了，这样能减少一部分方块的数量。第三是陆地（沙地、苔藓地、草地、森林）的地图中内部（地表两层以下）可以随机40%比例左右（可以按照你的建议值）生成大量的空心区域，即地洞，这样也可以减少一定量的方块数量。总之用是哪个面几个方法减少一定量的方块数量，进而降低渲染压力，最后提高fps帧率。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Smooth Gameplay (Priority: P1)

As a player, I want to play the game with a high frame rate (at least 60 FPS) on my MacBook so that the experience is fluid and responsive.

**Why this priority**: Directly addresses the core user problem: poor performance (under 40 FPS).

**Independent Test**: Monitor the FPS counter in the HUD. Compare FPS before and after the optimization in similar areas (e.g., dense forest or ocean).

**Acceptance Scenarios**:

1. **Given** a player is in a dense forest, **When** the voxel reduction logic is active, **Then** the FPS should consistently stay above 60.
2. **Given** a player is near the ocean, **When** the voxel reduction logic is active, **Then** the deep underwater blocks should not be generated/rendered, improving performance.

---

### User Story 2 - Visual Integrity (Priority: P2)

As a player, I want the optimizations to be invisible so that the game still looks "full" and natural despite having fewer internal blocks.

**Why this priority**: Essential to ensure that "performance at any cost" doesn't ruin the game's aesthetics.

**Independent Test**: Fly through leaves and dive underwater to verify that no visible gaps or "missing textures" are apparent from normal viewpoints.

**Acceptance Scenarios**:

1. **Given** a standard tree, **When** looking at its canopy from any external angle, **Then** it must appear full and opaque (no "see-through" holes due to missing internal leaves).
2. **Given** a seabed, **When** looking through the water, **Then** the floor must look like a solid layer of sand.

---

### User Story 3 - Mining Restrictions (Priority: P3)

As a player, I want the underlying "unbreakable" blocks (end_stone) to prevent me from falling through the world where blocks have been removed for optimization.

**Why this priority**: Prevents game-breaking bugs where players might dig into "nothingness" in optimized zones.

**Independent Test**: Attempt to mine `end_stone` blocks located beneath the 2-layer seabed.

**Acceptance Scenarios**:

1. **Given** a player is mining underwater, **When** they reach the `end_stone` layer, **Then** the block should be indestructible.

---

### Edge Cases

- **Transparency and Leaves**: If leaves are semi-transparent, removing internal blocks might be visible.
- **Cave Discovery**: If a player digs into a "hollow" area generated for optimization, ensure the transition doesn't look like a glitch.
- **Seed Consistency**: Ensure optimizations are deterministic based on the world seed so that reloading the area doesn't change the block distribution.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Leaf Pruning)**: For non-RealisticTree trees, the system MUST only generate/render leaf blocks that are adjacent to at least one "air" or "transparent" block. Internal leaf blocks surrounded entirely by other leaves or wood MUST be omitted.
- **FR-002 (Seabed Optimization)**: Below sea level in oceanic biomes, the system MUST generate only two layers of terrain: a top layer of `sand` and a second layer of `end_stone`.
- **FR-003 (Indestructible Foundation)**: Blocks of `end_stone` generated as part of the seabed optimization MUST be non-destructible by the player.
- **FR-004 (Deep Terrain Removal)**: All voxels below the `end_stone` layer in oceanic biomes MUST be omitted from generation and rendering.
- **FR-005 (Inland Hollow Regions)**: In terrestrial biomes (sand, moss, grass, forest), starting from 2 layers below the surface, the system MUST generate "air" voxels with a randomized distribution of approximately 40% to create internal hollows/caves.
- **FR-006 (Performance Target)**: The cumulative effect of these reductions MUST aim to reduce the total active voxel count by at least 30% in high-density areas.

### Key Entities

- **Voxel/Block**: The fundamental unit of the world.
- **Tree (Normal)**: Specifically the simple tree structures (distinguished from `RealisticTree`).
- **Seabed**: The terrain layers specifically located under water bodies.
- **Hollow Zone**: The internal volume of landmasses where block density is reduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Average FPS on a MacBook Air/Pro (M1 or later) in a forest biome increases from ~40 to 60+.
- **SC-002**: Total draw call count or instance count for `InstancedMesh` (voxels) decreases by at least 25% in a typical loaded world chunk.
- **SC-003**: 100% of internal leaf blocks (those with no air neighbors) are successfully pruned from simple trees.
- **SC-004**: Zero visual artifacts (holes in terrain/trees) reported during standard exploration (walking/flying on surface).

## Assumptions

- **A-001**: The "Normal" trees use a predictable box or sphere-like leaf structure where "inner" vs "outer" blocks can be mathematically or logically determined.
- **A-002**: `end_stone` is a suitable block type for the "unbreakable" floor and its use doesn't conflict with other gameplay mechanics (like the End dimension, if it exists).
- **A-003**: The game engine's `InstancedMesh` performance bottleneck is indeed the number of instances/voxels being managed, not just the shader complexity.

## Clarifications

### Session 2026-01-28
- Q: 对于陆地内部生成的空心区域（地洞），您确定的随机比例是多少？ → A: 40% (Recommended)
- Q: 在“去掉不接触空气的树叶方块”逻辑中，“空气”的具体定义是什么？是否包括透明方块（如水、玻璃、云）？ → A: 'air' only (Recommended)
- Q: 如果通过其他非挖掘手段（如未来的爆炸或其他机制）破坏了 `end_stone`，它是否应该掉落物品？ → A: No Drop (Recommended)
- **Update**: 矿洞（空心区域）改为基于噪声生成，以实现更大面积的连续感，而非完全离散的随机点。
