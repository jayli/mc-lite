# Fix P0 Region Generation Bugs - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 data-correctness defects in the region-level pre-generation pipeline: seed sync, missing structure preload, entity array bloat, and async persistence race condition.

**Architecture:** Minimal surgical fixes in two files. `WorldWorker.js` gets seed sync, preload await, and per-chunk entity filtering. `WorldGenerationService.js` gets an `await` on `saveRegionRecord`. No refactors, no format changes.

**Tech Stack:** Vanilla ES Modules, no bundler. Browser-based tests via `src/tests/index.html`. Lint via `npm run lint`.

---

## File Map

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `src/workers/WorldWorker.js` | Worker-side region generation and chunk generation | Modify 3 locations |
| `src/world/WorldGenerationService.js` | Main-thread orchestration of region pre-generation | Modify 1 location |

---

### Task 1: Seed Sync in `handleRegionGeneration`

**Files:**
- Modify: `src/workers/WorldWorker.js:1376` (`handleRegionGeneration`)

**Context:** The chunk-level path in `onmessage` calls `setSeed(seed)` before generation. The region-level path (`handleRegionGeneration`) does not. `terrainGen.getBiome()` and `noise()` rely on `WORLD_CONFIG.SEED` global state. If a custom seed is passed, pre-generated terrain will diverge from runtime terrain.

- [ ] **Step 1: Add `setSeed(seed)` to `handleRegionGeneration`**

  In `src/workers/WorldWorker.js`, at the very top of `handleRegionGeneration`, add the seed sync call right after destructuring `data`:

  ```javascript
  async function handleRegionGeneration(data) {
    const { rx, rz, seed, taskId } = data;
    const REGION_CHUNK_SIZE = 8;

    // Sync seed so terrainGen and noise() use the same seed as the runtime path
    setSeed(seed);

    // 1. Region-level shared state
    const regionCandidateIndex = new StructureCandidateIndex();
    ...
  ```

- [ ] **Step 2: Verify `setSeed` is in scope**

  `setSeed` is already imported/defined at the module level in `WorldWorker.js` (used by the chunk-level path at line 1450). No additional imports needed.

- [ ] **Step 3: Run lint**

  ```bash
  npm run lint
  ```

  Expected: No new errors or warnings in `src/workers/WorldWorker.js`.

---

### Task 2: Await Structure Preload in `handleRegionGeneration`

**Files:**
- Modify: `src/workers/WorldWorker.js:1376` (`handleRegionGeneration`)

**Context:** `structuresPreload` is a module-level Promise in `WorldWorker.js` (line 57). The chunk-level path awaits it before generation. The region-level path does not. On a cold worker start, `generateRegion` may run before JSON structures are loaded, causing silent omission of all JSON-driven buildings.

- [ ] **Step 1: Add `await structuresPreload` to `handleRegionGeneration`**

  Immediately after `setSeed(seed)` from Task 1, add:

  ```javascript
  async function handleRegionGeneration(data) {
    const { rx, rz, seed, taskId } = data;
    const REGION_CHUNK_SIZE = 8;

    // Sync seed so terrainGen and noise() use the same seed as the runtime path
    setSeed(seed);

    // Wait for structure JSON data to be ready before generating
    await structuresPreload;

    // 1. Region-level shared state
    const regionCandidateIndex = new StructureCandidateIndex();
    ...
  ```

- [ ] **Step 2: Verify `structuresPreload` is in scope**

  `structuresPreload` is declared at module level in `WorldWorker.js` (lines 57-83). No additional imports needed.

- [ ] **Step 3: Run lint**

  ```bash
  npm run lint
  ```

  Expected: No new errors or warnings.

---

### Task 3: Per-Chunk Entity Filtering in `generateChunkWithSharedState`

**Files:**
- Modify: `src/workers/WorldWorker.js:1279` (`generateChunkWithSharedState` return statement)

**Context:** `modGunMan` and `rovers` are region-level shared arrays that accumulate entities across all 64 chunks in a region. Currently `generateChunkWithSharedState` returns `[...modGunMan]` and `[...rovers]`, meaning later chunks persist the entire region's entity list. This causes ~64x data bloat in IndexedDB.

**Fix:** Filter entities to only those whose coordinates fall within the current chunk's bounds before returning.

- [ ] **Step 1: Add filtering logic before the return statement**

  In `src/workers/WorldWorker.js`, inside `generateChunkWithSharedState`, replace the final `return` block (around line 1279) with:

  ```javascript
  // region 生成路径没有 snapshot，直接构建方块数据
  const blockDataBlocks = buildBlockDataBlocks(blockMap);
  const routing = buildChunkRouting(blockDataBlocks, [], cx, cz, []);

  // 过滤实体：只保留坐标落在当前 chunk 边界内的实体
  const chunkMinX = cx * CHUNK_SIZE_LOCAL;
  const chunkMaxX = (cx + 1) * CHUNK_SIZE_LOCAL;
  const chunkMinZ = cz * CHUNK_SIZE_LOCAL;
  const chunkMaxZ = (cz + 1) * CHUNK_SIZE_LOCAL;

  const isInChunkBounds = (e) => (
    e.x >= chunkMinX && e.x < chunkMaxX &&
    e.z >= chunkMinZ && e.z < chunkMaxZ
  );

  const chunkModGunMan = modGunMan.filter(isInChunkBounds);
  const chunkRovers = rovers.filter(isInChunkBounds);

  return {
    blockDataBlocks,
    routing,
    modGunMan: chunkModGunMan,
    rovers: chunkRovers,
    structureCenters: [...structureCenters],
    entities: { modGunMan: chunkModGunMan, rovers: chunkRovers }
  };
  ```

  **Important:** `CHUNK_SIZE_LOCAL` is already defined as `16` at the top of `generateChunkWithSharedState` (line 503).

