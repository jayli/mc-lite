# Research: 地图持久化技术方案 (World Persistence)

## Decision: 采用增量式内存缓存 + IndexedDB 异步持久化

为了在 60FPS 的游戏环境中实现高效的地图持久化，同时满足“会话内持久”的需求，我们决定采用以下技术方案。

### 1. 存储技术选择：IndexedDB

- **理由**: IndexedDB 是浏览器原生支持的对象存储数据库，容量远超 LocalStorage（通常可达磁盘可用空间的 80%），且支持异步操作，不会阻塞主线程（Render Loop）。
- **备选方案**: LocalStorage。由于 LocalStorage 是同步 IO 且容量受限（约 5MB），在高频率修改或大范围地图探索时会导致明显的掉帧（Stutter）。
- **数据结构**:
  - 数据库名: `MinecraftLiteDB`
  - 存储空间 (Object Store): `WorldDeltas`
  - 主键 (Key): `cx,cz` (区块坐标字符串)
  - 值 (Value): `Map<blockKey, {type, action}>` 或 `Array<{x,y,z,type}>`

### 2. 内存缓存层 (Memory Cache)

- **设计**: 在 `PersistenceService` 中维护一个 `Map<chunkKey, DeltaData>`。
- **作用**:
  - **Read-ahead**: 区块加载时先从 IndexedDB 读取并放入缓存。
  - **Write-buffer**: 玩家修改方块时先更新缓存，在区块卸载（Dispose）时或定时批量写入 IndexedDB。
- **性能**: 内存读写为 O(1)，确保玩家挖掘/放置方块时完全无感知。

### 3. 代码集成点

#### A. 核心服务：`src/services/PersistenceService.js` (New)
- 负责 IndexedDB 的初始化、读写操作。
- 提供 `getDeltas(cx, cz)` 和 `saveDeltas(cx, cz, deltas)` 接口。

#### B. 数据注入：`src/world/Chunk.js`
- 在 `gen()` 方法中，在 `terrainGen` 之后调用 `persistenceService.getDeltas()`。
- 将增量修改叠加到 `d` 对象（用于构建网格）和 `solidBlocks`（用于碰撞）。
- 修改 `addBlockDynamic` 和 `removeBlock` 以记录修改到缓存。

#### C. 数据持久化触发：`src/world/World.js`
- 在 `unload old chunks` 逻辑中，调用 `persistenceService.saveDeltas()` 确保数据写入。

### 4. 关键发现 (Codebase Analysis)
- `solidBlocks` 在 `Chunk.js:239` (生成时) 和 `Chunk.js:406` (动态添加) 中被更新。
- 区块销毁在 `World.js:50` 的 `chunk.dispose()` 中执行。
- `Chunk.js:105 (gen)` 是应用持久化数据的最佳时机，此时方块位置正在被收集到 `d` 对象中。

## Rationale
- **异步 IO**: IndexedDB 确保了存取过程不影响帧率。
- **最小化存储**: 只存储修改（Deltas），符合 YAGNI 原则且节省空间。
- **解耦**: 独立的 Service 易于单元测试和后续扩展（如将来需要跨浏览器会话保存）。

## Alternatives Considered
- **存储全量区块数据**: 被否决。不仅浪费存储空间，且与程序化生成逻辑冲突，导致文件体积激增。
- **逐块即时写入**: 被否决。虽然 IndexedDB 是异步的，但过高频率的 API 调用仍有开销，批量处理更优。
