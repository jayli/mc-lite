# Data Model: Weapon System

## Entities

### WeaponMode (Enum)
表示玩家当前激活的武器类型。
- `ARM` (0): 徒手模式，显示手臂。
- `GUN` (1): 普通步枪模式，支持中速连发。
- `MAG7` (2): 霰弹枪模式，单次大范围伤害。
- `MINIGUN` (3): 机枪模式，支持极速连发。

### Player Weapon State
- `weaponMode`: 当前激活的 `WeaponMode`。
- `gun`: 当前挂载在 `camera` 下的 Three.js `Group` 或 `Mesh`。
- `shootCooldown`: 距离下次射击的剩余时间。
- `drawProgress`: 拿起武器动画的进度 (0-1)。
- `gunRecoil`: 射击时的后坐力偏移量（视觉）。

## State Transitions

- **Switch Weapon (KeyR)**:
  - `weaponMode = (weaponMode + 1) % 4`
  - `drawProgress = 0`
  - `gun` 模型被替换。
- **Shoot (MouseDown)**:
  - 若 `weaponMode !== ARM` 且 `shootCooldown <= 0`:
    - 执行 `executeShot` (或 Minigun 专用射击函数)。
    - `shootCooldown = shootInterval`。
    - `gunRecoil` 增加。
