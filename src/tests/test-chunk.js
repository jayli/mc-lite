// src/tests/test-chunk.js
/**
 * Chunk 测试套件
 * 测试区块的动态方块添加/移除功能
 *
 * 使用真实的 Chunk 类，模拟 Three.js 和 Worker 依赖
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull } from './assert.js';
import { Chunk } from '../world/Chunk.js';

// 模拟的 Three.js 基础类（用于 Chunk 的依赖）
const mockThree = {
  Vector3: class {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x; this.y = y; this.z = z;
    }
    clone() { return new this.constructor(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  },
  Matrix4: class {
    constructor() {
      this.elements = new Array(16).fill(0);
    }
    setFromMatrixPosition(m) {
      this.elements[12] = m.elements[12];
      this.elements[13] = m.elements[13];
      this.elements[14] = m.elements[14];
    }
    makeScale(x, y, z) {
      this.elements[0] = x;
      this.elements[5] = y;
      this.elements[10] = z;
      return this;
    }
  },
  Group: class {
    constructor() {
      this.children = [];
      this.position = { x: 0, y: 0, z: 0 };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
    add(obj) {
      if (!this.children.includes(obj)) {
        this.children.push(obj);
        obj.parent = this;
      }
    }
    remove(obj) {
      const idx = this.children.indexOf(obj);
      if (idx > -1) {
        this.children.splice(idx, 1);
        obj.parent = null;
      }
    }
    clear() {
      this.children = [];
    }
  },
  Object3D: class {
    constructor() {
      this.position = { x: 0, y: 0, z: 0 };
      this.rotation = { x: 0, y: 0, z: 0 };
      this.matrix = new this.constructor.Matrix4();
      this.userData = {};
    }
    updateMatrix() {}
    clone() {
      const cloned = new this.constructor();
      cloned.position = { ...this.position };
      cloned.rotation = { ...this.rotation };
      cloned.userData = { ...this.userData };
      return cloned;
    }
  },
  Mesh: class {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = { x: 0, y: 0, z: 0 };
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = { x: 1, y: 1, z: 1 };
      this.userData = {};
      this.frustumCulled = true;
      this.isMesh = true;
    }
  },
  InstancedMesh: class {
    constructor(geometry, material, count) {
      this.geometry = geometry;
      this.material = material;
      this.count = count;
      this.instanceMatrix = { setMatrixAt: () => {} };
      this.userData = {};
      this.isInstancedMesh = true;
    }
  },
  BufferGeometry: class {
    constructor() {
      this.attributes = {};
    }
    setAttribute(name, attr) {
      this.attributes[name] = attr;
      return this;
    }
    clone() {
      const cloned = new this.constructor();
      cloned.attributes = { ...this.attributes };
      return cloned;
    }
  },
  BoxGeometry: class {
    constructor(w, h, d) {
      this.parameters = { width: w, height: h, depth: d };
    }
  },
  PlaneGeometry: class {
    constructor(w, h) {
      this.parameters = { width: w, height: h };
    }
    rotateY() {}
    rotateX() {}
    translate() {}
  },
  CylinderGeometry: class {
    constructor() {
      this.parameters = {};
    }
  },
  SphereGeometry: class {
    constructor() {
      this.parameters = {};
    }
  },
  BufferAttribute: class {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.count = array.length / itemSize;
    }
  },
  Quaternion: class {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x; this.y = y; this.z = z; this.w = w;
    }
    setFromAxisAngle(axis, angle) {
      // 简化实现
      this.w = 1;
    }
  }
};

// 添加 Matrix4 到 Object3D
mockThree.Object3D.Matrix4 = mockThree.Matrix4;

// 模拟 BufferGeometryUtils
const BufferGeometryUtils = {
  mergeGeometries: (geometries) => {
    return new mockThree.BufferGeometry();
  }
};

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
  updateBlock: () => {}
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

// 模拟 WorldWorker
class MockWorldWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
  }
  postMessage(msg) {
    // 模拟 Worker 响应，延迟触发 onmessage
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage({
          data: {
            cx: msg.cx,
            cz: msg.cz,
            d: {},
            solidBlocks: [],
            realisticTrees: [],
            modGunMan: [],
            rovers: [],
            allBlockTypes: [],
            visibleKeys: [],
            snapshot: null
          }
        });
      }
    }, 10);
  }
}

// 创建模拟的 World 对象
const createMockWorld = () => ({
  chunks: new Map(),
  isSolid: (x, y, z) => false,
  getBlock: (x, y, z) => null
});

describe('Chunk 真实类测试', (test) => {

  let originalWorker;
  let originalPersistenceService, originalFaceCullingSystem;
  let originalMaterials, originalBlockData, originalCarModel, originalGunManModel;

  // 在测试前设置模拟环境
  const setupEnvironment = () => {
    // 保存原始引用
    originalWorker = globalThis.Worker;
    originalPersistenceService = globalThis._persistenceService;
    originalFaceCullingSystem = globalThis._faceCullingSystem;
    originalMaterials = globalThis._materials;
    originalBlockData = globalThis._blockData;
    originalCarModel = globalThis._carModel;
    originalGunManModel = globalThis._gunManModel;

    // 设置模拟
    globalThis.Worker = MockWorldWorker;
    globalThis._persistenceService = mockPersistenceService;
    globalThis._faceCullingSystem = mockFaceCullingSystem;
    globalThis._materials = mockMaterials;
    globalThis._blockData = mockBlockData;
    globalThis._carModel = { clone: () => null };
    globalThis._gunManModel = { clone: () => null };
  };

  // 恢复原始环境
  const teardownEnvironment = () => {
    if (originalWorker) globalThis.Worker = originalWorker;
    if (originalPersistenceService) globalThis._persistenceService = originalPersistenceService;
    if (originalFaceCullingSystem) globalThis._faceCullingSystem = originalFaceCullingSystem;
    if (originalMaterials) globalThis._materials = originalMaterials;
    if (originalBlockData) globalThis._blockData = originalBlockData;
    if (originalCarModel) globalThis._carModel = originalCarModel;
    if (originalGunManModel) globalThis._gunManModel = originalGunManModel;
  };

  // =========== 基础状态测试 ===========
  test('Chunk 可以实例化', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    assertNotNull(chunk, 'Chunk 实例不应该为 null');
    assertEqual(chunk.cx, 0, '区块 X 坐标应该为 0');
    assertEqual(chunk.cz, 0, '区块 Z 坐标应该为 0');

    teardownEnvironment();
  });

  test('Chunk 初始状态正确', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    assertEqual(chunk.blockData.constructor.name, 'Object', 'blockData 应该是对象');
    assertEqual(chunk.solidBlocks.size, 0, '初始 solidBlocks 应该为空');
    assertEqual(chunk.visibleKeys.size, 0, '初始 visibleKeys 应该为空');
    assertEqual(chunk.dirtyBlocks, 0, '初始 dirtyBlocks 应该为 0');
    assertEqual(chunk.isReady, false, '初始 isReady 应该为 false（等待 Worker 响应）');

    teardownEnvironment();
  });

  test('Chunk 的 group 是 Three.js Group', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    assertNotNull(chunk.group, 'group 不应该为 null');
    assertTrue(Array.isArray(chunk.group.children), 'group.children 应该是数组');

    teardownEnvironment();
  });

  // =========== addBlockDynamic 测试 ===========
  test('addBlockDynamic - 添加单个方块并验证数据完整性', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    // 添加一个方块
    chunk.addBlockDynamic(5, 10, 5, 'stone', 0);

    // 验证 blockData
    const key = '5,10,5';
    assertNotNull(chunk.blockData[key], 'blockData 应该包含新方块');
    assertEqual(chunk.blockData[key].type, 'stone', '方块类型应该是 stone');
    assertEqual(chunk.blockData[key].orientation, 0, '朝向应该为 0');

    teardownEnvironment();
  });

  test('addBlockDynamic - 添加透明方块并验证可见性', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    chunk.addBlockDynamic(6, 10, 6, 'glass_block', 0);

    const key = '6,10,6';
    assertNotNull(chunk.blockData[key], 'blockData 应该包含新方块');
    assertEqual(chunk.blockData[key].type, 'glass_block', '方块类型应该是 glass_block');
    assertTrue(chunk.visibleKeys.has(key), 'glass_block 应该在 visibleKeys 中');

    teardownEnvironment();
  });

  test('addBlockDynamic - 使用对象格式添加方块', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    chunk.addBlockDynamic(3, 5, 3, { type: 'handrailA', orientation: 2 });

    const key = '3,5,3';
    const entry = chunk.blockData[key];
    assertNotNull(entry, 'blockData 应该包含新方块');
    assertEqual(entry.type, 'handrailA', '方块类型应该是 handrailA');
    assertEqual(entry.orientation, 2, '朝向应该是 2');

    teardownEnvironment();
  });

  test('addBlockDynamic - 放置空气方块 (删除方块)', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    // 先添加一个方块
    chunk.addBlockDynamic(5, 10, 5, 'stone', 0);
    assertTrue(!!chunk.blockData['5,10,5'], '方块应该存在');
    assertTrue(chunk.visibleKeys.has('5,10,5'), '方块应该在 visibleKeys 中');

    // 然后删除它（放置空气）
    chunk.addBlockDynamic(5, 10, 5, 'air', 0);

    assertEqual(chunk.blockData['5,10,5'], undefined, '方块应该被删除');
    assertFalse(chunk.visibleKeys.has('5,10,5'), '方块应该从 visibleKeys 移除');

    teardownEnvironment();
  });

  test('addBlockDynamic - dirtyBlocks 计数正确', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    // 添加多个方块
    chunk.addBlockDynamic(0, 0, 0, 'stone', 0);
    chunk.addBlockDynamic(1, 0, 0, 'stone', 0);
    chunk.addBlockDynamic(2, 0, 0, 'stone', 0);

    // dirtyBlocks 应该增加
    assertTrue(chunk.dirtyBlocks > 0, 'dirtyBlocks 应该大于 0');

    teardownEnvironment();
  });

  // =========== removeBlock 测试 ===========
  test('removeBlock - 移除单个方块', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    // 先添加一个方块
    chunk.addBlockDynamic(5, 10, 5, 'stone', 0);
    assertTrue(!!chunk.blockData['5,10,5'], '方块应该存在');

    // 然后移除它
    chunk.removeBlock(5, 10, 5);

    assertEqual(chunk.blockData['5,10,5'], undefined, '方块应该被删除');

    teardownEnvironment();
  });

  test('removeBlock - 移除不存在的方块不报错', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    // 移除不存在的方块不应该抛出错误
    chunk.removeBlock(100, 100, 100);

    // 状态应该保持不变
    assertEqual(chunk.blockData['100,100,100'], undefined, '不存在的方块应该保持不存在');

    teardownEnvironment();
  });

  // =========== getBlockEntry 测试 ===========
  test('getBlockEntry - 获取存在的方块', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    chunk.addBlockDynamic(5, 10, 5, 'diamond', 2);

    const entry = chunk.getBlockEntry(5, 10, 5);
    assertNotNull(entry, '应该返回方块信息');
    assertEqual(entry.type, 'diamond', '方块类型应该是 diamond');
    assertEqual(entry.orientation, 2, '朝向应该是 2');

    teardownEnvironment();
  });

  test('getBlockEntry - 获取不存在的方块返回 null', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    const entry = chunk.getBlockEntry(100, 100, 100);
    assertEqual(entry, null, '不存在的方块应该返回 null');

    teardownEnvironment();
  });

  // =========== getBlockOrientation 测试 ===========
  test('getBlockOrientation - 获取存在的方块朝向', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    chunk.addBlockDynamic(5, 10, 5, 'log', 3);

    const orientation = chunk.getBlockOrientation(5, 10, 5);
    assertEqual(orientation, 3, '朝向应该是 3');

    teardownEnvironment();
  });

  test('getBlockOrientation - 获取不存在的方块返回 0', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    const orientation = chunk.getBlockOrientation(100, 100, 100);
    assertEqual(orientation, 0, '不存在的方块应该返回 0');

    teardownEnvironment();
  });

  // =========== 多区块交互测试 ===========
  test('跨 Chunk 边界添加方块', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk0 = new Chunk(0, 0, world);
    const chunk1 = new Chunk(1, 0, world);

    world.chunks.set('0,0', chunk0);
    world.chunks.set('1,0', chunk1);

    // 在 chunk0 的边界添加方块
    chunk0.addBlockDynamic(15, 10, 8, 'stone', 0); // chunk0 的 X 边界
    chunk0.addBlockDynamic(8, 10, 15, 'stone', 0); // chunk0 的 Z 边界

    // 验证方块存在
    assertNotNull(chunk0.blockData['15,10,8'], '边界方块应该存在');
    assertNotNull(chunk0.blockData['8,10,15'], '边界方块应该存在');

    teardownEnvironment();
  });

  // =========== 方块类型测试 ===========
  test('添加不同类型方块并验证', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    const blockTypes = [
      'stone', 'dirt', 'wood', 'glass_block',
      'leaves', 'water', 'handrailA', 'pillar'
    ];

    blockTypes.forEach((type, index) => {
      chunk.addBlockDynamic(index, 10, 0, type, 0);
      const key = `${index},10,0`;
      assertNotNull(chunk.blockData[key], `${type} 方块应该存在`);
      assertEqual(chunk.blockData[key].type, type, `方块类型应该是 ${type}`);
    });

    teardownEnvironment();
  });

  // =========== 方块完整性检查 ===========
  test('方块数据完整性 - 大量方块添加后验证', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    const addedBlocks = [];

    // 添加大量方块
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 5; y++) {
        for (let z = 0; z < 10; z++) {
          const type = (x + y + z) % 3 === 0 ? 'stone' : 'dirt';
          chunk.addBlockDynamic(x, y, z, type, 0);
          addedBlocks.push({ x, y, z, type });
        }
      }
    }

    // 验证所有方块都存在
    let successCount = 0;
    addedBlocks.forEach(block => {
      const key = `${block.x},${block.y},${block.z}`;
      if (chunk.blockData[key] && chunk.blockData[key].type === block.type) {
        successCount++;
      }
    });

    assertEqual(successCount, addedBlocks.length, '所有添加的方块都应该存在且类型正确');

    teardownEnvironment();
  });

  test('方块删除后验证数据一致性', () => {
    setupEnvironment();

    const world = createMockWorld();
    const chunk = new Chunk(0, 0, world);

    // 添加一些方块
    chunk.addBlockDynamic(5, 10, 5, 'stone', 0);
    chunk.addBlockDynamic(6, 10, 5, 'dirt', 0);
    chunk.addBlockDynamic(7, 10, 5, 'wood', 0);

    // 删除中间的方块
    chunk.removeBlock(6, 10, 5);

    // 验证删除的方块不存在
    assertEqual(chunk.blockData['6,10,5'], undefined, '中间的方块应该被删除');

    // 验证其他方块仍然存在
    assertNotNull(chunk.blockData['5,10,5'], '第一个方块应该存在');
    assertNotNull(chunk.blockData['7,10,5'], '第三个方块应该存在');

    teardownEnvironment();
  });

});
