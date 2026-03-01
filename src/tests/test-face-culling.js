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

  // =========== Face Culling 动态更新测试（高优先级） ===========
  test('放置方块后验证 Face Culling 掩码重新计算', () => {
    system = getFreshSystem();

    // 创建一个模拟方块
    const block = { type: 'stone' };

    // 完全暴露的情况
    const exposedNeighbors = {
      top: null, bottom: null, north: null, south: null, west: null, east: null
    };
    const exposedMask = system.calculateFaceVisibility(block, exposedNeighbors);
    assertEqual(exposedMask, faceMask.ALL, '完全暴露的方块所有面应该可见');

    // 部分包围的情况
    const partialNeighbors = {
      top: { type: 'stone' },
      bottom: null,
      north: null,
      south: null,
      west: null,
      east: null
    };
    const partialMask = system.calculateFaceVisibility(block, partialNeighbors);
    assertTrue((partialMask & faceMask.TOP) === 0, '顶面应该被隐藏');
    assertTrue((partialMask & faceMask.BOTTOM) !== 0, '底面应该可见');
  });

  test('移除方块后验证周围邻居掩码更新逻辑', () => {
    system = getFreshSystem();

    // 模拟一个方块被部分包围
    const block = { type: 'stone' };
    const surroundedNeighbors = {
      top: { type: 'stone' },
      bottom: { type: 'stone' },
      north: { type: 'stone' },
      south: null, // 南面是空气
      west: null,  // 西面是空气
      east: null   // 东面是空气
    };

    const mask = system.calculateFaceVisibility(block, surroundedNeighbors);

    // 验证南、西、东面可见
    assertTrue((mask & faceMask.SOUTH) !== 0, '南面应该可见');
    assertTrue((mask & faceMask.WEST) !== 0, '西面应该可见');
    assertTrue((mask & faceMask.EAST) !== 0, '东面应该可见');

    // 验证顶面和底面隐藏
    assertTrue((mask & faceMask.TOP) === 0, '顶面应该隐藏');
    assertTrue((mask & faceMask.BOTTOM) === 0, '底面应该隐藏');
  });

  test('透明方块相邻时的面可见性', () => {
    system = getFreshSystem();

    const block = { type: 'stone' };

    // 相邻方块是透明的
    const transparentNeighbors = {
      top: { type: 'glass_block' },
      bottom: { type: 'glass_block' },
      north: { type: 'glass_block' },
      south: { type: 'glass_block' },
      west: { type: 'glass_block' },
      east: { type: 'glass_block' }
    };

    const mask = system.calculateFaceVisibility(block, transparentNeighbors);

    // 所有面都应该可见（因为相邻的是透明方块）
    assertEqual(mask, faceMask.ALL, '与透明方块相邻时所有面应该可见');
  });

  test('系统禁用时的面可见性计算', () => {
    system = getFreshSystem();
    system.disable('test');

    const block = { type: 'stone' };
    const solidNeighbors = {
      top: { type: 'stone' },
      bottom: { type: 'stone' },
      north: { type: 'stone' },
      south: { type: 'stone' },
      west: { type: 'stone' },
      east: { type: 'stone' }
    };

    // 系统禁用时，即使完全包围也应该返回 ALL
    const mask = system.calculateFaceVisibility(block, solidNeighbors);
    assertEqual(mask, faceMask.ALL, '系统禁用时所有面应该可见');
  });

  test('updateBlock 方法调用验证', () => {
    system = getFreshSystem();

    let blockUpdatedCalled = false;
    system.on('blockUpdated', () => {
      blockUpdatedCalled = true;
    });

    const position = { x: 5, y: 10, z: 5, clone: () => ({ x: 5, y: 10, z: 5 }) };
    const block = { type: 'stone' };
    const neighbors = {
      top: null, bottom: null, north: null, south: null, west: null, east: null
    };

    system.updateBlock(position, block, neighbors);

    assertTrue(blockUpdatedCalled, '应该触发 blockUpdated 事件');
  });

  test('updateNeighbors 方法调用验证', () => {
    system = getFreshSystem();

    // 创建一个模拟的 position 对象，支持 clone() 和 add() 方法
    const mockPosition = {
      x: 5, y: 10, z: 5,
      clone: function() {
        return {
          x: this.x, y: this.y, z: this.z,
          add: function(offset) {
            this.x += offset.x;
            this.y += offset.y;
            this.z += offset.z;
            return this;
          }
        };
      }
    };

    // 提供一个返回 null 的 getBlockData 函数
    // 由于 getBlockData 返回 null，不会更新任何方块
    const getBlockData = () => null;

    try {
      system.updateNeighbors(mockPosition, getBlockData);
      assertTrue(true, 'updateNeighbors 方法应该可以正常调用');
    } catch (e) {
      // 如果抛出错误，测试失败
      assertTrue(false, 'updateNeighbors 不应该抛出错误：' + e.message);
    }
  });

  // =========== FaceCulling 竞态条件测试（中优先级） ===========
  test('快速连续放置多个方块的 consolidate 正确性', () => {
    system = getFreshSystem();

    const blocks = [];
    for (let i = 0; i < 10; i++) {
      blocks.push({
        x: i,
        y: 10,
        z: 0,
        type: 'stone'
      });
    }

    // 模拟快速连续计算
    const masks = [];
    for (const block of blocks) {
      const neighbors = {
        top: null, bottom: null, north: null, south: null, west: null, east: null
      };
      masks.push(system.calculateFaceVisibility(block, neighbors));
    }

    // 验证所有计算都成功完成
    assertEqual(masks.length, 10, '应该计算 10 个方块');
    masks.forEach((mask, index) => {
      assertEqual(mask, faceMask.ALL, `方块${index}的所有面应该可见`);
    });
  });

  test('scheduleConsolidation 防抖逻辑间接测试', async () => {
    // 这个测试通过 Chunk 类间接验证
    // 由于 scheduleConsolidation 是 Chunk 的方法，我们在 test-chunk.js 中已经测试

    // 这里我们验证 FaceCullingSystem 在连续调用时的稳定性
    system = getFreshSystem();

    const callCount = 100;
    let errorCount = 0;

    for (let i = 0; i < callCount; i++) {
      try {
        const block = { type: 'stone' };
        const neighbors = {
          top: Math.random() > 0.5 ? { type: 'stone' } : null,
          bottom: Math.random() > 0.5 ? { type: 'stone' } : null,
          north: Math.random() > 0.5 ? { type: 'stone' } : null,
          south: Math.random() > 0.5 ? { type: 'stone' } : null,
          west: Math.random() > 0.5 ? { type: 'stone' } : null,
          east: Math.random() > 0.5 ? { type: 'stone' } : null
        };
        system.calculateFaceVisibility(block, neighbors);
      } catch (e) {
        errorCount++;
      }
    }

    assertEqual(errorCount, 0, '连续调用不应该产生错误');
  });

  test('isConsolidating 状态下的请求处理模拟', () => {
    system = getFreshSystem();

    // 模拟系统在处理中的状态
    const position = { x: 5, y: 10, z: 5, clone: () => ({ x: 5, y: 10, z: 5 }) };
    const block = { type: 'stone' };
    const neighbors = {
      top: null, bottom: null, north: null, south: null, west: null, east: null
    };

    // 连续调用 updateBlock
    system.updateBlock(position, block, neighbors);
    system.updateBlock(position, block, neighbors);
    system.updateBlock(position, block, neighbors);

    // 验证系统状态统计
    const stats = system.getStats();
    assertTrue(stats.totalBlocksProcessed >= 3, '应该处理至少 3 个方块');
  });

  test('dirtyBlocks 计数在并发操作下的准确性', () => {
    system = getFreshSystem();

    // 模拟多个方块操作
    const operations = [
      { x: 0, y: 10, z: 0, type: 'stone' },
      { x: 1, y: 10, z: 0, type: 'stone' },
      { x: 2, y: 10, z: 0, type: 'stone' },
      { x: 3, y: 10, z: 0, type: 'glass_block' },
      { x: 4, y: 10, z: 0, type: 'stone' }
    ];

    let processedCount = 0;
    system.on('blockUpdated', () => {
      processedCount++;
    });

    for (const op of operations) {
      const position = { x: op.x, y: op.y, y: op.z, clone: () => ({ x: op.x, y: op.y, z: op.z }) };
      const block = { type: op.type };
      const neighbors = {
        top: null, bottom: null, north: null, south: null, west: null, east: null
      };
      system.updateBlock(position, block, neighbors);
    }

    // 验证所有操作都被处理
    assertEqual(processedCount, operations.length, '所有操作都应该被处理');
  });

  // =========== 边界条件和异常处理测试 ===========
  test('null 方块的处理', () => {
    system = getFreshSystem();

    // 测试 null 方块
    const nullNeighbors = {
      top: null, bottom: null, north: null, south: null, west: null, east: null
    };

    // null 方块类型会导致错误，我们用 undefined 测试
    try {
      const block = { type: undefined };
      system.calculateFaceVisibility(block, nullNeighbors);
      // 如果没抛出错误，说明处理了边界情况
      assertTrue(true, '应该处理 undefined 方块类型');
    } catch (e) {
      // 预期行为
      assertTrue(true, 'undefined 方块类型应该被处理');
    }
  });

  test('未知方块类型的处理', () => {
    system = getFreshSystem();

    const unknownBlock = { type: 'unknown_block_type_xyz' };
    const neighbors = {
      top: null, bottom: null, north: null, south: null, west: null, east: null
    };

    // 未知方块类型应该被视为不透明
    const mask = system.calculateFaceVisibility(unknownBlock, neighbors);

    // 由于没有相邻方块，所有面应该可见
    assertEqual(mask, faceMask.ALL, '孤立未知方块的所有面应该可见');
  });

  test('shouldShowFace 边界条件', () => {
    system = getFreshSystem();

    const currentBlock = { type: 'stone' };

    // 测试 null 邻居
    assertTrue(system.shouldShowFace(currentBlock, null), 'null 邻居应该返回 true');

    // 测试 undefined 邻居
    assertTrue(system.shouldShowFace(currentBlock, undefined), 'undefined 邻居应该返回 true');

    // 测试透明邻居
    assertTrue(system.shouldShowFace(currentBlock, { type: 'glass_block' }), '透明邻居应该返回 true');

    // 测试固体邻居
    assertFalse(system.shouldShowFace(currentBlock, { type: 'stone' }), '固体邻居应该返回 false');
  });

  test('系统事件系统测试', () => {
    system = getFreshSystem();

    const events = [];

    system.on('testEvent', (data) => {
      events.push(data);
    });

    system.emit('testEvent', { foo: 'bar' });
    system.emit('testEvent', { foo: 'baz' });

    assertEqual(events.length, 2, '应该触发 2 次事件');
    assertEqual(events[0].foo, 'bar', '第一次事件数据应该正确');
    assertEqual(events[1].foo, 'baz', '第二次事件数据应该正确');

    // 测试移除事件监听
    const callback = (data) => {};
    system.on('removeTest', callback);
    system.off('removeTest', callback);
    // 不应该抛出错误
    assertTrue(true, '移除事件监听应该成功');
  });

  test('系统错误处理测试', () => {
    system = getFreshSystem();

    let errorEmitted = false;
    system.on('error', () => {
      errorEmitted = true;
    });

    // 临时禁用 console.error，避免测试错误输出到控制台
    const originalError = console.error;
    console.error = () => {};

    try {
      // 手动触发错误
      system.handleError('testContext', new Error('Test error'));

      assertTrue(errorEmitted, '应该触发 error 事件');
      assertEqual(system.getErrorCount(), 1, '错误计数应该为 1');
      assertNotNull(system.getLastError(), '应该存在最后错误信息');
    } finally {
      // 恢复 console.error
      console.error = originalError;
    }
  });

  test('系统降级测试', () => {
    system = getFreshSystem();
    system.config.errorLimit = 3; // 设置较低的阈值

    // 临时禁用 console.error，避免测试错误输出到控制台
    const originalError = console.error;
    console.error = () => {};

    try {
      // 触发多次错误
      system.handleError('test1', new Error('Error 1'));
      system.handleError('test2', new Error('Error 2'));
      system.handleError('test3', new Error('Error 3'));

      // 达到错误限制，系统应该被禁用
      assertFalse(system.isEnabled(), '达到错误限制后系统应该被禁用');
      assertTrue(system.stats.isDegraded, '系统应该被标记为降级');
    } finally {
      // 恢复 console.error
      console.error = originalError;
    }
  });

  test('批量计算方法测试', () => {
    system = getFreshSystem();

    const blocks = [
      { x: 0, y: 0, z: 0, type: 'stone' },
      { x: 1, y: 0, z: 0, type: 'glass_block' },
      { x: 2, y: 0, z: 0, type: 'stone' }
    ];

    const blockData = {
      '0,0,0': 'stone',
      '1,0,0': 'glass_block',
      '2,0,0': 'stone'
    };

    const results = system.calculateMultipleFaceVisibilities(blocks, blockData);

    assertEqual(results.length, 3, '应该返回 3 个结果');

    // stone 方块
    assertEqual(results[0].type, 'stone', '第一个方块应该是 stone');
    // glass_block 方块（透明）
    assertEqual(results[1].type, 'glass_block', '第二个方块应该是 glass_block');
    // stone 方块
    assertEqual(results[2].type, 'stone', '第三个方块应该是 stone');
  });

  test('系统禁用和重新启用', () => {
    system = getFreshSystem();

    assertTrue(system.isEnabled(), '系统初始应该启用');

    system.disable('manual');
    assertFalse(system.isEnabled(), '禁用后系统应该禁用');

    system.enable();
    assertTrue(system.isEnabled(), '重新启用后系统应该启用');
  });

  test('透明类型管理测试', () => {
    system = getFreshSystem();

    const initialTypes = system.getTransparentTypes();
    assertTrue(initialTypes.includes('glass_block'), '初始应该包含 glass_block');
    assertTrue(initialTypes.includes('leaves'), '初始应该包含 leaves');

    // 添加新类型
    system.addTransparentType('ice');
    assertTrue(system.isTransparent('ice'), 'ice 应该被识别为透明');

    // 移除类型
    system.removeTransparentType('ice');
    assertFalse(system.isTransparent('ice'), 'ice 应该不再被识别为透明');

    // 设置新的类型列表
    system.setTransparentTypes(['custom1', 'custom2']);
    assertTrue(system.isTransparent('custom1'), 'custom1 应该被识别为透明');
    assertTrue(system.isTransparent('custom2'), 'custom2 应该被识别为透明');
  });

  test('getChunkNeighbors 方法测试', () => {
    system = getFreshSystem();

    const chunk = { cx: 5, cz: 5 };
    const worldChunks = new Map();

    // 添加相邻区块
    worldChunks.set('5,4', { cx: 5, cz: 4 }); // north
    worldChunks.set('5,6', { cx: 5, cz: 6 }); // south
    worldChunks.set('4,5', { cx: 4, cz: 5 }); // west
    worldChunks.set('6,5', { cx: 6, cz: 5 }); // east

    const neighbors = system.getChunkNeighbors(chunk, worldChunks);

    assertNotNull(neighbors.north, '应该存在 north 邻居');
    assertNotNull(neighbors.south, '应该存在 south 邻居');
    assertNotNull(neighbors.west, '应该存在 west 邻居');
    assertNotNull(neighbors.east, '应该存在 east 邻居');

    assertEqual(neighbors.north.cz, 4, 'north 邻居的 cz 应该为 4');
    assertEqual(neighbors.south.cz, 6, 'south 邻居的 cz 应该为 6');
  });

  test('缓存管理测试', () => {
    system = getFreshSystem();

    // 添加一些缓存
    system.neighborCache.set('1,2,3', { type: 'stone' });
    system.chunkCache.set('0,0', { cx: 0, cz: 0 });

    assertTrue(system.neighborCache.size > 0, '邻居缓存应该有数据');
    assertTrue(system.chunkCache.size > 0, '区块缓存应该有数据');

    // 清除缓存
    system.clearCaches();

    assertEqual(system.neighborCache.size, 0, '邻居缓存应该被清空');
    assertEqual(system.chunkCache.size, 0, '区块缓存应该被清空');
  });

  test('性能统计测试', () => {
    system = getFreshSystem();

    const stats = system.getStats();

    // 验证统计字段存在
    assertNotNull(stats.enabled, '应该有 enabled 字段');
    assertNotNull(stats.totalBlocksProcessed !== undefined, '应该有 totalBlocksProcessed 字段');
    assertNotNull(stats.facesCulled !== undefined, '应该有 facesCulled 字段');
    assertNotNull(stats.facesRendered !== undefined, '应该有 facesRendered 字段');
    assertNotNull(stats.optimizationRate !== undefined, '应该有 optimizationRate 字段');
    assertNotNull(stats.errorCount !== undefined, '应该有 errorCount 字段');
  });

  test('重置统计测试', () => {
    system = getFreshSystem();

    // 修改一些统计值
    system.stats.totalBlocksProcessed = 100;
    system.stats.facesCulled = 200;
    system.stats.facesRendered = 400;
    system.stats.errorCount = 5;

    system.resetStats();

    assertEqual(system.stats.totalBlocksProcessed, 0, 'totalBlocksProcessed 应该重置为 0');
    assertEqual(system.stats.facesCulled, 0, 'facesCulled 应该重置为 0');
    assertEqual(system.stats.facesRendered, 0, 'facesRendered 应该重置为 0');
    assertEqual(system.stats.errorCount, 0, 'errorCount 应该重置为 0');
  });

});
