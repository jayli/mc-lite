---
name: mod-creator
description: 帮助用户根据实体模型示例图创建新的实体模型 JSON 文件，仿照 tank.json 格式，基于已有方块构成 3D 实体（建筑、载具、装饰物等）
argument-hint: "<entity-name> [群系] [概率] [渲染距离]"
user-invocable: true
---

# mod-creator 技能

## 技能目的

帮助用户根据提供的实体模型示例图，仿照现有的 `tank.json` 格式，创建新的实体模型 JSON 文件。生成的实体将基于已有的方块（定义在 `src/constants/BlockData.js` 中）构成。

## 触发场景

- 用户上传了一张或多张实体模型的示例图
- 用户想要创建一个由方块构成的 3D 实体模型（如建筑、载具、装饰物等）
- 用户需要为游戏添加新的结构/实体

## 前置知识

### JSON 结构格式

实体模型 JSON 文件（如 `tank.json`）的结构如下：

```json
{
  "blocks": [
    {
      "x": 0,
      "y": 1,
      "z": 0,
      "type": "stone",
      "direction": 0
    },
    ...
  ]
}
```

每个方块对象的属性：
- `x`, `y`, `z`: 方块在实体局部坐标系中的位置（整数）
- `type`: 方块类型，必须是 `src/constants/BlockData.js` 中定义的方块
- `direction`: 方块的朝向/旋转（0-3，通常设为 0）

### 可用方块类型

从 `src/constants/BlockData.js` 中获取所有可用方块，主要包括：

**基础方块**：
- `stone`, `dirt`, `grass`, `sand`, `cobblestone`, `bricks`, `planks`, `wood`
- `oak_planks`, `dark_planks`, `white_planks`, `blue_planks`, `green_planks`
- `iron`, `gold_block`, `diamond`, `emerald`, `obsidian`

**特殊方块**：
- `glass_block`, `leaves`, `log`, `chest`, `tnt`
- `flower`, `short_grass`, `cactus`, `lilypad`, `vine`
- `water`, `lava`, `cloud`, `ice`, `snow`

**装饰方块**：
- `allium`, `azure_bluet`, `dead_bush`, `oxeye_daisy`, `red_mushroom`
- `chimney`, `handrail`, `vertical_pillar`, `horizontal_pillar`

除了这些方块之外，在 `src/constants/BlockData.js` 可能还有其他更多方块类型，也请你一并考虑。

## 执行流程

### 步骤 1: 分析示例图

1. 使用 `Read` 工具读取用户上传的示例图
2. 分析实体的：
   - 整体尺寸（长、宽、高）
   - 结构组成（主体、炮塔、轮子等部件）
   - 颜色/材质分布
   - 对称性（如果有对称结构可以复用坐标）

### 步骤 2: 规划方块布局

1. 确定实体的中心点（通常设为 x=0, z=0）
2. 确定底部 Y 坐标（通常从 y=1 开始）
3. 根据示例图逐层规划每个方块的位置
4. 记录每个方块的 (x, y, z, type)

### 步骤 3: 生成 JSON 文件

1. 在 `src/world/structures/` 目录下创建新的 JSON 文件
2. 文件名格式：`<entity_name>.json`（使用小写字母和下划线）
3. 写入 `blocks` 数组

### 步骤 4: 注册结构加载器

1. 打开 `src/world/entity-system/StructureLoader.js`
2. 在 `structureLoaders` 对象中添加新的加载器：
   ```javascript
   export const structureLoaders = {
     // ... 现有的加载器
     yourEntity: new StructureLoader('your_entity', new URL('../structures/your_entity.json', moduleBase).href),
   };
   ```
3. 在 `preloadAllStructures()` 函数中添加预加载调用

### 步骤 5: 注册实体定义

1. 打开 `src/world/entity-system/EntityManager.js`
2. 在 `initStructures()`（或其他合适的方法）中添加实体注册：
   ```javascript
   this.register('your_entity', new JsonEntity({
     id: 'your_entity',
     biomes: ['PLAINS'],  // 指定生成群系
     probability: 0.0001,  // 生成概率
     condition: (wx, wy, wz, biome, seed) => {
       // 可选的额外生成条件
       return true;
     },
     loader: null,  // 将在 initSpecial 中设置
     crossChunkDist: 8,  // 跨 Chunk 渲染距离
     categories: ['structure', 'vehicle']  // 实体分类
   }));
   ```
3. 在 `initSpecial()` 方法中设置 loader：
   ```javascript
   this.setLoader('your_entity', structureLoaders.yourEntity);
   ```

