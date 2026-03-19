# Feature Specification: Add Bed Entity

**Feature Branch**: `025-add-bed`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "新增床的模型，床的模型占两个并排宽的方块，高度是0.5，两个方块组成一个床bed的模型。床头 bed_head 方块和床尾 bed_tail 方块。床头侧面：Bed_(top_side_texture)_JE2_BE2.png，床头上面：Bed_(top_texture)_JE1_BE1.png，床头前面：Bed_(back_texture)_JE2_BE2.png。床尾后面：Bed_(front_texture)_JE2_BE2.png，床尾上面：Bed_(bottom_texture)_JE1_BE1.png，床尾侧面：Bed_(bottom_side_texture)_JE2_BE2.png。参照 turret.json 实现 bed.json 实体。放置逻辑与 turret 一致（方块拦截方式）。背包图标使用 Bed_(front_texture)_JE2_BE2.png。"

## Overview

This feature adds a bed entity to the game that occupies two adjacent blocks side by side. The bed consists of two parts: a headboard (bed_head) and a footboard (bed_tail), each with a height of 0.5 blocks. The bed is implemented as a JSON entity similar to the turret, using block placement interception logic.

## User Scenarios & Testing

### User Story 1 - Place Bed in World (Priority: P1)

As a player, I want to place a bed in the game world so that I can use it as a decorative or functional block.

**Why this priority**: Core functionality - without the ability to place beds, the feature has no value.

**Independent Test**: Can be fully tested by selecting the bed item in inventory and placing it in the world. The bed should appear as a 2-block wide structure with correct textures.

**Acceptance Scenarios**:

1. **Given** the player has a bed item in inventory, **When** the player places the bed on a valid surface, **Then** a 2-block wide bed entity is created with headboard facing the player
2. **Given** the player attempts to place a bed, **When** there is insufficient space (second block occupied), **Then** the placement is prevented and no bed is created
3. **Given** a bed is placed, **When** viewing from different angles, **Then** all visible faces display correct textures (headboard: back/side/top, footboard: front/side/top)

---

### User Story 2 - Visual Appearance (Priority: P2)

As a player, I want the bed to have correct textures on all visible faces so that it looks visually appealing and recognizable.

**Why this priority**: Important for user experience but secondary to basic placement functionality.

**Independent Test**: Can be tested by placing a bed and verifying texture mapping on each face. The headboard front, headboard sides, headboard top, footboard back, footboard sides, and footboard top should all have distinct, correct textures.

**Acceptance Scenarios**:

1. **Given** a bed is placed in the world, **When** viewing the headboard front face, **Then** it displays Bed_(back_texture)_JE2_BE2.png
2. **Given** a bed is placed in the world, **When** viewing the headboard side faces, **Then** they display Bed_(top_side_texture)_JE2_BE2.png
3. **Given** a bed is placed in the world, **When** viewing the headboard top face, **Then** it displays Bed_(top_texture)_JE1_BE1.png
4. **Given** a bed is placed in the world, **When** viewing the footboard back face, **Then** it displays Bed_(front_texture)_JE2_BE2.png
5. **Given** a bed is placed in the world, **When** viewing the footboard side faces, **Then** they display Bed_(bottom_side_texture)_JE2_BE2.png
6. **Given** a bed is placed in the world, **When** viewing the footboard top face, **Then** it displays Bed_(bottom_texture)_JE1_BE1.png
7. **Given** a bed is placed in the world, **When** viewing the connection face between headboard and footboard, **Then** no texture is rendered (invisible/transparent)

---

### User Story 3 - Inventory Integration (Priority: P2)

As a player, I want to see a bed icon in my inventory so that I can identify and select the bed item.

**Why this priority**: Essential for usability - players need to identify the bed item in their inventory.

**Independent Test**: Can be tested by opening the inventory and verifying the bed item displays with the correct icon texture.

**Acceptance Scenarios**:

1. **Given** the player has a bed item in inventory, **When** opening the inventory screen, **Then** the bed item displays with Bed_(front_texture)_JE2_BE2.png as its icon
2. **Given** the player views the inventory, **When** looking at the bed item, **Then** it is clearly distinguishable from other items

