/**
 * OrientationUtils - 方块朝向工具模块
 * 提供方块朝向的枚举定义、旋转角度计算和格式解析功能
 */

/**
 * 方块朝向枚举
 * 表示方块在水平面上的四个方向
 */
export const BlockOrientation = {
  EAST:  0,  // 朝东 (默认，0°)
  SOUTH: 1,  // 朝南 (90°)
  WEST:  2,  // 朝西 (180°)
  NORTH: 3   // 朝北 (270°)
};

/**
 * 获取朝向对应的 Y 轴旋转角度（弧度）
 * @param {number} orientation - 朝向值 (0-3)
 * @returns {number} 旋转角度（弧度）
 */
export function getRotationAngle(orientation) {
  return (orientation || 0) * (Math.PI / 2);
}

/**
 * 计算顺时针旋转后的下一个朝向
 * @param {number} current - 当前朝向 (0-3)
 * @returns {number} 下一个朝向 (0-3)
 */
export function nextOrientation(current) {
  return ((current || 0) + 1) % 4;
}

/**
 * 解析方块数据条目，兼容新旧格式
 * 旧格式: 纯字符串 "handrailA"
 * 新格式: 对象 { type: "handrailA", orientation: 1 }
 * @param {string|object} value - 存储值
 * @returns {{ type: string, orientation: number }} 标准化条目
 */
export function parseBlockEntry(value) {
  if (typeof value === 'string') {
    // 旧格式：纯字符串，默认朝东
    return { type: value, orientation: 0 };
  }
  if (typeof value === 'object' && value !== null) {
    // 新格式：对象
    return {
      type: value.type || 'air',
      orientation: value.orientation ?? 0
    };
  }
  // 无效数据，返回空气
  return { type: 'air', orientation: 0 };
}

/**
 * 验证朝向值是否有效
 * @param {number} value - 待验证的朝向值
 * @returns {boolean} 是否有效
 */
export function isValidOrientation(value) {
  return Number.isInteger(value) && value >= 0 && value <= 3;
}

/**
 * 将方块条目序列化为存储格式
 * @param {string} type - 方块类型
 * @param {number} orientation - 朝向 (0-3)
 * @returns {{ type: string, orientation: number }} 存储格式对象
 */
export function serializeBlockEntry(type, orientation = 0) {
  return {
    type: type,
    orientation: isValidOrientation(orientation) ? orientation : 0
  };
}
