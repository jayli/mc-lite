/**
 * 结构候选索引 — 类型定义与工具函数
 *
 * 定义轻量 candidate schema，供 LargeStaticCandidateCollector、
 * StaticTreeCandidateCollector 和 StructureCandidateIndex 共用。
 */

export const CANDIDATE_SOURCE = Object.freeze({
  CITY: 'city',
  ISLAND: 'island',
  PLAIN_LAND: 'plain_land',
  PROBABILISTIC_LARGE_STATIC: 'probabilistic_large_static',
  STATIC_TREE: 'static_tree'
});

/**
 * 创建一个候选结构对象
 * @param {string} type - 结构类型（如 'tank', 'tower'）
 * @param {number} x - 世界坐标 X
 * @param {number} y - 世界坐标 Y（中心高度）
 * @param {number} z - 世界坐标 Z
 * @param {string} source - 来源标识（CANDIDATE_SOURCE 中的值）
 * @returns {Object} 候选对象 { type, x, y, z, source }
 */
export function makeCandidate(type, x, y, z, source) {
  return {
    type,
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    source
  };
}

/**
 * 生成候选的唯一去重键
 * @param {Object} candidate
 * @returns {string}
 */
export function candidateKey(candidate) {
  return `${candidate.type}:${candidate.x},${candidate.y},${candidate.z}`;
}
