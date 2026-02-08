# Research: Minigun Implementation

## Decision: 武器模型配置与标准化
- **选定方案**: 在 `Engine.js` 中使用 `GLTFLoader` 加载 `minugun.glb`。
- **Rationale**: 与现有的 `gunModel` 和 `mag7Model` 保持一致，利用现有的标准化逻辑（中心归零、最大维度缩放）。
- **Alternatives Considered**:
  - 动态按需加载：由于武器模型较小且切换频繁，预加载能提供更好的用户体验。

## Decision: 射击频率与连发逻辑
- **选定方案**: `shootInterval` 设为 `0.05` (20发/秒)。在 `Player.update` 中通过递减 `shootCooldown` 实现。
- **Rationale**: 模仿机枪的高射速感，同时保持在浏览器帧率（60FPS）的可控范围内。
- **Alternatives Considered**:
  - `requestAnimationFrame` 独立循环：增加复杂度，且难以与玩家状态同步。

## Decision: 资源坐标与偏移
- **选定方案**: 手动测试并微调 `minigun` 在相机坐标系下的 `position` 和 `scale`。
- **Rationale**: GLB 模型的原始坐标系可能不统一，需要通过 `Player.js` 中的 `this.gun.position.set` 进行视觉对齐。
- **Alternatives Considered**:
  - 在 Blender 中重置坐标：增加外部工具依赖，不如在代码中配置灵活。

## Decision: 示踪线视觉效果
- **选定方案**: 复用 `tracerMaterial`，但增加 `thickness` 参数，使机枪子弹看起来更密集。
- **Rationale**: 性能最优，且视觉风格与现有武器统一。
