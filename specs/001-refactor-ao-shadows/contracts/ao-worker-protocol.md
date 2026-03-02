# AO Worker Protocol

**Feature**: AO 阴影渲染逻辑重构
**Branch**: `001-refactor-ao-shadows`

---

## 1. Message Types

### 1.1 Request Types (Main Thread → Worker)

#### COMPUTE_AO_BATCH

Compute AO for entire chunk during generation.

```typescript
{
  type: 'COMPUTE_AO_BATCH';
  id: number;
  data: {
    blocks: Array<{
      x: number;
      y: number;
      z: number;
      type: string;
    }>;
    blockData: Record<string, string>;  // "x,y,z" → type
    cx: number;
    cz: number;
    worldChunks?: Array<{
      cx: number;
      cz: number;
      blockData: Record<string, string>;
    }>;
  };
}
```

#### COMPUTE_AO_INCREMENTAL

Compute AO for dynamic block changes.

```typescript
{
  type: 'COMPUTE_AO_INCREMENTAL';
  id: number;
  data: {
    position: {x: number, y: number, z: number};
    operation: 'PLACE' | 'DESTROY';
    blockType: string;
    blockData: Record<string, string>;
    radius?: number;  // Default: 1
  };
}
```

### 1.2 Response Types (Worker → Main Thread)

#### AO_RESULT

Successful AO computation result.

```typescript
{
  type: 'AO_RESULT';
  id: number;  // Matches request ID
  data: {
    aoData: Array<{
      x: number;
      y: number;
      z: number;
      type: string;
      aoLow: number;
      aoHigh: number;
      visibility: number;
    }>;
    affectedNeighbors: Array<{
      x: number;
      y: number;
      z: number;
    }>;
    duration: number;  // ms
    cx?: number;
    cz?: number;
  };
}
```

#### AO_ERROR

AO computation failed.

```typescript
{
  type: 'AO_ERROR';
  id: number;
  error: {
    message: string;
    stack?: string;
  };
  data?: {
    cx?: number;
    cz?: number;
  };
}
```

---

## 2. Usage Examples

### 2.1 Batch AO Computation

```javascript
// Main thread: request batch AO
const requestId = Date.now();
const request = {
  type: 'COMPUTE_AO_BATCH',
  id: requestId,
  data: {
    blocks: chunkBlocks,
    blockData: chunkBlockData,
    cx: chunk.cx,
    cz: chunk.cz,
    worldChunks: adjacentChunks
  }
};

// Set up response handler
const handler = (e) => {
  if (e.data.type === 'AO_RESULT' && e.data.id === requestId) {
    const aoData = e.data.data.aoData;
    // Apply AO data to chunk...
    self.removeEventListener('message', handler);
  }
};
self.addEventListener('message', handler);

// Send request
worker.postMessage(request);
```

### 2.2 Incremental AO Update

```javascript
// Main thread: request incremental AO (player placed block)
const requestId = Date.now();
const request = {
  type: 'COMPUTE_AO_INCREMENTAL',
  id: requestId,
  data: {
    position: {x: 100, y: 64, z: 200},
    operation: 'PLACE',
    blockType: 'stone',
    blockData: getNeighborhoodData(100, 64, 200),
    radius: 1
  }
};

// Send and handle response
worker.postMessage(request, [], {
  onmessage: (e) => {
    if (e.data.type === 'AO_RESULT' && e.data.id === requestId) {
      updateAOForBlocks(e.data.data.aoData);
    }
  }
});
```

---

## 3. Error Handling

### 3.1 Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `Invalid block type` | Block type not in BLOCK_DATA | Validate block type before request |
| `Missing neighbor data` | blockData incomplete for neighborhood | Include all blocks within radius |
| `Cross-chunk lookup failed` | worldChunks not provided for edge blocks | Provide adjacent chunk data |

### 3.2 Retry Logic

```javascript
async function computeAOWithRetry(request, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await sendAORequest(request);
      return result;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.warn(`AO computation retry ${i + 1}/${maxRetries}:`, error);
    }
  }
}
```

