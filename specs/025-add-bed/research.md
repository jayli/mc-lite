# Research & Design Decisions: Add Bed Entity

**Feature**: Add Bed Entity (025-add-bed)
**Date**: 2026-03-19
**Purpose**: Document key technical decisions for bed implementation

---

## Decision 1: Geometry Type for Half-Height Blocks

**Context**: Bed blocks have 0.5 block height, different from standard 1.0 blocks.

**Options Considered**:

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| A | Custom mesh per block | Full control | More complex, breaks instancing |
| B | `geometryType: 'half_block'` flag | Reuses existing systems, works with instancing | Need to handle in Chunk geometry generation |
| C | Scale Y axis of standard block | Simple | Collision detection issues, texture stretching |

**Decision**: Option B - Use `geometryType: 'half_block'`

**Rationale**:
- Aligns with existing `geometryType` pattern (e.g., 'flower', 'vine', 'handrail')
- Chunk.js can generate half-height geometry based on this flag
- Maintains collision and rendering consistency
- No custom meshes needed

**Implementation Notes**:
- Chunk.js geometry generation needs to check `geometryType === 'half_block'`
- Vertices Y coordinates: 0 to 0.5 instead of 0 to 1
- UV mapping remains 0-1 on all axes
- Physics collision box height: 0.5

---

## Decision 2: Texture Face Mapping

**Context**: Bed blocks have asymmetric texture requirements - some faces need textures, others should be invisible (transparent).

**Texture Assignment**:

### Bed Head Block
| Face | Direction | Texture | Notes |
|------|-----------|---------|-------|
| Front | +Z (facing away from tail) | Bed_(back_texture)_JE2_BE2.png | Visible to player |
| Back | -Z (toward tail) | transparent | Internal connection face |
| Left | -X | Bed_(top_side_texture)_JE2_BE2.png | Visible side |
| Right | +X | Bed_(top_side_texture)_JE2_BE2.png | Visible side |
| Top | +Y | Bed_(top_texture)_JE1_BE1.png | Visible top |
| Bottom | -Y | transparent | No texture needed |

### Bed Tail Block
| Face | Direction | Texture | Notes |
|------|-----------|---------|-------|
| Front | +Z (toward head) | transparent | Internal connection face |
| Back | -Z (facing away from head) | Bed_(front_texture)_JE2_BE2.png | Visible to player |
| Left | -X | Bed_(bottom_side_texture)_JE2_BE2.png | Visible side |
| Right | +X | Bed_(bottom_side_texture)_JE2_BE2.png | Visible side |
| Top | +Y | Bed_(bottom_texture)_JE1_BE1.png | Visible top |
| Bottom | -Y | transparent | No texture needed |

**Implementation Approach**:
- Use `faces` material definition in MaterialManager.js (like `grass`, `dirt`)
- Transparent faces use `{ transparent: true, opacity: 0 }` material
- `alphaTest: 0.1` for proper transparency handling

---

## Decision 3: Placement Interception Pattern

**Context**: Need to intercept `bed_alias_block` placement and replace with actual bed structure.

**Reference Implementation**: `tryPlaceTurret()` in PlayerInteraction.js (lines 264-359)

**Pattern Analysis**:

```javascript
// In tryPlaceBlock()
if (type === 'turret_alias_block') {
  return this.tryPlaceTurret(x, y, z);
}

// tryPlaceTurret() steps:
1. Check collision at placement position
2. Check collision at all occupied positions (3x3 base + 2 above)
3. Check player collision with entire structure
4. Place base blocks (iron_ore 3x3)
5. Place pillar blocks (obsidian at y+1, y+2)
6. Create turret entity via TurretManager
7. On failure: rollback placed blocks
8. On success: consume item, play sound
```

**Bed Adaptation**:

```javascript
// tryPlaceBed() steps:
1. Check collision at placement position (x, y, z)
2. Calculate second block position based on player facing
   - Player facing determines headboard direction
   - Tail block is behind headboard relative to player
3. Check collision at second block position
4. Check player collision with both blocks (0.5 height × 2 width)
5. Place bed_head block at calculated position
6. Place bed_tail block at adjacent position
7. On failure: rollback (remove placed blocks)
8. On success: consume item, play sound
```

**Player Facing Logic**:
- Headboard faces the player (player looks at headboard front)
- If player faces +Z, headboard at (x,y,z), tail at (x,y,z-1)
- Direction calculation same as turret (use dx, dz from player position)

---

## Decision 4: Bed Structure Definition

**Context**: Need bed.json for potential future entity system integration.

**Format**: Follow turret.json structure

```json
{
  "blocks": [
    {"x": 0, "y": 0, "z": 0, "type": "bed_head", "direction": 0},
    {"x": 0, "y": 0, "z": -1, "type": "bed_tail", "direction": 0}
  ]
}
```

**Notes**:
- `direction` field for orientation (0=N, 1=E, 2=S, 3=W) - may not be used for bed
- Position is relative; actual placement calculates absolute positions
- Z-offset of -1 means tail is behind head (default orientation)

---

## Decision 5: Inventory Icon

**Context**: Bed item needs recognizable icon in inventory.

**Decision**: Use `Bed_(front_texture)_JE2_BE2.png` as the icon texture

**Implementation**: ItemIconUtils.js handles icon generation from textures

---

## Decision 6: Block Properties

**Bed Head Properties**:
```javascript
'bed_head': {
  isSolid: true,
  isTransparent: false,  // Block itself is not transparent
  geometryType: 'half_block',
  orientationEnabled: false,
  isAOEnabled: true
}
```

**Bed Tail Properties**:
```javascript
'bed_tail': {
  isSolid: true,
  isTransparent: false,
  geometryType: 'half_block',
  orientationEnabled: false,
  isAOEnabled: true
}
```

**Bed Alias Block** (for inventory):
```javascript
'bed_alias_block': {
  isSolid: false,
  isTransparent: true,
  isRendered: false,  // Never actually rendered
  isShadowEnabled: false,
  orientationEnabled: false
}
```

---

## Summary of Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `geometryType: 'half_block'` | Aligns with existing patterns, maintains instancing |
| 2 | Multi-face materials with transparency | Proper texture mapping, invisible connection faces |
| 3 | Clone turret placement pattern | Proven pattern, consistent codebase |
| 4 | Simple 2-block JSON structure | Minimal complexity, matches turret format |
| 5 | Front texture as icon | Most recognizable bed view |
| 6 | Standard solid block properties | Consistent collision and AO behavior |

