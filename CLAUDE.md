# CLAUDE.md

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
1. **Consolidation 合并机制**
   - 动态添加/删除的方块会先作为独立动态网格存在
   - 当脏方块数量达到 50 个，或玩家停止操作 1000ms 后，会触发后台合并
   - 合并过程会将区块数据发送到 Worker 重新计算所有可见面和 AO，生成优化的 InstancedMesh
   - 竞态条件风险：主线程 AO 更新与 Worker 合并结果可能存在时序冲突

2. **AO 阴影计算**
   - 主线程与 Worker 有两套 AO 计算逻辑，对未加载区域的处理不同
   - 主线程：未加载区块默认认为是遮挡的（适合 FrozenMountain 等封闭地图）
   - Worker：未加载/不存在的方块默认认为是不遮挡的（适合开放地形）
   - AO 工具函数统一在 `src/utils/AOUtils.js`，建议优先复用

### 核心分层详解
| 系统 | 文件 | 职责 |
|------|------|------|
| Engine | `src/core/Engine.js` | Three.js 渲染管线、相机、日夜光照、阴影 |
| Game | `src/core/Game.js` | 游戏主循环、状态管理、性能监控 |
| Player | `src/actors/player/` | 玩家物理 (`Physics.js`)、背包 (`Slots.js`)、输入处理 |
| Weapon | `src/actors/weapon/Gun.js` | 武器渲染与射击逻辑 |
| Turret | `src/actors/turret/Turret.js` | 炮塔检测、瞄准和射击逻辑 |
| Turret Manager | `src/actors/turret/TurretManager.js` | 炮塔创建、更新和销毁管理 |
| Projectile | `src/actors/turret/Projectile.js` | 炮弹实体逻辑 |
| Projectile Pool | `src/actors/turret/ProjectilePool.js` | 炮弹对象池管理 |
| Enemy | `src/core/EnemyManager.js` | 敌人生命周期与 Worker 通信 |
| Enemy Render | `src/actors/enemy/ZombieInstancedRenderer.js` | 丧尸实例化渲染 |
| Enemy AI | `src/workers/EnemyWorker.js` | 异步 AI 决策 |
| World | `src/world/World.js` | 区块动态加载 (渲染距离：3)、方块操作 |
| Chunk | `src/world/Chunk.js` | 区块渲染 (InstancedMesh)、隐藏面剔除 |
| AO System | `src/core/AOSystem.js` | 环境光遮蔽阴影计算 |
| Custom Map | `src/workers/maps/` | 自定义地图 |

### Web Workers 异步处理
| Worker | 用途 | 文件 |
|--------|------|------|
| WorldWorker | 地形生成与区块创建 | `src/workers/WorldWorker.js` |
| EnemyWorker | 丧尸 AI 决策 | `src/workers/EnemyWorker.js` |
| FaceCullingWorker | 隐藏面剔除计算 | `src/workers/FaceCullingWorker.js` |
| ExplosionWorker | 爆炸效果计算 | `src/workers/ExplosionWorker.js` |
| PersistenceWorker | IndexedDB 操作 | `src/workers/PersistenceWorker.js` |

### 实体系统
实体系统位于 `src/world/entity-system/`，用于程序化生成和 JSON 数据驱动的结构。
- **实体管理器**: `EntityManager.js` - 注册和管理所有实体定义
- **代码实体**: `CodeEntity.js` - 程序化生成（树、云等）
- **JSON 实体**: `JsonEntity.js` - 数据驱动（房屋、坦克等）
- **结构加载器**: `StructureLoader.js` - 统一 JSON 结构加载
- **详细文档**: `src/world/entity-system/README_ENTITY_SYSTEM.js`

### 其他系统
- **音频**: `src/core/AudioManager.js`
- **持久化**: `src/services/PersistenceService.js` (IndexedDB)
- **UI**: `src/ui/UIManager.js`、`src/ui/HUD.js`、`src/ui/Inventory.js`
- **工具函数**:
  - `src/utils/AOUtils.js` - AO 阴影计算
  - `src/utils/FaceCullingUtils.js` - 方块面剔除
  - `src/utils/OrientationUtils.js` - 方块方向
  - `src/utils/ItemIconUtils.js` - 图标生成

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

## 重要提示
- 已实现 AO 修复管理器 (`src/core/AORepairManager.js`) 作为兜底机制，处理批量删除后的 AO 阴影不一致问题，当前默认禁用
- 批量删除方块时使用 `isBatch=false` 参数会复用单次删除逻辑，避免竞态条件导致的 AO 丢失问题
