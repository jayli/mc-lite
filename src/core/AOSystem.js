// src/core/AOSystem.js
// 已废弃：AO 计算已迁移到专用 AOWorker (src/workers/AOWorker.js)
// 脏集管理由 Chunk.dirtyAOPositions 处理
// 保留文件以避免潜在的 import 错误，将在后续版本完全移除
export class AOSystem {
  constructor() {
    console.warn('AOSystem is deprecated. AO computation is now handled by AOWorker.');
  }
}
