# Data Model: Block-based Land Caves

## Cave Generation Parameters (Local Constants)

The following constants in `WorldWorker.js` control the volume and frequency of contiguous rectangular hollows.

| Constant | Default | Description |
|----------|---------|-------------|
| `ROOMS_PER_CHUNK` | 2 | The number of rectangular cave "seeds" generated per 16x16 chunk column. |
| `MAX_ROOM_SIZE` | 5 | The maximum dimension (width, height, depth) of each rectangular cave. |

## Subsurface Stratigraphy

Land biomes follow a tiered generation approach in the deep subsurface.

| Depth (`k = h - y`) | Block Logic | Consistency |
|---------------------|-------------|-------------|
| `0 <= k <= 1` | Surface/Sub-surface (Solid) | 100% Solid |
| `2 <= k <= 10` | Room-based Hollows (AABB Check) | Parametric |
| `k = 11` | Protection Layer (Solid) | 100% Solid |
| `k = 12` | Bedrock Foundation (`end_stone`) | 100% Solid |

## Mining Logic

- **Bedrock (`end_stone`)**: All blocks of this type are flagged as indestructible in `Player.js`.
- **Hollows**: Represented as the absence of block generation (effectively `air`).
