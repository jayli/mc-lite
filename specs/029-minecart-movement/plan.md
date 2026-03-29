# Implementation Plan: Minecart Movement (矿车移动功能)

**Branch**: `029-minecart-movement` | **Date**: 2026-03-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/029-minecart-movement/spec.md`

## Summary

实现矿车沿铁轨移动的核心功能，包括：ctrl+左键激发前进/后退、铁轨检测与转弯、多矿车链接联动、碰撞检测与回弹。移动速度 1 方块/秒，最多链接 10 节矿车，不消耗资源。**重要优化**：使用 InstancedMesh 批量渲染矿车，参照 ZombieInstancedRenderer 实现共享几何体/材质，减少 draw call。

## Technical Context

**Language/Version**: JavaScript ES6+, Three.js r128+
**Primary Dependencies**: Three.js (WebGL渲染), MinecartManager (已有), PlayerInteraction (已有)
**Storage**: IndexedDB (通过 PersistenceService, MinecartManager 已支持)
**Testing**: 手动测试 + 浏览器控制台验证 (无自动化测试框架)
**Target Platform**: 现代 Web 浏览器 (WebGL 2.0)
**Project Type**: 纯客户端 3D 游戏应用
**Performance Goals**: 60 fps, 矿车移动流畅无卡顿, 批量渲染减少 draw call
**Constraints**: 内存效率（避免帧内临时对象）、响应时间 < 1秒、共享几何体/材质
**Scale/Scope**: 最多 50 矿车，最多 10 节链接

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Phase 0 Check**:

| 原则 | 检查项 | 状态 |
|------|--------|------|
| I. OO设计 & 分层 | 移动逻辑在 MinecartMovementSystem, 渲染在 MinecartInstancedRenderer | ✅ PASS |
| II. 内存效率 & GC | InstancedMesh 共享几何体/材质, 避免重复创建 | ✅ PASS |
| III. 主动资源释放 | MinecartInstancedRenderer.dispose() 统一释放资源 | ✅ PASS |
| IV. WebGL 性能优化 | InstancedMesh 批量渲染, 大幅减少 draw call | ✅ PASS |
| V. 简洁性 & 核心 | 仅实现必要移动逻辑, 不引入物理引擎 | ✅ PASS |
| VI. 资源管理 & 参考 | 仅使用现有 src 资源, 无外部引用 | ✅ PASS |

**Phase 1 Re-check** (设计完成后):

| 原则 | 检查项 | 状态 |
|------|--------|------|
| I. OO设计 & 分层 | 渲染器/移动系统/链接检测/碰撞系统职责分离 | ✅ PASS |
| II. 内存效率 & GC | 共享几何体/材质, 预分配临时对象 | ✅ PASS |
| III. 主动资源释放 | MinecartInstancedRenderer.dispose() 清理所有 GPU 资源 | ✅ PASS |
| IV. WebGL 性能优化 | 所有矿车仅需 2 个 draw call (车斗+车轮) | ✅ PASS |
| V. 简洁性 & 核心 | 参照成熟 ZombieInstancedRenderer 模式, 减少风险 | ✅ PASS |
| VI. 资源管理 & 参考 | 仅使用 src/assets/textures 已有材质, 无外部引用 | ✅ PASS |

**Gate Status**: ✅ 全部通过

## Project Structure

### Documentation (this feature)

```text
specs/029-minecart-movement/
├── plan.md              # 本文件
├── research.md          # Phase 0 研究
├── data-model.md        # Phase 1 数据模型
├── quickstart.md        # Phase 1 快速开始
└── tasks.md             # Phase 2 任务列表 (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actors/minecart/
│   ├── Minecart.js                 # 矿车实体类 (仅数据, 无渲染)
│   ├── MinecartManager.js          # 矿车管理器 (扩展链接/碰撞逻辑)
│   ├── MinecartPlacementHandler.js # 放置处理器 (无变更)
│   ├── MinecartInstancedRenderer.js# [新增] InstancedMesh 批量渲染器
│   ├── MinecartMovementSystem.js   # [新增] 移动系统核心
│   ├── MinecartLinkDetector.js     # [新增] 链接检测
│   └── MinecartCollisionSystem.js  # [新增] 碰撞系统
│
├── actors/player/
│   └── PlayerInteraction.js        # 扩展 ctrl+shift 激发逻辑
│
├── constants/
│   └── GameConfig.js               # 扩展移动配置常量
│
├── utils/
│   └── OrientationUtils.js         # 方向计算 (已存在,复用)
│
└── world/
    └── World.js                    # 铁轨检测接口 (已存在 getBlockEntry)
```

**Structure Decision**:
1. **渲染分离**: 新增 MinecartInstancedRenderer 专门处理 InstancedMesh 渲染，Minecart.js 仅存储数据状态
2. **职责分离**: 渲染器/移动系统/链接检测/碰撞系统各司其职，符合 OO 分层原则
3. **性能优化**: 所有矿车共享几何体/材质，通过矩阵变换实现独立位置/旋转

## InstancedMesh 架构设计

### 设计方案

参照 ZombieInstancedRenderer，矿车渲染分为 2 个 InstancedMesh：

```
MinecartInstancedRenderer
├── bodyMesh (InstancedMesh)    # 车斗 - 所有矿车共享
│   └── 共享: bodyGeometry (倒梯形), bodyMaterial
└── wheelMesh (InstancedMesh)   # 车轮 - 所有矿车共享
    └── 共享: wheelGeometry (圆柱体), wheelMaterial
```

### 关键优势

| 方面 | 原方案 (独立 Mesh) | 新方案 (InstancedMesh) |
|------|-------------------|----------------------|
| Draw Call | 每矿车 2 次 | 全部矿车仅需 2 次 |
| 内存占用 | 每矿车独立 geometry/material | 共享，仅矩阵数据 |
| 渲染性能 | O(n) draw calls | O(1) draw calls |
| 更新方式 | 直接修改 mesh.position | 更新实例矩阵 |

### 实现要点

1. **共享几何体**: 车斗倒梯形 + 车轮圆柱体，一次性创建
2. **共享材质**: 车斗木质材质 + 车轮金属材质，一次性创建
3. **矩阵更新**: 每帧通过 `setMatrixAt(index, matrix)` 更新每个矿车的位置/旋转
4. **车轮位置**: 4 个车轮相对矿车中心的偏移通过矩阵计算

## Complexity Tracking

> 无 Constitution 违规，无需记录。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (无) | - | - |