- [ ] **Step 2: Confirm the old return statement is fully replaced**

  The old code was:
  ```javascript
  return {
    blockDataBlocks,
    routing,
    modGunMan: [...modGunMan],
    rovers: [...rovers],
    structureCenters: [...structureCenters],
    entities: { modGunMan: [...modGunMan], rovers: [...rovers] }
  };
  ```

  Ensure it is replaced by the filtered version above.

- [ ] **Step 3: Run lint**

  ```bash
  npm run lint
  ```

  Expected: No new errors or warnings.

---

### Task 4: Await `saveRegionRecord` in `_generateRegion`

**Files:**
- Modify: `src/world/WorldGenerationService.js:247` (`_generateRegion` worker callback)

**Context:** `_generateRegion` calls `getWorldStore().saveRegionRecord(...)` without `await`, then immediately `resolve(regionRecord)`. The caller (`generateInitialWorld`) may proceed while the IndexedDB write is still in flight. If the page crashes or reloads at this moment, the region data is lost.

- [ ] **Step 1: Add `await` to `saveRegionRecord`**

  In `src/world/WorldGenerationService.js`, inside the `workerCallbacks.set(taskId, (data) => { ... })` block, change:

  ```javascript
  // Before:
  getWorldStore().saveRegionRecord(rx, rz, regionRecord);

  // After:
  await getWorldStore().saveRegionRecord(rx, rz, regionRecord);
  ```

  The surrounding callback function is already inside a `new Promise((resolve) => { ... })` block, so adding `await` is valid — the callback itself does not need to be marked `async` because the worker callback mechanism does not expect a return value; it just needs to delay the `resolve()` call.

  Wait — the callback is `workerCallbacks.set(taskId, (data) => { ... })`. To use `await`, the callback must be `async`. Change the callback signature:

  ```javascript
  workerCallbacks.set(taskId, async (data) => {
    // ... build regionRecord ...

    await getWorldStore().saveRegionRecord(rx, rz, regionRecord);

    resolve(regionRecord);
  });
  ```

- [ ] **Step 2: Verify no other callers are broken**

  Check how `workerCallbacks` invokes its stored callbacks. In `ChunkConsolidation.js` or wherever `workerCallbacks` fires, it should simply call `callback(data)` without awaiting the return value. An `async` callback returns a Promise that is safely ignored by synchronous callers.

  Search for where worker callbacks are invoked:
  ```bash
  grep -n "workerCallbacks.get\|workerCallbacks.forEach" src/**/*.js
  ```
  Or inspect `src/world/ChunkConsolidation.js` for the callback dispatch logic. The typical pattern is:
  ```javascript
  const callback = workerCallbacks.get(taskId);
  if (callback) callback(data);
  ```
  Calling an `async` function this way is safe — the Promise is fire-and-forget from the dispatcher's perspective, which is exactly what we want.

- [ ] **Step 3: Run lint**

  ```bash
  npm run lint
  ```

  Expected: No new errors or warnings.

---

### Task 5: Verify Existing Cross-Region Tests Still Pass

**Files:**
- Test: `src/tests/test-world-generation-cross-region.js`

**Context:** This test file mocks `_worldStore.saveRegionRecord` as an async function and validates region ownership rules. The Task 4 change makes `_generateRegion` actually await the mock, which should improve test reliability.

- [ ] **Step 1: Start the dev server**

  ```bash
  npm run start
  ```

- [ ] **Step 2: Open the test page in a browser**

  Navigate to `http://localhost:8080/src/tests/index.html`

- [ ] **Step 3: Run the cross-region test**

  Look for the test group labeled "WorldGenerationService 跨 region owner 归属测试" and run it.

  Expected: All 3 tests pass.
  - `_mergeOverflowBlocks - 应返回可诊断的 unresolved overflow 摘要`
  - `generateRegion - 源 region 不应借用保存越界方块`
  - `generateRegion - 目标 region 应通过 halo 生成拿到跨界方块`

---

### Task 6: Final Lint and Review

- [ ] **Step 1: Run full lint**

  ```bash
  npm run lint
  ```

  Expected: No new errors or warnings across the two modified files.

- [ ] **Step 2: Review diff**

  ```bash
  git diff
  ```

  Expected changes:
  - `src/workers/WorldWorker.js`: 3 insertions (`setSeed`, `await structuresPreload`, entity filtering)
  - `src/world/WorldGenerationService.js`: 1 insertion (`async` callback + `await saveRegionRecord`)

- [ ] **Step 3: Do NOT commit**

  Per user instruction, wait for explicit confirmation before committing. Stage the files if desired but do not run `git commit`.

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] Defect 1 (seed sync) → Task 1
   - [x] Defect 2 (preload) → Task 2
   - [x] Defect 3 (entity bloat) → Task 3
   - [x] Defect 4 (persistence race) → Task 4
   - [x] Testing → Task 5
   - [x] Lint → Task 6

2. **Placeholder scan:**
   - [x] No "TBD", "TODO", "implement later"
   - [x] No vague "add error handling" steps
   - [x] All code blocks contain actual code
   - [x] No "Similar to Task N" shortcuts

3. **Type consistency:**
   - [x] `modGunMan` and `rovers` are arrays of `{x, y, z}` objects in all locations
   - [x] `CHUNK_SIZE_LOCAL` is `16` consistently
   - [x] `saveRegionRecord` signature is `(rx, rz, record)` consistently
