# Phase 0: Research & Discovery

**Feature**: 模型创造台 (Model Creator)
**Date**: 2026-02-23
**Branch**: `001-model-creator`

---

## Research Tasks

### 1. 方块放置机制研究

**目的**: 了解现有方块放置 API 以便在创造台上放置方块

**发现**:
- **入口**: `World.setBlock(x, y, z, typeOrEntry, orientation)` (World.js:267)
- **参数**:
  - `x, y, z`: 世界坐标
  - `typeOrEntry`: 方块类型字符串或 `{ type, orientation }` 对象
  - `orientation`: 朝向值 (0-3)，仅当 typeOrEntry 为字符串时使用
- **限制**: 只能在已加载的区块中放置方块
- **朝向系统**: 使用 0-3 表示水平方向 (东/南/西/北)

**相关代码**:
```javascript
// World.js:267
setBlock(x, y, z, typeOrEntry, orientation = 0) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const key = `${cx},${cz}`;
  let chunk = this.chunks.get(key);
  if (!chunk) return;
  chunk.addBlockDynamic(x, y, z, typeOrEntry, orientation);
}
```

**决策**: 使用 `World.setBlock()` API 在创造台上放置方块

---

### 2. UI 按钮添加模式

**目的**: 参考现有设置按钮实现方式添加创造台按钮

**发现**:
- **设置面板结构**: `settings-modal` HTML 元素包含多个按钮组
- **按钮初始化**: 在 `UIManager.initSettings()` 中获取按钮引用并绑定事件
- **按钮状态管理**: 使用 `updateActiveButtons()` 方法更新按钮激活状态
- **现有按钮模式**:
  - 分辨率：`btn-perf`, `btn-mid`, `btn-quality`
  - 枪械破坏：`btn-gun-destroy-on`, `btn-gun-destroy-off`
  - 丧尸数量：`btn-zombie-20`, `btn-zombie-30`, `btn-zombie-50`

**决策**:
- 在 HTML 中添加两个新按钮：`btn-create-playground` 和 `btn-export-model`
- 在 `UIManager.initSettings()` 中添加按钮事件处理
- 使用相同的样式模式（active 类）显示按钮状态

---

### 3. 文件下载 API

**目的**: 实现浏览器端 JSON 文件下载

**发现**:
- **标准方法**: 使用 `Blob` + `URL.createObjectURL()` + 临时 `<a>` 标签
- **最佳实践**:
  1. 创建 Blob 对象，MIME 类型设为 `application/json`
  2. 创建临时 `<a>` 元素
  3. 设置 `href` 为 `URL.createObjectURL(blob)`
  4. 设置 `download` 属性为文件名
  5. 触发点击后释放 URL

**推荐实现**:
```javascript
function exportModelToJSON(blocks) {
  const json = JSON.stringify({ blocks }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'model.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

**决策**: 使用 Blob + 临时 `<a>` 标签方式实现下载

---

### 4. 不可破坏方块实现

**目的**: 确保 playground_block 不被 TNT、机枪或玩家破坏

**发现**:
- **参考案例**: `collider` 方块是不可见的碰撞体，不参与渲染
- **破坏检查点**:
  1. TNT 爆炸：`World.explode()` 中检查方块属性
  2. 机枪破坏：`Gun.js` 中检查 `canGunsDestroyBlocks` 标志
  3. 玩家挖掘：`Chunk.removeBlock()` 中检查方块类型
- **实现策略**: 在 `BlockData.js` 中为 `playground_block` 添加特殊属性标记

**决策**:
- 在 `BlockData.js` 中添加 `playground_block` 定义
- 设置 `isIndestructible: true` 属性
- 在破坏逻辑中检查此属性并阻止破坏

---

### 5. 方向数据处理

**目的**: 了解方向数据的存储和导出格式

**发现**:
- **Minecraft 标准方向值**: 0-5 (上/下/北/南/西/东)
- **当前系统**: 使用 0-3 表示水平方向 (东/南/西/北)
- **工具函数**:
  - `BlockOrientation` 枚举 (OrientationUtils.js:10)
  - `getRotationAngle(orientation)` - 获取旋转角度
  - `parseBlockEntry(entry)` - 解析方块数据
  - `serializeBlockEntry(type, orientation)` - 序列化方块数据

**决策**:
- 导出 JSON 使用扩展的方向系统 (0-5)
- 水平方向沿用现有 0-3 系统
- 垂直方向 (上/下) 在后续实现中扩展

---

## Technical Decisions Summary

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 方块放置 API | `World.setBlock()` | 现有标准 API，支持动态添加 |
| UI 按钮模式 | 参考设置按钮 | 与现有 UI 架构一致 |
| 文件下载 | Blob + `<a>` 标签 | 浏览器标准方式，简单可靠 |
| 不可破坏实现 | `isIndestructible` 属性 | 集中管理，易于扩展 |
| 方向数据 | 0-5 Minecraft 标准 | 与规范一致，便于后续扩展 |

---

## Alternatives Considered

| 替代方案 | 未选择原因 |
|----------|------------|
| 使用 IndexedDB 保存模型 | 增加了复杂性，不符合"导出为文件"的需求 |
| 使用 Base64 编码导出 | JSON 已经足够，无需额外编码 |
| 在服务器端生成文件 | 项目为纯前端游戏，无后端 |

---

## Next Steps

1. 创建 `PlaygroundService.js` - 创造台核心逻辑
2. 更新 `BlockData.js` - 添加 `playground_block` 定义
3. 更新 `MaterialManager.js` - 注册材质
4. 更新 `UIManager.js` - 添加按钮处理
5. 更新 `World.js` - 添加导出方法
