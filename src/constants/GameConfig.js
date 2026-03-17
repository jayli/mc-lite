/**
 * 游戏常量配置
 * 集中管理所有 Magic Number，避免散落在代码各处
 */

export const GameConfig = {
  // ==================== 背包系统配置 ====================
  /** 默认背包容量（格数） */
  DEFAULT_INVENTORY_COUNT: 1500,

  // ==================== 丧尸数量限制配置 ====================
  /** 低画质设置下的丧尸数量上限 */
  ZOMBIE_LIMIT_LOW: 20,
  /** 中画质设置下的丧尸数量上限 */
  ZOMBIE_LIMIT_MED: 30,
  /** 高画质设置下的丧尸数量上限 */
  ZOMBIE_LIMIT_HIGH: 50,

  // ==================== 地图配置 ====================
  /** 地图偏移量（用于避免浮点精度问题） */
  MAP_OFFSET: 300,

  // ==================== AO (环境光遮蔽) 配置 ====================
  /** AO 顶点数（每个方块面的顶点数量） */
  AO_VERTICES_COUNT: 24,

  // ==================== 方块面掩码配置 ====================
  /** 面掩码 - 所有面都可见（二进制 00111111） */
  FACE_MASK_ALL: 63,
};

// ==================== 解构导出（便于单独导入） ====================

/** 默认背包容量（格数） */
export const DEFAULT_INVENTORY_COUNT = GameConfig.DEFAULT_INVENTORY_COUNT;

/** 低画质设置下的丧尸数量上限 */
export const ZOMBIE_LIMIT_LOW = GameConfig.ZOMBIE_LIMIT_LOW;

/** 中画质设置下的丧尸数量上限 */
export const ZOMBIE_LIMIT_MED = GameConfig.ZOMBIE_LIMIT_MED;

/** 高画质设置下的丧尸数量上限 */
export const ZOMBIE_LIMIT_HIGH = GameConfig.ZOMBIE_LIMIT_HIGH;

/** 地图偏移量（用于避免浮点精度问题） */
export const MAP_OFFSET = GameConfig.MAP_OFFSET;

/** AO 顶点数（每个方块面的顶点数量） */
export const AO_VERTICES_COUNT = GameConfig.AO_VERTICES_COUNT;

/** 面掩码 - 所有面都可见（二进制 00111111） */
export const FACE_MASK_ALL = GameConfig.FACE_MASK_ALL;
