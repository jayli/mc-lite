# Runtime Memory WorldStore Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将运行期权威数据源从 `IndexedDB` 切换为常驻内存的 `MemoryWorldStore`，并同步拆细 chunk 主线程装配与 global mesh patch，消除 chunk streaming 期间的读路径排队、后台 flush 竞争和 8~12ms 级主线程长任务。

**Architecture:** 运行期采用“`MemoryWorldStore` 世界级权威层 + `Chunk Working Set` 热数据层”双层模型。旧存档只在启动时一次性导入内存，新世界生成结果直接写入内存权威层；运行期间所有方块修改先改 `chunk.blockData`，再立即同步到 `MemoryWorldStore`，完全切断 `IndexedDB` 对 chunk streaming 的参与。装配链路改成细粒度 stage，运行期 patch 改成增量 delta。

**Tech Stack:** JavaScript, Three.js, Web Workers, IndexedDB, 浏览器内测试页面, ESLint

---

## 文件结构与职责

### 新增文件

- `src/world/MemoryWorldStore.js`
  - 运行期世界级权威内存存储
  - 管理 `region/chunkRecord`、dirty/version/stats
- `src/tests/test-memory-world-store.js`
  - `MemoryWorldStore` 单元测试

### 重点修改文件

- `src/world/World.js`
  - 世界启动流程接入内存权威层
  - chunk record 请求改为内存读路径
- `src/world/WorldRuntime.js`
  - 从“写回协调器”转为“内存工作集协调器”
  - 旁路 unload/background flush 主链路
- `src/world/WorldStore.js`
  - 降级为导入/导出工具，而不是运行期权威接口
- `src/world/Chunk.js`
  - block mutation 立即同步 `MemoryWorldStore`
  - `loadFromRecord` 拆分为更细粒度的运行期装配阶段
- `src/world/ChunkAssemblyScheduler.js`
  - 扩展更细粒度 stage
- `src/core/GlobalInstancedMeshManager.js`
  - 增加 chunk delta patch 接口，区分首次加载和运行期增量 patch
- `src/tests/test-world-runtime.js`
  - 更新运行时缓存与 flush 语义测试
- `src/tests/test-world.js`
  - 更新世界启动/加载路径测试
- `src/tests/test-chunk.js`
  - 更新 block mutation 同步权威层测试
- `src/tests/test-global-instanced-mesh-manager.js`
  - 增加增量 patch 测试

### 参考文件

- `src/world/World.js`
- `src/world/WorldRuntime.js`
- `src/world/Chunk.js`
- `src/world/WorldStore.js`
- `src/services/PersistenceService.js`
- `src/workers/PersistenceWorker.js`

---

### Task 1: 建立 `MemoryWorldStore` 权威内存层

**Files:**
- Create: `src/world/MemoryWorldStore.js`
- Test: `src/tests/test-memory-world-store.js`

- [ ] **Step 1: 写一个失败的测试，定义 `MemoryWorldStore` 的最小接口**

在 `src/tests/test-memory-world-store.js` 新增测试，至少覆盖：

- `createOrReplaceChunkRecord(cx, cz, record)` 可写入 chunk
- `getChunkRecord(cx, cz)` 可读回 chunk
- `applyBlockMutation(cx, cz, coord, entry)` 可立即更新权威 `blockData`
- `getStats()` 返回 region/chunk 计数

示例断言：

```js
test('applyBlockMutation 应立即更新 chunkRecord.blockData', () => {
  const store = new MemoryWorldStore();
  store.createOrReplaceChunkRecord(1, 2, { blockData: {}, staticEntities: [], runtimeSeedData: {}, runtimeEntities: {} });
  store.applyBlockMutation(1, 2, 123, 'stone');
  const record = store.getChunkRecord(1, 2);
  assertEqual(record.blockData[123], 'stone');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: 打开 `http://localhost:8080/src/tests/index.html`，运行新增测试  
Expected: `MemoryWorldStore` 未定义或接口缺失导致失败

- [ ] **Step 3: 实现 `MemoryWorldStore` 最小版本**

在 `src/world/MemoryWorldStore.js` 实现：

- region/chunk 双索引
- `chunkKey` / `regionKey` 工具方法
- `createOrReplaceChunkRecord`
- `getChunkRecord`
- `applyBlockMutation`
- `getStats`

先沿用对象版 `blockData`，不要第一步就做 TypedArray 压缩。

