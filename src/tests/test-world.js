// src/tests/test-world.js
/**
 * World 测试套件
 * 测试世界系统的方块放置/挖掘功能
 *
 * 注意：由于 World 类依赖 Three.js 和 Chunk，
 * 本测试使用简化的测试类来验证核心逻辑。
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull } from './assert.js';
import { PERSISTENCE_CONFIG } from '../constants/PersistenceConfig.js';

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
  }
};

// 简化的 Chunk 类用于 World 测试
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
  }

  addBlockDynamic(x, y, z, typeOrEntry, orientation = 0) {
    const entry = typeof typeOrEntry === 'string'
      ? { type: typeOrEntry, orientation }
      : { type: typeOrEntry.type || 'air', orientation: typeOrEntry.orientation || 0 };

    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;

    if (entry.type === 'air') {
      delete this.blockData[key];
      this.solidBlocks.delete(key);
      this.visibleKeys.delete(key);
    } else {
      this.blockData[key] = entry;
      this.visibleKeys.add(key);

      const solidTypes = ['stone', 'dirt', 'wood', 'collider'];
      if (solidTypes.includes(entry.type)) {
        this.solidBlocks.add(key);
      }
    }
  }

  removeBlock(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    delete this.blockData[key];
    this.solidBlocks.delete(key);
    this.visibleKeys.delete(key);
  }

  removeBlocksBatch(positions) {
    positions.forEach(p => this.removeBlock(p.x, p.y, p.z));
  }

  dispose() {
    this.group.clear();
  }
}

// 简化的 World 测试类
class TestableWorld {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.chunkSize = PERSISTENCE_CONFIG.CHUNK_SIZE;
    this.renderDist = 3;
  }

  // 更新世界 (加载/卸载区块)
  update(playerPos = new mockThree.Vector3(0, 0, 0)) {
    const cx = Math.floor(playerPos.x / this.chunkSize);
    const cz = Math.floor(playerPos.z / this.chunkSize);

    // 加载新区块
    for (let i = -this.renderDist; i <= this.renderDist; i++) {
      for (let j = -this.renderDist; j <= this.renderDist; j++) {
        const key = `${cx + i},${cz + j}`;
        if (!this.chunks.has(key)) {
          const chunk = new TestableChunk(cx + i, cz + j, this);
          this.chunks.set(key, chunk);
          this.scene.add(chunk.group);
        }
      }
    }

    // 卸载过期区块
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - cx) > this.renderDist + 1 || Math.abs(chunk.cz - cz) > this.renderDist + 1) {
        this.scene.remove(chunk.group);
        chunk.dispose();
        this.chunks.delete(key);
      }
    }
  }

  // 放置方块
  setBlock(x, y, z, typeOrEntry, orientation = 0) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const key = `${cx},${cz}`;
    let chunk = this.chunks.get(key);

    if (!chunk) {
      return; // 只能在已加载的区块中放置方块
    }

    chunk.addBlockDynamic(x, y, z, typeOrEntry, orientation);
  }

  // 移除方块
  removeBlock(x, y, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);
    if (chunk) {
      chunk.removeBlock(x, y, z);
    }
  }

  // 获取方块类型
  getBlock(x, y, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return null;

    const blockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const entry = chunk.blockData[blockKey];
    if (!entry) return null;
    return entry.type;
  }

  // 检查是否实心
  isSolid(x, y, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const key = `${cx},${cz}`;
    const chunk = this.chunks.get(key);

    if (!chunk || !chunk.isReady) {
      return y <= 0; // 未加载区块使用简单高度判断
    }

    const blockKey = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    return chunk.solidBlocks.has(blockKey);
  }

  // 批量移除方块
  removeBlocksBatch(positions) {
    const chunkGroups = new Map();
    positions.forEach(p => {
      const cx = Math.floor(p.x / this.chunkSize);
      const cz = Math.floor(p.z / this.chunkSize);
      const key = `${cx},${cz}`;
      if (!chunkGroups.has(key)) chunkGroups.set(key, []);
      chunkGroups.get(key).push(p);
    });

    for (const [key, chunkPosList] of chunkGroups) {
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.removeBlocksBatch(chunkPosList);
      }
    }
  }
}

describe('World 测试', (test) => {

  let mockScene;
  let world;

  const createScene = () => new mockThree.Group();

  // =========== 基础初始化测试 ===========
  test('World 可以实例化', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);

    assertNotNull(world, 'World 实例不应该为 null');
    assertNotNull(world.chunks, 'chunks Map 应该存在');
    assertEqual(world.chunks.size, 0, '初始 chunks 应该为空');
  });

  // =========== setBlock 测试 ===========
  test('setBlock - 在已加载区块放置方块', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);

    // 先更新世界以加载区块 (玩家在原点)
    world.update(new mockThree.Vector3(0, 10, 0));

    // 在玩家附近放置方块
    world.setBlock(5, 10, 5, 'stone', 0);

    // 验证方块已放置
    const blockType = world.getBlock(5, 10, 5);
    assertEqual(blockType, 'stone', '方块类型应该是 stone');
  });

  test('setBlock - 在未加载区块放置方块 (应忽略)', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);

    // 不要调用 update，这样区块不会加载

    // 在远处放置方块 (区块未加载)
    world.setBlock(1000, 100, 1000, 'diamond', 0);

    // 应该返回 null (因为区块不存在)
    const blockType = world.getBlock(1000, 100, 1000);
    assertEqual(blockType, null, '未加载区块的方块应该返回 null');
  });

  test('setBlock - 放置多种方块类型', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);
    world.update(new mockThree.Vector3(0, 10, 0));

    // 放置不同类型的方块
    world.setBlock(0, 10, 0, 'dirt', 0);
    world.setBlock(1, 10, 0, 'wood', 0);
    world.setBlock(2, 10, 0, 'glass_block', 0);
    world.setBlock(3, 10, 0, 'chest', 0);

    assertEqual(world.getBlock(0, 10, 0), 'dirt', '应该放置 dirt');
    assertEqual(world.getBlock(1, 10, 0), 'wood', '应该放置 wood');
    assertEqual(world.getBlock(2, 10, 0), 'glass_block', '应该放置 glass_block');
    assertEqual(world.getBlock(3, 10, 0), 'chest', '应该放置 chest');
  });

  test('setBlock - 使用对象格式放置', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);
    world.update(new mockThree.Vector3(0, 10, 0));

    // 使用对象格式放置 (带朝向)
    world.setBlock(5, 10, 5, { type: 'handrailA', orientation: 2 }, 0);

    const blockType = world.getBlock(5, 10, 5);
    assertNotNull(blockType, '应该返回方块类型');
    // 注意：getBlock 只返回类型，要获取朝向需要使用 getBlockEntry
  });

  // =========== removeBlock 测试 ===========
  test('removeBlock - 移除单个方块', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);
    world.update(new mockThree.Vector3(0, 10, 0));

    // 先放置一个方块
    world.setBlock(5, 10, 5, 'stone', 0);
    assertEqual(world.getBlock(5, 10, 5), 'stone', '应该放置 stone');

    // 然后移除它
    world.removeBlock(5, 10, 5);

    const blockType = world.getBlock(5, 10, 5);
    assertEqual(blockType, null, '移除后应该返回 null');
  });

  test('removeBlock - 移除不存在的方块', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);
    world.update(new mockThree.Vector3(0, 10, 0));

    // 移除不存在的方块不应该抛出错误
    world.removeBlock(999, 999, 999);

    // 状态应该保持不变
    assertEqual(world.getBlock(999, 999, 999), null, '不存在的方块应该返回 null');
  });

  // =========== isSolid 测试 ===========
  test('isSolid - 实心方块检测', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);
    world.update(new mockThree.Vector3(0, 10, 0));

    // 放置实心方块
    world.setBlock(5, 10, 5, 'stone', 0);
    world.setBlock(6, 10, 5, 'collider', 0);

    assertTrue(world.isSolid(5, 10, 5), 'stone 应该是实心');
    assertTrue(world.isSolid(6, 10, 5), 'collider 应该是实心');
  });

  test('isSolid - 非实心方块检测', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);
    world.update(new mockThree.Vector3(0, 10, 0));

    // 放置非实心方块
    world.setBlock(5, 10, 5, 'glass_block', 0);

    // glass_block 不是实心
    assertFalse(world.isSolid(5, 10, 5), 'glass_block 不应该是实心');
  });

  // =========== removeBlocksBatch 测试 ===========
  test('removeBlocksBatch - 批量移除方块', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);
    world.update(new mockThree.Vector3(0, 10, 0));

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
  });

  // =========== 区块加载/卸载测试 ===========
  test('update - 加载玩家周围区块', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);

    // 玩家在原点
    world.update(new mockThree.Vector3(0, 10, 0));

    // 验证 7x7 的区块已加载 (渲染距离 3)
    assertEqual(world.chunks.size, 49, '应该加载 49 个区块 (7x7)');

    // 验证特定区块存在
    assertTrue(world.chunks.has('0,0'), '区块 0,0 应该存在');
    assertTrue(world.chunks.has('3,3'), '区块 3,3 应该存在');
    assertTrue(world.chunks.has('-3,-3'), '区块 -3,-3 应该存在');
  });

  test('update - 玩家移动时卸载旧区块', () => {
    mockScene = createScene();
    world = new TestableWorld(mockScene);

    // 先在原点加载区块
    world.update(new mockThree.Vector3(0, 10, 0));
    const initialSize = world.chunks.size;
    assertEqual(initialSize, 49, '初始应该有 49 个区块');

    // 移动到远处 (100, 100) -> 区块 (6, 6)
    world.update(new mockThree.Vector3(100, 10, 100));

    // 验证旧区块已卸载 (0,0 距离 6,6 太远应该卸载)
    assertFalse(world.chunks.has('0,0'), '区块 0,0 应该已卸载');
    assertFalse(world.chunks.has('-3,-3'), '区块 -3,-3 应该已卸载');

    // 验证新区块已加载
    assertTrue(world.chunks.has('6,6'), '区块 6,6 应该存在 (100/16=6)');
    assertTrue(world.chunks.has('3,3'), '区块 3,3 应该存在');
    assertTrue(world.chunks.has('9,9'), '区块 9,9 应该存在');

    // 注意：由于区块卸载有缓冲区域 (renderDist + 1)，部分中间区块可能保留
    // 这是正常行为，避免频繁加载/卸载
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
