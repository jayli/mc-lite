// src/tests/test-world.js
/**
 * World 测试套件
 * 测试世界系统的方块放置/挖掘功能
 *
 * 使用真实的 World 和 Chunk 类，模拟 Worker 和外部依赖
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull } from './assert.js';
import * as THREE from 'three';
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

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

    // 拦截 onmessage
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
          setTimeout(() => {
            if (handlers._onmessage) {
              handlers._onmessage({
                data: {
                  cx: msg.cx,
                  cz: msg.cz,
                  d: {},
                  solidBlocks: [],
                  realisticTrees: [],
                  modGunMan: [],
                  rovers: [],
                  allBlockTypes: {},
                  visibleKeys: [],
                  snapshot: null,
                  structureCenters: []
                }
              });
            }
          }, 30);
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
async function waitForChunkReady(world, chunkKey, maxWaitCount = 50) {
  let waitCount = 0;
  while (waitCount < maxWaitCount) {
    const chunk = world.chunks.get(chunkKey);
    if (chunk && chunk.isReady) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    waitCount++;
  }
  return false;
}

// ============================================
// 其他依赖模拟
// ============================================

// 模拟 persistenceService
const mockPersistenceService = {
  recordChange: () => {},
  saveChunkData: () => Promise.resolve(),
  saveDebounced: () => {},
  getChunkData: () => Promise.resolve(null)
};

// 模拟 faceCullingSystem
const mockFaceCullingSystem = {
  isEnabled: () => false,
  isTransparent: (type) => ['glass_block', 'leaves', 'water', 'air'].includes(type),
  calculateFaceVisibility: (block, neighbors) => 63,
  updateBlock: () => {},
  updateNeighbors: () => {}
};

// 模拟 materials - 返回带有 dispose 方法的材质对象
const mockMaterials = {
  getMaterial: (type) => {
    const material = {
      clone: () => ({ ...material }),
      dispose: () => {}
    };
    return material;
  },
  dispose: () => {}
};

// 模拟 BlockData
const mockBlockData = {
  getBlockProperties: (type) => {
    const solidTypes = ['stone', 'dirt', 'wood', 'collider', 'realistic_trunk_collider'];
    return {
      isSolid: solidTypes.includes(type),
      isTransparent: ['glass_block', 'leaves', 'water', 'air'].includes(type),
      isRendered: type !== 'air' && type !== 'collider',
      isAOEnabled: true,
      geometryType: 'default'
    };
  }
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
  globalThis._carModel = { clone: () => null };
  globalThis._gunManModel = { clone: () => null };

  // 启用 Worker 模拟
  shouldMockWorkers = true;
};

// 恢复原始环境
const teardownEnvironment = () => {
  if (originalPersistenceService) globalThis._persistenceService = originalPersistenceService;
  if (originalFaceCullingSystem) globalThis._faceCullingSystem = originalFaceCullingSystem;
  if (originalMaterials) globalThis._materials = originalMaterials;
  if (originalBlockData) globalThis._blockData = originalBlockData;
  if (originalChestManager) globalThis._chestManager = originalChestManager;
  if (originalParticleSystem) globalThis._ParticleSystem = originalParticleSystem;
  if (originalCarModel) globalThis._carModel = originalCarModel;
  if (originalGunManModel) globalThis._gunManModel = originalGunManModel;

  // 禁用 Worker 模拟
  shouldMockWorkers = false;
};

describe('World 真实类测试', (test) => {

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

    // 验证 7x7 的区块已加载 (渲染距离 3)
    assertEqual(world.chunks.size, 49, '应该加载 49 个区块 (7x7)');

    // 验证特定区块存在
    assertTrue(world.chunks.has('0,0'), '区块 0,0 应该存在');
    assertTrue(world.chunks.has('3,3'), '区块 3,3 应该存在');
    assertTrue(world.chunks.has('-3,-3'), '区块 -3,-3 应该存在');

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
    assertEqual(initialSize, 49, '初始应该有 49 个区块');

    // 移动到远处 (100, 100) -> 区块 (6, 6)
    world.update(new THREE.Vector3(100, 10, 100), 0.016);
    await waitForChunkReady(world, '6,6');

    // 验证新区块已加载
    assertTrue(world.chunks.has('6,6'), '区块 6,6 应该存在 (100/16=6)');
    assertTrue(world.chunks.has('3,3'), '区块 3,3 应该存在');
    assertTrue(world.chunks.has('9,9'), '区块 9,9 应该存在');

    teardownEnvironment();
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
  test('isSolid - 实心方块检测', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);

    // 等待所有 Chunk 的 Worker 响应返回
    // Chunk 生成是异步的，需要等待 isReady 为 true
    let waitCount = 0;
    while (waitCount < 50) { // 最多等待 5 秒
      const chunk = world.chunks.get('0,0');
      if (chunk && chunk.isReady) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
      waitCount++;
    }

    // 验证区块已准备就绪
    const chunk = world.chunks.get('0,0');
    assertNotNull(chunk, 'chunk 应该存在');
    assertTrue(chunk.isReady, 'chunk 应该是 ready 状态');

    // 放置实心方块
    world.setBlock(5, 10, 5, 'stone', 0);
    world.setBlock(6, 10, 5, 'collider', 0);

    // 验证 solidBlocks 包含方块
    assertTrue(chunk.solidBlocks.has('5,10,5'), 'stone 应该在 solidBlocks 中');
    assertTrue(chunk.solidBlocks.has('6,10,5'), 'collider 应该在 solidBlocks 中');

    assertTrue(world.isSolid(5, 10, 5), 'stone 应该是实心');
    assertTrue(world.isSolid(6, 10, 5), 'collider 应该是实心');

    teardownEnvironment();
  });

  test('isSolid - 非实心方块检测', async () => {
    setupEnvironment();

    scene = new THREE.Scene();
    world = new World(scene);
    world.update(new THREE.Vector3(0, 10, 0), 0.016);

    // 等待所有 Chunk 的 Worker 响应返回
    let waitCount = 0;
    while (waitCount < 50) { // 最多等待 5 秒
      const chunk = world.chunks.get('0,0');
      if (chunk && chunk.isReady) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
      waitCount++;
    }

    // 验证区块已准备就绪
    const chunk = world.chunks.get('0,0');
    assertNotNull(chunk, 'chunk 应该存在');
    assertTrue(chunk.isReady, 'chunk 应该是 ready 状态');

    // 放置非实心方块
    world.setBlock(5, 10, 5, 'glass_block', 0);

    // glass_block 不是实心
    assertFalse(world.isSolid(5, 10, 5), 'glass_block 不应该是实心');

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

});
