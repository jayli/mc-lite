/**
 * 方块数据配置
 * 集中管理所有方块的属性，包括物理特性、渲染特性等。
 */

// 默认属性
const DEFAULT_PROPERTIES = {
  isSolid: true,         // 是否为实心（参与物理碰撞）
  isTransparent: false,   // 是否透明（影响面剔除）
  isRendered: true,      // 是否需要渲染网格
  isAOEnabled: false,    // 是否启用环境光遮蔽（AO）
  isShadowEnabled: true, // 是否投射/接收阴影
  geometryType: 'box'    // 几何体类型
};

/**
 * 所有方块的属性定义
 */
export const BLOCK_DATA = {
  'air': {
    isSolid: false,
    isTransparent: true,
    isRendered: false,
    isShadowEnabled: false
  },
  'collider': {
    isSolid: true,
    isTransparent: true,
    isRendered: false,
    isShadowEnabled: false
  },
  'water': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false
  },
  'swamp_water': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false
  },
  'cloud': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false
  },
  'glass_block': {
    isTransparent: true
  },
  'glass_blink': {
    isTransparent: true
  },
  'leaves': {
    isTransparent: true
  },
  'azalea_leaves': {
    isTransparent: true
  },
  'azalea_flowers': {
    isTransparent: true
  },
  'yellow_leaves': {
    isTransparent: true
  },
  'sky_leaves': {
    isTransparent: true
  },
  'realistic_oak_leaves': {
    isTransparent: true
  },
  'realistic_yellow_leaves': {
    isTransparent: true
  },
  'flower': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'flower'
  },
  'short_grass': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'flower'
  },
  'allium': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'flower'
  },
  'vine': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'vine'
  },
  'lilypad': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'lilypad'
  },
  'cactus': {
    isTransparent: true,
    geometryType: 'cactus'
  },
  'handrail': {
    isTransparent: true,
    geometryType: 'handrail'
  },
  'handrailA': {
    isTransparent: true,
    geometryType: 'handrailA'
  },
  'handrailB': {
    isTransparent: true,
    geometryType: 'handrailB'
  },
  'pillar': {
    isTransparent: true,
    geometryType: 'pillar'
  },
  'chimney': {
    geometryType: 'chimney'
  },
  'swamp_leaves': {
    isTransparent: true
  },
  'calcite': {
    isAOEnabled: false
  },
  'end_stone': {
    isAOEnabled: true
  },
  'iron': {
    isAOEnabled: true
  },
  'diamond': {
    isAOEnabled: true
  },
  'obsidian': {
    isAOEnabled: false
  },
  'moss': {
    isAOEnabled: false
  },
  'chest': {
    isSolid: true,
    isTransparent: true,
    isAOEnabled: false
  },
  'realistic_trunk_collider': {
    isSolid: true,
    isTransparent: true,
    isRendered: false,
    isShadowEnabled: false
  },
  'playground_block': {
    isSolid: true,
    isTransparent: false,
    isRendered: true,
    isShadowEnabled: false,
    isAOEnabled: false,
    isIndestructible: true  // 不可被 TNT、机枪或玩家破坏
  },
  'playground_center_block': {
    isSolid: true,
    isTransparent: false,
    isRendered: true,
    isAOEnabled: false,
    isShadowEnabled: false,
    isIndestructible: true  // 不可被 TNT、机枪或玩家破坏
  },
  // AO 启用的方块 (严格匹配原 aoAllowedTypes 列表)
  'sand': { isAOEnabled: true },
  'stone': { isAOEnabled: true },
  'mossy_stone': { isAOEnabled: true },
  'cobblestone': { isAOEnabled: true },
  'bricks': { isAOEnabled: true },
  'planks': { isAOEnabled: true },
  'planks_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    isAOEnabled: false,
    geometryType: 'planks_step'
  },
  'cobblestone_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    isAOEnabled: false,
    geometryType: 'cobblestone_step'
  },
  'white_planks': { isAOEnabled: true },
  'oak_planks': { isAOEnabled: true },
  'gold_ore': { isAOEnabled: true },
  'marble': { isAOEnabled: true }
};

/**
 * 获取方块属性的辅助函数
 * @param {string|object} type - 方块类型字符串或对象
 * @returns {Object} 方块属性对象
 */
export function getBlockProperties(type) {
  if (!type) return { ...DEFAULT_PROPERTIES };

  // 如果 type 是对象，提取 type 属性
  let typeStr = type;
  if (typeof type !== 'string') {
    typeStr = type.type || '';
  }

  if (!typeStr) return { ...DEFAULT_PROPERTIES };

  // 处理动态生成的或带前缀的方块类型（如 'realistic_oak_leaves_1'）
  // 如果完全匹配则直接返回
  if (BLOCK_DATA[typeStr]) {
    return { ...DEFAULT_PROPERTIES, ...BLOCK_DATA[typeStr] };
  }

  // 模糊匹配特殊类型
  if (typeStr.includes('leaves')) {
    return { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['leaves'] };
  }
  if (typeStr.includes('glass')) {
    return { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['glass_block'] };
  }
  if (typeStr.includes('water')) {
    return { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['water'] };
  }

  return { ...DEFAULT_PROPERTIES };
}

/**
 * 获取所有透明方块类型的集合
 * @returns {Set<string>}
 */
export function getTransparentTypes() {
  const types = new Set();
  for (const type in BLOCK_DATA) {
    if (BLOCK_DATA[type].isTransparent) {
      types.add(type);
    }
  }
  return types;
}

/**
 * 获取所有非实心方块类型的集合
 * @returns {Set<string>}
 */
export function getNonSolidTypes() {
  const types = new Set();
  for (const type in BLOCK_DATA) {
    if (BLOCK_DATA[type].isSolid === false) {
      types.add(type);
    }
  }
  return types;
}

/**
 * 获取所有启用 AO 的方块类型数组
 * @returns {string[]}
 */
export function getAOAllowedTypes() {
  return Object.keys(BLOCK_DATA).filter(type => BLOCK_DATA[type].isAOEnabled);
}