- [ ] **Step 4: 让测试通过**

Run: 打开测试页，运行新增测试  
Expected: 新增 `MemoryWorldStore` 测试通过

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`  
Expected: 无新增 lint 错误

- [ ] **Step 6: 提交这一小步改动**

```bash
git add src/world/MemoryWorldStore.js src/tests/test-memory-world-store.js
git commit -m "feat: add runtime memory world store"
```

---

### Task 2: 世界启动时接入全量内存导入与生成直写

**Files:**
- Modify: `src/world/World.js`
- Modify: `src/world/WorldStore.js`
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，定义“运行期 chunk record 从内存获取”**

为 `World` / `WorldRuntime` 增加测试，验证：

- `World` 启动后持有 `memoryWorldStore`
- `_requestRuntimeChunkRecord()` 优先从内存权威层读取
- 不再调用 `WorldStore.getChunkRecord()` 作为运行期主路径

示例断言：

```js
assertEqual(memoryStoreCalls.getChunkRecord.length, 1);
assertEqual(worldStoreCalls.getChunkRecord.length, 0);
```

- [ ] **Step 2: 写失败测试，定义“新世界生成结果直接写入内存权威层”**

为生成链路增加测试，验证：

- 世界生成后的 chunkRecord 直接进入 `MemoryWorldStore`
- 不触发 `PersistenceService.saveRegionRecord/saveChunkData`

- [ ] **Step 3: 在 `World` 中注入 `MemoryWorldStore`**

在 `src/world/World.js`：

- 构造阶段创建 `this.memoryWorldStore`
- 启动流程中增加“旧存档全量导入内存”入口
- 新世界生成完成后直接写入 `MemoryWorldStore`

- [ ] **Step 4: 让 `WorldRuntime.ensureChunkData()` 改从内存读**

在 `src/world/WorldRuntime.js`：

- 新增对 `memoryWorldStore.getChunkRecord()` 的使用
- `ensureChunkData()` 返回 `{ status: 'ready', chunkRecord }`
- 不再把运行期读取落到 `WorldStore.getChunkRecord()`

- [ ] **Step 5: 将 `WorldStore` 降级为导入/导出工具**

在 `src/world/WorldStore.js`：

- 保留旧的 `getRegionRecord/saveRegionRecord/...` 供导入导出用
- 明确注释：运行期主链路不应直接用它取 chunk record

- [ ] **Step 6: 补一个运行期性能打点名字迁移**

把 `world.runtime-chunk-record-db` 改成新的内存读路径打点，例如：

```js
recordChunkPerf('world.runtime-chunk-record-memory', ...);
```

并确保不再出现 `-db` 命名。

- [ ] **Step 7: 跑测试确认通过**

Run: 打开测试页，运行 `test-world.js`、`test-world-runtime.js`  
Expected: 启动/读取相关测试通过

- [ ] **Step 8: 运行 lint**

Run: `npm run lint`  
Expected: 无新增 lint 错误

- [ ] **Step 9: 提交这一小步改动**

```bash
git add src/world/World.js src/world/WorldStore.js src/world/WorldRuntime.js src/tests/test-world.js src/tests/test-world-runtime.js
git commit -m "refactor: load runtime chunk records from memory world store"
```

---

### Task 3: 方块修改立即同步到内存权威层

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-chunk.js`

- [ ] **Step 1: 写失败测试，定义 block mutation 的立即同步语义**

在 `src/tests/test-chunk.js` 增加测试，覆盖：

- `addBlockDynamic()` 修改后，`MemoryWorldStore` 中对应 `blockData` 同步更新
- `removeBlockDynamic()` 删除后，权威层对应 entry 被删除
- 批量删除路径也会同步到权威层

- [ ] **Step 2: 在 `Chunk` 中接入 `MemoryWorldStore.applyBlockMutation`**

在 `src/world/Chunk.js` 的动态增删改路径中：

- 先改 `chunk.blockData`
- 同一调用栈内同步调用 `memoryWorldStore.applyBlockMutation(...)`
- 不再依赖 unload flush 才成为真相

- [ ] **Step 3: 清理 `WorldRuntime` 的“运行期正确性依赖 flush”语义**

在 `src/world/WorldRuntime.js` 中：

- 保留 `dirty/version` 仅用于未来手动保存
- 去掉“必须 flush 才有权威正确性”的假设

