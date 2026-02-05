# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

本项目是一个基于 Three.js 的纯前端项目，不包含构建步骤。

- **启动开发服务器**:
  - `npm start` - 使用内置 Node.js 静态服务器（推荐，支持本地和网络访问）
  - `npx serve .` - 使用 serve 静态服务器
- **功能规格驱动开发 (Spec-Driven)**:
  - **创建新功能**: `.specify/scripts/bash/create-new-feature.sh --short-name "NAME" "DESCRIPTION"`
  - **生成任务**: 使用 `Skill("speckit.tasks")`
  - **执行实现**: 使用 `Skill("speckit.implement")`
- **代码规范**:
  - 强制使用 ES6 Modules (`import`/`export`)，通过 CDN 加载 Three.js。
  - 遵循面向对象编程模式（类名大写，属性驼峰命名）。
  - 资源必须通过 `src/core/materials/MaterialManager.js` 统一管理。
  - 所有新功能必须在 `specs/` 目录下创建规格文档。

## 项目架构

本项目采用模块化、分层的 Minecraft 克隆架构，重点在于大规模体素渲染的性能优化。

### 核心分层
1. **表示层 (Engine)**: `src/core/Engine.js` 处理渲染、相机、光照（太阳同步）和阴影。
2. **逻辑层 (Game/Player)**:
   - `src/core/Game.js`: 驱动主循环，协调各子系统。
   - `src/entities/player/Player.js` & `src/core/Physics.js`: 处理控制、重力和方块碰撞。
3. **数据/世界层 (World)**:
   - `src/world/World.js`: 管理区块的动态加载/卸载（渲染距离：3）。
   - `src/world/Chunk.js`: 核心渲染单元，使用 `THREE.InstancedMesh` 优化性能。
   - **区块合并 (Consolidation)**: 玩家交互后的修改会异步合并到区块的主网格中，以减少实例数量并提升渲染性能。
   - `src/world/TerrainGen.js` & `src/workers/WorldWorker.js`: 包含噪声算法和生物群系判定，在 Web Worker 中异步执行。
4. **持久化层**:
   - **自动保存**: `src/services/PersistenceService.js` 使用 IndexedDB (`mc_lite_db`) 存储世界增量修改（Deltas）。
   - **手动存档**: 使用独立的 IndexedDB (`mc_lite_manual_saves`) 存储完整世界快照。

### 关键性能优化
- **InstancedMesh**: 区块通过 `InstancedMesh` 渲染同类方块，大幅减少 Draw Calls。
- **隐藏面剔除 (Face Culling)**: `src/core/face-culling/FaceCullingSystem.js` 通过位掩码管理方块可见面，仅渲染暴露在外的面（结合 `alphaTest` 处理透明材质）。
- **材质优化**: `MaterialManager.js` 禁用纹理 Mipmaps，使用 `NearestFilter` 保持像素风格并减少内存占用。
- **碰撞检测占位**: 当区块尚未准备好时，`Physics.isSolid` 使用噪声函数进行快速物理估算。

## 开发工作流

1. **修改方块/材质**: 先在 `MaterialManager.js` 定义纹理映射，然后在 `constants/` 中添加 ID。
2. **调试**:
   - 使用 HUD (由 `src/ui/UIManager.js` 管理) 查看实时 FPS、坐标和区块状态。
   - 物理问题可在 `Physics.js` 中通过辅助线进行可视化。
3. **代码提交**:
   - 必须遵循约定式提交 (Conventional Commits)。
   - 优先使用 `Skill("commit")` 进行提交操作。
   - 避免使用 `git add .` 或 `git add -A`，应添加特定文件。

## 目录结构摘要
- `src/core/`: 核心引擎、物理、材质管理、面剔除系统。
- `src/world/`: 世界管理、区块逻辑、地形生成。
- `src/entities/`: 玩家及实体定义。
- `src/services/`: 数据持久化及后台服务。
- `specs/`: 功能规格文档 (`spec.md`, `plan.md`, `tasks.md`)。
- `workers/`: Web Workers 脚本。

## 最近功能
- **008-save-game**: 手动存档系统，包含专用 IndexedDB 和 Worker。
- **007-chunk-optimization**: 区块合并优化，提升玩家交互后的性能。
- **004-hidden-face-culling**: 隐藏面剔除优化。
- **003-land-caves**: 洞穴生成系统。
