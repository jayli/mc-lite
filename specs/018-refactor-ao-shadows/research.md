# AO Refactoring Research

**Feature**: AO 阴影渲染逻辑重构
**Branch**: `018-refactor-ao-shadows`
**Date**: 2026-03-02

---

## 1. Existing AO Implementation Analysis

### 1.1 Core AO Formula (WorldWorker.js:447-528)

**AO Calculation Algorithm**:
```javascript
// AO = 3 - (side1 + side2 + corner)
const getAOValue = (side1, side2, corner) => {
  const s1 = side1 ? 1 : 0;
  const s2 = side2 ? 1 : 0;
  const c = (side1 || side2) ? (corner ? 1 : 0) : 0; // Minecraft optimization
  if (s1 && s2) return 0; // Both sides occluded = darkest
  return 3 - (s1 + s2 + c);
};
```

**Key Characteristics**:
- **4 corners per face** × **6 faces** = **24 vertices** total
- **AO value range**: 0-3 (2 bits per vertex)
- **Packed storage**: `aoLow` (vertices 0-11) + `aoHigh` (vertices 12-23)
- **Minecraft-style optimization**: Corner ignored when both adjacent sides are air

**Sampling Pattern** (per face):
- Each face samples **3 neighbors** (2 adjacent sides + 1 corner diagonal)
- Total: 6 faces × 3 samples = **18 neighbor checks per block**

### 1.2 AO Data Flow (WorldWorker.js:609-629)

```javascript
// AO is computed during chunk generation in WorldWorker
if (isAOEnabled) {
  for (let f = 0; f < 6; f++) {
    const aos = getAO(block.x, block.y, block.z, f);
    for (let v = 0; v < 4; v++) {
      const vertexIdx = f * 4 + v;
      const aoVal = aos[v];
      if (vertexIdx < 12) aoLow |= (aoVal << (vertexIdx * 2));
      else aoHigh |= (aoVal << ((vertexIdx - 12) * 2));
    }
  }
}
d[block.type].push({x, y, z, aoLow, aoHigh, orientation});
```

**AO is currently computed**:
- During initial chunk generation (WorldWorker)
- For all solid + non-transparent blocks
- Packed into `aoLow`/`aoHigh` bitfields

### 1.3 AO Shader Injection (MaterialManager.js:179-227)

**Vertex Shader Modifications**:
```glsl
// AO data passed as vertex attributes
attribute float aVertexId;
attribute float aAoLow;
attribute float aAoHigh;
varying float vAo;

// AO unpacking function
float getAo(float id, float low, float high) {
  float aoRaw;
  if (id < 12.0) {
    aoRaw = mod(floor(low / pow(4.0, id)), 4.0);
  } else {
    aoRaw = mod(floor(high / pow(4.0, id - 12.0)), 4.0);
  }
  return 1.0 - (3.0 - aoRaw) / 3.0 * 0.9; // 0.9 = shadow intensity
}
```

**Fragment Shader Modification**:
```glsl
varying float vAo;
// ...
diffuseColor.rgb *= vAo; // Apply AO to final color
```

### 1.4 AO Enable Logic (BlockData.js:244-248)

**Current Logic**:
```javascript
// Automatic AO for non-transparent + solid blocks
if (props.isAOEnabled === undefined) {
  props.isAOEnabled = !props.isTransparent && props.isSolid;
}
```

**Problem**: Some blocks have explicit `isAOEnabled: true` override (lines 180-209), creating inconsistency.

---

## 2. Root Cause Analysis of Current Issues

### 2.1 Issue: Shadow Incompatibility with Map Terrain

**Symptom**: AO shadows missing or inconsistent at chunk boundaries.

**Root Cause**:
- `isOccluding()` function (WorldWorker:439-445) only checks `blockMap.get()` within current chunk
- Cross-chunk neighbor lookups use `worldChunks` map but AO calculation doesn't utilize it
- Block at position (15, y, z) checking neighbor (16, y, z) fails if neighbor is in adjacent chunk

**Code Location**:
```javascript
const isOccluding = (x, y, z) => {
  const k = `${x},${y},${z}`;
  const b = blockMap.get(k);  // ❌ Only checks current chunk's blockMap
  if (!b) return false;
  return !getBlockProperties(b.type).isTransparent;
};
```

### 2.2 Issue: Dynamic Block AO Updates Missing

**Symptom**: Player-placed blocks don't show AO shadows.

**Root Cause**:
- FaceCullingSystem handles visibility updates but has no AO recalculation
- Chunk.js background consolidation merges dynamic blocks but doesn't update AO data
- No worker message handler for incremental AO computation

### 2.3 Issue: Entity/Structure AO Interference

**Symptom**: Structures like houses/trees have inconsistent AO.

**Root Cause**:
- Structure blocks generated after terrain may have different AO calculation context
- `structureQueue` execution happens after initial AO computation
- Cross-chunk structures (pyramids, snow lands) have special handling but AO not integrated

---

## 3. Worker Computation Boundaries

### 3.1 Current Worker Responsibilities

| Worker | Current AO Role | Should Add |
|--------|-----------------|------------|
| **WorldWorker** | ✅ Full AO computation during chunk generation | Incremental AO updates |
| **FaceCullingWorker** | ❌ Only face visibility (no AO) | Batch AO recalculation |
| **PersistenceWorker** | ❌ N/A | N/A |

