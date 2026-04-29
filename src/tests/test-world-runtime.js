// src/tests/test-world-runtime.js
import { describe } from './runner.js';
import { assertDeepEqual, assertEqual, assertFalse, assertTrue } from './assert.js';
import { WorldRuntime } from '../world/WorldRuntime.js';
import { encodeCoord } from '../utils/CoordEncoding.js';

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

  test('ensureChunkData - 缺失 runtimeEntities 时应仅通过 WorldStore 迁移旧档实体', async () => {
    const originalWorldStore = globalThis._worldStore;
    const migratedEntities = {
      turrets: [{ id: 'legacy-turret', position: { x: 8, y: 4, z: 8 }, rotation: { yaw: 0, pitch: 0 } }],
      zombieNests: [],
      minecarts: []
    };
    const putCalls = [];

    globalThis._worldStore = {
      getRegionRecord: async () => ({
        regionKey: '0,0',
        rx: 0,
        rz: 0,
        chunkKeys: ['0,0'],
        chunks: {
          '0,0': {
            blockData: {},
            staticEntities: [],
            runtimeSeedData: {}
          }
        }
      }),
      getLegacyChunkDelta: async (cx, cz) => {
        assertEqual(cx, 0, '应查询正确的 legacy cx');
        assertEqual(cz, 0, '应查询正确的 legacy cz');
        return { entities: migratedEntities };
      },
      commitChunkRecord: async (cx, cz, record) => {
        putCalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    const result = await runtime.ensureChunkData(0, 0);

    assertEqual(result.status, 'ready', '迁移后仍应返回 ready');
    assertDeepEqual(result.chunkRecord.runtimeEntities, migratedEntities, '应通过 WorldStore 迁移旧档 runtimeEntities');
    assertEqual(putCalls.length, 1, '迁移完成后应回填 worldStore 一次');
    assertDeepEqual(putCalls[0].record.runtimeEntities, migratedEntities, '回填内容应与迁移实体一致');

    globalThis._worldStore = originalWorldStore;
  });

  test('ensureChunkData - 缺失 runtimeEntities 且无旧档时应补空结构且不回写', async () => {
    const originalWorldStore = globalThis._worldStore;
    const putCalls = [];

    globalThis._worldStore = {
      getRegionRecord: async () => ({
        regionKey: '0,0',
        rx: 0,
        rz: 0,
        chunkKeys: ['0,0'],
        chunks: {
          '0,0': {
            blockData: {},
            staticEntities: [],
            runtimeSeedData: {}
          }
        }
      }),
      getLegacyChunkDelta: async () => null,
      commitChunkRecord: async (...args) => {
        putCalls.push(args);
        return true;
      }
    };

    const runtime = new WorldRuntime();
    const result = await runtime.ensureChunkData(0, 0);

    assertEqual(result.status, 'ready', '无旧档时仍应返回 ready');
    assertDeepEqual(result.chunkRecord.runtimeEntities, {
      turrets: [],
      zombieNests: [],
      minecarts: []
    }, '应补齐空的 runtimeEntities 结构');
    assertEqual(putCalls.length, 0, '无旧档数据时不应发生回填');

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

  test('recordBlockMutation - 首次修改时应基于当前 chunk blockData 初始化快照并增量更新', () => {
    const baseCode = encodeCoord(1, 2, 3);
    const newCode = encodeCoord(4, 5, 6);
    const runtime = new WorldRuntime();

    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[baseCode, { type: 'dirt', orientation: 0 }]])
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    runtime.recordBlockMutation(0, 0, 4, 5, 6, { type: 'stone', orientation: 1 });

    const dirtyEntry = runtime._dirtyChunks.get('0,0');
    assertTrue(!!dirtyEntry, '应创建 dirty entry');
    assertDeepEqual(dirtyEntry.blockDataSnapshot[baseCode], { type: 'dirt', orientation: 0 }, '应先保留当前 blockData 快照');
    assertDeepEqual(dirtyEntry.blockDataSnapshot[newCode], { type: 'stone', orientation: 1 }, '应增量写入新方块');
  });

  test('flushChunk - 存在 blockDataSnapshot 时不应依赖 live blockData 重新序列化', async () => {
    const originalWorldStore = globalThis._worldStore;
    const baseCode = encodeCoord(1, 2, 3);
    const newCode = encodeCoord(4, 5, 6);
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
          blockData: new Map([[baseCode, { type: 'dirt', orientation: 0 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    runtime.recordBlockMutation(0, 0, 4, 5, 6, { type: 'stone', orientation: 1 });

    runtime._world.chunks.get('0,0').blockData = null;
    await runtime.flushChunk(0, 0);

    assertEqual(flushCalls.length, 1, '应基于 snapshot 成功 flush 一次');
    assertDeepEqual(flushCalls[0].record.blockData[baseCode], { type: 'dirt', orientation: 0 }, '应保留初始方块');
    assertDeepEqual(flushCalls[0].record.blockData[newCode], { type: 'stone', orientation: 1 }, '应写出增量修改方块');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - 不传 live blockData 时也应优先使用 dirty snapshot', async () => {
    const originalWorldStore = globalThis._worldStore;
    const baseCode = encodeCoord(1, 2, 3);
    const newCode = encodeCoord(4, 5, 6);
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
          blockData: new Map([[baseCode, { type: 'dirt', orientation: 0 }]]),
          staticEntities: [],
          structureCenters: []
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    runtime.recordBlockMutation(0, 0, 4, 5, 6, { type: 'stone', orientation: 1 });
    runtime._world.chunks.get('0,0').blockData = null;

    await runtime.flushBeforeUnload(0, 0, null, null);

    assertEqual(flushCalls.length, 1, '应基于 dirty snapshot 成功 flushBeforeUnload');
    assertDeepEqual(flushCalls[0].record.blockData[baseCode], { type: 'dirt', orientation: 0 }, '应保留初始方块');
    assertDeepEqual(flushCalls[0].record.blockData[newCode], { type: 'stone', orientation: 1 }, '应写出增量修改方块');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - 应同步更新已加载 region cache，避免同会话 reload 读到旧 chunkRecord', async () => {
    const originalWorldStore = globalThis._worldStore;
    const staleCode = encodeCoord(1, 2, 3);
    const freshCode = encodeCoord(4, 5, 6);
    const savedRecords = [];

    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
        savedRecords.push({ cx, cz, record });
        return true;
      },
      getRegionRecord: async () => null
    };

    const runtime = new WorldRuntime();
    runtime._regionCache.set('0,0', {
      regionKey: '0,0',
      rx: 0,
      rz: 0,
      chunkKeys: ['0,0'],
      chunks: {
        '0,0': {
          blockData: { [staleCode]: { type: 'dirt', orientation: 0 } },
          staticEntities: [],
          runtimeSeedData: { structureCenters: [] },
          runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
        }
      }
    });

    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          cx: 0,
          cz: 0,
          blockData: new Map([[freshCode, { type: 'stone', orientation: 1 }]]),
          staticEntities: [],
          structureCenters: [],
          runtimeSeedData: {}
        }]
      ])
    });

    await runtime.flushBeforeUnload(0, 0, null, {
      turrets: [{ id: 't1', position: { x: 4, y: 5, z: 6 }, rotation: 0 }],
      zombieNests: [],
      minecarts: []
    });

    assertEqual(savedRecords.length, 1, '应写回 worldStore 一次');

    const result = await runtime.ensureChunkData(0, 0);
    assertEqual(result.status, 'ready', 'flush 后应仍可从缓存读取 chunk');
    assertDeepEqual(result.chunkRecord.blockData, {
      [freshCode]: { type: 'stone', orientation: 1 }
    }, '同会话 reload 应读到最新 blockData，而不是旧 region cache');
    assertDeepEqual(result.chunkRecord.runtimeEntities, {
      turrets: [{ id: 't1', position: { x: 4, y: 5, z: 6 }, rotation: 0 }],
      zombieNests: [],
      minecarts: []
    }, '同会话 reload 应读到最新 runtimeEntities');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushChunk - 仅实体脏化时应优先复用 region cache 中已序列化的 blockData', async () => {
    const originalWorldStore = globalThis._worldStore;
    const cachedCode = encodeCoord(1, 2, 3);
    const cachedBlockData = {
      [cachedCode]: { type: 'dirt', orientation: 0 }
    };
    const flushCalls = [];

    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
        flushCalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    runtime._regionCache.set('0,0', {
      regionKey: '0,0',
      rx: 0,
      rz: 0,
      chunkKeys: ['0,0'],
      chunks: {
        '0,0': {
          blockData: cachedBlockData,
          staticEntities: [],
          runtimeSeedData: { structureCenters: [] },
          runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
        }
      }
    });
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[cachedCode, { type: 'stone', orientation: 1 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });
    runtime._serializeBlockData = (blockData) => {
      if (blockData instanceof Map) {
        throw new Error('不应回退到 live blockData Map 序列化');
      }
      return blockData;
    };

    runtime.markChunkDirty(0, 0);
    await runtime.flushChunk(0, 0);

    assertEqual(flushCalls.length, 1, '应成功 flush 一次');
    assertEqual(flushCalls[0].record.blockData, cachedBlockData, '应直接复用 region cache 中的已序列化 blockData');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushAllDirty - 仅实体脏化时应优先复用 region cache 中已序列化的 blockData', async () => {
    const originalWorldStore = globalThis._worldStore;
    const originalEvents = globalThis.__CHUNK_PERF_EVENTS;
    const cachedCode = encodeCoord(7, 8, 9);
    const cachedBlockData = {
      [cachedCode]: { type: 'grass', orientation: 0 }
    };
    const savedRegions = [];

    globalThis.CHUNK_PERF_DEBUG = { enabled: true, thresholdMs: 0 };
    globalThis.__CHUNK_PERF_EVENTS = [];
    globalThis._worldStore = {
      saveRegionRecord: async (rx, rz, region) => {
        savedRegions.push({ rx, rz, region });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    runtime._regionCache.set('0,0', {
      regionKey: '0,0',
      rx: 0,
      rz: 0,
      chunkKeys: ['0,0'],
      chunks: {
        '0,0': {
          blockData: cachedBlockData,
          staticEntities: [],
          runtimeSeedData: { structureCenters: [] },
          runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
        }
      }
    });
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[cachedCode, { type: 'stone', orientation: 1 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });
    runtime._serializeBlockData = (blockData) => {
      if (blockData instanceof Map) {
        throw new Error('flushAllDirty 不应回退到 live blockData Map 序列化');
      }
      return blockData;
    };

    runtime.markChunkDirty(0, 0);
    await runtime.flushAllDirty();

    assertEqual(savedRegions.length, 1, '应写回所属 region 一次');
    assertEqual(savedRegions[0].region.chunks['0,0'].blockData, cachedBlockData, '应直接复用 region cache 中的已序列化 blockData');

    const perfEvent = globalThis.__CHUNK_PERF_EVENTS.find((event) => event.label === 'world-runtime.flush-all-dirty');
    assertTrue(!!perfEvent, '应记录 flushAllDirty perf 事件');
    assertEqual(perfEvent.details.blockCount, 1, 'perf 事件应记录 block 数量');
    assertTrue(typeof perfEvent.details.serializedBytes === 'number', 'perf 事件应记录对象大小');

    globalThis.CHUNK_PERF_DEBUG = false;
    globalThis.__CHUNK_PERF_EVENTS = originalEvents;
    globalThis._worldStore = originalWorldStore;
  });
});
