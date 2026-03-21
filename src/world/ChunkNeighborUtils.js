/**
 * Chunk 邻居采样工具
 * 提供获取单个邻居和六向邻居的通用实现
 */

/**
 * 为指定 Chunk 实例创建邻居查询函数
 * @param {Object} chunk - Chunk 实例
 * @param {Function} formatNeighbor - 邻居条目格式化函数，返回最终邻居对象或 null
 * @returns {{getNeighborBlock: Function, getNeighborsOf: Function}}
 */
export function createChunkNeighborSampler(chunk, formatNeighbor) {
  const getNeighborBlock = (nx, ny, nz) => {
    const cx = Math.floor(nx / 16);
    const cz = Math.floor(nz / 16);
    const targetChunk = (cx === chunk.cx && cz === chunk.cz)
      ? chunk
      : chunk.world.chunks.get(`${cx},${cz}`);

    const key = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;

    // 优先走坐标所属 Chunk，命中成本最低
    if (targetChunk && targetChunk.isReady) {
      const entry = targetChunk.blockData[key];
      if (entry) {
        return formatNeighbor(entry);
      }
    }

    // 回退到 World 级查询，覆盖“跨 Chunk 归属”的结构方块
    // 避免邻居采样把真实方块误判为空气，导致面更新滞后到 consolidate
    if (chunk.world?.getBlockEntry) {
      const worldEntry = chunk.world.getBlockEntry(nx, ny, nz);
      if (worldEntry) {
        return formatNeighbor(worldEntry);
      }
    }

    return null;
  };

  const getNeighborsOf = (nx, ny, nz) => ({
    top: getNeighborBlock(nx, ny + 1, nz),
    bottom: getNeighborBlock(nx, ny - 1, nz),
    north: getNeighborBlock(nx, ny, nz - 1),
    south: getNeighborBlock(nx, ny, nz + 1),
    west: getNeighborBlock(nx - 1, ny, nz),
    east: getNeighborBlock(nx + 1, ny, nz)
  });

  return { getNeighborBlock, getNeighborsOf };
}
