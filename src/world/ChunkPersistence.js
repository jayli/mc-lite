export function extendChunk(Chunk) {
  /**
   * @deprecated runtime 自动持久化已退出热路径，authority 由 WorldBlockDataStore 持有。
   * 保留为 no-op shell，仅供未来手动保存/导出入口复用。
   * 不再实际写 IndexedDB / WorldStore。
   */
  Chunk.prototype.saveDebounced = function() {
    // no-op：runtime 正确性不再依赖防抖保存
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
  };
}
