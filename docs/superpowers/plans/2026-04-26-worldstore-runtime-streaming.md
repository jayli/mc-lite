# WorldStore Runtime Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将主世界改造成“进入前阻塞预生成、运行期只读权威世界数据、玩家交互统一命中 runtime blockData、接近边界时后台扩图并启用硬边界”的新流式架构。

**Architecture:** 第一版采用双层重构路线：新增 `WorldStore + WorldRuntime + WorldAccessLayer + WorldGenerationService`，保留现有 `Chunk` 作为运行时视图容器。世界生成和 chunk 装载彻底分离；玩家交互通过统一访问层收口；权威世界存储在 IndexedDB，活动 chunk 以内存 `blockData` 提供实时交互与渲染输入。

**Tech Stack:** Vanilla JS、Three.js、IndexedDB（通过现有 Persistence Worker 扩展）、ES Modules、浏览器测试页 `src/tests/index.html`、ESLint。

---

## 文件结构

- Create: `src/world/WorldStore.js`
  - WorldMeta / RegionRecord / ChunkRecord 的权威读写接口
- Create: `src/world/WorldRuntime.js`
  - region 缓存、runtime chunk 视图生命周期、脏写回队列
- Create: `src/world/WorldAccessLayer.js`
  - 统一的查询、编辑、碰撞、边界检查入口
- Create: `src/world/WorldGenerationService.js`
  - 新档预生成与后台扩图
- Create: `src/world/RegionCache.js`
  - 活动 region 缓存
- Create: `src/world/WorldBoundsController.js`
  - safeBounds/expandTargetBounds/硬边界判定
- Modify: `src/services/PersistenceService.js`
  - 从 chunk 快照服务升级为 WorldStore 底层适配
- Modify: `src/workers/PersistenceWorker.js`
  - 新增 world meta / region 读写动作
- Modify: `src/workers/WorldWorker.js`
  - 支持 `generate-region` 与 `build-chunk-mesh`
- Modify: `src/world/Chunk.js`
  - 收缩为 runtime chunk 视图容器
- Modify: `src/world/World.js`
  - 接入 WorldRuntime / WorldAccessLayer / WorldGenerationService
- Modify: `src/world/ChunkGenerator.js`
  - 抽出可复用的世界生成算法，移除 runtime 默认入口职责
- Modify: `src/actors/player/Physics.js`
  - 改走 WorldAccessLayer 查询碰撞/实心块
- Modify: `src/actors/player/PlayerInteraction.js`
  - 改走 WorldAccessLayer 查询与编辑
- Modify: `src/tests/test-world.js`
- Modify: `src/tests/test-persistence-service.js`
- Modify: `src/tests/test-player-interaction.js`
- Modify: `src/tests/test-physics.js`
- Modify: `src/tests/test-world-worker.js`

## Task 1: 固化新的世界数据模型与持久化接口

**Files:**
- Create: `src/world/WorldStore.js`
- Modify: `src/services/PersistenceService.js`
- Modify: `src/workers/PersistenceWorker.js`
- Test: `src/tests/test-persistence-service.js`

- [ ] **Step 1: 写失败测试，固定 WorldMeta / RegionRecord 基本读写**

在 `src/tests/test-persistence-service.js` 增加测试，覆盖：
- 新建 world meta
- 保存并读取 region record
- 通过 chunk 坐标投影读取 chunk record

- [ ] **Step 2: 运行测试，确认新接口尚未实现**

Run:
```bash
npm run start
```

打开：
```text
http://127.0.0.1:8080/src/tests/index.html
```

Expected:
- 新增持久化测试失败
- 失败原因指向 `getWorldMeta/getRegionRecord/getChunkRecord` 缺失

- [ ] **Step 3: 在 PersistenceWorker 中新增 world meta / region 动作**

实现：
- `getWorldMeta`
- `saveWorldMeta`
- `getRegionRecord`
- `saveRegionRecord`

- [ ] **Step 4: 在 PersistenceService 中提供对应接口**

新增方法：
- `getWorldMeta()`
- `saveWorldMeta(meta)`
- `getRegionRecord(rx, rz)`
- `saveRegionRecord(record)`

- [ ] **Step 5: 新建 WorldStore 封装权威数据访问**

在 `src/world/WorldStore.js` 中实现：
- world meta 读写
- region 读写
- `getChunkRecord(cx, cz)`

- [ ] **Step 6: 重跑浏览器测试**

Expected:
- `test-persistence-service.js` 新增测试通过

## Task 2: 实现 RegionCache 与 WorldRuntime 最小工作集

