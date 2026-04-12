# Implementation Plan: 跨 Chunk 材质合批

**Branch**: `001-cross-chunk-batching` | **Date**: 2026-04-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-cross-chunk-batching/spec.md`

## Summary

将视野内多个 Chunk 中相同纹理的方块合并到共享的 InstancedMesh 中，减少 draw call。新建 `ChunkBatchManager` 作为 World 和 Chunk 之间的合批层，利用已有的 `MaterialManager.getBatchedMaterial()` 和纹理分组机制，将每个纹理的渲染从 "每 Chunk 一次 draw call" 优化为 "全局一次 draw call"。

## Technical Context

**Language/Version**: JavaScript (ES2022+), Three.js
**Primary Dependencies**: Three.js (InstancedMesh, Scene), 现有 MaterialManager
**Storage**: N/A（纯渲染层优化）
**Testing**: 浏览器端手动测试 + 控制台验证命令
**Target Platform**: 现代浏览器，WebGL 2.0
**Project Type**: 纯客户端 3D 游戏
**Performance Goals**: draw call 减少 60%+，合批管理单帧开销 < 2ms
**Constraints**: 不改变 Worker 通信协议，不改变 Chunk 数据结构，兼容现有方块操作
**Scale/Scope**: 视距 3 时约 49 个 Chunk，5-15 种纹理/Chunk

## Constitution Check

| 原则 | 状态 | 说明 |
|------|------|------|
| I. 面向对象与逻辑分层 | PASS | 新建 ChunkBatchManager 独立类，位于渲染层，与 Chunk/World 解耦 |
| II. 内存效率与 GC | PASS | 预分配 InstancedMesh 容量避免频繁扩容，TypedArray 批量写入避免帧级临时对象 |
| III. 主动资源释放 | PASS | unregisterChunk() 释放 Slot 和矩阵数据，Chunk 卸载时完整清理 |
| IV. WebGL/Three.js 性能优化 | PASS | 核心 draw call 优化，与项目目标一致 |
| V. 简洁性与核心机制 | PASS | 仅修改渲染路径，不影响游戏玩法逻辑 |
| VI. 资源管理与学习参考 | N/A | 不涉及外部资源 |

## Project Structure

### Documentation (this feature)

```text
specs/001-cross-chunk-batching/
├── plan.md              # 本文件
├── research.md          # 技术研究
├── data-model.md        # 数据模型
├── quickstart.md        # 验证指南
└── tasks.md             # 任务列表 (/speckit.tasks 生成)
```

### Source Code (repository root)

```text
src/
├── core/
│   └── ChunkBatchManager.js    # 新增：跨 Chunk 合批管理器
├── world/
│   ├── Chunk.js                # 修改：buildMeshes 输出数据而非 InstancedMesh
│   ├── World.js                # 修改：创建/持有 ChunkBatchManager
│   ├── ChunkGenerator.js       # 修改：生成实例矩阵数据供合批使用
│   └── ChunkConsolidation.js   # 修改：consolidation 后更新合批
└── core/
    └── Engine.js               # 修改：渲染循环中触发合批 flush（如需要）
```

**Structure Decision**: 在现有目录结构中新增 `ChunkBatchManager.js`，修改 `Chunk.js`/`World.js`/`ChunkGenerator.js`/`ChunkConsolidation.js` 的渲染路径。

## Implementation Phases

### Phase 1: ChunkBatchManager 核心

**新增文件**: `src/core/ChunkBatchManager.js`

核心职责：
1. 按纹理 URL 管理 `TextureBatchGroup`，每个组一个共享 `InstancedMesh`
2. 提供 `registerChunk(chunkKey, instancesByTexture)` — 注册区块实例数据
3. 提供 `unregisterChunk(chunkKey)` — 注销并释放资源
4. 提供 `updateChunk(chunkKey, instancesByTexture)` — 增量更新
5. 提供 `getStats()` — 返回验证统计数据
6. 管理 InstancedMesh 到 Scene 的添加/移除

关键设计：
- 每个 Chunk 注册时，在各 TextureBatchGroup 中分配 Slot（连续区间）
- 矩阵写入使用 `instancedMesh.instanceMatrix.array.set(matrices, offset)`
- 容量不足时 ×2 倍增，最大 65536 实例
- InstancedMesh 的 `count` 属性设为实际使用数（非容量）

### Phase 2: Chunk 渲染路径改造

**修改文件**: `src/world/Chunk.js`, `src/world/ChunkGenerator.js`

改造思路：
1. `Chunk.buildMeshes()` 不再创建 `InstancedMesh`，改为产出 `instancesByTexture` 数据结构
2. `instancesByTexture` 结构：`Map<textureUrl, { matrices: Float32Array, count: number }>`
3. 调用 `world.batchManager.registerChunk(chunkKey, instancesByTexture)` 注册
4. 保留 `chunk.group` 用于特殊实体渲染（树、矿车等）
5. `chunk.dispose()` 中调用 `world.batchManager.unregisterChunk(chunkKey)`

### Phase 3: 动态更新集成

**修改文件**: `src/world/ChunkConsolidation.js`, `src/world/World.js`

1. Consolidation 完成后，用新的实例数据调用 `batchManager.updateChunk()`
2. `World.updateChunks()` 中：
   - 创建 Chunk 后立即注册到 BatchManager
   - 卸载 Chunk 时从 BatchManager 注销
3. 方块变更（setBlock）触发局部重建后更新 BatchManager

### Phase 4: 验证命令与开关

**修改文件**: `src/core/ChunkBatchManager.js` (验证方法), `src/ui/UIManager.js` (可选开关)

1. `window.game.batchManager.getStats()` 返回：
   - 总 draw call 数
   - 各纹理组的区块合并数、实例总数
   - 与优化前的对比估算
2. `window.game.batchManager.enabled` 开关，设为 false 时回退到逐 Chunk 渲染
3. HUD 中可选显示当前 draw call 数

## Complexity Tracking

无需记录 — 所有 Constitution 原则均通过，无违规。
