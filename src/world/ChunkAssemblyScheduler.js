// src/world/ChunkAssemblyScheduler.js
// Chunk 主线程装配调度器
import { recordChunkPerf } from '../utils/ChunkPerfMonitor.js';

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

    // 记录 chunk 进入该 stage 的时间戳，用于计算排队等待时间
    if (!chunk._assemblyStageEnqueueTime) chunk._assemblyStageEnqueueTime = {};
    chunk._assemblyStageEnqueueTime[stage] = now();

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

  async processWithinBudget(options = {}) {
    const budgetMs = Number.isFinite(options.budgetMs) ? options.budgetMs : 4;
    const maxTasks = Number.isFinite(options.maxTasks) ? options.maxTasks : 2;
    const start = now();
    const initialQueueLength = this.queue.length;
    const maxTasksThisPass = Math.min(maxTasks, initialQueueLength);
    let processed = 0;

    while (this.queue.length > 0 && processed < maxTasksThisPass && (now() - start) <= budgetMs) {
      const task = this._takeNext();
      if (!task) break;
      processed++;
      const remaining = budgetMs - (now() - start);
      await this._runTask(task, remaining);
    }

    if (processed > 0 || initialQueueLength > 0 || this.queue.length > 0) {
      recordChunkPerf('chunk-assembly.process', now() - start, {
        budgetMs,
        maxTasks,
        processed,
        initialQueueLength,
        remainingQueueLength: this.queue.length
      });
    }
    return processed;
  }

  async drainAll(options = {}) {
    const maxIterations = Number.isFinite(options.maxIterations) ? options.maxIterations : 200;
    let iterations = 0;
    while (this.hasWork() && iterations < maxIterations) {
      await this.processWithinBudget({ budgetMs: Number.POSITIVE_INFINITY, maxTasks: 1000 });
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

  async _runTask(task, remainingBudgetMs) {
    const { chunk, stage } = task;
    const start = now();

    // 计算从 enqueue 到实际执行的排队延迟
    let queueWaitMs = 0;
    if (chunk._assemblyStageEnqueueTime?.[stage]) {
      queueWaitMs = start - chunk._assemblyStageEnqueueTime[stage];
      delete chunk._assemblyStageEnqueueTime[stage];
    }

    chunk.queuedAssemblyStages?.delete(stage);
    if (!chunk || chunk.disposed) return;

    // 记录 stage 开始时的 chunk 状态
    const preLoadState = chunk.loadState;
    const preIsReady = chunk.isReady;
    const preBlockDataSize = chunk.blockData?.size || 0;

    let stageResult = false;
    switch (stage) {
      case 'runtime-hydrate':
        stageResult = chunk.assembleRuntimeHydratePhase();
        if (stageResult === 'continue') {
          this.enqueue(chunk, stage, task.priority);
        } else if (stageResult === 'done' || stageResult === true) {
          this.enqueue(chunk, 'runtime-build-mesh', task.priority);
        }
        break;
      case 'runtime-build-mesh-fast':
      case 'runtime-build-mesh':
        stageResult = chunk.assembleRuntimeBuildMeshPhase(
          Math.max(1, remainingBudgetMs || 3)
        );
        if (stageResult === 'continue') {
          this.enqueue(chunk, 'runtime-build-mesh', task.priority);
        } else if (stageResult === 'done' || stageResult === true) {
          this.enqueue(chunk, 'runtime-finalize', task.priority);
        }
        break;
      case 'runtime-finalize':
        stageResult = chunk.assembleRuntimeFinalizePhase();
        if (stageResult === 'continue') {
          this.enqueue(chunk, stage, task.priority);
        } else if (stageResult === 'done' || stageResult === true) {
          if (chunk.renderState === 'staged') {
            chunk.loadState = 'awaiting-publish';
          } else {
            this.enqueue(chunk, 'finalize', task.priority);
          }
        }
        break;
      case 'runtime-build':
        stageResult = chunk.assembleRuntimeBuildPhase();
        if (stageResult) {
          this.enqueue(chunk, 'finalize', task.priority);
        }
        break;
      case 'terrain':
        stageResult = chunk.assembleTerrainPhase();
        if (stageResult) {
          this.enqueue(chunk, 'entities', task.priority);
        }
        break;
      case 'entities':
        stageResult = chunk.assembleEntityPhase();
        if (stageResult) {
          this.enqueue(chunk, 'finalize', task.priority);
        }
        break;
      case 'finalize':
        stageResult = chunk.finalizeAssemblyPhase();
        if (stageResult) {
          this.enqueue(chunk, 'non-deferred-finalize', task.priority);
        }
        break;
      case 'non-deferred-finalize':
        await chunk.finalizeNonDeferredPhase();
        stageResult = true;
        break;
      default:
        break;
    }

    const execMs = now() - start;
    recordChunkPerf('chunk-assembly.task', execMs, {
      chunkKey: `${chunk.cx},${chunk.cz}`,
      stage,
      priority: task.priority,
      loadState: chunk.loadState,
      isReady: chunk.isReady,
      queueWaitMs,
      execMs,
      preLoadState,
      preIsReady,
      preBlockDataSize,
      postBlockDataSize: chunk.blockData?.size || 0,
      stageResult
    });
  }
}
