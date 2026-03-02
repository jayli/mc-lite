# AO Data Model & Design

**Feature**: AO 阴影渲染逻辑重构
**Branch**: `001-refactor-ao-shadows`
**Date**: 2026-03-02

---

## 1. Core Data Structures

### 1.1 AO Vertex Data (Per Block)

**Structure**:
```typescript
interface AOVertexData {
  x: number;           // Block world X coordinate (integer)
  y: number;           // Block world Y coordinate (integer)
  z: number;           // Block world Z coordinate (integer)
  type: string;        // Block type identifier (e.g., 'stone', 'grass')
  aoLow: number;       // Packed AO data for vertices 0-11 (24 bits used)
  aoHigh: number;      // Packed AO data for vertices 12-23 (24 bits used)
  visibility: number;  // Face visibility mask (6 bits, 0-63)
  orientation: number; // Block rotation/orientation (0-3)
}
```

**AO Packing Format**:
```
aoLow (32-bit integer):
  Bits 0-1:   Vertex 0 AO (0-3)
  Bits 2-3:   Vertex 1 AO (0-3)
  Bits 4-5:   Vertex 2 AO (0-3)
  ...
  Bits 22-23: Vertex 11 AO (0-3)
  Bits 24-31: Unused (reserved)

aoHigh (32-bit integer):
  Bits 0-1:   Vertex 12 AO (0-3)
  Bits 2-3:   Vertex 13 AO (0-3)
  ...
  Bits 22-23: Vertex 23 AO (0-3)
  Bits 24-31: Unused (reserved)

Total: 8 bytes per block for AO data
```

**Vertex-to-Face Mapping**:
```
Face 0 (+X): Vertices 0-3   → aoLow bits 0-7
Face 1 (-X): Vertices 4-7   → aoLow bits 8-15
Face 2 (+Y): Vertices 8-11  → aoLow bits 16-23
Face 3 (-Y): Vertices 12-15 → aoHigh bits 0-7
Face 4 (+Z): Vertices 16-19 → aoHigh bits 8-15
Face 5 (-Z): Vertices 20-23 → aoHigh bits 16-23
```

### 1.2 Block Properties (BlockData.js)

**Simplified Structure** (removing `isAOEnabled`):
```typescript
interface BlockProperties {
  isSolid: boolean;         // Solid (participates in physics/AO)
  isTransparent: boolean;   // Transparent (excluded from AO)
  isRendered: boolean;      // Has render mesh
  isShadowEnabled: boolean; // Casts/receives shadows
  isIndestructible: boolean;// Cannot be destroyed (optional)
  geometryType: string;     // 'box' | 'flower' | 'vine' | 'lilypad' | etc.
}

// Computed property (not stored):
isAOApplicable = isSolid && !isTransparent
```

**Default Properties**:
```javascript
const DEFAULT_PROPERTIES = {
  isSolid: true,
  isTransparent: false,
  isRendered: true,
  isShadowEnabled: true,
  geometryType: 'box'
};
```

### 1.3 Chunk AO Data

**Structure**:
```typescript
interface ChunkAOData {
  cx: number;                  // Chunk X coordinate
  cz: number;                  // Chunk Z coordinate
  aoData: Map<string, AOVertexData>;  // Key: "x,y,z" → AO data
  solidBlocks: string[];       // Keys of solid blocks (for AO neighbor checks)
  visibleKeys: string[];       // Keys of visible blocks (for rendering)
  allBlockTypes: Record<string, string>; // All block types (including occluded)
  version: number;             // AO data version (for cache invalidation)
}
```

---

## 2. AO Computation Interfaces

### 2.1 Worker Request Types

**Batch AO Computation** (for chunk generation):
```typescript
interface BatchAORequest {
  type: 'COMPUTE_AO_BATCH';
  id: number;  // Request ID for matching response
  data: {
    blocks: Array<{x: number, y: number, z: number, type: string}>;
    blockData: Record<string, string>;  // Full block data: "x,y,z" → type
    cx: number;
    cz: number;
    worldChunks?: Array<{
      cx: number;
      cz: number;
      blockData: Record<string, string>;
    }>;  // Optional: adjacent chunks for cross-chunk AO
  };
}
```

