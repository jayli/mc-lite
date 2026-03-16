/**
 * 游戏常量配置
 * 集中管理所有 Magic Number，避免散落在代码各处
 */

export const GameConfig = {
  // 背包系统
  DEFAULT_INVENTORY_COUNT: 1500,

  // 丧尸数量限制
  ZOMBIE_LIMIT_LOW: 20,
  ZOMBIE_LIMIT_MED: 30,
  ZOMBIE_LIMIT_HIGH: 50,

  // 地图偏移
  MAP_OFFSET: 300,

  // AO (环境光遮蔽) 顶点数
  AO_VERTICES_COUNT: 24,

  // 面掩码 - 所有面都可见
  FACE_MASK_ALL: 63,
};

// 为了兼容解构导入，也导出单个常量
export const {
  DEFAULT_INVENTORY_COUNT,
  ZOMBIE_LIMIT_LOW,
  ZOMBIE_LIMIT_MED,
  ZOMBIE_LIMIT_HIGH,
  MAP_OFFSET,
  AO_VERTICES_COUNT,
  FACE_MASK_ALL,
} = GameConfig;
