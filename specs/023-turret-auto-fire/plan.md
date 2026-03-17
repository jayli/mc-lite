# Implementation Plan: 炮塔自动射击系统

**Branch**: `023-turret-auto-fire` | **Date**: 2026-03-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-turret-auto-fire/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

实现一个炮塔自动射击系统，使炮塔能够自动检测50格范围内的丧尸、旋转瞄准、发射炮弹攻击。炮弹命中丧尸3次后丧尸死亡。炮塔需要结构完整性，任一组成方块被破坏则失去功能。

**技术方案**: 使用 Three.js 的 Object3D 层次结构管理炮塔旋转，通过独立的 Turret 类管理每座炮塔的状态和行为，炮弹使用简单的物理运动轨迹。

## Technical Context

**Language/Version**: JavaScript ES6+
**Primary Dependencies**: Three.js (r128+), Custom Entity System
**Storage**: N/A (纯内存状态管理)
**Testing**: 浏览器端测试框架 (src/tests/index.html)
**Target Platform**: 现代 Web 浏览器 (WebGL 2.0)
**Project Type**: 3D 体素游戏客户端
**Performance Goals**: 60 FPS，单场景支持 <20 座炮塔同时运作
**Constraints**: <100MB 内存，避免每帧创建临时对象，主动释放 GPU 资源
**Scale/Scope**: 每座炮塔独立计算，炮弹池化管理避免频繁创建销毁

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 原则符合性检查

| 原则 | 符合性 | 说明 |
|------|--------|------|
| I. 面向对象与逻辑分层 | ✅ PASS | Turret 类封装炮塔逻辑，独立于渲染和 World 层 |
| II. 内存效率与垃圾回收 | ✅ PASS | 使用炮弹对象池，避免每帧创建临时对象 |
| III. 主动资源释放 | ✅ PASS | 炮塔销毁时显式释放 Three.js 几何体和材质 |
| IV. WebGL/Three.js 性能优化 | ✅ PASS | 炮塔使用 InstancedMesh，炮弹使用简单几何体 |
| V. 简洁性与核心机制 | ✅ PASS | 专注于核心炮塔功能，避免过度设计 |
| VI. 资源管理与学习参考 | ✅ PASS | 无需外部模型资源，使用现有方块材质 |

**Gate 结果**: ✅ **PASSED** - 所有原则符合，可以进入 Phase 0

## Project Structure

### Documentation (this feature)

```text
specs/023-turret-auto-fire/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── spec.md              # Feature specification
└── checklists/          # Quality checklists
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── Engine.js           # Three.js 渲染引擎
│   ├── Game.js             # 游戏主循环
│   └── EnemyManager.js     # 丧尸管理
├── world/
│   ├── World.js            # 世界管理
│   ├── Chunk.js            # 区块渲染
│   └── entity-system/      # 实体系统
│       ├── EntityManager.js
│       ├── CodeEntity.js
│       └── JsonEntity.js   # 炮塔 JSON 定义位置
├── actors/
│   ├── turret/             # [NEW] 炮塔相关类
│   │   ├── Turret.js       # 炮塔核心类
│   │   ├── TurretManager.js # 炮塔管理器
│   │   └── Projectile.js   # 炮弹类
│   └── enemy/
│       └── Zombie.js       # 需要添加受击计数
└── utils/
    └── MathUtils.js        # 向量计算工具
```

**Structure Decision**: 炮塔功能作为新的 actors/turret/ 模块实现，遵循现有项目结构。Turret 类封装单座炮塔逻辑，TurretManager 管理所有炮塔实例，Projectile 表示飞行中的炮弹。

## Phase 完成状态

### Phase 0: 研究与决策 ✅
- **research.md**: 完成 - 包含技术决策、风险评估、依赖项
- **关键技术决策**:
  - 炮塔旋转：使用 Three.js Object3D 嵌套层次结构
  - 炮弹管理：使用对象池（Object Pool）避免 GC 压力
  - 目标检测：每座炮塔独立遍历 EnemyManager
  - 碰撞检测：简单距离检测（球体碰撞）

### Phase 1: 设计与契约 ✅
- **data-model.md**: 完成 - 定义 Turret、Projectile、Zombie 三个实体
- **quickstart.md**: 完成 - 包含测试步骤、调试命令、故障排除
- **contracts/**: 跳过 - 本项目为纯内部实现，无外部接口
- **Agent Context**: 已更新 - CLAUDE.md 已同步技术栈信息

### Phase 1 后 Constitution Check 重评估

| 原则 | 符合性 | 说明 |
|------|--------|------|
| I. 面向对象与逻辑分层 | ✅ PASS | Turret、TurretManager、Projectile 类职责清晰 |
| II. 内存效率与垃圾回收 | ✅ PASS | 使用 ProjectilePool 对象池，符合内存管理原则 |
| III. 主动资源释放 | ✅ PASS | destroy() 方法显式清理 Three.js 资源 |
| IV. WebGL/Three.js 性能优化 | ✅ PASS | 使用 Object3D 层次结构，炮弹使用简单几何体 |
| V. 简洁性与核心机制 | ✅ PASS | 实现聚焦核心功能，无过度设计 |
| VI. 资源管理与学习参考 | ✅ PASS | 复用现有方块材质，无外部模型依赖 |

**Phase 1 Gate 结果**: ✅ **PASSED**

---

## 下一步

运行 `/speckit.tasks` 生成任务列表，然后执行 `/speckit.implement` 开始实现。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 无违规 | - | - |
