# Data Model: Realistic Textured Trees

**Date**: 2026-01-20
**Input**: `spec.md` section "Key Entities"

This document outlines the data structures for the "Realistic Textured Trees" feature. As this is a pure frontend feature, the model represents in-memory data structures used during runtime.

## Entity: RealisticTree

Represents a single instance of the new, textured tree model within the game world.

### Description

A `RealisticTree` is a 3D object (`THREE.Object3D`) composed of geometries and materials derived from specific texture files. It is generated procedurally and placed within the "Forest" biome.

### Fields

| Field Name      | Type                     | Description                                                                                             | Source                                  |
|-----------------|--------------------------|---------------------------------------------------------------------------------------------------------|-----------------------------------------|
| `trunkGeometry`   | `THREE.BufferGeometry`   | The geometry for the trunk and main branches of the tree.                                               | Procedurally generated                  |
| `leavesGeometry`  | `THREE.BufferGeometry`   | The geometry for the leaves/canopy of the tree, likely using planes or simple shapes.                   | Procedurally generated                  |
| `trunkMaterial`   | `THREE.Material`         | The material (including texture) applied to the trunk. Uses `azalea_branch.png`.                        | `research.md`                           |
| `leavesMaterial`  | `THREE.Material`         | The material (including texture) applied to the leaves. Uses `oak_leaves_branch_medium.png`.            | `research.md`                           |
| `position`        | `THREE.Vector3`          | The world coordinates `(x, y, z)` of the base of the tree.                                              | Terrain generation logic                |
| `isInteractable`  | `Boolean`                | A flag indicating that the tree can be destroyed and can drop items, consistent with original trees.    | `spec.md` (FR-005)                      |

### Relationships

- **Belongs to**: A `Chunk`. When a chunk is unloaded, all associated `RealisticTree` objects must be destroyed and their resources released.
- **Composed of**: `THREE.Mesh` objects for its trunk and leaves.
