# Quickstart: Refactor Verification

Since this is a refactor, "Quickstart" guides the developer on how to verify the refactor works.

## Prerequisites

- Node.js (for `npm start` or any static server)
- Modern Browser

## Running the Refactored Version

1. **Serve the project**:
   ```bash
   npm start
   # or
   npx serve .
   ```

2. **Open Browser**:
   Navigate to `http://localhost:3000` (or whatever port opens).

## Verification Steps

1. **Visual Check**:
   - Sky is blue? Fog exists?
   - Terrain generates? (Grass, water, trees)
   - UI (Crosshair, Hotbar) is visible?

2. **Functional Check**:
   - **WASD**: Move around.
   - **Space**: Jump.
   - **Click**: Mine block (Left), Place block (Right).
   - **Z Key**: Toggle inventory.
   - **1-5 Keys**: Select hotbar slots.

3. **Console Check**:
   - Open DevTools (F12).
   - Ensure NO red errors.
   - Ensure NO "Three.js" warnings about disposal or memory.

## Code Structure Check

Verify files exist:
- `src/core/Game.js`
- `src/world/World.js`
- `src/entities/player/Player.js`

If all pass, the refactor is successful.
