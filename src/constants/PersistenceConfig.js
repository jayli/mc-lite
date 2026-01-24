// src/constants/PersistenceConfig.js
/**
 * 持久化配置常量
 */
export const PERSISTENCE_CONFIG = {
  DB_NAME: 'mc_lite_persistence',
  DB_VERSION: 1,
  STORE_NAME: 'world_deltas',
  // 区块尺寸
  CHUNK_SIZE: 16,
  // 会话重置标记（如果需要跨会话，改为 false）
  SESSION_ONLY: true,
  // 缓存清理阈值（区块数）
  CACHE_LIMIT: 100
};
