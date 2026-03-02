// src/tests/test-ao.js
/**
 * AO（环境光遮蔽）计算测试套件
 * 测试 AO 工具函数和系统的正确性
 *
 * 测试范围：
 * - AO 值计算公式（getAOValue）
 * - AO 数据打包/解包（packAOData/unpackAOData）
 * - AO 适用性判断（isAOApplicable）
 * - AO 邻居查询（getAONeighbors）
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertNotNull, assertClose } from './assert.js';
import {
  getAOValue,
  packAOData,
  unpackAOValue,
  unpackAllAO,
  isAOApplicable,
  getAONeighbors,
  validateAOValue,
  validatePackedAO
} from '../utils/AOUtils.js';

describe('AO 计算', () => {
  // ==================== getAOValue 测试 ====================
  describe('getAOValue', () => {
    test('当所有邻居都是空气时返回最大值 3', () => {
      const result = getAOValue(false, false, false);
      assertEqual(result, 3, 'AO 值应为 3（最亮）');
    });

    test('当两个侧边都遮挡时返回 0', () => {
      const result = getAOValue(true, true, false);
      assertEqual(result, 0, 'AO 值应为 0（最暗）');
    });

    test('当一个侧边遮挡时返回 2', () => {
      const result1 = getAOValue(true, false, false);
      const result2 = getAOValue(false, true, false);
      assertEqual(result1, 2, 'AO 值应为 2');
      assertEqual(result2, 2, 'AO 值应为 2');
    });

    test('当侧边和角落都遮挡时返回最小值', () => {
      const result = getAOValue(true, true, true);
      assertEqual(result, 0, 'AO 值应为 0');
    });

    test('Minecraft 优化逻辑：当侧边都是空气时忽略角落', () => {
      // 侧边都是空气，角落是否遮挡不影响结果
      const result1 = getAOValue(false, false, false);
      const result2 = getAOValue(false, false, true);
      assertEqual(result1, 3, '侧边都是空气时，角落不影响结果');
      assertEqual(result2, 3, '侧边都是空气时，角落不影响结果');
    });

    test('Minecraft 优化逻辑：当只有一个侧边遮挡时考虑角落', () => {
      const result1 = getAOValue(true, false, false);
      const result2 = getAOValue(true, false, true);
      assertEqual(result1, 2, '一个侧边遮挡，角落不遮挡');
      assertEqual(result2, 1, '一个侧边遮挡，角落也遮挡');
    });
  });

  // ==================== packAOData/unpackAOValue 测试 ====================
  describe('packAOData / unpackAOValue', () => {
    test('打包和解包应保持数据一致（往返测试）', () => {
      // 创建 24 个测试 AO 值
      const aos = new Uint8Array([
        0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3,
        0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3
      ]);

      const { aoLow, aoHigh } = packAOData(aos);

      // 验证每个顶点的 AO 值都能正确恢复
      for (let i = 0; i < 24; i++) {
        const unpacked = unpackAOValue(aoLow, aoHigh, i);
        assertEqual(unpacked, aos[i], `顶点 ${i} 的 AO 值应为 ${aos[i]}`);
      }
    });

    test('打包全 0 的 AO 数据', () => {
      const aos = new Uint8Array(24).fill(0);
      const { aoLow, aoHigh } = packAOData(aos);
      assertEqual(aoLow, 0, 'aoLow 应为 0');
      assertEqual(aoHigh, 0, 'aoHigh 应为 0');
    });

    test('打包全 3 的 AO 数据', () => {
      const aos = new Uint8Array(24).fill(3);
      const { aoLow, aoHigh } = packAOData(aos);

      // 验证解包后都是 3
      for (let i = 0; i < 24; i++) {
        const unpacked = unpackAOValue(aoLow, aoHigh, i);
        assertEqual(unpacked, 3, `顶点 ${i} 的 AO 值应为 3`);
      }
    });

    test('unpackAllAO 应返回完整的 24 个 AO 值数组', () => {
      const aos = new Uint8Array([
        3, 2, 1, 0, 3, 2, 1, 0, 3, 2, 1, 0,
        3, 2, 1, 0, 3, 2, 1, 0, 3, 2, 1, 0
      ]);
      const { aoLow, aoHigh } = packAOData(aos);
      const result = unpackAllAO(aoLow, aoHigh);

      assertEqual(result.length, 24, '应返回 24 个值');
      for (let i = 0; i < 24; i++) {
        assertEqual(result[i], aos[i], `顶点 ${i} 的 AO 值应匹配`);
      }
    });
  });

  // ==================== validateAOValue 测试 ====================
  describe('validateAOValue', () => {
    test('合法的 AO 值 (0-3) 应通过验证', () => {
      assertTrue(validateAOValue(0), '0 应为合法 AO 值');
      assertTrue(validateAOValue(1), '1 应为合法 AO 值');
      assertTrue(validateAOValue(2), '2 应为合法 AO 值');
      assertTrue(validateAOValue(3), '3 应为合法 AO 值');
    });

    test('非法的 AO 值应不通过验证', () => {
      assertFalse(validateAOValue(-1), '-1 应为非法 AO 值');
      assertFalse(validateAOValue(4), '4 应为非法 AO 值');
      assertFalse(validateAOValue(0.5), '0.5 应为非法 AO 值');
      assertFalse(validateAOValue('1'), '字符串应为非法 AO 值');
    });
  });

  // ==================== validatePackedAO 测试 ====================
  describe('validatePackedAO', () => {
    test('合法的打包 AO 数据应通过验证', () => {
      const aos = new Uint8Array([
        0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3,
        0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3
      ]);
      const { aoLow, aoHigh } = packAOData(aos);
      assertTrue(validatePackedAO(aoLow, aoHigh), '合法的打包数据应通过验证');
    });

    test('空数据应通过验证', () => {
      assertTrue(validatePackedAO(0, 0), '全 0 数据应通过验证');
    });
  });

  // ==================== isAOApplicable 测试 ====================
  describe('isAOApplicable', () => {
    test('实心且不透明的方块应适用 AO', () => {
      assertTrue(isAOApplicable('stone'), 'stone 应适用 AO');
      assertTrue(isAOApplicable('dirt'), 'dirt 应适用 AO');
      assertTrue(isAOApplicable('cobblestone'), 'cobblestone 应适用 AO');
    });

    test('透明方块不应适用 AO', () => {
      assertFalse(isAOApplicable('glass_block'), 'glass_block 不应适用 AO');
      assertFalse(isAOApplicable('water'), 'water 不应适用 AO');
    });

    test('非实心方块不应适用 AO', () => {
      // 注意：这取决于具体方块的配置
      // 例如 flower 等非实心方块不应适用 AO
    });

    test('null/undefined 应返回 false', () => {
      assertFalse(isAOApplicable(null), 'null 不应适用 AO');
      assertFalse(isAOApplicable(undefined), 'undefined 不应适用 AO');
      assertFalse(isAOApplicable(''), '空字符串不应适用 AO');
    });
  });

  // ==================== getAONeighbors 测试 ====================
  describe('getAONeighbors', () => {
    test('应正确返回 6 个面的邻居坐标', () => {
      // Face 0 (+X) 的第一个角落
      const neighbors = getAONeighbors(10, 64, 10, 0, 0);

      assertNotNull(neighbors.side1, 'side1 应存在');
      assertNotNull(neighbors.side2, 'side2 应存在');
      assertNotNull(neighbors.corner, 'corner 应存在');

      // +X 面的 V0 角落：side1=Top(+Y), side2=+Z, corner=Top+Z
      assertEqual(neighbors.side1.y, 65, 'side1 应为 +Y 方向');
      assertEqual(neighbors.side2.z, 11, 'side2 应为 +Z 方向');
      assertEqual(neighbors.corner.y, 65, 'corner 应为 +Y 方向');
      assertEqual(neighbors.corner.z, 11, 'corner 应为 +Z 方向');
    });

    test('所有 6 个面×4 个角落都应返回有效的邻居坐标', () => {
      for (let face = 0; face < 6; face++) {
        for (let corner = 0; corner < 4; corner++) {
          const neighbors = getAONeighbors(0, 0, 0, face, corner);

          assertNotNull(neighbors.side1, `Face ${face}, Corner ${corner}: side1 应存在`);
          assertNotNull(neighbors.side2, `Face ${face}, Corner ${corner}: side2 应存在`);
          assertNotNull(neighbors.corner, `Face ${face}, Corner ${corner}: corner 应存在`);

          // 验证偏移量在合理范围内（-1 到 1）
          const allCoords = [
            neighbors.side1.x, neighbors.side1.y, neighbors.side1.z,
            neighbors.side2.x, neighbors.side2.y, neighbors.side2.z,
            neighbors.corner.x, neighbors.corner.y, neighbors.corner.z
          ];

          for (const coord of allCoords) {
            assertTrue(coord >= -1 && coord <= 1,
              `Face ${face}, Corner ${corner}: 坐标偏移量应在 -1 到 1 之间，实际为 ${coord}`);
          }
        }
      }
    });
  });

  // ==================== 性能测试（可选） ====================
  describe('AO 性能（基准测试）', () => {
    test('打包/解包 10000 次应在合理时间内完成', () => {
      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        const aos = new Uint8Array(24).fill(i % 4);
        const { aoLow, aoHigh } = packAOData(aos);
        for (let j = 0; j < 24; j++) {
          unpackAOValue(aoLow, aoHigh, j);
        }
      }
      const duration = performance.now() - start;

      // 10000 次操作应在 100ms 内完成
      if (duration > 100) {
        console.warn(`AO 打包/解包性能警告：${duration.toFixed(2)}ms for 10000 iterations`);
      }
    });
  });
});
