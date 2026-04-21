import { assertDeepEqual, assertEqual } from './assert.js';
import { filterWorkerResultAgainstBlockData } from '../world/ChunkMeshDataFilter.js';
import { Chunk } from '../world/Chunk.js';

const input = {
  blockData: new Map([
    [Chunk.encodeCoord(1, 2, 3), { type: 'stone', orientation: 0 }],
    [Chunk.encodeCoord(4, 5, 6), { type: 'glass_block', orientation: 0 }]
  ]),
  workerResult: {
    visibleKeys: [Chunk.encodeCoord(1, 2, 3), Chunk.encodeCoord(4, 5, 6), Chunk.encodeCoord(7, 8, 9)],
    solidBlocks: [Chunk.encodeCoord(1, 2, 3), Chunk.encodeCoord(7, 8, 9)],
    d: {
      stone: [
        { x: 1, y: 2, z: 3 },
        { x: 7, y: 8, z: 9 }
      ],
      glass_block: [
        { x: 4, y: 5, z: 6 }
      ]
    },
    meshData: [
      {
        type: 'stone',
        count: 2,
        matrices: new Float32Array(32).map((_, i) => i + 1),
        aoLow: new Float32Array([11, 22]),
        aoHigh: new Float32Array([33, 44]),
        orientation: new Float32Array([0, 1]),
        instanceIndexMap: {
          [Chunk.encodeCoord(1, 2, 3)]: 0,
          [Chunk.encodeCoord(7, 8, 9)]: 1
        }
      },
      {
        type: 'glass_block',
        count: 1,
        matrices: new Float32Array(16).map((_, i) => 101 + i),
        aoLow: new Float32Array([55]),
        aoHigh: new Float32Array([66]),
        orientation: new Float32Array([0]),
        instanceIndexMap: {
          [Chunk.encodeCoord(4, 5, 6)]: 0
        }
      }
    ]
  }
};

const result = filterWorkerResultAgainstBlockData(input.workerResult, input.blockData);

assertDeepEqual(result.visibleKeys, [Chunk.encodeCoord(1, 2, 3), Chunk.encodeCoord(4, 5, 6)], 'visibleKeys 应过滤掉已不存在的方块');
assertDeepEqual(result.solidBlocks, [Chunk.encodeCoord(1, 2, 3)], 'solidBlocks 应过滤掉已不存在的方块');
assertEqual(result.d.stone.length, 1, '旧格式 d.stone 应只保留一个实例');
assertEqual(result.meshData.length, 2, '应保留两个类型分组');
assertEqual(result.meshData[0].count, 1, 'stone meshData 应只保留一个实例');
// Object key 为数字编码的字符串形式
assertDeepEqual(Object.keys(result.meshData[0].instanceIndexMap), [String(Chunk.encodeCoord(1, 2, 3))], 'instanceIndexMap 应重建为过滤后的索引');
assertDeepEqual(Array.from(result.meshData[0].aoLow), [11], 'aoLow 应与保留实例同步过滤');
assertDeepEqual(Array.from(result.meshData[0].aoHigh), [33], 'aoHigh 应与保留实例同步过滤');
assertDeepEqual(Array.from(result.meshData[0].orientation), [0], 'orientation 应同步过滤');
assertDeepEqual(Array.from(result.meshData[0].matrices), Array.from(new Float32Array(32).map((_, i) => i + 1).slice(0, 16)), 'matrices 应只保留首个实例矩阵');

console.log('test-chunk-mesh-data-filter: ok');
