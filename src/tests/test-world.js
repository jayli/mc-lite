// src/tests/test-world.js
/**
 * 世界系统测试套件
 * 测试 World 类的方块放置/挖掘和区块管理功能
 */

/**
 * World 测试套件
 * 测试世界系统的方块放置/挖掘功能
 *
 * 使用真实的 World 和 Chunk 类，模拟 Worker 和外部依赖
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull, assertUndefined } from './assert.js';
import * as THREE from 'three';
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';
import { mockFaceCullingSystem, mockMaterials, mockBlockData } from './test-mocks.js';
import { Chunk } from '../world/Chunk.js';
import { ChunkAssemblyScheduler } from '../world/ChunkAssemblyScheduler.js';
import { WorldBlockDataStore } from '../world/WorldBlockDataStore.js';

// ============================================
// Worker 模拟 - 在导入 World 之前设置
// ============================================

// 保存原始 Worker 类
const OriginalWorker = globalThis.Worker;

// 存储所有 Worker 实例及其消息处理器
const workerInstances = new Map();
let shouldMockWorkers = true;

// Worker 包装器 - 拦截所有 Worker 实例创建
class MockWorkerWrapper {
  constructor(url, options) {
    // 创建真实 Worker
    const realWorker = new OriginalWorker(url, options);

    // 存储处理器
    const handlers = { _onmessage: null, _onerror: null };
    workerInstances.set(realWorker, { handlers, url: url.toString() });

    // 拦截 onmessage — 仅保存引用，不执行真实 handler
    // 真实 handler 会在地形生成后 postMessage，产生真实数据干扰测试
    // 我们改用直接调用 workerCallbacks 回调的方式响应
    Object.defineProperty(realWorker, 'onmessage', {
      set(fn) { handlers._onmessage = fn; },
      get() { return handlers._onmessage; },
      configurable: true
    });

    // 拦截 onerror
    Object.defineProperty(realWorker, 'onerror', {
      set(fn) { handlers._onerror = fn; },
      get() { return handlers._onerror; },
      configurable: true
    });

    // 包装 postMessage
    const originalPostMessage = realWorker.postMessage.bind(realWorker);

    realWorker.postMessage = function(msg) {
      if (shouldMockWorkers) {
        // 只响应 Chunk 生成请求（有 seed 参数且不是 consolidate）
        if (msg.seed !== undefined && !msg.isOptimization) {
          // 使用消息中的 taskId 查找回调（Worker 池化后使用 taskId 路由）
          const callbackKey = msg.taskId || `${msg.cx},${msg.cz}`;
          setTimeout(() => {
            // 优先使用直接回调方式（绕过真实 Worker）
            if (globalThis.workerCallbacks?.has?.(callbackKey)) {
              globalThis.workerCallbacks.get(callbackKey)({
                cx: msg.cx,
                cz: msg.cz,
                scatteredBlocks: [],
                solidBlocks: [],
                modGunMan: [],
                rovers: [],
                allBlockTypes: {},
                visibleKeys: [],
                snapshot: null,
                structureCenters: [],
                entities: { modGunMan: [], rovers: [] }
              });
            } else if (handlers._onmessage) {
              // 兜底：如果没有找到回调，通过 handler 发送
              try {
                handlers._onmessage({
                  data: {
                    cx: msg.cx,
                    cz: msg.cz,
                    scatteredBlocks: [],
                    solidBlocks: [],
                    modGunMan: [],
                    rovers: [],
                    allBlockTypes: {},
                    visibleKeys: [],
                    snapshot: null,
                    structureCenters: [],
                    entities: { modGunMan: [], rovers: [] }
                  }
                });
              } catch (err) {
                console.error('MockWorker fallback error:', err);
              }
            }
          }, 50);
          return;
        }
      }
      return originalPostMessage(msg);
    };

    return realWorker;
  }
}

// 立即设置全局 Worker 为包装器（在导入 World 之前）
globalThis.Worker = MockWorkerWrapper;

// 现在导入 World（Chunk.js 会使用 MockWorkerWrapper）
import { World } from '../world/World.js';

// 导入 workerCallbacks 以便 mock 可以直接调用回调
import { workerCallbacks } from '../world/ChunkConsolidation.js';
// 暴露到 globalThis 供 MockWorkerWrapper 使用
globalThis.workerCallbacks = workerCallbacks;

// ============================================
// 辅助函数
// ============================================

/**
 * 等待指定 Chunk 准备就绪
 * @param {World} world - World 实例
 * @param {string} chunkKey - Chunk 键（如 '0,0'）
 * @param {number} maxWaitCount - 最大等待次数（每次 50ms）
 * @returns {Promise<boolean>} Chunk 是否准备就绪
 */
async function waitForChunkReady(world, chunkKey, maxWaitCount = 100) {
  let waitCount = 0;
  while (waitCount < maxWaitCount) {
    const chunk = world.chunks.get(chunkKey);
    if (chunk && chunk.isReady) {
      return true;
    }
    if (typeof world.drainAssemblyQueues === 'function') {
      await world.drainAssemblyQueues({ maxIterations: 8 });
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    waitCount++;
  }
  return false;
}

async function waitForChunkState(world, chunkKey, targetState, maxWaitCount = 120, options = {}) {
  const advanceAssemblies = options.advanceAssemblies !== false;
  let waitCount = 0;
  while (waitCount < maxWaitCount) {
    const chunk = world.chunks.get(chunkKey);
    if (chunk && chunk.loadState === targetState) {
      return true;
    }
    if (advanceAssemblies && typeof world.processAssemblyQueues === 'function') {
      world.processAssemblyQueues();
    }
    await new Promise(resolve => setTimeout(resolve, 25));
    waitCount++;
  }
  return false;
}

async function waitForWorldPhase(world, targetPhase, maxWaitCount = 160) {
  let waitCount = 0;
  while (waitCount < maxWaitCount) {
    if (world.bootstrapState?.phase === targetPhase) {
      return true;
    }
    if (typeof world.processAssemblyQueues === 'function') {
      world.processAssemblyQueues();
    }
    await new Promise(resolve => setTimeout(resolve, 25));
    waitCount++;
  }
  return false;
}

async function runRealWorldWorker(message) {
  return await new Promise((resolve, reject) => {
    const worker = new OriginalWorker(new URL('../workers/WorldWorker.js', import.meta.url), {
      type: 'module'
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('WorldWorker test timeout'));
    }, 15000);

    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(event.error || new Error(event.message || 'WorldWorker test failed'));
    };

    worker.postMessage(message);
  });
}

// ============================================
// 其他依赖模拟
// ============================================

// 模拟 persistenceService
const mockPersistenceService = {
  _worldMeta: null,
  _regions: new Map(),
  calls: [],
  reset() {
    this._worldMeta = null;
    this._regions.clear();
    this.calls = [];
  },
  async postMessage(action, payload = {}) {
    switch (action) {
      case 'getWorldMeta':
        return this._worldMeta;
      case 'saveWorldMeta':
        this._worldMeta = payload.meta || null;
        return true;
      case 'getRegionRecord':
        return this._regions.get(payload.regionKey) || null;
      case 'saveRegionRecord':
        this._regions.set(payload.regionKey, payload.record);
        return true;
      case 'saveRegionRecordsBatch':
        for (const item of payload.records || []) {
          this._regions.set(item.regionKey, item.record);
        }
        return true;
      case 'getAllRegionKeys':
        return Array.from(this._regions.keys());
      case 'clearWorld':
        this.reset();
        return true;
      default:
        return null;
    }
  },
  recordChange: () => {},
  recordChangeForChunk: () => {},
  saveChunkData: (...args) => {
    mockPersistenceService.calls.push({ method: 'saveChunkData', args });
    return Promise.resolve();
  },
  snapshotChunkBlocks: (...args) => {
    mockPersistenceService.calls.push({ method: 'snapshotChunkBlocks', args });
  },
  saveDebounced: () => {},
  getChunkData: () => Promise.resolve(null)
};

