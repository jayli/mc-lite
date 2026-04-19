// src/utils/AOUtils.js
// AO（环境光遮蔽）计算辅助函数

import { getBlockProperties, isFullCubeOccluder } from '../constants/BlockData.js';
import { AO_VERTICES_COUNT } from '../constants/GameConfig.js';
import { encodeCoord } from './CoordEncoding.js';

function getBlockDataEntry(blockData, x, y, z) {
  if (blockData instanceof Map) {
    return blockData.get(encodeCoord(Math.floor(x), Math.floor(y), Math.floor(z)));
  }
  return blockData[`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`];
}

/**
 * 预计算的邻居偏移量（按面和角索引）
 * 避免运行时坐标计算，提升性能
 * 格式：[faceIdx][cornerIdx] = { side1: [dx,dy,dz], side2: [dx,dy,dz], corner: [dx,dy,dz] }
 */
const AO_NEIGHBOR_OFFSETS = [
  // Face 0 (+X side) - 基础偏移 [1,0,0]
  [
    { side1: [1, 1, 0], side2: [1, 0, 1], corner: [1, 1, 1] },   // V0: Top, PZ
    { side1: [1, 1, 0], side2: [1, 0, -1], corner: [1, 1, -1] },  // V1: Top, NZ
    { side1: [1, -1, 0], side2: [1, 0, 1], corner: [1, -1, 1] },  // V2: Bottom, PZ
    { side1: [1, -1, 0], side2: [1, 0, -1], corner: [1, -1, -1] } // V3: Bottom, NZ
  ],
  // Face 1 (-X side) - 基础偏移 [-1,0,0]
  [
    { side1: [-1, 1, 0], side2: [-1, 0, -1], corner: [-1, 1, -1] }, // V4: Top, NZ
    { side1: [-1, 1, 0], side2: [-1, 0, 1], corner: [-1, 1, 1] },   // V5: Top, PZ
    { side1: [-1, -1, 0], side2: [-1, 0, -1], corner: [-1, -1, -1] }, // V6: Bottom, NZ
    { side1: [-1, -1, 0], side2: [-1, 0, 1], corner: [-1, -1, 1] }  // V7: Bottom, PZ
  ],
  // Face 2 (+Y top) - 基础偏移 [0,1,0]
  [
    { side1: [-1, 1, 0], side2: [0, 1, -1], corner: [-1, 1, -1] }, // V8: NX, NZ
    { side1: [1, 1, 0], side2: [0, 1, -1], corner: [1, 1, -1] },   // V9: PX, NZ
    { side1: [-1, 1, 0], side2: [0, 1, 1], corner: [-1, 1, 1] },   // V10: NX, PZ
    { side1: [1, 1, 0], side2: [0, 1, 1], corner: [1, 1, 1] }      // V11: PX, PZ
  ],
  // Face 3 (-Y bottom) - 基础偏移 [0,-1,0]
  [
    { side1: [-1, -1, 0], side2: [0, -1, 1], corner: [-1, -1, 1] },   // V12: NX, PZ
    { side1: [1, -1, 0], side2: [0, -1, 1], corner: [1, -1, 1] },     // V13: PX, PZ
    { side1: [-1, -1, 0], side2: [0, -1, -1], corner: [-1, -1, -1] }, // V14: NX, NZ
    { side1: [1, -1, 0], side2: [0, -1, -1], corner: [1, -1, -1] }    // V15: PX, NZ
  ],
  // Face 4 (+Z side) - 基础偏移 [0,0,1]
  [
    { side1: [-1, 0, 1], side2: [0, 1, 1], corner: [-1, 1, 1] },   // V16: NX, Top
    { side1: [1, 0, 1], side2: [0, 1, 1], corner: [1, 1, 1] },     // V17: PX, Top
    { side1: [-1, 0, 1], side2: [0, -1, 1], corner: [-1, -1, 1] },  // V18: NX, Bottom
    { side1: [1, 0, 1], side2: [0, -1, 1], corner: [1, -1, 1] }    // V19: PX, Bottom
  ],
  // Face 5 (-Z side) - 基础偏移 [0,0,-1]
  [
    { side1: [1, 0, -1], side2: [0, 1, -1], corner: [1, 1, -1] },   // V20: PX, Top
    { side1: [-1, 0, -1], side2: [0, 1, -1], corner: [-1, 1, -1] }, // V21: NX, Top
    { side1: [1, 0, -1], side2: [0, -1, -1], corner: [1, -1, -1] }, // V22: PX, Bottom
    { side1: [-1, 0, -1], side2: [0, -1, -1], corner: [-1, -1, -1] } // V23: NX, Bottom
  ]
];

const AO_FACE_NORMAL_OFFSETS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

const FULL_BRIGHT_PACKED_AO = 0x00ffffff;

/**
 * 计算单个角落的 AO 值 (0-3)
 * AO = 3 - (side1 + side2 + corner)
 * 如果 side1 和 side2 都是空气，则忽略 corner (Minecraft 优化逻辑)
 * @param {boolean} side1 - 侧边 1 是否遮挡
 * @param {boolean} side2 - 侧边 2 是否遮挡
 * @param {boolean} corner - 角落是否遮挡
 * @returns {number} AO 值 (0-3)
 */
export function getAOValue(side1, side2, corner) {
  const s1 = side1 ? 1 : 0;
  const s2 = side2 ? 1 : 0;
  // Minecraft 逻辑：只有当侧边存在时才考虑对角
  const c = (side1 || side2) ? (corner ? 1 : 0) : 0;

  if (s1 && s2) return 0; // 两个侧面都遮挡，AO 为 0 (最暗)
  return 3 - (s1 + s2 + c);
}

/**
 * 计算方块单个面的 4 个角落 AO 值
 * @param {number} x - 方块世界 X 坐标
 * @param {number} y - 方块世界 Y 坐标
 * @param {number} z - 方块世界 Z 坐标
 * @param {number} faceIdx - 面索引 (0-5: +X, -X, +Y, -Y, +Z, -Z)
 * @param {Function} isOccludingFn - 判断方块是否遮挡的函数 (x,y,z) => boolean
 * @returns {Uint8Array} 4 个角落的 AO 值数组
 */
export function getAOForFace(x, y, z, faceIdx, isOccludingFn) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);

  const aos = new Uint8Array(4).fill(3);
  const offsets = AO_NEIGHBOR_OFFSETS[faceIdx];

  for (let cornerIdx = 0; cornerIdx < 4; cornerIdx++) {
    const offset = offsets[cornerIdx];
    const side1Occ = isOccludingFn(ix + offset.side1[0], iy + offset.side1[1], iz + offset.side1[2]);
    const side2Occ = isOccludingFn(ix + offset.side2[0], iy + offset.side2[1], iz + offset.side2[2]);
    const cornerOcc = isOccludingFn(ix + offset.corner[0], iy + offset.corner[1], iz + offset.corner[2]);

    aos[cornerIdx] = getAOValue(side1Occ, side2Occ, cornerOcc);
  }

  return aos;
}

/**
 * 计算方块所有 6 个面的 AO 值（共 AO_VERTICES_COUNT 个顶点）
 * @param {number} x - 方块世界 X 坐标
 * @param {number} y - 方块世界 Y 坐标
 * @param {number} z - 方块世界 Z 坐标
 * @param {Function} isOccludingFn - 判断方块是否遮挡的函数 (x,y,z) => boolean
 * @returns {Object} { aoLow: number, aoHigh: number } 打包的 AO 数据
 */
export function calculateAOForBlock(x, y, z, isOccludingFn) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let aoLow = FULL_BRIGHT_PACKED_AO;
  let aoHigh = FULL_BRIGHT_PACKED_AO;

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const normal = AO_FACE_NORMAL_OFFSETS[faceIdx];
    if (isOccludingFn(ix + normal[0], iy + normal[1], iz + normal[2])) {
      continue;
    }

    const aos = getAOForFace(ix, iy, iz, faceIdx, isOccludingFn);

    for (let cornerIdx = 0; cornerIdx < 4; cornerIdx++) {
      const vertexIdx = faceIdx * 4 + cornerIdx;
      const aoVal = aos[cornerIdx];

      if (vertexIdx < 12) {
        const shift = vertexIdx * 2;
        aoLow = (aoLow & ~(0x03 << shift)) | (aoVal << shift);
      } else {
        const shift = (vertexIdx - 12) * 2;
        aoHigh = (aoHigh & ~(0x03 << shift)) | (aoVal << shift);
      }
    }
  }

  return { aoLow, aoHigh };
}

/**
 * 批量计算方块 AO 数据列表
 * @param {Array} blocks - 方块数组 [{x, y, z, type}]
 * @param {Function} isOccludingFn - 判断方块是否遮挡的函数 (x,y,z) => boolean
 * @returns {Array} AO 数据数组 [{x, y, z, type, aoLow, aoHigh}]
 */
export function buildAODataForBlocks(blocks, isOccludingFn) {
  const aoData = [];

  for (const block of blocks) {
    if (!isAOApplicable(block.type)) continue;

    const { aoLow, aoHigh } = calculateAOForBlock(block.x, block.y, block.z, isOccludingFn);
    aoData.push({
      x: block.x,
      y: block.y,
      z: block.z,
      type: block.type,
      aoLow,
      aoHigh
    });
  }

  return aoData;
}

/**
 * 打包 AO_VERTICES_COUNT 个 AO 值为两个 32 位整数
 * @param {Uint8Array} aos - AO_VERTICES_COUNT 个 AO 值数组 (每个值 0-3)
 * @returns {Object} { aoLow: number, aoHigh: number }
 */
export function packAOData(aos) {
  if (aos.length !== AO_VERTICES_COUNT) {
    throw new Error(`AO array must have exactly ${AO_VERTICES_COUNT} values`);
  }

  let aoLow = 0;
  let aoHigh = 0;

  for (let i = 0; i < AO_VERTICES_COUNT; i++) {
    const aoVal = aos[i] & 0x03; // 确保值在 0-3 范围内

    if (i < 12) {
      aoLow |= (aoVal << (i * 2));
    } else {
      aoHigh |= (aoVal << ((i - 12) * 2));
    }
  }

  return { aoLow, aoHigh };
}

/**
 * 解包单个顶点的 AO 值
 * @param {number} aoLow - 低 12 个顶点的打包 AO 数据
 * @param {number} aoHigh - 高 12 个顶点的打包 AO 数据
 * @param {number} vertexIdx - 顶点索引 (0-23)
 * @returns {number} AO 值 (0-3)
 */
export function unpackAOValue(aoLow, aoHigh, vertexIdx) {
  if (vertexIdx < 0 || vertexIdx > 23) {
    throw new Error('Vertex index must be between 0 and 23');
  }

  if (vertexIdx < 12) {
    return (aoLow >> (vertexIdx * 2)) & 0x03;
  } else {
    return (aoHigh >> ((vertexIdx - 12) * 2)) & 0x03;
  }
}

/**
 * 解包所有 AO_VERTICES_COUNT 个顶点的 AO 值
 * @param {number} aoLow - 低 12 个顶点的打包 AO 数据
 * @param {number} aoHigh - 高 12 个顶点的打包 AO 数据
 * @returns {number[]} AO_VERTICES_COUNT 个 AO 值数组
 */
export function unpackAllAO(aoLow, aoHigh) {
  const aos = new Array(AO_VERTICES_COUNT);
  for (let i = 0; i < AO_VERTICES_COUNT; i++) {
    aos[i] = unpackAOValue(aoLow, aoHigh, i);
  }
  return aos;
}

/**
 * 判断 AO 是否适用于指定方块类型
 * @param {string} blockType - 方块类型
 * @returns {boolean} AO 是否适用
 */
export function isAOApplicable(blockType) {
  if (!blockType) return false;

  const props = getBlockProperties(blockType);
  // AO 适用于所有实心且不透明的方块
  return props.isSolid && !props.isTransparent;
}

/**
 * 获取 AO 计算的邻居坐标
 * @param {number} x - 方块 X 坐标
 * @param {number} y - 方块 Y 坐标
 * @param {number} z - 方块 Z 坐标
 * @param {number} faceIdx - 面索引 (0-5)
 * @param {number} cornerIdx - 角落索引 (0-3)
 * @returns {Object} { side1: {x,y,z}, side2: {x,y,z}, corner: {x,y,z} }
 */
export function getAONeighbors(x, y, z, faceIdx, cornerIdx) {
  const offsets = AO_NEIGHBOR_OFFSETS[faceIdx][cornerIdx];

  return {
    side1: { x: x + offsets.side1[0], y: y + offsets.side1[1], z: z + offsets.side1[2] },
    side2: { x: x + offsets.side2[0], y: y + offsets.side2[1], z: z + offsets.side2[2] },
    corner: { x: x + offsets.corner[0], y: y + offsets.corner[1], z: z + offsets.corner[2] }
  };
}

/**
 * 验证 AO 值是否合法 (0-3)
 * @param {number} ao - AO 值
 * @returns {boolean} 是否合法
 */
export function validateAOValue(ao) {
  return Number.isInteger(ao) && ao >= 0 && ao <= 3;
}

/**
 * 验证打包的 AO 数据是否合法
 * @param {number} aoLow - 低 12 个顶点的打包 AO 数据
 * @param {number} aoHigh - 高 12 个顶点的打包 AO 数据
 * @returns {boolean} 是否合法
 */
export function validatePackedAO(aoLow, aoHigh) {
  for (let i = 0; i < AO_VERTICES_COUNT; i++) {
    const ao = unpackAOValue(aoLow, aoHigh, i);
    if (!validateAOValue(ao)) return false;
  }
  return true;
}

/**
 * 创建 Chunk 环境下的遮挡检测函数
 * 封装 Chunk 特定的边界处理和未加载区域的默认行为
 * @param {Object} world - World 实例，用于访问其他 chunks
 * @param {number} CHUNK_SIZE - 区块尺寸
 * @param {Function} getBlockPropsFn - 获取方块属性的函数
 * @returns {Function} isOccluding 函数 (x, y, z) => boolean
 */
export function createOcclusionChecker(world, CHUNK_SIZE, getBlockPropsFn) {
  /**
   * 判断指定坐标的方块是否遮挡光线
   * @param {number} ox - 世界坐标 X
   * @param {number} oy - 世界坐标 Y
   * @param {number} oz - 世界坐标 Z
   * @returns {boolean} 是否遮挡
   */
  return function isOccluding(ox, oy, oz) {
    const cx = Math.floor(ox / CHUNK_SIZE);
    const cz = Math.floor(oz / CHUNK_SIZE);
    const isCurrentChunk = cx === world.chunk.cx && cz === world.chunk.cz;
    let chunk = isCurrentChunk
      ? world.chunk
      : world.chunks.get(`${cx},${cz}`);

    // 邻居 Chunk 不存在时按空气处理，保持与 Worker 侧 AO 一致，
    // 避免动态网格 AO 与合并后 AO 出现深浅跳变。
    if (!chunk) return false;

    // 关键约束：主线程互动期 AO 只采样当前 Chunk 和已 finalized 的邻接 Chunk。
    // 否则会把 worker-ready/terrain-built 的半装配 Chunk 当成真实遮挡体，
    // 导致补面 AO 与可交互世界视图不一致，出现黑面或方向错乱。
    if (!isCurrentChunk && !chunk.isReady) return false;

    const entry = getBlockDataEntry(chunk.blockData, ox, oy, oz);

    if (entry) {
      const type = typeof entry === 'string' ? entry : entry.type;
      const props = getBlockPropsFn(type);
      return isFullCubeOccluder(props);
    }

    // blockData 中没有该方块
    // 无记录时统一按空气处理，消除主线程与 Worker 的 AO 规则差异
    return false;
  };
}

/**
 * 计算动态方块的 AO 数据（打包格式）
 * 封装完整的 AO 计算流程，用于动态方块网格创建
 * @param {number} x - 方块世界 X 坐标
 * @param {number} y - 方块世界 Y 坐标
 * @param {number} z - 方块世界 Z 坐标
 * @param {Function} isOccludingFn - 遮挡检测函数
 * @returns {Object} { aoLow: number, aoHigh: number } 打包的 AO 数据
 */
export function computeBlockAOPacked(x, y, z, isOccludingFn) {
  return calculateAOForBlock(x, y, z, isOccludingFn);
}

/**
 * 创建基于 blockData 的简易遮挡检测函数
 * 适用于单区块或纯数据场景（如 Worker 或 AOSystem）
 * @param {Object} blockData - 方块数据对象 {"x,y,z": "type"}
 * @param {Function} getBlockPropsFn - 获取方块属性的函数
 * @param {Object} options - 配置选项
 * @param {boolean} options.requireSolid - 是否要求方块为实心（默认 false，只检查是否透明）
 * @returns {Function} isOccluding(x, y, z) => boolean
 */
export function createBlockDataOcclusionChecker(blockData, getBlockPropsFn, options = {}) {
  const { requireSolid = false } = options;

  return function isOccluding(x, y, z) {
    const type = getBlockDataEntry(blockData, x, y, z);
    if (!type) return false;

    const props = getBlockPropsFn(type);
    return requireSolid
      ? props.isSolid && !props.isTransparent
      : !props.isTransparent;
  };
}

/**
 * 增量计算 AO 数据（用于动态方块更新）
 * 统一的 AO 增量计算逻辑，可用于 Worker 和主线程
 *
 * @param {Object} position - 方块位置 {x, y, z}
 * @param {'PLACE'|'DESTROY'} operation - 操作类型
 * @param {string} blockType - 方块类型
 * @param {Object} blockData - 局部方块数据 {"x,y,z": "type"}
 * @param {number} neighborhoodRadius - 邻居半径（默认 1）
 * @param {Function} getBlockPropsFn - 获取方块属性的函数
 * @returns {Object} AO 计算结果 { aoData, affectedNeighbors, duration }
 */
export function computeIncrementalAO(position, operation, blockType, blockData, neighborhoodRadius = 1, getBlockPropsFn = getBlockProperties) {
  const startTime = typeof performance !== 'undefined' ? performance.now() : 0;
  const aoData = [];
  const affectedNeighbors = [];

  // 使用工具函数创建 isOccluding 函数
  const isOccluding = createBlockDataOcclusionChecker(blockData, getBlockPropsFn);

  const { x, y, z } = position;
  const affected = new Set();

  // 如果是放置方块，计算该方块的 AO
  if (operation === 'PLACE' && isAOApplicable(blockType)) {
    affected.add(`${x},${y},${z}`);
  }

  // 计算邻居方块的 AO 更新
  for (let dx = -neighborhoodRadius; dx <= neighborhoodRadius; dx++) {
    for (let dy = -neighborhoodRadius; dy <= neighborhoodRadius; dy++) {
      for (let dz = -neighborhoodRadius; dz <= neighborhoodRadius; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;

        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const type = getBlockDataEntry(blockData, nx, ny, nz);

        if (type && isAOApplicable(type)) {
          affected.add(`${nx},${ny},${nz}`);
        }
      }
    }
  }

  // 计算 AO
  for (const key of affected) {
    const [bx, by, bz] = key.split(',').map(Number);
    const type = getBlockDataEntry(blockData, bx, by, bz);

    if (type && isAOApplicable(type)) {
      const { aoLow, aoHigh } = calculateAOForBlock(bx, by, bz, isOccluding);
      aoData.push({ x: bx, y: by, z: bz, type, aoLow, aoHigh });
      affectedNeighbors.push({ x: bx, y: by, z: bz });
    }
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : 0;

  return {
    aoData,
    affectedNeighbors,
    duration: endTime - startTime
  };
}