### 3.2 Proposed Worker Boundaries

**WorldWorker (Initial Generation)**:
- Compute AO during chunk creation
- Handle cross-chunk neighbor queries via `worldChunks` map
- Pack AO data into `aoLow`/`aoHigh` format

**FaceCullingWorker (Dynamic Updates)**:
- Add `COMPUTE_AO` message type
- Process block updates with neighborhood radius
- Return delta AO data for affected blocks

**Main Thread (FaceCullingSystem)**:
- Queue AO requests with priority
- Merge AO results into InstancedMesh attributes
- Handle chunk boundary coordination

---

## 4. Performance Baseline

### 4.1 Current Performance Characteristics

**WorldWorker AO Computation** (per chunk):
- **Blocks per chunk**: 16×16×256 = 65,536 (max)
- **AO calculations**: ~262,144 neighbor checks (4 per block × 65,536)
- **Typical visible blocks**: ~5,000-10,000 (after face culling)
- **AO overhead**: ~18 neighbor checks × visible blocks

**Estimated Time**:
- Chunk generation: ~50-100ms (including AO)
- AO portion: ~15-30ms (30% of total)

### 4.2 Dynamic Update Performance (Not Implemented)

**Current Gap**:
- No incremental AO update mechanism
- Player placing a block: triggers full chunk rebuild OR no AO update
- Desired: <5ms for single block update

---

## 5. Technical Decisions

### 5.1 Decision: Preserve Existing AO Formula

**Rationale**:
- Visual consistency is critical for user experience
- Formula is already optimized (Minecraft-style corner handling)
- Re-tuning would require extensive visual testing

**Implementation**:
- Copy `getAOValue()` and `getAO()` functions to new `AOUtils.js`
- Maintain exact bit-packing format (`aoLow`/`aoHigh`)
- Preserve shader unpacking logic

### 5.2 Decision: Unified AO for All Solid+Opaque Blocks

**Rationale**:
- Eliminates `isAOEnabled` configuration inconsistency
- Matches user requirement: "所有实心且不透明的方块统一对待"
- Simplifies BlockData.js (remove explicit `isAOEnabled` overrides)

**Implementation**:
- Remove `isAOEnabled` property from BLOCK_DATA
- Update `getBlockProperties()` to auto-compute: `!isTransparent && isSolid`
- Update Chunk.js to check properties, not explicit flag

### 5.3 Decision: Worker-First AO Computation

**Rationale**:
- AO computation is embarrassingly parallel
- Main thread must stay responsive for input/rendering
- Existing Worker infrastructure (FaceCullingWorker) available

**Implementation**:
- Extend FaceCullingWorker with AO computation
- Use Transferable Objects for large AO data arrays
- Implement request debouncing for dynamic updates

---

## 6. Integration Points

### 6.1 Chunk.js Integration

**Current Location**: `src/world/Chunk.js`

**Modification Points**:
1. `mergeChunk()` - Apply AO data from Worker response
2. `addDynamicBlock()` - Queue AO update request
3. `consolidateBackground()` - Recompute AO for merged blocks

### 6.2 MaterialManager.js Integration

**Current Location**: `src/core/MaterialManager.js`

**Modification Points**:
1. `_applyShaderModifications()` - Simplify AO detection (remove `props.isAOEnabled` check)
2. `getMaterial()` - Auto-apply AO shader for all solid+opaque blocks

### 6.3 FaceCullingSystem.js Integration

**Current Location**: `src/core/FaceCullingSystem.js`

**New Responsibilities**:
1. Queue AO computation requests
2. Handle Worker response callbacks
3. Update InstancedMesh attributes with new AO data

---

## 7. Testing Strategy

### 7.1 Unit Tests (`test-ao.js`)

**Test Cases**:
1. `getAOValue()` - All 8 neighbor combinations
2. `packAOData()` - Bit-packing round-trip
3. `unpackAOData()` - Shader-equivalent unpacking
4. `isAOApplicable()` - Solid+opaque detection

### 7.2 Integration Tests

**Test Scenarios**:
1. Chunk generation - AO data present in Worker response
2. Block placement - AO updates within 1 frame
3. Chunk boundary - AO continuous across chunks
4. Structure generation - AO correct for houses/trees

### 7.3 Performance Tests

**Metrics**:
- Chunk generation time (with AO) < 100ms
- Single block AO update < 5ms
- Frame time impact < 15% at 1000+ blocks

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Visual regression | Side-by-side comparison with old implementation |
| Performance degradation | Profile with Chrome DevTools, compare baseline |
| Cross-chunk AO gaps | Add explicit neighbor chunk lookup |
| Worker message overhead | Batch updates, use Transferable Objects |

---

## 9. References

**Key Files Analyzed**:
- `src/workers/WorldWorker.js` - AO computation (lines 447-629)
- `src/core/MaterialManager.js` - Shader injection (lines 179-227)
- `src/constants/BlockData.js` - AO flags (lines 180-209, 244-248)
- `src/core/FaceCullingSystem.js` - Face visibility (no AO currently)
- `src/workers/FaceCullingWorker.js` - Face visibility worker (no AO currently)

**External References**:
- Minecraft AO implementation: https://minecraft.fandom.com/wiki/Ambient_occlusion
- Three.js InstancedMesh: https://threejs.org/docs/#api/en/objects/InstancedMesh
- WebGL vertex attributes: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial/Using_vertex_buffers
