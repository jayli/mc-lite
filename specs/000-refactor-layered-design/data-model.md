# Data Model: Refactor Layered Design

## Core Entities

### Game
The central coordinator.
- **Attributes**:
  - `engine`: Engine (Three.js wrapper)
  - `world`: World
  - `player`: Player
  - `ui`: UIManager
  - `isRunning`: boolean
- **Lifecycle**: Init -> Loop -> Stop

### World
Manages the voxel environment.
- **Attributes**:
  - `chunks`: Map<string, Chunk> (Key: "cx,cz")
  - `seed`: number
- **Methods**:
  - `update(playerPos)`: Generates/Unloads chunks
  - `getBlock(x,y,z)`: Returns block type
  - `setBlock(x,y,z, type)`: Updates chunk data

### Chunk
A 16x16xH section of the world.
- **Attributes**:
  - `cx`: number (Chunk X)
  - `cz`: number (Chunk Z)
  - `group`: THREE.Group (Visual container)
  - `solidBlocks`: Map/Set (Collision data)
  - `interactables`: Array<THREE.Object3D>
- **Methods**:
  - `generate()`: Runs terrain noise & biomes
  - `dispose()`: Cleans up meshes/memory

### Player
Represents the user's avatar.
- **Attributes**:
  - `position`: THREE.Vector3
  - `rotation`: THREE.Euler
  - `velocity`: THREE.Vector3
  - `inventory`: Inventory
  - `slots`: Slot[] (Equipment)
- **Methods**:
  - `update(dt, input)`: Physics & Movement
  - `interact(world, action)`: Mine/Place

### Inventory
Manages item storage.
- **Attributes**:
  - `items`: Map<string, number> (Type -> Count)
  - `selectedSlot`: number
- **Methods**:
  - `add(type, count)`
  - `remove(type, count)`
  - `has(type, count)`

### Slot (New)
Represents an equipment slot.
- **Attributes**:
  - `id`: number (Index)
  - `item`: string | null (Item Type)
  - `count`: number
  - `meta`: Object (Future extensibility)

## Key Data Structures

### Biome Types (Enum)
- `PLAINS`, `FOREST`, `DESERT`, `SWAMP`, `AZALEA`

### Block Types (Enum-like)
- `grass`, `dirt`, `stone`, `sand`, `wood`, `leaves`, `water`, etc.
- **Metadata**: color, transparent, solid

### Material Definition
Interface for texture abstraction.
- `{ type: string, color: hex, opacity: number, textureGenerator: Function | null }`
