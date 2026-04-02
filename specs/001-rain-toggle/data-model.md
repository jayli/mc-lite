# Data Model: 下雨功能开关

**Feature**: 001-rain-toggle
**Date**: 2026-04-02

## 实体定义

### RainState

下雨效果的状态实体，存储在游戏状态中。

| 属性 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| `enabled` | boolean | 下雨效果是否开启 | `false` |
| `lastToggleTime` | number | 上次切换的时间戳（用于防抖） | `0` |

**生命周期**:
- 创建：游戏初始化时，默认关闭
- 更新：用户点击下雨按钮时切换
- 销毁：随游戏实例销毁

**验证规则**:
- `enabled` 必须为布尔值
- `lastToggleTime` 必须为非负数

### RainEffect

下雨视觉效果实体，管理雨滴粒子。

| 属性 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| `scene` | THREE.Scene | Three.js 场景引用 | 必需参数 |
| `particleCount` | number | 雨滴数量 | `75` (50-100范围) |
| `radius` | number | 雨滴出现半径（米） | `50` |
| `speed` | number | 雨滴落下速度（米/秒） | `12` (10-15范围) |
| `particleSize` | number | 雨滴粒子大小 | `0.1` |
| `particleOpacity` | number | 雨滴透明度 | `0.5` |
| `points` | THREE.Points | Three.js 粒子对象 | 内部创建 |
| `geometry` | THREE.BufferGeometry | 粒子几何体 | 内部创建 |
| `material` | THREE.PointsMaterial | 粒子材质 | 内部创建 |
| `positions` | Float32Array | 粒子位置数组 | 内部创建 |
| `velocities` | Float32Array | 粒子速度数组 | 内部创建 |

**生命周期**:
- 创建：开启下雨时初始化
- 更新：每帧调用 `update(playerPosition, dt)`
- 销毁：关闭下雨时调用 `dispose()`，释放 Three.js 资源

**状态转换**:
```
[关闭] --开启--> [活跃] --关闭--> [销毁]
                    |                     |
                    +--每帧更新-->         +--释放资源-->
```

**验证规则**:
- `particleCount` 范围 50-100
- `radius` = 50
- `speed` 范围 10-15
- 关闭时必须调用 `dispose()` 释放资源

## 关系图

```
Game
  ├── rainState: RainState (状态)
  └── rainEffect: RainEffect | null (效果实例，null时表示关闭)
        └── scene: THREE.Scene (场景引用，不拥有)
        └── points: THREE.Points (Three.js对象，拥有)
              ├── geometry: THREE.BufferGeometry
              └── material: THREE.PointsMaterial
```

## 数据流

1. 用户点击按钮 → UIManager 检测防抖 → 更新 Game.rainState.enabled
2. Game 检测状态变化 → 创建/销毁 RainEffect 实例
3. RainEffect 活跃时 → 每帧从 Game.update() 调用 RainEffect.update()
4. RainEffect.update() → 根据玩家位置更新粒子坐标 → 渲染雨滴