# RealisticTree 移除与黄叶子树替代设计

## 背景
RealisticTree 使用 InstancedMesh + RealisticTreeManager 的特殊实体管理方式，管理复杂度高。当前在森林 biome 中 15% 概率生成 RealisticTree，决定将其替换为普通的黄叶子方块树。

## 改动范围

### 删除
1. `src/world/entities/RealisticTree.js` — 整文件
2. `src/world/entity-system/RealisticTreeManager.js` — 整文件

### 修改
| 文件 | 改动 |
|------|------|
| `EntityManager.js` | 删除 `tree_realistic` 注册 |
| `Chunk.js` | 删除 `assembleEntityPhase` 中 RealisticTree 逻辑、`_handleRealisticTreeRemoval`、相关 import |
| `BlockScatterManager.js` | 删除 `scatterEntities` 中 `realisticTrees` 分发 |
| `WorldWorker.js` | `realisticTrees.push()` → `createStructureTask(generateYellowTree)`；清理 snapshot 相关字段 |
| `Game.js` | 删除 `realisticTreeManager.init()` |
| `ChunkConsolidation.js` | snapshot 中清理 `realisticTrees` 字段 |
| `PlayerInteraction.js` | 删除 `realistic_trunk_collider` 碰撞判断 |
| `Physics.js` | 删除 `realistic_trunk_collider` 碰撞判断 |
| `World.js` | 清理 `realisticTrees` 相关引用 |
| 测试文件 | 清理相关 mock |

### 新增
`WorldWorker.js` 中新增 `generateYellowTree` 函数，生成黄叶子方块树（类似 tree_big 风格）。

## 实现策略
将 WorldWorker 中原本 `realisticTrees.push({ x, y, z })` 的位置，改为调用 `createStructureTask` 生成黄叶子树。黄叶子树使用方块堆叠方式（trunk + yellow_leaves），与 `tree_big` 一致。
