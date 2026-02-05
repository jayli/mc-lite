# Feature Specification: Chunk Optimization (Background Consolidation)

**Feature Branch**: `007-chunk-optimization`
**Created**: 2026-02-05
**Status**: Draft
**Input**: User description: "解决世界生成后，玩家跟世界互动之后fps不下降...当新增的方块到达一个阈值的时候，就在 worker 里对世界中最初创建的和玩家创建的方块做一次整体更新，将所有现存的方块都纳入到instanceMesh 管理中...减少玩家新创建方块的实例的数量。实现一定程度的内存共享，进而降低一部分方块渲染计算量。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Smooth Block Interaction (Priority: P1)

As a player, I want to place and break blocks without experiencing immediate or long-term performance degradation, so that the game remains fluid even after extensive building.

**Why this priority**: Core gameplay loop stability is the highest priority. Ensuring high FPS during and after interaction is the primary goal of this feature.

**Independent Test**: Can be tested by placing 100+ blocks in a single chunk and verifying that the FPS remains stable and Draw Calls remain low after the background optimization completes.

**Acceptance Scenarios**:

1. **Given** I am in a loaded chunk, **When** I place a new block, **Then** I see the block immediately rendered as a standalone mesh for instant feedback.
2. **Given** I have placed several blocks (e.g., 50+) or stopped interacting for a short duration (e.g., 2 seconds), **When** the background consolidation triggers, **Then** all my placed blocks are merged into the chunk's optimized `InstancedMesh` system without visible flickering or lag.

---

### User Story 2 - Performance Stability (Priority: P2)

As a player, I want the world to remain optimized even after I have significantly modified the terrain, so that my complex structures don't slow down the rendering engine.

**Why this priority**: Long-term playability depends on the system's ability to "heal" itself from fragmented rendering (too many individual meshes).

**Independent Test**: Measure Draw Calls using browser dev tools before and after consolidation. Total Draw Calls for the chunk should return to a baseline level (similar to initial generation) regardless of user modifications.

**Acceptance Scenarios**:

1. **Given** a chunk has 100 individual player-placed meshes, **When** the consolidation threshold is reached, **Then** the 100 meshes are replaced by a single `InstancedMesh` update per block type.
2. **Given** a consolidation is in progress in the background, **When** I continue to move or interact, **Then** I should not experience "Lag Spikes" or frame drops.

---

### Edge Cases

- **Rapid Interaction**: What happens when a player places blocks faster than the consolidation can complete? (System should debounce or queue the next consolidation).
- **Chunk Unloading**: What happens if a chunk is unloaded while a background consolidation is pending? (The consolidation should be cancelled or discarded safely).
- **Memory Limits**: How does the system handle extremely dense block placements? (Thresholds should be tuned to prevent excessive Worker messaging).
- **Interrupted Optimization**: What if the player breaks a block that is currently being processed for consolidation in the Worker? (The main thread must ensure the final state matches the most recent user action).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST track the number of "dirty" (un-optimized) blocks in each chunk.
- **FR-002**: System MUST implement a "Debounce" timer that triggers consolidation after a period of inactivity (e.g., 2 seconds).
- **FR-003**: System MUST trigger consolidation immediately if the number of dirty blocks exceeds a threshold (e.g., 50 blocks).
- **FR-004**: System MUST perform consolidation logic in a Web Worker (`WorldWorker.js`) using the full chunk snapshot.
- **FR-005**: System MUST calculate Face Culling and Ambient Occlusion for player-placed blocks during consolidation.
- **FR-006**: System MUST replace standalone meshes with `InstancedMesh` instances seamlessly.
- **FR-007**: System MUST maintain 100% accuracy of `blockData` to ensure the Worker always has the ground truth.
- **FR-008**: System MUST prevent visual flickering by ensuring the new optimized meshes are ready before removing old ones (or within the same frame).

### Key Entities

- **Chunk Dirty State**: Metadata tracking the count of un-optimized blocks and the pending consolidation timer.
- **Consolidation Package**: The data structure sent to the Worker containing the full chunk state (Snapshot).
- **Optimized Render Data**: The buffer/mapping data returned by the Worker to rebuild `InstancedMesh` attributes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Draw Calls for a heavily modified chunk (100+ blocks changed) MUST return to within 110% of the initial generation's Draw Call count after optimization.
- **SC-002**: FPS MUST NOT drop by more than 10% during the frame where optimized meshes are swapped in.
- **SC-003**: Consolidation MUST trigger within 1 second of the last block interaction.
- **SC-004**: No visual "flicker" (black frames or missing blocks) should be visible during the mesh swap.
- **SC-005**: Memory usage growth from individual block meshes should be capped by the consolidation threshold.

## Assumptions

- **A-001**: The existing `WorldWorker.js` logic for `snapshot` processing is robust enough to handle any arbitrary block configuration provided by the main thread.
- **A-002**: Rebuilding all `InstancedMesh` for a 16x16xH chunk is fast enough to not cause significant main-thread blocking (tested against current performance).
- **A-003**: The 2-second debounce time is an acceptable trade-off between immediate memory recovery and preventing redundant Worker calls.
