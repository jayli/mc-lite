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
    isAOEnabled: false
  },
  'obsidian': {
    isAOEnabled: false
  },
  'moss': {
    isAOEnabled: false
  },
  // AO 启用的方块 (严格匹配原 aoAllowedTypes 列表)
  'sand': { isAOEnabled: true },
  'stone': { isAOEnabled: true },
  'mossy_stone': { isAOEnabled: true },
  'cobblestone': { isAOEnabled: true },
  'bricks': { isAOEnabled: true },
  'planks': { isAOEnabled: true },
  'white_planks': { isAOEnabled: true },
  'oak_planks': { isAOEnabled: true },
  'marble': { isAOEnabled: true }
};

/**
 * 获取方块属性的辅助函数
 * @param {string} type - 方块类型
 * @returns {Object} 方块属性对象
 */
export function getBlockProperties(type) {
  if (!type) return { ...DEFAULT_PROPERTIES };

  // 处理动态生成的或带前缀的方块类型（如 'realistic_oak_leaves_1'）
  // 如果完全匹配则直接返回
  if (BLOCK_DATA[type]) {
    return { ...DEFAULT_PROPERTIES, ...BLOCK_DATA[type] };
  }

  // 模糊匹配特殊类型
  if (type.includes('leaves')) {
    return { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['leaves'] };
  }
  if (type.includes('glass')) {
    return { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['glass_block'] };
  }
  if (type.includes('water')) {
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
