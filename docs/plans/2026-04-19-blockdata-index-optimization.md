# blockData 索引优化设计文档

**日期**: 2026-04-19
**目标**: 将 `chunk.blockData` 从字符串 key (`"x,y,z"`) 改为数字编码 key (`Map<number, entry>`)，消除 Chunk 卸载和方块查询时大量 `split(',')` / 模板字符串操作带来的 GC 压力。

## 问题陈述

当前 `chunk.blockData` 使用字符串 `"x,y,z"` 作为 Map/Object 的 key：
- 每次查询需要 `key.split(',').map(Number)` 解析坐标
- 每次写入需要模板字符串 `` `${x},${y},${z}` `` 创建字符串
- Chunk 卸载时需要逐方块创建临时对象（Matrix4、Vector3、字符串），导致大量 GC 压力
- 14 个文件、50+ 处直接 `blockData[key]` 访问

## 设计方案

### 核心数据结构变更

**变更前：**
```js
this.blockData = {};           // { "x,y,z": entry }
this.solidBlocks = new Set();  // Set<string> "x,y,z"
this.visibleKeys = new Set();  // Set<string> "x,y,z"
```

**变更后：**
```js
this.blockData = new Map();    // Map<number, entry>
this.solidBlocks = new Set();  // Set<number>
this.visibleKeys = new Set();  // Set<number>
```

### 坐标编码

世界坐标始终非负，使用位运算编码/解码：
```js
// x: 0~4095 (12bit), y: 0~63 (6bit), z: 0~4095 (12bit) = 30bit
static encodeCoord(x, y, z) {
  return (x << 12) | (y << 6) | z;
}
static decodeCoord(code) {
  return { x: (code >> 12) & 0xFFF, y: (code >> 6) & 0x3F, z: code & 0x3F };
}
```

### 公共 API 统一

- `getBlockEntry(x, y, z)` — 已有，保持不变
- `setBlockEntry(x, y, z, entry)` — 新增，统一写入入口
- `removeBlockEntry(x, y, z)` — 新增，统一删除入口

所有外部消费者统一通过方法访问，内部直接操作 Map。

### Worker 数据传递

主线程将 Map 编码为紧凑数组传递给 Worker：
```js
// 主线程
const entries = [];
for (const [code, entry] of this.blockData) {
  entries.push({ code, entry });
}
aoWorker.postMessage({ entries, neighborEntries, positions, requestId });

// Worker 侧
const blockDataMap = new Map();
for (const { code, entry } of entries) {
  blockDataMap.set(code, entry);
}
const entry = blockDataMap.get(encodeCoord(x, y, z));
```

### 持久化兼容层

序列化时保持 `{ "x,y,z": entry }` 格式不变，只在内存中使用 Map：
- save 时：`Map → { "x,y,z": entry }`
- load 时：`{ "x,y,z": entry } → Map`

## 影响范围

| 层级 | 文件 | 改动类型 |
|------|------|----------|
| 核心 | `Chunk.js` | 数据结构变更 + 所有内部方法改造 |
| 世界层 | `World.js` | resolveBlockOwner/isSolid/getAllBlockOwners |
| 渲染层 | `ChunkConsolidation.js` | 读取路径改造 |
| 渲染层 | `ChunkRenderUtils.js` | 读取路径改造 |
| 渲染层 | `ChunkMeshDataFilter.js` | 遍历方式改造 |
| 工具层 | `AOUtils.js` | 查询函数改造 |
| 工具层 | `FaceCullingCore.js` | 查询函数改造 |
| 工具层 | `FaceCullingSystem.js` | 查询函数改造 |
| 工具层 | `ChunkNeighborUtils.js` | 查询函数改造 |
| Worker | `AOWorker.js` | 接收格式改为编码数组 |
| Worker | `FaceCullingWorker.js` | 接收格式改为编码数组 |
| 服务层 | `PlaygroundService.js` | 遍历方式改造 |
| 实体 | `RealisticTree.js` | 写入方式改造 |
| 测试 | `test-chunk.js` | 断言方式改造 |
| 测试 | `test-world.js` | 断言方式改造 |

## 保留不变

- `blockDataArray` (Uint32Array[4096]) — 高速紧凑存储，服务 Y:0~15 范围
- `solidBlockIds` (Set<number>) — 服务 blockDataArray 的实心方块快速查询
- `blockPalette` / `blockPaletteReverse` — blockId 映射系统
- `entityCollisionIndex` — 特殊实体碰撞占位
- 持久化存储格式（IndexedDB 中保持字符串 key 格式）
