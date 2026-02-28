# Feature Specification: Frozen Mountain Custom Map

**Feature Branch**: `017-frozen-mountain`
**Created**: 2026-02-28
**Status**: Draft
**Input**: User description: "我希望新增一个冰封山峰的Custom Map，是一个中间有山洞的高峰，山峰的顶部是snow_grass方块，每个snow_grass 下面有2~3个dirt方块，再往下是stone岩石方块。这个map可以比Pyramid更大一些，挨着 snow_land 的地图（map）很近，山峰是高耸的形态，山的边可以很陡，也可以不陡，但是要有山洞，凸显神秘感。"

## User Scenarios & Testing (mandatory)

### User Story 1 - Tall Frozen Peak (Priority: P1)

As a player, I want to explore a tall, imposing frozen mountain peak so that I can experience the grandeur of the icy landscape.

**Why this priority**: The mountain peak is the core visual feature of the map - without a tall peak, the map wouldn't feel like a "frozen mountain".

**Independent Test**: Travel to the frozen mountain region. Verify that a tall, elevated peak structure exists with snow_grass on top.

**Acceptance Scenarios**:

1. **Given** the frozen mountain region, **When** approaching the center, **Then** a tall, elevated peak structure MUST be visible.
2. **Given** the mountain surface, **When** examining the top layer, **Then** every surface block MUST be `snow_grass`.
3. **Given** the snow_grass layer, **When** digging down 2-3 blocks, **Then** `dirt` blocks MUST be encountered.
4. **Given** the dirt layer, **When** digging deeper, **Then** `stone` blocks MUST form the majority of the mountain's interior.

---

### User Story 2 - Mysterious Mountain Caves (Priority: P1)

As a player, I want to discover and explore mysterious caves inside the frozen mountain so that the mountain feels intriguing and worth exploring.

**Why this priority**: Caves are explicitly requested in the requirements and add the "mystery" element that makes the mountain more than just a pile of blocks.

**Independent Test**: Enter the frozen mountain (either by digging or finding a natural entrance). Verify that large, continuous cave spaces exist inside.

**Acceptance Scenarios**:

1. **Given** the frozen mountain interior, **When** exploring underground, **Then** large, contiguous cave systems (air clusters) MUST exist.
2. **Given** the cave system, **When** exploring, **Then** the caves MUST feel substantial enough to create a sense of mystery.

---

### User Story 3 - Proximity to Snow Land (Priority: P2)

As a player, I want the frozen mountain to be located near the snow_land map so that I can easily travel between these related icy biomes.

**Why this priority**: Establishes geographic coherence between similar biomes, enhancing world believability.

**Independent Test**: Locate a snow_land region. Verify that a frozen mountain exists nearby.

**Acceptance Scenarios**:

1. **Given** a snow_land region, **When** exploring the surrounding area, **Then** a frozen mountain MUST appear in close proximity.
2. **Given** the frozen mountain, **When** compared to Pyramid, **Then** the mountain MUST be visibly larger in scale.

---

### Edge Cases

- **Overlap with Other Maps**: What happens if the frozen mountain generation overlaps with Pyramid or other structures? (Assumption: Maps should maintain clear spatial separation).
- **Sea Level Intersection**: How should the mountain generate if its base intersects with water? (Assumption: Mountain should generate above water level).
- **Performance Impact**: Larger structure with caves must not cause significant FPS drops or chunk loading delays.

## Requirements (mandatory)

### Functional Requirements

- **FR-001 (Tall Peak Structure)**: The frozen mountain MUST generate as a tall, elevated peak structure rising above the surrounding terrain.
- **FR-002 (Layered Block Composition)**: The mountain block layers MUST follow this exact composition from top to bottom:
  - **Top layer**: `snow_grass` (exposed surface)
  - **Sub-surface**: 2-3 layers of `dirt`
  - **Main body**: `stone` for the majority of the mountain's volume
- **FR-003 (Interior Cave System)**: The mountain interior MUST contain large, continuous cave systems (air block clusters) to create mystery.
- **FR-004 (Proximity to Snow Land)**: The frozen mountain MUST generate in close proximity to `snow_land` regions.
- **FR-005 (Scale Larger Than Pyramid)**: The frozen mountain MUST be visibly larger in overall scale than the Pyramid structure.
- **FR-006 (Compatibility)**: The frozen mountain generation MUST NOT break existing gameplay features or interfere with other map generation.

### Key Entities

- **Frozen Mountain Peak**: The central elevated structure with snow_grass surface.
- **Mountain Cave System**: Large, contiguous air spaces inside the mountain for exploration.
- **Map Region**: The geographic area where the frozen mountain generates, near snow_land.

## Success Criteria (mandatory)

### Measurable Outcomes

- **SC-001**: Players can clearly identify the frozen mountain from a distance due to its tall, elevated profile.
- **SC-002**: 100% of surface blocks on the mountain are `snow_grass`.
- **SC-003**: Digging down from the surface reveals 2-3 `dirt` layers followed by `stone` in 100% of test locations.
- **SC-004**: Large cave systems are discoverable inside the mountain when exploring.
- **SC-005**: The frozen mountain appears within reasonable travel distance from every snow_land region.
- **SC-006**: The frozen mountain's overall footprint is visibly larger than Pyramid when viewed from above.
- **SC-007**: No significant FPS degradation when exploring or viewing the frozen mountain region.

## Assumptions

- **A-001**: "Near snow_land" means within the same 400x400 region generation zone as snow_land.
- **A-002**: "Larger than Pyramid" means exceeding Pyramid's 40-block base size.
- **A-003**: Cave system implementation can reuse or adapt the existing cave generation logic from land biomes.
- **A-004**: The mountain will use the same region-based placement pattern as Pyramid and SnowLand.
- **A-005**: No additional block types need to be created - existing `snow_grass`, `dirt`, and `stone` are sufficient.
