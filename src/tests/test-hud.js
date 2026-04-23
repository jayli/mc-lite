import { describe } from './runner.js';
import { assertEqual, assertTrue } from './assert.js';
import { HUD } from '../ui/HUD.js';

function createSlot(item = null, count = 0) {
  return {
    item,
    count,
    isEmpty() {
      return !this.item || this.count <= 0;
    }
  };
}

describe('HUD', (test) => {
  test('流式性能面板只在每秒快照到达时刷新并输出日志', () => {
    const originalBody = document.body.innerHTML;
    const originalConsoleLog = console.log;
    const logs = [];

    document.body.innerHTML = `
      <div id="hud">
        <div id="perf"></div>
        <div id="msg"></div>
      </div>
      <div id="hotbar"></div>
    `;

    console.log = (...args) => {
      logs.push(args);
    };

    try {
      const snapshots = [
        null,
        {
          phase: 'runtime-streaming',
          assemblyQueue: 4,
          mutationQueueBlocks: 120,
          mutationQueueTasks: 3,
          flushBlocksPerSec: 480,
          flushMaxMs: 1.8,
          flushLastProcessedBlocks: 240,
          flushBudgetOps: 600,
          flushBudgetMs: 2,
          deferredPatchChunks: 2,
          deferredPatchBlocks: 40,
          consolidatingChunks: 1,
          loadingChunks: 3,
          readyChunks: 10,
          totalChunks: 14
        }
      ];
      const game = {
        player: {
          inventory: {
            selectedSlot: 0,
            slots: [createSlot('stone', 64), createSlot(), createSlot(), createSlot(), createSlot()]
          }
        },
        world: {
          consumeStreamingPerfSnapshot() {
            return snapshots.shift() ?? null;
          }
        }
      };

      const hud = new HUD(game);
      hud.renderHotbar = () => {};

      hud.update(0);
      assertEqual(document.getElementById('perf').textContent, '', '无快照时不应刷新性能面板');
      assertEqual(logs.length, 0, '无快照时不应输出日志');

      hud.update(1000);
      const perfText = document.getElementById('perf').textContent;
      assertTrue(perfText.includes('装配队列 4'), '应显示装配队列长度');
      assertTrue(perfText.includes('实例队列 120/3'), '应显示全局实例队列积压');
      assertTrue(perfText.includes('flush 480/s'), '应显示每秒 flush 吞吐');
      assertTrue(perfText.includes('补丁 2/40'), '应显示 deferred patch 积压');
      assertEqual(logs.length, 1, '有快照时应输出一次日志');
    } finally {
      console.log = originalConsoleLog;
      document.body.innerHTML = originalBody;
    }
  });
});
