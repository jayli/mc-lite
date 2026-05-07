// src/tests/test-world-bounds.js
import { describe } from './runner.js';
import { assertDeepEqual, assertFalse, assertTrue } from './assert.js';
import { WorldBoundsController } from '../world/WorldBoundsController.js';

describe('WorldBoundsController 边界控制测试', (test) => {
  test('initFromMeta 应正确应用三组 bounds', () => {
    const controller = new WorldBoundsController();
    const meta = {
      generatedBounds: { minX: -32, minZ: -48, maxX: 63, maxZ: 95 },
      safeBounds: { minX: -16, minZ: -16, maxX: 47, maxZ: 47 },
      expandTargetBounds: { minX: -32, minZ: -32, maxX: 63, maxZ: 63 }
    };

    controller.initFromMeta(meta);

    assertDeepEqual(controller.generatedBounds, meta.generatedBounds, 'generatedBounds 应与 meta 一致');
    assertDeepEqual(controller.safeBounds, meta.safeBounds, 'safeBounds 应与 meta 一致');
    assertDeepEqual(controller.expandTargetBounds, meta.expandTargetBounds, 'expandTargetBounds 应与 meta 一致');
  });

  test('shouldBlockMovement 应按目标点是否越界判定', () => {
    const controller = new WorldBoundsController();
    controller.safeBounds = { minX: 0, minZ: 0, maxX: 31, maxZ: 31 };

    assertFalse(
      controller.shouldBlockMovement(10, 10, 20, 20),
      '边界内移动不应被阻挡'
    );
    assertTrue(
      controller.shouldBlockMovement(10, 10, 40, 20),
      '从边界内走到边界外应被阻挡'
    );
    assertFalse(
      controller.shouldBlockMovement(40, 20, 20, 20),
      '从边界外回到边界内应允许进入'
    );
  });

  test('startExpansion 应立即推进 expandTargetBounds，finishExpansion 应同步全部边界', () => {
    const controller = new WorldBoundsController();
    controller.generatedBounds = { minX: 0, minZ: 0, maxX: 31, maxZ: 31 };
    controller.safeBounds = { minX: 0, minZ: 0, maxX: 31, maxZ: 31 };
    controller.expandTargetBounds = { minX: 0, minZ: 0, maxX: 31, maxZ: 31 };

    const targetBounds = { minX: -32, minZ: 0, maxX: 63, maxZ: 31 };
    controller.startExpansion(['west', 'east'], targetBounds);

    assertTrue(controller.isExpanding, 'startExpansion 后应处于扩图中');
    assertDeepEqual(controller.expandTargetBounds, targetBounds, '扩图开始时应先推进 expandTargetBounds');
    assertDeepEqual(controller.safeBounds, { minX: 0, minZ: 0, maxX: 31, maxZ: 31 }, '扩图中 safeBounds 不应提前变化');

    controller.finishExpansion(targetBounds);

    assertFalse(controller.isExpanding, 'finishExpansion 后应退出扩图状态');
    assertDeepEqual(controller.generatedBounds, targetBounds, 'generatedBounds 应推进到新边界');
    assertDeepEqual(controller.safeBounds, targetBounds, 'safeBounds 应推进到新边界');
    assertDeepEqual(controller.expandTargetBounds, targetBounds, 'expandTargetBounds 应与最终边界一致');
  });
});
