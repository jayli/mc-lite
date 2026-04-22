import { describe } from './runner.js';
import { assertEqual, assertFalse, assertTrue } from './assert.js';
import {
  getChunkPerfConfig,
  isChunkPerfDebugEnabled,
  recordChunkPerf,
  toggleChunkPerfDebug
} from '../utils/ChunkPerfMonitor.js';

describe('ChunkPerfMonitor 打点开关', (test) => {
  test('默认关闭，不输出日志', () => {
    const logs = [];
    const scope = {};

    const recorded = recordChunkPerf('chunk.test', 20, {}, {
      scope,
      logger: (...args) => logs.push(args)
    });

    assertFalse(isChunkPerfDebugEnabled(scope), '默认应关闭 chunk 性能日志');
    assertFalse(recorded, '关闭时不应记录');
    assertEqual(logs.length, 0, '关闭时不应输出日志');
  });

  test('开启后超过阈值才输出日志', () => {
    const logs = [];
    const scope = {
      CHUNK_PERF_DEBUG: {
        enabled: true,
        thresholdMs: 5
      }
    };

    const skipped = recordChunkPerf('chunk.fast', 3, {}, {
      scope,
      logger: (...args) => logs.push(args)
    });
    const recorded = recordChunkPerf('chunk.slow', 6, { chunkKey: '0,0' }, {
      scope,
      logger: (...args) => logs.push(args)
    });

    assertTrue(isChunkPerfDebugEnabled(scope), '配置 enabled=true 时应开启');
    assertFalse(skipped, '低于阈值时不应输出');
    assertTrue(recorded, '超过阈值时应输出');
    assertEqual(logs.length, 1, '只应输出慢事件');
    assertTrue(String(logs[0][0]).includes('[ChunkPerf] chunk.slow'), '日志前缀应包含事件名');
  });

  test('布尔开关使用默认阈值', () => {
    const scope = { CHUNK_PERF_DEBUG: true };
    const config = getChunkPerfConfig(scope);

    assertTrue(config.enabled, '布尔 true 应开启');
    assertEqual(config.thresholdMs, 2, '默认阈值应为 2ms');
  });

  test('toggleChunkPerfDebug 连续调用应开启再关闭', () => {
    const scope = {};

    const enabled = toggleChunkPerfDebug(scope);
    assertTrue(enabled, '第一次切换应开启');
    assertTrue(isChunkPerfDebugEnabled(scope), '开启后配置应生效');
    assertEqual(getChunkPerfConfig(scope).thresholdMs, 0, '快捷键开启时应默认记录所有 chunk perf 事件');

    const disabled = toggleChunkPerfDebug(scope);
    assertFalse(disabled, '第二次切换应关闭');
    assertFalse(isChunkPerfDebugEnabled(scope), '关闭后不应继续记录');
    assertEqual(scope.CHUNK_PERF_DEBUG, false, '关闭时应显式写入 false');
  });
});
