# Internal Service Contracts: PersistenceService

## Interface Definition

```javascript
/**
 * PersistenceService - 负责地图增量修改的存储与检索
 */
class PersistenceService {
  /**
   * 初始化数据库 (异步)
   */
  async init() {}

  /**
   * 获取指定区块的增量修改数据
   * @param {number} cx - 区块X坐标
   * @param {number} cz - 区块Z坐标
   * @returns {Promise<Map<string, object>>} 返回 blockKey -> {type} 的映射
   */
  async getDeltas(cx, cz) {}

  /**
   * 记录一个方块的变更 (内存缓存)
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {number} z - 世界坐标Z
   * @param {string} type - 方块类型 ('air' 表示删除)
   */
  recordChange(x, y, z, type) {}

  /**
   * 将缓存中的区块数据持久化到 IndexedDB
   * @param {number} cx - 区块X坐标
   * @param {number} cz - 区块Z坐标
   */
  async flush(cx, cz) {}

  /**
   * 清空所有会话数据 (用于页面刷新或重置)
   */
  async clearSession() {}
}
```

## Integration Hooks

### Hook 1: Chunk Generation
**File**: `src/world/Chunk.js`
**Function**: `gen()`
**Usage**: 在遍历 16x16 网格前调用 `getDeltas`。

### Hook 2: Block Modification
**File**: `src/world/Chunk.js`
**Function**: `addBlockDynamic`, `removeBlock`
**Usage**: 调用 `recordChange` 同步到持久化缓存。

### Hook 3: Chunk Unloading
**File**: `src/world/World.js`
**Function**: `update()` (unload section)
**Usage**: 在 `chunk.dispose()` 之前调用 `persistenceService.flush()`。
