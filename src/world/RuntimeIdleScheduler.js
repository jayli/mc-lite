// src/world/RuntimeIdleScheduler.js
// runtime-streaming 阶段的空闲任务调度器

const defaultNow = () => (globalThis.performance?.now?.() ?? Date.now());

/**
 * 在世界 streaming 空闲时运行低优先级任务。
 *
 * 空闲由 World 提供的上下文决定；调度器只维护 busy 时间、任务优先级和每帧预算。
 */
export class RuntimeIdleScheduler {
  constructor(options = {}) {
    this.idleGraceMs = Number.isFinite(options.idleGraceMs) ? options.idleGraceMs : 1000;
    this.frameBudgetMs = Number.isFinite(options.frameBudgetMs) ? options.frameBudgetMs : 2;
    this.now = typeof options.now === 'function' ? options.now : defaultNow;
    this.lastBusyAt = this.now();
    this.tasks = new Map();
    this.stats = {
      lastIdleAt: 0,
      lastBusyReason: 'init',
      processedTasks: 0
    };
  }

  markBusy(reason = 'world-busy', now = this.now()) {
    this.lastBusyAt = now;
    this.stats.lastBusyReason = reason;
  }

  registerTask(task) {
    if (!task?.id || typeof task.run !== 'function') {
      throw new Error('RuntimeIdleScheduler task requires id and run');
    }

    const normalized = {
      priority: 0,
      minIdleMs: this.idleGraceMs,
      ...task
    };
    this.tasks.set(normalized.id, normalized);

    return () => {
      this.tasks.delete(normalized.id);
    };
  }

  isIdle(context = {}, now = this.now()) {
    if (context.phase !== 'runtime-streaming') return false;
    if (context.hasAssemblyWork) return false;
    return now - this.lastBusyAt >= this.idleGraceMs;
  }

  process(context = {}, options = {}) {
    const now = this.now();
    if (!this.isIdle(context, now)) {
      return { processedTasks: 0, didWork: false };
    }

    const frameBudgetMs = Number.isFinite(options.frameBudgetMs)
      ? options.frameBudgetMs
      : this.frameBudgetMs;
    const start = now;
    let processedTasks = 0;
    let didWork = false;

    const tasks = [...this.tasks.values()].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });

    for (const task of tasks) {
      const current = this.now();
      if (current - this.lastBusyAt < task.minIdleMs) continue;
      if (current - start >= frameBudgetMs) break;

      const result = task.run({ ...context, now: current });
      processedTasks++;
      if (result?.didWork && !task.continueAfterWork) {
        didWork = true;
        break;
      }
      didWork = didWork || Boolean(result?.didWork);
    }

    if (processedTasks > 0) {
      this.stats.lastIdleAt = this.now();
      this.stats.processedTasks += processedTasks;
    }

    return { processedTasks, didWork };
  }

  getStats() {
    return {
      ...this.stats,
      taskCount: this.tasks.size,
      idleForMs: this.now() - this.lastBusyAt
    };
  }
}
