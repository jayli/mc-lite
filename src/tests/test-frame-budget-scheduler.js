import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { FrameBudgetScheduler } from '../core/FrameBudgetScheduler.js';

describe('FrameBudgetScheduler', (test) => {
  test('beginFrame 后 getRemainingMs 接近 targetFrameMs - safetyMargin', () => {
    const s = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    s.beginFrame();
    const r = s.getRemainingMs();
    assertTrue(r >= 7 && r <= 8.5, `应接近 8ms, got ${r}`);
  });

  test('hasTimeFor 正确判断', () => {
    const s = new FrameBudgetScheduler({ targetFps: 100, safetyMarginMs: 2 });
    s.beginFrame();
    assertTrue(s.hasTimeFor(5), '应有 5ms');
    assertEqual(s.hasTimeFor(10), false, '不应有 10ms');
  });

  test('getRemainingMs 不会返回负数', () => {
    const s = new FrameBudgetScheduler({ targetFps: 1000, safetyMarginMs: 0.5 });
    s.beginFrame();
    s.frameDeadline = s.frameStart - 10;
    assertEqual(s.getRemainingMs(), 0, '超时后应返回 0');
  });

  test('默认参数 100fps + 2ms margin', () => {
    const s = new FrameBudgetScheduler();
    assertEqual(s.targetFps, 100, '默认 targetFps');
    assertEqual(s.targetFrameMs, 10, '默认 targetFrameMs');
    assertEqual(s.safetyMarginMs, 2, '默认 safetyMarginMs');
  });
});
