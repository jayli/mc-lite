# Implementation Plan: Minigun Weapon

**Branch**: `011-minigun-weapon` | **Date**: 2026-02-08 | **Spec**: [specs/011-minigun-weapon/spec.md](spec.md)
**Input**: Feature specification from `/specs/011-minigun-weapon/spec.md`

## Summary

本功能旨在为游戏新增一把高射速武器 **Minigun**。技术实现上，将参考现有的 `WeaponSystem`（集成在 `Player.js` 中），通过扩展 `WeaponMode` 常量，在 `Engine.js` 中异步加载 `.glb` 模型，并在 `Player.js` 中实现基于循环计时的连发逻辑、拿起动画以及专属的音效反馈。

## Technical Context

**Language/Version**: JavaScript (ES6 Modules)
**Primary Dependencies**: Three.js (via CDN), GLTFLoader
**Storage**: N/A (武器状态不持久化，仅位置/修改通过 PersistenceService 存储)
**Testing**: Manual Interaction Testing (as per spec scenarios)
**Target Platform**: Web Browser (WebGL 2.0)
**Project Type**: Web Application (Single-page Three.js Project)
**Performance Goals**: 60 FPS (Sub-50ms model switch latency, ~20 shots/sec logic overhead < 1ms)
**Constraints**: < 100MB memory (Must dispose clones if many instances created, though here it's a singleton for player)
**Scale/Scope**: Singleton weapon instance on Player entity

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **OO Design & Layering**: 模型加载位于 Engine，逻辑位于 Player，资源管理位于 MaterialManager/AudioManager。符合分层原则。
- [x] **Memory Efficiency & GC**: 射击使用示踪线池（Tracer Pool），避免每帧 new 对象。符合内存效率原则。
- [x] **Proactive Resource Release**: 武器模型作为 Player 的一部分，随 Player 存在。切换时正确移除旧模型。
- [x] **Performance Optimization**: 连发逻辑使用简单的计时器，示踪线使用 InstancedMesh 或 Pool。
- [x] **Simplicity & Core**: 仅实现核心的切换、射击、动画反馈，不引入过度工程。
- [x] **Resource Management**: 模型文件位于 `src/world/assets/mod/`，图片资源已拷贝，符合资源管理原则。

## Project Structure

### Documentation (this feature)

```text
specs/011-minigun-weapon/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (to be generated)
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── Engine.js        # Model loading
│   ├── AudioManager.js  # Sound preloading
├── entities/
│   ├── player/
│   │   ├── Player.js    # Weapon logic, input, animation
├── world/
│   ├── assets/
│   │   ├── mod/
│   │   │   └── minugun.glb # Asset file
```

**Structure Decision**: 遵循现有的单层 src 结构，将逻辑注入到 Player 和 Engine 的对应模块中。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

(No violations identified)
