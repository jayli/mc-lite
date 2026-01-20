# Tasks: Realistic Textured Trees

**Input**: Design documents from `/specs/001-realistic-textured-trees/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Prepare the project structure for the new tree logic.

- [X] T001 Create a new JavaScript file for the tree module at `components/realistic_tree.js`
- [X] T002 In `src/world/Chunk.js`, import the new `RealisticTree` module.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the core texture loading mechanism required for the new tree.

- [X] T003 In `src/core/materials/MaterialManager.js`, implement a system to preload and cache image textures from URLs.

---

## Phase 3: User Story 1 - 提升森林生物群系的视觉体验 (Priority: P1) 🎯 MVP

**Goal**: Players can see new, more realistic trees mixed with original trees in the forest biome.

**Independent Test**: Enter a world with a forest biome. Fly around and observe. Both old and new tree types should be visible, with new trees making up roughly 25% of the total. New trees should look visually distinct and detailed.

### Implementation for User Story 1

- [X] T004 [US1] In `src/world/entities/RealisticTree.js`, define and export a `RealisticTree` class with a static `generate` method.
- [X] T005 [P] [US1] Inside `src/world/entities/RealisticTree.js`, implement logic to create the tree trunk geometry and add it to the chunk.
- [X] T006 [P] [US1] Inside `src/world/entities/RealisticTree.js`, implement logic to create the tree leaves geometry and add it to the chunk.
- [X] T007 [US1] In `src/world/Chunk.js`, modify the forest biome's tree generation logic to call `RealisticTree.generate()` for approximately 25% of the trees.
- [X] T008 [US1] In `src/entities/player/Player.js`, update the block removal logic to handle the new `realistic_trunk` and `realistic_leaves` mesh types.
- [X] T009 Verify in `src/world/Chunk.js` that the `dispose` method correctly cleans up the dynamically added meshes for realistic trees.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, cleanup, and performance checks.

- [X] T010 Verify in `index.html` that when a chunk is unloaded, all associated `RealisticTree` objects and their resources (geometries, materials, textures) are properly disposed of to prevent memory leaks.
- [X] T011 Conduct a performance test within the forest biome to confirm that the introduction of new trees does not cause the frame rate to drop by more than 10% from the baseline.
- [X] T012 Perform a final code review and cleanup of all new logic in `index.html` and `components/realistic_tree.js`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Must be completed first.
- **Foundational (Phase 2)**: Depends on Setup. Blocks User Story 1.
- **User Story 1 (Phase 3)**: Depends on Foundational.
- **Polish (Phase 4)**: Depends on User Story 1.

### Within Each User Story

- **T005** and **T006** can be worked on in parallel.
- **T008** and **T009** depend on the completion of **T004**, **T005**, and **T006**.

### Implementation Strategy

The recommended approach is to follow the phases sequentially as this feature is contained within a single user story.
1.  Complete Phase 1 & 2 to set up the structure and foundational loaders.
2.  Implement all tasks in Phase 3 to deliver the core feature.
3.  Validate and clean up in Phase 4.
