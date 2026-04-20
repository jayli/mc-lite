/**
 * WorldWorkerPoolImpl — Worker 池核心实现
 *
 * 管理多个 WorldWorker 实例，提供：
 * - 空闲优先分配 + 轮询 fallback
 * - FIFO 排队（所有 Worker 忙时）
 * - 按 taskId 路由回调，支持回包乱序
 * - 聚合 onmessage / onerror 事件
 */

let nextNonce = 0;

export class WorldWorkerPool {
  constructor(size = 3) {
    this.size = size;
    this.pool = [];       // [{ worker, busy }]
    this.callbacks = new Map();  // taskId -> callbackFn
    this.pendingQueue = [];      // [{ taskId, message }]
    this.lastUsedIndex = -1;
    this._onmessage = null;
    this._onerror = null;

    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL('./WorldWorker.js', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (e) => this._handleMessage(i, e);
      worker.onerror = (e) => this._handleError(i, e);
      this.pool.push({ worker, busy: false });
    }
  }

  // -- 与单 Worker 兼容的事件 API --

  get onmessage() { return this._onmessage; }
  set onmessage(fn) { this._onmessage = fn; }

  get onerror() { return this._onerror; }
  set onerror(fn) { this._onerror = fn; }

  /**
   * 提交任务到池。
   * 如果有 callback 参数，自动注册回调。
   * 返回分配的 taskId。
   */
  postMessage(message, callback) {
    const taskId = message.taskId || this._generateTaskId(message);
    message.taskId = taskId;

    if (callback) {
      this.callbacks.set(taskId, callback);
    }

    const idleIndex = this._findIdleWorker();
    if (idleIndex !== -1) {
      this._dispatchToWorker(idleIndex, message);
    } else {
      this.pendingQueue.push({ taskId, message });
    }

    return taskId;
  }

  /**
   * 终止所有 Worker。
   */
  terminate() {
    for (const { worker } of this.pool) {
      worker.terminate();
    }
    this.pool = [];
  }

  // -- 回调管理（供 workerCallbacks 代理使用） --

  registerCallback(taskId, callbackFn) {
    this.callbacks.set(taskId, callbackFn);
  }

  unregisterCallback(taskId) {
    return this.callbacks.delete(taskId);
  }

  hasCallback(taskId) {
    return this.callbacks.has(taskId);
  }

  getCallback(taskId) {
    return this.callbacks.get(taskId);
  }

  // -- 内部方法 --

  _generateTaskId(message) {
    const nonce = ++nextNonce;
    const type = message.isOptimization ? 'cons' : 'gen';
    return `${message.cx ?? 'x'},${message.cz ?? 'z'}:${type}:${nonce}`;
  }

  _findIdleWorker() {
    for (let i = 0; i < this.size; i++) {
      const idx = (this.lastUsedIndex + 1 + i) % this.size;
      if (!this.pool[idx].busy) return idx;
    }
    return -1;
  }

  _dispatchToWorker(index, message) {
    this.pool[index].busy = true;
    this.lastUsedIndex = index;
    this.pool[index].worker.postMessage(message);
  }

  _flushPendingQueue() {
    while (this.pendingQueue.length > 0) {
      const idleIndex = this._findIdleWorker();
      if (idleIndex === -1) break;
      const { taskId, message } = this.pendingQueue.shift();
      message.taskId = taskId;
      this._dispatchToWorker(idleIndex, message);
    }
  }

  _handleMessage(workerIndex, event) {
    const { callbackKey, taskId } = event.data;

    // 路由回调：优先 taskId（新格式），回退 callbackKey（旧格式/测试兼容）
    const key = taskId || callbackKey;
    const callback = this.callbacks.get(key);

    if (callback) {
      callback(event.data);
      this.callbacks.delete(key);
    }

    // 标记 worker 空闲并尝试派发排队任务
    this.pool[workerIndex].busy = false;
    this._flushPendingQueue();

    // 触发聚合的 onmessage 处理器
    if (this._onmessage) {
      this._onmessage(event);
    }
  }

  _handleError(workerIndex, event) {
    // Worker 出错后标记为空闲，允许继续接受任务
    this.pool[workerIndex].busy = false;
    if (this._onerror) {
      this._onerror(event);
    }
  }

  /**
   * 获取池状态统计
   */
  stats() {
    const busy = this.pool.filter(w => w.busy).length;
    return {
      total: this.size,
      busy,
      idle: this.size - busy,
      pendingQueueLength: this.pendingQueue.length
    };
  }
}