**Files:**
- Create: `src/world/RegionCache.js`
- Create: `src/world/WorldRuntime.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 region 缓存与 chunk 投影行为**

在 `src/tests/test-world.js` 增加测试：
- 已存在 region 时，加载 chunk 不触发再次读盘
- region 未命中时，从 WorldStore 读取后缓存
- 可根据 chunk 坐标返回 runtime chunk 数据

- [ ] **Step 2: 运行测试，确认失败**

Expected:
- WorldRuntime / RegionCache 尚不存在

- [ ] **Step 3: 实现 RegionCache**

提供：
- `get(regionKey)`
- `set(regionKey, record)`
- `has(regionKey)`
- 简单 LRU 或容量淘汰

- [ ] **Step 4: 实现 WorldRuntime 最小装载逻辑**

提供：
- `ensureChunkData(cx, cz)`
- `getLoadedChunk(cx, cz)`
- `markChunkDirty(cx, cz)`
- `flushDirtyChunk(cx, cz)`

- [ ] **Step 5: 在 World 中接入 WorldRuntime 初始化**

要求：
- 不破坏现有 world 构造流程
- 先只让 World 持有 runtime，但暂不替换全部装载调用

- [ ] **Step 6: 重跑浏览器测试**

Expected:
- region cache / runtime 数据读取测试通过

## Task 3: 实现 WorldAccessLayer 并收口基础查询接口

**Files:**
- Create: `src/world/WorldAccessLayer.js`
- Modify: `src/world/World.js`
- Modify: `src/actors/player/Physics.js`
- Test: `src/tests/test-physics.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 getBlock / isSolid 经由统一入口**

在测试中覆盖：
- 已加载 chunk 上 `isSolid` 命中 runtime `blockData`
- `getBlock` 返回与当前 runtime 状态一致
- World/Physics 不再要求直接读取 chunk 内部结构

- [ ] **Step 2: 运行测试，确认失败**

Expected:
- 现有 Physics / World 查询仍耦合旧 chunk 结构

- [ ] **Step 3: 实现 WorldAccessLayer 的只读接口**

实现：
- `getBlock(x, y, z)`
- `isSolid(x, y, z)`
- `getCollisionAt(x, y, z)`

- [ ] **Step 4: 修改 World 暴露并转发统一查询接口**

保留现有方法名兼容上层，但内部改调 `WorldAccessLayer`

- [ ] **Step 5: 修改 Physics 走 WorldAccessLayer**

确保碰撞与实心块查询统一收口

- [ ] **Step 6: 重跑测试**

Expected:
- `test-physics.js` / `test-world.js` 新增查询路径测试通过

## Task 4: 实现 WorldGenerationService 与初始阻塞预生成

**Files:**
- Create: `src/world/WorldGenerationService.js`
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/world/ChunkGenerator.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-world-worker.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 generate-region 输出 RegionRecord**

在 `src/tests/test-world-worker.js` 覆盖：
- worker 接收 `generate-region`
- 返回 region 级 chunk 数据
- 跨 chunk 方块按最终 owner 落到对应 chunk

- [ ] **Step 2: 运行测试，确认失败**

Expected:
- 现有 worker 只支持按 chunk 生成

- [ ] **Step 3: 在 WorldWorker 中增加 generate-region 模式**

要求：
- 复用现有地形/结构算法
- 先写 region 级 buffer
- 再按坐标归属切 chunk

- [ ] **Step 4: 实现 WorldGenerationService.generateInitialWorld()**

流程：
- 初始化 world meta
- 调度多个 region 生成
- 写入 WorldStore
- 更新 `generatedBounds/safeBounds`

- [ ] **Step 5: 在 World 启动链路中接入阻塞预生成**

要求：
- 新档进入主世界前先完成初始世界生成
- 完成后才进入 runtime chunk 装载

- [ ] **Step 6: 重跑测试**

Expected:
- 初始预生成测试通过
- region 级生成输出结构正确

## Task 5: 把 runtime chunk 装载从 gen() 切到 WorldStore

