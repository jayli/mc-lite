# Global InstancedMesh Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将普通方块渲染从 per-chunk InstancedMesh 收敛为每种方块类型一个全局 InstancedMesh，使用 Dense Array + Swap-Remove + 延迟扩容降低 draw call 并消除渲染 owner 歧义。

**Architecture:** Chunk 继续持有 `blockData`、`blockDataArray`、`solidBlocks` 作为逻辑、物理和持久化真相源；`GlobalInstancedMeshManager` 成为普通方块唯一渲染 owner。全局 buffer 保持 `[0, count)` 连续活跃，删除只按坐标做 swap-remove，raycaster 通过 `instanceId -> coord` 反查真实方块坐标。

**Tech Stack:** Three.js `InstancedMesh`、ES Modules、现有浏览器测试、ESLint。

---

## 文件结构

- Create: `src/core/GlobalInstancedMeshManager.js`
  - 管理每个 `renderKey` 的 `TypeBuffer`
  - 维护 `coordToRef`、`chunkToCoords`、`coordToIndex`、`indexToCoord`
  - 提供 `addVisibleBlock`、`removeVisibleBlock`、`removeChunk`、`updateAO`、`getRaycastTargets`

- Modify: `src/world/World.js`
  - 构造全局 manager
  - chunk unload 时移除全局渲染实例
  - 简化 `removeBlock` 和 `removeBlocksBatch` 的渲染删除入口

- Modify: `src/world/ChunkGenerator.js`
  - `buildMeshes()` 不再为普通方块创建 per-chunk mesh
  - 将 meshData 注册到 `world.globalInstancedMeshManager`

- Modify: `src/world/Chunk.js`
  - 动态放置/删除、批量删除、补面刷新调用全局 manager
  - AO 结果写入全局 manager

- Modify: `src/world/ChunkConsolidation.js`
  - consolidation 不再清理/重建普通 per-chunk InstancedMesh
  - 应用 Worker 结果时改为同步全局可见实例集合

- Modify: `src/world/ChunkRenderUtils.js`
  - dispose 时调用全局 manager 清理该 chunk 实例，避免释放共享材质/全局几何

- Modify: `src/actors/player/PlayerInteraction.js`
  - 射线目标包含全局 mesh
  - 命中全局 mesh 后通过 `instanceId -> coord` 解析坐标，不再猜坐标或先 scale-to-zero

- Test: `src/tests/test-global-instanced-mesh-manager.js`
  - 覆盖新增、删除、swap-remove、扩容、chunk unload、重复坐标 update、AO 更新

- Modify: `src/tests/index.html`
  - 注册新测试文件

## Task 1: 全局 Dense Buffer 数据结构

- [ ] Step 1: 编写 `test-global-instanced-mesh-manager.js`，构造 mock scene/materials，验证新增两个 stone 后 `mesh.count === 2`。
- [ ] Step 2: 验证删除第一个实例会把最后一个实例移动到 index 0，且 `coordToRef`、`coordToIndex`、`indexToCoord` 互逆。
- [ ] Step 3: 验证重复 `addVisibleBlock(coord)` 不增加 count，只更新矩阵/AO。
- [ ] Step 4: 验证超过初始容量时扩容，并保持旧实例可查。
- [ ] Step 5: 实现 `GlobalInstancedMeshManager` 的最小功能。
- [ ] Step 6: 运行浏览器测试，确认新测试通过。

## Task 2: 接入 Chunk.buildMeshes 初次渲染

- [ ] Step 1: 修改 `ChunkGenerator.buildMeshes()`，优先调用 `world.globalInstancedMeshManager.addMeshDataForChunk(chunk, meshDataArray)`。
- [ ] Step 2: 保留测试/无 manager 环境的旧 per-chunk fallback。
- [ ] Step 3: 确保 `mesh.userData.globalBuffer`、`userData.type`、阴影配置和 AO attributes 正确。
- [ ] Step 4: 运行 chunk 相关测试。

## Task 3: 删除和动态更新从 scale-to-zero 改为坐标删除

- [ ] Step 1: 在 `Chunk._removeInstancedMeshBlock()` 中优先调用 `globalInstancedMeshManager.removeVisibleBlock(code)`。
- [ ] Step 2: 在 `removeBlocksBatch()` 和 `removeBlocksBatchRenderOnly()` 中批量调用全局删除。
- [ ] Step 3: 在 `_refreshBlockRenderMesh()` 和 `addBlockDynamic()` 中通过全局 manager 添加可见实例，减少临时 Mesh。
- [ ] Step 4: 保留旧动态 Mesh fallback，用于测试和未启用全局 manager 场景。

## Task 4: Raycaster 命中全局实例

- [ ] Step 1: `getInteractionTargets()` 增加 `world.globalInstancedMeshManager.getRaycastTargets()`。
- [ ] Step 2: `_resolveBlockHitFromRaycast()` 对全局 mesh 使用 `resolveHit(hit)`。
- [ ] Step 3: `removeBlock()` 对全局 mesh 直接取坐标并调用 `world.removeBlock(x,y,z)`，不再先 scale-to-zero。
- [ ] Step 4: 保留特殊实体 InstancedMesh 逻辑不变。

## Task 5: Consolidation 和 AO 改为 patch

- [ ] Step 1: `_applyConsolidateResult()` 在过滤 Worker 结果后调用 `replaceChunkVisibleBlocks(chunkKey, meshData)`。
- [ ] Step 2: `_cleanupOldMeshes()` 不再删除全局普通方块实例，只清理动态 mesh 和遗留 per-chunk mesh。
- [ ] Step 3: `_applyAOResults()` 对全局 manager 调用 `updateAO(code, aoLow, aoHigh)`。
- [ ] Step 4: Worker 回包应用前继续校验 `blockData` 存在且类型一致，避免删除后复现。

## Task 6: Chunk unload 与 owner 收敛

- [ ] Step 1: `Chunk.dispose()` 调用 `globalInstancedMeshManager.removeChunk(chunkKey)`。
- [ ] Step 2: `World.removeBlock()` 第一阶段仍用 `getAllBlockOwners()` 诊断重复 owner，但渲染删除只交给全局 manager。
- [ ] Step 3: 稳定后再将 `resolveBlockOwner()` 默认改为只查坐标 chunk，全量扫描降级为诊断。

## Task 7: 验证

- [ ] Step 1: 运行 `npm run lint`。
- [ ] Step 2: 启动 `npm run start`。
- [ ] Step 3: 用 Playwright 打开 `http://127.0.0.1:8080/src/tests/index.html` 点击运行所有测试。
- [ ] Step 4: 人工验证：加载世界、挖方块、连续放置、TNT/Mag7 批量删除、跨 chunk 结构边界、移动触发 chunk unload/load。

## 风险与边界

- 全局 mesh 会削弱 chunk 级 frustum culling；当前 renderDistance 2-3，第一版收益预计大于风险。
- 第一版 `renderKey = blockType`，不做跨类型材质合批；跨类型合批必须等全局索引层稳定后再做。
- `indexToCoord` 使用普通 `Array<number>` 或 `Float64Array`，不能用 `Uint32Array`，因为 `encodeCoord()` 超过 32 位。
- 活跃实例必须始终连续，禁止 freeList，禁止 scale-to-zero 作为删除语义。
