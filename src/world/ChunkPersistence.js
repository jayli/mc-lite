/**
 * Chunk持久化模块
 * 负责区块数据的保存和加载等功能
 */
import { persistenceService } from '../services/PersistenceService.js';

// --- 依赖注入：允许测试环境通过 globalThis 覆盖 ---
const getPersistenceService = () => globalThis._persistenceService || persistenceService;

export function extendChunk(Chunk) {
  /**
   * 防抖保存区块数据
   */
  Chunk.prototype.saveDebounced = function() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      getPersistenceService().saveChunkData(this.cx, this.cz);
      this.saveTimeout = null;
    }, 500);
  };
}
