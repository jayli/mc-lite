# Runtime Chunk Streaming Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持运行期远端 chunk 的 terrain 和实体一起出现的前提下，移除纯新 chunk 的二次 AO/Consolidation/持久化/光源恢复尖峰，稳定奔跑时帧率。

**Architecture:** 为 runtime-streaming 新 chunk 增加“纯新流式加载”分流状态，禁止它们在 finalize 后继续进入 AO repair 和首次 consolidation；同时把光源注册、持久化 flush、运行时实体恢复后置到独立低优先级队列。运行期 chunk 主装配改成单个 `runtime-build` 阶段，terrain 与静态实体渲染一起完成，但附属系统退出关键路径。

**Tech Stack:** Three.js、原生 ES Modules、Web Workers、InstancedMesh、现有 Chunk/World 调度器

---

### Task 1: 补充运行期流式加载分流状态

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`

- [ ] 为 `Chunk` 增加流式加载来源和变更标记字段
- [ ] 在 `World.update()` 创建新 chunk 时标注 `bootstrap` 或 `runtime-streaming`
- [ ] 在玩家修改方块链路中把 chunk 标记为 `hasPlayerMutations = true`

### Task 2: 合并 runtime-streaming 的 terrain+entities 装配

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/ChunkAssemblyScheduler.js`
- Modify: `src/world/World.js`

- [ ] 为 runtime 新 chunk 增加 `runtime-build` stage
- [ ] 保持 terrain 和静态实体渲染在同一阶段完成
- [ ] bootstrap 仍然沿用现有 `terrain -> entities -> finalize`

### Task 3: 移除纯新 runtime chunk 的二次 AO 和首次 consolidation

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`

- [ ] `onChunkFinalized()` 不再给纯新 runtime chunk 入 AO 队列
- [ ] `finalizeAssemblyPhase()` 对纯新 runtime chunk 跳过 `waiting-consolidation`
- [ ] 仅保留玩家修改后或 consolidation 回包后的 AO rebuild

### Task 4: 后置 light/persistence/runtime entity 恢复

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`

- [ ] 把光源注册从 finalize 中挪到低优先级队列
- [ ] 把 `_pendingPersistenceFlush` 从 finalize 中挪到低优先级队列
- [ ] 把 minecart/turret/zombieNest 恢复从 finalize 中挪到低优先级队列

### Task 5: 回归测试与校验

**Files:**
- Modify: `src/tests/test-world.js`

- [ ] 增加 runtime 新 chunk 不应 enqueue runtime-finalize AO 的测试
- [ ] 增加 runtime 新 chunk finalize 时应跳过首次 consolidation 的测试
- [ ] 运行 `npm run lint`