### 步骤 6: 询问用户生成条件（如不清楚）

如果用户没有指定实体的生成条件，需要询问以下问题：

1. **生成群系**：实体应该在哪些生物群系生成？
   - `PLAINS`（平原）
   - `FOREST`（森林）
   - `DESERT`（沙漠）
   - `SWAMP`（沼泽）
   - `OCEAN`（海洋）
   - `AZALEA`（杜鹃花群系）
   - 或 `[]` 表示不在任何群系自然生成（需要特殊调用）

2. **生成概率**：实体的基础生成概率是多少？
   - `0.0001`：非常稀有（约万分之一）
   - `0.001`：稀有（约千分之一）
   - `0.01`：常见（约百分之一）
   - `0`：不自然生成（用于云、天空岛等特殊实体）

3. **特殊条件**：是否有额外的生成条件？
   - 只在特定高度生成
   - 只在水面上生成
   - 只在特定地形生成
   - 使用确定性随机分布

4. **渲染距离**：实体需要多远的跨 Chunk 渲染距离？
   - 小型实体（如坦克）：`3`
   - 中型实体（如房屋）：`8`
   - 大型实体（如丑陋小屋）：`24` 或更大

## 示例：创建坦克实体

以下是 `tank.json` 的简化示例：

```json
{
  "blocks": [
    {"x": -2, "y": 1, "z": -2, "type": "iron", "direction": 0},
    {"x": -1, "y": 1, "z": -2, "type": "iron", "direction": 0},
    {"x": 0, "y": 1, "z": -2, "type": "iron", "direction": 0},
    {"x": 1, "y": 1, "z": -2, "type": "iron", "direction": 0},
    {"x": 2, "y": 1, "z": -2, "type": "iron", "direction": 0},
    {"x": 0, "y": 2, "z": 0, "type": "diamond", "direction": 0},
    {"x": 0, "y": 3, "z": 1, "type": "obsidian", "direction": 0}
  ]
}
```

## 用户输入处理

### 当用户上传单张图片时

1. 读取并分析图片内容
2. 识别实体的结构和材质
3. 询问用户是否需要确认或调整生成条件

### 当用户上传多张图片时

1. 读取所有图片
2. 综合多张图片理解实体的完整 3D 结构
3. 可能需要从不同角度（正视、侧视、俯视）来推断 3D 坐标

## 输出格式

完成后的输出应包含：

1. **已创建的文件**：JSON 文件路径
2. **已修改的文件**：
   - `StructureLoader.js` - 添加了结构加载器
   - `EntityManager.js` - 添加了实体注册
3. **实体配置**：
   - 实体 ID
   - 生成群系
   - 生成概率
   - 渲染距离
4. **后续步骤**：
   - 如何测试新实体
   - 如何调整生成条件

## 检查清单

在声明完成前，请确认：

- [ ] JSON 文件已创建在 `src/world/structures/` 目录
- [ ] JSON 格式正确（有效的 JSON，包含 `blocks` 数组）
- [ ] 所有方块类型都存在于 `BlockData.js` 中
- [ ] `StructureLoader.js` 中已注册加载器
- [ ] `preloadAllStructures()` 中已添加预加载
- [ ] `EntityManager.js` 中已注册实体定义
- [ ] `initSpecial()` 中已设置 loader
- [ ] 运行了 `npm run lint` 检查代码规范

## 故障排除

### 实体不显示

1. 检查 JSON 文件路径是否正确
2. 检查 `StructureLoader` 是否正确设置
3. 检查实体的 `biomes` 是否与当前群系匹配
4. 检查 `probability` 是否大于 0
5. 尝试调整 `crossChunkDist` 为更大的值

### JSON 加载失败

1. 检查 JSON 语法是否正确
2. 检查 `type` 字段是否是有效的方块类型
3. 检查 `direction` 字段是否存在（即使设为 0）

### 性能问题

1. 减少方块数量（使用更简洁的结构）
2. 适当调整 `crossChunkDist`
3. 考虑使用程序化生成（`CodeEntity`）代替 JSON 加载

## 参考文件

- `src/world/structures/tank.json` - 坦克实体示例
- `src/world/structures/tower.json` - 炮塔实体示例
- `src/world/entity-system/StructureLoader.js` - 结构加载器
- `src/world/entity-system/JsonEntity.js` - JSON 实体类
- `src/world/entity-system/EntityManager.js` - 实体管理器
- `src/constants/BlockData.js` - 方块数据定义
