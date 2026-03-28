import { describe } from './runner.js';
import { assertEqual, assertNotNull } from './assert.js';
import {
  getBlockPosFromRayStepInside,
  resolveBreakBlockPos
} from '../utils/BlockHitResolver.js';

describe('BlockHitResolver 命中坐标解析测试', (test) => {
  test('沿射线向内微移应解析到墙面命中的方块', () => {
    const pos = getBlockPosFromRayStepInside(
      { x: 10, y: 5.25, z: 7.75 },
      { x: 1, y: 0, z: 0 },
      0.01
    );
    assertNotNull(pos, '解析结果不应为 null');
    assertEqual(pos.x, 10, '应命中 x=10 的方块');
    assertEqual(pos.y, 5, '应命中 y=5 的方块');
    assertEqual(pos.z, 7, '应命中 z=7 的方块');
  });

  test('法线方向异常时应优先使用沿射线向内微移结果', () => {
    const blocks = new Map([
      ['10,5,7', { type: 'stone', orientation: 0 }],
      ['11,5,7', { type: 'stone', orientation: 0 }]
    ]);
    const getBlockEntry = (x, y, z) => blocks.get(`${x},${y},${z}`) || null;

    const resolved = resolveBreakBlockPos({
      hitPoint: { x: 10, y: 5.25, z: 7.75 },
      rayDirection: { x: 1, y: 0, z: 0 },
      faceNormal: { x: -1, y: 0, z: 0 },
      matrixPosition: { x: 11.5, y: 5.5, z: 7.5 },
      getBlockEntry,
      preferredType: 'stone'
    });

    assertNotNull(resolved, '应解析到可删除方块');
    assertEqual(resolved.x, 10, '应优先选择离玩家更近的方块');
  });

  test('应优先选择与命中网格类型一致的候选坐标', () => {
    const blocks = new Map([
      ['10,5,7', { type: 'dirt', orientation: 0 }],
      ['12,5,7', { type: 'stone', orientation: 0 }]
    ]);
    const getBlockEntry = (x, y, z) => blocks.get(`${x},${y},${z}`) || null;

    const resolved = resolveBreakBlockPos({
      hitPoint: { x: 11, y: 5.25, z: 7.75 },
      rayDirection: { x: 1, y: 0, z: 0 },
      faceNormal: { x: 0, y: 1, z: 0 },
      matrixPosition: { x: 12.5, y: 5.5, z: 7.5 },
      getBlockEntry,
      preferredType: 'stone'
    });

    assertNotNull(resolved, '应解析到可删除方块');
    assertEqual(resolved.x, 12, '应跳过类型不匹配的坐标');
    assertEqual(resolved.entry.type, 'stone', '最终类型应与命中网格一致');
  });
});
