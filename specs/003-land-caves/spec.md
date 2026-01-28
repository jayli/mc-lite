# Feature Specification: Block-based Land Caves and Indestructible Foundation

**Feature Branch**: `003-land-caves`
**Created**: 2026-01-28
**Status**: Draft
**Input**: User description: "陆地矿洞实现为成块的空洞，而不是零散的空缺，空间数量和大小分别用两个参数来控制，另外陆地地底最下面两层不能有空缺的方块，以免“镂空”，陆地的最下面的一层用end_stone，陆地最下面一层的end_stone不可被挖掘。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Large Scale Caves (Priority: P1)

As a player, I want to explore large, continuous cave systems rather than small random holes so that mining feels more adventurous and rewarding.

**Why this priority**: Directly addresses the primary requirement for "block-based hollows" instead of "scattered vacancies".

**Independent Test**: Fly or dig underground in a terrestrial biome. Verify that empty spaces are grouped into large "rooms" or "tunnels".

**Acceptance Scenarios**:

1. **Given** a terrestrial biome, **When** cave generation is active, **Then** empty voxels MUST form contiguous clusters (caves) rather than single isolated blocks.
2. **Given** global cave parameters, **When** adjusting the "Cave Count" and "Cave Size" constants, **Then** the generated world MUST reflect these changes deterministically.

---

### User Story 2 - Solid Foundation (Priority: P2)

As a player, I want the bottom of the world to be solid and unbreakable so that I don't accidentally fall out of the map while mining deep underground.

**Why this priority**: Essential for game stability and preventing "void falling" bugs caused by the new hollow generation.

**Independent Test**: Dig to the very bottom of a terrestrial biome. Verify that the last two layers are 100% solid and the final layer is `end_stone`.

**Acceptance Scenarios**:

1. **Given** the bottom 2 layers of terrestrial terrain, **When** the chunk is generated, **Then** 0% of blocks in these layers MUST be "air" (hollow).
2. **Given** the bottom-most layer of terrestrial terrain, **When** generated, **Then** every block MUST be `end_stone`.
3. **Given** an `end_stone` block at the bottom layer, **When** a player attempts to mine it, **Then** the block MUST NOT break.

---

### Edge Cases

- **Ocean vs Land**: Ensure this logic applies correctly to land biomes and doesn't conflict with existing ocean seabed optimizations (if they share common code).
- **Structure Intersection**: What happens if a cave intersects with a generated house or structure? (Assumption: Caves are generated first, or structures overwrite caves).
- **Performance**: Large hollows significantly reduce voxel count, which is good for FPS, but the generation algorithm must be efficient enough to not cause "chunk loading lag".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Clustered Hollows)**: Land caves MUST be generated as clusters of "air" blocks rather than independent random omissions.
- **FR-002 (Parametric Control)**: The system MUST provide two distinct parameters:
  - **CAVE_COUNT**: Controls the number of cave "seeds" per unit area.
  - **CAVE_SIZE**: Controls the radius or volume of each individual cave cluster.
- **FR-003 (Solid Sub-Floor)**: The bottom 2 layers of terrestrial terrain MUST be exempt from the hollow generation logic (must be 100% solid).
- **FR-004 (End Stone Bedrock)**: The absolute bottom layer of terrestrial terrain MUST consist entirely of `end_stone`.
- **FR-005 (Bedrock Invulnerability)**: `end_stone` blocks located at the world's bottom layer MUST be indestructible (mining prohibited).
- **FR-006 (Compatibility)**: This new logic MUST NOT break existing gameplay features or the previous optimization logic (like leaf pruning).

## Clarifications

### Session 2026-01-28
- Q: 您希望如何控制空间数量和大小参数？ → A: Local Constants (Recommended)
- Q: 陆地最下面的一层使用 `end_stone`，应用范围？ → A: Only Bottom Layer (Recommended)
- Q: “实现为成块的空洞”具体倾向于哪种形态？ → A: Rectangular Blocks

### Key Entities

- **Cave Seed**: A point in 3D space used as the center of a cave cluster.
- **Bedrock**: The bottom layer(s) of the world, specifically the final `end_stone` layer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Voxel count in deep terrestrial layers is reduced by at least 30% on average compared to a 100% solid world.
- **SC-002**: 100% success rate in preventing players from mining the bottom-layer `end_stone`.
- **SC-003**: Zero "holes" detected in the bottom 2 layers across 100 randomly sampled chunks.
- **SC-004**: Cave cluster volume is visibly affected by adjusting the `CAVE_SIZE` parameter.

## Assumptions

- **A-001**: "Terrestrial subsurface" refers to all land biomes (Plains, Forest, etc.) below the first few surface layers.
- **A-002**: The 3D noise or sphere-based seed approach is suitable for generating "clustered" hollows.
- **A-003**: `end_stone` is the designated material for bedrock.
