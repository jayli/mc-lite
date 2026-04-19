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

/**
 * 将 Map<number, entry> 格式的 blockData 转换为数字编码的 plain object
 * Worker 可直接使用此格式，无需字符串转换
 * @param {Map<number, *>} blockData - 数字编码键的方块数据
 * @returns {Object} 数字编码键的方块数据对象 { code: entry }
 */
export function blockDataToNumberKeys(blockData) {
  const result = {};
  for (const [code, entry] of blockData) {
    result[code] = entry;
  }
  return result;
}

/**
 * 从 Map<number, entry> 格式的 blockData 中获取方块类型
 * 主线程专用：blockData 始终是 Map，直接编码 + Map.get
 * @param {Map} blockData - 方块数据 Map
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @returns {*} 方块数据条目（字符串类型或对象）
 */
export function getFromBlockDataMap(blockData, x, y, z) {
  const code = encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));
  return blockData.get(code);
}

/**
 * 从数字编码的 plain object 格式 blockData 中获取方块类型
 * Worker 专用：blockData 是 { code: entry } 格式的纯对象
 * 兼容 Worker 返回的旧档数据（字符串 key 回退）
 * @param {Object} blockData - 方块数据对象
 * @param {number} x - X 坐标
 * @param {number} y - Y 坐标
 * @param {number} z - Z 坐标
 * @returns {*} 方块数据条目
 */
export function getFromBlockDataObj(blockData, x, y, z) {
  const code = encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z));
  if (blockData[code] !== undefined) return blockData[code];
  // 回退：字符串 key 格式（旧档兼容）
  const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  return blockData[key];
}