**Incremental AO Update** (for dynamic block changes):
```typescript
interface IncrementalAORequest {
  type: 'COMPUTE_AO_INCREMENTAL';
  id: number;
  data: {
    position: {x: number, y: number, z: number};
    operation: 'PLACE' | 'DESTROY';
    blockType: string;  // New block type (for PLACE) or '' (for DESTROY)
    neighborhoodRadius: number;  // Typically 1 (immediate neighbors)
    blockData: Record<string, string>;  // Local neighborhood data
  };
}
```

### 2.2 Worker Response Types

**AO Computation Result**:
```typescript
interface AOResultResponse {
  type: 'AO_RESULT';
  id: number;  // Matches request ID
  data: {
    aoData: Array<AOVertexData>;      // Computed AO data for affected blocks
    affectedNeighbors: Array<{x: number, y: number, z: number}>;  // Blocks needing AO update
    duration: number;  // Computation time in ms
    cx: number;
    cz: number;
  };
}
```

**Error Response**:
```typescript
interface AOErrorResponse {
  type: 'AO_ERROR';
  id: number;
  error: {
    message: string;
    stack?: string;
  };
}
```

---

## 3. AO System Architecture

### 3.1 AOSystem Class (New: `src/core/AOSystem.js`)

**Responsibilities**:
- Queue AO computation requests (batch and incremental)
- Manage Worker communication
- Merge AO results into Chunk data
- Update InstancedMesh vertex attributes

**Public API**:
```javascript
class AOSystem {
  // Initialize with Worker reference
  constructor(worker: Worker);

  // Compute AO for entire chunk (during generation)
  computeChunkAO(
    blocks: Array<{x, y, z, type}>,
    blockData: Record<string, string>,
    cx: number,
    cz: number,
    worldChunks?: Array<{cx, cz, blockData}>
  ): Promise<AOResultResponse>;

  // Compute AO for single block change (dynamic update)
  computeBlockAO(
    position: {x, y, z},
    operation: 'PLACE' | 'DESTROY',
    blockType: string,
    blockData: Record<string, string>
  ): Promise<AOResultResponse>;

  // Apply AO data to InstancedMesh
  applyToMesh(
    mesh: THREE.InstancedMesh,
    aoData: AOVertexData[],
    startIndex: number
  ): void;

  // Get performance stats
  getStats(): {
    pendingRequests: number;
    averageDuration: number;
    totalComputed: number;
  };
}
```

### 3.2 AOUtils Functions (New: `src/utils/AOUtils.js`)

**Core Functions**:
```javascript
// Pack 24 AO values (0-3) into two 32-bit integers
function packAOData(aos: Uint8Array[24]): { aoLow: number, aoHigh: number };

// Unpack AO value for specific vertex
function unpackAOValue(aoLow: number, aoHigh: number, vertexIdx: number): number;

// Unpack all AO values (for debugging)
function unpackAllAO(aoLow: number, aoHigh: number): number[];

// Check if AO applies to block type
function isAOApplicable(blockType: string): boolean;

// Get AO neighbor coordinates for a face corner
function getAONeighbors(x: number, y: number, z: number, faceIdx: number, cornerIdx: number): {
  side1: {x, y, z},
  side2: {x, y, z},
  corner: {x, y, z}
};
```

---

## 4. State Transitions

### 4.1 Block Lifecycle with AO

```
[Air] ─────(Player places block)─────> [Solid Block]
    │                                       │
    │                                       ▼
    │                              [AO Computed]
    │                                       │
    │                                       ▼
    │                              [AO Applied to Mesh]
    │                                       │
    └───────────────────────────────────────┘
            (Player destroys block)
```

### 4.2 AO Data Flow

