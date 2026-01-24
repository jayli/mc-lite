# Data Model: Warm Sun Light

## Entities

### SunSystem
- **sunSprite**: `THREE.Sprite` - The visual representation of the sun.
- **sunLight**: `THREE.DirectionalLight` - The light source matching the sun.
- **sunDirection**: `THREE.Vector3` - Normalized vector pointing from the world origin to the sun.
- **sunColor**: `0xFFE4B5` (Warm Moccasin) - Visual color of the sun object.
- **lightColor**: `0xFFF4E0` (Warm White) - Color of the light cast on the world.

## Relationships
- **SunSystem** belongs to **Engine**.
- **SunSystem** is updated by **Game** loop to maintain relative distance to **Player**.
- **World** chunks are illuminated by **SunSystem.sunLight**.
