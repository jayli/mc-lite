# Quickstart: 地图持久化实现指南

## 核心实现步骤

### 1. 创建 PersistenceService
在 `src/services/PersistenceService.js` 中实现基于 IndexedDB 的存储逻辑。
- 使用 `idb` 风格的包装或原生 API。
- 实现内存缓存以保证 60FPS 下的流畅度。

### 2. 配置 PersistenceConfig
在 `src/constants/PersistenceConfig.js` 中定义数据库名称、版本和存储限制。

### 3. 修改 Chunk.js 接入数据
- **构造函数**: 传入 `persistenceService` 实例。
- **gen()**: 异步获取 Deltas，在构建 `d` 对象时应用覆盖逻辑。
- **addBlockDynamic/removeBlock**: 调用 Service 记录变更。

### 4. 修改 World.js 管理生命周期
- 在 `World` 构造函数中初始化 `PersistenceService`。
- 在卸载区块循环中调用 `flush()`。

## 验证方法

1. **挖掘测试**: 在 (0, 0, 0) 挖掘方块 -> 移动超过 64 单位 (R=3+1) -> 返回 (0, 0, 0) -> 方块仍处于挖掘后的状态。
2. **放置测试**: 在任意位置放置方块 -> 离开并返回 -> 方块存在。
3. **性能监控**: 使用 Chrome DevTools Performance 面板检查在移动过程中是否有 `put` 操作引起的 Long Task（应通过异步处理避免）。
