# Research: Frozen Mountain Custom Map

**Feature**: 017-frozen-mountain
**Date**: 2026-02-28

## Research Findings

### 1. Custom Map API Pattern

**Decision**: Follow the existing Pyramid.js and SnowLand.js API pattern

**Rationale**:
- Existing maps have a well-established, consistent interface
- WorldWorker.js already knows how to integrate maps following this pattern
- Reduces integration risk and ensures compatibility

**API Pattern Details**:
```javascript
// get[MapName]Info(wx, wz, seed, terrainGen) -> info object or null
// generate[MapName](wx, wz, h, mapInfo, fakeChunk, dPlaceholder) -> optional result

export const FrozenMountain = {
  getFrozenMountainInfo,
  generate: generateFrozenMountain
}
```

**Alternatives considered**:
- Creating a new pattern - rejected because consistency is more valuable

---

### 2. Mountain Placement Strategy

**Decision**: Place frozen mountain in the same 400x400 region as snow_land, offset from snow_land

**Rationale**:
- SnowLand.js is already positioned at +160 X offset from Pyramid
- FrozenMountain can be positioned at -160 X offset (opposite side)
- Maintains clear spatial separation between all three structures
- Fulfills "near snow_land" requirement

**Positioning Layout**:
```
Pyramid (center)
    |
    +160 X --> SnowLand
    |
    -160 X --> FrozenMountain
```

**Region Size**: 60x60 blocks (larger than Pyramid's 40x40)

**Alternatives considered**:
- Variable random offset - rejected for predictability
- Same position as snow_land - rejected for overlap

---

### 3. Mountain Shape Generation

**Decision**: Use a conical/pyramidal shape with rounded peak, using max(dx, dz) distance metric

**Rationale**:
- Pyramid.js already uses this pattern and it works well
- Easy to adjust steepness by modifying the height calculation ratio
- Creates a classic "mountain" silhouette

**Height Calculation**:
```javascript
// Steeper mountain: height = (halfSize - distFromCenter) / 1.2
// More gradual: height = (halfSize - distFromCenter) / 2.5
```

**Alternatives considered**:
- Perlin noise based terrain - rejected for complexity and unpredictability
- Multiple peaks - rejected for scope (single peak is sufficient for MVP)

---

### 4. Cave Generation Strategy

**Decision**: Reuse the existing room-based cave logic from WorldWorker.js, scoped to the mountain region

**Rationale**:
- WorldWorker.js already has room generation logic (ROOMS_PER_CHUNK, MAX_ROOM_SIZE)
- Can reuse the same algorithm but apply it only within mountain bounds
- Ensures consistency with existing cave generation approach

**Cave Scope**:
- Only generate caves inside the mountain volume
- Adjust room count to create substantial cave systems
- Ensure caves connect to create a sense of mystery

**Alternatives considered**:
- Custom 3D noise caves - rejected for complexity
- No caves at all - rejected per requirements

---

### 5. Block Layer Composition

**Decision**: Follow the exact layering from requirements

**Rationale**:
- Requirements are very specific about layer composition
- SnowLand.js already implements a similar pattern (snow_grass -> dirt -> stone)

**Layer Structure**:
```
Top layer:      snow_grass (1 block)
Sub-surface:    dirt (2-3 blocks, random)
Main body:      stone (remaining mountain volume)
Foundation:     end_stone (12th layer below surface, same as other maps)
```

**Alternatives considered**:
- Additional block types - rejected (requirements don't mention them)

---

### 6. Integration with WorldWorker.js

**Decision**: Insert FrozenMountain check after SnowLand but before other terrain

**Rationale**:
- Maintains priority order: Pyramid > SnowLand > FrozenMountain > other terrain
- Follows existing integration pattern

**Integration Pattern**:
```javascript
// Check for Pyramid first
const pyInfo = Pyramid.getPyramidInfo(wx, wz, seed, terrainGen);
if (pyInfo) {
  Pyramid.generate(wx, wz, h, pyInfo, fakeChunk, dPlaceholder);
}
// Then check for SnowLand
else if (slInfo) {
  SnowLand.generate(wx, wz, h, slInfo, fakeChunk, dPlaceholder);
}
// Then check for FrozenMountain
else if (fmInfo) {
  FrozenMountain.generate(wx, wz, h, fmInfo, fakeChunk, dPlaceholder);
}
// Then regular terrain
else {
  // ...
}
```

**Alternatives considered**:
- Higher priority than SnowLand - rejected to maintain existing map relationships

---

## Key Files to Reference

| File | Purpose |
|------|---------|
| `src/workers/maps/Pyramid.js` | API pattern reference |
| `src/workers/maps/SnowLand.js` | Snow biome layering reference |
| `src/workers/WorldWorker.js` | Integration point |
| `specs/003-land-caves/spec.md` | Cave generation spec reference |

## Summary of Decisions

1. **API**: Follow Pyramid/SnowLand pattern with `getFrozenMountainInfo` and `generate`
2. **Placement**: -160 X offset from Pyramid (opposite SnowLand), same 400x400 region
3. **Size**: 60x60 blocks base (larger than Pyramid's 40x40)
4. **Shape**: Conical with adjustable steepness
5. **Caves**: Reuse WorldWorker's room logic, scoped to mountain
6. **Layers**: snow_grass -> dirt (2-3) -> stone -> end_stone foundation
7. **Integration**: After SnowLand in WorldWorker priority chain
