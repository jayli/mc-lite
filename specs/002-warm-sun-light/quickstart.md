# Quickstart: Warm Sun Light

## Implementation Overview

1.  **Engine.js**:
    - Define `this.sunDirection = new THREE.Vector3(1, 0.8, 0.5).normalize()`.
    - Create a `THREE.Sprite` for the sun using a generated canvas texture (radial gradient).
    - Update `DirectionalLight` color and initial position.
2.  **Game.js**:
    - In `update(dt)`, update `sunSprite` position: `player.position + sunDirection * 150`.
    - Ensure `DirectionalLight` position stays at `player.position + sunDirection * 50` and targets `player.position`.

## Verification Steps

1.  Start the game: `npm start`.
2.  Look up to find the sun (it should be in a fixed diagonal direction).
3.  Move around; the sun should not get closer or further away.
4.  Observe block faces; the ones facing the sun should be warmer and brighter.
