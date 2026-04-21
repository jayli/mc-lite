import { describe } from './runner.js';
import { assertEqual, assertFalse, assertTrue } from './assert.js';
import { RuntimeIdleScheduler } from '../world/RuntimeIdleScheduler.js';

describe('RuntimeIdleScheduler 空闲任务调度', (test) => {
  test('runtime-streaming 且超过 grace 后才进入 idle', () => {
    const scheduler = new RuntimeIdleScheduler({ idleGraceMs: 100, frameBudgetMs: 2, now: () => 1000 });
    scheduler.markBusy('test', 1000);

    assertFalse(
      scheduler.isIdle({ phase: 'runtime-streaming', hasAssemblyWork: false }, 1050),
      'grace 时间未到不应 idle'
    );
    assertFalse(
      scheduler.isIdle({ phase: 'bootstrapping', hasAssemblyWork: false }, 1200),
      'bootstrap 阶段不应 idle'
    );
    assertFalse(
      scheduler.isIdle({ phase: 'runtime-streaming', hasAssemblyWork: true }, 1200),
      'assembly queue 有工作不应 idle'
    );
    assertTrue(
      scheduler.isIdle({ phase: 'runtime-streaming', hasAssemblyWork: false }, 1200),
      'runtime-streaming 空闲超过 grace 后应 idle'
    );
  });

  test('按 priority 执行，任务 didWork 后停止低优先级任务', () => {
    const calls = [];
    const scheduler = new RuntimeIdleScheduler({ idleGraceMs: 100, frameBudgetMs: 10, now: () => 2000 });
    scheduler.markBusy('test', 1000);
    scheduler.registerTask({
      id: 'low',
      priority: 1,
      run: () => {
        calls.push('low');
        return { didWork: true };
      }
    });
    scheduler.registerTask({
      id: 'high',
      priority: 10,
      run: () => {
        calls.push('high');
        return { didWork: true };
      }
    });

    const result = scheduler.process({
      phase: 'runtime-streaming',
      hasAssemblyWork: false
    });

    assertEqual(result.processedTasks, 1, 'didWork 后应停止执行后续任务');
    assertEqual(result.didWork, true, '应报告本帧做了工作');
    assertEqual(calls.join(','), 'high', '高优先级任务应先执行');
  });

  test('unsubscribe 后不再执行任务', () => {
    let calls = 0;
    const scheduler = new RuntimeIdleScheduler({ idleGraceMs: 0, frameBudgetMs: 10, now: () => 3000 });
    const unsubscribe = scheduler.registerTask({
      id: 'task',
      run: () => {
        calls++;
        return { didWork: true };
      }
    });

    unsubscribe();
    scheduler.process({ phase: 'runtime-streaming', hasAssemblyWork: false });

    assertEqual(calls, 0, '取消注册后任务不应执行');
  });
});
