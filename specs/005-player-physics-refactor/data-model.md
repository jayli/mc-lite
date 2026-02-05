# Data Model: Player Physics

## Entities

### PlayerState
- **position**: THREE.Vector3 (World space logic position)
- **velocity**: THREE.Vector3 (Current momentum)
- **dimensions**: { width: 0.6, height: 1.8, headHeight: 1.65 }
- **isStuck**: Boolean (Safety fallback flag)
- **currentStepHeight**: Number (Used for smooth vertical interpolation)

### CollisionResult
- **hasCollision**: Boolean
- **normal**: THREE.Vector3 (Direction of the hit surface)
- **penetration**: Number (Distance to push out)
- **type**: String ('voxel' | 'entity' | 'boundary')

### CameraState
- **bobAmount**: Number (Current procedural offset)
- **width**: Number (0.3m buffer for clipping prevention)
- **targetPosition**: THREE.Vector3 (Lerp target for smooth following)

## Constants
- **GRAVITY**: -0.015
- **MAX_STEP**: 1.0
- **MAX_JUMP_STEP**: 2.0
- **FRICTION_SLIDE**: 0.9 (Standard wall slide)
- **FRICTION_CORNER**: 0.7 (Convex corner penalty)