**Files:**
- Modify: `src/world/Chunk.js`
- Modify: `src/world/World.js`
- Modify: `src/workers/WorldWorker.js`
- Modify: `src/world/ChunkGenerator.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 runtime 装载不再触发地形生成**

测试覆盖：
- 创建新 runtime chunk 时，不再默认调用旧 `gen()` 生成世界
- runtime 装载只从 WorldStore 读取 ChunkRecord
- worker 仅执行 `build-chunk-mesh`

- [ ] **Step 2: 运行测试，确认失败**

Expected:
- 现有 `new Chunk()` 仍会进入旧生成链路

- [ ] **Step 3: 修改 Chunk，移除构造时隐式 gen 入口**

要求：
- `Chunk` 保留 runtime 容器职责
- 改为由 WorldRuntime/World 显式注入数据与触发渲染装载

- [ ] **Step 4: 在 World/WorldRuntime 中接入纯装载路径**

流程：
- 读取 ChunkRecord
- 展开 runtime `blockData`
- 构建派生缓存
- 发 `build-chunk-mesh` 给 worker

- [ ] **Step 5: 保留玩家修改后的 consolidation/AO/patch 语义**

要求：
- 只把“初始装载路径”切走
- 不破坏已有运行时局部编辑路径

- [ ] **Step 6: 重跑测试**

Expected:
- runtime chunk 装载测试通过
- 不再出现“装载时生成世界”的旧语义

## Task 6: 收口玩家编辑入口到 WorldAccessLayer

**Files:**
- Modify: `src/world/WorldAccessLayer.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/actors/player/PlayerInteraction.js`
- Modify: `src/world/World.js`
- Test: `src/tests/test-player-interaction.js`
- Test: `src/tests/test-world.js`

- [ ] **Step 1: 写失败测试，固定 setBlock/removeBlock 热路径只改 runtime**

覆盖：
- 玩家放置/破坏方块立即更新 runtime `blockData`
- 对应 chunk 被标记 dirty
- 写回队列被登记
- 玩家交互不等待 IndexedDB

- [ ] **Step 2: 运行测试，确认失败**

Expected:
- 现有交互仍直接依赖 chunk 内部实现

- [ ] **Step 3: 在 WorldAccessLayer 中实现写接口**

实现：
- `setBlock`
- `removeBlock`
- `applyBatchEdits`

- [ ] **Step 4: 在 WorldRuntime 中实现 dirty chunk flush**

要求：
- 修改先落 runtime `blockData`
- 再异步写回 WorldStore
- 卸载前支持强制 flush

- [ ] **Step 5: 修改 PlayerInteraction 只走统一访问层**

要求：
- 不再直接操作裸 `chunk.blockData`
- 跨 chunk 编辑也走统一路径

- [ ] **Step 6: 重跑测试**

Expected:
- 玩家放置/破坏相关测试通过
- 世界状态和 runtime 派生缓存一致

## Task 7: 实现边界控制与后台扩图

**Files:**
- Create: `src/world/WorldBoundsController.js`
- Modify: `src/world/WorldGenerationService.js`
- Modify: `src/world/WorldRuntime.js`
- Modify: `src/world/World.js`
- Modify: `src/actors/player/Physics.js`
- Test: `src/tests/test-world.js`
- Test: `src/tests/test-physics.js`

- [ ] **Step 1: 写失败测试，固定 safeBounds 与硬边界行为**

覆盖：
- 玩家在 `safeBounds` 内可正常移动
- 扩图未完成时，越界会被硬阻挡
- 扩图完成后边界放开

- [ ] **Step 2: 运行测试，确认失败**

Expected:
- 当前系统没有独立边界控制器

- [ ] **Step 3: 实现 WorldBoundsController**

实现：
- `isInsideSafeBounds`
- `isNearExpansionEdge`
- `shouldBlockMovement`

- [ ] **Step 4: 在 WorldGenerationService 中实现 expandWorldIfNeeded**

要求：
- 接近边缘触发后台 region 扩图
- 完成后更新 world meta 边界

- [ ] **Step 5: 在 Physics/World 中接入硬边界**

要求：
- 未扩图完成前阻挡玩家继续外扩
- 不影响已生成区域内的正常交互

- [ ] **Step 6: 重跑测试**

Expected:
- 边界与扩图测试通过

## Task 8: 完整验证新主链路

**Files:**
- Modify: 无（验证任务）

- [ ] **Step 1: 运行 ESLint**

Run:
```bash
npm run lint
```

Expected:
- lint 通过

- [ ] **Step 2: 启动项目并进行人工验证**

Run:
```bash
npm run start
```

手工验证：
- 新开档进入前出现阻塞预生成
- 进入世界后奔跑时不再触发新地形生成
- 放置/破坏方块即时生效
- 远离后卸载、回到原地后状态保持一致
- 接近边界时触发后台扩图
- 扩图未完成前硬边界生效

- [ ] **Step 3: 记录性能与行为检查结果**

重点观察：
- runtime chunk 装载路径是否只读 WorldStore
- 玩家交互是否完全不等待 IndexedDB
- 奔跑时是否不再触发旧 `gen()` 语义

- [ ] **Step 4: 视结果决定下一阶段**

若主链路通过，再继续：
- 优化 region 预取
- 压缩存储格式
- 旧存档迁移
