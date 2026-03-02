# AO Refactoring Quickstart Guide

**Feature**: AO 阴影渲染逻辑重构
**Branch**: `001-refactor-ao-shadows`

---

## 1. Overview

This refactoring simplifies AO (Ambient Occlusion) shadow rendering by:

1. **Unified AO logic** - All solid+opaque blocks automatically get AO, no configuration needed
2. **Worker-first computation** - AO calculations moved to Web Workers to avoid main thread blocking
3. **Preserved algorithm** - Same Minecraft-style AO formula for visual consistency

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Thread                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ AOSystem.js │  │FaceCulling   │  │ MaterialManager │   │
│  │  (new)      │  │ System        │  │                 │   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘   │
│         │                │                    │            │
│         └────────────────┼────────────────────┘            │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │ postMessage()
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Web Worker                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  FaceCullingWorker.js (extended) / AOWorker.js     │   │
│  │  - COMPUTE_AO_BATCH (chunk generation)              │   │
│  │  - COMPUTE_AO_INCREMENTAL (dynamic updates)         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Key Concepts

### 3.1 AO Applicability

**Before** (complex):
```javascript
// Each block type needed explicit isAOEnabled flag
if (props.isAOEnabled === true) { /* apply AO */ }
```

**After** (simple):
```javascript
// Automatic for all solid+opaque blocks
if (!props.isTransparent && props.isSolid) { /* apply AO */ }
```

### 3.2 AO Data Packing

24 vertices × 2 bits = 48 bits total:
- `aoLow`: vertices 0-11 (24 bits)
- `aoHigh`: vertices 12-23 (24 bits)

```javascript
// Packing example
const aoLow = (ao0) | (ao1 << 2) | (ao2 << 4) | ... | (ao11 << 22);
const aoHigh = (ao12) | (ao13 << 2) | ... | (ao23 << 22);
```

### 3.3 Worker Message Flow

```
Main Thread                Worker                   Main Thread
    │                        │                         │
    │─COMPUTE_AO_BATCH─────>│                         │
    │                        │─(compute AO)─────────── │
    │                        │─AO_RESULT─────────────>│
    │                        │                         │─apply to mesh
    │                        │                         │
```

---

## 4. Developer Workflow

### 4.1 Adding a New Block Type

**Before**:
```javascript
// BlockData.js
'new_block': {
  isSolid: true,
  isTransparent: false,
  isAOEnabled: true  // ← Had to remember this
}
```

**After**:
```javascript
// BlockData.js
'new_block': {
  isSolid: true,
  isTransparent: false
  // ← AO automatic!
}
```

### 4.2 Debugging AO Issues

**Check if AO is applied**:
```javascript
// In browser console
const chunk = world.chunks.get('0,0');
const aoData = chunk.aoData.get('10,64,10');
console.log(aoData);  // Should have aoLow, aoHigh properties
```

**Visualize AO values**:
```javascript
// Unpack AO for debugging
function debugAO(aoLow, aoHigh) {
  const aos = [];
  for (let i = 0; i < 24; i++) {
    const val = (i < 12)
      ? Math.floor(aoLow / Math.pow(4, i)) % 4
      : Math.floor(aoHigh / Math.pow(4, i - 12)) % 4;
    aos.push(val);
  }
  console.table(aos);  // Shows all 24 vertex AO values
}
```

---

## 5. Performance Tips

### 5.1 When to Use Batch vs Incremental

| Scenario | Request Type | Rationale |
|----------|--------------|-----------|
| Chunk generation | `COMPUTE_AO_BATCH` | Compute all at once |
| Player places 1 block | `COMPUTE_AO_INCREMENTAL` | Fast, targeted update |
| Player places 5+ blocks | Batch incrementals | Reduce message overhead |
| Explosion (many blocks) | Custom batch | Group affected blocks |

### 5.2 Expected Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| Chunk gen AO time | <30ms | Worker `duration` in response |
| Single block update | <5ms | Main thread delta |
| Frame time impact | <15% | FPS counter comparison |

---

## 6. Common Issues

### 6.1 Missing AO Shadows

**Symptom**: Block appears uniformly lit, no corner shadows.

**Checklist**:
1. Is block solid? (`getBlockProperties(type).isSolid`)
2. Is block non-transparent? (`!getBlockProperties(type).isTransparent`)
3. Does mesh have `aAoLow`/`aAoHigh` attributes?
4. Did Worker response include this block in `aoData`?

### 6.2 AO Discontinuity at Chunk Boundaries

**Symptom**: Visible seam in AO shadows between chunks.

**Solution**:
```javascript
// Provide adjacent chunk data for cross-chunk AO
const worldChunks = [
  { cx: chunk.cx - 1, cz: chunk.cz, blockData: leftChunkData },
  { cx: chunk.cx + 1, cz: chunk.cz, blockData: rightChunkData },
  // ... etc
];

const request = {
  type: 'COMPUTE_AO_BATCH',
  data: {
    // ...
    worldChunks  // ← Include for edge blocks
  }
};
```

### 6.3 AO Not Updating After Block Placement

**Symptom**: New block has no AO, or neighbors don't update.

**Debug Steps**:
1. Check if `COMPUTE_AO_INCREMENTAL` request was sent
2. Verify Worker response includes affected neighbors
3. Confirm `applyToMesh()` was called with new AO data
4. Check InstancedMesh attribute buffers are marked `needsUpdate = true`

---

## 7. Testing

### 7.1 Manual Testing

**Test 1: Chunk Generation**
```
1. Generate new world
2. Fly around, observe corner shadows on all solid blocks
3. Check chunk boundaries for continuity
```

**Test 2: Dynamic Placement**
```
1. Place stone block in open area
2. Observe AO shadows appear within 1 frame
3. Place adjacent block, observe first block's AO update
```

**Test 3: Block Types**
```
1. Place grass, stone, wood, glass blocks
2. Verify AO on solid+opaque (grass, stone, wood)
3. Verify NO AO on transparent (glass)
```

### 7.2 Automated Testing

```javascript
// test-ao.js
describe('AO Refactoring', () => {
  it('should apply AO to all solid+opaque blocks', () => {
    const types = ['stone', 'dirt', 'wood', 'bricks'];
    for (const type of types) {
      const props = getBlockProperties(type);
      expect(props.isSolid && !props.isTransparent).to.be.true;
    }
  });

  it('should exclude transparent blocks from AO', () => {
    const types = ['glass_block', 'water', 'leaves'];
    for (const type of types) {
      const props = getBlockProperties(type);
      expect(props.isTransparent).to.be.true;
    }
  });
});
```

---

## 8. File Locations

| File | Purpose |
|------|---------|
| `src/core/AOSystem.js` | New: Main AO coordinator |
| `src/utils/AOUtils.js` | New: AO helper functions |
| `src/workers/FaceCullingWorker.js` | Extended: AO computation |
| `src/constants/BlockData.js` | Modified: Removed `isAOEnabled` |
| `src/core/MaterialManager.js` | Modified: Simplified AO detection |
| `src/world/Chunk.js` | Modified: AO data integration |

---

## 9. Resources

- [research.md](./research.md) - Technical analysis
- [data-model.md](./data-model.md) - Data structures
- [ao-worker-protocol.md](./contracts/ao-worker-protocol.md) - Worker message format
- [spec.md](./spec.md) - Feature requirements
