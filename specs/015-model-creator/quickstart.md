# Quickstart: 模型创造台

**Feature**: 模型创造台 (Model Creator)
**Date**: 2026-02-23

---

## 开发环境设置

```bash
# 1. 克隆仓库（如果尚未克隆）
git clone <repo-url>
cd mc-lite

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run start

# 4. 访问游戏
# 打开浏览器访问 http://localhost:8080
```

---

## 功能使用流程

### 1. 打开创造台

```
1. 进入游戏世界
2. 按 ESC 打开设置面板
3. 点击"打开创造台"按钮
4. 在玩家正前方 5-10 格处生成 40x40 灰色平台
5. 按钮变为灰色不可点击状态
```

### 2. 创建模型

```
1. 走上创造台
2. 使用游戏内的方块放置机制
3. 在平台上搭建想要的结构
4. 可以使用任何游戏内方块（除了 playground_block）
```

### 3. 导出模型

```
1. 按 ESC 打开设置面板
2. 点击"导出模型"按钮
3. 浏览器下载 model.json 文件
4. 文件包含所有方块的相对坐标、类型、方向
```

---

## 文件位置

```
specs/015-model-creator/
├── spec.md              # 功能规格说明书
├── plan.md              # 实现计划
├── research.md          # 技术调研
├── data-model.md        # 数据模型
├── contracts/
│   └── api.md           # API 契约
└── quickstart.md        # 本文件
```

---

## 相关文档

- [功能规格](./spec.md) - 用户故事和需求
- [数据模型](./data-model.md) - JSON 结构定义
- [API 契约](./contracts/api.md) - 接口定义

---

## 常见问题

**Q: 创造台可以关闭吗？**
A: 当前版本创造台只能创建，不能关闭或隐藏。

**Q: 导出的文件保存在哪里？**
A: 浏览器的默认下载目录（通常是 Downloads 文件夹）。

**Q: 可以导出多次吗？**
A: 可以，每次导出会覆盖之前的 model.json 文件。

**Q: playground_block 能被破坏吗？**
A: 不能，构成创造台基础的方块不可被 TNT、机枪或玩家破坏。
