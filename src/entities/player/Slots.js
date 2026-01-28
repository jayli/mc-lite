// src/entities/player/Slots.js

/**
 * 物品槽位类，存储单个位置的物品信息
 */
export class Slot {
  /**
   * @param {number} id - 槽位唯一标识
   * @param {string|null} item - 物品类型名称
   * @param {number} count - 物品数量
   * @param {Object} meta - 额外元数据
   */
  constructor(id, item = null, count = 0, meta = {}) {
    this.id = id;
    this.item = item;
    this.count = count;
    this.meta = meta;
  }

  /**
   * 设置槽位物品内容
   */
  set(item, count, meta = {}) {
    this.item = item;
    this.count = count;
    this.meta = meta;
  }

  /**
   * 清空槽位
   */
  clear() {
    this.item = null;
    this.count = 0;
    this.meta = {};
  }

  /**
   * 检查槽位是否为空
   */
  isEmpty() {
    return this.item === null || this.count <= 0;
  }
}

/**
 * 背包/清单类，管理多个物品槽位
 */
export class Inventory {
  /**
   * @param {number} size - 背包容量
   */
  constructor(size = 36) {
    this.slots = [];
    for (let i = 0; i < size; i++) {
      this.slots.push(new Slot(i));
    }
    this.selectedSlot = 0; // 当前选中的快捷栏索引
  }

  /**
   * 添加物品到背包
   * @param {string} item - 物品名称
   * @param {number} count - 数量
   * @returns {boolean} - 是否添加成功
   */
  add(item, count = 1) {
    // 简单的添加逻辑：先尝试堆叠到已有同类物品，再寻找空位
    for (const slot of this.slots) {
      if (slot.item === item) {
        slot.count += count;
        return true;
      }
    }
    for (const slot of this.slots) {
      if (slot.isEmpty()) {
        slot.set(item, count);
        return true;
      }
    }
    return false;
  }

  /**
   * 从背包移除物品
   * @param {string} item - 物品名称
   * @param {number} count - 数量
   * @returns {boolean} - 是否移除成功
   */
  remove(item, count = 1) {
    for (const slot of this.slots) {
      if (slot.item === item) {
        if (slot.count >= count) {
          slot.count -= count;
          if (slot.count <= 0) slot.clear();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 检查背包是否包含指定数量的物品
   */
  has(item, count = 1) {
    let total = 0;
    for (const slot of this.slots) {
      if (slot.item === item) total += slot.count;
    }
    return total >= count;
  }

  /**
   * 获取当前选中的槽位对象
   */
  getSelected() {
    return this.slots[this.selectedSlot];
  }
}
