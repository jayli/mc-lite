# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

本项目是一个基于 Three.js 的纯前端项目，不包含复杂的构建系统。

- **运行项目**: 使用以下命令启动静态服务器：
  - `npm start` (推荐) - 使用自定义 Node.js 服务器，支持本地和网络访问
  - `npx serve .` - 使用 serve 静态服务器
  - `python3 -m http.server` - 使用 Python 内置服务器
- **构建**: 无需构建，直接修改 `index.html` 或 `src/` 下的文件。
- **测试**: 本项目目前没有自动化测试。
- **代码检查**: 本项目目前没有配置 lint 工具。

## 项目架构

本项目是一个简易的 Web 版《我的世界》（Minecraft）克隆，采用模块化架构设计。

### 核心架构模式

**分层架构**：
1. **表示层**：`Engine.js` (Three.js渲染)，`UIManager.js` (UI系统)
2. **业务逻辑层**：`Game.js` (游戏主循环)，`Player.js` (玩家控制)，`Physics.js` (物理系统)
3. **数据层**：`World.js` (世界管理)，`Chunk.js` (区块管理)，`TerrainGen.js` (地形生成)

**依赖关系**：
```
index.html → Game.js → Engine.js + World.js + Player.js + UIManager.js
World.js → Chunk.js → TerrainGen.js + MaterialManager.js + 实体系统
Player.js → Physics.js + Slots.js (背包系统)
UIManager.js → HUD.js + Inventory.js
```

### 关键系统设计

**游戏循环系统** (`Game.js`):
- 使用 `requestAnimationFrame` 实现主循环
- 每帧计算时间差 `dt`，调用 `update(dt)` 和 `render()`
- 协调所有子系统的更新和渲染

**区块管理系统** (`World.js` + `Chunk.js`):
- **动态加载**：基于玩家位置动态加载/卸载区块，渲染距离为3个区块
- **性能优化**：使用 `THREE.InstancedMesh` 优化相同类型方块的渲染
- **碰撞检测**：通过 `solidBlocks` Set 存储实心方块位置
- **区块尺寸**：每个区块 16×16 方块

**地形生成系统** (`TerrainGen.js` + `MathUtils.js`):
- **生物群系**：基于温度和湿度噪声生成森林、沙漠、沼泽、杜鹃林、平原
- **程序化生成**：使用多层噪声函数生成高度图
- **植被系统**：根据生物群系生成不同类型的树木、植物和结构

**材质管理系统** (`MaterialManager.js`):
- 集中管理所有方块材质
- 支持纹理预加载和程序化纹理生成
- 材质缓存避免重复创建

**光照与天空系统** (`Engine.js` + `Game.js`):
- **太阳表现**: 使用 `THREE.Sprite` 配合 Canvas 径向渐变纹理实现柔和太阳
- **同步机制**: 太阳位置始终保持在相对于玩家的无限远处（150单位）
- **平行光同步**: `DirectionalLight` 的方向与太阳方位严格对齐，提供温暖的光照色调 (`0xFFF4E0`)
- **阴影优化**: 阴影相机范围 `[-30, 30]`，采用负 bias 减少失真

### 性能优化策略

1. **实例化网格**：`Chunk.js` 中为每种方块类型创建 `InstancedMesh`，显著减少 draw calls
2. **几何体共享**：预定义共享几何体（花、藤蔓、睡莲、仙人掌等）
3. **动态资源管理**：区块卸载时清理几何体和材质资源
4. **粒子系统优化**：使用简单几何体，生命周期结束后清理

### 游戏机制实现

**玩家系统** (`Player.js` + `Physics.js`):
- **第一人称控制**：WASD移动，鼠标视角控制
- **物理碰撞**：基于方块网格的碰撞检测
- **交互系统**：鼠标左键挖掘，右键放置方块
- **背包系统**：9个物品槽，快捷栏选择

**UI系统** (`UIManager.js`):
- **HUD**：显示快捷栏和消息提示
- **背包界面**：按Z键切换，显示所有物品
- **物品渲染**：使用Canvas动态生成物品图标

### 生物群系特征

1. **森林**：5%几率生成树木（15%真实感树木，85%大型树木）
2. **杜鹃林**：6%几率生成杜鹃花树（带垂落效果）
3. **沼泽**：3%几率生成沼泽树，8%几率生成睡莲
4. **沙漠**：1%几率生成仙人掌，0.1%几率生成火星车
5. **平原**：0.5%几率生成默认树木，5%几率生成花朵，0.1%几率生成房屋

### 特殊结构生成

- **房屋**：5×5地基 + 3层墙壁 + 金字塔屋顶 + 床和箱子
- **火星车**：4个轮子 + 3×4车身 + 顶部箱子
- **沉船**：5×7船体 + 5层桅杆 + 船头箱子（深水区0.3%几率）
- **天空岛**：15%几率生成，高度40-70

### 技术栈
- **JavaScript (ES6 Modules)**: 模块化代码结构
- **Three.js**: 通过 CDN 加载，用于 3D 渲染
- **BufferGeometryUtils**: 用于合并几何体以优化渲染
- **Canvas API**: 动态生成方块纹理和UI图标

# Project Rules & Skills

- **Import Skill**: 实时遵循 `.claude/skills/*/skill.md` 中的指令。

## Active Technologies
- JavaScript (ES6+ Modules) + Three.js (via Import Map/CDN) (001-refactor-layered-design)
- In-memory (runtime state), potentially localStorage for persistence (future) (001-refactor-layered-design)
- JavaScript (ES6+) + Three.js (via CDN) (001-realistic-textured-trees)
- N/A (Runtime state only) (001-realistic-textured-trees)

## Recent Changes
- 001-refactor-layered-design: Added JavaScript (ES6+ Modules) + Three.js (via Import Map/CDN)
