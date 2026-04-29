# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- Always respond in Chinese. 所有解释、说明和对话请使用中文。代码注释也尽量使用中文。

## 代码质量检查
每次修改 JS 文件后，在任务结束前自动运行 lint 检查：

```bash
npm run lint
```
**运行时机**:
- 修改了 `src/**/*.js` 文件后
- 提交代码前
- 长任务的关键节点（如重构完成一个模块后）

**处理方式**:
- 如发现警告，简要报告并在下一步计划中建议修复
- 不强制要求立即修复所有警告，但应保持新增代码无警告

## 项目简介
这是一个基于 Three.js 的纯客户端体素游戏应用，没有后端，无构建步骤（no bundler）。使用 ES Modules + Import Maps 直接从 CDN 加载 Three.js（v0.160.0），自启动一个 HTTP 静态服务器进行开发。

## 开发命令
- **启动开发服务器**: `npm run start` (端口 8080)
- **运行测试**: `node command/run-tests.js` (使用 Playwright headless 浏览器运行全部测试)
  - `--verbose`: 显示失败用例的详细错误信息
  - `--port 3000`: 指定开发服务器端口（默认 8080）
- **代码检查**: `npm run lint` (ESLint 检查代码规范)
- **自动修复**: `npm run lint:fix` (自动修复可修复的 ESLint 问题)

> 开发服务器会自动提供热加载能力。

## TDD 工作流
使用 `superpowers:test-driven-development` 技能进行开发时，遵循 Red-Green-Refactor 循环：

1. **RED（飘红）**: 先写一个失败的测试，证明功能是缺失的
2. **验证 RED**: 运行 `node command/run-tests.js` 确认测试失败（飘红）
3. **GREEN（飘绿）**: 写最少量的代码让测试通过
4. **验证 GREEN**: 运行 `node command/run-tests.js` 确认所有测试通过（飘绿）
5. **REFACTOR**: 重构代码，保持测试通过
6. **重复**: 写下一个失败测试

**运行测试的时机**:
- 刚写好测试用例后 → `node command/run-tests.js` 验证是否按预期失败（飘红）
- 实现功能代码后 → `node command/run-tests.js` 验证是否通过（飘绿）
- 重构完成后 → `node command/run-tests.js` 确认没有引入回归
- 修复 bug 后 → `node command/run-tests.js --verbose` 回归验证

**注意**: 测试必须先失败再实现。如果测试一开始就通过，说明测试写错了或者在测试已有行为。

## 调试
- 入口文件: `index.html` — 通过 `<script type="module">` 加载 `src/core/Game.js` 并启动游戏
- 游戏实例暴露在 `window.game`，可在浏览器控制台访问各子系统，如 `window.game.world`、`window.game.engine`

## 代码规范
- **材质统一管理**: `src/core/MaterialManager.js`
- **方块属性集中配置**: `src/constants/BlockData.js`

## 核心架构
### 三层架构
- 表现层: UI 与渲染 : `src/ui/`、`src/core/Engine.js`
- 业务逻辑层: 游戏系统 : `src/core/Game.js`、`src/world/World.js`
- 数据层: 持久化与存储 : `src/services/`、`src/constants/`

### 核心分层详解
| 系统 | 入口文件 | 职责 |
|------|---------|------|
| Engine | `src/core/Engine.js` | Three.js 渲染管线、相机、日夜光照、阴影 |
| Game | `src/core/Game.js` | 游戏主循环、状态管理、持有所有子系统引用 |
| Player | `src/actors/player/Player.js` | 玩家主类（物理、交互、背包） |
| World | `src/world/World.js` | 区块动态加载 (渲染距离：3)、方块操作入口 |
| Chunk | `src/world/Chunk.js` | 区块渲染 (InstancedMesh)、隐藏面剔除 |
| Enemy | `src/core/EnemyManager.js` | 敌人生命周期与 EnemyWorker 通信 |
| Turret | `src/actors/turret/TurretManager.js` | 炮塔自动防御子系统入口 |
| Minecart | `src/actors/minecart/MinecartManager.js` | 矿车生命周期、移动系统、持久化 |
| ZombieNest | `src/actors/zombie-nest/ZombieNestManager.js` | 丧尸巢穴创建、刷怪、持久化 |
| LightSource | `src/core/LightSourceManager.js` | 发光方块的 PointLight 管理 |
| AO | `src/workers/AOWorker.js` | 专用 AO 计算 Worker，脏集机制异步计算 |
| FaceCulling | `src/core/FaceCullingSystem.js` | 面剔除系统，协调主线程与 Worker |

### 关键跨文件机制（需要跨文件理解）

