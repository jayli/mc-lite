/**
 * 区域地图配置
 * 集中管理世界生成相关的所有区域配置参数
 * 包括地标尺寸、间距、随机偏移等
 */

// ==================== 区域基础配置 ====================

/** 区域尺寸：每个区域的大小为 400x400 格 */
export const REGION_SIZE = 400;

/** 区域坐标边界的最小边距（防止地标生成在区域边缘） */
export const REGION_MIN_MARGIN = 5;

// ==================== 地标尺寸配置 ====================

/** 金字塔主体边长（格） */
export const PYRAMID_SIZE = 40;

/** 冰封山峰主体边长（格） */
export const FROZEN_MOUNTAIN_SIZE = 80;

/** 雪地主体边长（格） */
export const SNOW_LAND_SIZE = 40;

/** 海岛主体边长（格） */
export const ISLAND_SIZE = 30;

/** 平地主体边长（格） */
export const PLAIN_LAND_SIZE = 30;

// ==================== 过渡带配置 ====================

/** 地标过渡带尺寸（格）：主体边缘到完全消失的过渡区域 */
export const TRANSITION_SIZE = {
  /** 金字塔过渡带 */
  PYRAMID: 8,
  /** 冰封山峰过渡带 */
  FROZEN_MOUNTAIN: 8,
  /** 冰封山峰中心区域额外过渡 */
  FROZEN_MOUNTAIN_CORE: 4,
  /** 雪地过渡带 */
  SNOW_LAND: 8,
  /** 海岛过渡带 */
  ISLAND: 10
};

// ==================== 地标间距配置 ====================

/** 地标间距离偏移配置（相对于金字塔中心） */
export const LANDMARK_OFFSET = {
  /** 冰封山峰相对于金字塔的 X 偏移（-160 表示在金字塔西侧） */
  FROZEN_MOUNTAIN_X: -160,
  /** 冰封山峰相对于金字塔的 Z 偏移 */
  FROZEN_MOUNTAIN_Z: 0,
  /** 雪地相对于金字塔的 X 偏移（+160 表示在金字塔东侧） */
  SNOW_LAND_X: 160,
  /** 雪地相对于金字塔的 Z 偏移 */
  SNOW_LAND_Z: 0,
  /** 平地相对于金字塔的 X 偏移 */
  PLAIN_LAND_X: 0,
  /** 平地相对于金字塔的 Z 偏移 */
  PLAIN_LAND_Z: 160
};

/** 地标间最小距离限制（防止重叠） */
export const LANDMARK_MIN_DISTANCE = {
  /** 海岛与冰封山峰的最小距离（格） */
  ISLAND_FROM_MOUNTAIN: 130,
  /** 海岛与金字塔的最小距离（格） */
  ISLAND_FROM_PYRAMID: 50
};

// ==================== 随机中心偏移配置 ====================

/** 地标中心随机偏移计算参数 */
export const CENTER_OFFSET = {
  /** X 方向偏移缩放因子：随机值乘以该系数 */
  SCALE_X: 300,
  /** Z 方向偏移缩放因子 */
  SCALE_Z: 300,
  /** X 方向偏移基值：保证最小偏移距离 */
  BASE_X: 100,
  /** Z 方向偏移基值 */
  BASE_Z: 100
};

/** 区域随机中心计算的种子乘数参数 */
export const RANDOM_SEED_MULTIPLIERS = {
  /** X 方向种子混合系数 */
  X: 1.5,
  /** Z 方向种子混合系数 */
  Z: 2.5,
  /** 区域坐标混合系数 */
  REGION: 0.1
};

// ==================== 地标生成概率 ====================

/** 海岛生成概率（0-1 之间） */
export const ISLAND_SPAWN_PROBABILITY = 0.08;

/** 金字塔和冰封山峰生成概率（通常固定生成） */
export const PYRAMID_ALWAYS_SPAWN = true;

/** 冰封山峰总是生成 */
export const FROZEN_MOUNTAIN_ALWAYS_SPAWN = true;

// ==================== 冰封山峰特有配置 ====================

/** 冰封山峰椭圆形状陡峭轴方向：'z' 表示 Z 轴方向更陡 */
export const FROZEN_MOUNTAIN_STEEP_AXIS = 'z';

/** 冰封山峰 Z 轴方向压缩系数（<1 表示更陡峭） */
export const FROZEN_MOUNTAIN_STEEP_FACTOR = 0.65;

