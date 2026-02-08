# Data Model: Codebase Refactoring

## Entities

### Gun (src/entities/weapon/Gun.js)
Represents a weapon instance with specific behavior and visual properties.

| Field | Type | Description |
|-------|------|-------------|
| type | String | Identifier (GUN, MAG7, MINIGUN) |
| model | THREE.Group | The 3D model instance |
| fireRate | Number | Seconds between shots |
| recoil | Number | Visual recoil intensity |
| sound | String | Sound effect ID |
| tracerMaterial | THREE.Material | Visual material for bullet tracers |
| localStart | THREE.Vector3 | Local offset for tracer start |

### Physics (src/entities/player/Physics.js)
Handles all movement constraints and collision detection.

| Method | Description |
|--------|-------------|
| tryStepUp | Logic for climbing 1-2 block heights |
| checkCeilingBump | Detection for hitting head on blocks |
| applyTunnelCentering | Automatic centering in narrow passages |
| applyCameraBumper | Preventing camera clipping through walls |
| checkAABB | Core collision detection logic |

### MaterialManager (src/core/MaterialManager.js)
Centralized registry for all game textures and materials.

| Method | Description |
|--------|-------------|
| preloadTextures | Asynchronous loading of all required textures |
| getMaterial | Lazy-loading/creation of materials by block type |
| registerMaterial | Defining properties for a block type |
