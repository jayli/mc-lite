// src/world/ChunkAssemblyScheduler.js
// Chunk 主线程装配调度器

const now = () => (globalThis.performance?.now?.() ?? Date.now());

export class ChunkAssemblyScheduler {
  constructor(world) {
    this.world = world;
    this.queue = [];
    this.sequence = 0;
  }

  enqueue(chunk, stage, priority = 0) {
    if (!chunk || !stage) return;
    if (!chunk.queuedAssemblyStages) {
      chunk.queuedAssemblyStages = new Set();
    }
    const dedupeKey = `${stage}`;
    if (chunk.queuedAssemblyStages.has(dedupeKey)) {
      const existingTask = this.queue.find(item => item.chunk === chunk && item.stage === stage);
      if (existingTask && priority > existingTask.priority) {
        existingTask.priority = priority;
      }
      return;
    }

    chunk.queuedAssemblyStages.add(dedupeKey);
    this.queue.push({
      chunk,
      stage,
      priority,
      sequence: this.sequence++
    });
  }

  hasWork() {
    return this.queue.length > 0;
  }

  getPendingCount() {
    return this.queue.length;
  }

  processWithinBudget(options = {}) {
    const budgetMs = Number.isFinite(options.budgetMs) ? options.budgetMs : 4;
    const maxTasks = Number.isFinite(options.maxTasks) ? options.maxTasks : 2;
    const start = now();
    let processed = 0;

    while (this.queue.length > 0 && processed < maxTasks && (now() - start) <= budgetMs) {
      const task = this._takeNext();
      if (!task) break;
      processed++;
      this._runTask(task);
    }

    return processed;
  }

  async drainAll(options = {}) {
    const maxIterations = Number.isFinite(options.maxIterations) ? options.maxIterations : 200;
    let iterations = 0;
    while (this.hasWork() && iterations < maxIterations) {
      this.processWithinBudget({ budgetMs: Number.POSITIVE_INFINITY, maxTasks: 1000 });
      await Promise.resolve();
      iterations++;
    }
  }

  _takeNext() {
    if (this.queue.length === 0) return null;

    let bestIndex = 0;
    let best = this.queue[0];
    for (let i = 1; i < this.queue.length; i++) {
      const current = this.queue[i];
      if (current.priority > best.priority) {
        best = current;
        bestIndex = i;
        continue;
      }
      if (current.priority === best.priority && current.sequence < best.sequence) {
        best = current;
        bestIndex = i;
      }
    }

    return this.queue.splice(bestIndex, 1)[0];
  }

  _runTask(task) {
    const { chunk, stage } = task;
    chunk.queuedAssemblyStages?.delete(stage);
    if (!chunk || chunk.disposed) return;

    switch (stage) {
      case 'terrain':
        if (chunk.assembleTerrainPhase()) {
          this.enqueue(chunk, 'entities', task.priority);
        }
        break;
      case 'entities':
        if (chunk.assembleEntityPhase()) {
          this.enqueue(chunk, 'finalize', task.priority);
        }
        break;
      case 'finalize':
        chunk.finalizeAssemblyPhase();
        break;
      default:
        break;
    }
  }
}
