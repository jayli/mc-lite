# Quickstart: Frozen Mountain Custom Map

**Feature**: 017-frozen-mountain
**Date**: 2026-02-28

## How to See the Frozen Mountain

### In-Game

1. **Start the game**: `npm run start`
2. **Open in browser**: http://localhost:8080
3. **Find a snow_land region**:
   - Explore the world until you see snow_grass terrain
   - Or fly in one direction for ~200-400 blocks
4. **Look for the frozen mountain**:
   - From snow_land, look opposite to the pyramid direction
   - The tall, snowy peak should be visible
5. **Explore**:
   - Climb to the top to see snow_grass surface
   - Dig down to find dirt layers then stone
   - Explore caves inside the mountain

### Development Verification

**Check if mountain is generating**:
```javascript
// In browser console, while standing in a chunk
// (Verification method TBD - can look at block types)
```

**Expected block layers when digging**:
1. Top: `snow_grass`
2. Next 2-3: `dirt`
3. Below that: `stone`
4. Deep down: `end_stone` (bedrock)

## Files Overview

### New Files

| File | Purpose |
|------|---------|
| `src/workers/maps/FrozenMountain.js` | Frozen mountain generation logic |

### Modified Files

| File | Change |
|------|--------|
| `src/workers/WorldWorker.js` | Import and integrate FrozenMountain |

## Architecture

### Pattern Followed

The frozen mountain follows the **same pattern as Pyramid and SnowLand**:

```
1. getFrozenMountainInfo(wx, wz, seed, terrainGen)
   ↓
   Determines if (wx, wz) is in the mountain region
   Calculates height, transition factor, zone type
   Returns info object or null

2. generateFrozenMountain(wx, wz, h, fmInfo, fakeChunk, dPlaceholder)
   ↓
   Generates blocks according to layer rules
   Creates caves in the interior
   Adds blocks to fakeChunk
```

### Integration in WorldWorker

```javascript
// Priority order:
Pyramid → SnowLand → FrozenMountain → Regular terrain
```

## Common Tasks

### Adjust Mountain Steepness

Edit `HEIGHT_RATIO` in `FrozenMountain.js`:
- Lower value = steeper mountain (e.g., 1.2)
- Higher value = more gradual (e.g., 2.5)

### Adjust Mountain Size

Edit `MOUNTAIN_SIZE` in `FrozenMountain.js`:
- Current: 60 blocks (larger than Pyramid's 40)

### Adjust Cave Density

Edit `CAVE_ROOMS_PER_CHUNK` in `FrozenMountain.js`:
- More rooms = more cave space
- Larger `MAX_CAVE_ROOM_SIZE` = bigger individual caves

## Testing Checklist

- [ ] Mountain generates near snow_land regions
- [ ] Mountain is taller and larger than Pyramid
- [ ] Surface is covered in snow_grass
- [ ] Digging reveals 2-3 dirt layers then stone
- [ ] Caves exist inside the mountain
- [ ] No performance degradation when viewing mountain
- [ ] Bottom 2 layers are solid (end_stone)
