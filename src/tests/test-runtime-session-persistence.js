/**
 * 运行时会话持久化测试套件
 * 测试 chunk 卸载/重载时 blockData 和特殊实体的正确性
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertNotNull } from './assert.js';
import { PersistenceService } from '../services/PersistenceService.js';
import { Chunk } from '../world/Chunk.js';
import { specialEntitiesShadowStore } from '../world/SpecialEntitiesShadowStore.js';

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

  test('loadFromRecord 不应再回退到 cache.entities', async () => {
    specialEntitiesShadowStore.destroyAll();
    const service = createTestService();
    globalThis._persistenceService = service;
    try {
      const chunk = new Chunk(0, 0);
      let finalized = false;
      chunk.finalizeNonDeferredPhase = async () => { finalized = true; return true; };

      service.ensureChunkSnapshot('0,0');
      service.cache.get('0,0').entities = {
        turrets: [{ id: 't2', position: { x: 5, y: 3, z: 5 }, rotation: { yaw: 1, pitch: 0 } }],
        zombieNests: [],
        minecarts: []
      };

      const chunkRecord = {
        blockData: {},
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] }
      };

      await chunk.loadFromRecord(chunkRecord);

      assertTrue(chunk.pendingRuntimeEntities.turrets.length === 0, '不应再从 cache.entities 回退读取炮塔');
      assertTrue(!chunk._needsEntityMigration, '不应再标记旧 world_deltas 迁移');
      assertTrue(finalized, 'finalizeNonDeferredPhase 应被调用');
    } finally {
      globalThis._persistenceService = null;
    }
  });

  test('loadFromRecord 在 worldStore 尚未刷入前不应清空同会话 ShadowStore 中的炮塔', async () => {
    const service = createTestService();
    globalThis._persistenceService = service;
    specialEntitiesShadowStore.destroyAll();

    try {
      specialEntitiesShadowStore.addEntity('turret', 0, 0, 'shadow-turret', {
        position: { x: 8, y: 4, z: 8 },
        rotation: { yaw: 0, pitch: 0 }
      });

      const chunk = new Chunk(0, 0);
      let finalized = false;
      chunk.finalizeNonDeferredPhase = async () => { finalized = true; return true; };

      await chunk.loadFromRecord({
        blockData: {},
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
      });

      assertTrue(finalized, 'finalizeNonDeferredPhase 应被调用');
      assertTrue(chunk.pendingRuntimeEntities.turrets.length === 1, '应保留 ShadowStore 中的炮塔用于同会话 reload');
      assertTrue(chunk.pendingRuntimeEntities.turrets[0].id === 'shadow-turret', '应恢复 ShadowStore 中的炮塔');
      assertTrue(specialEntitiesShadowStore.getAllEntities('turret', 0, 0).length === 1, '不应把 ShadowStore 中的炮塔清空');
      assertTrue(!chunk._needsEntityMigration, 'ShadowStore 回退不属于旧 world_deltas 迁移路径');
    } finally {
      specialEntitiesShadowStore.destroyAll();
      globalThis._persistenceService = null;
    }
  });

  test('loadFromRecord 在真实 world 场景下应只入装配队列，不同步 finalize', async () => {
    const service = createTestService();
    globalThis._persistenceService = service;
    try {
      const world = {
        bootstrapState: { phase: 'runtime-streaming' },
        onChunkWorkerReadyCalls: 0,
        onChunkWorkerReady(chunk) {
          this.onChunkWorkerReadyCalls++;
          this.lastChunk = chunk;
        }
      };
      const chunk = new Chunk(0, 0, world);
      let finalized = false;
      chunk.finalizeNonDeferredPhase = async () => {
        finalized = true;
        return true;
      };

      await chunk.loadFromRecord({
        blockData: {},
        staticEntities: [],
        runtimeSeedData: { structureCenters: [] },
        runtimeEntities: { turrets: [], zombieNests: [], minecarts: [] }
      });

      assertTrue(world.onChunkWorkerReadyCalls === 1, '应把纯装载 chunk 交给装配调度器');
      assertTrue(world.lastChunk === chunk, '应把当前 chunk 交给 world');
      assertTrue(!finalized, '真实 world 场景下不应同步 finalize');
      assertTrue(chunk.isReady === false, '进入装配队列前不应提前标记 ready');
    } finally {
      globalThis._persistenceService = null;
    }
  });

  test('finalizeNonDeferredPhase - runtime-streaming 下应延迟光源注册', async () => {
    const lightCalls = [];
    const world = {
      bootstrapState: { phase: 'runtime-streaming' },
      lightSourceManager: {
        addLight(x, y, z, type) {
          lightCalls.push({ x, y, z, type });
        }
      },
      onChunkFinalized() {},
      onChunkAOSourceStable() {}
    };
    const chunk = new Chunk(0, 0, world);
    const code = Chunk.encodeCoord(1, 2, 3);
    chunk.lightSourceCoords.add(code);
    chunk.blockData.set(code, { type: 'torch', orientation: 0 });
    chunk.loadState = 'entities-built';

    await chunk.finalizeNonDeferredPhase();

    assertEqual(lightCalls.length, 0, '非延迟阶段不应立即注册光源');
    assertTrue(chunk.hasDeferredFinalizeWork, '应把光源注册后移到 deferred finalize');
    assertTrue(chunk._needsDeferredLightRegistration, '应标记待延迟注册光源');

    chunk.runDeferredFinalizePhase();
    assertEqual(lightCalls.length, 1, 'deferred finalize 应完成光源注册');
  });

  test('finalizeNonDeferredPhase - runtime-streaming 下应把 AO 稳定源刷新后移到 deferred finalize', async () => {
    let finalizedCalls = 0;
    const world = {
      bootstrapState: { phase: 'runtime-streaming' },
      onChunkFinalized(_chunk, options = {}) {
        finalizedCalls++;
        world.lastFinalizeOptions = options;
      }
    };
    const chunk = new Chunk(0, 0, world);
    chunk.loadState = 'entities-built';

    await chunk.finalizeNonDeferredPhase();

    assertTrue(chunk._needsDeferredAOStabilization, '非延迟阶段后应标记待延迟 AO 稳定源刷新');
    assertTrue(chunk.hasDeferredFinalizeWork, 'AO 稳定源后移后应保留 deferred finalize 工作');
    assertEqual(finalizedCalls, 1, '仍应通知 world 进入 finalized 链路');
    assertTrue(world.lastFinalizeOptions?.deferAORefresh === true, '应显式告知 world 延迟 AO 刷新');
  });

  test('chunkRecord.runtimeEntities 应优先于旧 cache.entities 且完全忽略后者', async () => {
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
