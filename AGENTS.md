# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

- Always respond in Chinese. 所有解释、说明和对话请使用中文。代码注释也尽量使用中文。

## 项目简介

基于 Three.js 的 3D 体素游戏（Minecraft 克隆）。纯客户端应用，无后端，无构建步骤（no bundler）。使用 ES Modules + Import Maps 直接从 CDN 加载 Three.js（v0.160.0）。

## 开发命令

- **启动开发服务器**: `npm run start` (端口 8080，Node.js 静态文件服务器)
- **代码检查**: `npm run lint` (ESLint，修改 `src/**/*.js` 后必须运行)
- **自动修复**: `npm run lint:fix`
- **运行测试**: 启动服务器后访问 http://localhost:8080/src/tests/index.html ，点击"运行所有测试"（浏览器内测试，无 CLI 测试命令）

## 调试

- 游戏实例暴露在 `window.game`，可在浏览器控制台访问
- `window.game.world`、`window.game.engine` 等可访问各子系统

## 代码规范

- **材质统一管理**: `src/core/MaterialManager.js` — 所有材质必须在此集中注册
- **方块属性集中配置**: `src/constants/BlockData.js` — 方块类型、属性在此定义
- **Magic Number 集中管理**: `src/constants/GameConfig.js`

## 核心架构

### 三层架构

- 表现层（UI/渲染）: `src/ui/`、`src/core/Engine.js`
- 业务逻辑层（游戏系统）: `src/core/Game.js`、`src/world/World.js`
- 数据层（持久化/存储）: `src/services/`、`src/constants/`

### 文件清单

#### core/ — 核心系统

- `Game.js` — 游戏主循环、状态管理、性能监控，持有所有子系统引用
- `Engine.js` — Three.js 渲染管线、相机、日夜光照、阴影
- `MaterialManager.js` — 材质统一注册与管理
- `AudioManager.js` — 音频加载与播放（导出单例 `audioManager`）
- `EnemyManager.js` — 敌人生命周期管理，与 `EnemyWorker` 通信
- `AOSystem.js` — 主线程 AO 环境光遮蔽计算
- `FaceCullingSystem.js` — 面剔除系统，协调主线程与 Worker 的面剔除逻辑
- `FaceCullingSystemDebug.js` — 面剔除调试工具

### actors/ — 游戏实体

**玩家** (`src/actors/player/`):
- `Player.js` — 玩家主类，整合物理、交互、背包
- `Physics.js` — 玩家物理（碰撞检测、重力、跳跃）
- `PlayerInteraction.js` — 玩家交互逻辑（挖掘、放置、使用物品）
- `Slots.js` — 玩家背包/快捷栏管理

**武器** (`src/actors/weapon/`):
- `Gun.js` — 武器渲染与射击逻辑

**敌人** (`src/actors/enemy/`):
- `Zombie.js` — 丧尸实体（状态、AI行为、受击逻辑）
- `ZombieInstancedRenderer.js` — 丧尸 InstancedMesh 批量渲染

### world/ — 世界系统

**区块核心** (`src/world/`):
- `World.js` — 区块动态加载（渲染距离：3）、方块操作入口
- `Chunk.js` — 区块渲染（InstancedMesh）、隐藏面剔除
- `ChunkConsolidation.js` — 区块合并机制（动态方块→优化InstancedMesh）
- `ChunkGenerator.js` — 区块数据生成，调用实体系统放置结构
- `ChunkNeighborUtils.js` — 区块邻居查询工具
- `ChunkRenderUtils.js` — 区块渲染辅助（面创建、AO 应用）
- `ChunkPersistence.js` — 区块持久化接口
- `TerrainGen.js` — 基础地形噪声生成

**世界实体** (`src/world/entities/`):
- `Tree.js` — 基础树生成
- `RealisticTree.js` — 真实感树木生成
- `Cloud.js` — 云朵生成
- `Chest.js` — 宝箱实体
- `Island.js` — 岛屿辅助结构

**特效** (`src/world/effects/`):
- `ParticleSystem.js` — 粒子效果系统（爆炸、破坏等）

### services/ — 服务层

- `PersistenceService.js` — 自动持久化服务（IndexedDB，通过 PersistenceWorker）
- `ManualSaveService.js` — 手动存档服务（通过 ManualSaveWorker）
- `PlaygroundService.js` — 创造台服务（模型编辑/导出）
- `WorkerRpcClient.js` — Worker RPC 通信封装

### ui/ — 用户界面

