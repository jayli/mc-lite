# Implementation Plan: Save Game Functionality (Manual & Decoupled)

**Branch**: `008-save-game` | **Date**: 2026-02-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-save-game/spec.md`

## Summary

实现一个完全独立且手动触发的存档系统。该系统与现有的 `PersistenceService` 解耦，使用全新的 IndexedDB 数据库 `mc_lite_manual_saves`。只有在设置面板点击“存档”按钮时，才会通过专门的 Web Worker 将当前世界的所有方块快照和玩家状态写入该数据库。启动时，若检测到该独立数据库，将提示玩家选择加载或开启新世界。

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (WebGL 2.0)
**Storage**: 新的 IndexedDB 数据库 `mc_lite_manual_saves`
**Testing**: 手动功能验证 (涉及世界修改、存档、重启、加载/放弃)
**Target Platform**: 支持 WebGL 2.0 和 Web Workers 的现代浏览器
**Project Type**: 单页 Web 项目 (纯前端)
**Performance Goals**: 存档过程不对主线程造成可见卡顿 (jank)；异步处理全量数据序列化
**Constraints**: 必须与现有 `PersistenceService` 逻辑隔离；不进行静默读写
**Scale/Scope**: 支持对当前所有已生成的区块及方块增量进行全量快照存储

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| I. OO Design & Layering | PASS | 新增 `ManualSaveService` 类，保持与渲染引擎解耦 |
| II. Memory Efficiency & GC | PASS | 全量数据处理在 Worker 中进行，避免主线程对象积压 |
| III. Proactive Resource Release | PASS | 不改变现有区块销毁逻辑，仅做快照提取 |
| IV. Performance Optimization | PASS | 核心要求：重度读写在 Worker 中，主线程仅做数据传输 |
| V. Simplicity & Core | PASS | 仅在用户请求时触发，符合 YAGNI 且不增加日常运行负担 |
| VI. Resource Management | PASS | 不涉及外部资源引用变更 |

## Project Structure

### Documentation (this feature)

```text
specs/008-save-game/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── core/
│   └── Game.js             # 启动流程注入与存档逻辑入口
├── services/
│   └── ManualSaveService.js # [NEW] 独立存档服务
├── workers/
│   └── ManualSaveWorker.js # [NEW] 专用存档工作线程
├── ui/
│   └── UIManager.js        # 按钮绑定与模态框管理
└── constants/
    └── SaveConfig.js       # [NEW] 独立存档库配置
```

**Structure Decision**: 采用新增独立服务和 Worker 的方式，确保功能完整隔离。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | - | - |
