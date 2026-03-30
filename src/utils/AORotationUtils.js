// src/utils/AORotationUtils.js
// AO 顶点索引在不同朝向下的重映射工具

/**
 * AO 顶点重映射表：[orientation][vertexId] = worldVertexId
 * orientation: 0/1/2/3（对应 Y 轴旋转 0/90/180/270 度）
 */
export const AO_VERTEX_REMAP_TABLE = [
  // orientation = 0
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  // orientation = 1
  [20, 21, 22, 23, 16, 17, 18, 19, 10, 8, 11, 9, 13, 15, 12, 14, 0, 1, 2, 3, 4, 5, 6, 7],
  // orientation = 2
  [4, 5, 6, 7, 0, 1, 2, 3, 11, 10, 9, 8, 15, 14, 13, 12, 20, 21, 22, 23, 16, 17, 18, 19],
  // orientation = 3
  [16, 17, 18, 19, 20, 21, 22, 23, 9, 11, 8, 10, 14, 12, 15, 13, 4, 5, 6, 7, 0, 1, 2, 3]
];

/**
 * 将任意朝向值归一化到 0-3
 * @param {number} orientation
 * @returns {number}
 */
export function normalizeOrientation(orientation) {
  if (!Number.isFinite(orientation)) return 0;
  const value = Math.round(orientation);
  return ((value % 4) + 4) % 4;
}

/**
 * 根据朝向重映射 AO 顶点索引（0-23）
 * @param {number} vertexId
 * @param {number} orientation
 * @returns {number}
 */
export function remapAOVertexId(vertexId, orientation) {
  const v = Math.round(vertexId);
  if (v < 0 || v > 23) return 0;
  const o = normalizeOrientation(orientation);
  return AO_VERTEX_REMAP_TABLE[o][v];
}