- `UIManager.js` — UI 总管理器（设置面板、传送、画质切换）
- `HUD.js` — 游戏信息看板（位置、性能、提示信息）
- `Inventory.js` — 物品背包界面

### utils/ — 工具函数

- `AOUtils.js` — AO 阴影计算工具（主线程与 Worker 共用）
- `FaceCullingUtils.js` — 方块面剔除判定
- `FaceCullingCore.js` — 面剔除核心算法
- `OrientationUtils.js` — 方块方向/朝向计算
- `ItemIconUtils.js` — 物品图标生成
- `MathUtils.js` — 数学工具（seededRandom、角度计算、插值等）
- `IndexedDBUtils.js` — IndexedDB 通用操作封装
- `StructureUtils.js` — 结构放置工具

### constants/ — 常量配置

- `BlockData.js` — 方块类型定义与属性配置
- `GameConfig.js` — 游戏全局常量（背包容量、丧尸上限、AO参数等）
- `RegionMapConfig.js` — 区域地图配置（区域大小、地标参数）
- `PersistenceConfig.js` — 自动持久化配置
- `SaveConfig.js` — 手动存档配置（DB名称、版本）

### 关键机制（需要跨文件理解）

1. **Consolidation 合并机制**
   - 动态添加/删除的方块先作为独立动态网格存在
   - 脏方块数达到 50 个，或玩家停止操作 1000ms 后，触发后台合并
   - 合并过程将区块数据发送到 Worker 重新计算所有可见面和 AO，生成优化的 InstancedMesh
   - **竞态条件风险**: 主线程 AO 更新与 Worker 合并结果可能存在时序冲突

2. **AO 阴影计算（双套逻辑）**
   - 主线程：未加载区块默认认为遮挡（适合封闭地图如 FrozenMountain）
   - Worker：未加载/不存在的方块默认不遮挡（适合开放地形）
   - AO 工具函数统一在 `src/utils/AOUtils.js`，优先复用
   - AO 修复管理器 `src/core/AORepairManager.js` 作为兜底机制，当前默认禁用

3. **批量删除方块注意**: 使用 `isBatch=false` 参数会复用单次删除逻辑，避免竞态条件导致的 AO 丢失

### 炮塔系统

位于 `src/actors/turret/`，是一个完整的自动防御子系统：
- `TurretManager.js` — 炮塔生命周期管理，由 `Game.js` 持有和调用 `update()`
- `Turret.js` — 单个炮塔的检测、瞄准（偏航+俯仰）和射击逻辑，通过 `onFire` 回调通知管理器
- `ProjectilePool.js` — 炮弹对象池（预分配，acquire/release 模式）
- `Projectile.js` — 炮弹实体，包含飞行、碰撞检测（敌人 + 方块）
- `InstancedProjectileRenderer.js` — 使用 InstancedMesh 批量渲染炮弹

协作链路：`TurretManager` → 每帧传入敌人列表给 `Turret.update()` → 炮塔锁定目标后触发 `onFire` → `ProjectilePool.acquire()` 发射炮弹 → 命中后通过 `EnemyManager.removeZombie()` 击杀敌人

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
- `FrozenMountain.js` — 冰封山峰地图生成
- `Pyramid.js` — 金字塔地图生成（新地图参照此文件实现）
- `IslandMap.js` — 海岛地图生成
- `SnowLand.js` — 雪地地图生成

### 实体系统

位于 `src/world/entity-system/`，支持程序化生成和 JSON 数据驱动的结构：
- `EntityManager.js` — 注册和管理所有实体定义
- `EntityDefinition.js` — 实体定义基类（名称、类型、生成参数）
- `CodeEntity.js` — 程序化生成（树、云等）
- `JsonEntity.js` — 数据驱动（房屋、坦克等）
- `StructureLoader.js` — 统一 JSON 结构加载
- `RealisticTreeManager.js` — 真实感树木批量管理与放置
- 详细文档: `src/world/entity-system/README_ENTITY_SYSTEM.js`

## 开发工作流

1. **添加方块**: `BlockData.js` → `MaterialManager.js` → `Chunk.js`
2. **添加敌人**: 实体类 → `EnemyWorker.js` → `EnemyManager.js`
3. **添加结构数据**: 在 `src/world/structures/` 添加 JSON 文件 → 在 `StructureLoader.js` 中注册
4. **添加新地图**: 在 `src/workers/maps/` 中新建，参照 `Pyramid.js` 实现，在 `WorldWorker.js` 中调用

## 代码提交

任何修改都不能自动提交代码，必须等待明确的指令才能提交。
