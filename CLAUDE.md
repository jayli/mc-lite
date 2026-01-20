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

本项目是一个简易的 Web 版《我的世界》（Minecraft）克隆。

### 核心组件
- **`index.html`**: 包含所有核心逻辑，包括：
  - **场景初始化**: 设置 Three.js 场景、摄像机、渲染器、光照和雾效。
  - **地形生成**: 使用基于正弦函数的简单噪声算法 (`noise` 函数) 实现程序化地形生成。支持多种生物群系（平原、森林、杜鹃林、沙漠、沼泽）。
  - **Chunk 系统**: 按 16x16 的区块（Chunk）管理地形生成和销毁，以优化性能。
  - **渲染优化**: 使用 `THREE.InstancedMesh` 来高效渲染大量方块。
  - **玩家控制**: 自定义物理碰撞检测和移动逻辑（WASD 移动，空格跳跃）。
  - **交互逻辑**: 实现方块挖掘（左键）和放置（右键，包含“虚空搭路”逻辑）。
  - **UI/背包**: 基于 HTML/CSS 的 HUD、热力栏和背包界面。

### 目录结构
- `components/style/global.css`: 存储 UI 相关的样式。
- `components/main.js`: 预留的 JavaScript 模块文件（目前逻辑仍主要在 `index.html` 中）。

### 技术栈
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
