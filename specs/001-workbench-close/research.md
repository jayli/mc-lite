# Research: 关闭创造台功能

**Date**: 2026-03-14
**Feature**: 关闭创造台功能

## 技术调研结果

### 现有代码分析

#### PlaygroundService (src/services/PlaygroundService.js)

**现有状态管理**:
```javascript
_isPlaygroundActive: boolean      // 创造台激活状态
playgroundOrigin: {x, y, z}       // 左下角原点坐标
playgroundBlocks: Set<string>     // 存储 "x,y,z" 格式的方块坐标
playgroundSize: 40                // 40x40 平台
```

**现有方法**:
- `createPlayground(playerPos)`: 创建创造台，填充 playgroundBlocks
- `getModelBlocks()`: 获取平台上玩家建造的方块
- `exportModel()`: 导出模型为 JSON

**World API 使用**:
- `world.setBlock(x, y, z, type)`: 设置方块类型，'air' 表示删除
- `world.getBlock(x, y, z)`: 获取方块类型

#### UIManager (src/ui/UIManager.js)

**现有创造台按钮处理**:
- 按钮 ID: `btn-create-playground`
- 导出按钮 ID: `btn-export-model`
- 当前创建成功后: 禁用按钮、变灰、文本改为"创造台已打开"
- `updateActiveButtons()`: 更新按钮激活状态

**HUD 消息**:
- `this.hud.showMessage(msg)`: 显示临时消息提示

### 决策记录

#### 决策 1: 方块删除实现方式

**选项**:
- A: 遍历 playgroundBlocks 逐个调用 world.setBlock(x,y,z,'air')
- B: 直接操作 Chunk 的 InstancedMesh 进行批量删除
- C: 使用新的批量删除 API

**选择**: A

**理由**:
- 与现有 API 兼容，代码简洁
- 自动触发 Chunk 的 dirty 标记和重新渲染
- 避免直接操作 InstancedMesh 的复杂性
- 性能可接受 (1600 个方块删除在 1 秒内完成)

#### 决策 2: 玩家位置检测实现位置

**选项**:
- A: 在 UIManager 中检测
- B: 在 PlaygroundService 中检测
- C: 在 Game/Player 中检测

**选择**: B

**理由**:
- PlaygroundService 拥有创造台边界信息 (playgroundOrigin, playgroundSize)
- 业务逻辑集中，UIManager 只负责展示
- 易于单元测试

#### 决策 3: 防重复点击机制

**选项**:
- A: 使用局部变量锁 (isClosing)
- B: 使用 Promise/Async 状态
- C: 禁用按钮直到操作完成

**选择**: A + C

**理由**:
- 简单有效
- 保持按钮状态一致性
- 与现有代码风格一致

### 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 方块删除不完全 | 低 | 中 | 验证 playgroundBlocks 遍历完整性 |
| 内存泄漏 | 低 | 中 | 确保 Set 被清空，引用释放 |
| UI 状态不同步 | 中 | 低 | 统一使用 updateActiveButtons 更新 |
| 玩家位置误判 | 低 | 中 | 清晰的边界检查逻辑，Y 轴范围合理 |

### 参考资源

- 现有实现: `src/services/PlaygroundService.js:136-222` (createPlayground)
- UI 处理: `src/ui/UIManager.js:152-184` (createPlayground 按钮)
- 方块操作: `src/world/World.js` (setBlock 方法)
