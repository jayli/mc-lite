<!--
Sync Impact Report:
- Version change: 1.0.0 -> 1.1.0
- List of modified principles:
  - Added: VI. 资源管理与学习参考 (Resource Management & Learning Reference)
- Added sections: None
- Removed sections: None
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (Constitution Check reference)
  - ✅ .specify/templates/spec-template.md (资源管理约束)
  - ✅ .specify/templates/tasks-template.md (资源管理任务类型)
- Follow-up TODOs: None
-->

# Minecraft-lite Constitution

## Core Principles

### I. 面向对象与逻辑分层 (OO Design & Layering)
代码必须保持良好的面向对象设计，逻辑分层合理。核心逻辑（游戏规则、物理、状态）、渲染引擎（Three.js 包装）和 UI（HTML/CSS 界面）应当解耦，以便于维护和扩展。

### II. 内存效率与垃圾回收 (Memory Efficiency & GC)
必须兼顾较高的内存效率，在保证游戏体验的前提下杜绝内存暴涨。做到合理的内存回收（GC），确保系统长期运行的稳定性。避免在每一帧创建大量临时对象。

### III. 主动资源释放 (Proactive Resource Release)
视距外（通常定义为 3 个区块外）的对象必须自动销毁。销毁时必须显式释放 Three.js 的几何体（Geometry）、材质（Material）以及相关的物理内存和 GPU 资源，防止内存泄漏。

### IV. WebGL/Three.js 性能优化 (Performance Optimization)
3D 渲染基于 WebGL (Three.js)，必须利用高效的渲染技术（如 InstancedMesh、Geometry Merging）来减少 Draw Call，并在可能的情况下使用高效的数据结构管理方块数据，确保高帧率体验。

### V. 简洁性与核心机制 (Simplicity & Core)
专注于核心 Minecraft 机制（挖掘、放置、生成），避免过度工程。保持代码简洁，易于理解，同时确保性能达到游戏级标准。遵循 YAGNI 原则，只实现当前需要的功能。

### VI. 资源管理与学习参考 (Resource Management & Learning Reference)
`minecraft-bundles` 目录中的内容仅作为学习参考使用。除了图片资源外，其他 3D 模型数据（如 OBJ、MTL 文件）不能在运行时直接引用。必须遵循以下规则：
1. 根据参考资料学习参考对象，然后在 JavaScript 中重新实现模型
2. 所有需要的图片资源必须从 `minecraft-bundles` 拷贝到 `src` 对应的目录中
3. 运行时只能使用 `src` 目录下的资源，不能直接引用 `minecraft-bundles` 中的文件

## 技术约束 (Technical Constraints)

- **运行时环境**: 现代 Web 浏览器，必须支持 WebGL 2.0。
- **核心引擎**: 基于 Three.js。
- **内存管理**: 严格控制在合理范围内，避免因大量 Chunk 生成导致的内存溢出或浏览器崩溃。

## 开发流程 (Development Workflow)

每次实现新功能前，必须在设计阶段考虑其对内存和渲染性能的影响。任何涉及区块（Chunk）生成、修改或销毁的变更都必须经过严格的资源释放验证。

## Governance

本宪法优先于所有其他开发实践。任何原则性的变更必须通过文档化、版本更新及同步影响评估。所有 Pull Request (PR) 的审查过程必须验证其是否符合上述内存管理和性能原则。

**Version**: 1.1.0 | **Ratified**: 2026-01-19 | **Last Amended**: 2026-01-22
