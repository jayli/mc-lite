# Data Model: Add Bed Entity

**Feature**: Add Bed Entity (025-add-bed)
**Date**: 2026-03-19
**Purpose**: Define entity structure and relationships for bed implementation

---

## Entity Overview

```
┌─────────────────────────────────────────────────────┐
│                    Bed Entity                        │
│  (Logical grouping - no persistent entity object)    │
└─────────────────────────────────────────────────────┘
                    │
        ┌──────────┴──────────┐
        ▼                     ▼
┌──────────────┐      ┌──────────────┐
│   bed_head   │      │   bed_tail   │
│  (Headboard) │      │  (Footboard) │
└──────────────┘      └──────────────┘
```

---

## Block Entity: bed_head

### Attributes

| Attribute | Type | Value | Description |
|-----------|------|-------|-------------|
| `type` | string | `"bed_head"` | Block type identifier |
| `isSolid` | boolean | `true` | Participates in physics collision |
| `isTransparent` | boolean | `false` | Base block is not transparent |
| `geometryType` | string | `"half_block"` | 0.5 height custom geometry |
| `orientationEnabled` | boolean | `false` | Bed has fixed orientation per placement |
| `isAOEnabled` | boolean | `true` | Ambient occlusion enabled |
| `height` | number | `0.5` | Collision box height |

### Texture Mapping (Faces)

```
         +Y (Top)
          │
          │ Bed_(top_texture)_JE1_BE1.png
          │
    -X────┼────+X
  (Left)  │   (Right)
    Bed_  │    Bed_
    top_  │    top_
    side  │    side
          │
          ▼
         -Z (Back - toward tail)
         [transparent]

    +Z (Front - facing player)
    Bed_(back_texture)_JE2_BE2.png
```

### Face Definitions

| Face Index | Direction | Texture File | Alpha |
|------------|-----------|--------------|-------|
| 0 (+X) | Right | Bed_(top_side_texture)_JE2_BE2.png | 1.0 |
| 1 (-X) | Left | Bed_(top_side_texture)_JE2_BE2.png | 1.0 |
| 2 (+Y) | Top | Bed_(top_texture)_JE1_BE1.png | 1.0 |
| 3 (-Y) | Bottom | transparent | 0.0 |
| 4 (+Z) | Front | Bed_(back_texture)_JE2_BE2.png | 1.0 |
| 5 (-Z) | Back | transparent | 0.0 |

---

## Block Entity: bed_tail

### Attributes

| Attribute | Type | Value | Description |
|-----------|------|-------|-------------|
| `type` | string | `"bed_tail"` | Block type identifier |
| `isSolid` | boolean | `true` | Participates in physics collision |
| `isTransparent` | boolean | `false` | Base block is not transparent |
| `geometryType` | string | `"half_block"` | 0.5 height custom geometry |
| `orientationEnabled` | boolean | `false` | Bed has fixed orientation per placement |
| `isAOEnabled` | boolean | `true` | Ambient occlusion enabled |
| `height` | number | `0.5` | Collision box height |

### Texture Mapping (Faces)

```
         +Y (Top)
          │
          │ Bed_(bottom_texture)_JE1_BE1.png
          │
    -X────┼────+X
  (Left)  │   (Right)
    Bed_  │    Bed_
    bottom│    bottom
    _side │    _side
          │
          ▼
         -Z (Back - facing away from player)
         Bed_(front_texture)_JE2_BE2.png

    +Z (Front - toward head)
    [transparent]
```

### Face Definitions

| Face Index | Direction | Texture File | Alpha |
|------------|-----------|--------------|-------|
| 0 (+X) | Right | Bed_(bottom_side_texture)_JE2_BE2.png | 1.0 |
| 1 (-X) | Left | Bed_(bottom_side_texture)_JE2_BE2.png | 1.0 |
| 2 (+Y) | Top | Bed_(bottom_texture)_JE1_BE1.png | 1.0 |
| 3 (-Y) | Bottom | transparent | 0.0 |
| 4 (+Z) | Front | transparent | 0.0 |
| 5 (-Z) | Back | Bed_(front_texture)_JE2_BE2.png | 1.0 |

