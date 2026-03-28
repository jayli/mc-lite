# Implementation Plan: Minecart (矿车系统)

**Branch**: `001-minecart-feature` | **Date**: 2026-03-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-minecart-feature/spec.md`

## Summary

实现矿车实体系统，包括：
1. **放置功能**: 玩家手持矿车物品在铁轨上右键放置，方向自动同步铁轨 orientation
2. **3D模型渲染**: 车斗+四轮的独立实体，不参与 instancedMesh 合并
3. **碰撞交互**: 透明实心碰撞体，玩家可站立、拾取
4. **持久化**: 绑定 chunk 存储，随区块加载/卸载
5. **背包注册**: 矿车物品注册到背包系统，图标使用 Invicon_Minecart.png

## Technical Context

**Language/Version**: JavaScript (ES6+), Three.js r128+
**Primary Dependencies**: Three.js (WebGL 渲染引擎)
**Storage**: IndexedDB (通过 PersistenceWorker/ManualSaveWorker)
**Testing**: 手动测试 (访问 http://localhost:8080/src/tests/index.html)
**Target Platform**: 现代浏览器 (WebGL 2.0 支持)
**Project Type**: 纯客户端 3D 体素游戏
**Performance Goals**: 60 FPS 稳定渲染，无 GC 峰值
**Constraints**: 内存高效，避免帧内对象创建，视距外自动销毁
**Scale/Scope**: 单玩家，最多数十个矿车实体

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 检查项 | 状态 |
|------|--------|------|
| I. 面向对象与逻辑分层 | 矿车实体独立类，管理器分离渲染/逻辑/持久化 | ✅ PASS |
| II. 内存效率与GC | 矿车模型复用材质，避免帧内创建临时对象 | ✅ PASS |
| III. 主动资源释放 | chunk 卸载时销毁矿车，释放 geometry/material | ✅ PASS |
| IV. WebGL/Three.js性能 | 矿车独立渲染（非 instancedMesh），数量有限不影响性能 | ✅ PASS |
| V. 简洁性与核心机制 | 仅实现放置/拾取，暂不实现移动（后续迭代） | ✅ PASS |
| VI. 资源管理与学习参考 | 矿车模型在 JS 中重新实现，材质从 src 目录加载 | ✅ PASS |

**Gate Result**: PASS - 所有原则符合，可进入 Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/001-minecart-feature/
├── spec.md              # 功能规格 (已完成)
├── plan.md              # 本文件
├── research.md          # Phase 0 研究输出
├── data-model.md        # Phase 1 数据模型
├── quickstart.md        # Phase 1 快速启动
├── contracts/           # Phase 1 合约 (N/A - 无外部接口)
└── tasks.md             # Phase 2 任务 (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── actors/
│   ├── minecart/
│   │   ├── Minecart.js              # 矿车实体类（模型、碰撞、拾取）
│   │   ├── MinecartManager.js       # 矿车生命周期管理
│   │   └── MinecartPlacementHandler.js  # 放置逻辑处理器
│   ├── entity-registry/
│   │   └── EntityRegistry.js        # 实体注册中心（扩展）
│   ├── turret/                      # 参考实现
│   └── zombie-nest/                 # 参考实现
├── constants/
│   └── BlockData.js                 # 方块属性（新增 mine_cart 物品）
│   └── GameConfig.js                # 游戏配置（矿车数量上限）
├── core/
│   ├── Game.js                      # 持有 MinecartManager
│   └── MaterialManager.js           # 材质管理（新增矿车材质）
├── services/
│   └── PersistenceService.js        # 持久化服务（扩展矿车存储）
├── ui/
│   └── Inventory.js                 # 背包界面（注册矿车物品）
├── utils/
│   └── ItemIconUtils.js             # 物品图标生成
│   └ OrientationUtils.js           # 方向工具（复用）
├── assets/
│   └ textures/
│   │   ├── minecart_body.png        # 矿车车斗材质 (新增)
│   │   ├── minecart_wheel.png       # 矿车车轮材质 (新增)
│   │   └ Invicon_Minecart.png       # 物品图标 (已存在)
└   tests/
    └── test-minecart.js             # 矿车单元测试 (新增)
```

**Structure Decision**: 采用 Option 1 单项目结构，矿车作为 `src/actors/minecart/` 子模块，参照现有 turret/zombie-nest 实现模式。

## Complexity Tracking

> 无宪法违规，无需复杂性跟踪。