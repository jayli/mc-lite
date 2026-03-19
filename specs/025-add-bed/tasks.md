# Implementation Tasks: Add Bed Entity

**Feature**: Add Bed Entity (025-add-bed)
**Branch**: `025-add-bed`
**Plan**: [plan.md](plan.md) | **Spec**: [spec.md](spec.md) | **Data Model**: [data-model.md](data-model.md)

---

## Overview

This implementation adds a bed entity to the Minecraft-like voxel game. The bed consists of two adjacent half-height blocks (headboard and footboard). Tasks are organized by user story priority.

### Implementation Strategy

**MVP First**: User Story 1 (Basic Placement) is the core MVP. Complete US1 before US2/US3.

**Incremental Delivery**:
1. Phase 1: Foundation - Block definitions and materials (prerequisite for all stories)
2. Phase 2: US1 - Core placement functionality
3. Phase 3: US2 - Texture mapping
4. Phase 4: US3 - Inventory integration
5. Phase 5: Polish & validation

---

## Dependencies

```
Phase 1 (Foundation)
    │
    ├── T001-T004: Block definitions & materials
    │
    ▼
Phase 2 (US1: Basic Placement)
    │
    ├── T005-T011: Placement logic
    │
    ▼
Phase 3 (US2: Visual Appearance)
    │
    ├── T012-T015: Texture mapping
    │
    ▼
Phase 4 (US3: Inventory Integration)
    │
    ├── T016-T018: Inventory & icon
    │
    ▼
Phase 5 (Polish)
    │
    └── T019-T020: Testing & cleanup
```

### Parallel Execution Opportunities

Within each phase, marked with **[P]**:
- T001, T002: Parallel (different files)
- T006, T007: Parallel (different files)
- T012, T013: Parallel (different blocks)
- T016, T017: Parallel (different systems)

---

## Phase 1: Foundation

**Goal**: Define block types and materials needed for all user stories.

### Block Definitions

- [ ] T001 Add bed_head block definition to `src/constants/BlockData.js`
  - Add entry with `geometryType: 'half_block'`, `isSolid: true`, `orientationEnabled: false`
  - Set proper AO and transparency flags

- [ ] T002 Add bed_tail block definition to `src/constants/BlockData.js`
  - Add entry with same properties as bed_head
  - Ensure both blocks have consistent collision properties

- [ ] T003 Add bed_alias_block definition to `src/constants/BlockData.js`
  - Add entry with `isSolid: false`, `isRendered: false`, `isTransparent: true`
  - This is the inventory item that triggers bed placement

### Material Setup

- [ ] T004 [P] Preload bed textures in `src/core/MaterialManager.js`
  - Add all 6 bed texture URLs to `textureUrls` array in `initializeMaterials()`
  - Paths: `./src/assets/textures/bed/Bed_*.png`

---

## Phase 2: User Story 1 - Place Bed in World (P1)

**Goal**: Core functionality - players can place beds in the world.

**Independent Test Criteria**:
- Player can place bed on valid surface
- 2-block structure appears with headboard facing player
- Placement blocked when space insufficient
- Both blocks properly registered in world

### Geometry Support

- [ ] T005 Implement half_block geometry type in `src/world/Chunk.js`
  - Modify geometry generation to check for `geometryType === 'half_block'`
  - Generate vertices with Y from 0 to 0.5 instead of 0 to 1
  - Ensure UV mapping remains correct for half-height

### JSON Structure

- [ ] T006 [P] Create `src/world/structures/bed.json`
  - Define 2-block structure with bed_head at (0,0,0) and bed_tail at (0,0,-1)
  - Follow same format as turret.json

- [ ] T007 [P] Register bed structure loader in `src/world/entity-system/StructureLoader.js`
  - Add `bed: new StructureLoader('bed', ...)` to `structureLoaders`
  - Add to `preloadAllStructures()` Promise array

### Placement Logic

- [ ] T008 Add tryPlaceBed() method to `src/actors/player/PlayerInteraction.js`
  - Clone tryPlaceTurret pattern
  - Calculate headboard and footboard positions based on player facing
  - Check collision at both positions
  - Check player collision with bed bounds
  - Return boolean success/failure

- [ ] T009 Implement position calculation for bed placement
  - Determine player facing direction (dx, dz from player position)
  - Headboard at placement position
  - Footboard 1 block behind headboard (relative to player facing)
  - Handle all 4 directions (N/E/S/W)

- [ ] T010 Integrate bed placement into tryPlaceBlock()
  - Add check: `if (type === 'bed_alias_block') return this.tryPlaceBed(x, y, z)`
  - Ensure bed placement uses same validation flow as other blocks

- [ ] T011 Implement rollback on placement failure
  - If second block placement fails after first block placed, remove first block
  - Ensure atomic placement (both blocks or none)

---

## Phase 3: User Story 2 - Visual Appearance (P2)

