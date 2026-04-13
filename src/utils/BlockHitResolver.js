// src/utils/BlockHitResolver.js

/**
 * 射线命中点偏移常量
 * 用于从命中点向物体内部微移，进入被击中的体素
 */
const RAY_STEP_EPSILON = 0.01;

/**
 * 面法线偏移常量
 * 从命中点沿法线反向偏移，推算被命中的方块坐标
 */
const FACE_NORMAL_OFFSET = 0.5;

/**
 * 将浮点世界坐标转换为方块坐标
 * @param {{x:number,y:number,z:number}} p
 * @returns {{x:number,y:number,z:number}}
 */
function toBlockPos(p) {
  return {
    x: Math.floor(p.x),
    y: Math.floor(p.y),
    z: Math.floor(p.z)
  };
}

/**
 * 根据射线方向从命中点向”物体内部”微移，获取被命中的方块坐标
 * 命中点位于表面时，沿 ray.direction 的正方向前进 epsilon 可进入被击中的体素内部。
 * 该方式对台阶/斜面更稳定，避免法线方向歧义导致选中相邻方块。
 * @param {{x:number,y:number,z:number}} hitPoint
 * @param {{x:number,y:number,z:number}|null|undefined} rayDirection
 * @param {number} [epsilon=RAY_STEP_EPSILON] - 微移距离，默认使用常量
 * @returns {{x:number,y:number,z:number}|null}
 */
export function getBlockPosFromRayStepInside(hitPoint, rayDirection, epsilon = RAY_STEP_EPSILON) {
  if (!hitPoint || !rayDirection) return null;
  return toBlockPos({
    x: hitPoint.x + rayDirection.x * epsilon,
    y: hitPoint.y + rayDirection.y * epsilon,
    z: hitPoint.z + rayDirection.z * epsilon
  });
}

/**
 * 根据面法线从命中点推算被命中的方块坐标
 * @param {{x:number,y:number,z:number}} hitPoint
 * @param {{x:number,y:number,z:number}|null|undefined} faceNormal
 * @returns {{x:number,y:number,z:number}|null}
 */
export function getBlockPosFromFaceNormal(hitPoint, faceNormal) {
  if (!hitPoint || !faceNormal) return null;
  return toBlockPos({
    x: hitPoint.x - faceNormal.x * FACE_NORMAL_OFFSET,
    y: hitPoint.y - faceNormal.y * FACE_NORMAL_OFFSET,
    z: hitPoint.z - faceNormal.z * FACE_NORMAL_OFFSET
  });
}

/**
 * 从多个候选坐标中选择可删除的目标方块坐标
 * 优先顺序：沿射线进入物体内部 > 面法线推导 > instance 矩阵位置
 * @param {Object} params
 * @param {{x:number,y:number,z:number}} params.hitPoint
 * @param {{x:number,y:number,z:number}|null|undefined} params.rayDirection
 * @param {{x:number,y:number,z:number}|null|undefined} params.faceNormal
 * @param {{x:number,y:number,z:number}|null|undefined} params.matrixPosition
 * @param {(x:number,y:number,z:number)=>({type:string,orientation:number}|null)} params.getBlockEntry
 * @param {string|null|undefined} [params.preferredType]
 * @returns {{x:number,y:number,z:number,entry:{type:string,orientation:number}}|null}
 */
export function resolveBreakBlockPos(params) {
  const {
    hitPoint,
    rayDirection,
    faceNormal,
    matrixPosition,
    getBlockEntry,
    preferredType
  } = params;

  if (!hitPoint || typeof getBlockEntry !== 'function') return null;

  const candidates = [];
  const pushCandidate = (p) => {
    if (!p) return;
    if (!candidates.some((c) => c.x === p.x && c.y === p.y && c.z === p.z)) {
      candidates.push(p);
    }
  };

  pushCandidate(getBlockPosFromRayStepInside(hitPoint, rayDirection));
  pushCandidate(getBlockPosFromFaceNormal(hitPoint, faceNormal));
  pushCandidate(matrixPosition ? toBlockPos(matrixPosition) : null);

  if (candidates.length === 0) return null;

  // 第一轮：优先匹配 mesh 类型，避免误删背后不同类型方块
  if (preferredType) {
    for (const p of candidates) {
      const entry = getBlockEntry(p.x, p.y, p.z);
      if (entry) {
        // === 新增：batched 类型宽松匹配 ===
        // 当 preferredType 为 'batched' 时，说明命中了合批 mesh，
        // 但无法从 mesh 本身获取真实类型。此时接受任何有真实 blockData 的候选。
        if (preferredType === 'batched') {
          return { ...p, entry };
        }
        // 精确匹配：类型必须一致
        if (entry.type === preferredType) {
          return { ...p, entry };
        }
      }
    }
  }

  // 第二轮：任意可命中的真实方块
  for (const p of candidates) {
    const entry = getBlockEntry(p.x, p.y, p.z);
    if (entry) {
      return { ...p, entry };
    }
  }

  return null;
}
