# CLAUDE.md

## 开发命令
- **启动开发服务器**: `npm run start`
- **规格驱动开发**: 使用 `Skill("speckit.specify")`、`Skill("speckit.tasks")`、`Skill("speckit.implement")`
- **代码规范**: ES6 Modules、面向对象、材质统一管理 (`MaterialManager.js`)、方块属性集中配置 (`BlockData.js`)

## 项目架构

### 核心分层
| 层级 | 文件 | 职责 |
|------|------|------|
| Engine | `src/core/Engine.js` | 渲染管线、相机、日夜光照 |
| Game | `src/core/Game.js` | 游戏主循环与状态管理 |
| Player | `src/entities/player/` | 玩家物理 (`Physics.js`)、背包 (`Slots.js`) |
| Weapon | `src/entities/weapon/Gun.js` | 武器渲染与射击逻辑 |
| Enemy | `src/core/EnemyManager.js` | 敌人生命周期与 Worker 通信 |
| Enemy Render | `src/entities/enemy/ZombieInstancedRenderer.js` | 丧尸实例化渲染 |
| Enemy AI | `src/workers/EnemyWorker.js` | 异步 AI 决策 |
| World | `src/world/World.js` | 区块动态加载 (渲染距离：3) |
| Chunk | `src/world/Chunk.js` | 区块渲染 (`InstancedMesh`) |

### 异步处理
- **地形生成**: `src/workers/WorldWorker.js`
- **敌人 AI**: 主线程负责物理，Worker 负责决策
- **隐藏面剔除**: `src/core/FaceCullingSystem.js` + `src/workers/FaceCullingWorker.js`
- **持久化**: `src/services/PersistenceService.js` (IndexedDB)

### 其他系统
- **音频**: `src/core/AudioManager.js`
- **爆炸效果**: `src/workers/ExplosionWorker.js`
- **树木生成**: `src/world/entities/RealisticTreeManager.js`
- **UI**: `src/ui/UIManager.js`、`src/ui/HUD.js`、`src/ui/Inventory.js`

## 开发工作流
1. **添加方块**: `BlockData.js` → `MaterialManager.js` → `Chunk.js`
2. **添加敌人**: 实体类 → `EnemyWorker.js` → `EnemyManager.js`
3. **调试物理**: 玩家 `Physics.js` / 敌人实体 `update()` 方法
4. **性能监控**: 按 `P` 键显示/隐藏调试信息

## 代码提交
- 必须等待明确指令才提交
- 提交作者包含：`noreply@anthropic.com`、`lijing00333@163.com`
