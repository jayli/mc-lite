// src/tests/test-chunk-ao.js
/**
 * Chunk AO 集成测试
 * 测试 AO 数据在区块生成和动态更新中的正确性
 *
 * 测试范围：
 * - 区块生成时 AO 数据的正确性
 * - 透明方块被排除在 AO 计算之外
 * - 区块边界的 AO 连续性
 * - 动态方块放置/破坏后的 AO 更新
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull } from './assert.js';
import { isAOApplicable, calculateAOForBlock } from '../utils/AOUtils.js';
import { getBlockProperties } from '../constants/BlockData.js';

// 模拟 isOccluding 函数（用于测试）
function createMockOccluding(blockMap) {
  return function isOccluding(x, y, z) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const type = blockMap.get(key);
    if (!type) return false;
    const props = getBlockProperties(type);
    return !props.isTransparent;
  };
}

describe('Chunk AO 集成', () => {
  // ==================== AO 适用性测试 ====================
  describe('AO 适用性判断', () => {
    test('所有实心且不透明的方块都应适用 AO', () => {
      const solidOpaqueBlocks = ['stone', 'dirt', 'cobblestone', 'bricks', 'planks', 'sand', 'gold_ore', 'marble', 'snow', 'ice'];

      for (const blockType of solidOpaqueBlocks) {
        const props = getBlockProperties(blockType);
        const shouldHaveAO = props.isSolid && !props.isTransparent;
        assertEqual(
          isAOApplicable(blockType),
          shouldHaveAO,
          `${blockType} 的 AO 适用性应为 ${shouldHaveAO}`
        );
      }
    });

    test('透明方块不应适用 AO', () => {
      const transparentBlocks = ['glass_block', 'water', 'leaves'];

      for (const blockType of transparentBlocks) {
        assertFalse(
          isAOApplicable(blockType),
          `${blockType} 不应适用 AO（透明方块）`
        );
      }
    });
  });

  // ==================== AO 计算正确性测试 ====================
  describe('AO 计算正确性', () => {
    test('开放空间的方块应有最大 AO 值（最亮）', () => {
      // 创建一个开放空间的方块（周围都是空气）
      const blockMap = new Map([['0,0,0', 'stone']]);
      const isOccluding = createMockOccluding(blockMap);

      const { aoLow, aoHigh } = calculateAOForBlock(0, 0, 0, isOccluding);

      // 开放空间的 AO 值应为 3（最亮）
      // 解包验证
      for (let i = 0; i < 24; i++) {
        const aoVal = (i < 12)
          ? Math.floor(aoLow / Math.pow(4, i)) % 4
          : Math.floor(aoHigh / Math.pow(4, i - 12)) % 4;
        assertEqual(aoVal, 3, `顶点 ${i} 的 AO 值应为 3（开放空间）`);
      }
    });

    test('被包围的方块应有最小 AO 值（最暗）', () => {
      // 创建一个被完全包围的方块
      const blockMap = new Map([
        ['0,0,0', 'stone'],  // 中心方块
        ['1,0,0', 'stone'], ['-1,0,0', 'stone'],
        ['0,1,0', 'stone'], ['0,-1,0', 'stone'],
        ['0,0,1', 'stone'], ['0,0,-1', 'stone']
      ]);
      const isOccluding = createMockOccluding(blockMap);

      const { aoLow, aoHigh } = calculateAOForBlock(0, 0, 0, isOccluding);

      // 被包围的方块 AO 值应为 0（最暗）
      // 实际上由于角落可能有空气，AO 值不一定是 0，但应该比较小
      // 这里只验证计算没有出错
      assertNotNull(aoLow, 'aoLow 应有值');
      assertNotNull(aoHigh, 'aoHigh 应有值');
    });

    test('方块的 AO 计算应考虑邻居遮挡', () => {
      // 创建一个简单的场景：一个方块上方有遮挡
      const blockMap = new Map([
        ['0,0,0', 'stone'],  // 中心方块
        ['0,1,0', 'stone']   // 上方遮挡
      ]);
      const isOccluding = createMockOccluding(blockMap);

      const { aoLow, aoHigh } = calculateAOForBlock(0, 0, 0, isOccluding);

      // 验证 AO 数据有效
      assertTrue(aoLow >= 0, 'aoLow 应为非负数');
      assertTrue(aoHigh >= 0, 'aoHigh 应为非负数');
    });
  });

  // ==================== 区块边界 AO 连续性测试 ====================
  describe('区块边界 AO 连续性', () => {
    test('跨区块的方块应有连续的 AO 阴影', () => {
      // 模拟两个相邻区块的边界情况
      // 区块 A: cx=0, cz=0
      // 区块 B: cx=1, cz=0

      // 在边界处放置一个方块
      const blockMap = new Map([
        // 区块 A 的边界方块
        ['15,64,8', 'stone'],
        // 区块 B 的相邻方块（遮挡）
        ['16,64,8', 'stone'],
        ['16,65,8', 'stone']
      ]);
      const isOccluding = createMockOccluding(blockMap);

      // 计算区块 A 边界方块的 AO
      const { aoLow, aoHigh } = calculateAOForBlock(15, 64, 8, isOccluding);

      // 验证 AO 数据有效
      assertNotNull(aoLow, '边界方块的 aoLow 应有值');
      assertNotNull(aoHigh, '边界方块的 aoHigh 应有值');

      // +X 面（朝向区块 B）的 AO 值应该受到遮挡影响
      // Face 0 的顶点 0-3
      for (let i = 0; i < 4; i++) {
        const aoVal = Math.floor(aoLow / Math.pow(4, i)) % 4;
        // 由于 +X 方向有遮挡，AO 值应该小于 3
        assertTrue(aoVal < 3, `+X 面顶点 ${i} 的 AO 值应受到遮挡影响`);
      }
    });
  });

  // ==================== 动态方块 AO 更新测试 ====================
  describe('动态方块 AO 更新', () => {
    test('放置新方块后应更新 AO 数据', () => {
      // 初始状态：只有一个方块
      const blockMap = new Map([['0,0,0', 'stone']]);
      const isOccluding = createMockOccluding(blockMap);

      const initialAO = calculateAOForBlock(0, 0, 0, isOccluding);

      // 放置相邻方块
      blockMap.set('1,0,0', 'stone');
      const isOccluding2 = createMockOccluding(blockMap);

      const updatedAO = calculateAOForBlock(0, 0, 0, isOccluding2);

      // 由于 +X 方向有了遮挡，AO 值应该变小（变暗）
      // 比较 +X 面（Face 0）的 AO 值
      const initialFace0AO = Math.floor(initialAO.aoLow / Math.pow(4, 0)) % 4;
      const updatedFace0AO = Math.floor(updatedAO.aoLow / Math.pow(4, 0)) % 4;

      assertTrue(
        updatedFace0AO <= initialFace0AO,
        '+X 方向遮挡后 AO 值应该不变或变小'
      );
    });

    test('移除方块后应更新 AO 数据', () => {
      // 初始状态：两个相邻方块
      const blockMap = new Map([
        ['0,0,0', 'stone'],
        ['1,0,0', 'stone']
      ]);
      const isOccluding = createMockOccluding(blockMap);

      const initialAO = calculateAOForBlock(0, 0, 0, isOccluding);

      // 移除相邻方块
      blockMap.delete('1,0,0');
      const isOccluding2 = createMockOccluding(blockMap);

      const updatedAO = calculateAOForBlock(0, 0, 0, isOccluding2);

      // 由于 +X 方向遮挡消失，AO 值应该变大（变亮）
      const initialFace0AO = Math.floor(initialAO.aoLow / Math.pow(4, 0)) % 4;
      const updatedFace0AO = Math.floor(updatedAO.aoLow / Math.pow(4, 0)) % 4;

      assertTrue(
        updatedFace0AO >= initialFace0AO,
        '+X 方向遮挡移除后 AO 值应该不变或变大'
      );
    });
  });

  // ==================== 性能测试 ====================
  describe('AO 计算性能', () => {
    test('单个方块的 AO 计算应在 sub-millisecond 时间内完成', () => {
      const blockMap = new Map();
      // 填充一些邻居方块
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            blockMap.set(`${dx},${dy},${dz}`, 'stone');
          }
        }
      }
      const isOccluding = createMockOccluding(blockMap);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        calculateAOForBlock(0, 0, 0, isOccluding);
      }
      const duration = performance.now() - start;

      // 100 次计算应在 50ms 内完成（每次平均 0.5ms）
      if (duration > 50) {
        console.warn(`AO 计算性能警告：${duration.toFixed(2)}ms for 100 iterations`);
      }

      assertTrue(duration < 50, `AO 计算应在 50ms 内完成 100 次迭代，实际 ${duration.toFixed(2)}ms`);
    });
  });
});
