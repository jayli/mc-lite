# Quickstart: Verifying FPS Optimization

## Verifying Optimization Effects

### 1. FPS Monitor
- Open the game.
- Observe the FPS in the HUD (top-left).
- Target: 60+ FPS on MacBook devices.

### 2. Voxel Count Reduction
- Use the browser's developer console (F12).
- Check the number of instances in the `InstancedMesh` objects within `world.chunks`.
- Total voxel count should be significantly lower than the baseline (~30% reduction).

### 3. Feature Verification

#### Leaf Pruning
- Locate a tree (e.g., in a Forest biome).
- The canopy should appear full from the outside.
- Dig into the center of the leaves; the interior should be hollow.

#### Seabed Optimization
- Dive into an ocean biome (where height < -2).
- Dig through the first layer of `sand`.
- You should encounter `end_stone`.
- Verify that `end_stone` cannot be mined.

#### Inland Hollows
- Dig deep into a terrestrial biome (e.g., Plains or Forest).
- Starting from 3 blocks below the surface, you should encounter random air gaps (caves) at approximately 40% frequency.
