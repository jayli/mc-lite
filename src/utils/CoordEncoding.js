/**
 * 坐标编码工具 - Worker 安全，不依赖任何浏览器 API
 * 将三维坐标编码为单一整数，用于 Map 键
 *
 * 编码公式：((Math.floor(x) + 1000000) * 2049 + (Math.floor(y) + 512)) * 2000001 + (Math.floor(z) + 1000000)
 *
 * 坐标范围：
 * - X/Z: [-1_000_000, +1_000_000]
 * - Y: [-512, +512]
 */

/**
 * 将三维坐标编码为单一整数
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @returns {number} 编码后的整数
 */
export function encodeCoord(x, y, z) {
  return ((Math.floor(x) + 1000000) * 2049 + (Math.floor(y) + 512)) * 2000001 + (Math.floor(z) + 1000000);
}

/**
 * 将编码后的整数解码为三维坐标
 * @param {number} code - 编码后的整数
 * @returns {{x: number, y: number, z: number}} 解码后的坐标对象
 */
export function decodeCoord(code) {
  const z = (code % 2000001) - 1000000;
  const t = Math.floor(code / 2000001);
  const y = (t % 2049) - 512;
  const x = Math.floor(t / 2049) - 1000000;
  return { x, y, z };
}

/**
 * 将 Map<number, entry> 格式的 blockData 转换为 Worker 兼容的 {"x,y,z": entry} 格式
 * @param {Map<number, *>} blockData - 数字编码键的方块数据
 * @returns {Object} 字符串键的方块数据对象
 */
export function blockDataToStringKeys(blockData) {
  const result = {};
  for (const [code, entry] of blockData) {
    const { x, y, z } = decodeCoord(code);
    result[`${x},${y},${z}`] = entry;
  }
  return result;
}