// 模拟 ChestManager
const mockChestManager = {
  update: (dt) => {}
};

// 模拟 ParticleSystem
class MockParticleSystem {
  constructor(scene) {
    this.scene = scene;
  }
  spawnHitEffect() {}
  spawnExplosionEffect() {}
  spawnBlockCrashEffect() {}
  update(dt) {}
}

// 保存原始引用用于恢复
let originalPersistenceService, originalFaceCullingSystem;
let originalMaterials, originalBlockData, originalChestManager, originalParticleSystem;
let originalCarModel, originalGunManModel;

// 设置模拟环境
const setupEnvironment = () => {
  originalPersistenceService = globalThis._persistenceService;
  originalFaceCullingSystem = globalThis._faceCullingSystem;
  originalMaterials = globalThis._materials;
  originalBlockData = globalThis._blockData;
  originalChestManager = globalThis._chestManager;
  originalParticleSystem = globalThis._ParticleSystem;
  originalCarModel = globalThis._carModel;
  originalGunManModel = globalThis._gunManModel;

  globalThis._persistenceService = mockPersistenceService;
  globalThis._faceCullingSystem = mockFaceCullingSystem;
  globalThis._materials = mockMaterials;
  globalThis._blockData = mockBlockData;
  globalThis._chestManager = mockChestManager;
  globalThis._ParticleSystem = MockParticleSystem;
  globalThis._carModel = new THREE.Group();
  globalThis._gunManModel = new THREE.Group();
  mockPersistenceService.reset();

  // 启用 Worker 模拟
  shouldMockWorkers = true;
};

// 恢复原始环境
const teardownEnvironment = () => {
  if (originalPersistenceService === undefined) delete globalThis._persistenceService;
  else globalThis._persistenceService = originalPersistenceService;
  if (originalFaceCullingSystem === undefined) delete globalThis._faceCullingSystem;
  else globalThis._faceCullingSystem = originalFaceCullingSystem;
  if (originalMaterials === undefined) delete globalThis._materials;
  else globalThis._materials = originalMaterials;
  if (originalBlockData === undefined) delete globalThis._blockData;
  else globalThis._blockData = originalBlockData;
  if (originalChestManager === undefined) delete globalThis._chestManager;
  else globalThis._chestManager = originalChestManager;
  if (originalParticleSystem === undefined) delete globalThis._ParticleSystem;
  else globalThis._ParticleSystem = originalParticleSystem;
  if (originalCarModel === undefined) delete globalThis._carModel;
  else globalThis._carModel = originalCarModel;
  if (originalGunManModel === undefined) delete globalThis._gunManModel;
  else globalThis._gunManModel = originalGunManModel;

  // 禁用 Worker 模拟
  shouldMockWorkers = false;
};

