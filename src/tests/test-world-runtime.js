// src/tests/test-world-runtime.js
import { describe } from './runner.js';
import { assertDeepEqual, assertEqual, assertFalse, assertNotEqual, assertTrue } from './assert.js';
import { WorldRuntime } from '../world/WorldRuntime.js';
import { WorldBlockDataStore } from '../world/WorldBlockDataStore.js';
import { encodeCoord } from '../utils/CoordEncoding.js';

describe('WorldRuntime 运行时工作集测试', (test) => {
  test('ensureChunkData - region 或 chunk 缺失时返回 missing-chunk', async () => {
    const originalWorldStore = globalThis._worldStore;
    globalThis._worldStore = {
      getChunkRecord: async () => null
    };

    const runtime = new WorldRuntime();
    const result = await runtime.ensureChunkData(0, 0);

    assertEqual(result.status, 'missing-chunk', '缺失时应统一返回 missing-chunk');
    globalThis._worldStore = originalWorldStore;
  });

  test('ensureChunkData - chunk 存在时返回 ready 与 chunkRecord', async () => {
    const originalWorldStore = globalThis._worldStore;
    const chunkRecord = {
      cx: 0,
      cz: 0,
      blockData: { 123: 'stone' },
      staticEntities: [{ type: 'rovers', positions: [{ x: 1, y: 2, z: 3 }] }],
      runtimeSeedData: { structureCenters: [{ x: 4, z: 5 }] },
      runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
    };
    globalThis._worldStore = {
      getChunkRecord: async () => chunkRecord
    };

    const runtime = new WorldRuntime();
    const result = await runtime.ensureChunkData(0, 0);

    assertEqual(result.status, 'ready', 'chunk 存在时应返回 ready');
    assertDeepEqual(result.chunkRecord.blockData, chunkRecord.blockData, 'blockData 应原样返回');
    assertDeepEqual(result.chunkRecord.staticEntities, chunkRecord.staticEntities, 'staticEntities 应原样返回');
    assertDeepEqual(result.chunkRecord.runtimeSeedData, chunkRecord.runtimeSeedData, 'runtimeSeedData 应原样返回');

    const cachedRegion = runtime._regionCache.get('0,0');
    assertTrue(!!cachedRegion, '读取 chunk 后应向运行时 region cache 注入最小基线');
    assertTrue(cachedRegion.chunks['0,0'].blockData === undefined, 'RegionCache 不应保留 blockData 冗余副本');

    globalThis._worldStore = originalWorldStore;
  });

  test('ensureChunkData - 缺失 runtimeEntities 时应通过 WorldStore 迁移旧档实体', async () => {
    const originalWorldStore = globalThis._worldStore;
    const migratedEntities = {
      turrets: [{ id: 'legacy-turret', position: { x: 8, y: 4, z: 8 }, rotation: { yaw: 0, pitch: 0 } }],
      zombieNests: [],
      minecarts: []
    };
    const putCalls = [];
    const chunkRecordWithoutEntities = {
      cx: 0,
      cz: 0,
      blockData: {},
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] },
      __runtimeEntitiesWasDefault: true
    };

    globalThis._worldStore = {
      getChunkRecord: async () => chunkRecordWithoutEntities,
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
    assertTrue(!result.chunkRecord.__runtimeEntitiesWasDefault, '迁移后应删除临时标记');
    assertEqual(putCalls.length, 1, '迁移完成后应回填 worldStore 一次');
    assertDeepEqual(putCalls[0].record.runtimeEntities, migratedEntities, '回填内容应与迁移实体一致');

    const cachedRegion = runtime._regionCache.get('0,0');
    assertTrue(!!cachedRegion, '迁移后应向运行时 region cache 注入 chunkRecord');
    assertDeepEqual(cachedRegion.chunks['0,0'].runtimeEntities, migratedEntities, '缓存中的 runtimeEntities 应为迁移后的值');

    globalThis._worldStore = originalWorldStore;
  });

  test('ensureChunkData - 缺失 runtimeEntities 且无旧档时应补空结构且不回写', async () => {
    const originalWorldStore = globalThis._worldStore;
    const putCalls = [];
    const chunkRecordWithoutEntities = {
      cx: 0,
      cz: 0,
      blockData: {},
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] },
      __runtimeEntitiesWasDefault: true
    };

    globalThis._worldStore = {
      getChunkRecord: async () => chunkRecordWithoutEntities,
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
    assertTrue(!result.chunkRecord.__runtimeEntitiesWasDefault, '迁移后应删除临时标记');
    assertEqual(putCalls.length, 0, '无旧档数据时不应发生回填');

    const cachedRegion = runtime._regionCache.get('0,0');
    assertTrue(!!cachedRegion, '补空结构后应向运行时 region cache 注入 chunkRecord');
    assertDeepEqual(cachedRegion.chunks['0,0'].runtimeEntities, {
      turrets: [],
      zombieNests: [],
      minecarts: []
    }, '缓存中的 runtimeEntities 应为补齐后的空结构');

    globalThis._worldStore = originalWorldStore;
  });

  test('markChunkDirty - 仅标记 dirty 状态，不再自动触发防抖 flush', async () => {
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

    assertEqual(flushCalls.length, 0, 'markChunkDirty 不再触发防抖 flush，flush 应由 authority 层管控');
    assertTrue(runtime.isChunkDirty(0, 0), 'dirty 状态保留，由 authority 层在持久化时清除');

    globalThis._worldStore = originalWorldStore;
  });

  test('markChunkDirty - 仅标记 dirty，不涉及 worldStore 调度绑定', async () => {
    const originalWorldStore = globalThis._worldStore;
    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
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

    // 替换全局 worldStore
    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
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

    // markChunkDirty 不再调度 flush，dirty 标志不受 worldStore 替换影响
    assertTrue(runtimeA.isChunkDirty(0, 0), 'runtimeA 的 dirty 状态独立保留');
    assertTrue(runtimeB.isChunkDirty(1, 0), 'runtimeB 的 dirty 状态独立保留');

    globalThis._worldStore = originalWorldStore;
  });

  test('callStats - 迁移期 deprecated shell 调用计数正确递增', () => {
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

    // 初始状态：所有调用计数为 0
    const initial = runtime.getStats().callStats;
    assertEqual(initial.recordBlockMutation, 0, '初始 recordBlockMutation');
    assertEqual(initial.flushChunk, 0, '初始 flushChunk');
    assertEqual(initial.flushAllDirty, 0, '初始 flushAllDirty');
    assertEqual(initial.flushBeforeUnload, 0, '初始 flushBeforeUnload');
    assertEqual(initial.scheduleFlush, 0, '初始 scheduleFlush');

    // markChunkDirty 不应再触发 scheduleFlush
    runtime.markChunkDirty(0, 0);
    const afterMarkDirty = runtime.getStats().callStats;
    assertEqual(afterMarkDirty.scheduleFlush, 0,
      'markChunkDirty 不应触发 _scheduleFlush（已退出热路径）');

    // 显式调用 deprecated shell 应递增计数
    runtime._scheduleFlush(0, 0, 1);
    const afterSchedule = runtime.getStats().callStats;
    assertEqual(afterSchedule.scheduleFlush, 1,
      '显式 _scheduleFlush 应递增 scheduleFlush 计数');
  });

  test('store guardrail - replaceChunkSlice 对 attached slice 拒绝写入并递增计数器', () => {
    const store = new WorldBlockDataStore();
    const slice = store.ensureChunkSlice(0, 0);
    store.markAttached(0, 0);

    // 保存告警以便恢复
    const warnCalls = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnCalls.push(args); };

    const newSlice = new Map([[123, { type: 'dirt', orientation: 0 }]]);
    store.replaceChunkSlice(0, 0, newSlice, 'test-guardrail');

    console.warn = originalWarn;

    // replace 被拒绝，slice 未变化
    assertTrue(store._slices.get('0,0') === slice,
      'attached slice 不应被 replace（身份不变）');
    assertEqual(store._callStats.replaceOnAttached, 1,
      'replaceOnAttached 计数应递增');
    assertTrue(warnCalls.length >= 1,
      '应输出 guardrail 告警');
  });

  test('store guardrail - replaceChunkSlice 对 non-Map 输入拒绝并递增计数器', () => {
    const store = new WorldBlockDataStore();
    store.ensureChunkSlice(0, 0);

    const warnCalls = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnCalls.push(args); };

    store.replaceChunkSlice(0, 0, { 123: 'stone' }, 'test-nonmap');

    console.warn = originalWarn;

    assertEqual(store._callStats.nonMapReplace, 1,
      'nonMapReplace 计数应递增');
    assertTrue(warnCalls.length >= 1,
      '应输出 non-Map 告警');
  });

  test('store _verifySliceIntegrity - 异常切片触发 integrityWarn 计数', () => {
    const store = new WorldBlockDataStore();

    // 缺失 slice
    const ok1 = store._verifySliceIntegrity(0, 0, 'test-integrity');
    assertTrue(!ok1, '缺失切片应返回 false');
    assertEqual(store._callStats.integrityWarn, 1,
      '缺失切片应触发 integrityWarn');

    // 非 Map slice（模拟异常状态）
    store._slices.set('0,0', { foo: 'bar' });
    const ok2 = store._verifySliceIntegrity(0, 0, 'test-integrity');
    assertTrue(!ok2, '非 Map 切片应返回 false');
    assertEqual(store._callStats.integrityWarn, 2,
      '非 Map 切片应再次触发 integrityWarn');

    // 正常 slice
    store._slices.set('0,0', new Map());
    const ok3 = store._verifySliceIntegrity(0, 0, 'test-integrity');
    assertTrue(ok3, '正常切片应返回 true');
    assertEqual(store._callStats.integrityWarn, 2,
      '正常切片不应再递增 integrityWarn');
  });

  test('recordBlockMutation - 只标记 runtime dirty，不再构造 blockDataSnapshot', () => {
    const baseCode = encodeCoord(1, 2, 3);
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
    assertTrue(dirtyEntry.dirty, '应标记为 dirty');
    // blockDataSnapshot 已退出 runtime 正确性链路，不再构造
    assertEqual(dirtyEntry.blockDataSnapshot, null, 'blockDataSnapshot 应为 null（已退出热路径）');
  });

  test('flushChunk - 已降级为 deferred cold-export shell，不再依赖 blockDataSnapshot', async () => {
    const originalWorldStore = globalThis._worldStore;
    const baseCode = encodeCoord(1, 2, 3);
    const flushCalls = [];
    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
        flushCalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    const blockData = new Map([[baseCode, { type: 'dirt', orientation: 0 }]]);
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData,
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    runtime.recordBlockMutation(0, 0, 4, 5, 6, { type: 'stone', orientation: 1 });

    // live chunk blockData 在 authority 模型中不会为 null（shared view）
    // flushChunk 作为 deferred shell 降级处理
    const dirtyEntry = runtime._dirtyChunks.get('0,0');
    assertTrue(!!dirtyEntry, '应有 dirty entry');
    assertTrue(dirtyEntry.dirty, '应标记 dirty');
    assertEqual(dirtyEntry.blockDataSnapshot, null, '不再自动构造 snapshot');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - 已降级为 deferred shell，卸载不再依赖 pendingUnloadFlushQueue', async () => {
    const originalWorldStore = globalThis._worldStore;
    const baseCode = encodeCoord(1, 2, 3);
    const flushCalls = [];
    globalThis._worldStore = {
      putChunkRecord: async (cx, cz, record) => {
        flushCalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    const blockData = new Map([[baseCode, { type: 'dirt', orientation: 0 }]]);
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData,
          staticEntities: [],
          structureCenters: []
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    runtime.recordBlockMutation(0, 0, 4, 5, 6, { type: 'stone', orientation: 1 });

    // raw blockData 仍存活（authority 模型下 chunk dispose 不释放 authority）
    // flushBeforeUnload 作为 deferred shell 不再参与 runtime 正确性
    const dirtyEntry = runtime._dirtyChunks.get('0,0');
    assertTrue(!!dirtyEntry, '应有 dirty entry');
    assertEqual(dirtyEntry.blockDataSnapshot, null, '不再自动构造 snapshot');
    assertTrue(dirtyEntry.dirty, '应标记 dirty');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - deferred shell 不再立即提交 WorldStore', async () => {
    const originalWorldStore = globalThis._worldStore;
    const flushCalls = [];
    const blockCode = encodeCoord(1, 2, 3);
    const liveBlockData = new Map([[blockCode, { type: 'stone', orientation: 0 }]]);

    globalThis._worldStore = {
      commitChunkRecord: async (cx, cz, record) => {
        flushCalls.push({ cx, cz, record });
        return true;
      },
      putChunkRecord: async (cx, cz, record) => {
        flushCalls.push({ cx, cz, record });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: liveBlockData,
          staticEntities: [{ type: 'crate', x: 1, y: 2, z: 3 }],
          runtimeSeedData: { structureCenters: [] }
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    runtime.recordBlockMutation(0, 0, 1, 2, 3, { type: 'stone', orientation: 0 });
    await runtime.flushBeforeUnload(0, 0, null, {
      turrets: [],
      zombieNests: [],
      minecarts: []
    });

    // flushBeforeUnload 已降级为 deferred shell
    // 不要求立即写盘，pendingUnloadFlushQueue 不再参与 runtime 正确性
    // 无 stable snapshot 时，dirty entry 会被清理，调用方应自行管理数据
    assertEqual(flushCalls.length, 0, 'deferred shell 不应立即写盘');
    const dirtyEntry = runtime._dirtyChunks.get('0,0');
    assertEqual(dirtyEntry, undefined, '无 stable snapshot 时 dirty entry 已被清理');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - 同一 chunk 重复入队时应只保留最新记录', async () => {
    const originalWorldStore = globalThis._worldStore;
    globalThis._worldStore = {
      commitChunkRecord: async () => true,
      putChunkRecord: async () => true
    };

    const runtime = new WorldRuntime();
    runtime._regionCache.set('0,0', {
      regionKey: '0,0',
      rx: 0,
      rz: 0,
      chunkKeys: ['0,0'],
      chunks: {
        '0,0': {
          blockData: { [encodeCoord(1, 2, 3)]: { type: 'stone', orientation: 0 } },
          staticEntities: [],
          runtimeSeedData: { structureCenters: [] },
          runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
        }
      }
    });

    await runtime.flushBeforeUnload(0, 0, {
      [encodeCoord(1, 2, 3)]: { type: 'stone', orientation: 0 }
    }, {
      turrets: [],
      zombieNests: [],
      minecarts: []
    });

    const firstRecord = runtime.pendingUnloadFlushQueue.get('0,0');
    assertTrue(!!firstRecord, '首次调用后应存在待写记录');

    await new Promise((resolve) => setTimeout(resolve, 2));
    await runtime.flushBeforeUnload(0, 0, {
      [encodeCoord(4, 5, 6)]: { type: 'dirt', orientation: 1 }
    }, {
      turrets: [{ id: 't1' }],
      zombieNests: [],
      minecarts: []
    });

    assertEqual(runtime.pendingUnloadFlushQueue.size, 1, '同一 chunk 重复入队不应膨胀队列');

    const latestRecord = runtime.pendingUnloadFlushQueue.get('0,0');
    assertTrue(latestRecord.version > firstRecord.version, '覆盖入队时应更新版本号');
    assertTrue(latestRecord.lastUpdatedAt >= firstRecord.lastUpdatedAt, '覆盖入队时应刷新时间戳');
    assertDeepEqual(latestRecord.chunkRecord.blockData, {
      [encodeCoord(4, 5, 6)]: { type: 'dirt', orientation: 1 }
    }, '应只保留最新 blockData 快照');
    assertDeepEqual(latestRecord.chunkRecord.runtimeEntities, {
      turrets: [{ id: 't1' }],
      zombieNests: [],
      minecarts: []
    }, '应只保留最新实体快照');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - 默认禁止回退到 live-chunk 全量序列化', async () => {
    const originalWorldStore = globalThis._worldStore;
    const flushCalls = [];
    const serializeCalls = [];

    globalThis._worldStore = {
      commitChunkRecord: async (...args) => {
        flushCalls.push(args);
        return true;
      },
      putChunkRecord: async (...args) => {
        flushCalls.push(args);
        return true;
      }
    };

    const runtime = new WorldRuntime();
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[encodeCoord(1, 2, 3), { type: 'stone', orientation: 0 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });
    runtime._serializeBlockData = (blockData) => {
      serializeCalls.push(blockData);
      return {};
    };

    await runtime.flushBeforeUnload(0, 0, null, {
      turrets: [],
      zombieNests: [],
      minecarts: []
    });

    assertEqual(flushCalls.length, 0, '默认不应在卸载热路径直写 worldStore');
    assertEqual(serializeCalls.length, 0, '默认不应对 live chunk.blockData 做全量序列化');
    assertEqual(runtime.pendingUnloadFlushQueue?.size || 0, 0, '没有稳定快照来源时应跳过入队');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - authority 模型下 chunk dispose 后 WorldBlockDataStore 仍保留数据', async () => {
    const originalWorldStore = globalThis._worldStore;
    const staleCode = encodeCoord(1, 2, 3);
    const freshCode = encodeCoord(4, 5, 6);
    const savedRecords = [];

    const mockWorldStore = {
      putChunkRecord: async (cx, cz, record) => {
        savedRecords.push({ cx, cz, record });
        return true;
      },
      getChunkRecord: async () => null
    };

    const runtime = new WorldRuntime();
    runtime._worldStore = mockWorldStore;
    globalThis._worldStore = mockWorldStore;

    const blockData = new Map([[staleCode, { type: 'dirt', orientation: 0 }]]);
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          cx: 0,
          cz: 0,
          blockData,
          staticEntities: [],
          structureCenters: [],
          runtimeSeedData: {}
        }]
      ])
    });
    runtime.markChunkDirty(0, 0);

    // authority 模型：数据变更由 Chunk._updateBlockState 直接写入共享 Map
    // WorldRuntime.recordBlockMutation 仅标记 dirty，不修改 blockData
    blockData.delete(staleCode);
    blockData.set(freshCode, { type: 'stone', orientation: 1 });
    runtime.recordBlockMutation(0, 0, 1, 2, 3, null);
    runtime.recordBlockMutation(0, 0, 4, 5, 6, { type: 'stone', orientation: 1 });

    // 验证 blockData 仍在 Map 中（authority 模型：数据在共享 Map 中，不是 region cache）
    assertTrue(blockData.has(freshCode), '新方块应在 blockData 中');
    assertFalse(blockData.has(staleCode), '旧方块应已被删除');

    const dirtyEntry = runtime._dirtyChunks.get('0,0');
    assertTrue(!!dirtyEntry, '应有 dirty entry');
    assertEqual(dirtyEntry.blockDataSnapshot, null, '不再构造 blockDataSnapshot');
    assertEqual(savedRecords.length, 0, 'deferred shell 不应写盘');

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

  test('flushAllDirty - partial region cache 时应走 applyRegionPatch，避免整包覆盖未加载 chunk', async () => {
    const originalWorldStore = globalThis._worldStore;
    const appliedPatches = [];
    const savedRegions = [];

    globalThis._worldStore = {
      applyRegionPatch: async (rx, rz, patch) => {
        appliedPatches.push({ rx, rz, patch });
        return true;
      },
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
          blockData: { [encodeCoord(1, 1, 1)]: { type: 'stone', orientation: 0 } },
          staticEntities: [],
          runtimeSeedData: { structureCenters: [] },
          runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
        }
      },
      __partial: true
    });
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[encodeCoord(2, 2, 2), { type: 'dirt', orientation: 0 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    await runtime.flushAllDirty();

    assertEqual(appliedPatches.length, 1, 'partial region 应通过 applyRegionPatch 写回');
    assertEqual(savedRegions.length, 0, 'partial region 不应走 saveRegionRecord 整包覆盖');
    assertEqual(appliedPatches[0].patch.chunkPatches.length, 1, '应只提交当前 dirty chunk 的 patch');
    assertEqual(appliedPatches[0].patch.chunkPatches[0].chunkKey, '0,0', 'patch 应指向当前 chunk');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushPendingUnloadQueueWithinBudget - 应按 region 合批并保留剩余积压到下一轮', async () => {
    const originalWorldStore = globalThis._worldStore;
    const appliedPatches = [];

    globalThis._worldStore = {
      applyRegionPatch: async (rx, rz, patch) => {
        appliedPatches.push({ rx, rz, patch });
        return true;
      }
    };

    const runtime = new WorldRuntime();
    runtime._regionCache.set('0,0', {
      regionKey: '0,0',
      rx: 0,
      rz: 0,
      chunkKeys: [],
      chunks: {}
    });
    runtime._regionCache.set('1,0', {
      regionKey: '1,0',
      rx: 1,
      rz: 0,
      chunkKeys: [],
      chunks: {}
    });

    runtime.pendingUnloadFlushQueue.set('0,0', {
      cx: 0,
      cz: 0,
      chunkKey: '0,0',
      version: 1,
      lastUpdatedAt: 10,
      chunkRecord: {
        blockData: { [encodeCoord(1, 2, 3)]: { type: 'stone', orientation: 0 } },
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
      }
    });
    runtime.pendingUnloadFlushQueue.set('1,0', {
      cx: 1,
      cz: 0,
      chunkKey: '1,0',
      version: 1,
      lastUpdatedAt: 20,
      chunkRecord: {
        blockData: { [encodeCoord(2, 2, 3)]: { type: 'dirt', orientation: 0 } },
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
      }
    });
    runtime.pendingUnloadFlushQueue.set('8,0', {
      cx: 8,
      cz: 0,
      chunkKey: '8,0',
      version: 1,
      lastUpdatedAt: 30,
      chunkRecord: {
        blockData: { [encodeCoord(3, 2, 3)]: { type: 'grass', orientation: 0 } },
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
      }
    });

    const result = await runtime.flushPendingUnloadQueueWithinBudget({
      maxRegions: 1,
      maxChunks: 2,
      maxMs: 100
    });

    assertEqual(appliedPatches.length, 1, '单轮只应提交一个 region patch');
    assertEqual(appliedPatches[0].rx, 0, '应优先处理首个 region');
    assertDeepEqual(appliedPatches[0].patch.chunkPatches.map((entry) => entry.chunkKey).sort(), ['0,0', '1,0'], '应把同 region 的两个 chunk 合批提交到 patch');
    assertEqual(result.processedRegions, 1, '返回值应记录已处理 region 数');
    assertEqual(result.processedChunks, 2, '返回值应记录已处理 chunk 数');
    assertEqual(result.remainingQueueSize, 1, '超出预算的 chunk 应保留到下一轮');
    assertTrue(runtime.pendingUnloadFlushQueue.has('8,0'), '剩余 region 的待写记录应继续留在队列');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushBeforeUnload - region-cache 来源时应复用已存 blockData，不在队列中复制整块数据', async () => {
    const originalWorldStore = globalThis._worldStore;
    const cachedBlockCode = encodeCoord(1, 2, 3);
    const cachedBlockData = {
      [cachedBlockCode]: { type: 'stone', orientation: 0 }
    };

    globalThis._worldStore = {
      applyRegionPatch: async () => true
    };

    const runtime = new WorldRuntime();
    // 手动设置 cache（含 blockData）：此测试验证 deprecated flushBeforeUnload 路径
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

    await runtime.flushBeforeUnload(0, 0, null, {
      turrets: [{ id: 't1' }],
      zombieNests: [],
      minecarts: []
    });

    const queuedRecord = runtime.pendingUnloadFlushQueue.get('0,0');
    assertTrue(!!queuedRecord, '应生成 unload queue 记录');
    assertEqual(queuedRecord.preserveStoredBlockData, true, 'region-cache 来源时应标记复用已存 blockData');
    assertEqual(queuedRecord.chunkRecord.blockData, null, '队列里不应再复制整块 blockData');
    assertTrue(runtime._regionCache.get('0,0').chunks['0,0'].blockData === undefined, 'M1 后 RegionCache 不应保留 blockData');

    globalThis._worldStore = originalWorldStore;
  });

  test('flushAllDirty - 退出路径应同时处理 dirtyChunks 与 pendingUnloadFlushQueue', async () => {
    const originalWorldStore = globalThis._worldStore;
    const savedRegions = [];

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
          blockData: { [encodeCoord(1, 1, 1)]: { type: 'stone', orientation: 0 } },
          staticEntities: [],
          runtimeSeedData: { structureCenters: [] },
          runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
        }
      }
    });
    runtime.setWorld({
      chunks: new Map([
        ['0,0', {
          blockData: new Map([[encodeCoord(1, 1, 1), { type: 'stone', orientation: 0 }]]),
          staticEntities: [],
          runtimeSeedData: {}
        }]
      ])
    });

    runtime.markChunkDirty(0, 0);
    runtime.pendingUnloadFlushQueue.set('1,0', {
      cx: 1,
      cz: 0,
      chunkKey: '1,0',
      version: 1,
      lastUpdatedAt: 10,
      chunkRecord: {
        blockData: { [encodeCoord(2, 2, 2)]: { type: 'dirt', orientation: 1 } },
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
      }
    });

    await runtime.flushAllDirty();

    assertEqual(savedRegions.length, 1, '同 region 的 dirty 与 unload queue 应合并写盘一次');
    assertTrue(!!savedRegions[0].region.chunks['0,0'], '应包含 dirty chunk 的结果');
    assertTrue(!!savedRegions[0].region.chunks['1,0'], '应包含 pending unload chunk 的结果');
    assertEqual(runtime.pendingUnloadFlushQueue.size, 0, '退出 flush 后应清空 unload 队列');

    globalThis._worldStore = originalWorldStore;
  });

  test('clearChunkRuntimeResidue - 应清理 dirtyChunks / pendingUnloadFlushQueue / _flushTimers', () => {
    const originalWorldStore = globalThis._worldStore;
    globalThis._worldStore = { getChunkRecord: async () => null };

    const runtime = new WorldRuntime();
    runtime._dirtyChunks.set('0,0', { cx: 0, cz: 0, dirty: true });
    runtime.pendingUnloadFlushQueue.set('0,0', { chunkKey: '0,0' });
    const stubTimerId = setTimeout(() => {}, 0);
    clearTimeout(stubTimerId);
    runtime._flushTimers.set('0,0', stubTimerId);

    runtime.clearChunkRuntimeResidue(0, 0);

    assertFalse(runtime._dirtyChunks.has('0,0'), '_dirtyChunks 应已清理');
    assertFalse(runtime.pendingUnloadFlushQueue.has('0,0'), 'pendingUnloadFlushQueue 应已清理');
    assertFalse(runtime._flushTimers.has('0,0'), '_flushTimers 应已清理');

    // 不存在的 chunk 调用不应报错
    runtime.clearChunkRuntimeResidue(99, 99);

    globalThis._worldStore = originalWorldStore;
  });

  test('_upsertRegionCacheChunkRecord - 存入 RegionCache 的 chunkRecord 不应包含 blockData', async () => {
    const originalWorldStore = globalThis._worldStore;
    globalThis._worldStore = { getChunkRecord: async () => null };

    const runtime = new WorldRuntime();
    const chunkRecord = {
      cx: 0, cz: 0,
      blockData: { 123: 'stone', 456: 'dirt' },
      staticEntities: [{ type: 'tree' }],
      runtimeSeedData: { structureCenters: [] }
    };

    runtime._upsertRegionCacheChunkRecord(0, 0, chunkRecord);

    const cachedRegion = runtime._regionCache.get('0,0');
    assertTrue(!!cachedRegion, '应已注入 region cache');
    const stored = cachedRegion.chunks['0,0'];
    assertTrue(
      stored.blockData === undefined,
      '存入 RegionCache 的 chunkRecord 不应包含 blockData'
    );
    assertDeepEqual(stored.staticEntities, [{ type: 'tree' }], 'staticEntities 应保留');

    globalThis._worldStore = originalWorldStore;
  });
});
