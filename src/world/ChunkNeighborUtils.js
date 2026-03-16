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

    if (!targetChunk || !targetChunk.isReady) return null;

    const key = `${Math.floor(nx)},${Math.floor(ny)},${Math.floor(nz)}`;
    const entry = targetChunk.blockData[key];
    return formatNeighbor(entry);
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
