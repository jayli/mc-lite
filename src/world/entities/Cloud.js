// src/world/entities/Cloud.js
// 云生成模块
// 提供云方块的生成功能

/**
 * 云生成器类
 * 提供静态方法用于生成云方块
 */
export class Cloud {
  /**
   * 在指定位置生成云方块
   * @param {number} x - X坐标
   * @param {number} y - Y坐标
   * @param {number} z - Z坐标
   * @param {Chunk} chunk - 目标区块对象
   * @param {Object} [dObj=null] - 可选的数据对象
   */
  static generate(x, y, z, chunk, dObj = null) {
    chunk.add(x, y, z, 'cloud', dObj);
  }

  /**
   * 生成一簇紧密相连的云朵
   * @param {number} startX - 起始世界坐标X
   * @param {number} y - 云层高度Y
   * @param {number} startZ - 起始世界坐标Z
   * @param {number} size - 方块数量 (20-40)
   * @param {Chunk} chunk - 当前区块对象
   * @param {Object} dObj - 数据对象
   */
  static generateCluster(startX, y, startZ, size, chunk, dObj) {
    const cloudBlocks = new Set();
    const frontier = [[startX, startZ]];
    const key = (x, z) => `${x},${z}`;

    while (cloudBlocks.size < size && frontier.length > 0) {
      // 随机选择一个边缘位置进行扩展，确保紧密相连
      const idx = Math.floor(Math.random() * frontier.length);
      const [cx, cz] = frontier.splice(idx, 1)[0];
      const k = key(cx, cz);

      if (!cloudBlocks.has(k)) {
        cloudBlocks.add(k);
        this.generate(cx, y, cz, chunk, dObj);

        // 将相邻的 4 个位置加入边缘列表
        const neighbors = [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]];
        for (const [nx, nz] of neighbors) {
          if (!cloudBlocks.has(key(nx, nz))) {
            frontier.push([nx, nz]);
          }
        }
      }
    }
  }
}