1. **Consolidation 合并机制**
   - 动态添加/删除的方块先作为独立动态网格存在
   - 脏方块数达到 50 个，或玩家停止操作 1000ms 后，触发后台合并
   - 合并过程将区块数据发送到 Worker 重新计算所有可见面和 AO，生成优化的 InstancedMesh
   - **竞态条件风险**: 主线程 AO 更新与 Worker 合并结果可能存在时序冲突

2. **AO 阴影计算（Worker 专用）**
   - `AOWorker` 专用 Worker 处理所有 AO 计算，避免阻塞主线程
   - Chunk 维护 `dirtyAOPositions` 脏集，只计算受影响的方块
   - AO 工具函数统一在 `src/utils/AOUtils.js`，主线程与 Worker 共用
   - Consolidation 完成后 100ms 防抖触发 AO 刷新，直接覆写 InstancedMesh attribute

3. **批量删除方块注意**: 使用 `isBatch=false` 参数会复用单次删除逻辑，避免竞态条件导致的 AO 丢失

### 玩家系统
位于 `src/actors/player/`：
- `Player.js` — 玩家主类，整合物理、交互、背包
- `PlayerInteraction.js` — 交互逻辑（挖掘、放置、使用物品）
- `Physics.js` — 物理（碰撞检测、重力、跳跃）
- `Slots.js` — 背包/快捷栏管理

### 武器与炮塔
- `src/actors/weapon/Gun.js` — 武器渲染与射击逻辑

位于 `src/actors/turret/`，自动防御子系统：
- `TurretManager.js` — 炮塔生命周期管理，由 `Game.js` 持有
- `Turret.js` — 检测、瞄准（偏航+俯仰）和射击，通过 `onFire` 回调通知管理器
- `ProjectilePool.js` — 炮弹对象池（acquire/release 模式）
- `Projectile.js` — 炮弹飞行与碰撞检测（敌人 + 方块）
- `InstancedProjectileRenderer.js` — 炮弹 InstancedMesh 批量渲染

协作链路：`TurretManager` → `Turret.update()` → `onFire` → `ProjectilePool.acquire()` → 命中 → `EnemyManager.removeZombie()`

### 敌人系统
- `src/core/EnemyManager.js` — 敌人生命周期与 EnemyWorker 通信
- `src/actors/enemy/Zombie.js` — 丧尸实体（状态、AI行为、受击逻辑）
- `src/actors/enemy/ZombieInstancedRenderer.js` — 丧尸 InstancedMesh 批量渲染

### 矿车系统
位于 `src/actors/minecart/`，矿车实体与轨道移动：
- `MinecartManager.js` — 矿车生命周期管理、位置索引、Chunk 持久化
- `Minecart.js` — 矿车实体（位置、朝向、运动状态）
- `MinecartMovementSystem.js` — 轨道检测、方向判定、移动物理
- `MinecartLinkDetector.js` — 矿车链接检测（串联矿车）
- `MinecartPlacementHandler.js` — 矿车放置逻辑
- `MinecartInstancedRenderer.js` — 矿车 InstancedMesh 批量渲染
- `MinecartCollisionSystem.js` — 矿车碰撞检测

协作链路：`PlayerInteraction` → `MinecartPlacementHandler` → `MinecartManager.createMinecart()` → `MinecartMovementSystem.updateAll()`

### 丧尸巢穴系统
位于 `src/actors/zombie-nest/`，可放置的丧尸生成点：
- `ZombieNestManager.js` — 巢穴生命周期、位置索引、Chunk 持久化、刷怪回调
- `ZombieNest.js` — 巢穴实体（位置、关键方块、刷怪间隔）
- `ZombieNestPlacementHandler.js` — 巢穴放置逻辑

协作链路：`PlayerInteraction` → `ZombieNestPlacementHandler` → `ZombieNestManager.createNest()` → `handleNestSpawn()` → `EnemyManager.addZombie()`

### 下雨效果
位于 `src/world/effects/`：
- `RainEffect.js` — GPU 驱动的雨滴粒子系统（LineSegments + ShaderMaterial），跟随玩家移动，碰撞地面方块

### 光源管理系统
- `src/core/LightSourceManager.js` — 发光方块（吊灯、萤石、蛙明灯、岩浆）的 PointLight 管理，支持区块加载时批量添加/移除

### 区块子模块
位于 `src/world/`：
- `ChunkConsolidation.js` — 区块合并机制（动态方块→优化 InstancedMesh）
- `ChunkGenerator.js` — 区块数据生成，调用实体系统放置结构
- `ChunkNeighborUtils.js` — 区块邻居查询工具
- `ChunkRenderUtils.js` — 区块渲染辅助（面创建、AO 应用）
- `ChunkPersistence.js` — 区块持久化接口
- `TerrainGen.js` — 基础地形噪声生成

