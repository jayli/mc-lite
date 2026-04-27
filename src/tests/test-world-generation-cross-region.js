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

      const { rx, rz } = message;
      const chunks = {};

      for (let localCx = 0; localCx < 8; localCx++) {
        for (let localCz = 0; localCz < 8; localCz++) {
          const cx = rx * 8 + localCx;
          const cz = rz * 8 + localCz;
          const chunkKey = `${cx},${cz}`;

          // 目标 region (1,0) 中，chunk 8,0 应持有跨界方块
          const isTargetChunk = cx === 8 && cz === 0 && rx === 1 && rz === 0;

          chunks[chunkKey] = {
            routing: {
              ownChunk: { chunkKey, blockDataBlocks: [], visibleBlocks: [], meshData: [] },
              overflowChunks: []
            },
            blockDataBlocks: isTargetChunk
              ? [{ x: 128, y: 5, z: 0, type: 'stone', orientation: 0 }]
              : [],
            entities: { modGunMan: [], rovers: [] },
            structureCenters: []
          };
        }
      }

      // 模拟从 region (0,0) 溢出到 region (1,0) 的方块
      const unresolvedOverflowBlocks = [];
      if (rx === 0 && rz === 0) {
        unresolvedOverflowBlocks.push({
          chunkKey: '8,0',
          blockDataBlocks: [{ x: 128, y: 5, z: 0, type: 'stone', orientation: 0 }]
        });
      }

      setTimeout(() => {
        callback({
          chunks,
          routingDiagnostics: {
            resolved: 0,
            unresolved: unresolvedOverflowBlocks.length > 0 ? 1 : 0,
            uniqueUnresolvedCoords: unresolvedOverflowBlocks.length > 0 ? 1 : 0,
            topDistanceBuckets: [],
            unresolvedOverflowBlocks
          }
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

describe('WorldGenerationService 跨 region overflow 收集与分发', (test) => {
  test('_collectCrossRegionOverflow - 应将 overflow 按目标 region 分组', async () => {
    const service = new WorldGenerationService();
    await service._collectCrossRegionOverflow({
      routingDiagnostics: {
        unresolvedOverflowBlocks: [
          { chunkKey: '8,0', blockDataBlocks: [{ x: 128, y: 5, z: 0, type: 'stone' }] },
          { chunkKey: '0,8', blockDataBlocks: [{ x: 0, y: 5, z: 128, type: 'wood' }] }
        ]
      }
    });

    assertTrue(service._crossRegionOverflowMap.has('1,0'), '目标 region (1,0) 应在 map 中');
    assertTrue(service._crossRegionOverflowMap.has('0,1'), '目标 region (0,1) 应在 map 中');
    assertEqual(service._crossRegionOverflowMap.get('1,0').length, 1, 'region (1,0) 应有一条 overflow');
    assertEqual(service._crossRegionOverflowMap.get('0,1').length, 1, 'region (0,1) 应有一条 overflow');
  });

  test('_distributeCrossRegionOverflow - 应将同批次 overflow 合并到目标 region', async () => {
    const savedRegions = [];
    globalThis._worldStore = {
      getRegionRecord: async (rx, rz) => {
        const found = savedRegions.find((r) => r.rx === rx && r.rz === rz);
        return found ? found.record : null;
      },
      saveRegionRecord: async (rx, rz, record) => {
        const idx = savedRegions.findIndex((r) => r.rx === rx && r.rz === rz);
        if (idx >= 0) {
          savedRegions[idx] = { rx, rz, record };
        } else {
          savedRegions.push({ rx, rz, record });
        }
      },
      saveOverflowBlocks: async () => {}
    };

    const service = new WorldGenerationService();
    savedRegions.push({
      rx: 1, rz: 0,
      record: {
        regionKey: '1,0',
        rx: 1, rz: 0,
        chunkKeys: ['8,0'],
        chunks: {
          '8,0': { blockData: {}, staticEntities: [], runtimeSeedData: {} }
        }
      }
    });

    service._crossRegionOverflowMap.set('1,0', [
      { chunkKey: '8,0', blockDataBlocks: [{ x: 128, y: 5, z: 0, type: 'stone', orientation: 0 }] }
    ]);

    await service._distributeCrossRegionOverflow(['1,0']);

    assertEqual(savedRegions.length, 1, '应仍只有一个 region');
    const targetChunk = savedRegions[0].record.chunks['8,0'];
    const code = encodeCoord(128, 5, 0);
    assertTrue(
      Object.prototype.hasOwnProperty.call(targetChunk.blockData, code),
      'overflow block 应被合并到目标 chunk'
    );
    assertFalse(service._crossRegionOverflowMap.has('1,0'), '分发后应从 map 中移除');
  });

  test('_distributeCrossRegionOverflow - 目标 region 不在同批次时应保留在内存 map 中', async () => {
    globalThis._worldStore = {
      getRegionRecord: async () => null,
      saveRegionRecord: async () => {}
    };

    const service = new WorldGenerationService();
    service._crossRegionOverflowMap.set('5,5', [
      { chunkKey: '40,40', blockDataBlocks: [{ x: 640, y: 5, z: 640, type: 'stone' }] }
    ]);

    await service._distributeCrossRegionOverflow(['1,0']);

    assertTrue(service._crossRegionOverflowMap.has('5,5'), '非同批次的 overflow 应保留在 map 中');
  });
});

globalThis._worldStore = ORIGINAL_WORLD_STORE;
globalThis._worldWorker = ORIGINAL_WORLD_WORKER;
