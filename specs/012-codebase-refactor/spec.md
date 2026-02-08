# Feature Specification: Codebase Refactoring

**Feature Branch**: `012-codebase-refactor`
**Created**: 2026-02-09
**Status**: Draft
**Input**: User description: "我希望重构一下现在的代码，只重构，方便后续维护和代码可读性，功能不做变动。

1. src/entities/player/Player.js 中关于枪的实现，抽象到src/entities/weapon/Gun.js 中，包括gun、mag7、minigun等，关于枪的一些通用配置参数也抽象出来，放在文件头部
2. src/entities/player/Player.js 中关于碰撞检测相关的代码抽象到 Physics.js 中
3. src/world/assets 目录移动到 src/assets，相关的资源引用也要响应的调整
4. src/core/face-culling-utils.js 移动到 src/utils/中，并且文件名改为FaceCullingUtils.js，相关的引用要同步调整
5. src/core/Engine.js 里的关键常数配置抽到文件头部，用常量定义并增加注释
6. src/core/materials/MaterialManager.js 移动到上级目录，src/core/materials 目录就不需要了
7. 原模型 src/world/assets/mod/minugun.glb 重命名为 minigun.glb，跟代码中的命名保持一致。
8. 最后更新 CLAUDE.md。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Maintainer Refactoring Experience (Priority: P1)

As a developer, I want to find code in logical locations and see clear abstractions so that I can maintain the codebase more efficiently without breaking existing game functionality.

**Why this priority**: The primary goal of this task is to improve code organization and maintainability. P1 ensures the core goal is met.

**Independent Test**: Can be fully tested by verifying that the game still runs correctly (player can move, shoot, and see the world) after all files are moved and references updated.

**Acceptance Scenarios**:

1. **Given** the game is running, **When** I move the player and interact with blocks, **Then** collision detection should work exactly as before.
2. **Given** the player has weapons, **When** I switch weapons and fire, **Then** all weapon effects (sounds, fire rates, models) should function correctly using the new Gun.js abstraction.
3. **Given** assets have been moved to `src/assets`, **When** the game loads, **Then** all models and textures (including the renamed minigun.glb) should load without errors.

---

### User Story 2 - Consistent Naming and Location (Priority: P2)

As a developer, I want file names and directory structures to follow a consistent pattern so that I don't have to hunt for files or deal with inconsistent naming.

**Why this priority**: Consistency reduces cognitive load and makes the project more professional.

**Independent Test**: Verified by checking the filesystem and ensuring no broken import paths exist.

**Acceptance Scenarios**:

1. **Given** `FaceCullingUtils.js` is now in `src/utils/`, **When** I check its usage in the rendering pipeline, **Then** it should be imported correctly using the PascalCase name.
2. **Given** `MaterialManager.js` is moved to `src/core/`, **When** I register new block types, **Then** the material system should function normally.

---

### Edge Cases

- What happens if a resource path is hardcoded in a script and missed during the move to `src/assets`?
- How does the system handle the transition if the `minigun.glb` model has internal references to its old name?
- What happens if multiple components depend on constants in `Engine.js` that are moved but not exported correctly?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST move all assets from `src/world/assets` to `src/assets`.
- **FR-002**: System MUST rename `src/assets/mod/minugun.glb` to `src/assets/mod/minigun.glb`.
- **FR-003**: System MUST relocate `src/core/materials/MaterialManager.js` to `src/core/MaterialManager.js` and delete the empty directory.
- **FR-004**: System MUST relocate `src/core/face-culling-utils.js` to `src/utils/FaceCullingUtils.js`.
- **FR-005**: System MUST extract weapon logic from `Player.js` into a new `src/entities/weapon/Gun.js` class.
- **FR-006**: System MUST extract collision detection logic from `Player.js` into its existing or updated `Physics.js` component.
- **FR-007**: System MUST consolidate critical constants in `Engine.js` to the top of the file with appropriate comments.
- **FR-008**: System MUST update all `import` and `fetch` references to reflect the new file locations and names.
- **FR-009**: System MUST update `CLAUDE.md` to reflect the new project structure and architectural changes.

### Key Entities

- **Gun**: An abstraction representing a weapon, containing parameters like fire rate, damage, sounds, and model references.
- **Physics**: A component responsible for handling spatial calculations, gravity, and collision detection between entities and the world.
- **MaterialManager**: The central registry for textures and shaders, now located at a more prominent level in the engine core.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of functional game tests (shooting, moving, world rendering) pass with zero regression in performance or behavior.
- **SC-002**: Zero "404 Not Found" errors in the browser console during a full game session (load -> play -> interact).
- **SC-003**: No circular dependencies introduced by the new `Gun.js` and `Physics.js` abstractions.
- **SC-004**: `Player.js` file size reduced by at least 20% by offloading weapon and physics logic.
