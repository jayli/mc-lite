export function extendChunk(Chunk) {
  /**
   * 防抖保存区块数据
   */
  Chunk.prototype.saveDebounced = function() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      const runtime = this.world?.worldRuntime;
      if (runtime?.flushChunk) {
        runtime.flushChunk(this.cx, this.cz).catch((error) => {
          console.warn(`[ChunkPersistence] flushChunk failed for ${this.cx},${this.cz}:`, error);
        });
        this.saveTimeout = null;
        return;
      }

      console.warn(`[ChunkPersistence] Missing worldRuntime for ${this.cx},${this.cz}, skip legacy save path`);
      this.saveTimeout = null;
    }, 500);
  };
}