---

## 4. Performance Guidelines

### 4.1 Batching

- Batch AO requests when possible (e.g., multiple block placements in same chunk)
- Use `COMPUTE_AO_BATCH` for chunk generation
- Use `COMPUTE_AO_INCREMENTAL` for 1-5 block changes
- For 6+ block changes, consider batching into single incremental request

### 4.2 Data Transfer

- Use Transferable Objects for large blockData arrays
- Minimize data copying by reusing buffers
- Compress blockData keys when possible

```javascript
// Example: Transferable AO buffer
const aoBuffer = new Uint32Array(aoData.length * 2);
// Fill buffer...
worker.postMessage(
  { type: 'AO_RESULT', data: aoBuffer.buffer },
  [aoBuffer.buffer]  // Transfer, don't copy
);
```

---

## 5. Worker Implementation Notes

### 5.1 Message Handler Structure

```javascript
// FaceCullingWorker.js or dedicated AOWorker.js
self.onmessage = function(e) {
  const { type, id, data } = e.data;

  try {
    let result;

    switch (type) {
      case 'COMPUTE_AO_BATCH':
        result = computeBatchAO(data);
        break;
      case 'COMPUTE_AO_INCREMENTAL':
        result = computeIncrementalAO(data);
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({
      type: 'AO_RESULT',
      id,
      data: result
    });
  } catch (error) {
    self.postMessage({
      type: 'AO_ERROR',
      id,
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
};
```

### 5.2 AO Computation Functions

```javascript
function computeBatchAO({ blocks, blockData, cx, cz, worldChunks }) {
  const startTime = performance.now();
  const aoData = [];
  const affectedNeighbors = new Set();

  for (const block of blocks) {
    if (!isAOApplicable(block.type)) continue;

    const ao = calculateAOForBlock(block, blockData, worldChunks);
    aoData.push(ao);

    // Mark neighbors for potential update
    addNeighborsToSet(affectedNeighbors, block.x, block.y, block.z);
  }

  return {
    aoData,
    affectedNeighbors: Array.from(affectedNeighbors),
    duration: performance.now() - startTime,
    cx,
    cz
  };
}

function computeIncrementalAO({ position, operation, blockType, blockData, radius = 1 }) {
  const startTime = performance.now();
  const aoData = [];
  const affectedNeighbors = [];

  if (operation === 'PLACE' && isAOApplicable(blockType)) {
    // Compute AO for new block
    const block = { x: position.x, y: position.y, z: position.z, type: blockType };
    aoData.push(calculateAOForBlock(block, blockData));
  }

  // Compute AO for affected neighbors
  const neighborPositions = getNeighborsWithinRadius(position, radius);
  for (const pos of neighborPositions) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    const type = blockData[key];
    if (type && isAOApplicable(type)) {
      const block = { x: pos.x, y: pos.y, z: pos.z, type };
      aoData.push(calculateAOForBlock(block, blockData));
      affectedNeighbors.push(pos);
    }
  }

  return {
    aoData,
    affectedNeighbors,
    duration: performance.now() - startTime
  };
}
```

---

## 6. Testing

### 6.1 Unit Tests

```javascript
// Test batch AO request/response
describe('AO Worker Protocol', () => {
  it('should compute batch AO correctly', async () => {
    const blocks = [{x: 0, y: 0, z: 0, type: 'stone'}];
    const blockData = {'0,0,0': 'stone'};

    const result = await sendBatchAORequest(blocks, blockData);

    expect(result.aoData).to.have.length(1);
    expect(result.aoData[0].aoLow).to.be.a('number');
    expect(result.aoData[0].aoHigh).to.be.a('number');
  });

  it('should handle incremental AO updates', async () => {
    const result = await sendIncrementalAORequest(
      {x: 0, y: 0, z: 0},
      'PLACE',
      'stone',
      {'0,0,0': 'stone'}
    );

    expect(result.affectedNeighbors).to.have.length.greaterThan(0);
  });
});
```
