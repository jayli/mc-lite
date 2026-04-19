import { encodeCoord, getFromBlockDataMap } from '../utils/CoordEncoding.js';

function getEntryType(entry) {
  if (entry == null) return null;
  return typeof entry === 'string' ? entry : entry.type;
}

function copyInstanceValues(source, keepIndices) {
  if (!source) return source;
  const ResultArray = source.constructor || Float32Array;
  const result = new ResultArray(keepIndices.length);
  keepIndices.forEach((sourceIndex, targetIndex) => {
    result[targetIndex] = source[sourceIndex];
  });
  return result;
}

function copyInstanceMatrices(matrices, keepIndices) {
  if (!matrices) return matrices;
  const result = new Float32Array(keepIndices.length * 16);
  keepIndices.forEach((sourceIndex, targetIndex) => {
    const sourceStart = sourceIndex * 16;
    result.set(matrices.subarray(sourceStart, sourceStart + 16), targetIndex * 16);
  });
  return result;
}

/**
 * 从 Map 格式的 blockData 中获取条目（Worker 结果 key 可能是字符串）
 * @param {Map} blockData - 方块数据 Map
 * @param {string|number} key - Worker 返回的 key（可能为字符串 "x,y,z" 或数字编码）
 * @returns {*} 方块数据条目
 */
function getBlockDataEntryFromKey(blockData, key) {
  // Worker 返回的 visibleKeys/solidBlocks 使用字符串 key
  if (typeof key === 'string') {
    const [x, y, z] = key.split(',').map(Number);
    return getFromBlockDataMap(blockData, x, y, z);
  }
  return blockData.get(key);
}

function hasBlockDataEntryFromKey(blockData, key) {
  if (typeof key === 'string') {
    const [x, y, z] = key.split(',').map(Number);
    return blockData.has(encodeCoord(x, y, z));
  }
  return blockData.has(key);
}

function filterLegacyRenderData(d, blockData) {
  if (!d) return d;

  const filtered = {};
  for (const type in d) {
    // 跳过 collider 类型的方块（它们不应该被渲染）
    if (type.endsWith('_collider')) continue;

    filtered[type] = d[type].filter(pos => {
      return getEntryType(getFromBlockDataMap(blockData, pos.x, pos.y, pos.z)) === type;
    });
  }
  return filtered;
}

function filterMeshData(meshData, blockData) {
  if (!Array.isArray(meshData)) return meshData;

  const filtered = [];
  for (const item of meshData) {
    // 跳过 collider 类型的方块（它们不应该被渲染）
    if (item.type?.endsWith('_collider')) continue;

    const entries = Object.entries(item.instanceIndexMap || {})
      .map(([key, index]) => ({ key, index }))
      .sort((a, b) => a.index - b.index);

    const keepEntries = entries.filter(({ key }) => getEntryType(getBlockDataEntryFromKey(blockData, key)) === item.type);
    if (keepEntries.length === 0) continue;

    const keepIndices = keepEntries.map(entry => entry.index);
    const instanceIndexMap = {};
    keepEntries.forEach((entry, newIndex) => {
      instanceIndexMap[entry.key] = newIndex;
    });

    filtered.push({
      ...item,
      count: keepIndices.length,
      matrices: copyInstanceMatrices(item.matrices, keepIndices),
      aoLow: copyInstanceValues(item.aoLow, keepIndices),
      aoHigh: copyInstanceValues(item.aoHigh, keepIndices),
      orientation: copyInstanceValues(item.orientation, keepIndices),
      instanceIndexMap
    });
  }

  return filtered;
}

export function filterWorkerResultAgainstBlockData(data, blockData) {
  let { d, meshData, visibleKeys, solidBlocks } = data;

  if (visibleKeys) {
    visibleKeys = visibleKeys.filter(key => hasBlockDataEntryFromKey(blockData, key));
  }

  if (solidBlocks) {
    solidBlocks = solidBlocks.filter(key => hasBlockDataEntryFromKey(blockData, key));
  }

  return {
    visibleKeys,
    solidBlocks,
    d: filterLegacyRenderData(d, blockData),
    meshData: filterMeshData(meshData, blockData)
  };
}
