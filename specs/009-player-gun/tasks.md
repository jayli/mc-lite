# Tasks: 009-player-gun

## Phase 1: Setup
- [X] T001 Verify assets exist in src/world/assets/mod/gun.gltf
- [X] T002 Update src/core/Engine.js to export gunModel and initialize as null

## Phase 2: Foundational
- [X] T003 Implement GLTF loading logic for gun.gltf in src/core/Engine.js loadModel method
- [X] T004 Initialize isHoldingGun and gun properties in src/entities/player/Player.js constructor

## Phase 3: User Story 1 - 持枪切换 (Priority: P1)
**Goal**: 实现按下 'R' 键在空手和持枪状态之间切换。
**Independent Test**: 进入游戏后按下 'R' 键，观察模型是否出现；再次按下，观察模型是否消失。

- [X] T005 [P] [US1] Add 'KeyR' event listener in src/entities/player/Player.js setupInput to toggle isHoldingGun
- [X] T006 [US1] Implement toggle logic in src/entities/player/Player.js update method to sync visibility of gun and arm

## Phase 4: User Story 2 - 第一人称持枪视觉效果 (Priority: P2)
**Goal**: 枪支始终位于视野右下角，枪口对准前方。
**Independent Test**: 在持枪状态下转动视角，观察枪支模型是否保持在屏幕右下角相对位置。

- [X] T007 [US2] Implement logic to add gun model to camera and set its relative position/rotation in src/entities/player/Player.js
- [X] T008 [US2] Fine-tune gun model position (0.5, -0.4, -0.8) and orientation in src/entities/player/Player.js for 75 FOV

## Phase 5: Polish & Cross-Cutting Concerns
- [X] T009 Ensure gun model materials are correctly handled (shadows/side) in src/core/Engine.js
- [X] T010 Add console log for gun loading status in src/core/Engine.js

## Implementation Strategy
- MVP: 完成 US1，实现基本的切换显示逻辑。
- Incremental: 随后完成 US2 进行精确的位置和姿态校准。

## Dependencies
- US1 depends on Foundational phase.
- US2 depends on US1.
