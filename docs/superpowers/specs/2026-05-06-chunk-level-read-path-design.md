# Chunk-Level Read Path Design

> **Problem:** `getRegionRecord` returns the entire 8×8 region (9MB) to read a single chunk's data. Worker-side region caching eliminates repeated DB reads while keeping transfer size at 100KB.

## 1. Root Cause

| Component | Current Behavior | Problem |
|-----------|-----------------|---------|
| `WorldRuntime.ensureChunkData(cx, cz)` | Calls `ensureRegion(rx, rz)` → `getRegionRecord` | Downloads 9MB region to get 1/64 (100KB) |
| `WorldRuntime.ensureRegion` | Caches full region on main thread | 9MB region cached in main thread memory |
| `PersistenceWorker` | Reads and returns full region from IndexedDB | 9MB structured clone transfer per region miss |

Data flow:
```
ensureChunkData(cx, cz)
  → ensureRegion(rx, rz)
    → worldStore.getRegionRecord(rx, rz)
      → PersistenceWorker.postMessage('getRegionRecord')
        → IndexedDB read (9MB)
        → postMessage returns 9MB region    ← bottleneck
    → region.chunks[chunkKey]               ← client-side crop on main thread
```

## 2. Proposed Architecture

### Core Change

Move region caching and chunk extraction from the main thread to the PersistenceWorker. The Worker becomes the authoritative cache and returns only the requested chunk's data.

### New Data Flow

```
ensureChunkData(cx, cz)
  → ensureChunkRecord(cx, cz)               ← new method
    → worldStore.getChunkRecord(cx, cz)      ← new method
      → PersistenceWorker.postMessage('getChunkRecord', { regionKey, chunkKey })
        → Worker checks regionCache           ← Worker-side LRU cache
          - HIT: crop from cache, return chunk (100KB)
          - MISS: read region from IndexedDB, cache it, crop, return chunk (100KB)
```

### Transfer Size Comparison

| Scenario | Before | After |
|----------|--------|-------|
| First chunk in a new region | 9MB | 100KB |
| 2nd chunk in same region | 9MB | 100KB |
| 49 chunks across 4 regions | 36MB | 4.9MB |

## 3. Component Design

### 3.1 PersistenceWorker — Region Cache + getChunkRecord

Add an in-memory LRU cache inside the Worker:

```js
const regionCache = new Map(); // regionKey → regionData
const REGION_CACHE_MAX_SIZE = 6; // Keep 6 regions (~54MB max)

function getChunkRecord(regionKey, chunkKey, cx, cz) {
  let region = regionCache.get(regionKey);
  if (!region) {
    region = performTransaction(db, WORLD_REGION_STORE, 'readonly',
      (store) => store.get(regionKey)
    );
    if (region) {
      regionCache.set(regionKey, region.data);
      // LRU eviction
      while (regionCache.size > REGION_CACHE_MAX_SIZE) {
        const firstKey = regionCache.keys().next().value;
        regionCache.delete(firstKey);
      }
    } else {
      return null;
    }
  }
  const chunkData = region.chunks?.[chunkKey];
  if (!chunkData) return null;
  return {
    cx, cz,
    blockData: chunkData.blockData || {},
    staticEntities: chunkData.staticEntities || [],
    runtimeSeedData: chunkData.runtimeSeedData || {},
    runtimeEntities: chunkData.runtimeEntities || { turrets: [], zombieNests: [], minecarts: [] }
  };
}
```

New `postMessage` action:
```js
case 'getChunkRecord':
  result = await getChunkRecord(payload.regionKey, payload.chunkKey, payload.cx, payload.cz);
  break;
```

### 3.2 WorldStore — getChunkRecord Method

Add `getChunkRecord(cx, cz)` to `WorldStore.js`:

```js
async getChunkRecord(cx, cz) {
  const { rx, rz } = this.chunkToRegion(cx, cz);
  const regionKey = this.regionKey(rx, rz);
  const chunkKey = this.chunkKey(cx, cz);
  return getPersistenceService().postMessage('getChunkRecord', {
    regionKey, chunkKey, cx, cz
  });
}
```

Note: This **shadows** the existing `getChunkRecord` method which currently calls `getRegionRecord` and crops on the main thread. The old implementation becomes dead code and will be removed.

### 3.3 WorldRuntime — ensureChunkRecord

Replace `ensureChunkData`'s internal path to use chunk-level reads:

```js
async ensureChunkData(cx, cz) {
  const chunkRecord = await this._worldStore.getChunkRecord(cx, cz);

  if (!chunkRecord) {
    return { status: 'missing-chunk' };
  }

  // Hydrate legacy entities if needed
  if (!chunkRecord.runtimeEntities) {
    await this._hydrateLegacyRuntimeEntities(cx, cz, chunkRecord);
  }

  return {
    status: 'ready',
    chunkRecord
  };
}
```

`ensureRegion` is no longer called from the read path. It remains available for:
- `flushAllDirty` (write path: still writes regions)
- `expandWorld` (may still need region-level prefetch)

### 3.4 Region Cache Eviction Strategy

Worker-side cache uses LRU with max 6 regions (~54MB). This is chosen because:
- Player render distance = 3 → 7×7 = 49 chunks
- 49 chunks span at most 4 regions
- Cache 6 regions covers the player's area + 1 margin for smooth boundary transitions
- 54MB in a Worker is acceptable (dedicated process, no UI thread impact)

The existing main-thread `_regionCache` in `WorldRuntime` is **preserved** for backward compatibility but no longer the primary read path. It can be cleaned up in a future refactor.

## 4. Files Changed

| File | Change |
|------|--------|
| `src/workers/PersistenceWorker.js` | Add `regionCache`, `getChunkRecord()` function, new `postMessage` action |
| `src/world/WorldStore.js` | Replace `getChunkRecord` implementation to call Worker action directly |
| `src/world/WorldRuntime.js` | Simplify `ensureChunkData` to call `getChunkRecord` instead of `ensureRegion` |

## 5. Write Path (Unchanged)

Write path remains region-level for batch efficiency:
- `saveRegionRecord` → writes entire region to IndexedDB
- `applyRegionPatch` → reads-modifies-writes region in Worker
- `flushAllDirty` → batches chunk mutations into region writes

Read and write paths are decoupled: reads are chunk-level (precise), writes are region-level (batch efficient).

## 6. Error Handling

| Error | Behavior |
|-------|----------|
| IndexedDB read fails | Return null, chunk falls back to generation path |
| Chunk not found in region | Return `{ status: 'missing-chunk' }` |
| Region not found in IndexedDB | Return `{ status: 'missing-region' }` |
| Worker communication fails | Promise rejects, caller retries on next frame |

## 7. Testing Strategy

- Existing tests in `src/tests/test-world-runtime.js` mock `getRegionRecord` — update mocks to use `getChunkRecord`
- Existing tests in `src/tests/test-world.js` for region cache — keep for write path, add new test for chunk-level read
- Manual verification: open browser, enable `CHUNK_PERF_DEBUG`, observe `runtime-chunk-record-db` drops from ~1000ms to <50ms
