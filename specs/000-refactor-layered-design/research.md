# Research: Refactor Layered Design

**Status**: Complete
**Date**: 2026-01-19

## Overview

This research phase focuses on determining the best practices for structuring a vanilla Three.js project without build tools (ES modules only) while ensuring strict feature parity and preparing for future extensibility (physical entities, slots, materials).

## Key Decisions

### 1. Module System
- **Decision**: Native ES Modules (ESM)
- **Rationale**: The project explicitly forbids build tools. Modern browsers support `<script type="module">` and `import/export` natively.
- **Implementation**: `index.html` will import `src/core/Game.js`, which will orchestrate other imports. Import maps are already used for Three.js and will be preserved.

### 2. State Management
- **Decision**: Domain-scoped State Objects (No Redux/global store lib)
- **Rationale**: For a game loop, accessing state via centralized stores (like Redux) can be slow. Direct property access on Managers (e.g., `world.chunks`, `player.position`) is more performant and aligns with the "Simplicity" principle.
- **Implementation**:
  - `Game` holds instances of `World`, `Player`, `UIManager`.
  - Components communicate via method calls or simple event listeners for UI updates (e.g., `inventory.onUpdate(() => ui.refresh())`).

### 3. Texture/Material Abstraction
- **Decision**: `MaterialManager` Registry
- **Rationale**: To support swapping code-generated textures with images later, we need a layer of indirection.
- **Implementation**:
  - A dictionary/map mapping block types to material definitions.
  - Interface: `getMaterial(type): THREE.Material`.
  - Future-proofing: The implementation of `getMaterial` can check a config to decide whether to return a `CanvasTexture` (current) or `TextureLoader` result (future).

### 4. Physical Entity Modeling
- **Decision**: Class-based Procedural Generation
- **Rationale**: "Clouds", "Trees", "Islands" are currently just loops placing blocks. Encapsulating them in classes allows them to carry state (if needed later) or just organize the generation logic.
- **Structure**:
  - `class Tree { static generate(x, y, z, chunk) { ... } }` (Stateless generation preferred for static blocks).
  - Or `class Cloud { constructor(...) { ... } update() { ... } }` (For moving entities).

### 5. Player Slots System
- **Decision**: Array-based Slot System
- **Rationale**: Arrays are efficient and map directly to hotbar keys (0-9).
- **Structure**:
  - `player.slots = [Slot, Slot, ...]`.
  - `Slot` object contains `{ item: "string", count: number, meta: {} }`.
  - This supports the requirement for "future extensibility" (e.g., meta can hold durability, enchantments).

## Alternatives Considered

- **ECS (Entity Component System)**:
  - **Rejected**: Overkill for a "Lite" Minecraft clone. Would require a massive rewrite of logic which violates the "Strict Feature Parity" risk constraint. Sticking to OO/Manager pattern is safer.
- **Global Event Bus**:
  - **Rejected**: Can make flow hard to trace. Direct references (Dependency Injection via constructor) are cleaner for this scale (~15 files).

## Unknowns Resolved

- **Texture System**: Defined as a Registry pattern.
- **Folder Structure**: Defined in Plan.md.
- **Module Loading**: Confirmed native ESM.
