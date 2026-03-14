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
  orientationEnabled: true, // 是否允许放置时旋转朝向
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
    isShadowEnabled: false,
    orientationEnabled: true
  },
  'collider': {
    isSolid: true,
    isTransparent: true,
    isRendered: false,
    isShadowEnabled: false,
    orientationEnabled: true
  },
  'water': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    orientationEnabled: true
  },
  'swamp_water': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    orientationEnabled: true
  },
  'cloud': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    orientationEnabled: true
  },
  'glass_block': {
    isTransparent: true,
    orientationEnabled: true
  },
  'glass_blink': {
    isTransparent: true,
    orientationEnabled: true
  },
  'leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'birch_log': {
    isSolid: true,
    isTransparent: false,
    orientationEnabled: false
  },
  'wood': {
    isSolid: true,
    isTransparent: false,
    orientationEnabled: false
  },
  'sky_wood': {
    isSolid: true,
    isTransparent: false,
    orientationEnabled: false
  },
  'azalea_log': {
    isSolid: true,
    isTransparent: false,
    orientationEnabled: false
  },
  'azalea_leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'azalea_flowers': {
    isTransparent: true,
    orientationEnabled: true
  },
  'yellow_leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'sky_leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'realistic_oak_leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'realistic_yellow_leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'flower': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'flower',
    orientationEnabled: true
  },
  'short_grass': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'flower',
    orientationEnabled: true
  },
  'allium': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'flower',
    orientationEnabled: true
  },
  'vine': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'vine',
    orientationEnabled: true
  },
  'lilypad': {
    isSolid: false,
    isTransparent: true,
    isShadowEnabled: false,
    geometryType: 'lilypad',
    orientationEnabled: true
  },
  'cactus': {
    isTransparent: true,
    geometryType: 'cactus',
    orientationEnabled: true
  },
  'handrail': {
    isTransparent: true,
    geometryType: 'handrail',
    orientationEnabled: true
  },
  'handrailA': {
    isTransparent: true,
    geometryType: 'handrailA',
    orientationEnabled: true
  },
  'handrailB': {
    isTransparent: true,
    geometryType: 'handrailB',
    orientationEnabled: true
  },
  'vertical_pillar': {
    isTransparent: true,
    geometryType: 'vertical_pillar',
    orientationEnabled: true
  },
  'horizontal_pillar': {
    isTransparent: true,
    geometryType: 'horizontal_pillar',
    orientationEnabled: true
  },
  'chimney': {
    geometryType: 'chimney',
    orientationEnabled: false
  },
  'swamp_leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'snow_leaves': {
    isTransparent: true,
    orientationEnabled: true
  },
  'calcite': { orientationEnabled: false },
  'end_stone': { orientationEnabled: false },
  'iron': { orientationEnabled: false },
  'diamond': { orientationEnabled: false },
  'obsidian': { orientationEnabled: false },
  'moss': { orientationEnabled: false },
  'chest': {
    isSolid: true,
    isTransparent: true,
    orientationEnabled: true
  },
  'realistic_trunk_collider': {
    isSolid: true,
    isTransparent: true,
    isRendered: false,
    isShadowEnabled: false,
    orientationEnabled: true
  },
  'playground_block': {
    isSolid: true,
    isTransparent: false,
    isRendered: true,
    isShadowEnabled: false,
    orientationEnabled: false,
    isIndestructible: true  // 不可被 TNT、机枪或玩家破坏
  },
  'playground_center_block': {
    isSolid: true,
    isTransparent: false,
    isRendered: true,
    isShadowEnabled: false,
    orientationEnabled: false,
    isIndestructible: true  // 不可被 TNT、机枪或玩家破坏
  },
  // 规则：满足 solid + non-transparent 且四个水平面纹理一致的方块禁用旋转
  'sand': { orientationEnabled: false },
  'stone': { orientationEnabled: false },
  'stone_diorite': { orientationEnabled: false },
  'mossy_stone': { orientationEnabled: false },
  'cobblestone': { orientationEnabled: false },
  'bricks': { orientationEnabled: false },
  'planks': { orientationEnabled: false },
  'planks_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    geometryType: 'planks_step',
    orientationEnabled: true
  },
  'cobblestone_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    geometryType: 'cobblestone_step',
    orientationEnabled: true
  },
  'stone_diorite_step': {
    isSolid: true,
    isTransparent: true,  // 不参与 face culling，相邻面都显示
    geometryType: 'cobblestone_step',
    orientationEnabled: true
  },
  'white_planks': { orientationEnabled: false },
  'oak_planks': { orientationEnabled: false },
  'gold_ore': { orientationEnabled: false },
  'marble': { orientationEnabled: false },
  'dirt': { orientationEnabled: false },
  'snow': { orientationEnabled: false },
  'snow_grass': { orientationEnabled: false },
  'ice': { orientationEnabled: false },

  // 以下类型在 MaterialManager 中有定义且可放置，补齐旋转能力定义，避免走默认值
  'grass': { orientationEnabled: false },
  'dark_planks': { orientationEnabled: false },
  'blue_planks': { orientationEnabled: false },
  'green_planks': { orientationEnabled: false },
  'hay_bale': { orientationEnabled: false },
  'swamp_grass': { orientationEnabled: false },
  'bookbox': { orientationEnabled: true },
  'gold_block': { orientationEnabled: false },
  'emerald': { orientationEnabled: false },
  'amethyst': { orientationEnabled: false },
  'iron_ore': { orientationEnabled: false },
  'debris': { orientationEnabled: false },
  'tnt': { orientationEnabled: false }
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
