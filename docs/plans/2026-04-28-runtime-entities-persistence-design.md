# Runtime Entities Persistence Design

**日期**: 2026-04-28
**状态**: 待实现
**范围**: turret、minecart、zombieNest 三类交互实体的 WorldStore 持久化

## 背景

当前项目中 turret、minecart、zombieNest 三类交互实体的持久化走的是旧的 `persistenceService.cache` 路径。在 WorldStore（RegionRecord）架构引入后，这些实体的数据没有正确写入新的权威数据源，导致 chunk 销毁/重新加载时实体可能丢失。

## 目标

将三类交互实体的持久化迁移到 WorldStore 的 `RegionRecord.runtimeEntities` 字段，确保：
1. 实体创建/销毁时正确写入 IndexedDB
2. Chunk 加载时从 WorldStore 读取并恢复实体实例
3. 只持久化基础属性（位置+朝向），不保存运行时计数或速度

## 数据格式

### RegionRecord 结构

```
RegionRecord
└── chunks
    └── "cx,cz"
        ├── blockData: { ... }
        ├── staticEntities: [ ... ]          // 静态模型（树、建筑等）
        ├── runtimeEntities: {               // 运行时交互实体（新增）
        │     turrets: [
        │       { position: { x, y, z }, rotation: number }
        │     ],
        │     minecarts: [
        │       { position: { x, y, z }, direction: number }
        │     ],
        │     zombieNests: [
        │       { position: { x, y, z }, criticalBlock: { x, y, z, type } }
        │     ]
        │   }
        └── runtimeSeedData: { ... }
```

### 各实体字段说明

| 实体类型 | 字段 | 说明 |
|---------|------|------|
| turret | `position` | 方块坐标（取整） |
| | `rotation` | 炮塔当前旋转角度（弧度） |
| minecart | `id` | 矿车唯一标识符（用于跨 chunk 去重） |
| | `position` | 矿车当前位置 |
| | `direction` | 矿车朝向方向 |
| zombieNest | `position` | 巢穴位置 |
| | `criticalBlock` | 关键方块位置和类型 |

## 架构设计

### 写入路径

```
实体创建/销毁
    ↓
Manager.saveXxxToSnapshot() / removeXxxFromSnapshot()
    ↓
worldStore.putChunkRecord(cx, cz, chunkRecord)
    ↓
PersistenceWorker: 读 RegionRecord → 修改 chunk → 写回 RegionRecord
```

- 各 Manager 的写入方法改为调用 `worldStore.putChunkRecord()` 替代 `persistenceService.saveChunkData()`
- `putChunkRecord` 是异步操作，不阻塞主线程

### 读取路径

```
Chunk 加载
    ↓
Chunk._createFromWorldStore()
    ↓
读取 chunkRecord.runtimeEntities → pendingRuntimeEntities
    ↓
finalizeNonDeferredPhase()
    ↓
各 Manager.restoreXxxForChunk() 重建实体实例
```

- 现有 `finalizeNonDeferredPhase()` 中已有从 `pendingRuntimeEntities` 恢复的逻辑
- 只需要确保 `_createFromWorldStore()` 正确填充该字段
- 移除对旧 `persistenceService.cache` 的 fallback 读取

## 边界情况处理

1. **矿车跨 chunk 移动**：从旧 chunk 移除 + 添加到新 chunk，两个 `putChunkRecord` 不原子。由于矿车已有稳定 `id`，恢复阶段在 `MinecartManager.restoreMinecartsForChunk()` 中按 `id` 全局去重（`this.minecarts.has(item.id)`），同一矿车不会重复实例化。
2. **数据格式版本**：预留 `runtimeEntities.version` 字段，未来扩展时使用。
3. **RegionRecord 不存在**：写入前检查 region 是否存在，不存在则跳过并 warn。

## 改动文件清单

| 文件 | 改动内容 |
|------|---------|
| `src/world/WorldStore.js` | `getChunkRecord`/`putChunkRecord` 支持 `runtimeEntities` 字段 |
| `src/world/Chunk.js` | `_createFromWorldStore()` 读取 `runtimeEntities`，移除旧 cache fallback |
| `src/actors/turret/TurretManager.js` | 写入路径改为 worldStore |
| `src/actors/minecart/MinecartManager.js` | 写入路径改为 worldStore |
| `src/actors/zombie-nest/ZombieNestManager.js` | 写入路径改为 worldStore |

## 后续工作（不在本次范围）

- chest（宝箱）和 lightSource（光源）的持久化
- 实体运行时状态的完整持久化（速度、刷怪计数等）
