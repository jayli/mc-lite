# Research: FPS Optimization

## Technical Findings

### 1. Leaf Pruning
- **Location**: `src/world/entities/Tree.js`
- **Current Logic**:
  - `default`/`skyTree`: Nested loops for `lx` (x-2 to x+2), `ly` (y+2 to y+4), `lz` (z-2 to z+2). Block added if `(lx !== x || lz !== z || ly > y + 3)` and `Math.random() > 0.3`.
  - `big`: Denser 5x4x5 cube at the top.
  - `azalea`: 5x3x5 canopy with `dist <= 2` check and `Math.random() > 0.2`.
  - `swamp`: 7x7 wide layers.
- **Proposed Optimization**: Implement a visibility check. Only add leaf if at least one of its 6 neighbors is 'air' (not another leaf or log). Since we don't have a full chunk grid during tree generation, we'll use a local occupancy map for the tree structure.

### 2. Seabed Optimization
- **Location**: `src/world/WorldWorker.js` (lines 62-73)
- **Current Logic**: If `h < wLvl` (-2), adds 4 layers of `sand` and potentially a `lilypad` or `ship`.
- **Proposed Optimization**:
  - Layer 1 (`y=h`): `sand`.
  - Layer 2 (`y=h-1`): `end_stone`.
  - Skip all blocks below `h-1`.
  - `end_stone` is already defined in `MaterialManager.js` (line 340).

### 3. Inland Hollow Regions (Caves)
- **Location**: `src/world/WorldWorker.js` (lines 82-85)
- **Current Logic**: Terrestrial loop `for (let k = 2; k <= 12; k++)` adds 11 layers of `stone` or `gold_ore`.
- **Proposed Optimization**: Inside this loop, if `k >= 2`, apply `if (Math.random() < 0.4) continue;`.

### 4. Indestructible `end_stone`
- **Location**: `src/entities/player/Player.js` (lines 338-382, `removeBlock` method).
- **Current Logic**: Logic handles both `InstancedMesh` and standard `Mesh`. It identifies block type via `m.userData.type`.
- **Proposed Logic**: Add `if (type === 'end_stone') return;` at the beginning of the removal logic.

## Decisions

- **Decision**: Use a local 3D array in `Tree.generate` to track tree block occupancy before calling `chunk.add`.
- **Rationale**: Efficiently detect "internal" blocks without querying the entire chunk.
- **Decision**: Make `end_stone` indestructible only for players (mining).
- **Rationale**: Aligns with the requirement that "in water, end_stone is not mineable".

## Alternatives Considered

- **Alternative**: Using 3D Perlin noise for caves.
- **Rationale**: Rejected for now to follow the user's specific "40% random" request, which is simpler and faster.
