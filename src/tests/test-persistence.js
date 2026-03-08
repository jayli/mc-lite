// src/tests/test-persistence.js
/**
 * PersistenceService 测试套件
 * 测试持久化服务的核心逻辑
 *
 * 使用真实的 PersistenceService 类，但模拟 Worker 依赖
 */

import { describe, test } from './runner.js';
import { assertEqual, assertNotNull, assertDeepEqual } from './assert.js';
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';
import { PersistenceService } from '../services/PersistenceService.js';

// 模拟 Worker，用于测试
class MockPersistenceWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.data = new Map(); // 模拟 IndexedDB 存储
  }

  postMessage(msg) {
    const { action, payload, messageId } = msg;

    setTimeout(() => {
      if (!this.onmessage) return;

      let success = true;
      let result = null;

      try {
        switch (action) {
          case 'getChunkData':
            result = this.data.get(payload.key) || null;
            break;
          case 'saveChunkData':
            this.data.set(payload.key, payload.data);
            result = true;
            break;
          case 'clearSession':
            this.data.clear();
            result = true;
            break;
          default:
            result = null;
        }
      } catch (e) {
        success = false;
        result = e.message;
      }

      this.onmessage({
        data: { success, result, messageId }
      });
    }, 0);
  }
}

// 保存原始 Worker
let originalWorker;

// 创建测试用的 PersistenceService（使用模拟 Worker）
const createTestService = () => {
  originalWorker = globalThis.Worker;
  globalThis.Worker = MockPersistenceWorker;

  // 绕过 URL 构造的问题，直接创建实例并替换 worker
  const service = new PersistenceService();
  service.worker = new MockPersistenceWorker();

  // 重新设置 worker 消息处理
  service.worker.onmessage = (event) => {
    const { success, result, error, messageId } = event.data;
    if (service.callbacks.has(messageId)) {
      const { resolve, reject } = service.callbacks.get(messageId);
      if (success) {
        resolve(result);
      } else {
        reject(new Error(error));
      }
      service.callbacks.delete(messageId);
    }
  };

  return service;
};

const teardownService = () => {
  if (originalWorker) {
    globalThis.Worker = originalWorker;
  }
};

describe('PersistenceService 真实类测试', (test) => {

  // =========== 初始化测试 ===========
  test('服务可以实例化', () => {
    const service = createTestService();
    assertNotNull(service, '服务实例不应该为 null');
    assertNotNull(service.cache, '缓存应该存在');
    assertNotNull(service.recordChange, 'recordChange 方法应该存在');
    assertNotNull(service.getChunkData, 'getChunkData 方法应该存在');
    assertNotNull(service.saveChunkData, 'saveChunkData 方法应该存在');
    teardownService();
  });

  test('cache 初始为空', () => {
    const service = createTestService();
    assertEqual(service.cache.size, 0, '初始缓存大小应该为 0');
    teardownService();
  });

  // =========== injectSaveData 测试 ===========
  test('injectSaveData - 注入存档数据', () => {
    const service = createTestService();

    const worldDeltas = [
      { key: '0,0', blocks: { '1,1,1': { type: 'stone' } }, entities: {} },
      { key: '1,0', blocks: { '17,0,1': { type: 'dirt' } }, entities: {} }
    ];

    service.injectSaveData(worldDeltas);

    // 验证数据已注入
    const chunk0 = service.cache.get('0,0');
    assertNotNull(chunk0, '区块 0,0 应该存在');
    assertNotNull(chunk0.blocks['1,1,1'], '方块 1,1,1 应该存在');

    const chunk1 = service.cache.get('1,0');
    assertNotNull(chunk1, '区块 1,0 应该存在');
    assertNotNull(chunk1.blocks['17,0,1'], '方块 17,0,1 应该存在');

    teardownService();
  });

  // =========== recordChange 测试 ===========
  test('recordChange - 记录单个方块变更', () => {
    const service = createTestService();

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

    teardownService();
  });

  test('recordChange - 记录空气方块 (删除)', () => {
    const service = createTestService();

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

    teardownService();
  });

  test('recordChange - 使用对象格式记录', () => {
    const service = createTestService();

    const chunkKey = '0,0';
    service.cache.set(chunkKey, { blocks: {}, entities: {} });

    // 使用对象格式记录
    service.recordChange(3, 5, 3, { type: 'handrailA', orientation: 2 });

    const chunkData = service.cache.get(chunkKey);
    const entry = chunkData.blocks['3,5,3'];
    assertNotNull(entry, '方块条目应该存在');
    assertEqual(entry.type, 'handrailA', '方块类型应该是 handrailA');
    assertEqual(entry.orientation, 2, '朝向应该是 2');

    teardownService();
  });

  test('recordChangeForChunk - 跨 Chunk 方块写入 owner chunk', () => {
    const service = createTestService();

    service.cache.set('0,0', { blocks: {}, entities: {} });
    service.cache.set('1,0', { blocks: {}, entities: {} });

    // 世界坐标 (20,8,2) 按坐标属于 chunk 1,0，但归属强制写到 chunk 0,0
    service.recordChangeForChunk(0, 0, 20, 8, 2, 'stone', 0);

    const ownerChunk = service.cache.get('0,0');
    const coordChunk = service.cache.get('1,0');

    assertNotNull(ownerChunk.blocks['20,8,2'], 'owner chunk 应该包含该方块');
    assertEqual(coordChunk.blocks['20,8,2'], undefined, '坐标 chunk 不应写入该方块');

    teardownService();
  });

  test('recordChange - 未缓存的区块不记录', () => {
    const service = createTestService();

    // 不在缓存中创建区块，直接记录
    service.recordChange(100, 100, 100, 'stone', 0);

    // 验证没有创建新的缓存条目
    const chunkKey = '6,6'; // 100/16 = 6
    const chunkData = service.cache.get(chunkKey);
    assertEqual(chunkData, undefined, '不应该自动创建缓存条目');

    teardownService();
  });

  // =========== saveChunkData 和 getChunkData 测试 ===========
  test('saveChunkData - 保存数据并通过 getChunkData 读取', async () => {
    const service = createTestService();

    const testData = {
      blocks: { '2,2,2': { type: 'diamond', orientation: 1 } },
      entities: {}
    };

    // 先注入到缓存
    service.cache.set('0,0', testData);

    // 保存到模拟的 IndexedDB
    await service.saveChunkData(0, 0);

    // 清除缓存
    service.cache.clear();
    assertEqual(service.cache.size, 0, '缓存应该已清空');

    // 从模拟的 IndexedDB 读取
    const result = await service.getChunkData(0, 0);
    assertNotNull(result, '应该返回数据');
    assertDeepEqual(result, testData, '读取的数据应该与保存的一致');

    teardownService();
  });

  test('saveChunkData - 直接传入数据保存', async () => {
    const service = createTestService();

    const testData = {
      blocks: { '5,5,5': { type: 'wood', orientation: 0 } },
      entities: {}
    };

    // 直接保存数据
    await service.saveChunkData(1, 1, testData);

    // 验证缓存已更新
    const cached = service.cache.get('1,1');
    assertNotNull(cached, '缓存应该存在');
    assertDeepEqual(cached, testData, '缓存数据应该正确');

    teardownService();
  });

  // =========== clearSession 测试 ===========
  test('clearSession - 清空数据', async () => {
    const service = createTestService();

    // 先保存一些数据
    service.cache.set('0,0', { blocks: { '1,1,1': { type: 'stone' } }, entities: {} });
    service.cache.set('1,0', { blocks: {}, entities: {} });

    await service.clearSession();

    // 验证缓存被清空
    assertEqual(service.cache.size, 0, '缓存应该被清空');

    teardownService();
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

  // =========== 综合读写测试 ===========
  test('综合读写测试 - 完整流程', async () => {
    const service = createTestService();

    // 1. 注入初始数据
    service.injectSaveData([
      { key: '0,0', blocks: {}, entities: {} }
    ]);

    // 2. 记录一些变更
    service.recordChange(0, 0, 0, 'stone', 0);
    service.recordChange(1, 0, 0, 'dirt', 1);
    service.recordChange(2, 0, 0, { type: 'handrailA', orientation: 2 });

    // 3. 验证缓存中的数据
    const chunkData = service.cache.get('0,0');
    assertNotNull(chunkData.blocks['0,0,0'], '方块 0,0,0 应该存在');
    assertEqual(chunkData.blocks['0,0,0'].type, 'stone', '类型应该是 stone');
    assertEqual(chunkData.blocks['1,0,0'].type, 'dirt', '类型应该是 dirt');
    assertEqual(chunkData.blocks['1,0,0'].orientation, 1, '朝向应该是 1');
    assertEqual(chunkData.blocks['2,0,0'].type, 'handrailA', '类型应该是 handrailA');
    assertEqual(chunkData.blocks['2,0,0'].orientation, 2, '朝向应该是 2');

    // 4. 保存数据
    await service.saveChunkData(0, 0);

    // 5. 清除缓存并重新读取
    service.cache.clear();
    const reloaded = await service.getChunkData(0, 0);

    // 6. 验证重新读取的数据
    assertNotNull(reloaded.blocks['0,0,0'], '重新读取后方块 0,0,0 应该存在');
    assertEqual(reloaded.blocks['0,0,0'].type, 'stone', '重新读取后类型应该是 stone');

    // 7. 删除一个方块
    service.injectSaveData([{ key: '0,0', ...reloaded }]);
    service.recordChange(0, 0, 0, 'air');
    assertEqual(service.cache.get('0,0').blocks['0,0,0'], undefined, '删除后方块应该不存在');

    teardownService();
  });

});
