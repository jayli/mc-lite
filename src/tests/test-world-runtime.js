// src/tests/test-world-runtime.js
import { describe } from './runner.js';
import { assertDeepEqual, assertEqual, assertFalse, assertTrue } from './assert.js';
import { WorldRuntime } from '../world/WorldRuntime.js';

describe('WorldRuntime 运行时工作集测试', (test) => {
  test('ensureChunkData - region 不存在时返回 missing-region', async () => {
    const originalWorldStore = globalThis._worldStore;
    globalThis._worldStore = {
      getRegionRecord: async () => null
    };

    const runtime = new WorldRuntime();
    const result = await runtime.ensureChunkData(0, 0);

    assertEqual(result.status, 'missing-region', 'region 缺失时应返回 missing-region');
    globalThis._worldStore = originalWorldStore;
  });

  test('ensureChunkData - region 存在但 chunk 不存在时返回 missing-chunk', async () => {
    const originalWorldStore = globalThis._worldStore;
    globalThis._worldStore = {
      getRegionRecord: async () => ({
        regionKey: '0,0',
        chunks: {}
      })
    };

    const runtime = new WorldRuntime();
    const result = await runtime.ensureChunkData(0, 0);

    assertEqual(result.status, 'missing-chunk', 'chunk 缺失时应返回 missing-chunk');
    globalThis._worldStore = originalWorldStore;
  });

  test('ensureChunkData - 读取到 chunk 时返回 ready 与 chunkRecord', async () => {
    const originalWorldStore = globalThis._worldStore;
    const chunkRecord = {
      blockData: { 123: 'stone' },
      staticEntities: [{ type: 'rovers', positions: [{ x: 1, y: 2, z: 3 }] }],
      runtimeSeedData: { structureCenters: [{ x: 4, z: 5 }] }
    };
    globalThis._worldStore = {
      getRegionRecord: async () => ({
        regionKey: '0,0',
        chunks: {
          '0,0': chunkRecord
        }
      })
    };

    const runtime = new WorldRuntime();
    const result = await runtime.ensureChunkData(0, 0);

    assertEqual(result.status, 'ready', 'chunk 存在时应返回 ready');
    assertDeepEqual(result.chunkRecord.blockData, chunkRecord.blockData, 'blockData 应原样返回');
    assertDeepEqual(result.chunkRecord.staticEntities, chunkRecord.staticEntities, 'staticEntities 应原样返回');
    assertDeepEqual(result.chunkRecord.runtimeSeedData, chunkRecord.runtimeSeedData, 'runtimeSeedData 应原样返回');
    globalThis._worldStore = originalWorldStore;
  });

  test('markChunkDirty - 应触发防抖 flush 并清除脏标记', async () => {
    const originalWorldStore = globalThis._worldStore;
    const flushCalls = [];
    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
        flushCalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[123, { type: 'stone', orientation: 0 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    assertTrue(runtime.isChunkDirty(0, 0), '标脏后应处于 dirty 状态');

    await new Promise((resolve) => setTimeout(resolve, 650));

    assertEqual(flushCalls.length, 1, '防抖 flush 应写回一次');
    assertEqual(flushCalls[0].cx, 0, 'flush 应写回正确的 cx');
    assertEqual(flushCalls[0].cz, 0, 'flush 应写回正确的 cz');
    assertFalse(runtime.isChunkDirty(0, 0), 'flush 后应清除 dirty 状态');

    globalThis._worldStore = originalWorldStore;
  });

  test('markChunkDirty - 已调度的 flush 不应受后续全局 worldStore 替换影响', async () => {
    const originalWorldStore = globalThis._worldStore;
    const storeACalls = [];
    const storeBCalls = [];

    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
        storeACalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtimeA = new WorldRuntime();
    runtimeA.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[123, { type: 'stone', orientation: 0 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });
    runtimeA.markChunkDirty(0, 0);

    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
        storeBCalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtimeB = new WorldRuntime();
    runtimeB.setWorld({
      chunks: new Map([
        ['1,0', {
          blockData: new Map([[456, { type: 'dirt', orientation: 0 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });
    runtimeB.markChunkDirty(1, 0);

    await new Promise((resolve) => setTimeout(resolve, 650));

    assertEqual(storeACalls.length, 1, 'runtimeA 应继续写回创建时绑定的 worldStore');
    assertEqual(storeACalls[0].cx, 0, 'runtimeA 应写回正确 chunk');
    assertEqual(storeBCalls.length, 1, 'runtimeB 应只写回到新的 worldStore');
    assertEqual(storeBCalls[0].cx, 1, 'runtimeB 应写回正确 chunk');

    globalThis._worldStore = originalWorldStore;
  });
});
