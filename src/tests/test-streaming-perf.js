import { describe } from './runner.js';
import { assertTrue } from './assert.js';

describe('Streaming Performance', (test) => {
  test('持续移动 10 秒帧率 p95 < 16ms, p99 < 20ms', async () => {
    const game = window.game;
    if (!game?.world?.bootstrapState) { console.warn('[perf] skip: no game'); return; }

    let waited = 0;
    while (game.world.bootstrapState.phase !== 'runtime-streaming' && waited < 10000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
    if (game.world.bootstrapState.phase !== 'runtime-streaming') {
      console.warn('[perf] skip: not runtime-streaming');
      return;
    }

    const frameTimes = [];
    const duration = 10000;
    const start = performance.now();
    let lastFrame = start;

    await new Promise(resolve => {
      const collect = () => {
        const now = performance.now();
        frameTimes.push(now - lastFrame);
        lastFrame = now;
        if (game.player?.position) game.player.position.z += 0.3;
        if (now - start < duration) requestAnimationFrame(collect);
        else resolve();
      };
      requestAnimationFrame(collect);
    });

    frameTimes.sort((a, b) => a - b);
    const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)];
    const p99 = frameTimes[Math.floor(frameTimes.length * 0.99)];
    const longTasks = frameTimes.filter(t => t > 16.7).length;

    console.log(`[perf] frames=${frameTimes.length} p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms longTasks=${longTasks}`);
    assertTrue(p95 < 16, `p95=${p95.toFixed(1)}ms should be < 16ms`);
    assertTrue(p99 < 20, `p99=${p99.toFixed(1)}ms should be < 20ms`);
    assertTrue(longTasks < frameTimes.length * 0.05, `longTasks=${longTasks} should be < 5% of frames`);
  });
});
