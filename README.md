# MC-Lite

一个基于 Three.js 的我的世界轻量版（Minecraft-lite）。

项目目标是用尽量清晰的架构和可维护的代码，持续迭代一个可玩、可扩展、可实验的游戏世界。
## 在线体验

- Demo: <https://js-perf.cn>

## 本地调试

```bash
npm install
npm run start
```

启动后访问：<http://localhost:8080>

## 项目结构（简版）

```text
src/
  actors/        # 玩家、敌人、武器、炮塔
  core/          # 游戏主循环、渲染引擎、核心系统
  world/         # 区块、地形、实体、特效
  workers/       # World/Enemy/FaceCulling 等 Worker
  services/      # 持久化、手动存档、创造台
  ui/            # HUD、背包、设置面板
  constants/     # 方块定义与全局配置
  utils/         # 通用算法与工具函数
```

## 代码结构

![Architecture 2026-03-30](docs/architechure-2026-03-30.png)

### 游戏截图

<img width="3256" height="1528" alt="历史截图 1" src="https://github.com/user-attachments/assets/753eea26-bde8-40c0-92ab-a6a3306e422c" />

<img width="3256" height="1534" alt="历史截图 2" src="https://github.com/user-attachments/assets/2743b7e4-0c6a-4f4b-bc6b-8dd44c3bc60f" />

<img width="3308" height="1864" alt="历史截图 3" src="https://github.com/user-attachments/assets/b4487031-0cbf-41b0-b0da-a9d05f0560a0" />

## license

[MIT](LICENSE)
