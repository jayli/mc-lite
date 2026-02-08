# Quickstart: Codebase Refactor

This refactor reorganizes the core game logic to improve maintainability. There are no changes to the external API or user-facing functionality.

## Core Changes

### 1. File Relocation
- Assets: `src/world/assets/` -> `src/assets/`
- MaterialManager: `src/core/materials/MaterialManager.js` -> `src/core/MaterialManager.js`
- FaceCullingUtils: `src/core/face-culling-utils.js` -> `src/utils/FaceCullingUtils.js`

### 2. Logic Extraction
- **Weapons**: All gun-related logic (firing, models, tracers) is now in `src/entities/weapon/Gun.js`.
- **Physics**: All collision and movement constraint logic is now in `src/entities/player/Physics.js`.

## Verification Steps
1. Run `npm start` to launch the dev server.
2. Verify all textures and models load (check browser console for 404s).
3. Test player movement: walking, jumping, and climbing steps.
4. Test all weapons: switch with 'R' and fire with Left Mouse.
5. Verify `minigun.glb` loads correctly.
