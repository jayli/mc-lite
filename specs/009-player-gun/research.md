# Research: 009-player-gun

## Decisions

### Decision: 模型绑定方式
- **Choice**: 将枪支模型作为 `camera` 的子对象 (`camera.add(gun)`)。
- **Rationale**: 这样可以自动处理视角的平移和旋转，确保枪支相对于屏幕的位置恒定。
- **Alternatives considered**: 每帧手动同步枪支位置（计算开销大，易抖动）。

### Decision: 模型位置与缩放
- **Choice**: 初始位置设为 `(0.5, -0.4, -0.8)`，缩放比例根据实际模型大小调整。
- **Rationale**: 模拟右手持枪位置，Z 轴为负值确保在近裁剪面之后。具体参数需根据 `gun.gltf` 的默认尺寸微调。

### Decision: 切换逻辑
- **Choice**: 使用 `Player.isHoldingGun` 布尔变量，并在 `setupInput` 中通过 `KeyR` 切换。
- **Rationale**: 简单直接，易于与现有 `arm.visible` 逻辑整合。
