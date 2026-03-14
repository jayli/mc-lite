# Data Model: 关闭创造台功能

**Feature**: 关闭创造台功能
**Date**: 2026-03-14

## Entity: PlaygroundService

创造台服务单例，管理创造台的生命周期。

### Existing Fields

| Field | Type | Description |
|-------|------|-------------|
| `world` | World | 游戏世界实例引用 |
| `_isPlaygroundActive` | boolean | 创造台激活状态（内部） |
| `playgroundOrigin` | {x, y, z} | 创造台左下角原点坐标 |
| `playgroundSize` | number | 平台尺寸（默认 40） |
| `playgroundBlocks` | Set<string> | 存储所有创造台方块坐标，格式 "x,y,z" |

### New Methods

#### closePlayground()

关闭创造台，删除所有相关方块。

```typescript
interface ClosePlaygroundResult {
  success: boolean;
  error?: 'NOT_ACTIVE' | 'PLAYER_IN_PLAYGROUND';
}

function closePlayground(): ClosePlaygroundResult
```

**Logic**:
1. 检查 `isPlaygroundActive`，如果为 false 返回 `{success: false, error: 'NOT_ACTIVE'}`
2. 检查玩家位置，如果在创造台区域内返回 `{success: false, error: 'PLAYER_IN_PLAYGROUND'}`
3. 遍历 `playgroundBlocks`，对每个坐标解析 x,y,z 并调用 `world.setBlock(x,y,z,'air')`
4. 清空 `playgroundBlocks` Set
5. 设置 `isPlaygroundActive = false`
6. 返回 `{success: true}`

#### isPlayerInPlayground(playerPos)

检查玩家是否位于创造台区域内。

```typescript
interface Vector3 {
  x: number;
  y: number;
  z: number;
}

function isPlayerInPlayground(playerPos: Vector3): boolean
```

**Logic**:
```
minX = playgroundOrigin.x
maxX = playgroundOrigin.x + playgroundSize
minZ = playgroundOrigin.z
maxZ = playgroundOrigin.z + playgroundSize
minY = playgroundOrigin.y
maxY = playgroundOrigin.y + 20  // 合理的高度范围

return playerPos.x >= minX && playerPos.x < maxX &&
       playerPos.y >= minY && playerPos.y < maxY &&
       playerPos.z >= minZ && playerPos.z < maxZ
```

---

## Entity: UIManager

UI 管理器，处理设置界面交互。

### Existing Elements

| Element | ID | Description |
|---------|-----|-------------|
| `btnCreatePlayground` | btn-create-playground | 创建/关闭创造台按钮 |
| `btnExportModel` | btn-export-model | 导出模型按钮 |
| `settingsModal` | settings-modal | 设置模态框 |

### Modified Behavior

#### updateActiveButtons() - 按钮状态更新

**State Mapping**:

| Playground State | Button Text | Button Disabled | Export Button Visible |
|-----------------|-------------|-----------------|----------------------|
| Not Active | "打开创造台" | false | false |
| Active | "关闭创造台" | false | true |

**Previous Behavior**: Active 状态显示 "创造台已打开" 且按钮禁用

**New Behavior**: Active 状态显示 "关闭创造台" 且按钮可点击

#### btnCreatePlayground.onclick - 点击处理

**New Logic**:
```javascript
if (playgroundService.isPlaygroundActive) {
  // 关闭创造台
  const result = playgroundService.closePlayground();
  if (result.success) {
    hud.showMessage('创造台已关闭');
    updateButtonState('打开创造台', false);
    hideExportButton();
  } else if (result.error === 'PLAYER_IN_PLAYGROUND') {
    hud.showMessage('请离开创造台区域后再关闭');
  }
} else {
  // 创建创造台（原有逻辑）
  ...
}
```

---

## State Transitions

```
┌─────────────┐     点击打开      ┌─────────────┐
│   未创建    │ ───────────────▶ │   已创建    │
│ (初始状态)  │                  │ (可关闭)    │
└─────────────┘                  └─────────────┘
       ▲                                │
       │         点击关闭               │
       └────────────────────────────────┘
```

## Validation Rules

1. **关闭前提**: `isPlaygroundActive === true`
2. **玩家位置**: 玩家不能在创造台区域内 (X, Y, Z 三维检查)
3. **方块清理**: 关闭后 `playgroundBlocks.size === 0`
4. **状态重置**: 关闭后 `isPlaygroundActive === false`
