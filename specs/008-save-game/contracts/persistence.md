# Contracts: Manual Save System

## ManualSaveWorker Messages

### `SAVE_SNAPSHOT`
- **Request**:
  ```json
  {
    "action": "SAVE_SNAPSHOT",
    "payload": {
      "player": { "x": 0, "y": 0, "z": 0, "pitch": 0, "yaw": 0 },
      "worldDeltas": [ { "key": "0,0", "blocks": { "0,60,0": "stone" } } ]
    }
  }
  ```
- **Response**: `{ success: true }`

### `LOAD_SNAPSHOT`
- **Request**: `{ action: "LOAD_SNAPSHOT" }`
- **Response**:
  ```json
  {
    "success": true,
    "result": {
      "player": { ... },
      "worldDeltas": [ ... ],
      "timestamp": 123456789
    }
  }
  ```

### `CHECK_SAVE`
- **Request**: `{ action: "CHECK_SAVE" }`
- **Response**: `{ success: true, result: boolean }`

## ManualSaveService (JS API)

- `checkSaveExists(): Promise<boolean>`
- `save(playerData, deltaMap): Promise<void>`
- `load(): Promise<Snapshot>`

## UI Events

- `UIManager` -> `Game`: `onSaveRequested()`
- `Game` -> `UIManager`: `notifySaveComplete()`
- `index.html` -> `Game`: `init(loadedData | null)`
