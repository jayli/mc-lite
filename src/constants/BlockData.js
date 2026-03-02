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
  'birch_log': {
    isSolid: true,
    isTransparent: false
  },
  'wood': {
    isSolid: true,
    isTransparent: false
  },
  'sky_wood': {
    isSolid: true,
    isTransparent: false
  },
  'azalea_log': {
    isSolid: true,
    isTransparent: false
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
  'snow_leaves': {
    isTransparent: true
  },
  'calcite': {},
  'end_stone': {},
  'iron': {},
  'diamond': {},
  'obsidian': {},
  'moss': {},
  'chest': {
    isSolid: true,
    isTransparent: true
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
    isIndestructible: true  // 不可被 TNT、机枪或玩家破坏
  },
  'playground_center_block': {
    isSolid: true,
    isTransparent: false,
    isRendered: true,
    isShadowEnabled: false,
    isIndestructible: true  // 不可被 TNT、机枪或玩家破坏
  },
  // 注意：AO 现在自动适用于所有 solid + non-transparent 方块
  // 无需手动设置 isAOEnabled 标志
  'sand': {},
  'stone': {},
  'stone_diorite': {},
  'mossy_stone': {},
  'cobblestone': {},
  'bricks': {},
  'planks': {},
  'planks_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    geometryType: 'planks_step'
  },
  'cobblestone_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    geometryType: 'cobblestone_step'
  },
  'stone_diorite_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    geometryType: 'cobblestone_step'
  },
  'white_planks': {},
  'oak_planks': {},
  'gold_ore': {},
  'marble': {},
  'dirt': {},
  'snow': {},
  'snow_grass': {},
  'ice': {}
};

/**
 * 获取方块属性的辅助函数
 * 自动为非透明方块启用AO（环境光遮蔽）
 * @param {string|object} type - 方块类型字符串或对象
 * @returns {Object} 方块属性对象（包含自动计算的isAOEnabled）
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
  let props;
  if (BLOCK_DATA[typeStr]) {
    props = { ...DEFAULT_PROPERTIES, ...BLOCK_DATA[typeStr] };
  } else if (typeStr.includes('leaves')) {
    props = { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['leaves'] };
  } else if (typeStr.includes('glass')) {
    props = { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['glass_block'] };
  } else if (typeStr.includes('water')) {
    props = { ...DEFAULT_PROPERTIES, ...BLOCK_DATA['water'] };
  } else {
    props = { ...DEFAULT_PROPERTIES };
  }

  // 自动AO逻辑：非透明且实心的方块默认启用AO
  // 只有当手动设置了isAOEnabled时才使用手动值，否则根据isTransparent和isSolid自动判断
  if (props.isAOEnabled === undefined) {
    props.isAOEnabled = !props.isTransparent && props.isSolid;
  }

  return props;
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

/**
 * 获取方块属性（包含自动AO设置）
 * 所有非透明方块默认启用AO，透明方块不启用AO
 * @param {string} type - 方块类型
 * @returns {Object} 包含 isAOEnabled 的完整属性对象
 */
export function getBlockProps(type) {
  const props = getBlockProperties(type);
  return {
    ...props,
    // 非透明方块默认启用AO，透明方块不启用
    isAOEnabled: !props.isTransparent
  };
}
