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
  - 方块属性（碰撞、透明度、AO等）必须通过 `src/constants/BlockData.js` 统一配置。
  - 所有新功能必须在 `specs/` 目录下创建规格文档。

## 项目架构

本项目采用模块化、分层的 Minecraft 克隆架构，重点在于大规模体素渲染的性能优化。

### 核心分层
1. **表示层 (Engine)**: `src/core/Engine.js` 处理渲染、相机、光照（太阳同步）和阴影。
2. **逻辑层 (Game/Player)**:
   - `src/core/Game.js`: 驱动主循环，协调各子系统。
   - `src/entities/player/Player.js` & `src/entities/player/Physics.js`: 处理控制、重力和方块碰撞。
3. **数据/世界层 (World)**:
   - `src/world/World.js`: 管理区块的动态加载/卸载（渲染距离：3）。
   - `src/world/Chunk.js`: 核心渲染单元，使用 `THREE.InstancedMesh` 优化性能。
   - **区块合并 (Consolidation)**: 玩家交互后的修改会异步合并到区块的主网格中。
   - `src/world/TerrainGen.js` & `src/world/WorldWorker.js`: 地形生成与后处理逻辑，在 Web Worker 中异步执行。
4. **持久化层**:
   - `src/services/PersistenceService.js`: 使用 IndexedDB 存储世界修改。

### 关键系统
- **方块数据系统**: `src/constants/BlockData.js` 是所有方块属性的单一真理来源，决定了物理碰撞、面剔除和 AO 渲染行为。
- **隐藏面剔除 (Face Culling)**: `src/core/FaceCullingSystem.js` 结合 `BlockData.js` 管理方块可见面，优化渲染性能。
- **材质系统**: `MaterialManager.js` 负责材质注册与纹理预加载，支持程序化纹理和 AO 着色器注入。

## 开发工作流

1. **添加/修改方块**:
   - 在 `src/constants/BlockData.js` 定义方块属性（`isSolid`, `isTransparent`, `isAOEnabled` 等）。
   - 在 `MaterialManager.js` 注册对应的材质定义和纹理映射。
2. **调试**: 使用 HUD 查看实时状态。物理逻辑在 `src/entities/player/Physics.js`。
3. **代码提交**: 遵循约定式提交 (Conventional Commits)，优先使用 `Skill("commit")`。

## 最近功能
- **010-block-data-refactor**: 集中化方块属性管理系统。
- **009-player-gun**: 玩家射击系统与后坐力反馈。
- **008-save-game**: 手动存档与导出系统。
- **007-chunk-optimization**: 区块网格合并与异步优化。
- **006-realistic-textured-trees**: 真实感树木生成。
- **005-player-physics-refactor**: 物理碰撞与上台阶逻辑重构。
- **004-hidden-face-culling**: 基于位掩码的隐藏面剔除。
- **003-land-caves**: 洞穴生成系统。
- **002-warm-sun-light**: 动态光照与阴影系统。
- **001-world-persistence**: 自动保存与持久化服务。
- **000-fps-optimization**: 渲染管线与性能监控优化。

## Active Technologies
- JavaScript (ES6 Modules) + Three.js (via CDN), GLTFLoader (011-minigun-weapon)
- N/A (武器状态不持久化，仅位置/修改通过 PersistenceService 存储) (011-minigun-weapon)

## Recent Changes
- 011-minigun-weapon: Added JavaScript (ES6 Modules) + Three.js (via CDN), GLTFLoader