- [ ] **Step 4: 测试验证通过**

Run: 打开测试页，运行 `test-chunk.js`  
Expected: 新增 block mutation 权威同步测试通过

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`  
Expected: 无新增 lint 错误

- [ ] **Step 6: 提交这一小步改动**

```bash
git add src/world/Chunk.js src/world/WorldRuntime.js src/tests/test-chunk.js
git commit -m "refactor: sync chunk mutations to memory authority immediately"
```

---

### Task 4: 旁路 unload/background flush 运行期主链路

**Files:**
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world-runtime.js`

- [ ] **Step 1: 写失败测试，定义“chunk 卸载只释放渲染资源，不再承担保存正确性”**

新增测试覆盖：

- chunk unload 后不再进入 `pendingUnloadFlushQueue`
- 运行时不再记录 `world-runtime.background-flush`
- 卸载后重载仍从 `MemoryWorldStore` 恢复数据

- [ ] **Step 2: 旁路 `pendingUnloadFlushQueue` 与 flush 入口**

在 `src/world/WorldRuntime.js`：

- 让 `flushBeforeUnload`
- `flushChunk`
- `flushAllDirty`
- `flushPendingUnloadQueueWithinBudget`

退出运行期主链路，最简单可先改成：

- 不再被 `World.update()` 驱动
- 仅保留兼容壳或显式注释弃用

- [ ] **Step 3: 清理 `World` 中 idle task 对 unload flush 的调度**

在 `src/world/World.js`：

- 移除 `unload-flush-queue` idle task 的运行期调度
- 保留未来手动保存所需的扩展位，但不在当前 session 自动执行

- [ ] **Step 4: 验证测试通过**

Run: 打开测试页，运行 `test-world-runtime.js`  
Expected: 卸载/重载相关测试通过

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`  
Expected: 无新增 lint 错误

- [ ] **Step 6: 提交这一小步改动**

```bash
git add src/world/WorldRuntime.js src/world/World.js src/tests/test-world-runtime.js
git commit -m "refactor: bypass runtime unload flush path"
```

---

### Task 5: 拆细 chunk 主线程装配 stage

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/ChunkAssemblyScheduler.js`
- Test: `src/tests/test-chunk.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，定义新的装配阶段流转**

测试至少验证：

- `loadFromMemoryRecord()` 只负责接收 record 和 enqueue
- scheduler 会按顺序跑：
  - `hydrate`
  - `rebuild-indices`
  - `collect-blocks`
  - `convert-mesh`
  - `prepare-visible`
  - `enqueue-mesh`
  - `finalize-minimal`

- [ ] **Step 2: 为 `Chunk` 拆出阶段函数**

在 `src/world/Chunk.js` 中新增小函数，例如：

- `assembleHydratePhase()`
- `assembleRebuildIndicesPhase()`
- `assembleCollectBlocksPhase()`
- `assembleConvertMeshPhase()`
- `assemblePrepareVisiblePhase()`
- `assembleEnqueueMeshPhase()`
- `finalizeMinimalPhase()`

要求：

- 每个函数责任单一
- 不在一个函数里混入多个重活

- [ ] **Step 3: 扩展 `ChunkAssemblyScheduler` 的 stage 状态机**

在 `src/world/ChunkAssemblyScheduler.js`：

- 添加上述新 stage
- 每个 stage 完成后 enqueue 下一个 stage
- 保留现有 `terrain/entities/finalize` 旧路径的兼容逻辑，避免引爆非运行期路径

- [ ] **Step 4: 让运行期路径改用新的 stage**

在 `src/world/Chunk.js` / `src/world/World.js`：

- `loadFromMemoryRecord()` 入队新 stage
- 旧 `runtime-build` 不再承载全部运行期装配工作

- [ ] **Step 5: 测试验证通过**

Run: 打开测试页，运行 `test-chunk.js`、`test-world.js`  
Expected: 新阶段流转测试通过，旧行为不回归

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`  
Expected: 无新增 lint 错误

- [ ] **Step 7: 提交这一小步改动**

```bash
git add src/world/Chunk.js src/world/ChunkAssemblyScheduler.js src/tests/test-chunk.js src/tests/test-world.js
git commit -m "perf: split runtime chunk assembly into fine-grained stages"
```

---

