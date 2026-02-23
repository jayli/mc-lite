# Implementation Plan: 模型创造台 (Model Creator)

**Branch**: `015-model-creator` | **Date**: 2026-02-23 | **Spec**: [spec.md](./spec.md)
**Input**: 新需求编号 015 - 将游戏中创造的模型导出为 JSON 文件，作为原始模型参与世界地图构建

## Summary

实现一个游戏内模型创造系统，允许玩家在 40x40 的创造台上搭建方块结构，并将模型导出为 JSON 文件。导出的模型使用相对坐标和 Minecraft 标准方向值，后续可用于世界生成时构建自定义结构（如树木、建筑等）。

## Technical Context

**Language/Version**: JavaScript (ES6 Modules)
**Primary Dependencies**: Three.js (3D 渲染)
**Storage**: 浏览器下载 (Blob/URL 下载)
**Testing**: 手动测试 (访问 localhost:8080/src/tests/index.html)
**Target Platform**: 现代 Web 浏览器 (支持 WebGL 2.0)
**Project Type**: Single project (Web 游戏)
**Performance Goals**: 创造台生成 < 5 秒，导出操作 < 1 秒
**Constraints**: 保持内存效率，符合现有代码架构
**Scale/Scope**: 单个功能模块，影响 UI、方块系统、导出逻辑

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. 面向对象与逻辑分层 | Pass | 新增 `PlaygroundService` 保持与现有架构一致 |
| II. 内存效率与垃圾回收 | Pass | 创造台为一次性生成，显式管理释放 |
| III. 主动资源释放 | Pass | playground_block 需支持后续可能的销毁逻辑 |
| IV. WebGL/Three.js 性能优化 | Pass | 使用现有方块放置机制，不引入新渲染负担 |
| V. 简洁性与核心机制 | Pass | 专注核心功能：创建、导出 |
| VI. 资源管理与学习参考 | Pass | 所有资源在 src 目录下 |

## Project Structure

### Documentation (this feature)

```text
specs/015-model-creator/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── MaterialManager.js    # 添加 playground_block 材质
│   └── ...
├── constants/
│   └── BlockData.js          # 添加 playground_block 定义
├── services/
│   └── PlaygroundService.js  # 新：创造台核心逻辑
├── ui/
│   └── UIManager.js          # 添加创造台按钮处理
└── world/
    └── World.js              # 添加模型导出方法
```

**Structure Decision**: 采用单一项目结构，新增 `PlaygroundService.js` 负责创造台核心逻辑，与现有 `PersistenceService.js` 等模式保持一致。

## Complexity Tracking

无违反宪法原则的情况。

## Phase 0: Research & Discovery

### Research Tasks

1. **方块放置机制研究** - 了解现有方块放置 API
2. **UI 按钮添加模式** - 参考现有设置按钮实现方式
3. **文件下载 API** - 浏览器 Blob 下载最佳实践
4. **不可破坏方块实现** - 参考 collider 等特殊方块的处理方式
5. **方向数据处理** - `OrientationUtils.js` 的 `parseBlockEntry` 使用方式

---

## Phase 1: Design & Contracts

### Data Model (data-model.md)

#### ModelBlock 数据结构

| 字段 | 类型 | 说明 |
|------|------|------|
| x | number | 相对于创造台中心的 X 偏移量 |
| y | number | 相对于创造台中心的 Y 偏移量 |
| z | number | 相对于创造台中心的 Z 偏移量 |
| type | string | 方块类型标识符 |
| direction | number | Minecraft 标准方向值 (0-5) |

#### ModelJSON 文件结构

```json
{
  "blocks": [
    {
      "x": 0,
      "y": 1,
      "z": 0,
      "type": "wood",
      "direction": 2
    }
  ]
}
```

### Contracts

#### 文件下载接口

```javascript
/**
 * 导出模型为 JSON 文件
 * @param {Array<ModelBlock>} blocks - 方块数据数组
 * @returns {void} 触发浏览器下载
 */
function exportModelToJSON(blocks);
```

#### 创造台服务接口

```javascript
/**
 * 在指定位置生成创造台
 * @param {THREE.Vector3} playerPos - 玩家位置
 * @returns {boolean} 是否成功生成
 */
function createPlayground(playerPos);
```

### Quickstart.md

```bash
# 1. 启动开发服务器
npm run start

# 2. 进入游戏，按 ESC 打开设置面板

# 3. 点击"打开创造台"按钮
# 4. 在平台上放置方块
# 5. 点击"导出模型"下载 model.json
```

---

## Constitution Re-Check

**Status**: Passed - 所有设计符合宪法原则

| Principle | Re-Check Status | Notes |
|-----------|-----------------|-------|
| I. 面向对象与逻辑分层 | Pass | `PlaygroundService` 与现有服务类架构一致 |
| II. 内存效率与垃圾回收 | Pass | 创造台使用基本类型数据，无额外内存负担 |
| III. 主动资源释放 | Pass | 设计文档中包含销毁逻辑说明 |
| IV. WebGL/Three.js 性能优化 | Pass | 使用现有 `World.setBlock()` API，无新渲染路径 |
| V. 简洁性与核心机制 | Pass | 仅实现核心功能，无过度工程 |
| VI. 资源管理与学习参考 | Pass | `playground_block` 材质在 `MaterialManager.js` 中注册 |

## Phase 2: Tasks

任务列表将在 `/speckit.tasks` 命令中生成，包含以下主要工作：

1. **添加 playground_block 方块类型** - 更新 `BlockData.js` 和 `MaterialManager.js`
2. **创建 PlaygroundService** - 实现创造台核心逻辑
3. **更新 UIManager** - 添加创造台按钮和事件处理
4. **实现导出功能** - 添加 JSON 导出和下载逻辑
5. **添加不可破坏逻辑** - 在破坏检查点添加防护
6. **测试验证** - 手动测试所有功能场景

---
