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

/** City 主城最小边长（格） */
export const CITY_SIZE_MIN = 112;

/** City 主城最大边长（格） */
export const CITY_SIZE_MAX = 224;

// ==================== City 主城配置 ====================

/** City 过渡带尺寸（格） */
export const CITY_TRANSITION_SIZE = 32;

/** City 阶梯过渡宽度（格）：每 N 格升/降 1 格 */
export const CITY_TERRACE_WIDTH = 3;

/** City 建筑群核心缓冲边距（格）：建筑 footprint 到过渡带内边缘的距离 */
export const CITY_CORE_BUILD_MARGIN = 30;

/** City 地表起伏最大幅度（格） */
export const CITY_GROUND_VARIANCE_MAX = 3;

/** City 区域坐标（固定生成在区域 [0,0]） */
export const CITY_REGION = { X: 0, Z: 0 };

/** City 结构占地配置（按 JSON 实测边界） */
export const CITY_STRUCTURE_FOOTPRINT = Object.freeze({
  castle: { halfX: 23, halfZ: 26, minGap: 10 },
  whiteTower: { halfX: 15, halfZ: 6, minGap: 12 },
  bigHouse: { halfX: 18, halfZ: 20, minGap: 10 },
  regularHouse1: { halfX: 8, halfZ: 8, minGap: 10 },
  boxHouse: { halfX: 9, halfZ: 5, minGap: 10 },
  desertVillage: { halfX: 13, halfZ: 14, minGap: 10 },
  doubleTower: { halfX: 18, halfZ: 7, minGap: 10 },
  gate: { halfX: 13, halfZ: 5, minGap: 10 },
  pyramidIsland: { halfX: 17, halfZ: 20, minGap: 12 },
  smallHouse: { halfX: 16, halfZ: 16, minGap: 10 },
  tower: { halfX: 4, halfZ: 5, minGap: 10 },
  treeHouse: { halfX: 8, halfZ: 7, minGap: 10 },
  uglyHouse: { halfX: 20, halfZ: 20, minGap: 10 },
  woodHouse: { halfX: 8, halfZ: 9, minGap: 10 }
});

/** City 结构生成配额配置 */
export const CITY_STRUCTURE_CONFIGS = Object.freeze([
  { type: 'castle', count: 1, fixedCenter: true },
  // 大尺寸结构优先放置
  { type: 'pyramidIsland', count: 1 },
  { type: 'bigHouse', count: 2 },
  { type: 'regularHouse1', count: 2 },
  { type: 'whiteTower', countRange: [2, 3] },
  { type: 'desertVillage', countRange: [2, 3] },
  { type: 'doubleTower', count: 1 },
  { type: 'boxHouse', count: 2 },
  { type: 'smallHouse', count: 2 },
  { type: 'tower', count: 1 },
  { type: 'treeHouse', count: 3 },
  { type: 'uglyHouse', count: 3 },
  { type: 'woodHouse', count: 4 }
]);

/** City 放置算法常量 */
export const CITY_PLACEMENT = {
  /** 哈希乘数 */
  HASH_MULTIPLIER: 43758.5453123,
  /** 种子混合参数 X */
  SEED_MIX_X: 1.213,
  /** 种子混合参数 Z */
  SEED_MIX_Z: 13.11,
  /** 基础高度随机偏移参数 */
  BASE_HEIGHT_SEED: 0.311,
  BASE_HEIGHT_OFFSET_X: 0.019,
  BASE_HEIGHT_OFFSET_Z: 0.023,
  /** 候选点生成：角度步长（度） */
  CANDIDATE_ANGLE_STEP: 12,
  /** 候选点生成：环距步长（格） */
  CANDIDATE_RING_STEP: 6,
  /** 候选点位置抖动范围（格，正负） */
  CANDIDATE_JITTER: 5,
  /** 目标间距计算基础值 */
  TARGET_SPACING_BASE: 15,
  /** 目标间距计算除数 */
  TARGET_SPACING_DIVISOR: 8,
  /** 大型结构搜索半径最小值（格） */
  LARGE_STRUCT_MIN_RADIUS: 30,
  /** 大型结构搜索半径最大值（格） */
  LARGE_STRUCT_MAX_RADIUS: 180,
  /** 普通结构搜索半径最小值（格） */
  NORMAL_STRUCT_MIN_RADIUS: 15,
  /** 普通结构搜索半径最大值（格） */
  NORMAL_STRUCT_MAX_RADIUS: 150,
  /** Fallback 扩圈增量 */
  FALLBACK_RING_EXPAND_1: 6,
  FALLBACK_RING_EXPAND_2: 28,
  FALLBACK_RING_EXPAND_3: 18,
  FALLBACK_RING_EXPAND_4: 96,
  /** 最终强制放置间距 */
  FORCED_GAP_STRICT: 10,
  FORCED_GAP_LOOSE: 5,
  FORCED_GAP_MINIMAL: 0,
  /** 门放置数量 */
  GATE_COUNT: 2,
  /** 门放置 Z 轴偏移搜索范围 */
  GATE_Z_OFFSET_MAX: 15,
  /** 门放置 X 轴搜索步长 */
  GATE_X_SCAN_STEP: 2,
  /** 填充坦克目标数量 */
  FILLER_TANK_COUNT: 2,
  /** 填充坦克半尺寸（格） */
  FILLER_TANK_HALF_SIZE: 20,
  /** 填充坦克最小间距（格） */
  FILLER_TANK_MIN_GAP: 18,
  /** 填充坦克与建筑最小距离（格） */
  FILLER_TANK_BUILDING_PADDING: 4,
  /** 填充坦克尝试次数 */
  FILLER_TANK_ATTEMPTS: 120
};

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
  PLAIN_LAND_Z: 160,
  /** City 相对于金字塔的 X 偏移 */
  CITY_X: 0,
  /** City 相对于金字塔的 Z 偏移（南侧） */
  CITY_Z: -170
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
  CITY_SIZE_MIN,
  CITY_SIZE_MAX,
  CITY_TRANSITION_SIZE,
  CITY_TERRACE_WIDTH,
  CITY_CORE_BUILD_MARGIN,
  CITY_GROUND_VARIANCE_MAX,
  CITY_REGION,
  CITY_STRUCTURE_FOOTPRINT,
  CITY_STRUCTURE_CONFIGS,
  CITY_PLACEMENT,
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
  PLAIN_LAND: PLAIN_LAND_SIZE,
  CITY: CITY_SIZE_MAX
};

export default RegionMapConfig;
