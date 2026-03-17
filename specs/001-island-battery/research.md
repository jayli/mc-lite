# Research: 海岛炮塔实体实现

**Feature**: 海岛炮塔实体 (001-island-battery)
**Date**: 2026-03-17
**Status**: Complete

## 技术调研总结

### 现有架构分析

通过对代码库的分析，发现以下关键技术点：

1. **实体系统架构**
   - `EntityManager` 使用注册模式管理所有实体类型
   - `JsonEntity` 类支持从 JSON 文件加载结构数据
   - `StructureLoader` 负责异步加载和缓存 JSON 结构

2. **Tank 实体实现模式**
   - 在 `StructureLoader.js` 中定义加载器：`tank: new StructureLoader('tank', ...)`
   - 在 `EntityManager.js` 中注册：`this.register('tank', new JsonEntity({...}))`
   - 概率控制：`probability: 0.0001`（PLAINS 生物群系）
   - 跨区块渲染距离：`crossChunkDist: 3`

3. **海岛生成机制**
   - `IslandMap.js` 负责海岛地形生成
   - 海岛中心位置通过 `getIslandCenterInRegion()` 确定性计算
   - 海岛表面高度固定在 `ISLAND_SEA_LEVEL`（海平面）
   - 海岛包含核心区域（石头）和过渡区域（沙滩）

### 决策记录

#### 决策 1: 炮塔生成时机
- **选择**: 在海岛地形生成完成后立即生成
- **理由**: 确保有稳定的地面位置，避免与地形生成冲突
- **实现位置**: `IslandMap.generateIsland()` 或 `WorldWorker` 中海岛生成逻辑后

#### 决策 2: 炮塔位置计算
- **选择**: 使用确定性随机算法，基于世界种子 + 海岛中心坐标
- **理由**: 保证相同种子下位置一致，符合需求 FR-005
- **算法**: `seededRandom(islandCx + offset, islandCz + offset, worldSeed)`

#### 决策 3: 生成范围限制
- **选择**: 仅在石头区域生成，避开沙滩边缘
- **理由**: 符合需求 FR-004，避免炮塔生成在不稳定的地形边缘
- **实现**: 使用距离中心点的距离判断，阈值基于海岛尺寸

#### 决策 4: 与现有实体系统的集成方式
- **选择**: 完全复用现有 JsonEntity + StructureLoader 模式
- **理由**: 与 tank 保持一致，无需创建新的实体类型
- **替代方案考虑**: 直接硬编码生成逻辑（已拒绝，违反 Constitution V）

### 技术约束确认

| 约束项 | 影响 | 处理方式 |
|--------|------|----------|
| 内存效率 (Constitution II) | 低 | 炮塔为静态结构，无运行时对象 |
| 资源释放 (Constitution III) | 低 | 随区块卸载自动销毁 |
| 渲染优化 (Constitution IV) | 低 | 复用现有 InstancedMesh 系统 |
| 简洁性 (Constitution V) | 中 | 仅添加必要注册和生成逻辑 |

### 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 炮塔与地形冲突 | 低 | 在石头区域生成，高度固定在海平面 |
| 小海岛放置困难 | 低 | 设置最小距离阈值，确保有足够空间 |
| 生成性能影响 | 低 | 每个海岛仅生成一次，开销极小 |
| 跨区块渲染问题 | 低 | 设置合适的 crossChunkDist (建议 8) |

### 参考文件

- `src/world/entity-system/StructureLoader.js` - 结构加载器实现
- `src/world/entity-system/EntityManager.js` - 实体管理器实现
- `src/world/entity-system/README_ENTITY_SYSTEM.js` - 实体系统文档
- `src/workers/maps/IslandMap.js` - 海岛生成逻辑
- `src/world/structures/tank.json` - 参考结构格式
- `src/world/structures/battery.json` - 炮塔结构数据
