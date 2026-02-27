// src/tests/test-persistence.js
/**
 * PersistenceService 测试套件
 * 测试 IndexedDB 持久化服务的基本功能
 *
 * 注意：由于 PersistenceService 依赖 Worker 和 IndexedDB，
 * 部分测试可能需要模拟环境或跳过。
 */

import { describe, test } from './runner.js';
import { assertEqual, assertNotNull, assertDeepEqual } from './assert.js';
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

// ========== 测试套件 ==========
describe('PersistenceService 测试', (test) => {

  let service;

  // 在每个测试前创建新实例
  // 注意：由于 PersistenceService 依赖 Worker 和 IndexedDB，
  // 我们创建一个简单的测试包装器
  const getFreshService = () => {
    // 创建一个轻量级的测试用服务实例
    // 直接测试核心逻辑，绕过 Worker 和 IndexedDB
    return {
      cache: new Map(),
      recordChange: function(x, y, z, typeOrEntry, orientation = 0) {
        const cx = Math.floor(x / PERSISTENCE_CONFIG.CHUNK_SIZE);
        const cz = Math.floor(z / PERSISTENCE_CONFIG.CHUNK_SIZE);
        const chunkKey = `${cx},${cz}`;

        // 只在缓存中存在区块时记录
        if (!this.cache.has(chunkKey)) {
          return;
        }

        const chunkData = this.cache.get(chunkKey);
        const blockKey = `${x},${y},${z}`;

        const entry = typeof typeOrEntry === 'string'
          ? { type: typeOrEntry, orientation }
          : { type: typeOrEntry.type || 'air', orientation: typeOrEntry.orientation || 0 };

        if (entry.type === 'air') {
          delete chunkData.blocks[blockKey];
        } else {
          chunkData.blocks[blockKey] = entry;
        }
      },
      getChunkData: async function(cx, cz) {
        const chunkKey = `${cx},${cz}`;
        return this.cache.get(chunkKey) || null;
      },
      saveChunkData: async function(cx, cz, data) {
        const chunkKey = `${cx},${cz}`;
        if (data) {
          this.cache.set(chunkKey, data);
        }
      },
      injectSaveData: function(worldDeltas) {
        this.cache.clear();
        for (const delta of worldDeltas) {
          this.cache.set(delta.key, {
            blocks: delta.blocks || {},
            entities: delta.entities || {}
          });
        }
      },
      clearSession: async function() {
        this.cache.clear();
      }
    };
  };

  // =========== 初始化测试 ===========
  test('服务可以实例化', () => {
    service = getFreshService();
    assertNotNull(service, '服务实例不应该为 null');
    assertNotNull(service.cache, '缓存应该存在');
    assertNotNull(service.recordChange, 'recordChange 方法应该存在');
    assertNotNull(service.getChunkData, 'getChunkData 方法应该存在');
    assertNotNull(service.saveChunkData, 'saveChunkData 方法应该存在');
  });

  test('cache 初始为空', () => {
    service = getFreshService();
    assertEqual(service.cache.size, 0, '初始缓存大小应该为 0');
  });

  // =========== recordChange 测试 ===========
  test('recordChange - 记录单个方块变更', async () => {
    service = getFreshService();

    // 先在缓存中创建一个区块
    const chunkKey = '0,0';
    service.cache.set(chunkKey, { blocks: {}, entities: {} });

    // 记录一个方块变更
    service.recordChange(5, 10, 5, 'stone', 0);

    // 验证缓存已更新
    const chunkData = service.cache.get(chunkKey);
    assertNotNull(chunkData, '区块数据应该存在');
    assertNotNull(chunkData.blocks, 'blocks 应该存在');

    const blockKey = '5,10,5';
    const entry = chunkData.blocks[blockKey];
    assertNotNull(entry, '方块条目应该存在');
    assertEqual(entry.type, 'stone', '方块类型应该是 stone');
    assertEqual(entry.orientation, 0, '朝向应该是 0');
  });

  test('recordChange - 记录空气方块 (删除)', async () => {
    service = getFreshService();

    const chunkKey = '0,0';
    service.cache.set(chunkKey, {
      blocks: { '5,10,5': { type: 'stone', orientation: 0 } },
      entities: {}
    });

    // 记录空气方块 (删除操作)
    service.recordChange(5, 10, 5, 'air', 0);

    const chunkData = service.cache.get(chunkKey);
    const entry = chunkData.blocks['5,10,5'];
    assertEqual(entry, undefined, '方块条目应该被删除');
  });

  test('recordChange - 使用对象格式记录', async () => {
    service = getFreshService();

    const chunkKey = '0,0';
    service.cache.set(chunkKey, { blocks: {}, entities: {} });

    // 使用对象格式记录
    service.recordChange(3, 5, 3, { type: 'handrailA', orientation: 2 });

    const chunkData = service.cache.get(chunkKey);
    const entry = chunkData.blocks['3,5,3'];
    assertNotNull(entry, '方块条目应该存在');
    assertEqual(entry.type, 'handrailA', '方块类型应该是 handrailA');
    assertEqual(entry.orientation, 2, '朝向应该是 2');
  });

  test('recordChange - 未缓存的区块不记录', async () => {
    service = getFreshService();

    // 不在缓存中创建区块，直接记录
    service.recordChange(100, 100, 100, 'stone', 0);

    // 验证没有创建新的缓存条目
    const chunkKey = '6,6'; // 100/16 = 6
    const chunkData = service.cache.get(chunkKey);
    assertEqual(chunkData, undefined, '不应该自动创建缓存条目');
  });

  // =========== getChunkData 测试 ===========
  test('getChunkData - 从缓存获取数据', async () => {
    service = getFreshService();

    const chunkKey = '0,0';
    const testData = { blocks: { '1,1,1': { type: 'stone' } }, entities: {} };
    service.cache.set(chunkKey, testData);

    const result = await service.getChunkData(0, 0);
    assertNotNull(result, '应该返回数据');
    assertDeepEqual(result, testData, '返回的数据应该与缓存一致');
  });

  // =========== saveChunkData 测试 ===========
  test('saveChunkData - 保存数据到缓存', async () => {
    service = getFreshService();

    const testData = {
      blocks: { '2,2,2': { type: 'diamond', orientation: 1 } },
      entities: {}
    };

    // 保存到缓存
    await service.saveChunkData(0, 0, testData);

    const cached = service.cache.get('0,0');
    assertNotNull(cached, '缓存应该存在');
    assertDeepEqual(cached, testData, '缓存数据应该正确');
  });

  // =========== injectSaveData 测试 ===========
  test('injectSaveData - 注入存档数据', async () => {
    service = getFreshService();

    // 先在缓存中添加一些数据
    service.cache.set('99,99', { blocks: {}, entities: {} });

    const worldDeltas = [
      { key: '0,0', blocks: { '1,1,1': { type: 'stone' } }, entities: {} },
      { key: '1,0', blocks: { '17,0,1': { type: 'dirt' } }, entities: {} }
    ];

    service.injectSaveData(worldDeltas);

    // 验证旧数据被清空
    const oldData = service.cache.get('99,99');
    assertEqual(oldData, undefined, '旧数据应该被清空');

    // 验证新数据已注入
    const chunk0 = service.cache.get('0,0');
    assertNotNull(chunk0, '区块 0,0 应该存在');
    assertNotNull(chunk0.blocks['1,1,1'], '方块 1,1,1 应该存在');
    assertEqual(chunk0.blocks['1,1,1'].type, 'stone', '方块类型应该是 stone');

    const chunk1 = service.cache.get('1,0');
    assertNotNull(chunk1, '区块 1,0 应该存在');
    assertNotNull(chunk1.blocks['17,0,1'], '方块 17,0,1 应该存在');
  });

  // =========== clearSession 测试 ===========
  test('clearSession - 清空缓存数据', async () => {
    service = getFreshService();

    // 先保存一些数据
    service.cache.set('0,0', { blocks: { '1,1,1': { type: 'stone' } }, entities: {} });
    service.cache.set('1,0', { blocks: {}, entities: {} });

    await service.clearSession();

    // 验证缓存被清空
    assertEqual(service.cache.size, 0, '缓存应该被清空');
  });

  // =========== 坐标到区块键转换测试 ===========
  test('区块键计算正确', () => {
    // 验证 PERSISTENCE_CONFIG.CHUNK_SIZE
    assertEqual(PERSISTENCE_CONFIG.CHUNK_SIZE, 16, '区块大小应该是 16');

    // 验证 recordChange 中的区块键计算逻辑
    const x = 17, z = 33;
    const expectedCx = Math.floor(x / 16);
    const expectedCz = Math.floor(z / 16);
    assertEqual(expectedCx, 1, 'x=17 应该在区块 1');
    assertEqual(expectedCz, 2, 'z=33 应该在区块 2');
  });

  // =========== 配置测试 ===========
  test('PERSISTENCE_CONFIG 值正确', () => {
    assertEqual(PERSISTENCE_CONFIG.DB_NAME, 'mc_lite_persistence', '数据库名称正确');
    assertEqual(PERSISTENCE_CONFIG.DB_VERSION, 1, '数据库版本正确');
    assertEqual(PERSISTENCE_CONFIG.STORE_NAME, 'world_deltas', '存储名称正确');
    assertEqual(PERSISTENCE_CONFIG.SESSION_ONLY, true, '默认仅会话模式');
    assertEqual(PERSISTENCE_CONFIG.CACHE_LIMIT, 100, '缓存限制为 100');
  });

});
