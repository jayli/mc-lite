# Implementation Plan: Three.js r160 → r184 升级

**Branch**: `001-upgrade-threejs-r184` | **Date**: 2026-05-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-upgrade-threejs-r184/spec.md`

## Summary

将项目的 Three.js 从 r160 (0.160.0) 升级到 r184 (0.184.0)。核心改动为 CDN 版本号变更和 `BufferAttribute.updateRange` API 迁移。升级保持 WebGLRenderer 路径不变，为未来 WebGPU 迁移铺路。

## Technical Context

**Language/Version**: JavaScript (ES Modules, 无构建步骤)
**Primary Dependencies**: Three.js 0.160.0 → 0.184.0 (CDN via jsdelivr)
**Storage**: IndexedDB (持久化，本次升级不涉及)
**Testing**: Playwright headless 浏览器测试 (`node command/run-tests.js`)
**Target Platform**: 现代 Web 浏览器 (WebGL 2.0)
**Project Type**: 纯客户端体素游戏（无后端）
**Performance Goals**: 60 fps，区块加载无卡顿
**Constraints**: 无构建步骤，ES Modules + Import Maps 直接加载 CDN
**Scale/Scope**: 单文件改动 3 处，影响面极小

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 面向对象与逻辑分层 | ✅ 通过 | 不改变架构分层 |
| II. 内存效率与垃圾回收 | ✅ 通过 | `addUpdateRange` 语义与原 API 等价，无额外内存开销 |
| III. 主动资源释放 | ✅ 通过 | 不影响资源释放机制 |
| IV. WebGL/Three.js 性能优化 | ✅ 通过 | InstancedMesh 机制不变，`addUpdateRange` 支持更精确的增量更新 |
| V. 简洁性与核心机制 | ✅ 通过 | 最小改动量，无过度工程 |
| VI. 资源管理与学习参考 | ✅ 通过 | 不涉及资源目录 |

**GATE RESULT**: 全部通过，无违反项。

## Project Structure

### Documentation (this feature)

```text
specs/001-upgrade-threejs-r184/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (by /speckit.tasks)
```

### Source Code (affected files)

```text
index.html                              # Import Maps CDN 版本号
src/core/GlobalInstancedMeshManager.js  # updateRange → addUpdateRange
src/core/Engine.js                      # 可能需要 outputColorSpace 设置
```

**Structure Decision**: 本次升级是版本号变更 + API 适配，不新增文件，仅修改现有文件。

## Complexity Tracking

无违反项，不需要填写。
