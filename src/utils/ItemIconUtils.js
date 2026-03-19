// src/ui/ItemIconUtils.js
/**
 * 物品图标工具模块
 * 提供统一的物品图标获取逻辑，用于 Inventory 和 HUD
 */

/**
 * 特定物品的自定义图标映射
 * @param {string} item - 物品名称
 * @returns {string|null} 自定义图标路径，如果没有则返回 null
 */
export function getCustomIconPath(item) {
  const customIcons = {
    'handrail': 'src/assets/textures/handrail.png',
    'handrailA': 'src/assets/textures/handrailA.png',
    'handrailB': 'src/assets/textures/handrailB.png',
    'vertical_pillar': 'src/assets/textures/pillar.png',
    'horizontal_pillar': 'src/assets/textures/pillar_horizontal.png',
    'planks_step': 'src/assets/textures/Oak_Planks_step.png',
    'cobblestone_step': 'src/assets/textures/Cobblestone_step.png',
    'cobblestone_step_updown': 'src/assets/textures/Cobblestone_step_updown.png',
    'stone_diorite_step': 'src/assets/textures/stone_diorite_step.png',
    'turret_alias_block': 'src/assets/textures/turret.png',
    'bed_alias_block': 'src/assets/textures/bed/Bed_(front_texture)_JE2_BE2.png'
  };

  return customIcons[item] || null;
}

/**
 * 创建物品图标图片元素
 * @param {string} item - 物品名称
 * @param {Function} generateIconFn - 生成默认图标的函数（HUD.generateIcon）
 * @returns {HTMLImageElement} 图标图片元素
 */
export function createItemIcon(img, item, generateIconFn) {
  const customIconPath = getCustomIconPath(item);
  if (customIconPath) {
    img.src = customIconPath;
  } else {
    img.src = generateIconFn(item);
  }
  return img;
}
