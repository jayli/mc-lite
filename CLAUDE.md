# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

本项目是基于 Three.js 的纯前端体素引擎，无需构建步骤。

- **启动开发服务器**: `npm run start` (使用内置 Node.js 静态服务器)
- **规格驱动开发 (Spec-Driven)**:
  - 创建新功能规格: `.specify/scripts/bash/create-new-feature.sh --short-name "NAME" "DESCRIPTION"`
  - 生成/执行任务: 使用 `Skill("speckit.tasks")` 和 `Skill("speckit.implement")`
- **代码规范**:
  - 强制使用 ES6 Modules (`import`/`export`)，通过 CDN 加载 Three.js。
  - 遵循面向对象编程模式（类名大写，属性驼峰命名）。
  - 所有资源通过 `src/core/MaterialManager.js` 统一管理，包括颜色和材质定义。
  - 方块属性（碰撞、透明度、AO 等）必须在 `src/constants/BlockData.js` 配置。

## 项目架构

本项目采用模块化、分层的 Minecraft 克隆架构，核心在于通过异步计算优化大规模体素渲染。

### 1. 核心分层
- **表示层 (Engine)**: `src/core/Engine.js` 处理渲染管线、相机、日夜同步光照与阴影。
- **逻辑层 (Game/Player)**:
  - `src/core/Game.js`: 驱动主循环。
  - `src/entities/player/Physics.js`: 处理高频物理碰撞与上台阶逻辑。
  - `src/entities/weapon/Gun.js`: 处理武器模型渲染与射击逻辑。
- **数据/世界层 (World)**:
  - `src/world/World.js`: 管理区块的动态加载/卸载（默认渲染距离：3）。
  - `src/world/Chunk.js`: 渲染单元，包括部分材质的 3D 形状，使用 `THREE.InstancedMesh` 优化性能。

### 2. 异步处理与 Worker 通信
- **地形生成与后处理**: 运行在 `src/workers/WorldWorker.js` 中。
- **通信契约**: `Chunk.js` 发送 `snapshot` (区块方块快照) 给 Worker，Worker 返回计算好的可见面掩码 (Face Culling) 和 AO 权重数据。
- **后台合并 (Consolidation)**: 玩家交互产生的实时变更先以单体 Mesh 渲染以保证即时反馈，随后异步发送至 Worker 重新合并入区块的主 `InstancedMesh`。

### 3. 持久化
- **IndexedDB**: 通过 `src/services/PersistenceService.js` 自动保存世界修改。

## 开发工作流
1. **添加方块**: 在 `BlockData.js` 定义属性 -> 在 `MaterialManager.js` 注册材质 -> 在 `Chunk.js` 的 `geomMap` 中指定几何体。
2. **调试物理**: 物理步进逻辑位于 `src/entities/player/Physics.js`。
3. **优化渲染**: 隐藏面剔除逻辑位于 `src/core/FaceCullingSystem.js` 与 `src/utils/FaceCullingUtils.js`。

## 最近功能记录
- **012-codebase-refactor**: 架构解耦，提取 Gun 类与物理逻辑。
- **011-minigun-weapon**: 新增加特林机枪武器。
- **010-block-data-refactor**: 集中化方块属性管理系统。
- **007-chunk-optimization**: 区块网格合并与异步优化。
- **004-hidden-face-culling**: 基于位掩码的隐藏面剔除。
- **001-world-persistence**: 自动保存与持久化服务。