---

## Structure Definition: bed.json

### File Location
`src/world/structures/bed.json`

### Schema

```json
{
  "name": "bed",
  "type": "furniture",
  "width": 1,
  "height": 1,
  "depth": 2,
  "blocks": [
    {
      "x": 0,
      "y": 0,
      "z": 0,
      "type": "bed_head",
      "direction": 0,
      "solid": true
    },
    {
      "x": 0,
      "y": 0,
      "z": -1,
      "type": "bed_tail",
      "direction": 0,
      "solid": true
    }
  ],
  "collision": {
    "width": 1.0,
    "height": 0.5,
    "depth": 2.0
  }
}
```

### Block Definitions

| Block | x | y | z | type | Relationship |
|-------|---|---|---|------|--------------|
| Head | 0 | 0 | 0 | bed_head | Primary placement point |
| Tail | 0 | 0 | -1 | bed_tail | Relative to head, -Z direction |

**Note on Coordinates**:
- (0, 0, 0) is the headboard position
- (0, 0, -1) is the footboard position (1 block behind)
- When placing, the system rotates these coordinates based on player facing

---

## Inventory Item: bed_alias_block

### Attributes

| Attribute | Type | Value |
|-----------|------|-------|
| `id` | string | `"bed_alias_block"` |
| `displayName` | string | `"Bed"` |
| `category` | string | `"furniture"` |
| `iconTexture` | string | `"Bed_(front_texture)_JE2_BE2.png"` |
| `stackable` | boolean | `true` |
| `maxStack` | number | `64` |

### Behavior

- **On place**: Triggers `tryPlaceBed()` instead of standard block placement
- **On break**: Drops `bed_alias_block` item (if bed broken)
- **Icon generation**: Uses front texture (Bed_(front_texture)_JE2_BE2.png)

---

## Relationships

```
bed_alias_block (inventory item)
    │
    │ placement intercepted
    ▼
tryPlaceBed()
    │
    ├── validates space
    ├── checks collision
    │
    ▼
bed_head (block) ───adjacent to───► bed_tail (block)
     │                                    │
     │ 0.5 height                         │ 0.5 height
     │                                    │
     ▼                                    ▼
[Rendered mesh]                    [Rendered mesh]
[Collision box]                    [Collision box]
```

---

## Placement Position Calculation

### Direction Mapping

| Player Facing | Headboard Position | Tail Position | Rotation |
|---------------|-------------------|---------------|----------|
| North (+Z) | (x, y, z) | (x, y, z-1) | 0° |
| East (+X) | (x, y, z) | (x-1, y, z) | 90° |
| South (-Z) | (x, y, z) | (x, y, z+1) | 180° |
| West (-X) | (x, y, z) | (x+1, y, z) | 270° |

### Algorithm

```javascript
function calculateBedPositions(x, y, z, playerFacing) {
  const headPos = { x, y, z };
  let tailPos;

  switch (playerFacing) {
    case 'NORTH': // +Z
      tailPos = { x, y, z: z - 1 };
      break;
    case 'EAST': // +X
      tailPos = { x: x - 1, y, z };
      break;
    case 'SOUTH': // -Z
      tailPos = { x, y, z: z + 1 };
      break;
    case 'WEST': // -X
      tailPos = { x: x + 1, y, z };
      break;
  }

  return { head: headPos, tail: tailPos };
}
```

---

## State Transitions

```
[Inventory] ──select──► [Selected Bed]
                           │
                           │ right-click place
                           ▼
                    [Validating Space]
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
        [Invalid]                   [Valid]
              │                         │
              │ cancel                  │ place blocks
              ▼                         ▼
        [No Change]              [Bed Placed]
                                        │
                                        │ left-click break
                                        ▼
                                  [Bed Broken]
                                        │
                                        │ drop item
                                        ▼
                                   [Inventory]
```

