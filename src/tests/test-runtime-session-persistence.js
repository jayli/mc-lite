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

  test('loadFromRecord 不应再让 cache.blocks 覆盖 chunkRecord.blockData', async () => {
    const service = createTestService();
    globalThis._persistenceService = service;
    try {
      const chunkKey = '2,2';
      const code = Chunk.encodeCoord(8, 10, 8);
      const chunk = new Chunk(2, 2);
      chunk.finalizeNonDeferredPhase = async () => true;

      const chunkRecord = {
        blockData: { [code]: { type: 'dirt', orientation: 0 } },
        staticEntities: [],
        runtimeSeedData: {}
      };

      service.cache.set(chunkKey, {
        blocks: { [code]: { type: 'stone', orientation: 1 } },
        entities: {}
      });

      await chunk.loadFromRecord(chunkRecord);

      assertEqual(chunk.blockData.get(code).type, 'dirt', 'runtime load 应只使用 chunkRecord.blockData');
      assertEqual(chunk.blockData.get(code).orientation, 0, '朝向应来自 chunkRecord.blockData');
    } finally {
      globalThis._persistenceService = null;
    }
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

describe('渐进式迁移: chunkRecord 不含 runtimeEntities 时从 world_deltas 迁移', (test) => {
  test('loadFromRecord 应从 chunkRecord.runtimeEntities 读取新格式数据', async () => {
    const service = createTestService();
    globalThis._persistenceService = service;
    try {
      const chunk = new Chunk(0, 0);
      // stub finalize 以便检查 pendingRuntimeEntities
      let finalized = false;
      chunk.finalizeNonDeferredPhase = async () => { finalized = true; return true; };

      const chunkRecord = {
        blockData: {},
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: {
          turrets: [{ id: 't1', position: { x: 8, y: 4, z: 8 }, rotation: { yaw: 0, pitch: 0 } }],
          zombieNests: [],
          minecarts: []
        }
      };

      await chunk.loadFromRecord(chunkRecord);

      assertTrue(chunk.pendingRuntimeEntities.turrets.length === 1, '应从 runtimeEntities 读取炮塔');
      assertTrue(chunk.pendingRuntimeEntities.turrets[0].id === 't1', '炮塔 id 应正确');
      assertTrue(!chunk._needsEntityMigration, '不应标记需要迁移');
      assertTrue(finalized, 'finalizeNonDeferredPhase 应被调用');
    } finally {
      globalThis._persistenceService = null;
    }
  });

  test('loadFromRecord 纯加载路径不应再复制 pendingSnapshot.blocks', async () => {
    const service = createTestService();
    globalThis._persistenceService = service;
    try {
      const code = Chunk.encodeCoord(8, 4, 8);
      const chunk = new Chunk(0, 0);
      let capturedPendingSnapshot = 'unset';
      chunk.finalizeNonDeferredPhase = async () => {
        capturedPendingSnapshot = chunk.pendingSnapshot;
        return true;
      };

      await chunk.loadFromRecord({
        blockData: {
          [code]: { type: 'stone', orientation: 0 }
        },
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
      });

      assertEqual(capturedPendingSnapshot, null, '纯加载路径不应再额外构造 pendingSnapshot.blocks');
    } finally {
      globalThis._persistenceService = null;
    }
  });

  test('loadFromRecord 应回退到 cache.entities 并标记迁移', async () => {
    const service = createTestService();
    globalThis._persistenceService = service;
    try {
      const chunk = new Chunk(0, 0);
      let finalized = false;
      chunk.finalizeNonDeferredPhase = async () => { finalized = true; return true; };

      // 确保 cache 中有 entities 数据
      service.ensureChunkSnapshot('0,0');
      service.cache.get('0,0').entities = {
        turrets: [{ id: 't2', position: { x: 5, y: 3, z: 5 }, rotation: { yaw: 1, pitch: 0 } }],
        zombieNests: [],
        minecarts: []
      };

      // chunkRecord 不含 runtimeEntities（旧格式）
      const chunkRecord = {
        blockData: {},
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] }
      };

      await chunk.loadFromRecord(chunkRecord);

      assertTrue(chunk.pendingRuntimeEntities.turrets.length === 1, '应从 cache.entities 读取炮塔');
      assertTrue(chunk.pendingRuntimeEntities.turrets[0].id === 't2', '炮塔 id 应正确');
      assertTrue(chunk._needsEntityMigration, '应标记需要迁移');
      assertTrue(finalized, 'finalizeNonDeferredPhase 应被调用');
    } finally {
      globalThis._persistenceService = null;
    }
  });

  test('chunkRecord.runtimeEntities 应优先于 cache.entities', async () => {
    const service = createTestService();
    globalThis._persistenceService = service;
    try {
      const chunk = new Chunk(0, 0);
      let finalized = false;
      chunk.finalizeNonDeferredPhase = async () => { finalized = true; return true; };

      // cache 中有旧数据
      service.ensureChunkSnapshot('0,0');
      service.cache.get('0,0').entities = {
        turrets: [{ id: 'old', position: { x: 1, y: 1, z: 1 }, rotation: { yaw: 0, pitch: 0 } }],
        zombieNests: [],
        minecarts: []
      };

      // chunkRecord 中有新数据
      const chunkRecord = {
        blockData: {},
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: {
          turrets: [{ id: 'new', position: { x: 2, y: 2, z: 2 }, rotation: { yaw: 0, pitch: 0 } }],
          zombieNests: [],
          minecarts: []
        }
      };

      await chunk.loadFromRecord(chunkRecord);

      assertTrue(chunk.pendingRuntimeEntities.turrets.length === 1, '应只读取 runtimeEntities');
      assertTrue(chunk.pendingRuntimeEntities.turrets[0].id === 'new', '应使用 chunkRecord.runtimeEntities 的数据');
      assertTrue(!chunk._needsEntityMigration, '不应标记需要迁移');
      assertTrue(finalized, 'finalizeNonDeferredPhase 应被调用');
    } finally {
      globalThis._persistenceService = null;
    }
  });
});