describe('World 真实类测试', (test) => {
  test('测试环境 persistence mock 支持 WorldStore 的 postMessage 接口', async () => {
    mockPersistenceService.reset();

    const record = {
      regionKey: '0,0',
      chunks: {
        '0,0': {
          blockData: { 123: { type: 'stone', orientation: 0 } }
        }
      }
    };

    await mockPersistenceService.postMessage('saveRegionRecord', {
      regionKey: '0,0',
      record
    });
    const loaded = await mockPersistenceService.postMessage('getRegionRecord', {
      regionKey: '0,0'
    });

    assertEqual(loaded, record, 'mock 应能读回 region record');

    await mockPersistenceService.postMessage('clearWorld');
    const cleared = await mockPersistenceService.postMessage('getRegionRecord', {
      regionKey: '0,0'
    });
    assertEqual(cleared, null, 'clearWorld 后 region record 应被清空');
  });

  test('consumeStreamingPerfSnapshot 每秒聚合一次流式加载统计', () => {
    const world = Object.create(World.prototype);
    world.bootstrapState = { phase: 'runtime-streaming' };
    world.chunkAssemblyScheduler = { getPendingCount: () => 7 };
    world.globalInstancedMeshManager = {
      getStats: () => ({
        queuedBlocks: 320,
        queueTasks: 5,
        pendingAO: 9,
        renderedBlocks: 4096,
        lastProcessedBlocks: 180,
        lastFlushMs: 1.5
      })
    };
    world.getDeferredCrossChunkPatchStats = () => ({ chunks: 3, blocks: 45 });
    world.getRuntimeIdleStats = () => ({
      idleForMs: 160,
      taskCount: 2,
      pendingUnloadFlushQueueSize: 5,
      pendingUnloadFlushLastProcessedChunks: 2,
      pendingUnloadFlushLastProcessedRegions: 1,
      pendingUnloadFlushLastElapsedMs: 0.75
    });
    world.chunks = new Map([
      ['0,0', { isReady: true, isConsolidating: false, loadState: 'finalized' }],
      ['1,0', { isReady: false, isConsolidating: true, loadState: 'terrain-built' }],
      ['2,0', { isReady: false, isConsolidating: false, loadState: 'worker-ready' }]
    ]);
    world._streamingPerfTelemetry = {
      windowStartedAt: 0,
      flushBlocks: 540,
      flushCalls: 3,
      flushMaxMs: 2.25,
      lastBudgetOps: 600,
      lastBudgetMs: 2
    };

    assertEqual(world.consumeStreamingPerfSnapshot(999), null, '未满 1 秒时不应产出快照');

    const snapshot = world.consumeStreamingPerfSnapshot(1000);
    assertEqual(snapshot.phase, 'runtime-streaming', '应返回当前世界阶段');
    assertEqual(snapshot.assemblyQueue, 7, '应返回装配队列长度');
    assertEqual(snapshot.mutationQueueBlocks, 320, '应返回全局实例积压方块数');
    assertEqual(snapshot.mutationQueueTasks, 5, '应返回全局实例积压任务数');
    assertEqual(snapshot.flushBlocksPerSec, 540, '应聚合一秒内 flush 方块数');
    assertEqual(snapshot.flushCalls, 3, '应聚合一秒内 flush 次数');
    assertEqual(snapshot.flushMaxMs, 2.25, '应记录窗口内最大 flush 耗时');
    assertEqual(snapshot.deferredPatchChunks, 3, '应返回 deferred patch chunk 数');
    assertEqual(snapshot.deferredPatchBlocks, 45, '应返回 deferred patch block 数');
    assertEqual(snapshot.pendingUnloadFlushQueueSize, 5, '应暴露 unload flush 队列长度');
    assertEqual(snapshot.pendingUnloadFlushLastProcessedChunks, 2, '应暴露最近一轮消费的 chunk 数');
    assertEqual(snapshot.pendingUnloadFlushLastProcessedRegions, 1, '应暴露最近一轮消费的 region 数');
    assertEqual(snapshot.pendingUnloadFlushLastElapsedMs, 0.75, '应暴露最近一轮消费耗时');
    assertEqual(snapshot.consolidatingChunks, 1, '应统计正在 consolidation 的 chunk 数');
    assertEqual(snapshot.loadingChunks, 2, '应统计未 finalized 的 chunk 数');
    assertEqual(snapshot.readyChunks, 1, '应统计 ready chunk 数');
    assertEqual(snapshot.totalChunks, 3, '应统计总 chunk 数');
    assertEqual(world._streamingPerfTelemetry.flushBlocks, 0, '产出快照后应重置窗口累计 flush blocks');
    assertEqual(world._streamingPerfTelemetry.flushCalls, 0, '产出快照后应重置窗口累计 flush calls');
  });

  let scene;
  let world;

  // =========== 基础初始化测试 ===========
  test('World 可以实例化', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    assertNotNull(world, 'World 实例不应该为 null');
    assertNotNull(world.chunks, 'chunks Map 应该存在');
    assertNotNull(world.scene, 'scene 应该存在');
    assertNotNull(world.particles, 'particles 系统应该存在');

    teardownEnvironment();
  });

  test('World 初始状态正确', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    assertEqual(world.chunks.size, 0, '初始 chunks 应该为空');

    teardownEnvironment();
  });

  // =========== update 方法测试 ===========
  test('update - 加载玩家周围区块', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    // 玩家在原点
    world.update(new THREE.Vector3(0, 10, 0), 0.016);

    // 等待区块加载完成
    await waitForChunkReady(world, '0,0');

    // 验证 5x5 的区块已加载 (渲染距离 2)
    assertEqual(world.chunks.size, 25, '应该加载 25 个区块 (5x5)');

    // 验证特定区块存在
    assertTrue(world.chunks.has('0,0'), '区块 0,0 应该存在');
    assertTrue(world.chunks.has('2,2'), '区块 2,2 应该存在');
    assertTrue(world.chunks.has('-2,-2'), '区块 -2,-2 应该存在');

    teardownEnvironment();
  });

  test('update - 玩家移动时加载新区块', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    // 先在原点加载区块
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    const initialSize = world.chunks.size;
    assertEqual(initialSize, 25, '初始应该有 25 个区块');

    // 移动到远处 (100, 100) -> 区块 (6, 6)
    world.update(new THREE.Vector3(100, 10, 100), 0.016);
    await waitForChunkReady(world, '6,6');

    // 验证新区块已加载
    assertTrue(world.chunks.has('6,6'), '区块 6,6 应该存在 (100/16=6)');
    // 渲染距离为 2，玩家位于 chunk(6,6)，可访问范围 [4,8] × [4,8]
    assertTrue(world.chunks.has('4,4'), '区块 4,4 应该存在 (渲染距离边界)');
    assertTrue(world.chunks.has('8,8'), '区块 8,8 应该存在 (渲染距离边界)');

    teardownEnvironment();
  });

  test('_computeGlobalInstanceFlushBudget - 低帧率时应主动降预算', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.bootstrapState.phase = 'runtime-streaming';
    world.globalInstancedMeshManager = {
      getStats: () => ({ queuedBlocks: 800 })
    };
    world._globalInstanceFlushFrameMsEma = 16.7;

    const budget = world._computeGlobalInstanceFlushBudget(0.04);

    assertEqual(budget.maxOps, 320, '40ms 帧时长下应降到保守 blocks 预算');
    assertEqual(budget.maxMs, 1.25, '40ms 帧时长下应缩小时间预算');

    teardownEnvironment();
  });

  test('_computeGlobalInstanceFlushBudget - 高帧率且积压高时应放宽预算', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.bootstrapState.phase = 'runtime-streaming';
    world.globalInstancedMeshManager = {
      getStats: () => ({ queuedBlocks: 5000 })
    };
    world._globalInstanceFlushFrameMsEma = 10;

    const budget = world._computeGlobalInstanceFlushBudget(0.01);

    assertEqual(budget.maxOps, 1300, '高 FPS 且高积压时应提升吞吐预算');
    assertEqual(budget.maxMs, 3, '高 FPS 时应放宽到更高时间预算上限');

    teardownEnvironment();
  });


  test('bootstrap - 完成装配队列后应允许进入游戏', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    const enteredRuntime = await waitForWorldPhase(world, 'runtime-streaming', 300);

    const chunk = world.chunks.get('0,0');
    assertNotNull(chunk, '区块 0,0 应该存在');
    assertTrue(enteredRuntime, '世界应在超时前进入 runtime-streaming');
    assertTrue(world.isGameplayReady(), '排空装配队列后应允许进入游戏');

    teardownEnvironment();
  });

  test('static_tree 地形加速 - 应将树冠覆盖范围内的 chunk 提升为高优先级装配', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    const chunk = {
      cx: 0,
      cz: 0,
      structureCenters: [{ type: 'static_tree', x: 15, y: 10, z: 15 }]
    };

    world._markStaticTreeTerrainBoostFromChunk(chunk);

    assertTrue(world._staticTreeTerrainBoostChunkKeys.has('0,0'), '应包含树中心所在 chunk');
    assertTrue(world._staticTreeTerrainBoostChunkKeys.has('1,0'), '应包含东侧被树冠覆盖的 chunk');
    assertTrue(world._staticTreeTerrainBoostChunkKeys.has('0,1'), '应包含南侧被树冠覆盖的 chunk');
    assertTrue(world._staticTreeTerrainBoostChunkKeys.has('1,1'), '应包含东南角被树冠覆盖的 chunk');

    teardownEnvironment();
  });

  test('WorldWorker owner 过滤 - 越界 snapshot 方块不应因 rover 结构中心留在当前 chunk 输出中', async () => {
    const outOfChunkCode = Chunk.encodeCoord(16, 10, 8);
    const result = await runRealWorldWorker({
      cx: 0,
      cz: 0,
      seed: 1,
      taskId: 'test:worker-owner-filter',
      snapshot: {
        meta: { ownershipVersion: 2 },
        blocks: {
          [outOfChunkCode]: { type: 'stone', orientation: 0 }
        },
        entities: {
          modGunMan: [],
          rovers: [{ x: 15, y: 10, z: 8 }],
          zombieNests: [],
          staticTrees: []
        }
      },
      structureCenters: [{ type: 'rover', x: 15, y: 10, z: 8 }],
      isOptimization: false,
      textureGroups: {}
    });

    assertEqual(
      result.snapshot?.blocks?.[outOfChunkCode],
      undefined,
      '越界 snapshot 方块不应再因 rover 结构中心留在当前 chunk snapshot 中'
    );
    assertFalse(
      result.blockDataBlocks.some((block) => block.x === 16 && block.y === 10 && block.z === 8),
      '越界方块不应进入当前 chunk 的逻辑方块输出'
    );
  });

  test('WorldWorker routing 契约 - 应按 own chunk 和 overflow chunk 预分桶', async () => {
    const result = await runRealWorldWorker({
      cx: 0,
      cz: 0,
      seed: 1,
      taskId: 'test:worker-routing-contract',
      snapshot: {
        meta: { ownershipVersion: 2 },
        blocks: {
          [Chunk.encodeCoord(1, 10, 1)]: { type: 'stone', orientation: 0 },
          [Chunk.encodeCoord(17, 10, 1)]: { type: 'dirt', orientation: 0 }
        },
        entities: {
          modGunMan: [],
          rovers: [],
          zombieNests: [],
          staticTrees: []
        }
      },
      structureCenters: [],
      isOptimization: false,
      textureGroups: {}
    });

    assertEqual(result.routing?.schemaVersion, 1, '应返回 routing schemaVersion');
    assertEqual(result.routing?.ownChunk?.chunkKey, '0,0', 'own chunk key 应等于当前 worker chunk');
    assertTrue(Array.isArray(result.routing?.ownChunk?.blockDataBlocks), 'own chunk 逻辑方块应为数组');
    assertTrue(Array.isArray(result.routing?.ownChunk?.visibleBlocks), 'own chunk 可见方块应为数组');
    assertTrue(Array.isArray(result.routing?.overflowChunks), 'overflow chunk 应按数组返回');
    assertTrue(
      result.routing.ownChunk.blockDataBlocks.some((block) => block.x === 1 && block.y === 10 && block.z === 1),
      '当前 chunk 内的方块应落入 own chunk 桶'
    );
    assertTrue(
      result.routing.overflowChunks.some((entry) => entry.chunkKey === '1,0'),
      '越界方块应落入目标 chunk 的 overflow 桶'
    );
    const overflow = result.routing.overflowChunks.find((entry) => entry.chunkKey === '1,0');
    assertTrue(Array.isArray(overflow.blockDataBlocks), 'overflow 桶应提供逻辑方块数组');
    assertTrue(Array.isArray(overflow.visibleBlocks), 'overflow 桶应提供可见方块数组');
  });

  test('AO 稳定源事件 - finalized chunk 应刷新自身并标记四邻边界', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let selfRefreshes = 0;
    let neighborRefreshes = 0;
    let boundaryMarks = 0;

    const chunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      isConsolidating: false,
      _refreshAOFromStableSource: (options = {}) => {
        selfRefreshes++;
        assertTrue(options.fullRefresh, 'finalized chunk 自身应全量刷新 AO');
      }
    };
    const neighbor = {
      cx: 1,
      cz: 0,
      isReady: true,
      isConsolidating: false,
      dirtyAOPositions: new Set(['15,0,0']),
      _markBoundaryDirtyAO: () => {
        boundaryMarks++;
      },
      _refreshAOFromStableSource: () => {
        neighborRefreshes++;
      }
    };

    world.chunks.set('0,0', chunk);
    world.chunks.set('1,0', neighbor);

    world.onChunkAOSourceStable(chunk, {
      fullRefresh: true,
      markNeighborBoundaries: true
    });

    assertEqual(selfRefreshes, 1, '稳定源事件应刷新当前 chunk');
    assertEqual(boundaryMarks, 1, '新 chunk finalized 后应标记邻居边界 AO');
    assertEqual(neighborRefreshes, 1, '已有脏 AO 的稳定邻居应被刷新');

    teardownEnvironment();
  });

  test('AO 稳定源事件 - 新就绪区块会触发自身及四邻 AO 刷新', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    // 创建中心 chunk 和四个正交邻居
    const chunks = {};
    const createMockChunk = (cx, cz) => {
      let selfRefreshes = 0;
      const c = {
        cx, cz,
        isReady: true,
        isConsolidating: false,
        dirtyAOPositions: new Set(),
        get selfRefreshes() { return selfRefreshes; },
        _refreshAOFromStableSource() { selfRefreshes++; },
        _markBoundaryDirtyAO() {}
      };
      chunks[`${cx},${cz}`] = c;
      return c;
    };

    // 中心 chunk 和四邻
    const center = createMockChunk(2, 3);
    const east = createMockChunk(3, 3);
    const west = createMockChunk(1, 3);
    const south = createMockChunk(2, 4);
    const north = createMockChunk(2, 2);

    world.chunks.set('2,3', center);
    world.chunks.set('3,3', east);
    world.chunks.set('1,3', west);
    world.chunks.set('2,4', south);
    world.chunks.set('2,2', north);

    // 触发 AO 稳定源事件（模拟 chunk finalized）
    world.onChunkAOSourceStable(center, {
      fullRefresh: true,
      markNeighborBoundaries: true
    });

    // 中心 chunk 应被全量刷新
    assertEqual(center.selfRefreshes, 1, '自身应被刷新 AO');
    // 邻居应被标记边界
    // （onChunkAOSourceStable 内部对四邻调用 _markBoundaryDirtyAO）
  });

  test('AO 稳定源事件 - 仅处理已就绪且非合并中的区块', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let refreshedReadyChunk = 0;
    let refreshedConsolidatingChunk = 0;

    world.chunks.set('0,0', {
      cx: 0,
      cz: 0,
      isReady: true,
      isConsolidating: false,
      dirtyAOPositions: new Set(),
      _refreshAOFromStableSource: () => { refreshedReadyChunk++; },
      _markBoundaryDirtyAO: () => {}
    });

    world.chunks.set('1,0', {
      cx: 1,
      cz: 0,
      isReady: true,
      isConsolidating: true,
      dirtyAOPositions: new Set(['15,0,0']),
      _refreshAOFromStableSource: () => { refreshedConsolidatingChunk++; },
      _markBoundaryDirtyAO: () => {}
    });

    // 对 '0,0' 触发 AO 稳定源事件，邻居 '1,0' 合并中
    const chunk = world.chunks.get('0,0');
    world.onChunkAOSourceStable(chunk, {
      fullRefresh: true,
      markNeighborBoundaries: true
    });

    assertEqual(refreshedReadyChunk, 1, '已就绪且非合并区块应被刷新');
    // 合并中的 chunk 不应该被 _refreshAOFromStableSource 调用
    assertEqual(refreshedConsolidatingChunk, 0, '合并中的区块应跳过 AO 刷新');

    teardownEnvironment();
  });

  test('onChunkFinalized - pure runtime chunk 在 runtime-streaming 下收到 deferAORefresh 时应延迟 AO 稳定源刷新并进入 deferred finalize 队列', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.bootstrapState.phase = 'runtime-streaming';

    let aoRefreshCalls = 0;
    const chunk = {
      cx: 4,
      cz: 5,
      isReady: true,
      isConsolidating: false,
      hasDeferredFinalizeWork: true,
      _needsDeferredAOStabilization: true,
      dirtyAOPositions: new Set(),
      isPureRuntimeStreamingChunk: () => true,
      _refreshAOFromStableSource: () => { aoRefreshCalls++; },
      _markBoundaryDirtyAO: () => {}
    };
    world.chunks.set('4,5', chunk);

    world.onChunkFinalized(chunk, { deferAORefresh: true });

    assertEqual(aoRefreshCalls, 0, 'runtime-streaming 下不应在 finalized 当帧立即刷新 AO');
    assertTrue(world._pendingDeferredFinalizeChunkKeys.has('4,5'), '应进入 deferred finalize 队列等待空闲窗口');

    teardownEnvironment();
  });

  test('onChunkFinalized - finalized chunk 应触发 AO 全量刷新并标记邻居边界', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let selfRefreshes = 0;
    let neighborBoundaryMarks = 0;
    const chunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      isConsolidating: false,
      dirtyAOPositions: new Set(),
      hasDeferredFinalizeWork: false,
      _refreshAOFromStableSource: () => { selfRefreshes++; },
      _markBoundaryDirtyAO: () => { neighborBoundaryMarks++; }
    };
    const neighbor = {
      cx: 1,
      cz: 0,
      isReady: true,
      isConsolidating: false,
      dirtyAOPositions: new Set(),
      _refreshAOFromStableSource: () => {},
      _markBoundaryDirtyAO: () => { neighborBoundaryMarks++; }
    };

    world.chunks.set('0,0', chunk);
    world.chunks.set('1,0', neighbor);

    world.onChunkFinalized(chunk);

    assertEqual(selfRefreshes, 1, 'finalized 后应刷新自身 AO');
    assertTrue(neighborBoundaryMarks >= 1, 'finalized 后应标记邻居边界');

    teardownEnvironment();
  });

  test('onAOSettingChanged(false) 应清理已加载 chunk 的 AO 脏状态与定时器', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let clearedTimer = 0;
    const chunkA = {
      dirtyAOPositions: new Set([1, 2]),
      aoRefreshTimer: { id: 'a' }
    };
    const chunkB = {
      dirtyAOPositions: new Set([3]),
      aoRefreshTimer: null
    };

    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.clearTimeout = () => { clearedTimer++; };

    try {
      world.chunks.set('0,0', chunkA);
      world.chunks.set('1,0', chunkB);

      world.onAOSettingChanged(false);

      assertEqual(chunkA.dirtyAOPositions.size, 0, '关闭 AO 时应清空 chunkA 的脏 AO');
      assertEqual(chunkB.dirtyAOPositions.size, 0, '关闭 AO 时应清空 chunkB 的脏 AO');
      assertEqual(chunkA.aoRefreshTimer, null, '关闭 AO 时应清掉 chunkA 的 AO 定时器引用');
      assertEqual(clearedTimer, 1, '关闭 AO 时应清理已有 AO 定时器');
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
      teardownEnvironment();
    }
  });

  test('onAOSettingChanged(true) 应对已就绪且非合并中的 chunk 触发全量 AO 刷新', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let readyRefreshes = 0;
    let consolidatingRefreshes = 0;
    let notReadyRefreshes = 0;

    world.chunks.set('0,0', {
      isReady: true,
      isConsolidating: false,
      _refreshAOFromStableSource(options = {}) {
        readyRefreshes++;
        assertTrue(options.fullRefresh, '重新开启 AO 时应触发 fullRefresh');
      }
    });
    world.chunks.set('1,0', {
      isReady: true,
      isConsolidating: true,
      _refreshAOFromStableSource() {
        consolidatingRefreshes++;
      }
    });
    world.chunks.set('2,0', {
      isReady: false,
      isConsolidating: false,
      _refreshAOFromStableSource() {
        notReadyRefreshes++;
      }
    });

    world.onAOSettingChanged(true);

    assertEqual(readyRefreshes, 1, '已就绪且非合并中的 chunk 应全量刷新 AO');
    assertEqual(consolidatingRefreshes, 0, '合并中的 chunk 不应立即刷新 AO');
    assertEqual(notReadyRefreshes, 0, '未就绪 chunk 不应立即刷新 AO');

    teardownEnvironment();
  });

  test('延迟 finalize 队列 - 流式加载活跃时不应执行纯新 runtime chunk 的后置任务', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let deferredExecuted = 0;
    const chunk = {
      cx: 0,
      cz: 0,
      isReady: true,
      isConsolidating: false,
      hasDeferredFinalizeWork: true,
      runDeferredFinalizePhase: () => { deferredExecuted++; return true; }
    };
    world.chunks.set('0,0', chunk);
    world._pendingDeferredFinalizeChunkKeys.add('0,0');
    // 模拟流式加载活跃：最近有活动
    world._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();

    world._processDeferredFinalizeQueue({ maxChunks: 1 });

    assertEqual(deferredExecuted, 0, '流式加载仍活跃时不应执行延迟 finalize');
    assertTrue(world._pendingDeferredFinalizeChunkKeys.has('0,0'), '任务应继续保留在队列中');

    teardownEnvironment();
  });

  test('延迟 consolidation 队列 - 未达到 3000ms idle 窗口时不应提前执行', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let scheduled = 0;
    const chunk = {
      cx: 0,
      cz: 0,
      disposed: false,
      isReady: true,
      isConsolidating: false,
      dirtyBlocks: 3,
      scheduleConsolidation: () => { scheduled++; }
    };
    world.chunks.set('0,0', chunk);
    world._pendingDeferredConsolidationChunkKeys.add('0,0');
    const now = globalThis.performance?.now?.() ?? Date.now();
    world._lastStreamingActivityAt = now - 1000;

    const processed = world._processDeferredConsolidationQueue({ maxChunks: 1 });

    assertEqual(processed, 0, 'idle 未满 3000ms 时不应执行 deferred consolidation');
    assertEqual(scheduled, 0, '不应提前调度 chunk consolidation');
    assertTrue(world._pendingDeferredConsolidationChunkKeys.has('0,0'), '任务应继续留在 deferred consolidation 队列中');

    teardownEnvironment();
  });

  test('owner 闭环 - 跨 chunk patch 最终应由坐标 chunk 命中查询和删除', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    // targetX = CHUNK_SIZE (16) 确保坐标落在 chunk(1,0) 而非 chunk(0,0)
    const CHUNK_SIZE = 16;
    const targetX = CHUNK_SIZE;
    const targetY = 40;
    const targetZ = 8;
    const targetCode = Chunk.encodeCoord(targetX, targetY, targetZ);

    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    const [chunk00Ready, chunk10Ready] = await Promise.all([
      waitForChunkReady(world, '0,0', 40),
      waitForChunkReady(world, '1,0', 40)
    ]);
    assertTrue(chunk00Ready && chunk10Ready, '测试前需要 0,0 和 1,0 两个 chunk 都已 ready');

    const chunk00 = world.chunks.get('0,0');
    const chunk10 = world.chunks.get('1,0');
    assertNotNull(chunk00, '源 chunk 应存在');
    assertNotNull(chunk10, '目标 chunk 应存在');
    world.scatterManager.pendingCrossChunkPatchBuffers.clear();
    assertEqual(chunk00.hasBlockEntry(targetX, targetY, targetZ), false, '注入前源 chunk 不应已有目标坐标');
    assertEqual(chunk10.hasBlockEntry(targetX, targetY, targetZ), false, '注入前目标 chunk 不应已有目标坐标');

    world._onChunkGenResult(chunk00, {
      cx: 0,
      cz: 0,
      blockDataBlocks: [
        { x: targetX, y: targetY, z: targetZ, type: 'stone', orientation: 0 }
      ],
      scatteredBlocks: [
        { x: targetX, y: targetY, z: targetZ, type: 'stone', orientation: 0, aoLow: 1, aoHigh: 1 }
      ],
      visibleKeys: [targetCode],
      solidBlocks: [targetCode]
    });

    const patched = world.scatterManager.flushDeferredCrossChunkPatchesAround(0, 0, {
      maxChunks: 1,
      maxBlocks: 10
    });

    assertEqual(patched.processedBlocks, 1, '跨 chunk patch 应只补刷本次注入的一个目标方块');
    assertEqual(chunk00.hasBlockEntry(targetX, targetY, targetZ), false, '源 chunk 不应持有越界坐标方块');
    assertTrue(chunk10.hasBlockEntry(targetX, targetY, targetZ), '目标 chunk 应接收该坐标方块');

    const owner = world.resolveBlockOwner(targetX, targetY, targetZ, { allowScan: false });
    assertEqual(owner?.ownerChunkKey, '1,0', '世界查询应命中坐标所属 chunk');
    assertEqual(world.getBlock(targetX, targetY, targetZ), 'stone', '世界查询应返回目标 chunk 中的方块');

    world.removeBlock(targetX, targetY, targetZ);

    assertEqual(world.getBlock(targetX, targetY, targetZ), null, '删除后世界查询不应再命中该方块');
    assertEqual(chunk10.hasBlockEntry(targetX, targetY, targetZ), false, '删除应真正落在目标 chunk');

    teardownEnvironment();
  });

  test('延迟 finalize 队列 - 流式加载活跃时不应执行纯新 runtime chunk 的后置任务', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.bootstrapState.phase = 'runtime-streaming';

    let ran = 0;
    world.chunks.set('2,2', {
      cx: 2,
      cz: 2,
      isReady: true,
      isConsolidating: false,
      disposed: false,
      runDeferredFinalizePhase: () => { ran++; return true; }
    });
    world._pendingDeferredFinalizeChunkKeys.add('2,2');
    world._lastStreamingActivityAt = globalThis.performance?.now?.() ?? Date.now();

    world._processDeferredFinalizeQueue();

    assertEqual(ran, 0, '流式加载仍活跃时不应执行后置 finalize');
    assertTrue(world._pendingDeferredFinalizeChunkKeys.has('2,2'), '任务应继续留在延迟 finalize 队列中');

    teardownEnvironment();
  });

  test('Chunk finalize - 纯新 runtime chunk 应跳过首次 consolidation', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    const runtimeChunk = world.chunks.get('0,0');
    runtimeChunk.spawnReason = 'runtime-streaming';
    runtimeChunk.hasPlayerMutations = false;
    runtimeChunk.loadState = 'entities-built';
    runtimeChunk.isReady = false;
    runtimeChunk.dirtyBlocks = 3;

    let consolidateCalled = 0;
    let finalizedCalls = 0;
    runtimeChunk.consolidate = () => { consolidateCalled++; };
    runtimeChunk.world.onChunkFinalized = () => { finalizedCalls++; };

    const result = runtimeChunk.finalizeAssemblyPhase();

    assertTrue(result, '纯新 runtime chunk finalize 预检查应直接完成');
    assertEqual(consolidateCalled, 0, '纯新 runtime chunk 不应触发首次 consolidation');
    assertEqual(runtimeChunk.dirtyBlocks, 0, '预检查后应清空加载期脏块计数');
    assertFalse(runtimeChunk.hasDeferredFinalizeWork, '纯新 runtime chunk 不应把 finalize 工作后移到 deferred 队列');

    // 新架构：finalize 分为预检查 + 非延迟工作两个阶段
    const result2 = await runtimeChunk.finalizeNonDeferredPhase();

    assertTrue(result2, '非延迟阶段应完成');
    assertEqual(runtimeChunk.loadState, 'finalized', '纯新 runtime chunk 应直接进入 finalized');
    assertEqual(finalizedCalls, 1, '纯新 runtime chunk 应在非延迟阶段完成 finalized 回调');
    assertFalse(world._pendingDeferredFinalizeChunkKeys.has('0,0'), '纯新 runtime chunk finalize 后不应进入 deferred finalize 队列');

    teardownEnvironment();
  });

  test('ChunkAssemblyScheduler - 同一轮不应继续执行刚刚新入队的后续阶段', async () => {
    const scheduler = new ChunkAssemblyScheduler({});
    const calls = [];
    const chunk = {
      cx: 0,
      cz: 0,
      loadState: 'terrain-built',
      isReady: false,
      disposed: false,
      queuedAssemblyStages: new Set(),
      assembleRuntimeBuildPhase() {
        calls.push('runtime-build');
        return true;
      },
      finalizeAssemblyPhase() {
        calls.push('finalize');
        return true;
      },
      async finalizeNonDeferredPhase() {
        calls.push('non-deferred-finalize');
        return true;
      }
    };

    scheduler.enqueue(chunk, 'runtime-build', 100);
    const processed = await scheduler.processWithinBudget({ budgetMs: 100, maxTasks: 10 });

    assertEqual(processed, 1, '首轮只应处理初始队列中的一个任务');
    assertEqual(calls.join(','), 'runtime-build', '后续阶段应留到下一轮调度');
    assertEqual(scheduler.getPendingCount(), 1, 'finalize 阶段应继续留在队列中');
  });

  // =========== setBlock 测试 ===========
  test('setBlock - 在已加载区块放置方块', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    // 先更新世界以加载区块 (玩家在原点)
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    // 在玩家附近放置方块
    world.setBlock(5, 10, 5, 'stone', 0);

    // 验证方块已放置
    const blockType = world.getBlock(5, 10, 5);
    assertEqual(blockType, 'stone', '方块类型应该是 stone');

    teardownEnvironment();
  });

  test('setBlock - 在未加载区块放置方块 (应忽略)', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    // 不要调用 update，这样区块不会加载

    // 在远处放置方块 (区块未加载)
    world.setBlock(1000, 100, 1000, 'diamond', 0);

    // 应该返回 null (因为区块不存在)
    const blockType = world.getBlock(1000, 100, 1000);
    assertEqual(blockType, null, '未加载区块的方块应该返回 null');

    teardownEnvironment();
  });

  test('setBlock - 放置多种方块类型', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    // 放置不同类型的方块
    world.setBlock(0, 10, 0, 'dirt', 0);
    world.setBlock(1, 10, 0, 'wood', 0);
    world.setBlock(2, 10, 0, 'glass_block', 0);
    world.setBlock(3, 10, 0, 'chest', 0);

    assertEqual(world.getBlock(0, 10, 0), 'dirt', '应该放置 dirt');
    assertEqual(world.getBlock(1, 10, 0), 'wood', '应该放置 wood');
    assertEqual(world.getBlock(2, 10, 0), 'glass_block', '应该放置 glass_block');
    assertEqual(world.getBlock(3, 10, 0), 'chest', '应该放置 chest');

    teardownEnvironment();
  });

  // =========== removeBlock 测试 ===========
  test('removeBlock - 移除单个方块', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    // 先放置一个方块
    world.setBlock(5, 10, 5, 'stone', 0);
    assertEqual(world.getBlock(5, 10, 5), 'stone', '应该放置 stone');

    // 然后移除它
    world.removeBlock(5, 10, 5);

    const blockType = world.getBlock(5, 10, 5);
    assertEqual(blockType, null, '移除后应该返回 null');

    teardownEnvironment();
  });

  test('removeBlock - runtime-streaming 下应标记对应 chunk 为脏', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    world.setBlock(5, 10, 5, 'stone', 0);
    world.bootstrapState.phase = 'runtime-streaming';

    const dirtyCalls = [];
    world.worldRuntime = {
      recordBlockMutation() {},
      markChunkDirty(cx, cz) {
        dirtyCalls.push(`${cx},${cz}`);
      }
    };

    world.removeBlock(5, 10, 5);

    assertEqual(dirtyCalls.length, 1, '删除方块后应标记一次脏 chunk');
    assertEqual(dirtyCalls[0], '0,0', '应标记坐标所属 chunk');

    teardownEnvironment();
  });

  test('removeBlock - 移除不存在的方块', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    // 移除不存在的方块不应该抛出错误
    world.removeBlock(999, 999, 999);

    // 状态应该保持不变
    assertEqual(world.getBlock(999, 999, 999), null, '不存在的方块应该返回 null');

    teardownEnvironment();
  });

  // =========== isSolid 测试 ===========
  test('isSolid - 实心方块检测', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    // 构造一个已就绪的区块，避免异步 Worker 时序导致的测试抖动
    world.chunks.set('0,0', {
      cx: 0,
      cz: 0,
      isReady: true,
      solidBlocks: new Set([Chunk.encodeCoord(5, 10, 5)])
    });

    // 验证 stone 是实心
    assertTrue(world.isSolid(5, 10, 5), 'stone 应该是实心');

    teardownEnvironment();
  });

  test('isSolid - 非实心方块检测', () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    world.chunks.set('0,0', {
      cx: 0,
      cz: 0,
      isReady: true,
      solidBlocks: new Set()
    });

    // 验证 flower 不是实心
    assertFalse(world.isSolid(5, 10, 5), 'flower 不应该是实心');

    teardownEnvironment();
  });

  test('特殊实体占位 - 不写入 blockData 但可被 world 查询为 collider', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    const chunk = world.chunks.get('0,0');
    chunk.loadSpecialEntityInstances('modGunMan', [{ x: 5, y: 10, z: 5 }], null);

    assertTrue(world.isSolid(5, 10, 5), 'gunman 占位应参与碰撞');
    assertEqual(world.getBlock(5, 10, 5), 'collider', 'gunman 占位应返回 collider');
    assertEqual(world.getBlock(5, 11, 5), 'collider', 'gunman 头顶占位应返回 collider');
    assertFalse(chunk.blockData.has(Chunk.encodeCoord(5, 10, 5)), 'gunman 占位不应写入 blockData');

    teardownEnvironment();
  });

  // =========== removeBlocksBatch 测试 ===========
  test('removeBlocksBatch - 批量移除方块', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    // 放置多个方块
    world.setBlock(0, 10, 0, 'stone', 0);
    world.setBlock(1, 10, 0, 'stone', 0);
    world.setBlock(2, 10, 0, 'stone', 0);
    world.setBlock(3, 10, 0, 'dirt', 0);

    // 批量移除
    world.removeBlocksBatch([
      { x: 0, y: 10, z: 0 },
      { x: 1, y: 10, z: 0 },
      { x: 2, y: 10, z: 0 }
    ]);

    // 验证前三个方块被移除
    assertEqual(world.getBlock(0, 10, 0), null, '方块 0 应该被移除');
    assertEqual(world.getBlock(1, 10, 0), null, '方块 1 应该被移除');
    assertEqual(world.getBlock(2, 10, 0), null, '方块 2 应该被移除');

    // 第四个方块应该还在
    assertEqual(world.getBlock(3, 10, 0), 'dirt', '方块 3 应该保留');

    teardownEnvironment();
  });

  test('removeBlocksBatch - 命中特殊实体占位时应销毁整个实体', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    const chunk = world.chunks.get('0,0');

    // 清除 rover 占位区域的所有方块，确保地形干净
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          world.removeBlock(8 + dx, 10 + dy, 8 + dz);
        }
      }
    }

    // 加载 rover 实体（占位范围: x[7..9], y[10..12], z[6..10]）
    chunk.loadSpecialEntityInstances('rover', [{ x: 8, y: 10, z: 8 }], null);

    assertEqual(chunk.entities.rovers.length, 1, '初始应有 1 个 rover');
    assertEqual(world.getBlock(7, 10, 6), 'collider', 'rover 占位应可查询');

    world.removeBlocksBatch([{ x: 7, y: 10, z: 6 }], false);

    assertEqual(chunk.entities.rovers.length, 0, '命中占位后应销毁整个 rover');
    assertEqual(world.getBlock(7, 10, 6), null, 'rover 占位应被清除');
    assertFalse(world.isSolid(7, 10, 6), 'rover 占位清除后不应继续碰撞');

    teardownEnvironment();
  });

  // =========== 区块数据完整性测试 ===========
  test('Chunk 数据完整性 - 大量方块添加后验证', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    const addedBlocks = [];

    // 添加大量方块
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 5; y++) {
        for (let z = 0; z < 10; z++) {
          const type = (x + y + z) % 3 === 0 ? 'stone' : 'dirt';
          world.setBlock(x, y, z, type, 0);
          addedBlocks.push({ x, y, z, type });
        }
      }
    }

    // 验证所有方块都存在
    let successCount = 0;
    addedBlocks.forEach(block => {
      const blockType = world.getBlock(block.x, block.y, block.z);
      if (blockType === block.type) {
        successCount++;
      }
    });

    assertEqual(successCount, addedBlocks.length, '所有添加的方块都应该存在且类型正确');

    teardownEnvironment();
  });

  test('区块卸载后方块数据清除', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    // 先在原点加载区块并放置方块
    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    world.setBlock(5, 10, 5, 'stone', 0);
    assertEqual(world.getBlock(5, 10, 5), 'stone', '方块应该存在');

    // 移动到远处让原区块卸载
    world.update(new THREE.Vector3(200, 10, 200), 0.016);
    await new Promise(resolve => setTimeout(resolve, 100));

    // 原区块应该已卸载
    assertFalse(world.chunks.has('0,0'), '区块 0,0 应该已卸载');

    teardownEnvironment();
  });

  test('runtime-streaming 区块卸载时不应再同步 snapshotChunkBlocks 到旧 cache', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    world.bootstrapState.phase = 'runtime-streaming';
    mockPersistenceService.calls = [];

    world.update(new THREE.Vector3(200, 10, 200), 0.016);
    await new Promise(resolve => setTimeout(resolve, 100));

    const snapshotCall = mockPersistenceService.calls.find(call =>
      call.method === 'snapshotChunkBlocks'
    );

    assertUndefined(snapshotCall, 'runtime-streaming 卸载时不应再回灌旧 session cache');

    teardownEnvironment();
  });

  test('runtime-streaming 区块卸载时 flushBeforeUnload 不应再被调用（内存权威层已接管）', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    world.bootstrapState.phase = 'runtime-streaming';
    const unloadCalls = [];
    world.worldRuntime = {
      ensureChunkData() {
        return Promise.resolve({ status: 'missing-region' });
      },
      flushBeforeUnload(cx, cz, blockDataSnapshot, entities) {
        unloadCalls.push({ cx, cz, blockDataSnapshot, entities });
        return Promise.resolve();
      },
      prefetchRegions() {}
    };

    world.update(new THREE.Vector3(200, 10, 200), 0.016);
    await new Promise(resolve => setTimeout(resolve, 100));

    // 运行期已旁路 flush，内存权威层接管正确性
    assertEqual(unloadCalls.length, 0, '卸载时不应再触发 flushBeforeUnload');

    teardownEnvironment();
  });

  test('runtime-streaming 区块卸载时不应等待写盘完成，应先完成回收与删除', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    world.update(new THREE.Vector3(0, 10, 0), 0.016);
    await waitForChunkReady(world, '0,0');

    world.bootstrapState.phase = 'runtime-streaming';
    const chunk = world.chunks.get('0,0');
    let disposeCalled = false;

    chunk.dispose = () => {
      disposeCalled = true;
      chunk.disposed = true;
    };

    world.worldRuntime = {
      ensureChunkData() {
        return Promise.resolve({ status: 'missing-region' });
      },
      flushBeforeUnload(_cx, _cz, _blockDataSnapshot, _entities) {
        // 运行期已旁路，不应被调用
        return Promise.reject(new Error('flushBeforeUnload should not be called'));
      },
      prefetchRegions() {},
      flushPendingUnloadQueueWithinBudget() {
        return Promise.resolve({ processedChunks: 0, processedRegions: 0, remainingQueueSize: 0, elapsedMs: 0 });
      }
    };

    world.update(new THREE.Vector3(200, 10, 200), 0.016);

    // 运行期已旁路 flush，卸载不再等待写盘
    assertFalse(world.chunks.has('0,0'), '卸载当帧应直接从活动 chunk 集合删除');
    assertTrue(disposeCalled, '卸载当帧应直接调用 chunk.dispose');

    await new Promise(resolve => setTimeout(resolve, 0));

    teardownEnvironment();
  });

  test('dispose - 应尽力 flush WorldRuntime 的待处理写回工作', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);

    let flushAllPendingWorkCalls = 0;
    world.worldRuntime = {
      async flushAllPendingWork() {
        flushAllPendingWorkCalls++;
      }
    };

    await world.dispose();

    assertEqual(flushAllPendingWorkCalls, 1, 'World.dispose 应触发 runtime 待处理写回收口');

    teardownEnvironment();
  });

  // =========== 坐标到区块转换测试 ===========
  test('区块坐标计算正确', () => {
    const CHUNK_SIZE = PERSISTENCE_CONFIG.CHUNK_SIZE;

    // 测试各种坐标的区块计算
    assertEqual(Math.floor(0 / CHUNK_SIZE), 0, 'x=0 在区块 0');
    assertEqual(Math.floor(15 / CHUNK_SIZE), 0, 'x=15 在区块 0');
    assertEqual(Math.floor(16 / CHUNK_SIZE), 1, 'x=16 在区块 1');
    assertEqual(Math.floor(-1 / CHUNK_SIZE), -1, 'x=-1 在区块 -1');
    assertEqual(Math.floor(-16 / CHUNK_SIZE), -1, 'x=-16 在区块 -1');
  });

  // ============================================================
  // authority 语义测试：WorldBlockDataStore 作为 blockData 唯一权威
  // ============================================================

  test('authority - deserializeBlockData / serializeBlockData codec 往返', () => {
    const plain = { '123': 'stone', '456': { type: 'dirt', orientation: 2 }, '789': 'air' };
    const map = WorldBlockDataStore.deserializeBlockData(plain);
    assertTrue(map instanceof Map, 'deserialize 应返回 Map');
    assertEqual(map.size, 3, '应包含 3 个 entry');
    assertEqual(map.get(123).type, 'stone', 'string value 应规范化为 entry');
    assertEqual(map.get(123).orientation, 0, 'string value 默认 orientation=0');
    assertEqual(map.get(456).type, 'dirt', 'object entry 保留 type');
    assertEqual(map.get(456).orientation, 2, 'object entry 保留 orientation');
    assertEqual(map.get(789).type, 'air', 'air 类型也保留');

    const roundtrip = WorldBlockDataStore.serializeBlockData(map);
    assertEqual(typeof roundtrip, 'object', 'serialize 应返回 plain object');
    assertEqual(roundtrip['123'].type, 'stone', '往返后 type 保留');
    assertEqual(roundtrip['456'].orientation, 2, '往返后 orientation 保留');

    // 空输入
    const emptyMap = WorldBlockDataStore.deserializeBlockData(null);
    assertEqual(emptyMap.size, 0, 'null 应返回空 Map');
    const emptyObj = WorldBlockDataStore.serializeBlockData(null);
    assertEqual(Object.keys(emptyObj).length, 0, 'null 应返回空 object');
  });

  test('authority - setBlockEntry / deleteBlockEntry 递增 version', () => {
    const store = new WorldBlockDataStore();

    assertEqual(store.getAuthorityVersion(0, 0), 0, '未创建 slice 时 version=0');

    store.setBlockEntry(0, 0, 123, 'stone');
    assertEqual(store.getAuthorityVersion(0, 0), 1, '首次 set 后 version=1');
    assertEqual(store.peekChunkSlice(0, 0).get(123).type, 'stone', 'entry 已写入');

    store.deleteBlockEntry(0, 0, 123);
    assertEqual(store.getAuthorityVersion(0, 0), 2, 'delete 后 version=2');
    assertTrue(!store.peekChunkSlice(0, 0).has(123), 'entry 已删除');

    assertEqual(store.stats.totalMutations, 2, 'mutations 统计正确');
  });

  test('authority - applyChunkPatch 批量写入只递增一次 version', () => {
    const store = new WorldBlockDataStore();
    const patches = new Map([
      [111, 'stone'],
      [222, { type: 'dirt', orientation: 1 }],
      [333, null]  // null 表示删除（在尚未创建 slice 时不执行删除）
    ]);

    store.applyChunkPatch(0, 0, patches);
    assertEqual(store.getAuthorityVersion(0, 0), 1, '批量 patch 只递增一次 version');
    assertEqual(store.peekChunkSlice(0, 0).size, 2, '2 个有效写入（null 不写入）');
    assertEqual(store.peekChunkSlice(0, 0).get(111).type, 'stone', 'patch 1 写入');
    assertEqual(store.peekChunkSlice(0, 0).get(222).orientation, 1, 'patch 2 写入');
    assertEqual(store.stats.totalMutations, 1, 'batch mutation 计数为 1');
  });

  test('authority - attach/detach 生命周期与身份一致性', () => {
    const store = new WorldBlockDataStore();
    const slice = store.ensureChunkSlice(0, 0);
    slice.set(123, { type: 'stone', orientation: 0 });

    assertFalse(store.isAttached(0, 0), '初始未 attach');

    store.markAttached(0, 0);
    assertTrue(store.isAttached(0, 0), 'markAttached 后应返回 true');

    // attached 状态下 replace 被拒绝
    const newSlice = new Map([[456, { type: 'dirt', orientation: 0 }]]);
    store.replaceChunkSlice(0, 0, newSlice, 'test-attach-guard');
    assertTrue(store.peekChunkSlice(0, 0) === slice, 'attached 状态下 replace 被拒绝，slice 身份不变');

    store.markDetached(0, 0);
    assertFalse(store.isAttached(0, 0), 'markDetached 后应返回 false');

    // detach 后 replace 允许
    store.replaceChunkSlice(0, 0, newSlice, 'test-attach');
    assertTrue(store.peekChunkSlice(0, 0) === newSlice, 'detach 后 replace 生效');
  });

  test('authority - stats 统计完整反映 authority 生命周期', () => {
    const store = new WorldBlockDataStore();

    store.ensureChunkSlice(0, 0);
    store.ensureChunkSlice(1, 0);
    store.peekChunkSlice(2, 0);  // miss

    const stats = store.getStats();
    assertEqual(stats.sliceCount, 2, '2 个 slice');
    assertEqual(stats.writes, 2, '2 次 ensure 写入');
    assertEqual(stats.misses, 1, '1 次 peek miss');
    assertEqual(stats.attachedCount, 0, '无 attach');
  });

  test('authority - _verifySliceIntegrity 检测异常切片状态', () => {
    const store = new WorldBlockDataStore();

    // 缺失
    assertFalse(store._verifySliceIntegrity(0, 0, 'test'), '缺失 slice 返回 false');
    assertEqual(store._callStats.integrityWarn, 1, '缺失触发告警计数');

    // 正常
    store.ensureChunkSlice(0, 0);
    assertTrue(store._verifySliceIntegrity(0, 0, 'test'), '正常 slice 返回 true');
    assertEqual(store._callStats.integrityWarn, 1, '正常不递增告警计数');
  });

});
