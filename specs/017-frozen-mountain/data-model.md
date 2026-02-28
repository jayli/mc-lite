# Data Model: Frozen Mountain Custom Map

**Feature**: 017-frozen-mountain
**Date**: 2026-02-28

## Key Entities

### FrozenMountainInfo

The information object returned by `getFrozenMountainInfo()`.

**Purpose**: Describes the mountain properties at a given world coordinate.

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `centerX` | number | World X coordinate of mountain center |
| `centerZ` | number | World Z coordinate of mountain center |
| `layerHeight` | number | Height of mountain at this position (0 = base) |
| `isBaseLayer` | boolean | True if this is at mountain base elevation |
| `transitionFactor` | number | 0 = core region, 1 = fully transitioned to normal terrain |
| `zone` | string | 'core' or 'transition' |
| `mountainBaseHeight` | number | Terrain height at mountain center |

**Validation**:
- Returns `null` if coordinate is outside mountain region
- `transitionFactor` must be between 0 and 1 inclusive
- `layerHeight` must be >= 0

---

### Block Layer Configuration

**Purpose**: Defines the vertical block composition of the mountain.

**Layer Stack (from top to bottom)**:
| Depth | Block Type | Count | Notes |
|-------|-------------|-------|-------|
| Surface | `snow_grass` | 1 | Exposed mountain top |
| Sub-surface | `dirt` | 2-3 | Random variation |
| Main body | `stone` | variable | Majority of mountain volume |
| Foundation | `stone` | 10 layers | Below main body |
| Bedrock | `end_stone` | 2 layers | Bottom 2 layers |

**Validation Rules**:
- Surface must always be `snow_grass`
- Dirt layer count randomized per column (2 or 3)
- Stone fills remaining mountain volume
- Bottom 2 layers always solid (no caves)
- Very bottom layer always `end_stone`

---

### Mountain Cave Room

**Purpose**: Represents a single cave chamber within the mountain.

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `minX`, `maxX` | number | X bounds of cave room |
| `minY`, `maxY` | number | Y bounds of cave room |
| `minZ`, `maxZ` | number | Z bounds of cave room |

**Constraints**:
- Rooms only generated within mountain volume
- Rooms do not intersect bottom 2 solid layers
- Room size: 2-5 blocks in each dimension (configurable)
- Rooms may overlap to create larger continuous cave systems

---

### Mountain Generation Parameters

**Purpose**: Configurable constants controlling mountain characteristics.

| Parameter | Value | Description |
|-----------|-------|-------------|
| `MOUNTAIN_SIZE` | 60 | Base diameter in blocks |
| `TRANSITION_SIZE` | 8 | Transition zone width in blocks |
| `REGION_SIZE` | 400 | Region spacing between mountains |
| `HEIGHT_RATIO` | 1.5 | Steepness factor (lower = steeper) |
| `CAVE_ROOMS_PER_CHUNK` | 3 | Cave density |
| `MAX_CAVE_ROOM_SIZE` | 6 | Maximum cave room dimension |
| `OFFSET_FROM_PYRAMID_X` | -160 | X offset from pyramid center |
| `OFFSET_FROM_PYRAMID_Z` | 0 | Z offset from pyramid center |

---

## Relationships

```
WorldWorker
    ↓ calls
getFrozenMountainInfo(wx, wz, seed, terrainGen)
    ↓ returns
FrozenMountainInfo { centerX, centerZ, layerHeight, transitionFactor, zone, ... }
    ↓ passed to
generateFrozenMountain(wx, wz, h, fmInfo, fakeChunk, dPlaceholder)
    ↓ generates
Blocks added to fakeChunk (snow_grass, dirt, stone, end_stone)
    ↓ plus
Cave rooms (air blocks) within mountain volume
```

## State Transitions

N/A - Frozen Mountain is purely generative, no runtime state management needed.
