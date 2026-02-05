# Research: Manual Decoupled Save System

## Findings

### 1. Data Source for Saving
- **Current State**: `PersistenceService` maintains a `Map` of world deltas (`cx,cz` -> `{blocks: {}, entities: {}}`). The `World` object contains the active state.
- **Decision**: To save "all blocks," we need to capture both the `PersistenceService` cache AND currently modified blocks that might not yet be in the persistence cache. However, the user specifies "all blocks," but for a voxel engine, saving every generated block is inefficient.
- **Refined Decision**: We will save the **full delta map** (all modifications ever made) and the **player state**. This constitutes a "full save" in the context of this project, as the base terrain is reproducible from the seed. If the user literally means "every single block including generated ones," we would need to iterate through all active chunks, which is expensive.
- **Final Alignment**: We will save the complete set of world modifications (deltas) and player state to the new database. This ensures the user's creations and destructions are preserved.

### 2. ManualSaveWorker Implementation
- **Capability**: Needs to handle `IndexedDB.open` for a new database `mc_lite_manual_saves`.
- **Logic**:
  - `save`: Clears old data and writes new state.
  - `load`: Reads state.
  - `check`: Checks if a save exists.

### 3. Startup Prompt Injection
- **Location**: `index.html`'s `main()` function is the entry point.
- **UI**: Needs a new HTML structure for the load prompt modal.

### 4. Setting Panel Modification
- **Location**: `UIManager.js` and `index.html`.
- **Interaction**: Pointer lock must be handled carefully when opening the save confirmation (if any) or showing the completion message.

## Rationale

- **Decoupling**: By using a new database and a new worker, we guarantee that the existing "runtime persistence" (which is meant for session stability) is untouched.
- **Manual Trigger**: The `ManualSaveService` will only be called by the UI button. No automatic calls will be added.
- **Performance**: Passing the delta map and player state to a worker via `postMessage` is very fast. The worker handles the slow IDB writes.

## Alternatives Considered

- **Alternative**: Store player state in `LocalStorage` and world in `IndexedDB`.
- **Rejected**: Inconsistent. Better to keep one atomic save in IndexedDB.
- **Alternative**: Add a "Save" button that just calls `PersistenceService.saveAll()`.
- **Rejected**: Violates the "separate database" and "no modification of original logic" requirements.
