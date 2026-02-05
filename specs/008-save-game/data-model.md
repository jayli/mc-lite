# Data Model: Manual Save System

## Entities

### ManualSaveSnapshot
- **Database**: `mc_lite_manual_saves`
- **Store**: `snapshots`
- **Key**: `id` (Fixed value: `"latest"`)
- **Fields**:
  - `id`: String (Primary Key)
  - `timestamp`: Number
  - `player`: Object
    - `x`: Number
    - `y`: Number
    - `z`: Number
    - `pitch`: Number
    - `yaw`: Number
  - `worldDeltas`: Object (A serialization of the `PersistenceService` cache)
    - `chunks`: Array (Array of chunk data objects `{key, blocks, entities}`)

## Logic Flow

### Save Trigger
1. `UIManager` calls `Game.saveToDisk()`.
2. `Game` gathers current `player.position`, `player.rotation`, and `persistenceService.cache`.
3. `Game` calls `manualSaveService.save(snapshot)`.
4. `ManualSaveService` sends to `ManualSaveWorker`.
5. `ManualSaveWorker` clears `snapshots` store and adds the new one.

### Startup Load
1. `index.html` calls `manualSaveService.checkSave()`.
2. If true, show `load-prompt-modal`.
3. If user selects "Load":
   - Call `manualSaveService.load()`.
   - Initialize `Game` with the loaded data.
   - `Game` manually populates `persistenceService.cache` before world generation starts.
   - `Game` sets `player.position` and `player.rotation`.
4. If user selects "New World":
   - Standard initialization.
   - (Note: The `mc_lite_manual_saves` database is NOT cleared here, satisfying "System MUST NOT modify or clear the manual save database unless the user explicitly clicks 'Save' again").
