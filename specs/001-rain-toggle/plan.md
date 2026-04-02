# Implementation Plan: 下雨功能开关

**Branch**: `001-rain-toggle` | **Date**: 2026-04-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-rain-toggle/spec.md`

## Summary

在配置菜单中新增"下雨"开关按钮，点击后切换下雨视觉效果。雨滴使用 Three.js 粒子系统实现，50-100颗稀疏雨滴在玩家周围50米半径范围内以每秒10-15米速度落下。按钮位于"TNT破坏方块"区域的"点击开启"按钮右侧，继承现有按钮样式。

## Technical Context

**Language/Version**: JavaScript (ES6+), Three.js r160+
**Primary Dependencies**: Three.js (场景、粒子系统、SpriteMaterial)
**Storage**: N/A (纯视觉效果，无持久化)
**Testing**: 手动测试（浏览器访问 http://localhost:8080/src/tests/index.html）
**Target Platform**: 现代 Web 浏览器，支持 WebGL 2.0
**Project Type**: 纯客户端 3D 体素游戏（Minecraft 克隆）
**Performance Goals**: 60 FPS，下雨效果帧率下降不超过10%
**Constraints**: 响应时间 <100ms，雨滴50-100颗，半径50米范围
**Scale/Scope**: 单玩家视野范围内的视觉效果

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. 面向对象与逻辑分层 | ✅ Pass | RainEffect 独立类，与 Engine/UI/Game 解耦 |
| II. 内存效率与垃圾回收 | ✅ Pass | 使用对象池管理雨滴，避免每帧创建临时对象 |
| III. 主动资源释放 | ✅ Pass | 关闭下雨时显式释放粒子资源 |
| IV. WebGL/Three.js 性能优化 | ✅ Pass | 使用 Points/BufferGeometry 高效渲染粒子 |
| V. 简洁性与核心机制 | ✅ Pass | 仅实现下雨视觉效果，无复杂天气系统 |
| VI. 资源管理与学习参考 | ✅ Pass | 不引用 minecraft-bundles，雨滴效果自主实现 |

**Gate Result**: PASS - 无宪法违规。Phase 1 设计后再次验证：所有原则仍满足。

## Project Structure

### Documentation (this feature)

```text
specs/001-rain-toggle/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── world/
│   └── effects/
│       ├── ParticleSystem.js    # 现有粒子系统（序列帧特效）
│       └── RainEffect.js        # 新增：下雨效果类
├── ui/
│   └── UIManager.js             # 修改：添加下雨按钮事件绑定
├── core/
│   └── Game.js                  # 修改：持有 RainEffect 实例
└── constants/
    └── GameConfig.js            # 修改：添加下雨配置常量（可选）

index.html                        # 修改：添加下雨按钮 HTML 元素
```

**Structure Decision**: 单项目结构，新增 RainEffect.js 到现有 effects 目录，修改 UIManager.js 和 index.html。

## Complexity Tracking

> 无宪法违规需要记录。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |