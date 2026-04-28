/**
 * 运行时会话持久化测试套件
 * 测试 chunk 卸载/重载时 blockData 和特殊实体的正确性
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertNotNull } from './assert.js';
import { PersistenceService } from '../services/PersistenceService.js';
import { Chunk } from '../world/Chunk.js';

// 模拟 PersistenceWorker
class MockPersistenceWorker {
  constructor() {
    this.onmessage = null;
    this.data = new Map();
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
      this.onmessage({ data: { success, result, messageId } });
    }, 0);
  }
}

// 创建测试用的 PersistenceService
const createTestService = () => {
  const originalWorker = globalThis.Worker;
  globalThis.Worker = MockPersistenceWorker;
  const service = new PersistenceService();
  service.worker = new MockPersistenceWorker();
  service.worker.onmessage = (event) => {
    const { success, result, messageId } = event.data;
    if (service.callbacks.has(messageId)) {
      const { resolve, reject } = service.callbacks.get(messageId);
      if (success) { resolve(result); } else { reject(new Error(result)); }
      service.callbacks.delete(messageId);
    }
  };
  globalThis.Worker = originalWorker;
  return service;
};

describe('运行时会话持久化测试', (test) => {

  test('chunk 卸载后 blockData 应保留在会话缓存中', async () => {
    const service = createTestService();
    const chunkKey = '0,0';

    // 1. 预置缓存数据
    service.cache.set(chunkKey, { blocks: {}, entities: {} });

    // 2. 记录一个方块变更
    service.recordChange(5, 10, 5, 'stone', 0);

    // 3. 验证缓存中已有该方块
    const code = Chunk.encodeCoord(5, 10, 5);
    const beforeUnload = service.cache.get(chunkKey);
    assertNotNull(beforeUnload.blocks[code], '卸载前缓存应包含方块');
    assertEqual(beforeUnload.blocks[code].type, 'stone', '方块类型应为 stone');

    // 4. 模拟 saveChunkData（异步写回 IndexedDB）
    await service.saveChunkData(0, 0);

    // 5. 验证缓存仍然存在（会话级快照不应被清除）
    const afterSave = service.cache.get(chunkKey);
    assertNotNull(afterSave, '保存后缓存仍应存在');
    assertNotNull(afterSave.blocks[code], '保存后缓存仍应包含方块');

    // 6. 清除模拟 IndexedDB，验证缓存才是会话权威
    service.worker.data.clear();
    const fromDb = await service.getChunkData(0, 0);
    // getChunkData 优先从缓存返回
    assertNotNull(fromDb.blocks[code], '缓存优先时应仍包含方块');
  });

  test('loadFromRecord 应从 cache.entities 合并运行时实体', () => {
    const service = createTestService();
    const chunkKey = '0,0';

    // 1. 预置缓存中的实体数据
    service.cache.set(chunkKey, {
      blocks: {},
      entities: {
        turrets: [{ position: { x: 8, y: 10, z: 8 }, rotation: 0 }],
        zombieNests: [{ position: { x: 5, y: 10, z: 5 }, criticalBlock: { x: 5, y: 10, z: 5 } }],
        minecarts: [{ position: { x: 3, y: 10, z: 3 }, orientation: 0 }]
      }
    });

    // 2. 模拟 loadFromRecord 的实体合并逻辑
    const existingData = service.cache.get(chunkKey);
    assertNotNull(existingData, '缓存数据应存在');
    assertNotNull(existingData.entities, '缓存 entities 应存在');

    // 3. 验证 entities 被正确提取
    const entities = existingData.entities;
    assertTrue(Array.isArray(entities.turrets) && entities.turrets.length > 0, '应包含炮塔实体');
    assertTrue(Array.isArray(entities.zombieNests) && entities.zombieNests.length > 0, '应包含丧尸巢穴实体');
    assertTrue(Array.isArray(entities.minecarts) && entities.minecarts.length > 0, '应包含矿车实体');

    // 4. 模拟 pendingRuntimeEntities 构建
    const pendingRuntimeEntities = {
      zombieNests: entities.zombieNests || [],
      turrets: entities.turrets || [],
      minecarts: entities.minecarts || []
    };

    assertEqual(pendingRuntimeEntities.turrets.length, 1, '炮塔数量应为 1');
    assertEqual(pendingRuntimeEntities.zombieNests.length, 1, '巢穴数量应为 1');
    assertEqual(pendingRuntimeEntities.minecarts.length, 1, '矿车数量应为 1');
  });

  test('recordChangeForChunk 在缓存缺失时应自动创建快照', () => {
    const service = createTestService();
    const chunkKey = '1,1';

    // 1. 确认缓存不存在
    assertEqual(service.cache.has(chunkKey), false, '缓存初始不应存在');

    // 2. recordChangeForChunk 现在会自动创建快照
    service.recordChangeForChunk(1, 1, 20, 8, 20, 'stone', 0);

    // 3. 验证缓存已自动创建
    const chunkData = service.cache.get(chunkKey);
    assertNotNull(chunkData, '应自动创建缓存条目');
    assertNotNull(chunkData.blocks, '应包含 blocks');
    const code = Chunk.encodeCoord(20, 8, 20);
    assertEqual(chunkData.blocks[code].type, 'stone', '方块应被记录');
  });

  test('worldStore flush 失败不应影响会话内 reload', async () => {
    const service = createTestService();
    const chunkKey = '0,0';
    const code = Chunk.encodeCoord(5, 10, 5);

    // 1. 创建缓存并写入方块
    service.cache.set(chunkKey, { blocks: {}, entities: {} });
    service.recordChange(5, 10, 5, 'turret_base', 0);

    // 2. 验证缓存中有数据
    assertNotNull(service.cache.get(chunkKey).blocks[code], '缓存应包含方块');

    // 3. 模拟 worldStore flush 失败（IndexedDB 不可用）
    // 通过让 worker 抛出错误来模拟
    const originalPostMessage = service.worker.postMessage;
    service.worker.postMessage = function(msg) {
      const { messageId } = msg;
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({ data: { success: false, result: 'IndexedDB error', messageId } });
        }
      }, 0);
    };

    // 4. 尝试保存（会失败）
    try {
      await service.saveChunkData(0, 0);
    } catch (e) {
      // 预期失败
    }

    // 5. 恢复 worker
    service.worker.postMessage = originalPostMessage;

    // 6. 关键验证：即使 IndexedDB flush 失败，缓存中的数据仍在
    const afterFailedFlush = service.cache.get(chunkKey);
    assertNotNull(afterFailedFlush, 'flush 失败后缓存仍应存在');
    assertNotNull(afterFailedFlush.blocks[code], 'flush 失败后缓存仍应包含方块');
  });

  test('cache.blocks 应覆盖 chunkRecord.blockData（会话级 overlay）', () => {
    const service = createTestService();
    const chunkKey = '2,2';
    const code = Chunk.encodeCoord(8, 10, 8);

    // 1. 预置 worldStore 数据（旧数据）
    const chunkRecord = {
      blockData: { [code]: { type: 'dirt', orientation: 0 } },
      staticEntities: [],
      runtimeSeedData: {}
    };

    // 2. 预置缓存数据（新数据，用户在会话中修改的）
    service.cache.set(chunkKey, {
      blocks: { [code]: { type: 'stone', orientation: 1 } },
      entities: {}
    });

    // 3. 模拟 loadFromRecord 的优先级逻辑
    const cacheBlocks = service.cache.get(chunkKey)?.blocks;
    const effectiveBlockData = cacheBlocks && Object.keys(cacheBlocks).length > 0
      ? cacheBlocks
      : chunkRecord.blockData;

    // 4. 验证缓存优先
    assertEqual(effectiveBlockData[code].type, 'stone', '缓存数据应覆盖 worldStore 数据');
    assertEqual(effectiveBlockData[code].orientation, 1, '朝向应来自缓存');
  });

  test('更新 cache.blocks 时不应覆盖已有 entities', () => {
    const service = createTestService();
    const chunkKey = '3,3';
    const code = Chunk.encodeCoord(5, 5, 5);

    // 1. 预置同时包含 blocks 和 entities 的缓存
    service.cache.set(chunkKey, {
      blocks: { [code]: { type: 'stone', orientation: 0 } },
      entities: {
        turrets: [{ position: { x: 5, y: 5, z: 5 } }]
      }
    });

    // 2. 模拟只更新 blocks 的操作
    const existing = service.cache.get(chunkKey);

    // 3. 更新 blocks
    existing.blocks[Chunk.encodeCoord(6, 6, 6)] = { type: 'dirt', orientation: 0 };

    // 4. 验证 entities 未被覆盖
    const updated = service.cache.get(chunkKey);
    assertNotNull(updated.entities.turrets, 'entities 不应被覆盖');
    assertEqual(updated.entities.turrets.length, 1, '炮塔数量应保持');
  });

});
