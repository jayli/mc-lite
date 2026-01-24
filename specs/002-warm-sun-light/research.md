# Research: Warm Sun Light Implementation

## Findings

### 1. Current Lighting Setup (`src/core/Engine.js`)
- **AmbientLight**: `0xffffff`, intensity `0.5`.
- **DirectionalLight**: `0xffffff`, intensity `1.2`.
- **Shadows**: Enabled, map size `1024x1024`, camera frustum `[-30, 30]`.
- **Sky**: Background is a flat color `0x87CEEB` (Sky Blue). Fog is also `0x87CEEB`.

### 2. Light Updating (`src/core/Game.js`)
- The `DirectionalLight` position is currently updated in `Game.update(dt)`:
  ```javascript
  this.engine.light.position.set(this.player.position.x + 20, this.player.position.y + 40, this.player.position.z + 20);
  this.engine.light.target.position.copy(this.player.position);
  ```
- This keeps the light source relative to the player, which is good for shadow coverage but the "sun" position should ideally be defined by a direction vector or an angular coordinate.

### 3. Sun Object Implementation Options
- **Option A: Sprite**: Using `THREE.Sprite` with a radial gradient texture. Good for "soft" appearance and automatic billboarding.
- **Option B: Sphere with Glow**: A `Mesh` with `SphereGeometry` and a custom shader or a simple bright color with a larger translucent "glow" mesh.
- **Decision**: **Option A (Sprite)** is simpler and meets the "soft and warm" requirement well with minimal overhead.

### 4. Color Selection
- **Sun Color**: `0xFFD700` (Gold) or `0xFFE4B5` (Moccasin) for a warm, non-stinging feel.
- **Light Color**: `0xFFFAF0` (Floral White) or `0xFFF4E0` to give the world a warm tint without over-saturation.

## Technical Decisions

- **Sun Position**: Fixed direction vector `[1, 1, 1].normalize()`.
- **Sun Distance**: Place at `150` units from the player (within far plane of `200`).
- **Update Logic**: In `Game.js`, update the sun mesh position to `player.pos + sunDirection * distance`.
- **Light Stability**: The `DirectionalLight` direction will remain fixed. The position of the light *source* will continue to follow the player to ensure shadow map coverage for nearby blocks, but the `position - target` vector will always align with the sun's direction.

## Alternatives Considered
- **Sky Shader**: Using a professional sky shader (like `THREE.Sky`). Rejected as over-engineered for "minecraft-lite" and potentially performance-heavy.
- **Atmospheric Fog**: Changing fog color based on sun angle. Out of scope for a static sun but worth keeping in mind.
