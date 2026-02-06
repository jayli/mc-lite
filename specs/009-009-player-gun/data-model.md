# Data Model: 009-player-gun

## Entities

### Player (Extension)
- **isHoldingGun**: `boolean` - 追踪玩家当前是否持有枪支。
- **gun**: `THREE.Group | null` - 枪支模型的引用。

### Engine (Extension)
- **gunModel**: `THREE.Group | null` - 全局共享的枪支模型原始引用（从文件加载）。

## State Transitions
1. **Empty Hand -> Holding Gun**:
   - `isHoldingGun = true`
   - `arm.visible = false`
   - `gun.visible = true`
2. **Holding Gun -> Empty Hand**:
   - `isHoldingGun = false`
   - `arm.visible = true`
   - `gun.visible = false`