/** 冰封山峰平顶基础半径（格） */
export const FROZEN_MOUNTAIN_FLAT_RADIUS = 10;

/** 冰封山峰最大高度相关参数 */
export const FROZEN_MOUNTAIN_HEIGHT_FACTOR = 1.3;

// ==================== 海岛特有配置 ====================

/** 海岛海平面高度 */
export const ISLAND_SEA_LEVEL = -2;

/** 海岛与大陆的最小距离（格） */
export const ISLAND_MIN_DISTANCE_FROM_LAND = 20;

/** 海岛形状噪声尺度：越大轮廓越不规则 */
export const ISLAND_SHAPE_NOISE_SCALE = 0.30;

/** 海岛边缘噪声尺度：越大海岸线越破碎 */
export const ISLAND_EDGE_NOISE_SCALE = 0.25;

/** 海岛沙子区域种子点数量 */
export const ISLAND_SAND_PATCH_COUNT = 4;

/** 海岛石头区域种子点数量 */
export const ISLAND_STONE_PATCH_COUNT = 3;

/** 海岛分布噪声尺度 */
export const ISLAND_PATCH_NOISE_SCALE = 0.15;

/** 海岛最小树木数量 */
export const ISLAND_MIN_TREES = 1;

/** 海岛最大树木数量 */
export const ISLAND_MAX_TREES = 2;

/** 海岛树木生成 Y 偏移 */
export const ISLAND_TREE_SPAWN_OFFSET = 1;

// ==================== 雪地特有配置 ====================

/** 雪地中心高度提升最大幅度（格） */
export const SNOW_LAND_CENTER_BOOST_MAX = 2;

/** 雪地中心高度提升衰减半径（格） */
export const SNOW_LAND_CENTER_BOOST_RADIUS = 15;

/** 雪地地形噪声频率 1 */
export const SNOW_LAND_NOISE_SCALE_1 = 0.08;

/** 雪地地形噪声频率 2 */
export const SNOW_LAND_NOISE_SCALE_2 = 0.15;

// ==================== 配置对象导出（用于批量导入） ====================

/** 区域地图完整配置对象 */
export const RegionMapConfig = {
  REGION_SIZE,
  REGION_MIN_MARGIN,
  PYRAMID_SIZE,
  FROZEN_MOUNTAIN_SIZE,
  SNOW_LAND_SIZE,
  ISLAND_SIZE,
  PLAIN_LAND_SIZE,
  TRANSITION_SIZE,
  LANDMARK_OFFSET,
  LANDMARK_MIN_DISTANCE,
  CENTER_OFFSET,
  RANDOM_SEED_MULTIPLIERS,
  ISLAND_SPAWN_PROBABILITY,
  PYRAMID_ALWAYS_SPAWN,
  FROZEN_MOUNTAIN_ALWAYS_SPAWN,
  FROZEN_MOUNTAIN_STEEP_AXIS,
  FROZEN_MOUNTAIN_STEEP_FACTOR,
  FROZEN_MOUNTAIN_FLAT_RADIUS,
  FROZEN_MOUNTAIN_HEIGHT_FACTOR,
  ISLAND_SEA_LEVEL,
  ISLAND_MIN_DISTANCE_FROM_LAND,
  ISLAND_SHAPE_NOISE_SCALE,
  ISLAND_EDGE_NOISE_SCALE,
  ISLAND_SAND_PATCH_COUNT,
  ISLAND_STONE_PATCH_COUNT,
  ISLAND_PATCH_NOISE_SCALE,
  ISLAND_MIN_TREES,
  ISLAND_MAX_TREES,
  ISLAND_TREE_SPAWN_OFFSET,
  SNOW_LAND_CENTER_BOOST_MAX,
  SNOW_LAND_CENTER_BOOST_RADIUS,
  SNOW_LAND_NOISE_SCALE_1,
  SNOW_LAND_NOISE_SCALE_2
};

/** 地标尺寸映射表（便于根据类型获取尺寸） */
export const LANDMARK_SIZES = {
  PYRAMID: PYRAMID_SIZE,
  FROZEN_MOUNTAIN: FROZEN_MOUNTAIN_SIZE,
  SNOW_LAND: SNOW_LAND_SIZE,
  ISLAND: ISLAND_SIZE,
  PLAIN_LAND: PLAIN_LAND_SIZE
};

export default RegionMapConfig;