**Goal**: Correct textures on all visible faces.

**Independent Test Criteria**:
- Each visible face displays correct texture file
- Connection face between head and tail is invisible
- Bottom faces are transparent
- Textures not distorted on half-height geometry

### Material Definitions

- [ ] T012 [P] Register bed_head material in `src/core/MaterialManager.js`
  - Define multi-face material using `faces` object
  - Face 0 (+X): Bed_(top_side_texture)_JE2_BE2.png
  - Face 1 (-X): Bed_(top_side_texture)_JE2_BE2.png
  - Face 2 (+Y): Bed_(top_texture)_JE1_BE1.png
  - Face 3 (-Y): transparent
  - Face 4 (+Z): Bed_(back_texture)_JE2_BE2.png
  - Face 5 (-Z): transparent

- [ ] T013 [P] Register bed_tail material in `src/core/MaterialManager.js`
  - Define multi-face material using `faces` object
  - Face 0 (+X): Bed_(bottom_side_texture)_JE2_BE2.png
  - Face 1 (-X): Bed_(bottom_side_texture)_JE2_BE2.png
  - Face 2 (+Y): Bed_(bottom_texture)_JE1_BE1.png
  - Face 3 (-Y): transparent
  - Face 4 (+Z): transparent
  - Face 5 (-Z): Bed_(front_texture)_JE2_BE2.png

### Face Culling

- [ ] T014 Configure face culling for bed blocks in `src/core/FaceCullingSystem.js` (if needed)
  - Ensure transparent faces don't cull adjacent block faces
  - Connection faces should not affect neighbor block rendering

- [ ] T015 Verify AO (Ambient Occlusion) rendering for half blocks
  - Check `src/core/AOSystem.js` handles half-block geometry correctly
  - AO values should apply to visible faces only

---

## Phase 4: User Story 3 - Inventory Integration (P2)

**Goal**: Bed item visible and selectable in inventory.

**Independent Test Criteria**:
- Bed item appears in inventory with correct icon
- Icon uses Bed_(front_texture)_JE2_BE2.png
- Selecting bed item allows placement

### Inventory Item

- [ ] T016 [P] Add bed to default inventory in `src/core/Game.js`
  - Add `this.player.inventory.add('bed_alias_block', DEFAULT_INVENTORY_COUNT)`
  - Place alongside other furniture/decor items

### Icon Generation

- [ ] T017 [P] Configure bed icon in `src/utils/ItemIconUtils.js`
  - Ensure bed_alias_block uses Bed_(front_texture)_JE2_BE2.png for icon
  - Icon should be recognizable at small size

- [ ] T018 Verify icon displays correctly in `src/ui/Inventory.js`
  - Test that bed icon renders in hotbar and inventory screen
  - Verify no texture stretching or distortion

---

## Phase 5: Polish & Cross-Cutting Concerns

**Goal**: Ensure quality and consistency across all stories.

### Testing & Validation

- [ ] T019 Manual testing per `specs/025-add-bed/quickstart.md`
  - Test 1: Basic placement in all 4 directions
  - Test 2: Texture verification (all 6 visible faces)
  - Test 3: Placement validation (blocked space, player collision)
  - Test 4: Bed breaking and item drop
  - Test 5: Inventory icon display

- [ ] T020 Run linter and fix any issues
  - `npm run lint`
  - Fix any warnings in modified files

### Optional Enhancements (if time permits)

- [ ] T021 [Optional] Add bed breaking logic to remove both blocks
  - When either bed_head or bed_tail is broken, remove the other block
  - Drop bed_alias_block item

- [ ] T022 [Optional] Add sound effects for bed placement
  - Use existing wood/fabric placement sounds

---

## Task Summary

| Phase | Story | Task Count | Parallel Tasks |
|-------|-------|------------|----------------|
| 1 | Foundation | 4 | 1 |
| 2 | US1 (P1) | 7 | 2 |
| 3 | US2 (P2) | 4 | 2 |
| 4 | US3 (P2) | 3 | 2 |
| 5 | Polish | 2 | 0 |
| **Total** | - | **20** | **7** |

---

## File Checklist

### Modified Files

- [ ] `src/constants/BlockData.js` - T001, T002, T003
- [ ] `src/core/MaterialManager.js` - T004, T012, T013
- [ ] `src/world/Chunk.js` - T005
- [ ] `src/actors/player/PlayerInteraction.js` - T008, T009, T010, T011
- [ ] `src/core/Game.js` - T016

### New Files

- [ ] `src/world/structures/bed.json` - T006

### Reference Files (may need review)

- [ ] `src/world/entity-system/StructureLoader.js` - T007
- [ ] `src/utils/ItemIconUtils.js` - T017
- [ ] `src/core/FaceCullingSystem.js` - T014
- [ ] `src/core/AOSystem.js` - T015
