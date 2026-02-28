# CLAUDE.md

## 项目简介
MC Lite 是一个基于 Three.js 的 3D 体素游戏（Minecraft 克隆），基于 ES6+ Modules 开发。这是一个客户端应用，通过自定义 HTTP 服务器进行开发。

## 开发命令
- **启动开发服务器**: `npm run start` (端口 8080)
- **运行测试**: 访问 http://localhost:8080/src/tests/index.html，点击"运行所有测试"
- **规格驱动开发**: 使用 `Skill("speckit.specify")`、`Skill("speckit.tasks")`、`Skill("speckit.implement")`

## 代码规范
- **材质统一管理**: `src/core/MaterialManager.js`
- **方块属性集中配置**: `src/constants/BlockData.js`

## 核心架构
### 三层架构
- 表现层: UI 与渲染 : `src/ui/`, `src/core/Engine.js`
- 业务逻辑层: 游戏系统 : `src/core/Game.js`, `src/world/World.js`
- 数据层: 持久化与存储 : `src/services/`, `src/constants/`

### 核心分层详解
| 系统 | 文件 | 职责 |
|------|------|------|
| Engine | `src/core/Engine.js` | Three.js 渲染管线、相机、日夜光照、阴影 |
| Game | `src/core/Game.js` | 游戏主循环、状态管理、性能监控 |
| Player | `src/actors/player/` | 玩家物理 (`Physics.js`)、背包 (`Slots.js`)、输入处理 |
| Weapon | `src/actors/weapon/Gun.js` | 武器渲染与射击逻辑 |
| Enemy | `src/core/EnemyManager.js` | 敌人生命周期与 Worker 通信 |
| Enemy Render | `src/actors/enemy/ZombieInstancedRenderer.js` | 丧尸实例化渲染 |
| Enemy AI | `src/workers/EnemyWorker.js` | 异步 AI 决策 |
| World | `src/world/World.js` | 区块动态加载 (渲染距离：3)、方块操作 |
| Chunk | `src/world/Chunk.js` | 区块渲染 (InstancedMesh)、隐藏面剔除 |

### Web Workers 异步处理
| Worker | 用途 | 文件 |
|--------|------|------|
| WorldWorker | 地形生成与区块创建 | `src/workers/WorldWorker.js` |
| EnemyWorker | 丧尸 AI 决策 | `src/workers/EnemyWorker.js` |
| FaceCullingWorker | 隐藏面剔除计算 | `src/workers/FaceCullingWorker.js` |
| ExplosionWorker | 爆炸效果计算 | `src/workers/ExplosionWorker.js` |
| PersistenceWorker | IndexedDB 操作 | `src/workers/PersistenceWorker.js` |

### 实体系统
- **实体管理器**: `src/world/entity-system/EntityManager.js`
- **代码实体**: `src/world/entity-system/CodeEntity.js` (程序化生成：树、云)
- **JSON 实体**: `src/world/entity-system/JsonEntity.js` (数据驱动：房屋、坦克)
- **结构加载器**: `src/world/entity-system/StructureLoader.js` (统一 JSON 结构加载)

### 其他系统
- **音频**: `src/core/AudioManager.js`
- **持久化**: `src/services/PersistenceService.js` (IndexedDB)
- **UI**: `src/ui/UIManager.js`、`src/ui/HUD.js`、`src/ui/Inventory.js`
- **工具函数**:
  - `src/utils/ItemIconUtils.js` - 图标生成
  - `src/utils/FaceCullingUtils.js` - 方块面剔除
  - `src/utils/OrientationUtils.js` - 方块方向

## 开发工作流
1. **添加方块**: `BlockData.js` → `MaterialManager.js` → `Chunk.js`
2. **添加敌人**: 实体类 → `EnemyWorker.js` → `EnemyManager.js`
3. **添加结构数据**: 在 `src/world/structures/` 添加 JSON 文件 → 在 `StructureLoader.js` 中注册

## 测试
- **测试目录**: `src/tests/`，**测试入口**: `src/tests/index.html`
- **运行方式**: 访问 http://localhost:8080/src/tests/index.html，点击 `#run-all-btn` 执行测试

## 代码提交
- 任何情况你都不能自动提交代码，必须等待我的明确指令才提交代码，再次强调，你的任何修改都不能自动在未经我允许的情况下提交代码，必须等我的明确指令才能提交代码
- 再次强调，请你不要擅自替我提交代码，必须等我明确的指令才提交代码。

## 文件操作最佳实践
### 读取文件
- 使用 `Read` 工具读取文件内容
- 如果读取失败或内容异常，先检查文件是否存在，再尝试重新读取

### 修改文件
1. **优先使用 `Edit` 工具** 进行小幅度修改
2. **`Edit` 工具匹配失败时**：使用 `Bash` + `node` 脚本或 `sed` 命令修改文件
   ```bash
   node << 'SCRIPT'
   const fs = require('fs');
   const path = 'path/to/file';
   let content = fs.readFileSync(path, 'utf8');
   content = content.replace('old_string', 'new_string');
   fs.writeFileSync(path, content);
   SCRIPT
   ```
3. **如果不慎清空文件**：立即使用 `git checkout HEAD -- <file>` 恢复

### 新建文件
- 使用 `Write` 工具创建新文件

### 删除文件
- 使用 `Bash` 命令 `rm <file>` 删除文件
