# Tasks: 下雨功能开关

**Input**: Design documents from `/specs/001-rain-toggle/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: 未明确要求测试，本任务列表不包含测试任务。

**Organization**: 任务按用户故事分组，支持独立实现和测试。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属用户故事（US1, US2）
- 描述中包含精确文件路径

## Path Conventions

本项目为单项目结构：`src/` 在仓库根目录

---

## Phase 1: Setup (共享基础设施)

**Purpose**: 项目初始化和基本结构

- [x] T001 确认开发环境可用，运行 `npm run start` 验证服务器正常启动
- [x] T002 确认现有代码结构，阅读 `src/ui/UIManager.js` 了解按钮绑定模式
- [x] T003 [P] 确认现有粒子系统实现，阅读 `src/world/effects/ParticleSystem.js` 了解特效模式

---

## Phase 2: Foundational (阻塞前置条件)

**Purpose**: 核心基础设施，必须在所有用户故事之前完成

**⚠️ CRITICAL**: 用户故事工作必须在此阶段完成后开始

- [x] T004 在 `src/world/effects/RainEffect.js` 创建 RainEffect 类骨架（export class RainEffect）
- [x] T005 在 `src/core/Game.js` constructor 中添加 `this.rainState = { enabled: false, lastToggleTime: 0 }` 和 `this.rainEffect = null`

**Checkpoint**: 基础就绪 - 用户故事实现可以开始

---

## Phase 3: User Story 1 - 开启/关闭下雨效果 (Priority: P1) 🎯 MVP

**Goal**: 玩家可以在配置菜单中点击下雨按钮，切换下雨效果的开启/关闭状态

**Independent Test**: 点击按钮并观察画面中是否出现雨滴效果来独立验证

### Implementation for User Story 1

- [x] T006 [P] [US1] 在 `index.html` 第105-108行的 setting-combined-box 内添加下雨按钮 HTML 元素（id="btn-rain-toggle", class="btn-small btn-status-toggle", text="点击开启")
- [x] T007 [P] [US1] 在 `src/ui/UIManager.js` initSettings() 中添加 btnRainToggle 按钮引用（const btnRainToggle = document.getElementById('btn-rain-toggle'))
- [x] T008 [US1] 在 `src/ui/UIManager.js` initSettings() 中添加下雨按钮点击事件处理（防抖检查 + 调用 game.toggleRain()）
- [x] T009 [US1] 在 `src/core/Game.js` 中添加 toggleRain() 方法（切换 rainState.enabled，创建/销毁 RainEffect 实例，HUD 消息提示）
- [x] T010 [US1] 在 `src/ui/UIManager.js` updateActiveButtons() 中添加下雨按钮状态更新逻辑（更新 class 和 innerText）

**Checkpoint**: 此时 User Story 1 应完全可用且可独立测试（按钮可点击，状态可切换）

---

## Phase 4: User Story 2 - 下雨效果的视觉反馈 (Priority: P2)

**Goal**: 下雨效果开启后，玩家能在游戏画面中看到明显的雨滴视觉效果

**Independent Test**: 开启下雨后，观察画面是否有雨滴从天空落下

### Implementation for User Story 2

- [x] T011 [P] [US2] 在 `src/world/effects/RainEffect.js` 实现 initParticles() 方法（创建 BufferGeometry、PointsMaterial、Points）
- [x] T012 [P] [US2] 在 `src/world/effects/RainEffect.js` 实现 resetParticle() 方法（在玩家周围50米半径内随机生成雨滴位置）
- [x] T013 [US2] 在 `src/world/effects/RainEffect.js` 实现 update() 方法（每帧更新雨滴位置，模拟落下效果）
- [x] T014 [US2] 在 `src/world/effects/RainEffect.js` 实现 dispose() 方法（释放 Three.js 资源：geometry、material、points）
- [x] T015 [US2] 在 `src/core/Game.js` update() 循环中添加雨滴更新调用（if rainEffect 存在则调用 rainEffect.update()）

**Checkpoint**: 此时 User Story 2 应完全可用且可独立测试（开启下雨可见雨滴落下）

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 跨用户故事的改进和验证

- [x] T016 [P] 运行 `npm run lint` 检查代码规范，修复警告
- [ ] T017 验证下雨效果性能：开启下雨后按 P 键查看帧率，确认下降不超过10%
- [ ] T018 验证防抖机制：快速连续点击下雨按钮，确认100-200ms内重复点击无效
- [ ] T019 验证资源释放：关闭下雨后检查 RainEffect.dispose() 是否正确释放 Three.js 资源

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 - 可立即开始
- **Foundational (Phase 2)**: 依赖 Setup 完成 - **阻塞所有用户故事**
- **User Story 1 (Phase 3)**: 依赖 Foundational 完成
- **User Story 2 (Phase 4)**: 依赖 Foundational 完成，可独立于 US1 实现（但实际需要 US1 的 toggleRain() 来触发）
- **Polish (Phase 5)**: 依赖所有用户故事完成

### User Story Dependencies

- **User Story 1 (P1)**: Foundational 完成后可开始 - 无其他故事依赖
- **User Story 2 (P2)**: 需要 US1 的 toggleRain() 方法触发 RainEffect 创建，但有 Foundational 后可并行开发核心逻辑

### Within Each User Story

- HTML 和按钮引用可并行 [P]
- 点击事件依赖按钮引用完成
- Game 方法可独立实现
- updateActiveButtons 依赖点击事件逻辑

### Parallel Opportunities

- Phase 1: T002, T003 可并行
- Phase 3: T006, T007 可并行（不同文件）
- Phase 4: T011, T012 可并行（同一文件不同方法，但有顺序依赖，实际建议顺序执行）
- Phase 5: T016 可独立并行

---

## Parallel Example: User Story 1

```bash
# 并行执行 HTML 和按钮引用任务：
Task: "在 index.html 添加下雨按钮 HTML 元素"
Task: "在 UIManager.js 添加 btnRainToggle 按钮引用"

# 顺序执行后续任务：
Task: "在 UIManager.js 添加点击事件处理"  # 依赖按钮引用
Task: "在 Game.js 添加 toggleRain() 方法"
Task: "在 UIManager.js 添加按钮状态更新逻辑"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup
2. 完成 Phase 2: Foundational (关键阻塞点)
3. 完成 Phase 3: User Story 1
4. **STOP and VALIDATE**: 点击按钮验证状态切换和 HUD 消息
5. 此时 MVP 已就绪（按钮功能可用）

### Incremental Delivery

1. 完成 Setup + Foundational → 基础就绪
2. 完成 User Story 1 → 独立测试 → MVP 可演示（按钮开关功能）
3. 完成 User Story 2 → 独立测试 → 完整功能可演示（雨滴视觉效果）
4. 完成 Polish → 性能验证 → 最终交付

---

## Notes

- [P] 任务 = 不同文件，无依赖冲突
- [Story] 标签映射任务到用户故事，便于追踪
- 每个用户故事应可独立完成和测试
- 每个任务或逻辑组完成后建议提交
- 在任何 checkpoint 停止验证故事独立性
- 避免：模糊任务、同文件冲突、跨故事依赖破坏独立性