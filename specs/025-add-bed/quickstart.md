# Quickstart Guide: Testing Bed Entity

**Feature**: Add Bed Entity (025-add-bed)
**Date**: 2026-03-19
**Purpose**: Manual testing instructions for bed implementation

---

## Prerequisites

1. Development server running on port 8080
2. Game loaded in browser
3. Bed item in inventory (default after implementation)

---

## Test Procedures

### Test 1: Basic Bed Placement

**Purpose**: Verify bed can be placed in the world

**Steps**:
1. Open inventory (press `E`)
2. Select bed item (scroll wheel or number key)
3. Look at a flat surface (grass, dirt, stone)
4. Right-click to place

**Expected Results**:
- [ ] Bed appears as 2-block structure
- [ ] Headboard faces the player
- [ ] Footboard is behind headboard
- [ ] Both blocks have 0.5 height (half slab appearance)
- [ ] Placement sound plays
- [ ] One bed item consumed from inventory

**Screenshots to Capture**:
- Bed from front (should see headboard front texture)
- Bed from side (should see side textures)
- Bed from above (should see top textures)

---

### Test 2: Texture Verification

**Purpose**: Verify all textures render correctly

**Steps**:
1. Place a bed
2. Walk around it, observing each face
3. Compare with reference textures

**Expected Results**:

| View | Expected Texture | Result |
|------|-----------------|--------|
| Headboard front | Bed_(back_texture)_JE2_BE2.png | [ ] |
| Headboard sides | Bed_(top_side_texture)_JE2_BE2.png | [ ] |
| Headboard top | Bed_(top_texture)_JE1_BE1.png | [ ] |
| Footboard back | Bed_(front_texture)_JE2_BE2.png | [ ] |
| Footboard sides | Bed_(bottom_side_texture)_JE2_BE2.png | [ ] |
| Footboard top | Bed_(bottom_texture)_JE1_BE1.png | [ ] |

**Note**: Connection face between head and tail should be invisible (transparent)

---

### Test 3: Placement Validation

**Purpose**: Verify bed cannot be placed in invalid locations

**Test Cases**:

#### 3.1 Blocked by Existing Block
**Steps**:
1. Place a stone block
2. Try to place bed adjacent to it (where footboard would be)

**Expected**: Placement blocked, no bed created, item not consumed

#### 3.2 Blocked by Player
**Steps**:
1. Stand in the space where footboard would be
2. Try to place bed

**Expected**: Placement blocked, player collision prevents placement

#### 3.3 Overhang/Unsupported
**Steps**:
1. Build a 1-block wide platform
2. Stand at edge
3. Try to place bed extending over empty space

**Expected**: Placement blocked if footboard position has no ground

---

### Test 4: Orientation Testing

**Purpose**: Verify bed orients correctly to player facing

**Steps**:
1. Face North (+Z)
2. Place bed
3. Verify headboard faces North (toward you), tail extends South

4. Face East (+X)
5. Place bed
6. Verify headboard faces East, tail extends West

7. Repeat for South and West

**Expected**: Headboard always faces player, regardless of facing direction

---

### Test 5: Bed Breaking

**Purpose**: Verify bed can be broken and drops item

**Steps**:
1. Place a bed
2. Switch to hand (no tool)
3. Left-click headboard
4. Left-click footboard

**Expected Results**:
- [ ] Headboard breaks and disappears
- [ ] Footboard breaks and disappears
- [ ] Both blocks drop bed_alias_block item
- [ ] Breaking particles appear
- [ ] Breaking sound plays

---

### Test 6: Inventory Icon

**Purpose**: Verify bed icon displays correctly

**Steps**:
1. Open inventory
2. Locate bed item
3. Observe icon

**Expected**:
- [ ] Icon shows Bed_(front_texture)_JE2_BE2.png
- [ ] Icon is recognizable as a bed
- [ ] Icon displays in hotbar correctly

---

### Test 7: Edge Cases

#### 7.1 Chunk Boundary
**Steps**:
1. Find chunk boundary (use debug info if available)
2. Place bed straddling boundary (head in chunk A, tail in chunk B)

**Expected**: Bed places correctly, both blocks render

#### 7.2 Near World Bounds
**Steps**:
1. Go to world edge (if accessible)
2. Try to place bed with tail outside bounds

**Expected**: Placement blocked gracefully

#### 7.3 On Non-Solid Blocks
**Steps**:
1. Try to place bed on water
2. Try to place bed on lava
3. Try to place bed on air (sky place)

**Expected**: Placement blocked or behaves consistently with other blocks

---

## Debug Information

### Console Commands

```javascript
// Access game instance
window.game

// Check world blocks
window.game.world.getBlock(x, y, z)

// Check block entry (includes orientation)
window.game.world.getBlockEntry(x, y, z)

// Check inventory
window.game.player.inventory.items
```

### Enable Debug Info

Press `P` to toggle debug performance overlay.

---

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| Bed doesn't place | Collision check failing | Verify space is clear, check console logs |
| Textures missing | Material not registered | Check MaterialManager.js registration |
| Wrong orientation | Facing calculation error | Check PlayerInteraction.js direction logic |
| Bed invisible | Geometry not generated | Check Chunk.js half_block handling |
| Can't break bed | Block type not recognized | Check BlockData.js properties |

---

## Performance Checklist

- [ ] Bed placement doesn't cause frame drops
- [ ] Multiple beds render at 60 FPS
- [ ] No memory leaks when placing/destroying beds repeatedly
- [ ] Bed blocks integrate with existing AO system

