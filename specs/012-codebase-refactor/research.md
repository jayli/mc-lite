# Research: Codebase Refactoring

## Decision: Weapon Abstraction (Gun.js)

**Rationale**: `Player.js` is currently over 1400 lines long, with several hundred lines dedicated to weapon handling (Gun, Mag7, Minigun). Moving this to a `Gun` class improves separation of concerns.

**Implementation Details**:
- The `Gun` class will store specific parameters (fire rate, recoil, models, sounds, tracer materials) for each weapon type.
- A static or member configuration object will define these parameters.
- `Player.js` will instantiate a `Gun` instance and delegate `update` and `shoot` calls to it.

## Decision: Physics Decoupling (Physics.js)

**Rationale**: `Physics.js` already exists but `Player.js` still contains significant collision logic (AABB checks, step-up logic, ceiling bump detection).

**Implementation Details**:
- Move `tryStepUp`, `checkCeilingBump`, `applyTunnelCentering`, and `applyCameraBumper` from `Player.js` to `Physics.js`.
- `Physics.js` will need access to the player's position, rotation, and velocity to perform these checks.

## Decision: Asset Consolidation (src/assets)

**Rationale**: `src/world/assets` is nested too deeply and suggests assets are only for the world layer, whereas they are used by the engine and entities as well.

**Implementation Details**:
- Move `src/world/assets/` to `src/assets/`.
- Rename `src/assets/mod/minugun.glb` to `src/assets/mod/minigun.glb`.
- Update `MaterialManager.js` and `Engine.js` loader paths.

## Decision: Utility Renaming (FaceCullingUtils.js)

**Rationale**: Standardizing on PascalCase for utility classes/modules.

**Implementation Details**:
- Rename `src/core/face-culling-utils.js` to `src/utils/FaceCullingUtils.js`.
- Update imports in `FaceCullingSystem.js`.

## Decision: Material Manager Relocation

**Rationale**: `MaterialManager` is a core engine component, not a sub-package of `materials`.

**Implementation Details**:
- Move `src/core/materials/MaterialManager.js` to `src/core/MaterialManager.js`.
- Remove `src/core/materials` directory.
- Update imports in `Player.js` and `World.js`.

## Alternatives Considered

- **Keeping Gun logic in Player**: Rejected because the file size is becoming unmanageable for a single class.
- **Using a separate Config file for Engine constants**: Decided to keep them in `Engine.js` header for now as requested by the user, but using `export const` for visibility.
