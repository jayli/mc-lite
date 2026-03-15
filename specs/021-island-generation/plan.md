# Implementation Plan: Island Generation

**Branch**: `021-island-generation` | **Date**: 2026-03-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-island-generation/spec.md`

## Summary

实现海岛生成功能，作为独立的 Map 类型生成器。海岛大小约 30x30 格，四周环海，与大陆距离 20 格。表面由 sand 和 stone 方块分片聚集分布，随机生成 1-2 棵橡树。玩家有几率在海岛附近出生。实现方式参考现有的 FrozenMountain 和 Pyramid 地图生成器。

## Technical Context

**Language/Version**: JavaScript (ES6+ Modules)
**Primary Dependencies**: Three.js (渲染引擎)
**Storage**: IndexedDB (通过 PersistenceService 存档)
**Testing**: 浏览器端测试 (tests/index.html)
**Target Platform**: 现代 Web 浏览器 (支持 WebGL 2.0)
**Project Type**: 3D 体素游戏 (Minecraft 克隆)
**Performance Goals**: 60 fps 目标，区块生成不卡顿
**Constraints**: 严格内存管理，视距外区块自动销毁
**Scale/Scope**: 每 400x400 区域生成一座海岛，生成概率约 8%

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法原则 | 状态 | 说明 |
|---------|------|------|
| I. 面向对象与逻辑分层 | ✅ 通过 | 海岛生成器作为独立模块 (`src/workers/maps/IslandMap.js`)，与 WorldWorker 解耦 |
| II. 内存效率与 GC | ✅ 通过 | 使用 Worker 异步生成，避免阻塞主线程；方块数据复用现有模式 |
| III. 主动资源释放 | ✅ 通过 | 海岛区块遵循标准区块销毁逻辑，视距外自动销毁 |
| IV. WebGL/Three.js 优化 | ✅ 通过 | 使用 InstancedMesh 渲染，复用现有 Chunk 合并机制 |
| V. 简洁性与核心机制 | ✅ 通过 | 复用现有地图生成模式 (FrozenMountain/Pyramid)，不引入新技术 |
| VI. 资源管理 | ✅ 通过 | 不使用外部模型资源，方块纹理使用现有资源 |

**技术约束检查**:
- ✅ 运行时环境：现代浏览器，WebGL 2.0
- ✅ 核心引擎：Three.js，复用现有渲染管线
- ✅ 内存管理：海岛区块大小固定 (30x30)，内存可控

**开发流程检查**:
- ✅ 海岛生成在 Worker 中执行，不阻塞主线程
- ✅ 方块数据通过 blockMap 管理，复用现有 Consolidation 机制

## Project Structure

### Documentation (this feature)

```text
specs/021-island-generation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (if needed)
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── workers/
│   ├── maps/
│   │   └── IslandMap.js           # 海岛生成器 (新增)
│   └── WorldWorker.js             # 修改：集成海岛生成
├── world/
│   └── entities/
│       └── Island.js              # 现有天空岛，保持不变
└── core/
    └── Game.js                    # 修改：玩家出生点逻辑
```

**Structure Decision**: 项目采用单项目结构，海岛生成作为地图生成模块添加到 `src/workers/maps/` 目录。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

无违反项，所有宪法原则均已通过检查。

## Phase 0: Research & Discovery

### Research Tasks

1. **分析现有地图生成器模式** ✅
2. **研究海岛形状生成算法** ✅
3. **研究方块分布算法** ✅
4. **研究玩家出生点逻辑** ✅

### Research Findings

#### 1. 现有地图生成器模式分析

通过研究 `FrozenMountain.js`、`Pyramid.js` 和 `SnowLand.js`，总结以下共同模式：

**模块结构**:
- 每个地图类型是一个独立的模块，导出两个核心函数：
  - `getXxxInfo(wx, wz, seed, terrainGen)`: 判断坐标是否在地图范围内，返回地图信息
  - `generate(wx, wz, h, xxxInfo, fakeChunk, dPlaceholder)`: 生成具体方块
- 使用统一的导出格式：`export const Xxx = { getXxxInfo, generate: generateXxx }`

**区域划分**:
- 每 400x400 区域生成一个地图结构
- 使用确定性随机函数根据种子和区域坐标计算结构中心点
- 主体区域 (core) 和过渡带 (transition) 分离
- 过渡带使用 `transitionFactor` (0-1) 进行平滑混合

**高度处理**:
- 基础高度来自 `terrainGen.generateHeight()`
- 使用噪声函数生成自然起伏
- 限制与原地形的最大高差（通常 2 格）

**方块生成**:
- 使用 `fakeChunk.add()` 方法添加方块
- 地表方块根据生物群系或地图类型选择
- 地下填充多层方块（dirt, stone, end_stone）

#### 2. 海岛形状生成算法

**推荐方案**: 使用两层噪声生成不规则形状

```javascript
// 主噪声：决定海岛主体轮廓
const baseNoise = Math.sin(wx * 0.1 + seed) * Math.cos(wz * 0.1 + seed);

