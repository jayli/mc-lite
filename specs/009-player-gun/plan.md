# Implementation Plan: 009-player-gun

**Branch**: `009-player-gun` | **Date**: 2026-02-06 | **Spec**: [specs/009-player-gun/spec.md](spec.md)
**Input**: Feature specification from `/specs/009-player-gun/spec.md`

## Summary

实现一个玩家第一人称手持枪支的效果。技术上，我们将使用 `GLTFLoader` 加载 `gun.gltf` 模型，并将其作为 `THREE.PerspectiveCamera` 的子对象。通过监听 'R' 键（KeyR）来切换枪支模型的 `visible` 属性，并同步控制玩家默认手臂（arm）的显示状态。

## Technical Context

**Language/Version**: ES6 Modules (JavaScript)
**Primary Dependencies**: Three.js, GLTFLoader
**Storage**: N/A
**Testing**: Manual testing via browser (given the interactive nature of the visual effect)
**Target Platform**: Modern Browsers with WebGL 2.0 support
**Project Type**: Single project (Web-based Three.js)
**Performance Goals**: 60 fps
**Constraints**: <200ms input latency for toggling
**Scale/Scope**: Single model integration and input handling

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (OO Design)**: 将枪支逻辑集成到 `Player` 类中，符合现有的玩家管理模式。
- **Principle II (Memory Efficiency)**: 模型仅加载一次并复用，切换可见性而非销毁/重新创建。
- **Principle IV (Performance)**: 使用子对象跟随模式，避免在 `update` 循环中手动进行复杂的矩阵计算。
- **Principle VI (Resource Management)**: 确保 `gun.gltf` 位于 `src` 目录下（`src/world/assets/mod/gun.gltf`），符合资源引用规则。

## Project Structure

### Documentation (this feature)

```text
specs/009-player-gun/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── Engine.js        # 加载模型逻辑
├── entities/
│   ├── player/
│   │   ├── Player.js    # 输入监听与枪支显示控制
├── world/
│   ├── assets/
│   │   ├── mod/
│   │   │   ├── gun.gltf # 枪支模型文件
```

**Structure Decision**: 遵循现有项目结构，在 `Engine.js` 处理加载，在 `Player.js` 处理逻辑与绑定。

## Complexity Tracking

> **No violations identified.**
