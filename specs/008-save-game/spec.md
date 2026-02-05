# Feature Specification: Save Game Functionality

**Feature Branch**: `008-save-game`
**Created**: 2026-02-05
**Status**: Draft
**Input**: User description: "我想给游戏加入存档功能，将正在进行中的玩家的位置，所有方块的位置数据全部保存到 indexedDB 中新开一个库存储起来，如果有存档的时候，打开游戏给一个提示，是用旧存档还是用全新的地图，如果是全新的地图，跟现在的初始化逻辑一致，如果是从存档读取，则恢复之前的存档，存档的动作在 设置面板中加一个按钮“存档”，点击后等存档完成后给一个提示即可。"

## Clarifications

### Session 2026-02-05
- **Q**: 存档触发方式与现有逻辑的关系？ → **A**: 存档是完全新增且解耦的功能。只有手动点击“存档”按钮时才会执行，不复用原有的即时/静默读写逻辑。
- **Q**: 数据存储位置？ → **A**: 必须使用一个全新的 IndexedDB 数据库（而不是在现有库中新增 store），与原始逻辑彻底隔离。
- **Q**: 存档内容与性能？ → **A**: 存档需包含所有方块数据和玩家位置。由于数据量巨大，存档操作必须在 Worker 中执行，且仅在点击按钮时重写，以避免影响游戏运行时的性能（不进行静默读写）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manual Game Saving (Priority: P1)

As a player, I want to manually save my current progress (position and all world blocks) via the settings menu so that I can resume playing from this exact state later without background saving affecting performance.

**Why this priority**: This is the core functionality requested. It emphasizes manual control and performance isolation.

**Independent Test**: Can be fully tested by making extensive changes to the world, clicking the "Save" button in settings, waiting for the worker to complete the heavy write, and verifying the success message.

**Acceptance Scenarios**:

1. **Given** I am in the game world, **When** I open settings and click "Save", **Then** a Worker process writes all current block data and player state to a *new* IndexedDB database.
2. **Given** a save is in progress, **When** it completes, **Then** a notification is shown, and no data was written to the storage until the button was clicked.

---

### User Story 2 - Resuming from Save (Priority: P1)

As a player, I want to be prompted when starting the game if a manual save exists in the dedicated database, so that I can choose to restore it or start a fresh map.

**Why this priority**: This provides the entry point for the persistent save data.

**Independent Test**: Can be tested by restarting the game and ensuring the prompt correctly identifies data in the new database.

**Acceptance Scenarios**:

1. **Given** a manual save exists in the new IndexedDB, **When** I open the game, **Then** I am presented with a choice: "Load Save" or "New World".
2. **Given** "Load Save" is selected, **When** the world initializes, **Then** it ignores the default generation and restores all blocks from the manual save.

---

### Edge Cases

- **Large Save Payload**: How the worker handles extremely large block data sets without crashing the browser tab.
- **Database Conflict**: Ensuring the new database name does not collide with the existing `mc_lite_persistence`.
- **Incomplete World Load**: What happens if the manual save database is present but missing chunks of data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a "Save Game" button within the settings panel UI.
- **FR-002**: System MUST capture the player's exact coordinates and orientation ONLY upon manual save trigger.
- **FR-003**: System MUST save the state of ALL blocks in the world to a **new, dedicated IndexedDB database** (separate from the existing persistence layer).
- **FR-004**: System MUST perform the heavy serialization and database write operations within a **Web Worker** to prevent main thread blocking.
- **FR-005**: System MUST detect the presence of the *manual* save database at startup.
- **FR-006**: System MUST present a modal choice to the user if a manual save is detected: "Load Save" or "New World".
- **FR-007**: System MUST NOT modify or clear the manual save database unless the user explicitly clicks "Save" again.
- **FR-008**: System MUST preserve the "New World" logic as per existing standard initialization when that option is chosen.

### Key Entities *(include if feature involves data)*

- **ManualSaveDB**: A completely separate IndexedDB instance.
- **WorldSnapshot**: A full dump of all active/modified blocks.
- **PlayerSnapshot**: Position and rotation at the moment of save.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Clicking "Save" does not cause visible frame drops (jank) on the main thread during the save process (delegated to worker).
- **SC-002**: Manual save data is stored in a database distinct from the session-based persistence.
- **SC-003**: Loading a save correctly restores 100% of the world state as it was at the moment of the manual save.
- **SC-004**: The startup prompt appears only when the dedicated manual save database contains valid data.
