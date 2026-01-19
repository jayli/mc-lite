# Feature Specification: Refactor Layered Design

**Feature Branch**: `001-refactor-layered-design`
**Created**: 2026-01-19
**Status**: Draft
**Input**: User description: " 严格保持现有代码实现的功能不变，在此基础上优化代码结构，形成良好的js代码的分层设计，兼顾良好的可扩展性，请按照我的要求进行代码结构的调整，请注意要严格保持现有的代码功能不变。"

## Clarifications

### Session 2026-01-19

- Q: How should physical entities (clouds, islands, trees) be handled? → A: Their modeling logic must be extracted into independent modules/classes (e.g., `Cloud`, `Island`, `Tree`) within the World or Entity layer.
- Q: How should inventory logic be handled? → A: Inventory logic (state management) and UI presentation must be separated.
- Q: How to handle player equipment/tools? → A: Design a "slot" system for the player (Steve) to hold tools/items, enabling future extension for external capabilities (tools, weapons).
- Q: How to handle textures? → A: Currently use code-drawn textures, but design a "texture slot" or "material definition" system that supports future replacement with image-based textures.
- Q: What folder structure should be used? → A: Use `src/world/entities/` for static objects (Cloud, Tree), `src/entities/player/` for player logic, and `src/core/materials/` for textures.

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
-->

### User Story 1 - Game Engine Initialization Refactor (Priority: P1)

As a developer, I want the core Three.js initialization code extracted to a dedicated module so that the entry point is cleaner and the engine setup is reusable.

**Why this priority**: It is the foundation of the application.

**Independent Test**:
- Open the game in a browser.
- Verify that the scene renders (sky color, fog) and no console errors occur.
- Verify that the render loop is running.

**Acceptance Scenarios**:

1. **Given** the refactored code, **When** the game loads, **Then** the Three.js scene, camera, and renderer are initialized exactly as before.
2. **Given** the refactored code, **When** the window is resized, **Then** the renderer and camera update correctly.

---

### User Story 2 - World Generation & Chunk System Refactor (Priority: P1)

As a developer, I want the terrain generation, biome logic, and Chunk class moved to a World layer so that world management is decoupled from the main loop.

**Why this priority**: The chunk system is the most complex logic and needs isolation.

**Independent Test**:
- Walk around in the game.
- Verify chunks generate and unload as the player moves.
- Verify different biomes (Forest, Desert, Swamp, etc.) still appear correctly.

**Acceptance Scenarios**:

1. **Given** the player spawns, **When** they look around, **Then** terrain is generated using the existing noise algorithm and block types.
2. **Given** the player moves, **When** they cross chunk boundaries, **Then** new chunks load and old chunks unload (distance = 3).

---

### User Story 3 - Player & Physics Refactor (Priority: P1)

As a developer, I want the player controls and physics logic extracted to an Entity layer so that movement code is easier to maintain.

**Why this priority**: Player interaction is central to gameplay.

**Independent Test**:
- Use WASD to move and Space to jump.
- Verify collision detection prevents walking through blocks.
- Verify gravity works.

**Acceptance Scenarios**:

1. **Given** the user presses WASD, **When** the frame updates, **Then** the player moves at the same speed and direction as before.
2. **Given** the user presses Space, **When** on the ground, **Then** the player jumps.
3. **Given** the player walks into a wall, **When** collision occurs, **Then** movement is blocked.

---

### User Story 4 - UI & Interaction Refactor (Priority: P1)

As a developer, I want the inventory, HUD, and raycasting interaction logic moved to separate modules so that UI code doesn't clutter the game logic.

**Why this priority**: UI logic is distinct from 3D logic.

**Independent Test**:
- Press Z to open inventory.
- Click blocks to mine/place.
- Verify hotbar updates.

**Acceptance Scenarios**:

1. **Given** the user left-clicks a block, **When** raycast hits, **Then** the block is removed and particles spawn.
2. **Given** the user right-clicks with a block selected, **When** targeting a valid face, **Then** a block is placed.
3. **Given** the user presses Z, **When** inventory toggles, **Then** the UI overlay appears/disappears and pointer lock updates.

### Edge Cases

- **EC-001**: Player spawns inside a block -> Physics engine pushes them out or prevents suffocation.
- **EC-002**: Browser resize happens during frame render -> Renderer adapts without stretching.
- **EC-003**: Rapid inventory toggling -> State remains consistent, pointer lock behaves correctly.
- **EC-004**: Moving too fast across chunks -> Generator keeps up or handles delay gracefully (no crashes).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST strictly maintain all existing gameplay features (movement, mining, placing, terrain generation, inventory).
- **FR-002**: The codebase MUST be split into logical layers: Core (Engine), World (Chunks/Gen), Entities (Player), UI, and Utils.
- **FR-003**: `index.html` MUST only act as the entry point and UI container, delegating logic to JavaScript modules.
- **FR-004**: Global variables (like `chunks`, `scene`, `player`) MUST be managed within their respective modules or a central State manager, reducing global scope pollution.
- **FR-005**: The refactor MUST NOT introduce any build steps; it must remain a pure ESM (ECMAScript Modules) project usable directly in the browser.
- **FR-006**: Physical entity generation logic (Trees, Clouds, Islands) MUST be encapsulated in distinct modules.
- **FR-007**: Player entity MUST support an equipment slot system for future tool/weapon extensibility.
- **FR-008**: Block/Material system MUST abstract texture generation behind an interface that allows future swapping with image assets.

### Key Entities *(include if feature involves data)*

- **Game**: The main controller class/module that orchestrates the loop.
- **World**: Manages Chunks and terrain generation.
- **Chunk**: Represents a 16x16xH terrain segment.
- **Player**: Handles input handling, physics, and camera control.
- **Inventory**: Manages item counts and UI state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of existing features work identically to the pre-refactor version (Visual & Functional Parity).
- **SC-002**: `index.html` script content is reduced to < 50 lines (initializing the Game instance).
- **SC-003**: No circular dependencies between modules.
- **SC-004**: Zero distinct console errors introduced by the refactor.