// 细节噪声：添加海岸线不规则性
const detailNoise = Math.sin(wx * 0.2 + seed * 2) * Math.cos(wz * 0.2 + seed * 2) * 0.5;

// 组合：baseNoise > threshold 的区域为陆地
const islandRadius = 15; // 30x30 的一半
const threshold = 0.3 + detailNoise * 0.3; // 动态阈值产生不规则边缘
```

**扁长形支持**:
- 在计算距离时，对 X 或 Z 轴应用拉伸因子
- 例如：`dx * stretchX` 其中 `stretchX = 1.5` 产生东西向拉长

#### 3. 方块分布算法 (分片聚集)

**推荐方案**: 使用 Voronoi 区域 + 噪声扰动

```javascript
// 1. 生成几个种子点
const sandSeeds = [
  {x: 5, z: 5}, {x: -8, z: 3}, ...
];

// 2. 对于每个方块位置，找到最近的种子点
let minDist = Infinity;
for (const seed of sandSeeds) {
  const dist = Math.sqrt((wx - seed.x)**2 + (wz - seed.z)**2);
  minDist = Math.min(minDist, dist);
}

// 3. 根据最近的种子点决定类型
// 同时考虑噪声扰动，使边界更自然
const noise = Math.sin(wx * 0.3) * Math.cos(wz * 0.3) * 0.5;
const blockType = (minDist + noise) < threshold ? 'sand' : 'stone';
```

#### 4. 玩家出生点逻辑

**当前系统**: 玩家出生点由世界生成时的初始位置决定

**修改方案**:
- 在海岛生成时记录中心点和沙滩边缘位置
- 修改 `Game.js` 中的玩家初始生成逻辑
- 当玩家首次生成或重生时，有几率选择海岛作为出生点

### Phase 0 完成状态

- [x] 现有地图生成器模式分析完成
- [x] 海岛形状生成算法确定
- [x] 方块分布算法确定
- [x] 玩家出生点修改方案确定

## Phase 1: Design & Contracts

### Data Model

#### 海岛信息对象 (IslandInfo)

```javascript
{
  centerX: number,        // 海岛中心 X 坐标
  centerZ: number,        // 海岛中心 Z 坐标
  surfaceY: number,       // 地表 Y 坐标
  isBelowSeaLevel: bool,  // 是否在海平面以下
  blockType: 'sand'|'stone', // 当前方块的类型
  transitionFactor: number,  // 过渡因子 (0-1)
  zone: 'core'|'transition'  // 所属区域
}
```

#### 海岛配置参数

| 参数 | 值 | 说明 |
|------|-----|------|
| regionSize | 400 | 每 400x400 区域生成一座海岛 |
| islandSize | 30 | 海岛主体边长 (28-32 浮动) |
| transitionSize | 4 | 过渡带大小 |
| spawnProbability | 0.08 | 生成概率 (8%) |
| minDistanceFromLand | 20 | 与大陆的最小距离 |

### Contracts

#### IslandMap 模块接口

```javascript
// 获取海岛信息
export function getIslandInfo(
  wx: number, wz: number, seed: number, terrainGen: TerrainGen
): IslandInfo | null;

// 生成海岛方块
export function generateIsland(
  wx: number, wz: number, h: number, islandInfo: IslandInfo,
  fakeChunk: Chunk, dPlaceholder: Object
): { surfaceY: number, isBelowSeaLevel: boolean };

// 模块导出
export const IslandMap = {
  getIslandInfo,
  generate: generateIsland
};
```

#### WorldWorker 集成点

在 `WorldWorker.js` 的主生成循环中，添加海岛检查逻辑：

```javascript
// 检查当前坐标是否在海岛范围内
const islandInfo = IslandMap.getIslandInfo(wx, wz, seed, terrainGen);
if (inIsland) {
  IslandMap.generate(wx, wz, h, islandInfo, fakeChunk, dPlaceholder);
}
```

### Quickstart

#### 开发步骤

1. **创建海岛生成器模块**
   ```bash
   # 创建文件
   touch src/workers/maps/IslandMap.js
   ```

2. **实现 getIslandInfo 函数**
   - 计算区域和中心点
   - 判断坐标是否在海岛范围内
   - 返回海岛信息对象

3. **实现 generateIsland 函数**
   - 生成地表方块 (sand/stone)
   - 生成分片聚集分布
   - 生成地下填充层
   - 生成树木

4. **集成到 WorldWorker**
   - 导入 IslandMap 模块
   - 在主生成循环中添加海岛检查

5. **修改玩家出生点**
   - 在 Game.js 中修改初始生成逻辑
   - 添加海岛出生点支持

#### 测试验证

1. 启动开发服务器：`npm run start`
2. 访问 http://localhost:8080
3. 在世界中探索，寻找海岛
4. 验证：
   - 海岛大小约 30x30
   - 四周环海，与大陆距离 20 格
   - sand 和 stone 分片聚集
   - 岛上有 1-2 棵树

## Phase 2: Implementation Tasks

任务列表将在 `/speckit.tasks` 命令执行后生成。

## Phase 3: Testing & Validation

待任务完成后填写。
