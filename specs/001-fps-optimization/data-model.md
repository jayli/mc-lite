# Data Model: FPS Optimization

## Block Mapping Logic

The optimization logic modifies how blocks are generated in specific contexts.

### 1. Seabed Optimization
- **Trigger**: Terrain height `h < -2`.
- **Layout**:
  - `y = h`: `sand`
  - `y = h - 1`: `end_stone`
  - `y < h - 1`: Omitted (empty)

### 2. Terrestrial Hollows
- **Trigger**: Terrain height `h >= -2` and depth `k >= 2` (where `y = h - k`).
- **Probability**: 40% chance of being `air` (omitted).
- **Residual**: 60% chance of being `stone` or `gold_ore` (current logic).

### 3. Leaf Pruning
- **Trigger**: Blocks of type `leaves`, `sky_leaves`, `azalea_leaves`, `azalea_flowers`.
- **Constraint**: Block is only added if `exists(neighbor(type == air)) == true`.

## Voxel Attributes

| Type | Material | Physics | Optimization Role |
|------|----------|---------|-------------------|
| `sand` | Sand texture | Solid | Surface layer |
| `end_stone` | End stone texture | **Indestructible** | Base foundation |
| `air` | None | Non-solid | Reduced render load |
