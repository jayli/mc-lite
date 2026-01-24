# Data Model: 地图持久化实体定义

## Entities

### 1. ChunkDelta (区块增量)
代表一个区块内所有被修改过的方块状态。

- **Key**: `chunkKey` (String: "cx,cz")
- **Attributes**:
  - `lastModified`: Timestamp (用于可能的 LRU 清理)
  - `changes`: Map<blockKey, BlockChange>

### 2. BlockChange (方块变更)
代表单个方块的修改记录。

- **Attributes**:
  - `x, y, z`: World Coordinates (Integer)
  - `type`: String (方块类型，如 'dirt', 'stone'；若为 'air' 则表示被挖掘)
  - `isDynamic`: Boolean (标记是否为玩家手动放置，用于可能的特殊渲染处理)

## IndexedDB Schema

- **Database**: `mc-lite-persistence` (Version 1)
- **ObjectStore**: `deltas`
  - **KeyPath**: `id` (即 `chunkKey`)
  - **AutoIncrement**: false

## State Transitions

1. **Generation (生成)**:
   - `World.update` -> `new Chunk(cx, cz)`
   - `Chunk.constructor` -> `PersistenceService.loadDeltas(cx, cz)`
   - `Chunk.gen` -> 叠加 Deltas 到渲染队列 `d`

2. **Modification (修改)**:
   - `Player.interact` -> `World.setBlock/removeBlock`
   - `World` -> `Chunk.addBlockDynamic/removeBlock`
   - `Chunk` -> `PersistenceService.recordChange(x, y, z, type)`

3. **Disposal (卸载)**:
   - `World.update` (distance check) -> `Chunk.dispose`
   - `Chunk.dispose` -> `PersistenceService.flush(cx, cz)`
   - `PersistenceService` -> `IndexedDB.put(delta)`
