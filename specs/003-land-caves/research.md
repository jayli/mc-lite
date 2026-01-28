# Research: Block-based Land Caves

## Technical Findings

### 1. Clustered Cave Generation (Rectangular Blocks)
- **Problem**: Current 1D probability check creates scattered holes.
- **Solution**: Use a 3D grid seed approach within `WorldWorker.js`.
  - For each chunk, pre-calculate a set of "Cave Centers" (Room seeds).
  - A block at `(x, y, z)` is hollowed out if it falls within the axis-aligned bounding box (AABB) of any room seed.
- **Parametric Control**:
  - `CAVE_COUNT`: Number of rooms per 16x16 chunk area.
  - `CAVE_SIZE`: Dimension range for the rooms (e.g., width/height/depth between 2 and 6).

### 2. Bedrock Stratigraphy
- **Logic**:
  - `k = 12`: Bedrock (`end_stone`).
  - `k = 11`: Solid layer (skip cave/hollow logic).
  - `2 <= k <= 10`: Potential cave layer.
- **File**: `src/world/WorldWorker.js`.

### 3. Indestructible Bedrock
- Already implemented for `end_stone` in `Player.js`. Since `end_stone` is only used for the bottom layer on land (and seabed), this logic is sufficient.

## Decisions

- **Decision**: Implement a `Room` based generation inside `WorldWorker.js` loop rather than a full 3D noise for "Rectangular Blocks" requirement.
- **Rationale**: User specifically asked for "rectangular blocks" (成块的空洞) and parametric control over "count and size". A room-based AABB check is more direct than thresholding noise for specific box shapes.
- **Decision**: Define constants `ROOMS_PER_CHUNK = 2` and `MAX_ROOM_SIZE = 5` as defaults.

## Alternatives Considered

- **Alternative**: Using 3D noise and "clamping" it to produce boxy shapes.
- **Rationale**: Mathematically more complex and less intuitive for the "count/size" parameter request compared to a simple room list.
