// src/tests/test-orientation.js
/**
 * OrientationUtils 测试套件
 * 测试方块朝向相关的工具函数
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse, assertDeepEqual } from './assert.js';
import {
  BlockOrientation,
  getRotationAngle,
  nextOrientation,
  parseBlockEntry,
  serializeBlockEntry,
  isValidOrientation
} from '../utils/OrientationUtils.js';

describe('OrientationUtils 测试', (test) => {

  // =========== BlockOrientation 枚举测试 ===========
  test('BlockOrientation 枚举值正确', () => {
    assertEqual(BlockOrientation.EAST, 0, 'EAST 应该为 0');
    assertEqual(BlockOrientation.SOUTH, 1, 'SOUTH 应该为 1');
    assertEqual(BlockOrientation.WEST, 2, 'WEST 应该为 2');
    assertEqual(BlockOrientation.NORTH, 3, 'NORTH 应该为 3');
  });

  // =========== getRotationAngle 测试 ===========
  test('getRotationAngle - 四个基本朝向', () => {
    assertEqual(getRotationAngle(0), 0, '朝东应该为 0 弧度');
    assertEqual(getRotationAngle(1), Math.PI / 2, '朝南应该为π/2 弧度');
    assertEqual(getRotationAngle(2), Math.PI, '朝西应该为π弧度');
    assertEqual(getRotationAngle(3), (3 * Math.PI) / 2, '朝北应该为 3π/2 弧度');
  });

  test('getRotationAngle - null/undefined 输入返回 0', () => {
    assertEqual(getRotationAngle(null), 0, 'null 输入应该返回 0');
    assertEqual(getRotationAngle(undefined), 0, 'undefined 输入应该返回 0');
  });

  // =========== nextOrientation 测试 ===========
  test('nextOrientation - 顺时针旋转', () => {
    assertEqual(nextOrientation(0), 1, 'EAST -> SOUTH');
    assertEqual(nextOrientation(1), 2, 'SOUTH -> WEST');
    assertEqual(nextOrientation(2), 3, 'WEST -> NORTH');
    assertEqual(nextOrientation(3), 0, 'NORTH -> EAST (循环)');
  });

  test('nextOrientation - null/undefined 输入返回 1', () => {
    assertEqual(nextOrientation(null), 1, 'null 输入应该返回 1 (SOUTH)');
    assertEqual(nextOrientation(undefined), 1, 'undefined 输入应该返回 1');
  });

  // =========== isValidOrientation 测试 ===========
  test('isValidOrientation - 有效值', () => {
    assertTrue(isValidOrientation(0), '0 是有效朝向');
    assertTrue(isValidOrientation(1), '1 是有效朝向');
    assertTrue(isValidOrientation(2), '2 是有效朝向');
    assertTrue(isValidOrientation(3), '3 是有效朝向');
  });

  test('isValidOrientation - 无效值', () => {
    assertFalse(isValidOrientation(-1), '-1 不是有效朝向');
    assertFalse(isValidOrientation(4), '4 不是有效朝向');
    assertFalse(isValidOrientation(1.5), '小数不是有效朝向');
    assertFalse(isValidOrientation('0'), '字符串不是有效朝向');
    assertFalse(isValidOrientation(null), 'null 不是有效朝向');
  });

  // =========== serializeBlockEntry 测试 ===========
  test('serializeBlockEntry - 基本序列化', () => {
    const result = serializeBlockEntry('handrailA', 1);
    assertDeepEqual(result, { type: 'handrailA', orientation: 1 });
  });

  test('serializeBlockEntry - 默认朝向', () => {
    const result = serializeBlockEntry('handrailA');
    assertDeepEqual(result, { type: 'handrailA', orientation: 0 });
  });

  test('serializeBlockEntry - 无效朝向自动修正为 0', () => {
    const result1 = serializeBlockEntry('handrailA', 5);
    assertDeepEqual(result1, { type: 'handrailA', orientation: 0 });

    const result2 = serializeBlockEntry('handrailA', -1);
    assertDeepEqual(result2, { type: 'handrailA', orientation: 0 });
  });

  // =========== parseBlockEntry 测试 ===========
  test('parseBlockEntry - 旧格式字符串解析', () => {
    const result = parseBlockEntry('handrailA');
    assertDeepEqual(result, { type: 'handrailA', orientation: 0 });
  });

  test('parseBlockEntry - 新格式对象解析', () => {
    const input = { type: 'handrailA', orientation: 2 };
    const result = parseBlockEntry(input);
    assertDeepEqual(result, { type: 'handrailA', orientation: 2 });
  });

  test('parseBlockEntry - 新格式对象无朝向字段', () => {
    const input = { type: 'handrailA' };
    const result = parseBlockEntry(input);
    assertDeepEqual(result, { type: 'handrailA', orientation: 0 });
  });

  test('parseBlockEntry - null/undefined 返回默认值', () => {
    const result1 = parseBlockEntry(null);
    assertDeepEqual(result1, { type: 'air', orientation: 0 });

    const result2 = parseBlockEntry(undefined);
    assertDeepEqual(result2, { type: 'air', orientation: 0 });
  });

  test('parseBlockEntry - 空对象返回默认朝向', () => {
    const result = parseBlockEntry({});
    assertDeepEqual(result, { type: 'air', orientation: 0 });
  });

});
