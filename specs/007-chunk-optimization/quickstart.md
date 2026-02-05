# Quickstart: Chunk Optimization Implementation

## Core Logic Flow

1. **Detection**:
   - In `Chunk.addBlockDynamic(x, y, z, type)`:
     - Increment `this.dirtyBlocks`.
     - Manage `this.dynamicMeshes` map for manual Mesh tracking.
     - Call `this.scheduleConsolidation()`.

2. **Scheduling**:
   - `scheduleConsolidation()`:
     - Clear existing `this.consolidationTimer`.
     - If `this.dirtyBlocks >= 50`, trigger `this.consolidate()` immediately.
     - Else, set `this.consolidationTimer = setTimeout(() => this.consolidate(), 1000)`.

3. **Execution**:
   - `consolidate()`:
     - Send current `this.blockData` (as snapshot) to `WorldWorker.js`.
     - Set `this.isConsolidating = true`.

4. **Integration**:
   - In `WorldWorker.js`:
     - Process the snapshot just like a normal chunk generation.
     - Return the calculated `d` (InstancedMesh positions) and `visibleKeys`.

5. **Application**:
   - In `Chunk.js` callback:
     - Clear `this.dynamicMeshes` (and call `.dispose()` on each).
     - Clear existing `InstancedMesh` children in `this.group`.
     - Call `this.buildMeshes(d)`.
     - Reset `this.dirtyBlocks = 0`.

## Testing the Feature

1. Open Game.
2. Monitor FPS and Draw Calls (via Chrome DevTools/Three.js Inspector).
3. Rapidly place 60 blocks in one spot.
   - **Expectation**: After 50 blocks, Draw Calls should drop once as an immediate optimization triggers.
4. Stop placing blocks.
   - **Expectation**: 1 second after stopping, Draw Calls should drop to the minimum baseline.
5. Verify that no blocks "disappear" or "flicker" during the transition.