---

### Edge Cases

- What happens when placing a bed at the edge of a chunk boundary?
- How does the system handle bed placement when one of the two blocks would be in an unloaded chunk?
- What happens when attempting to place a bed on non-solid blocks (water, lava, air)?
- How does the system handle bed removal (breaking)? Both blocks should be removed together.
- What happens when the player places a bed facing a direction where the second block would be out of world bounds?

## Requirements

### Functional Requirements

- **FR-001**: The system MUST support two new block types: `bed_head` and `bed_tail`
- **FR-002**: The `bed_head` block MUST have a height of 0.5 blocks
- **FR-003**: The `bed_tail` block MUST have a height of 0.5 blocks
- **FR-004**: The `bed_head` block MUST display Bed_(back_texture)_JE2_BE2.png on its front face (the face pointing away from the bed_tail)
- **FR-005**: The `bed_head` block MUST display Bed_(top_side_texture)_JE2_BE2.png on its side faces
- **FR-006**: The `bed_head` block MUST display Bed_(top_texture)_JE1_BE1.png on its top face
- **FR-007**: The `bed_head` block MUST have no texture on its bottom face
- **FR-008**: The `bed_head` block MUST have no texture on its back face (the face connecting to bed_tail)
- **FR-009**: The `bed_tail` block MUST display Bed_(front_texture)_JE2_BE2.png on its back face (the face pointing away from the bed_head)
- **FR-010**: The `bed_tail` block MUST display Bed_(bottom_side_texture)_JE2_BE2.png on its side faces
- **FR-011**: The `bed_tail` block MUST display Bed_(bottom_texture)_JE1_BE1.png on its top face
- **FR-012**: The `bed_tail` block MUST have no texture on its bottom face
- **FR-013**: The `bed_tail` block MUST have no texture on its front face (the face connecting to bed_head)
- **FR-014**: The system MUST implement a bed entity in bed.json following the same pattern as turret.json
- **FR-015**: The system MUST intercept bed block placement and replace it with the bed entity instantiation
- **FR-016**: The bed entity MUST occupy exactly 2 adjacent blocks positioned side by side
- **FR-017**: The bed entity MUST be placed such that the headboard faces the player
- **FR-018**: The bed item in inventory MUST use Bed_(front_texture)_JE2_BE2.png as its icon
- **FR-019**: The system MUST prevent bed placement if either of the two required blocks is occupied
- **FR-020**: The system MUST prevent bed placement if either of the two required blocks is in an invalid location (out of bounds, unloaded chunk, etc.)

### Key Entities

- **Bed Entity**: A composite structure consisting of two blocks (bed_head and bed_tail) placed side by side. The entity is created when a player places a bed item and manages the lifecycle of both blocks.
- **bed_head Block**: Represents the headboard portion of the bed. Height: 0.5 blocks. Textured on front, sides, and top.
- **bed_tail Block**: Represents the footboard portion of the bed. Height: 0.5 blocks. Textured on back, sides, and top.

### Assumptions

- The bed placement logic follows the same interception pattern as the turret entity
- The bed is purely decorative and does not provide gameplay mechanics (sleeping, respawn points) in this iteration
- The bed blocks are not individually breakable; breaking either block removes the entire bed entity
- The bed can be placed in any horizontal orientation (N, S, E, W) based on player facing direction
- The bed requires a solid surface beneath both blocks for placement

## Success Criteria

### Measurable Outcomes

- **SC-001**: Players can successfully place beds in 95% of valid placement attempts
- **SC-002**: All 6 visible bed faces display correct textures without distortion or misalignment
- **SC-003**: Bed placement is blocked in 100% of cases where space is insufficient
- **SC-004**: The bed item icon is clearly recognizable in the inventory
- **SC-005**: Bed entity loads and renders without performance degradation (maintains 60 FPS)

### Technical Quality Criteria

- **SC-006**: Block data definitions in BlockData.js follow existing patterns for similar blocks
- **SC-007**: Material definitions in MaterialManager.js use correct texture mappings
- **SC-008**: JSON entity definition in bed.json follows the same structure as turret.json
- **SC-009**: Block placement interception logic integrates cleanly with existing systems
