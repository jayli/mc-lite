# P0 Region Generation 缺陷修复设计

## 背景
在 `gen-big-map-first` 分支的 region 级预生成架构中，代码 review 识别出 4 个影响数据正确性的 P0 缺陷。本设计描述修复方案。

## 缺陷清单与修复方案

### 1. 种子同步（严重）

**问题**：`WorldWorker.js` 的 `handleRegionGeneration` 没有调用 `setSeed(seed)`，而 chunk 级路径有。虽然 `generateChunkWithSharedState` 内部大量使用显式 `seed` 参数，但 `terrainGen.getBiome()` 等调用链最终会落到依赖 `WORLD_CONFIG.SEED` 全局状态的函数。一旦 `WorldGenerationService` 传入自定义种子，预生成结果将与运行时生成不一致。

**修复**：在 `handleRegionGeneration` 开头加入 `setSeed(seed)`，与 chunk 级路径保持一致。

**修改**：`src/workers/WorldWorker.js`，`handleRegionGeneration` 函数内第一行。

---

### 2. 缺失结构预加载（严重）

**问题**：`handleRegionGeneration` 没有 `await structuresPreload`。Worker 启动后的第一条消息如果是 `generateRegion`，结构 JSON 尚未加载完成，所有 JSON 驱动的结构会静默缺失。

**修复**：在 `handleRegionGeneration` 开头 `await structuresPreload`。

**修改**：`src/workers/WorldWorker.js`，`handleRegionGeneration` 函数内。

---

### 3. 实体数据膨胀（高危）

**问题**：`generateChunkWithSharedState` 返回的 `entities.modGunMan` 和 `entities.rovers` 是对 region 级共享数组的浅拷贝（spread）。在 8×8 region 的 64 个 chunk 生成过程中，这些数组持续累积。后生成的 chunk 会冗余保存整个 region 的所有实体，导致 IndexedDB 数据膨胀约 64 倍。

**修复方案 A（采用）**：在 `generateChunkWithSharedState` 返回前，根据当前 chunk 的边界坐标 `[cx*16, (cx+1)*16) × [cz*16, (cz+1)*16)` 对 `modGunMan` 和 `rovers` 进行过滤，每个 chunk 只保存落入自己边界内的实体。

**修改**：`src/workers/WorldWorker.js`，`generateChunkWithSharedState` 的 `return` 语句前增加过滤逻辑。

**边界规则**：使用半开区间 `min <= coord < max`，与 chunk 坐标系统一致。

---

### 4. 异步状态竞态（中等）

**问题**：`WorldGenerationService._generateRegion` 中调用 `getWorldStore().saveRegionRecord(...)` 后没有 `await` 就 `resolve(regionRecord)`。上层可能误判生成完成，而底层持久化仍在飞行中。若此时游戏崩溃或刷新，region 数据可能丢失。

**修复**：将 `saveRegionRecord` 改为 `await`，确保持久化完成后再 `resolve`。

**修改**：`src/world/WorldGenerationService.js`，`_generateRegion` 的 worker callback 内。

---

## 影响面分析

| 修改文件 | 运行时路径是否受影响 | 旧存档兼容性 |
|---------|-------------------|------------|
| `WorldWorker.js` | 否（`handleRegionGeneration` / `generateChunkWithSharedState` 仅用于预生成路径） | 兼容（RegionRecord 格式不变） |
| `WorldGenerationService.js` | 否（仅 `_generateRegion` 内部时序调整） | 兼容 |

## 验证方式

1. 重新预生成世界后，检查 `WorldStore` 中任意 region 的 chunk 实体数据，确认每个 chunk 的 `modGunMan`/`rovers` 数量合理（不再包含远超出 chunk 边界的坐标）。
2. 在 `_generateRegion` 的 `resolve` 前加日志，确认 `saveRegionRecord` Promise 已 resolved。
3. 冷启动（清空 IndexedDB 后）预生成包含 JSON 结构的区域（如 City），确认建筑正常出现。
