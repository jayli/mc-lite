# Implementation Plan: 隐藏面剔除优化

**Branch**: `004-hidden-face-culling` | **Date**: 2026-01-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-hidden-face-culling/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

**主要需求**: 实现隐藏面剔除算法，在密集方块区域提升至少30%的帧率，同时确保方块操作和透明方块处理的正确性。

**技术方案**: 采用简单相邻检查算法，使用位掩码存储每个方块的六个面可见性状态。算法支持增量更新（方块操作时立即更新相邻方块）、正确处理透明/半透明方块、跨区块边界计算，并提供带监控的优雅降级机制。集成调试视图和性能面板用于验证。

**关键技术决策**:
1. **算法**: 简单相邻检查（适合轴对齐方块，实时更新友好）
2. **存储**: 位掩码（每个方块1字节，内存高效）
3. **透明处理**: 基于材质透明度属性
4. **更新策略**: 增量更新 + 批量处理
5. **错误处理**: 优雅降级 + 性能监控

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules) + Three.js (WebGL 2.0)
**Primary Dependencies**: Three.js, IndexedDB (世界持久化）
**Storage**: IndexedDB (主要), LocalStorage (备用)
**Testing**: 浏览器开发者工具性能分析，手动视觉验证
**Target Platform**: 现代Web浏览器（支持WebGL 2.0）
**Project Type**: 单页Web应用（纯前端）
**Performance Goals**: 在密集方块区域帧率提升至少30%，保持稳定60FPS
**Constraints**: 内存使用需严格控制，避免GC停顿影响帧率，渲染距离3个区块半径
**Scale/Scope**: 基于当前渲染距离（3个区块半径）优化，每个区块16x16x256个方块

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. 面向对象与逻辑分层 (OO Design & Layering)
**状态**: ✅ 通过
**理由**: 隐藏面剔除算法将作为独立的模块实现，与现有渲染系统解耦。算法逻辑将封装在专门的类中，保持代码的面向对象设计。

### II. 内存效率与垃圾回收 (Memory Efficiency & GC)
**状态**: ✅ 通过
**理由**: 算法将使用高效的数据结构存储可见面状态，避免每帧创建临时对象。可见面状态将作为方块的属性存储，不会产生大量临时内存分配。

### III. 主动资源释放 (Proactive Resource Release)
**状态**: ✅ 通过
**理由**: 隐藏面状态将随区块一起加载和卸载。当区块超出渲染距离时，相关的隐藏面数据将随区块一起释放，符合主动资源释放原则。

### IV. WebGL/Three.js 性能优化 (Performance Optimization)
**状态**: ✅ 通过
**理由**: 隐藏面剔除是标准的WebGL性能优化技术，通过减少不可见面的渲染来降低Draw Call。这与InstancedMesh优化相辅相成，共同提升渲染性能。

### V. 简洁性与核心机制 (Simplicity & Core)
**状态**: ✅ 通过
**理由**: 隐藏面剔除是Minecraft类游戏的标准优化，专注于核心渲染性能提升，避免过度工程化。算法设计保持简洁，专注于解决性能瓶颈。

### VI. 资源管理与学习参考 (Resource Management & Learning Reference)
**状态**: ✅ 通过
**理由**: 此功能不涉及外部3D模型资源，完全基于代码实现的算法优化，符合资源管理原则。

**总体评估**: 所有宪法原则均得到遵守，功能设计符合项目技术约束和性能目标。

## 设计后宪法检查（Phase 1完成后）

### 设计一致性验证
**状态**: ✅ 通过
**理由**: 详细设计（research.md, data-model.md, contracts/）与宪法原则完全一致：
1. **面向对象**: FaceCullingSystem作为独立类实现，与现有系统解耦
2. **内存效率**: 使用位掩码存储（每个方块1字节），避免临时对象创建
3. **资源释放**: 可见面数据随区块一起加载/卸载
4. **性能优化**: 隐藏面剔除直接减少Draw Call，与InstancedMesh优化互补
5. **简洁性**: 采用简单相邻检查算法，避免过度工程化
6. **资源管理**: 纯代码实现，不依赖外部模型资源

### 技术约束验证
**状态**: ✅ 通过
**理由**: 设计满足所有技术约束：
- **WebGL 2.0兼容**: 基于Three.js现有渲染系统
- **内存控制**: 每个区块额外~64KB，总增加<1MB
- **性能目标**: 设计支持30%帧率提升目标
- **渲染距离**: 基于3个区块半径优化设计

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── materials/
│   │   └── MaterialManager.js      # 材质管理
│   └── FaceCullingSystem.js        # 新增：隐藏面剔除系统
├── world/
│   ├── Chunk.js                    # 区块管理（需要修改）
│   ├── World.js                    # 世界管理（需要修改）
│   ├── WorldWorker.js              # 世界生成Worker
│   └── entities/                   # 实体定义
├── services/
│   └── PersistenceService.js       # 持久化服务
├── utils/
│   └── MathUtils.js                # 数学工具
└── Engine.js                       # 渲染引擎

index.html                          # 主页面
```

**Structure Decision**: 采用单项目结构，符合现有代码库组织方式。隐藏面剔除系统将作为核心模块添加到`src/core/`目录中，与现有渲染系统集成。

## Complexity Tracking

> **无宪法原则违反，所有设计决策均符合简洁性原则**

**设计简化说明**:
1. **算法选择**: 采用简单相邻检查而非复杂空间分割算法，因为Minecraft方块都是轴对齐的
2. **数据结构**: 使用位掩码而非完整面对象数组，节省内存且访问高效
3. **更新策略**: 增量更新而非每帧全量计算，平衡性能和响应性
4. **错误处理**: 优雅降级而非复杂恢复机制，保证游戏可玩性

**拒绝的复杂方案**:
- **八叉树空间分割**: 过于复杂，不适合实时动态更新
- **预计算遮挡图**: 不适合频繁变化的世界状态
- **多线程Worker计算**: 增加复杂性，当前规模不需要
- **高级剔除算法**: 视锥体剔除等与隐藏面剔除互补但独立
