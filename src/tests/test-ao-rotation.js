// src/tests/test-ao-rotation.js
/**
 * AO 朝向重映射测试
 * 验证旋转方块时 AO 顶点索引映射是否正确
 */

import { describe, test } from './runner.js';
import { assertEqual, assertDeepEqual } from './assert.js';
import {
  AO_VERTEX_REMAP_TABLE,
  normalizeOrientation,
  remapAOVertexId
} from '../utils/AORotationUtils.js';

describe('AO 朝向重映射测试', (test) => {
  test('normalizeOrientation 应归一化到 0-3', () => {
    assertEqual(normalizeOrientation(0), 0, '0 -> 0');
    assertEqual(normalizeOrientation(1), 1, '1 -> 1');
    assertEqual(normalizeOrientation(2), 2, '2 -> 2');
    assertEqual(normalizeOrientation(3), 3, '3 -> 3');
    assertEqual(normalizeOrientation(4), 0, '4 -> 0');
    assertEqual(normalizeOrientation(-1), 3, '-1 -> 3');
    assertEqual(normalizeOrientation(7), 3, '7 -> 3');
    assertEqual(normalizeOrientation(null), 0, 'null -> 0');
  });

  test('orientation=0 时映射应保持不变', () => {
    const row = [];
    for (let i = 0; i < 24; i++) row.push(remapAOVertexId(i, 0));
    assertDeepEqual(row, AO_VERTEX_REMAP_TABLE[0], 'orientation=0 应为恒等映射');
  });

  test('orientation=1 时映射应符合预期', () => {
    const row = [];
    for (let i = 0; i < 24; i++) row.push(remapAOVertexId(i, 1));
    assertDeepEqual(row, AO_VERTEX_REMAP_TABLE[1], 'orientation=1 映射错误');
  });

  test('orientation=2 时映射应符合预期', () => {
    const row = [];
    for (let i = 0; i < 24; i++) row.push(remapAOVertexId(i, 2));
    assertDeepEqual(row, AO_VERTEX_REMAP_TABLE[2], 'orientation=2 映射错误');
  });

  test('orientation=3 时映射应符合预期', () => {
    const row = [];
    for (let i = 0; i < 24; i++) row.push(remapAOVertexId(i, 3));
    assertDeepEqual(row, AO_VERTEX_REMAP_TABLE[3], 'orientation=3 映射错误');
  });
});