```
Chunk Generation (WorldWorker):
  1. Generate terrain blocks
  2. Compute AO for all solid+opaque blocks
  3. Pack AO into aoLow/aoHigh
  4. Send to main thread with chunk data

Dynamic Update (Main Thread → FaceCullingWorker):
  1. Player places/destroys block
  2. FaceCullingSystem queues AO request
  3. FaceCullingWorker computes incremental AO
  4. Main thread updates affected InstancedMesh instances
```

---

## 5. Validation Rules

### 5.1 AO Data Validation

```javascript
// Validate AO value range (0-3)
function validateAOValue(ao: number): boolean {
  return Number.isInteger(ao) && ao >= 0 && ao <= 3;
}

// Validate packed AO data
function validatePackedAO(aoLow: number, aoHigh: number): boolean {
  for (let i = 0; i < 24; i++) {
    const ao = unpackAOValue(aoLow, aoHigh, i);
    if (!validateAOValue(ao)) return false;
  }
  return true;
}
```

### 5.2 Block Property Validation

```javascript
// Validate block has required properties
function validateBlockProperties(props: BlockProperties): boolean {
  return typeof props.isSolid === 'boolean' &&
         typeof props.isTransparent === 'boolean';
}
```

---

## 6. Performance Considerations

### 6.1 Memory Optimization

**AO Data Size**:
- Per block: 8 bytes (aoLow + aoHigh)
- Per chunk (10,000 visible blocks): ~80 KB
- Total (render distance 3, ~27 chunks): ~2.2 MB

**Transferable Objects**:
```javascript
// Use ArrayBuffer for efficient Worker transfer
const aoBuffer = new ArrayBuffer(aoData.length * 8);
const aoView = new Uint32Array(aoBuffer);
// Fill with AO data...
worker.postMessage({ type: 'AO_RESULT', data: aoBuffer }, [aoBuffer]);
```

### 6.2 Computation Optimization

**Neighbor Lookup Cache**:
```javascript
// Pre-compute neighbor offsets for each face corner
const AO_NEIGHBOR_OFFSETS = [
  // Face 0 (+X): 4 corners
  [
    { side1: [0,1,0], side2: [0,0,1], corner: [0,1,1] },  // V0
    { side1: [0,1,0], side2: [0,0,-1], corner: [0,1,-1] }, // V1
    // ... etc
  ],
  // ... Faces 1-5
];
```

---

## 7. Integration with Existing Systems

### 7.1 Chunk.js Integration

```javascript
// In mergeChunk() or similar:
async function applyAOData(chunkData, aoResult) {
  for (const aoBlock of aoResult.aoData) {
    const key = `${aoBlock.x},${aoBlock.y},${aoBlock.z}`;
    chunkData.aoData.set(key, aoBlock);
  }

  // Update InstancedMesh attributes
  for (const [type, blocks] of Object.entries(chunkData.d)) {
    const mesh = chunkData.meshes.get(type);
    if (mesh) {
      aoSystem.applyToMesh(mesh, blocks, 0);
    }
  }
}
```

### 7.2 MaterialManager.js Simplification

**Before**:
```javascript
const useAO = props.isAOEnabled;
if (useAO) this._applyShaderModifications(mat);
```

**After**:
```javascript
// AO applies to ALL solid+opaque blocks
const useAO = !props.isTransparent && props.isSolid;
if (useAO) this._applyShaderModifications(mat);
```

---

## 8. Glossary

| Term | Definition |
|------|------------|
| **AO** | Ambient Occlusion - shading technique for corner shadowing |
| **Solid Block** | Block with `isSolid: true` (participates in AO) |
| **Transparent Block** | Block with `isTransparent: true` (excluded from AO) |
| **Face Culling** | Hiding faces between adjacent blocks |
| **InstancedMesh** | Three.js class for efficient multi-mesh rendering |
| **aoLow/aoHigh** | Packed AO data (24 vertices × 2 bits = 48 bits total) |

---

## 9. References

- [research.md](./research.md) - Technical analysis of existing implementation
- [spec.md](./spec.md) - Feature requirements
- [plan.md](./plan.md) - Implementation plan
