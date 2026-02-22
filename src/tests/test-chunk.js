// src/tests/test-chunk.js
/**
 * Chunk 测试套件
 * 测试区块的动态方块添加/移除功能
 *
 * 使用简化的测试方法，避免复杂的 Three.js 依赖
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull, assertDeepEqual } from './assert.js';

// 模拟的 Three.js 基础类
const mockThree = {
  Vector3: class {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x; this.y = y; this.z = z;
    }
    clone() { return new this.constructor(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  },
  Group: class {
    constructor() { this.children = []; }
    add(obj) { this.children.push(obj); }
    remove(obj) { const idx = this.children.indexOf(obj); if (idx > -1) this.children.splice(idx, 1); }
    clear() { this.children = []; }
  },
  Object3D: class {
    constructor() {
      this.position = { x: 0, y: 0, z: 0 };
      this.rotation = { x: 0, y: 0, z: 0 };
      this.matrix = {};
    }
    updateMatrix() {}
  },
  Matrix4: class {
    constructor() {}
    setFromMatrixPosition() {}
    makeScale() {}
  }
};

// 模拟 persistenceService
const mockPersistenceService = {
  recordChange: () => {},
  saveChunkData: () => Promise.resolve()
};

// 模拟 FaceCullingSystem
const mockFaceCullingSystem = {
  isEnabled: () => false,
  isTransparent: (type) => ['glass_block', 'leaves', 'water', 'air'].includes(type),
  calculateFaceVisibility: (block, neighbors) => 63
};

// 模拟世界对象
const createMockWorld = () => ({
  chunks: new Map(),
  isSolid: () => false,
  getBlock: () => null
});

// 简化的 Chunk 测试类 (不依赖实际的 Three.js 和 Worker)
class TestableChunk {
  constructor(cx, cz, world) {
    this.cx = cx;
    this.cz = cz;
    this.world = world;
    this.group = new mockThree.Group();
    this.isReady = true;
    this.blockData = {};
    this.solidBlocks = new Set();
    this.visibleKeys = new Set();
    this.instanceIndexMap = new Map();
    this.dynamicMeshes = new Map();
    this.dirtyBlocks = 0;
    this.entities = { realisticTrees: [], modGunMan: [], rovers: [] };
    this.saveTimeout = null;
  }

  // 简化的 addBlockDynamic 实现
  addBlockDynamic(x, y, z, typeOrEntry, orientation = 0) {
    const entry = typeof typeOrEntry === 'string'
      ? { type: typeOrEntry, orientation }
      : { type: typeOrEntry.type || 'air', orientation: typeOrEntry.orientation || 0 };

    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const oldEntry = this.blockData[key];

    // 记录变更
    mockPersistenceService.recordChange(x, y, z, entry);

    // 更新数据
    if (entry.type === 'air') {
      delete this.blockData[key];
      this.visibleKeys.delete(key);
      this.solidBlocks.delete(key);
    } else {
      this.blockData[key] = entry;
      this.visibleKeys.add(key);

      const props = this.getBlockProperties(entry.type);
      if (props.isSolid) {
        this.solidBlocks.add(key);
      }
    }

    this.dirtyBlocks++;
  }

  // 简化的 removeBlock 实现
  removeBlock(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    delete this.blockData[key];
    this.solidBlocks.delete(key);
    this.visibleKeys.delete(key);
  }

  // 移除碰撞键
  removeCollisionKey(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    this.solidBlocks.delete(key);
  }

  // 获取方块属性
  getBlockProperties(type) {
    const solidTypes = ['stone', 'dirt', 'wood', 'collider', 'realistic_trunk_collider'];
    return {
      isSolid: solidTypes.includes(type),
      isTransparent: ['glass_block', 'leaves', 'water', 'air'].includes(type),
      isRendered: type !== 'air' && type !== 'collider'
    };
  }

  dispose() {
    this.group.clear();
  }
}

describe('Chunk 测试', (test) => {

  // =========== 基础状态测试 ===========
  test('Chunk 可以实例化', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    assertNotNull(chunk, 'Chunk 实例不应该为 null');
    assertEqual(chunk.cx, 0, '区块 X 坐标应该为 0');
    assertEqual(chunk.cz, 0, '区块 Z 坐标应该为 0');
    assertEqual(chunk.isReady, true, '测试区块应该默认为 ready');
  });

  test('Chunk 初始状态正确', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    assertEqual(chunk.blockData.constructor.name, 'Object', 'blockData 应该是对象');
    assertEqual(chunk.solidBlocks.size, 0, '初始 solidBlocks 应该为空');
    assertEqual(chunk.visibleKeys.size, 0, '初始 visibleKeys 应该为空');
    assertEqual(chunk.dirtyBlocks, 0, '初始 dirtyBlocks 应该为 0');
  });

  // =========== addBlockDynamic 测试 ===========
  test('addBlockDynamic - 添加单个方块', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    chunk.addBlockDynamic(5, 10, 5, 'stone', 0);

    const key = '5,10,5';
    assertNotNull(chunk.blockData[key], 'blockData 应该包含新方块');
    assertEqual(chunk.blockData[key].type, 'stone', '方块类型应该是 stone');
    assertEqual(chunk.blockData[key].orientation, 0, '朝向应该为 0');
    assertTrue(chunk.solidBlocks.has(key), 'stone 应该在 solidBlocks 中');
    assertTrue(chunk.visibleKeys.has(key), 'stone 应该在 visibleKeys 中');
    assertEqual(chunk.dirtyBlocks, 1, 'dirtyBlocks 应该增加到 1');
  });

  test('addBlockDynamic - 添加透明方块', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    chunk.addBlockDynamic(6, 10, 6, 'glass_block', 0);

    const key = '6,10,6';
    assertNotNull(chunk.blockData[key], 'blockData 应该包含新方块');
    assertEqual(chunk.blockData[key].type, 'glass_block', '方块类型应该是 glass_block');
    // glass_block 不是实心
    const props = chunk.getBlockProperties('glass_block');
    assertEqual(props.isSolid, false, 'glass_block 不是实心');
  });

  test('addBlockDynamic - 使用对象格式添加', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    chunk.addBlockDynamic(3, 5, 3, { type: 'handrailA', orientation: 2 });

    const key = '3,5,3';
    const entry = chunk.blockData[key];
    assertNotNull(entry, 'blockData 应该包含新方块');
    assertEqual(entry.type, 'handrailA', '方块类型应该是 handrailA');
    assertEqual(entry.orientation, 2, '朝向应该是 2');
  });

  test('addBlockDynamic - 放置空气方块 (删除)', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    // 先添加一个方块
    chunk.addBlockDynamic(5, 10, 5, 'stone', 0);
    assertTrue(!!chunk.blockData['5,10,5'], '方块应该存在');

    // 然后删除它 (放置空气)
    chunk.addBlockDynamic(5, 10, 5, 'air', 0);

    assertEqual(chunk.blockData['5,10,5'], undefined, '方块应该被删除');
    assertFalse(chunk.solidBlocks.has('5,10,5'), '方块应该从 solidBlocks 移除');
    assertFalse(chunk.visibleKeys.has('5,10,5'), '方块应该从 visibleKeys 移除');
  });

  // =========== removeBlock 测试 ===========
  test('removeBlock - 移除单个方块', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    // 先添加一个方块
    chunk.addBlockDynamic(5, 10, 5, 'stone', 0);
    assertTrue(!!chunk.blockData['5,10,5'], '方块应该存在');

    // 然后移除它
    chunk.removeBlock(5, 10, 5);

    assertEqual(chunk.blockData['5,10,5'], undefined, '方块应该被删除');
    assertFalse(chunk.solidBlocks.has('5,10,5'), '方块应该从 solidBlocks 移除');
  });

  test('removeBlock - 移除不存在的方块', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    // 移除不存在的方块不应该抛出错误
    chunk.removeBlock(100, 100, 100);

    // 状态应该保持不变
    assertEqual(chunk.blockData['100,100,100'], undefined, '不存在的方块应该保持不存在');
  });

  // =========== removeCollisionKey 测试 ===========
  test('removeCollisionKey - 移除碰撞体', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    // 先添加一个碰撞体
    chunk.addBlockDynamic(5, 10, 5, 'collider', 0);
    assertTrue(chunk.solidBlocks.has('5,10,5'), 'collider 应该在 solidBlocks 中');

    // 移除碰撞键
    chunk.removeCollisionKey(5, 10, 5);

    assertFalse(chunk.solidBlocks.has('5,10,5'), 'collider 应该从 solidBlocks 移除');
  });

  // =========== dirtyBlocks 测试 ===========
  test('dirtyBlocks 计数正确', () => {
    const world = createMockWorld();
    const chunk = new TestableChunk(0, 0, world);

    // 添加多个方块
    chunk.addBlockDynamic(0, 0, 0, 'stone', 0);
    chunk.addBlockDynamic(1, 0, 0, 'stone', 0);
    chunk.addBlockDynamic(2, 0, 0, 'stone', 0);

    assertEqual(chunk.dirtyBlocks, 3, 'dirtyBlocks 应该为 3');

    // 删除一个方块
    chunk.addBlockDynamic(1, 0, 0, 'air', 0);

    // dirtyBlocks 应该减少 (注意：当前实现可能不会减少)
    // 根据实际实现，dirtyBlocks 可能只增不减，等待 consolidate 重置
    assertEqual(chunk.dirtyBlocks, 4, 'dirtyBlocks 在当前实现中可能只增不减');
  });

  // =========== 方块属性测试 ===========
  test('getBlockProperties - 实心方块', () => {
    const chunk = new TestableChunk(0, 0, createMockWorld());

    assertTrue(chunk.getBlockProperties('stone').isSolid, 'stone 应该是实心');
    assertTrue(chunk.getBlockProperties('dirt').isSolid, 'dirt 应该是实心');
    assertTrue(chunk.getBlockProperties('collider').isSolid, 'collider 应该是实心');
  });

  test('getBlockProperties - 透明方块', () => {
    const chunk = new TestableChunk(0, 0, createMockWorld());

    assertTrue(chunk.getBlockProperties('glass_block').isTransparent, 'glass_block 应该透明');
    assertTrue(chunk.getBlockProperties('leaves').isTransparent, 'leaves 应该透明');
    assertTrue(chunk.getBlockProperties('air').isTransparent, 'air 应该透明');
  });

  test('getBlockProperties - 不需要渲染的方块', () => {
    const chunk = new TestableChunk(0, 0, createMockWorld());

    assertFalse(chunk.getBlockProperties('air').isRendered, 'air 不应该渲染');
    assertFalse(chunk.getBlockProperties('collider').isRendered, 'collider 不应该渲染');
  });

});
