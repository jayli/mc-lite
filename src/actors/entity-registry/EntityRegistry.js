/**
 * EntityRegistry.js
 * 实体注册表 - 统一管理所有复杂实体的放置处理器
 *
 * 设计目标：
 * - 集中管理特殊方块类型到放置处理器的映射
 * - 提供统一的接口供 PlayerInteraction 查询和调用
 * - 支持动态注册新实体类型，无需修改 PlayerInteraction
 */

export class EntityRegistry {
  constructor() {
    /**
     * 处理器映射表
     * key: 方块类型（如 'turret_alias_block'）
     * value: EntityPlacementHandler 实例
     * @type {Map<string, EntityPlacementHandler>}
     */
    this.handlers = new Map();
  }

  /**
   * 注册一个放置处理器
   *
   * @param {string} blockType - 方块类型标识符
   * @param {EntityPlacementHandler} handler - 放置处理器实例
   * @returns {void}
   * @throws {Error} 如果 handler 不是 EntityPlacementHandler 实例
   */
  register(blockType, handler) {
    if (!blockType || typeof blockType !== 'string') {
      throw new Error('EntityRegistry.register(): blockType must be a non-empty string');
    }

    if (!handler || typeof handler.canPlace !== 'function' || typeof handler.place !== 'function') {
      throw new Error('EntityRegistry.register(): handler must implement canPlace() and place() methods');
    }

    this.handlers.set(blockType, handler);
  }

  /**
   * 获取指定方块类型的放置处理器
   *
   * @param {string} blockType - 方块类型标识符
   * @returns {EntityPlacementHandler | undefined} - 放置处理器实例，未找到返回 undefined
   */
  getHandler(blockType) {
    return this.handlers.get(blockType);
  }

  /**
   * 检查指定方块类型是否有注册的放置处理器
   *
   * @param {string} blockType - 方块类型标识符
   * @returns {boolean} - 如果有处理器返回 true
   */
  isSpecialBlock(blockType) {
    return this.handlers.has(blockType);
  }

  /**
   * 注销指定方块类型的放置处理器
   *
   * @param {string} blockType - 方块类型标识符
   * @returns {boolean} - 如果有处理器被移除返回 true
   */
  unregister(blockType) {
    return this.handlers.delete(blockType);
  }

  /**
   * 获取所有注册的方块类型
   *
   * @returns {Array<string>} - 方块类型列表
   */
  getRegisteredBlockTypes() {
    return Array.from(this.handlers.keys());
  }

  /**
   * 获取注册数量
   *
   * @returns {number}
   */
  getRegistrationCount() {
    return this.handlers.size;
  }

  /**
   * 清空所有注册
   */
  clear() {
    this.handlers.clear();
  }
}
