# Implementation Plan: 关闭创造台功能

**Branch**: `001-workbench-close` | **Date**: 2026-03-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-workbench-close/spec.md`

## Summary

实现关闭创造台功能：当创造台已开启时，设置界面中的按钮文本从"创造台已打开"变为可点击的"关闭创造台"；点击后删除创造台所有方块（平台+建造内容），并恢复按钮状态允许重新创建。需要处理玩家在创造台区域时的安全检查和警告提示。

## Technical Context

**Language/Version**: JavaScript ES6+ (ES2022)
**Primary Dependencies**: Three.js 0.160.0, ES Modules
**Storage**: N/A (内存状态管理)
**Testing**: 浏览器手动测试 (http://localhost:8080/src/tests/index.html)
**Target Platform**: 现代 Web 浏览器 (WebGL 2.0+)
**Project Type**: 基于 Three.js 的 3D 体素游戏 (Web Application)
**Performance Goals**: 60 FPS，关闭创造台操作在 1 秒内完成 1600 个方块删除
**Constraints**: 严格内存管理，避免 GC 压力；2 空格缩进；保持与现有代码风格一致
**Scale/Scope**: 单文件修改，影响 PlaygroundService 和 UIManager

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 验证要点 |
|------|------|----------|
| I. 面向对象与逻辑分层 | PASS | UI 逻辑 (UIManager) 与业务逻辑 (PlaygroundService) 分离，新增功能保持现有分层 |
| II. 内存效率与垃圾回收 | PASS | 删除方块时同步清理 Set 引用，确保 GC 可回收；避免每帧创建临时对象 |
| III. 主动资源释放 | PASS | 通过 world.setBlock(x,y,z,'air') 正确释放方块，Three.js InstancedMesh 自动更新 |
| IV. WebGL/Three.js 性能优化 | PASS | 批量删除方块利用现有 Chunk 更新机制，不直接操作 InstancedMesh |
| V. 简洁性与核心机制 | PASS | 功能简单直接，不引入新依赖或复杂架构 |
| VI. 资源管理与学习参考 | N/A | 不引入新资源 |

## Project Structure

### Documentation (this feature)

```text
specs/001-workbench-close/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── checklists/          # Quality checklists
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── services/
│   └── PlaygroundService.js    # 主要修改：添加 closePlayground() 方法
├── ui/
│   └── UIManager.js            # 主要修改：添加关闭按钮逻辑和状态更新
├── core/
│   └── Game.js                 # 可能需要添加玩家位置查询接口
└── tests/
    └── index.html              # 现有测试入口
```

**Structure Decision**: 保持现有项目结构，仅修改 PlaygroundService.js 和 UIManager.js 两个文件。PlaygroundService 负责业务逻辑（删除方块、状态管理），UIManager 负责 UI 交互（按钮状态、警告提示）。

## Phase 0: Research

### 技术调研

基于现有代码分析，无需引入新技术或外部依赖。关键实现点已在 PlaygroundService 和 UIManager 中体现：

- **PlaygroundService**: 已有 `isPlaygroundActive`, `playgroundOrigin`, `playgroundBlocks` 等状态，需添加 `closePlayground()` 方法
- **UIManager**: 已有 `btnCreatePlayground` 事件处理，需扩展支持关闭逻辑
- **World API**: 使用现有的 `world.setBlock(x,y,z,'air')` 删除方块

### 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 方块删除方式 | 遍历 playgroundBlocks 逐个删除 | 与现有 setBlock API 兼容，自动触发 Chunk 更新 |
| 玩家位置检测 | 在 PlaygroundService 中实现边界检查 | 集中业务逻辑，UIManager 只负责显示警告 |
| 防重复点击 | 使用局部变量锁 | 简单有效，避免复杂状态机 |

## Phase 1: Design

### 数据模型

**PlaygroundService 状态扩展**:

```javascript
// 现有状态
isPlaygroundActive: boolean
playgroundOrigin: { x, y, z }
playgroundBlocks: Set<string>  // "x,y,z" 格式
playgroundSize: number  // 40

// 新增方法
closePlayground(): { success: boolean, error?: string }
isPlayerInPlayground(playerPos): boolean
```

**UI 状态变化**:

| 创造台状态 | 按钮文本 | 按钮状态 | 导出按钮 |
|------------|----------|----------|----------|
| 未创建 | 打开创造台 | 可点击 | 隐藏 |
| 已创建（当前） | 创造台已打开 | 禁用 | 显示 |
| 已创建（修改后） | 关闭创造台 | 可点击 | 显示 |

### 接口契约

**PlaygroundService.closePlayground()**:
- Input: 无
- Output: `{ success: boolean, error?: 'PLAYER_IN_PLAYGROUND' | 'NOT_ACTIVE' }`
- Side Effect: 删除所有 playgroundBlocks 中的方块，清空 Set，重置状态

**PlaygroundService.isPlayerInPlayground(playerPos)**:
- Input: `THREE.Vector3`
- Output: `boolean`
- Logic: 检查玩家位置是否在 playgroundOrigin 到 playgroundOrigin + playgroundSize 的区域内

### 实现要点

1. **关闭流程**:
   - UIManager 调用 `playgroundService.closePlayground()`
   - PlaygroundService 检查 `isPlaygroundActive`，未激活返回错误
   - PlaygroundService 检查玩家位置，在区域内返回 `PLAYER_IN_PLAYGROUND`
   - 遍历 `playgroundBlocks`，对每个坐标调用 `world.setBlock(x,y,z,'air')`
   - 清空 `playgroundBlocks`，设置 `isPlaygroundActive = false`
   - UIManager 收到成功响应后更新按钮状态

2. **玩家在区域检测**:
   ```javascript
   const minX = playgroundOrigin.x;
   const maxX = playgroundOrigin.x + playgroundSize;
   // 同理 Y (origin.y 到 origin.y + clearance), Z
   ```

3. **UI 状态同步**:
   - 在 `updateActiveButtons()` 中更新按钮文本逻辑
   - 点击关闭时显示消息提示（HUD.showMessage）

## Phase 2: Tasks (由 /speckit.tasks 生成)

**待创建文件**:
- `specs/001-workbench-close/data-model.md`
- `specs/001-workbench-close/quickstart.md`
- `specs/001-workbench-close/research.md`
- `specs/001-workbench-close/tasks.md` (通过 /speckit.tasks 命令)

## 下一步

运行 `/speckit.tasks` 生成详细的任务列表。