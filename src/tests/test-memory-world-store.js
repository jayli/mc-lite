import { describe } from './runner.js';
import { assertEqual, assertNotNull, assertDeepEqual } from './assert.js';
import { MemoryWorldStore } from '../world/MemoryWorldStore.js';

describe('MemoryWorldStore', (test) => {
  test('createOrReplaceChunkRecord 可写入 chunk', () => {
    const store = new MemoryWorldStore();
    const record = {
      blockData: { 123: 'stone' },
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
    };
    store.createOrReplaceChunkRecord(1, 2, record);
    const retrieved = store.getChunkRecord(1, 2);
    assertNotNull(retrieved);
    assertEqual(retrieved.cx, 1);
    assertEqual(retrieved.cz, 2);
    assertEqual(retrieved.blockData[123], 'stone');
  });

  test('getChunkRecord 读取不存在的 chunk 返回 null', () => {
    const store = new MemoryWorldStore();
    const result = store.getChunkRecord(99, 99);
    assertEqual(result, null);
  });

  test('applyBlockMutation 应立即更新 chunkRecord.blockData', () => {
    const store = new MemoryWorldStore();
    store.createOrReplaceChunkRecord(1, 2, {
      blockData: {},
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: {}
    });
    store.applyBlockMutation(1, 2, 123, 'stone');
    const record = store.getChunkRecord(1, 2);
    assertEqual(record.blockData[123], 'stone');
  });

  test('applyBlockMutation 支持对象 entry', () => {
    const store = new MemoryWorldStore();
    store.createOrReplaceChunkRecord(0, 0, {
      blockData: {},
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: {}
    });
    const entry = { type: 'torch', orientation: 2 };
    store.applyBlockMutation(0, 0, 456, entry);
    const record = store.getChunkRecord(0, 0);
    assertDeepEqual(record.blockData[456], entry);
  });

  test('applyBlockMutation 删除 entry（entry 为 null）', () => {
    const store = new MemoryWorldStore();
    store.createOrReplaceChunkRecord(0, 0, {
      blockData: { 789: 'dirt' },
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: {}
    });
    store.applyBlockMutation(0, 0, 789, null);
    const record = store.getChunkRecord(0, 0);
    assertEqual(record.blockData[789], undefined);
  });

  test('getStats 返回 region/chunk 计数', () => {
    const store = new MemoryWorldStore();
    // chunk(0,0) → region(0,0), chunk(0,1) → region(0,0), chunk(8,0) → region(1,0)
    store.createOrReplaceChunkRecord(0, 0, {
      blockData: {}, staticEntities: [], runtimeSeedData: {}, runtimeEntities: {}
    });
    store.createOrReplaceChunkRecord(0, 1, {
      blockData: {}, staticEntities: [], runtimeSeedData: {}, runtimeEntities: {}
    });
    store.createOrReplaceChunkRecord(8, 0, {
      blockData: {}, staticEntities: [], runtimeSeedData: {}, runtimeEntities: {}
    });
    const stats = store.getStats();
    assertEqual(stats.regionCount, 2);
    assertEqual(stats.chunkCount, 3);
  });

  test('createOrReplaceChunkRecord 覆盖已有 chunk', () => {
    const store = new MemoryWorldStore();
    store.createOrReplaceChunkRecord(0, 0, {
      blockData: { 1: 'dirt' },
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: {}
    });
    store.createOrReplaceChunkRecord(0, 0, {
      blockData: { 2: 'stone' },
      staticEntities: [],
      runtimeSeedData: {},
      runtimeEntities: {}
    });
    const record = store.getChunkRecord(0, 0);
    assertEqual(record.blockData[1], undefined);
    assertEqual(record.blockData[2], 'stone');
  });
});
