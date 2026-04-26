import { describe } from './runner.js';
import { assertDeepEqual, assertEqual, assertFalse, assertNotNull, assertTrue, assertUndefined } from './assert.js';
import { WorldGenerationService } from '../world/WorldGenerationService.js';
import { workerCallbacks } from '../world/ChunkConsolidation.js';
import { encodeCoord } from '../utils/CoordEncoding.js';

const ORIGINAL_WORLD_STORE = globalThis._worldStore;
const ORIGINAL_WORLD_WORKER = globalThis._worldWorker;

function createTestWorldWorker() {
  return {
    postMessage(message) {
      const callback = workerCallbacks.get(message.taskId);
      if (!callback) {
        throw new Error(`Missing worker callback for task ${message.taskId}`);
      }

      const hasCrossRegionOverflow = message.cx === 7 && message.cz === 0;
      setTimeout(() => {
        callback({
          routing: {
            ownChunk: {
              chunkKey: `${message.cx},${message.cz}`,
              blockDataBlocks: [],
              visibleBlocks: [],
              meshData: []
            },
            overflowChunks: hasCrossRegionOverflow
              ? [{
                chunkKey: '8,0',
                blockDataBlocks: [{
                  x: 128,
                  y: 5,
                  z: 0,
                  type: 'stone',
                  orientation: 0
                }],
                visibleBlocks: []
              }]
              : []
          },
          blockDataBlocks: [],
          entities: { modGunMan: [], rovers: [] },
          structureCenters: []
        });
      }, 0);
    }
  };
}

describe('WorldGenerationService 跨 region owner 归属测试', (test) => {
  test('_mergeOverflowBlocks - 应返回可诊断的 unresolved overflow 摘要', () => {
    const service = new WorldGenerationService();
    const chunkResults = {
      '0,0': {
        blockData: {},
        routing: {
          overflowChunks: [{
            chunkKey: '2,0',
            blockDataBlocks: [
              { x: 32, y: 5, z: 0, type: 'stone', orientation: 0 },
              { x: 32, y: 5, z: 0, type: 'stone', orientation: 0 },
              { x: 33, y: 5, z: 0, type: 'stone', orientation: 0 }
            ]
          }, {
            chunkKey: '0,2',
            blockDataBlocks: [
              { x: 0, y: 6, z: 32, type: 'wood', orientation: 0 }
            ]
          }]
        }
      },
      '1,0': {
        blockData: {},
        routing: {
          overflowChunks: [{
            chunkKey: '3,0',
            blockDataBlocks: [
              { x: 48, y: 7, z: 0, type: 'glass_block', orientation: 0 }
            ]
          }]
        }
      }
    };

    const diagnostics = service._mergeOverflowBlocks(chunkResults);

    assertEqual(diagnostics.unresolved.rawBlocks, 5, '应统计原始 unresolved block 数');
    assertEqual(diagnostics.unresolved.uniqueCoords, 4, '应统计去重后的 unresolved 坐标数');
    assertDeepEqual(
      diagnostics.unresolved.topTargetChunks,
      [
        { chunkKey: '2,0', blocks: 3 },
        { chunkKey: '0,2', blocks: 1 },
        { chunkKey: '3,0', blocks: 1 }
      ],
      '应统计 unresolved 目标 chunk 热点'
    );
    assertDeepEqual(
      diagnostics.unresolved.topSourceChunks,
      [
        { chunkKey: '0,0', blocks: 4 },
        { chunkKey: '1,0', blocks: 1 }
      ],
      '应统计 unresolved 来源 chunk 热点'
    );
    assertDeepEqual(
      diagnostics.unresolved.topDistanceBuckets,
      [
        { offset: '2,0', blocks: 4 },
        { offset: '0,2', blocks: 1 }
      ],
      '应统计 unresolved chunk 偏移分布'
    );
  });

  test('generateRegion - 源 region 不应借用保存越界方块', async () => {
    const savedRegions = [];
    globalThis._worldStore = {
      saveRegionRecord: async (rx, rz, record) => {
        savedRegions.push({ rx, rz, record });
      }
    };
    globalThis._worldWorker = createTestWorldWorker();

    const service = new WorldGenerationService();
    await service._generateRegion(0, 0);

    assertEqual(savedRegions.length, 1, '应保存一个 region record');
    const regionRecord = savedRegions[0].record;
    const sourceChunk = regionRecord.chunks['7,0'];
    assertNotNull(sourceChunk, '源 chunk 7,0 应存在');

    const overflowCode = encodeCoord(128, 5, 0);
    assertFalse(
      Object.prototype.hasOwnProperty.call(sourceChunk.blockData, overflowCode),
      '越界方块不应回退写入源 chunk'
    );
    assertUndefined(regionRecord.chunks['8,0'], '越界目标 chunk 不应被持久化到当前 region record');
  });

  test('generateRegion - 目标 region 应通过 halo 生成拿到跨界方块', async () => {
    const savedRegions = [];
    globalThis._worldStore = {
      saveRegionRecord: async (rx, rz, record) => {
        savedRegions.push({ rx, rz, record });
      }
    };
    globalThis._worldWorker = createTestWorldWorker();

    const service = new WorldGenerationService();
    await service._generateRegion(1, 0);

    assertEqual(savedRegions.length, 1, '应保存一个 region record');
    const regionRecord = savedRegions[0].record;
    const targetChunk = regionRecord.chunks['8,0'];
    assertNotNull(targetChunk, '目标 chunk 8,0 应存在');

    const overflowCode = encodeCoord(128, 5, 0);
    assertTrue(
      Object.prototype.hasOwnProperty.call(targetChunk.blockData, overflowCode),
      '目标 region 应持有跨界方块的唯一 owner'
    );
    assertUndefined(regionRecord.chunks['7,0'], 'halo chunk 7,0 只用于生成，不应持久化到目标 region');
  });
});

globalThis._worldStore = ORIGINAL_WORLD_STORE;
globalThis._worldWorker = ORIGINAL_WORLD_WORKER;
