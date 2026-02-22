// src/tests/test-face-culling.js
/**
 * FaceCullingSystem 测试套件
 * 测试隐藏面剔除系统的核心功能
 *
 * 使用模拟对象，避免 Three.js 依赖
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull } from './assert.js';

// ========== 模拟 FaceCullingUtils ==========
const faceMask = {
  TOP: 1,
  BOTTOM: 2,
  NORTH: 4,
  SOUTH: 8,
  WEST: 16,
  EAST: 32,
  ALL: 63,
  NONE: 0
};

function countVisibleFaces(mask) {
  let count = 0;
  let temp = mask;
  while (temp) {
    count += temp & 1;
    temp >>= 1;
  }
  return count;
}

// ========== 模拟 FaceCullingSystem ==========
class MockFaceCullingSystem {
  constructor() {
    this.enabled = true;
    this.transparentBlocks = ['glass_block', 'leaves', 'water', 'air'];
    this.showAllBlocks = ['chest', 'anvil', 'enchanting_table'];
  }

  isEnabled() {
    return this.enabled;
  }

  enable() {
    this.enabled = true;
  }

  disable(reason) {
    this.enabled = false;
  }

  isTransparent(blockType) {
    return this.transparentBlocks.includes(blockType);
  }

  shouldShowFace(currentBlock, neighborBlock) {
    if (!neighborBlock) return true;
    if (!this.enabled) return true;

    // 透明方块总是显示所有面
    if (this.isTransparent(currentBlock.type)) return true;

    // 特殊方块总是显示所有面
    if (this.showAllBlocks.includes(currentBlock.type)) return true;

    // 相邻方块是空气或透明方块时显示面
    if (this.isTransparent(neighborBlock.type)) return true;

    // 相邻固体方块时隐藏面
    return false;
  }

  calculateFaceVisibility(block, neighbors) {
    if (!this.enabled) return faceMask.ALL;

    // 透明方块总是显示所有面
    if (this.isTransparent(block.type)) return faceMask.ALL;

    // 特殊方块总是显示所有面
    if (this.showAllBlocks.includes(block.type)) return faceMask.ALL;

    let visibility = faceMask.ALL;

    if (neighbors.top && !this.isTransparent(neighbors.top.type)) {
      visibility &= ~faceMask.TOP;
    }
    if (neighbors.bottom && !this.isTransparent(neighbors.bottom.type)) {
      visibility &= ~faceMask.BOTTOM;
    }
    if (neighbors.north && !this.isTransparent(neighbors.north.type)) {
      visibility &= ~faceMask.NORTH;
    }
    if (neighbors.south && !this.isTransparent(neighbors.south.type)) {
      visibility &= ~faceMask.SOUTH;
    }
    if (neighbors.west && !this.isTransparent(neighbors.west.type)) {
      visibility &= ~faceMask.WEST;
    }
    if (neighbors.east && !this.isTransparent(neighbors.east.type)) {
      visibility &= ~faceMask.EAST;
    }

    return visibility;
  }
}

// ========== 测试套件 ==========
describe('FaceCullingSystem 测试', (test) => {

  let system;

  // 在每个测试前创建新实例
  const getFreshSystem = () => {
    return new MockFaceCullingSystem();
  };

  // =========== 系统初始化测试 ===========
  test('系统默认启用', () => {
    system = getFreshSystem();
    assertTrue(system.enabled, '系统默认应该启用');
    assertTrue(system.isEnabled(), 'isEnabled() 应该返回 true');
  });

  test('系统可以禁用', () => {
    system = getFreshSystem();
    system.disable('test');
    assertFalse(system.enabled, '禁用后 enabled 应该为 false');
    assertFalse(system.isEnabled(), 'isEnabled() 应该返回 false');
  });

  test('系统可以重新启用', () => {
    system = getFreshSystem();
    system.disable('test');
    system.enable();
    assertTrue(system.enabled, '重新启用后 enabled 应该为 true');
  });

  // =========== isTransparent 测试 ===========
  test('isTransparent - 透明方块识别', () => {
    system = getFreshSystem();

    assertTrue(system.isTransparent('leaves'), 'leaves 应该透明');
    assertTrue(system.isTransparent('glass_block'), 'glass_block 应该透明');
    assertTrue(system.isTransparent('water'), 'water 应该透明');
    assertTrue(system.isTransparent('air'), 'air 应该透明');
  });

  test('isTransparent - 不透明方块识别', () => {
    system = getFreshSystem();

    assertFalse(system.isTransparent('stone'), 'stone 应该不透明');
    assertFalse(system.isTransparent('dirt'), 'dirt 应该不透明');
    assertFalse(system.isTransparent('planks'), 'planks 应该不透明');
  });

  // =========== shouldShowFace 测试 ===========
  test('shouldShowFace - 无相邻方块时面可见', () => {
    system = getFreshSystem();
    const currentBlock = { type: 'stone' };
    const neighborBlock = null;

    assertTrue(system.shouldShowFace(currentBlock, neighborBlock), '无相邻方块时面应该可见');
  });

  test('shouldShowFace - 相邻透明方块时面可见', () => {
    system = getFreshSystem();
    const currentBlock = { type: 'stone' };
    const neighborBlock = { type: 'glass_block' };

    assertTrue(system.shouldShowFace(currentBlock, neighborBlock), '相邻透明方块时面应该可见');
  });

  test('shouldShowFace - 相邻固体方块时面隐藏', () => {
    system = getFreshSystem();
    const currentBlock = { type: 'stone' };
    const neighborBlock = { type: 'stone' };

    assertFalse(system.shouldShowFace(currentBlock, neighborBlock), '相邻固体方块时面应该隐藏');
  });

  // =========== calculateFaceVisibility 测试 ===========
  test('calculateFaceVisibility - 完全暴露的方块', () => {
    system = getFreshSystem();
    const block = { type: 'stone' };
    const neighbors = {
      top: null,
      bottom: null,
      north: null,
      south: null,
      west: null,
      east: null
    };

    const visibility = system.calculateFaceVisibility(block, neighbors);
    assertEqual(visibility, faceMask.ALL, '完全暴露的方块所有面应该可见');
    assertEqual(countVisibleFaces(visibility), 6, '完全暴露的方块有 6 个可见面');
  });

  test('calculateFaceVisibility - 完全包围的方块', () => {
    system = getFreshSystem();
    const block = { type: 'stone' };
    const neighbors = {
      top: { type: 'stone' },
      bottom: { type: 'stone' },
      north: { type: 'stone' },
      south: { type: 'stone' },
      west: { type: 'stone' },
      east: { type: 'stone' }
    };

    const visibility = system.calculateFaceVisibility(block, neighbors);
    assertEqual(visibility, 0, '完全包围的方块所有面应该隐藏');
    assertEqual(countVisibleFaces(visibility), 0, '完全包围的方块有 0 个可见面');
  });

  test('calculateFaceVisibility - 部分暴露的方块', () => {
    system = getFreshSystem();
    const block = { type: 'stone' };
    const neighbors = {
      top: null,        // 可见
      bottom: { type: 'stone' },
      north: null,      // 可见
      south: { type: 'stone' },
      west: null,       // 可见
      east: { type: 'stone' }
    };

    const visibility = system.calculateFaceVisibility(block, neighbors);

    // 检查 top, north, west 面是否可见
    assertTrue((visibility & faceMask.TOP) !== 0, '顶面应该可见');
    assertTrue((visibility & faceMask.NORTH) !== 0, '北面应该可见');
    assertTrue((visibility & faceMask.WEST) !== 0, '西面应该可见');

    // 检查 bottom, south, east 面是否隐藏
    assertTrue((visibility & faceMask.BOTTOM) === 0, '底面应该隐藏');
    assertTrue((visibility & faceMask.SOUTH) === 0, '南面应该隐藏');
    assertTrue((visibility & faceMask.EAST) === 0, '东面应该隐藏');

    assertEqual(countVisibleFaces(visibility), 3, '应该有 3 个可见面');
  });

  test('calculateFaceVisibility - 透明方块所有面可见', () => {
    system = getFreshSystem();
    const block = { type: 'glass_block' };
    const neighbors = {
      top: { type: 'stone' },
      bottom: { type: 'stone' },
      north: { type: 'stone' },
      south: { type: 'stone' },
      west: { type: 'stone' },
      east: { type: 'stone' }
    };

    const visibility = system.calculateFaceVisibility(block, neighbors);
    assertEqual(visibility, faceMask.ALL, '透明方块所有面应该可见');
    assertEqual(countVisibleFaces(visibility), 6, '透明方块有 6 个可见面');
  });

  test('calculateFaceVisibility - 宝箱所有面可见', () => {
    system = getFreshSystem();
    const block = { type: 'chest' };
    const neighbors = {
      top: { type: 'stone' },
      bottom: { type: 'stone' },
      north: { type: 'stone' },
      south: { type: 'stone' },
      west: { type: 'stone' },
      east: { type: 'stone' }
    };

    const visibility = system.calculateFaceVisibility(block, neighbors);
    assertEqual(visibility, faceMask.ALL, '宝箱所有面应该可见');
  });

  // =========== 系统禁用时的行为测试 ===========
  test('系统禁用时所有面可见', () => {
    system = getFreshSystem();
    system.disable('test');

    const block = { type: 'stone' };
    const neighbors = {
      top: { type: 'stone' },
      bottom: { type: 'stone' },
      north: { type: 'stone' },
      south: { type: 'stone' },
      west: { type: 'stone' },
      east: { type: 'stone' }
    };

    const visibility = system.calculateFaceVisibility(block, neighbors);
    assertEqual(visibility, faceMask.ALL, '系统禁用时所有面应该可见');
  });

  // =========== faceMask 工具函数测试 ===========
  test('faceMask 值正确', () => {
    assertEqual(faceMask.TOP, 1, 'TOP 掩码值为 1');
    assertEqual(faceMask.BOTTOM, 2, 'BOTTOM 掩码值为 2');
    assertEqual(faceMask.NORTH, 4, 'NORTH 掩码值为 4');
    assertEqual(faceMask.SOUTH, 8, 'SOUTH 掩码值为 8');
    assertEqual(faceMask.WEST, 16, 'WEST 掩码值为 16');
    assertEqual(faceMask.EAST, 32, 'EAST 掩码值为 32');
    assertEqual(faceMask.ALL, 63, 'ALL 掩码值为 63');
  });

  test('countVisibleFaces - 计数正确', () => {
    assertEqual(countVisibleFaces(0), 0, '0 个可见面');
    assertEqual(countVisibleFaces(1), 1, '1 个可见面 (TOP)');
    assertEqual(countVisibleFaces(63), 6, '6 个可见面 (ALL)');
    assertEqual(countVisibleFaces(21), 3, '3 个可见面 (TOP|NORTH|WEST)');
  });

});
