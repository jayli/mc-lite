# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- Always respond in Chinese. 所有解释、说明和对话请使用中文。代码注释也尽量使用中文。

## 执行契约（最高优先级）

以下规则覆盖所有其他指令，必须严格遵守，这些规则只在使用 Claude Code 时有效。

### 1. 先执行后报告
- 尽可能完成更多工作后再请求确认
- 仅以下情况可中断：缺少必要选择/输入、缺少权限、不可逆高风险操作
- 安全且有默认值的决策，直接执行不要询问

### 2. 长任务连续性（3步以上）
- 维护进度：已完成(done)、进行中(doing)、下一步(next)
- 每个重要操作后 checkpoint，记录进度
- 被打断后从最后一个 checkpoint 恢复，而非重新开始
- 保持动力直到完成或遇到真正阻塞

### 3. 单回合行动与执行证据
- 每回合只选一种行动：tool_call / command_run / direct_answer
- 工具调用返回后，必须在同回合消费结果并继续
- 每次重要操作后必须包含：
```
Action: <执行的操作>
Result: <关键结果>
Next: <下一步>
```

### 4. 失败恢复阶梯
遇到问题时按此顺序恢复，禁止直接放弃：
1. format fix：修正工具/命令参数格式
2. minimal retry：用更明确的参数重试一次
3. bounded fallback：切换到更简单的有效路径
4. blocker report：精确报告所需输入/权限

### 5. 禁止行为（严禁）
- 虚构工具调用或工具输出
- 只发送计划而不采取实际行动
- 忽略必需参数或 schema 约束
- 用道歉代替恢复行动
- 没有 checkpoint 就停止长任务

---

- 尽最大努力调用 Claude tools 持续执行任务，除非遇到上述必须确认的情况

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
这是一个基于 Three.js 的 3D 体素游戏（Minecraft 克隆），这是一个纯客户端应用，没有后端，自启动一个 HTTP 静态服务器进行开发。

## 开发命令
- **启动开发服务器**: `npm run start` (端口 8080)
- **运行测试**: 访问 http://localhost:8080/src/tests/index.html，点击"运行所有测试"
- **代码检查**: `npm run lint` (ESLint 检查代码规范)
- **自动修复**: `npm run lint:fix` (自动修复可修复的 ESLint 问题)
- **规格驱动开发**: 使用 `Skill("speckit.specify")`、`Skill("speckit.tasks")`、`Skill("speckit.implement")`

> 开发服务器会自动提供热加载能力。

## 调试
- 游戏实例暴露在 `window.game`，可在浏览器控制台中访问
- 可通过 `window.game.world`、`window.game.engine` 等访问子系统

## 代码规范
- **材质统一管理**: `src/core/MaterialManager.js`
- **方块属性集中配置**: `src/constants/BlockData.js`

## 核心架构
### 三层架构
- 表现层: UI 与渲染 : `src/ui/`, `src/core/Engine.js`
- 业务逻辑层: 游戏系统 : `src/core/Game.js`, `src/world/World.js`
- 数据层: 持久化与存储 : `src/services/`, `src/constants/`

### 关键机制（需要跨文件理解）

> **详细架构文档**: `docs/RENDERING_PIPELINE_ARCHITECTURE.md` — 完整的渲染管线架构图解

#### 渲染管线核心设计
- **blockData 是唯一权威数据源**，存储 `{type, orientation}`，所有其他数据都可从它派生
- **两条计算路径**：
  - 初始生成路径：WorldWorker 一次性计算地形、面剔除、AO → 创建 InstancedMesh
  - 动态更新路径：主线程立即响应（动态 Mesh）→ Consolidation 延迟合并回 InstancedMesh
- **数据流向**：数据层(blockData) → 计算层(面剔除+AO) → 渲染层(InstancedMesh)，派生数据可随时重建

#### Consolidation 合并机制
- 动态添加/删除的方块会先作为独立动态网格存在
- 当脏方块数量达到 50 个，或玩家停止操作 1000ms 后，会触发后台合并
- 合并过程会将区块数据发送到 Worker 重新计算所有可见面和 AO，生成优化的 InstancedMesh
- 竞态条件风险：主线程 AO 更新与 Worker 合并结果可能存在时序冲突

#### AO 阴影计算
- 主线程与 Worker 有两套 AO 计算逻辑，对未加载区域的处理不同
- 主线程：未加载区块默认认为是遮挡的（适合 FrozenMountain 等封闭地图）
- Worker：未加载/不存在的方块默认认为是不遮挡的（适合开放地形）
- AO 工具函数统一在 `src/utils/AOUtils.js`，建议优先复用

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
| AO | `src/core/AOSystem.js` | 主线程环境光遮蔽计算 |
| FaceCulling | `src/core/FaceCullingSystem.js` | 面剔除系统，协调主线程与 Worker |

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
位于 `src/world/entities/`：
- `Tree.js` — 基础树生成
- `RealisticTree.js` — 真实感树木生成
- `Cloud.js` — 云朵生成
- `Chest.js` — 宝箱实体
- `Island.js` — 岛屿辅助结构

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

## 测试
- **测试入口**: `src/tests/index.html`
- **运行方式**: 启动服务器后访问 http://localhost:8080/src/tests/index.html，点击"运行所有测试"

## 代码提交
任何修改都不能自动提交代码，必须等待明确的指令才能提交。


## Active Technologies
- JavaScript (ES6+), Three.js r128+ + Three.js (WebGL 渲染引擎) (028-minecart-feature)
- IndexedDB (通过 PersistenceWorker/ManualSaveWorker) (028-minecart-feature)
- JavaScript ES6+, Three.js r128+ + Three.js (WebGL渲染), MinecartManager (已有), PlayerInteraction (已有) (029-minecart-movement)
- IndexedDB (通过 PersistenceService, MinecartManager 已支持) (029-minecart-movement)

## Recent Changes
- 028-minecart-feature: Added JavaScript (ES6+), Three.js r128+ + Three.js (WebGL 渲染引擎)
