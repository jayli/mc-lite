# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

本项目是一个基于 Three.js 的纯前端项目，不包含复杂的构建系统。

- **运行项目**: 使用以下命令启动静态服务器：
  - `npm start` (推荐)
  - `npx serve .`
  - `python3 -m http.server`
- **构建**: 无需构建，直接修改 `index.html` 或 `components/` 下的文件。
- **测试**: 本项目目前没有自动化测试。
- **代码检查**: 本项目目前没有配置 lint 工具。

## 项目架构

本项目是一个简易的 Web 版《我的世界》（Minecraft）克隆，现已重构为模块化的代码结构。

### 核心组件
项目的核心逻辑被拆分到 `src/` 目录下的多个模块中：
- **`src/core/Game.js`**: 游戏主循环和状态管理。
- **`src/core/Engine.js`**: 封装 Three.js 的核心功能，如场景、摄像机、渲染器和光照。
- **`src/world/World.js`**: 管理世界中的所有物体，包括地形（Chunks）和实体。
- **`src/world/Chunk.js`**: 负责单个区块的生成、管理和渲染优化（InstancedMesh）。
- **`src/world/TerrainGen.js`**: 程序化地形生成逻辑。
- **`src/entities/player/Player.js`**: 玩家角色，包含控制和交互逻辑。
- **`src/entities/player/Physics.js`**: 玩家的物理和碰撞检测。
- **`src/ui/UIManager.js`**: 管理游戏的用户界面，包括 HUD 和背包。

### 目录结构
- `src/core`: 游戏引擎和核心逻辑。
- `src/entities`: 游戏中的实体，如玩家。
- `src/style`: 全局 CSS 样式。
- `src/ui`: UI 组件和管理器。
- `src/utils`: 通用工具函数。
- `src/world`: 世界生成、区块管理和环境实体。
- `index.html`: 应用入口，负责加载脚本和初始化游戏。

### 技术栈
- **JavaScript (ES6 Modules)**: 项目现在使用模块化的 JavaScript。
- **Three.js**: 通过 CDN 加载，用于 3D 渲染。
- **BufferGeometryUtils**: 用于合并几何体以优化渲染。
- **Canvas API**: 动态生成方块纹理和图标。

# Project Rules & Skills

- **Import Skill**: 实时遵循 `.claude/skills/*/skill.md` 中的指令。


## Active Technologies
- JavaScript (ES6+ Modules) + Three.js (via Import Map/CDN) (001-refactor-layered-design)
- In-memory (runtime state), potentially localStorage for persistence (future) (001-refactor-layered-design)
- JavaScript (ES6+) + Three.js (via CDN) (001-realistic-textured-trees)
- N/A (Runtime state only) (001-realistic-textured-trees)

## Recent Changes
- 001-refactor-layered-design: Added JavaScript (ES6+ Modules) + Three.js (via Import Map/CDN)
