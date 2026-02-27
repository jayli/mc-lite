// src/tests/test-face-culling.js
/**
 * FaceCullingSystem 测试套件
 * 测试隐藏面剔除系统的核心功能
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull } from './assert.js';
import { faceMask, countVisibleFaces } from '../utils/FaceCullingUtils.js';
import { FaceCullingSystem } from '../core/FaceCullingSystem.js';

// ========== 测试套件 ==========
describe('FaceCullingSystem 测试', (test) => {

  let system;

  // 在每个测试前创建新实例
  const getFreshSystem = () => {
    return new FaceCullingSystem();
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

  // =========== 补充测试用例（来自 test-face-culling.html） ===========
  test('孤立方块测试 - 所有相邻位置为空', () => {
    system = getFreshSystem();
    const isolatedBlock = { type: 'stone' };
    const emptyNeighbors = {
      top: null, bottom: null, north: null, south: null, west: null, east: null
    };

    const mask = system.calculateFaceVisibility(isolatedBlock, emptyNeighbors);
    assertEqual(mask, faceMask.ALL, '孤立方块的所有面都应该可见');
  });

  test('完全包围方块测试 - 所有相邻位置为固体', () => {
    system = getFreshSystem();
    const surroundedBlock = { type: 'stone' };
    const solidNeighbors = {
      top: { type: 'stone' },
      bottom: { type: 'stone' },
      north: { type: 'stone' },
      south: { type: 'stone' },
      west: { type: 'stone' },
      east: { type: 'stone' }
    };

    const mask = system.calculateFaceVisibility(surroundedBlock, solidNeighbors);
    assertEqual(mask, faceMask.NONE, '完全包围的方块所有面都应该隐藏');
  });

  test('部分相邻测试 - 混合情况', () => {
    system = getFreshSystem();
    const partialBlock = { type: 'stone' };
    const partialNeighbors = {
      top: null,        // 可见
      bottom: { type: 'stone' },
      north: null,      // 可见
      south: { type: 'stone' },
      west: null,       // 可见
      east: { type: 'stone' }
    };

    const mask = system.calculateFaceVisibility(partialBlock, partialNeighbors);
    const expected = faceMask.TOP | faceMask.NORTH | faceMask.WEST;
    assertEqual(mask, expected, '上面、北面、西面应该可见');
    assertEqual(countVisibleFaces(mask), 3, '应该有 3 个可见面');
  });

  test('透明方块测试 - 所有面可见', () => {
    system = getFreshSystem();
    system.addTransparentType('glass');

    const transparentBlock = { type: 'glass' };
    const mixedNeighbors = {
      top: { type: 'stone' },
      bottom: null,
      north: { type: 'stone' },
      south: null,
      west: { type: 'stone' },
      east: null
    };

    const mask = system.calculateFaceVisibility(transparentBlock, mixedNeighbors);
    assertEqual(mask, faceMask.ALL, '透明方块的所有面都应该可见，无论相邻方块');
  });

  test('固体相邻透明方块测试', () => {
    system = getFreshSystem();
    const solidBlock = { type: 'stone' };
    const transparentNeighbors = {
      top: { type: 'glass_block' },
      bottom: { type: 'stone' },
      north: { type: 'glass_block' },
      south: { type: 'stone' },
      west: { type: 'glass_block' },
      east: { type: 'stone' }
    };

    const mask = system.calculateFaceVisibility(solidBlock, transparentNeighbors);
    const expected = faceMask.TOP | faceMask.NORTH | faceMask.WEST;
    assertEqual(mask, expected, '与透明方块相邻的面应该可见');
  });

  test('多种透明方块测试', () => {
    system = getFreshSystem();
    system.addTransparentType('water');
    system.addTransparentType('ice');

    const blockWithWater = { type: 'stone' };
    const waterNeighbors = {
      top: { type: 'water' },
      bottom: { type: 'stone' },
      north: { type: 'ice' },
      south: { type: 'stone' },
      west: { type: 'glass_block' },
      east: { type: 'stone' }
    };

    const mask = system.calculateFaceVisibility(blockWithWater, waterNeighbors);
    const expected = faceMask.TOP | faceMask.NORTH | faceMask.WEST;
    assertEqual(mask, expected, '与水、冰、玻璃相邻的面应该可见');
  });

  test('性能测试 - 批量计算', () => {
    system = getFreshSystem();

    const testBlocks = 1000;
    const testData = [];

    // 创建测试数据
    for (let i = 0; i < testBlocks; i++) {
      const blockType = Math.random() > 0.3 ? 'stone' : 'glass_block';
      const neighbors = {};
      const directions = ['top', 'bottom', 'north', 'south', 'west', 'east'];
      for (const dir of directions) {
        if (Math.random() > 0.5) {
          neighbors[dir] = Math.random() > 0.7 ?
            { type: 'glass_block' } : { type: 'stone' };
        } else {
          neighbors[dir] = null;
        }
      }
      testData.push({ block: { type: blockType }, neighbors });
    }

    const startTime = performance.now();
    let correctCount = 0;

    for (const data of testData) {
      try {
        system.calculateFaceVisibility(data.block, data.neighbors);
        correctCount++;
      } catch (error) {
        // 计算错误
      }
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / testBlocks;

    // 平均时间应该小于 0.01ms
    assertTrue(avgTime < 0.01, `平均计算时间应该小于 0.01ms，实际：${avgTime.toFixed(4)}ms`);
  });

  test('系统统计测试', () => {
    system = getFreshSystem();

    const stats = system.getStats();

    assertTrue(stats.enabled === true, '系统应该启用');
    assertEqual(stats.errorCount, 0, '错误计数应该为 0');
    assertEqual(stats.lastError, null, '最后错误应该为 null');
  });

  test('addTransparentType - 添加透明类型', () => {
    system = getFreshSystem();
    system.addTransparentType('diamond_block');

    assertTrue(system.isTransparent('diamond_block'), 'diamond_block 应该被识别为透明');
    assertTrue(system.getTransparentTypes().includes('diamond_block'), 'diamond_block 应该在列表中');
  });

  test('getTransparentTypes - 获取透明类型列表', () => {
    system = getFreshSystem();
    system.addTransparentType('custom_glass');

    const types = system.getTransparentTypes();
    assertTrue(Array.isArray(types), '应该返回数组');
    assertTrue(types.includes('glass_block'), '应该包含 glass_block');
    assertTrue(types.includes('custom_glass'), '应该包含 custom_glass');
  });

});