### Task 6: 将 global mesh patch 改为 chunk delta

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/core/GlobalInstancedMeshManager.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-global-instanced-mesh-manager.js`

- [ ] **Step 1: 写失败测试，定义增量 patch 行为**

新增测试覆盖：

- 首次 chunk 加载仍走 `replaceChunkVisibleBlocks`
- 运行期修改走 `applyChunkDelta`
- 增量 patch 只处理新增/删除/更新坐标，不扫描全量 chunk 可见集

- [ ] **Step 2: 在 `Chunk` 中维护 render delta**

在 `src/world/Chunk.js` 中为运行期修改路径维护：

- `addedCoords`
- `removedCoords`
- `updatedCoords`

并在适当时机归并/清空这些集合。

- [ ] **Step 3: 在 `GlobalInstancedMeshManager` 中新增 `applyChunkDelta`**

在 `src/core/GlobalInstancedMeshManager.js` 实现：

- 只消费 delta
- 分别处理 add/update/remove
- 避免再以 `instanceIndexMap` 为核心做全量比较

- [ ] **Step 4: 在 `World` 更新循环中接入 delta patch 预算**

在 `src/world/World.js`：

- 让运行期 chunk 修改优先走 delta patch
- 为 delta patch 也设定单帧预算

- [ ] **Step 5: 测试验证通过**

Run: 打开测试页，运行 `test-global-instanced-mesh-manager.js`  
Expected: 增量 patch 测试通过

- [ ] **Step 6: 运行 lint**

Run: `npm run lint`  
Expected: 无新增 lint 错误

- [ ] **Step 7: 提交这一小步改动**

```bash
git add src/world/Chunk.js src/core/GlobalInstancedMeshManager.js src/world/World.js src/tests/test-global-instanced-mesh-manager.js
git commit -m "perf: switch runtime mesh updates to chunk deltas"
```

---

### Task 7: 补运行期观测指标并做回归验证

**Files:**
- Modify: `src/utils/ChunkPerfMonitor.js`
- Modify: `src/world/World.js`
- Modify: `src/world/WorldRuntime.js`
- Test: `src/tests/test-chunk-perf-monitor.js`

- [ ] **Step 1: 写失败测试，定义新的关键打点名称**

至少覆盖：

- `world.runtime-chunk-record-memory`
- `memory-worldstore.hit/miss`
- `global-instanced-mesh.delta-patch`

- [ ] **Step 2: 为内存权威层和 delta patch 加打点**

在相关模块中增加新 perf label，便于区分：

- 内存读是否命中
- stage 是否仍超预算
- delta patch 是否仍有峰值

- [ ] **Step 3: 更新或新增 perf monitor 测试**

确保新 label 不会破坏既有报告逻辑。

- [ ] **Step 4: 运行浏览器内回归测试**

Run:
- 打开 `http://localhost:8080/src/tests/index.html`
- 点击“运行所有测试”

Expected:
- 所有自动测试通过

- [ ] **Step 5: 运行 lint**

Run: `npm run lint`  
Expected: 无新增 lint 错误

- [ ] **Step 6: 做一次手工性能验证**

手工验证项：

- 进入世界后跑图一段时间
- 控制台确认不再出现 `world.runtime-chunk-record-db`
- 控制台确认不再出现 `world-runtime.background-flush`
- 观察 `chunk-assembly.task` 是否明显减少 8ms+ 尖峰
- 观察 `global-instanced-mesh.patch-chunk` 是否被新的 delta patch 指标替代

- [ ] **Step 7: 提交这一小步改动**

```bash
git add src/utils/ChunkPerfMonitor.js src/world/World.js src/world/WorldRuntime.js src/tests/test-chunk-perf-monitor.js
git commit -m "chore: add runtime memory authority perf metrics"
```

---

## 执行注意事项

- 先不要实现手动保存
- 先不要引入新的压缩格式
- 先让主链路正确、稳定、可观测
- 如果某步发现世界规模导致内存占用超预期，先补统计，不要提前做激进压缩重构
- 每完成一个 Task，都重新跑对应测试与 `npm run lint`

## 最终验收标准

- 运行期 chunk streaming 不再回源 `IndexedDB`
- chunk 卸载不再触发后台保存竞争
- 方块修改会立即同步到内存权威层
- chunk 装配阶段被拆细，单个 stage 峰值显著下降
- 运行期 mesh 更新改为增量 delta
- 浏览器内测试通过，lint 通过
