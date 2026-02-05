# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

本项目是一个基于 Three.js 的纯前端项目，不包含构建步骤。

- **启动开发服务器**:
  - `npm start` - 使用内置 Node.js 静态服务器（推荐，支持本地和网络访问）
  - `npx serve .` - 使用 serve 静态服务器
  - `python3 -m http.server` - 使用 Python 内置服务器
- **代码规范**:
  - 使用 ES6 Modules (`import`/`export`)，通过 CDN 加载 Three.js。
  - 遵循面向对象编程模式（类名大写，属性驼峰命名）。
  - 使用 `src/MaterialManager.js` 统一管理资源。
  - 使用 `specs/` 目录进行功能规格驱动开发。

## 项目架构

本项目采用模块化、分层的 Minecraft 克隆架构。

### 核心分层
1. **表示层 (Engine)**: `src/Engine.js` 处理渲染、相机、光照（太阳同步）和阴影。
2. **逻辑层 (Game/Player)**:
   - `src/Game.js`: 驱动主循环，协调各子系统。
   - `src/Player.js` & `src/Physics.js`: 处理控制、重力和方块碰撞。
3. **数据/世界层 (World)**:
   - `src/World.js`: 管理区块的动态加载/卸载（渲染距离：3）。
   - `src/Chunk.js`: 核心渲染单元，使用 `THREE.InstancedMesh` 优化性能。
   - `src/TerrainGen.js`: 包含噪声算法、生物群系判定和特殊结构生成。
4. **持久化层**: `src/PersistenceService.js` 使用 IndexedDB 存储世界增量修改（Deltas）。

### 目录结构
```
src/
├── constants/         # 常量定义（方块类型、生物群系等）
├── core/             # 核心引擎和游戏逻辑
│   ├── materials/    # 材质管理器
│   └── face-culling/ # 隐藏面剔除系统
├── entities/         # 游戏实体
│   └── player/       # 玩家相关
├── services/         # 服务层（持久化等）
├── ui/              # 用户界面
├── utils/           # 工具函数
├── workers/         # Web Workers
└── world/           # 世界生成和管理
    └── entities/    # 世界实体（树、箱子等）
```

### 性能优化设计
- **InstancedMesh**: 区块通过 `InstancedMesh` 渲染同类方块，大幅减少 Draw Calls；粒子系统同样使用 `InstancedMesh` 优化。
- **Web Workers**: 地形生成、结构计算等重计算逻辑在 `WorldWorker.js` 中异步执行，避免主线程卡顿。
- **隐藏面剔除 (Face Culling)**: `FaceCullingSystem.js` 通过位掩码管理方块可见面，仅渲染暴露在外的面（结合 `alphaTest` 处理透明材质）。
- **材质优化**: `MaterialManager.js` 禁用纹理 Mipmaps，使用 `NearestFilter` 保持像素风格并减少内存占用。
- **按需加载/卸载**: `World.js` 根据玩家位置动态加载渲染距离（默认3）内的区块，并及时卸载远端区块。
- **碰撞检测占位**: 当区块尚未准备好时，`World.isSolid` 使用噪声函数进行快速物理估算，防止玩家坠入虚空。
- **几何体合并**: 复杂结构（如仙人掌、火星车）使用 `BufferGeometryUtils.mergeGeometries` 合并，进一步优化性能。

## 常用操作指引

- **新增方块类型**:
  1. 在 `src/MaterialManager.js` 中定义纹理和材质。
  2. 在 `src/World.js` 或 `src/TerrainGen.js` 的生成逻辑中使用其 ID。
- **修改地形生成**:
  - 修改 `src/TerrainGen.js` 中的噪声缩放参数调整起伏。
  - 修改 `biomeParams` 阈值调整生物群系分布。
- **添加新结构**:
  - 在 `src/TerrainGen.js` 中编写生成逻辑（类似 `generateHouse` 或 `generateRover`）。
  - 在 `generateChunk` 方法中根据概率触发。
- **调试信息**:
  - 使用 `UIManager.js` 及其子组件 `HUD.js` 显示实时状态。
  - 碰撞逻辑可在 `Physics.js` 中通过辅助线进行调试。
- **使用规格驱动开发**:
  - 新功能应在 `specs/` 目录下创建规格文档
  - 使用 `.specify/scripts/bash/create-new-feature.sh` 创建新功能

## 技术栈
- **JavaScript**: ES6+ Modules
- **Rendering**: Three.js (WebGL 2.0)
- **Storage**: IndexedDB (Primary), LocalStorage (Fallback)
- **开发工具**: Node.js 静态服务器

## 开发工作流

### 1. 启动开发
```bash
npm start
# 或
npx serve .
```

### 2. 创建新功能
```bash
.specify/scripts/bash/create-new-feature.sh --json --number <编号> --short-name "<功能名称>" "<功能描述>"
```

### 3. 代码提交
- 使用 `git add` 添加特定文件，避免使用 `git add -A`
- 提交信息应遵循约定式提交格式
- 使用 `Skill("commit")` 进行提交操作

### 4. 规格文档
- 所有功能规格位于 `specs/` 目录
- 每个功能包含：spec.md, plan.md, tasks.md, data-model.md
- 使用 `speckit.*` 技能进行规格驱动开发

## 重要文件位置

- **入口文件**: `index.html` - 使用 ES6 Modules 和 importmap
- **主游戏循环**: `src/Game.js`
- **世界管理**: `src/World.js`
- **地形生成**: `src/TerrainGen.js`
- **材质管理**: `src/MaterialManager.js`
- **持久化**: `src/PersistenceService.js`
- **性能优化**: `src/core/face-culling/FaceCullingSystem.js`

## 资源管理
- **纹理资源**: `minecraft-bundles/textures/`
- **材质定义**: `src/MaterialManager.js`

## 调试技巧
1. **性能监控**: 查看 HUD 显示的 FPS 和区块信息
2. **碰撞调试**: 在 `Physics.js` 中启用辅助线可视化
3. **内存使用**: 监控 IndexedDB 存储使用情况
4. **网络请求**: 检查 Three.js 纹理加载状态

## 最近功能
- **004-hidden-face-culling**: 隐藏面剔除优化，提升渲染性能
- **003-land-caves**: 地形洞穴生成系统
- **002-warm-sun-light**: 温暖太阳光照系统
- **001-world-persistence**: 世界持久化存储
- **001-fps-optimization**: FPS 性能优化
- **001-realistic-textured-trees**: 真实纹理树木

## 在线演示
- 访问: https://js-perf.cn
- 项目描述: "妈妈不让我玩我的世界，所以我用 AI 做了一个，自己玩。"

## Recent Changes
- 008-save-game: Added JavaScript (ES6+ Modules) + Three.js (WebGL 2.0)
- 008-save-game: Added JavaScript (ES6+ Modules) + Three.js (WebGL 2.0)
- 007-chunk-optimization: Added JavaScript (ES6+ Modules) + Three.js (WebGL 2.0)

## Active Technologies
- 新的 IndexedDB 数据库 `mc_lite_manual_saves` (008-save-game)
