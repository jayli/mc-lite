// src/tests/test-block-data.js
/**
 * BlockData 测试套件
 * 测试方块配置数据的属性获取和继承逻辑
 */

import { describe, test } from './runner.js';
import { assertEqual, assertTrue, assertFalse } from './assert.js';
import { getBlockProperties, BLOCK_DATA } from '../constants/BlockData.js';

describe('BlockData 测试', (test) => {

  // =========== 默认属性测试 ===========
  test('默认属性值正确', () => {
    const props = getBlockProperties('unknown_block_xyz');

    assertEqual(props.isSolid, true, '默认方块应该是实心');
    assertEqual(props.isTransparent, false, '默认方块应该不透明');
    assertEqual(props.isRendered, true, '默认方块应该渲染');
    assertEqual(props.isShadowEnabled, true, '默认方块投射阴影');
    assertEqual(props.geometryType, 'box', '默认几何体类型为 box');
  });

  test('null/undefined 输入返回默认属性', () => {
    const props1 = getBlockProperties(null);
    assertEqual(props1.isSolid, true, 'null 输入返回默认实心');

    const props2 = getBlockProperties(undefined);
    assertEqual(props2.isSolid, true, 'undefined 输入返回默认实心');
  });

  // =========== 空气方块测试 ===========
  test('空气方块属性', () => {
    const props = getBlockProperties('air');

    assertEqual(props.isSolid, false, '空气不是实心');
    assertEqual(props.isTransparent, true, '空气透明');
    assertEqual(props.isRendered, false, '空气不渲染');
    assertEqual(props.isShadowEnabled, false, '空气不投射阴影');
  });

  // =========== 透明方块测试 ===========
  test('玻璃方块透明属性', () => {
    const props = getBlockProperties('glass_block');
    assertTrue(props.isTransparent, '玻璃方块应该透明');
  });

  test('叶子方块透明属性', () => {
    const props = getBlockProperties('leaves');
    assertTrue(props.isTransparent, '叶子方块应该透明');
  });

  test('水方块透明且不实心', () => {
    const props = getBlockProperties('water');
    assertFalse(props.isSolid, '水不是实心');
    assertTrue(props.isTransparent, '水透明');
  });

  // =========== 植物方块测试 ===========
  test('花朵方块属性', () => {
    const props = getBlockProperties('flower');

    assertEqual(props.isSolid, false, '花不是实心');
    assertTrue(props.isTransparent, '花透明');
    assertEqual(props.geometryType, 'flower', '花几何体类型为 flower');
  });

  test('草丛方块属性', () => {
    const props = getBlockProperties('short_grass');

    assertEqual(props.isSolid, false, '草不是实心');
    assertEqual(props.geometryType, 'flower', '草几何体类型为 flower');
  });

  test('藤蔓方块属性', () => {
    const props = getBlockProperties('vine');

    assertEqual(props.geometryType, 'vine', '藤蔓几何体类型为 vine');
  });

  // =========== 特殊几何体测试 ===========
  test('仙人掌几何体类型', () => {
    const props = getBlockProperties('cactus');
    assertEqual(props.geometryType, 'cactus', '仙人掌几何体类型为 cactus');
  });

  test('栏杆几何体类型', () => {
    const props = getBlockProperties('handrail');
    assertEqual(props.geometryType, 'handrail', '栏杆几何体类型为 handrail');
  });

  test('烟囱几何体类型', () => {
    const props = getBlockProperties('chimney');
    assertEqual(props.geometryType, 'chimney', '烟囱几何体类型为 chimney');
  });

  // =========== 模糊匹配测试 ===========
  test('模糊匹配 - realistic_oak_leaves 匹配 leaves', () => {
    const props = getBlockProperties('realistic_oak_leaves');
    assertTrue(props.isTransparent, 'realistic_oak_leaves 应该透明');
  });

  test('模糊匹配 - azalea_leaves 匹配 leaves', () => {
    const props = getBlockProperties('azalea_leaves');
    assertTrue(props.isTransparent, 'azalea_leaves 应该透明');
  });

  test('模糊匹配 - glass_blink 匹配 glass_block', () => {
    const props = getBlockProperties('glass_blink');
    assertTrue(props.isTransparent, 'glass_blink 应该透明');
  });

  test('模糊匹配 - swamp_water 匹配 water', () => {
    const props = getBlockProperties('swamp_water');
    assertFalse(props.isSolid, 'swamp_water 不是实心');
    assertTrue(props.isTransparent, 'swamp_water 透明');
  });

  // =========== 宝箱方块测试 ===========
  test('宝箱方块属性', () => {
    const props = getBlockProperties('chest');

    assertTrue(props.isSolid, '宝箱是实心');
    assertTrue(props.isTransparent, '宝箱透明');
  });

  // =========== 碰撞体方块测试 ===========
  test('碰撞体方块属性', () => {
    const props = getBlockProperties('collider');

    assertTrue(props.isSolid, '碰撞体是实心');
    assertTrue(props.isTransparent, '碰撞体透明');
    assertFalse(props.isRendered, '碰撞体不渲染');
  });

  test('树木碰撞体属性', () => {
    const props = getBlockProperties('realistic_trunk_collider');

    assertTrue(props.isSolid, '树木碰撞体是实心');
    assertTrue(props.isTransparent, '树木碰撞体透明');
    assertFalse(props.isRendered, '树木碰撞体不渲染');
  });

  // =========== 云朵测试 ===========
  test('云朵方块属性', () => {
    const props = getBlockProperties('cloud');

    assertFalse(props.isSolid, '云不是实心');
    assertTrue(props.isTransparent, '云透明');
    assertFalse(props.isShadowEnabled, '云不投射阴影');
  });

  // =========== BLOCK_DATA 直接访问测试 ===========
  test('BLOCK_DATA 包含所有定义的方块', () => {
    // 验证一些关键方块在 BLOCK_DATA 中有定义
    assertTrue('air' in BLOCK_DATA, 'air 在 BLOCK_DATA 中');
    assertTrue('stone' in BLOCK_DATA, 'stone 在 BLOCK_DATA 中');
    assertTrue('glass_block' in BLOCK_DATA, 'glass_block 在 BLOCK_DATA 中');
    assertTrue('chest' in BLOCK_DATA, 'chest 在 BLOCK_DATA 中');
  });

  test('BLOCK_DATA 中条目定义正确', () => {
    // 验证 BLOCK_DATA 中的条目包含必要的属性
    const airData = BLOCK_DATA['air'];
    assertTrue('isSolid' in airData, 'air 应该定义 isSolid');
    assertTrue('isTransparent' in airData, 'air 应该定义 isTransparent');
    // 注意：某些方块可能显式定义所有属性，这是设计选择，不是 bug
  });

});