### Web Workers 异步处理
| Worker | 用途 | 文件 |
|--------|------|------|
| WorldWorker | 地形生成与区块创建 | `src/workers/WorldWorker.js` |
| EnemyWorker | 丧尸 AI 决策 | `src/workers/EnemyWorker.js` |
| FaceCullingWorker | 隐藏面剔除计算 | `src/workers/FaceCullingWorker.js` |
| ExplosionWorker | 爆炸效果计算 | `src/workers/ExplosionWorker.js` |
| PersistenceWorker | IndexedDB 自动持久化 | `src/workers/PersistenceWorker.js` |
| ManualSaveWorker | 手动存档的 IndexedDB 操作 | `src/workers/ManualSaveWorker.js` |

### 自定义地图
位于 `src/workers/maps/`，由 `WorldWorker.js` 调用，每个地图模块负责特定地标的位置计算和方块生成：
- `RegionCenterUtils.js` — 区域内确定性随机中心计算工具（被所有地图共享）
- `CityMap.js` — 主城地图生成（建筑配额、确定性排布、城门放置、地形平缓化）
- `FrozenMountain.js` — 冰封山峰地图生成
- `Pyramid.js` — 金字塔地图生成（新地图参照此文件实现）
- `IslandMap.js` — 海岛地图生成
- `SnowLand.js` — 雪地地图生成

### 实体系统
实体系统位于 `src/world/entity-system/`，用于程序化生成和 JSON 数据驱动的结构。
- **实体管理器**: `EntityManager.js` - 注册和管理所有实体定义
- **实体定义**: `EntityDefinition.js` - 实体定义基类（名称、类型、生成参数）
- **代码实体**: `CodeEntity.js` - 程序化生成（树、云等）
- **JSON 实体**: `JsonEntity.js` - 数据驱动（房屋、坦克等）
- **结构加载器**: `StructureLoader.js` - 统一 JSON 结构加载
- **真实感树管理**: `RealisticTreeManager.js` - 真实感树木批量管理与放置
- **详细文档**: `src/world/entity-system/README_ENTITY_SYSTEM.js`

### 世界实体
位于 `src/world/entities/`：`Tree.js` — 基础树生成，`Cloud.js` — 云朵生成，`Chest.js` — 宝箱实体，`Island.js` — 岛屿辅助结构

### 其他系统
- **音频**: `src/core/AudioManager.js` — 音频加载与播放（导出单例 `audioManager`）
- **面剔除调试**: `src/core/FaceCullingSystemDebug.js`
- **持久化**: `src/services/PersistenceService.js` (IndexedDB 自动持久化)
- **手动存档**: `src/services/ManualSaveService.js` (通过 ManualSaveWorker)
- **创造台**: `src/services/PlaygroundService.js` (模型编辑/导出)
- **Worker RPC**: `src/services/WorkerRpcClient.js` (Worker 通信封装)
- **UI**: `src/ui/UIManager.js`（设置面板、传送、画质切换）、`src/ui/HUD.js`（信息看板）、`src/ui/Inventory.js`（物品背包界面）
- **粒子特效**: `src/world/effects/ParticleSystem.js`
- **工具函数**:
  - `src/utils/AOUtils.js` - AO 阴影计算（主线程与 Worker 共用）
  - `src/utils/FaceCullingUtils.js` - 方块面剔除判定
  - `src/utils/FaceCullingCore.js` - 面剔除核心算法
  - `src/utils/OrientationUtils.js` - 方块方向/朝向计算
  - `src/utils/ItemIconUtils.js` - 物品图标生成
  - `src/utils/MathUtils.js` - 数学工具（seededRandom、角度计算、插值等）
  - `src/utils/IndexedDBUtils.js` - IndexedDB 通用操作封装
  - `src/utils/StructureUtils.js` - 结构放置工具
  - `src/utils/CityPlacementUtils.js` - City 建筑放置算法（哈希随机、边界检查、距离判定）
- **常量配置**:
  - `src/constants/GameConfig.js` - 游戏全局常量（背包容量、丧尸上限、AO参数等）
  - `src/constants/RegionMapConfig.js` - 区域地图配置（区域大小、地标参数）
  - `src/constants/PersistenceConfig.js` - 自动持久化配置
  - `src/constants/SaveConfig.js` - 手动存档配置（DB名称、版本）

## 开发工作流
1. **添加方块**: `BlockData.js` → `MaterialManager.js` → `Chunk.js`
2. **添加敌人**: 实体类 → `EnemyWorker.js` → `EnemyManager.js`
3. **添加结构数据**: 在 `src/world/structures/` 添加 JSON 文件 → 在 `StructureLoader.js` 中注册
4. **添加新地图**: 新地图加在 `src/workers/maps/` 中，参照 `Pyramid.js` 实现，在 `WorldWorker.js` 中被调用

## 代码提交
任何修改都不能自动提交代码，必须等待明确的指令才能提交。
