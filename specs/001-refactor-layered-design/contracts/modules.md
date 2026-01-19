# Internal API Contract: Game Module Interfaces

Since this is a client-side refactor without a backend API, "Contracts" here refer to the **Module Interfaces** that enforce separation of concerns.

## 1. Engine Interface (`src/core/Engine.js`)

The rendering abstraction.

```javascript
class Engine {
  constructor(containerElement)
  get camera(): THREE.PerspectiveCamera
  get scene(): THREE.Scene
  get renderer(): THREE.WebGLRenderer
  onResize(): void
  render(): void
}
```

## 2. World Interface (`src/world/World.js`)

The terrain abstraction.

```javascript
class World {
  constructor(scene, seed)
  update(playerPos: THREE.Vector3): void
  getBlock(x, y, z): string | null
  setBlock(x, y, z, type: string): void
  // Raycast helper for picking blocks
  raycast(origin: THREE.Vector3, direction: THREE.Vector3): HitResult | null
}
```

## 3. MaterialManager Interface (`src/core/materials/MaterialManager.js`)

The texture abstraction.

```javascript
class MaterialManager {
  getMaterial(blockType: string): THREE.Material
  registerMaterial(type: string, definition: MaterialDef): void
}
```

## 4. Entity Interface (`src/world/entities/Entity.js`)

Base for procedural objects.

```javascript
// Static generator pattern for now (as per legacy logic)
class Tree {
  static generate(x, y, z, chunk, definition): void
}
```
