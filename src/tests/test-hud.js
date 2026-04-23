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
  test('StreamingPerf 日志默认开启且可通过标志位关闭', () => {
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
      const snapshot = {
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
      };
      const game = {
        player: {
          inventory: {
            selectedSlot: 0,
            slots: [createSlot('stone', 64), createSlot(), createSlot(), createSlot(), createSlot()]
          }
        },
        world: {
          consumeStreamingPerfSnapshot() {
            return snapshot;
          }
        }
      };

      const hud = new HUD(game);
      hud.renderHotbar = () => {};

      hud.update(1000);
      assertEqual(document.getElementById('perf').textContent, '', '面板不应再显示装配数据');
      assertEqual(logs.length, 0, '默认状态下不应输出日志');

      hud._streamingPerfLogEnabled = true;
      hud.update(2000);
      assertEqual(logs.length, 1, '开启标志后应输出一次日志');
      assertTrue(logs[0][0] === '[StreamingPerf]', '日志前缀应为 [StreamingPerf]');

      hud._streamingPerfLogEnabled = false;
      logs.length = 0;
      hud.update(3000);
      assertEqual(logs.length, 0, '关闭标志后不应输出日志');
    } finally {
      console.log = originalConsoleLog;
      document.body.innerHTML = originalBody;
    }
  });
});
