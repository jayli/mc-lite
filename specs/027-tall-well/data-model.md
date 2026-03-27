# Data Model: Tall Well 结构生成

**Feature**: 027-tall-well
**Date**: 2026-03-27

## Overview

Tall Well 是一个基于 JSON 数据驱动的静态结构，在 City 地图中作为装饰性建筑生成。

## Entities

### Entity: TallWell Structure

**Description**: 从 tall_well.json 加载的静态方块结构

**Attributes**:

| 属性 | 类型 | 描述 |
|------|------|------|
| name | string | 结构名称，固定为 "tall_well" |
| blocks | Array<Block> | 方块定义数组，包含坐标和类型 |
| footprint | Object | 底部占用区域，用于碰撞检测 |

**Block Definition**:

| 字段 | 类型 | 描述 |
|------|------|------|
| x | number | 相对中心 X 偏移 |
| y | number | 相对中心 Y 偏移 |
| z | number | 相对中心 Z 偏移 |
| type | string | 方块类型名称 |
| direction | number | 方向 (0-3) |

### Entity: TallWell Footprint

**Description**: 结构的底部投影区域，用于避免与其他结构重叠

**Attributes**:

| 属性 | 类型 | 描述 |
|------|------|------|
| minX | number | 最小 X 偏移 |
| maxX | number | 最大 X 偏移 |
| minZ | number | 最小 Z 偏移 |
| maxZ | number | 最大 Z 偏移 |
| halfX | number | X 方向半宽（用于距离检查） |
| halfZ | number | Z 方向半宽（用于距离检查） |

**Validation Rules**:

- footprint 必须从 blocks 数据中自动计算
- minX <= maxX, minZ <= maxZ
- halfX = ceil(max(|minX|, |maxX|))
- halfZ = ceil(max(|minZ|, |maxZ|))

### Entity: TallWell Placement

**Description**: 生成时的放置位置信息

**Attributes**:

| 属性 | 类型 | 描述 |
|------|------|------|
| centerX | number | 世界坐标 X |
| centerY | number | 世界坐标 Y（地面高度） |
| centerZ | number | 世界坐标 Z |
| reserved | boolean | 是否已预留占用 |
| generated | boolean | 是否已生成 |

## Relationships

```
TallWell Structure --(has)--> Blocks[]
TallWell Structure --(has)--> Footprint
TallWell Placement --(references)--> TallWell Structure
City Map --(contains)--> TallWell Placement[]
```

## State Transitions

Tall Well 的生成状态流转：

```
[Candidate] -> [Validated] -> [Reserved] -> [Queued] -> [Generated]
     |             |              |            |            |
     |             |              |            |            |
   候选位置    通过可用性     预留占用    加入生成     方块放置
   识别         检查          单元格       队列         完成
```

**状态说明**:

- **Candidate**: 从 City 核心区识别出的候选位置
- **Validated**: 通过 canPlaceCityTallWell 检查（不靠近其他建筑、空间清空）
- **Reserved**: 调用 reserveTallWellFootprint 预留 footprint 单元格
- **Queued**: 调用 createStructureTask 加入生成队列
- **Generated**: 调用 generateTallWell 完成方块放置

## Generation Configuration

| 常量 | 值 | 描述 |
|------|-----|------|
| CITY_TALL_WELL_CHANCE | CITY_FLOWER_BED_CHANCE * 6 | 生成概率，与 pavilion 相同 |
| FALLBACK_SEED_OFFSET | 826 | 兜底机制的随机种子偏移 |

## Collision Avoidance

Tall Well 需要检查与以下结构的距离：

- 主要建筑 (City major structures)
- Filler houses
- Flower beds
- Trees (普通、高、沼泽、黄叶、birch)
- Pavilion (关键：必须检查 pavilion 的 footprint 占用)

**距离阈值**:

基于 tallWellHalfX/tallWellHalfZ + buffer:
- 主要建筑: +1
- Filler house: +3
- Flower bed: +5
- Tree: +4/+5

## Quickstart

**生成流程**:

1. StructureLoader.js 注册 tall_well 加载器
2. WorldWorker.js 预加载 tall_well.json
3. City 生成阶段：
   - 识别候选位置
   - 检查是否可放置（检查与其他结构的距离、空间清空）
   - 预留 footprint 单元格
   - 加入生成队列
4. 生成阶段：从 JSON 数据放置方块

**关键函数** (WorldWorker.js):

- `getLoaderBottomFootprint(tallWell)` - 计算 footprint
- `isTallWellFootprintReserved(centerX, centerZ)` - 检查是否已预留
- `reserveTallWellFootprint(centerX, centerZ)` - 预留占用
- `isTallWellSpaceClear(centerX, centerY, centerZ)` - 检查空间清空
- `canPlaceCityTallWell(centerX, centerY, centerZ)` - 综合判断
- `queueCityTallWell(centerX, centerY, centerZ)` - 加入队列
- `generateTallWell(x, y, z, chunk, dObj)` - 执行生成
