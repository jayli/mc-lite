const DEFAULT_THRESHOLD_MS = 2;
const MAX_EVENT_HISTORY = 120;

function normalizeConfig(rawConfig) {
  if (rawConfig === true) {
    return {
      enabled: true,
      thresholdMs: DEFAULT_THRESHOLD_MS
    };
  }

  if (!rawConfig || rawConfig === false) {
    return {
      enabled: false,
      thresholdMs: DEFAULT_THRESHOLD_MS
    };
  }

  const thresholdMs = Number.isFinite(rawConfig.thresholdMs)
    ? rawConfig.thresholdMs
    : DEFAULT_THRESHOLD_MS;

  return {
    enabled: rawConfig.enabled !== false,
    thresholdMs
  };
}

export function getChunkPerfConfig(scope = globalThis) {
  return normalizeConfig(scope?.CHUNK_PERF_DEBUG);
}

export function isChunkPerfDebugEnabled(scope = globalThis) {
  return getChunkPerfConfig(scope).enabled;
}

export function toggleChunkPerfDebug(scope = globalThis, options = {}) {
  const enabled = !isChunkPerfDebugEnabled(scope);
  if (enabled) {
    scope.CHUNK_PERF_DEBUG = {
      enabled: true,
      thresholdMs: Number.isFinite(options.thresholdMs) ? options.thresholdMs : 0
    };
    return true;
  }

  scope.CHUNK_PERF_DEBUG = false;
  return false;
}

export function recordChunkPerf(label, durationMs, details = {}, options = {}) {
  const scope = options.scope || globalThis;
  const config = getChunkPerfConfig(scope);
  if (!config.enabled) return false;

  const thresholdMs = Number.isFinite(options.thresholdMs)
    ? options.thresholdMs
    : config.thresholdMs;
  if (durationMs < thresholdMs) return false;

  const event = {
    label,
    durationMs,
    timestamp: globalThis.performance?.now?.() ?? Date.now(),
    details
  };
  if (!scope.__CHUNK_PERF_EVENTS) {
    scope.__CHUNK_PERF_EVENTS = [];
  }
  scope.__CHUNK_PERF_EVENTS.push(event);
  if (scope.__CHUNK_PERF_EVENTS.length > MAX_EVENT_HISTORY) {
    scope.__CHUNK_PERF_EVENTS.splice(0, scope.__CHUNK_PERF_EVENTS.length - MAX_EVENT_HISTORY);
  }

  const logger = options.logger || console.log;
  logger(`[ChunkPerf] ${label}: ${durationMs.toFixed(2)}ms`, {
    ...details,
    durationMs
  });
  return true;
}

export function getRecentChunkPerfEvents(maxAgeMs = 1000, scope = globalThis) {
  const events = scope?.__CHUNK_PERF_EVENTS || [];
  const now = globalThis.performance?.now?.() ?? Date.now();
  return events.filter((event) => now - event.timestamp <= maxAgeMs);
}

/**
 * 按 chunkKey 聚合最近的性能事件，生成单个 chunk 的装载耗时报告
 * @param {number} maxAgeMs - 时间窗口
 * @param {object} scope - globalThis
 * @returns {Map<string, object>} chunkKey -> 聚合报告
 */
export function aggregateChunkLoadPerf(maxAgeMs = 5000, scope = globalThis) {
  const events = getRecentChunkPerfEvents(maxAgeMs, scope);
  const byChunk = new Map();

  for (const event of events) {
    const chunkKey = event.details?.chunkKey;
    if (!chunkKey) continue;

    if (!byChunk.has(chunkKey)) {
      byChunk.set(chunkKey, {
        chunkKey,
        totalMs: 0,
        phases: {},
        blockCount: event.details.blockCount || event.details.blockDataSize || event.details.inputBlocks || 0,
        eventCount: 0,
        firstTimestamp: event.timestamp,
        lastTimestamp: event.timestamp
      });
    }

    const report = byChunk.get(chunkKey);
    report.eventCount++;
    report.lastTimestamp = event.timestamp;

    // 根据 label 识别阶段
    const label = event.label;
    report.phases[label] = {
      durationMs: event.durationMs,
      details: event.details
    };

    // 累加总耗时（只累加顶层事件，不重复加子阶段）
    const topLevelLabels = [
      'chunk.load-from-record',
      'chunk.accept-scattered-blocks',
      'chunk.append-scattered-blocks',
      'world.chunk-worker-result',
      'chunk-assembly.process',
      'chunk-assembly.task',
      'chunk.accept-worker-result',
      'chunk.build-meshes-global',
      'chunk.build-meshes',
      'chunk.consolidate-worker-callback',
      'chunk.apply-consolidate-result',
      // Memory authority 新指标
      'world.runtime-chunk-record-memory',
      'world.runtime-chunk-record-db',
      'world.runtime-chunk-record-db.error',
      'global-instanced-mesh.delta-patch',
      'global-instanced-mesh.patch-chunk',
      'global-instanced-mesh.flush-mutation'
    ];
    if (topLevelLabels.includes(label)) {
      report.totalMs += event.durationMs;
    }
  }

  return byChunk;
}

/**
 * 打印 chunk 装载性能聚合报告
 */
export function printChunkLoadPerfReport(maxAgeMs = 5000, scope = globalThis, logger = console.log) {
  const reports = aggregateChunkLoadPerf(maxAgeMs, scope);
  if (reports.size === 0) {
    logger('[ChunkPerf] No recent chunk load events found');
    return;
  }

  logger('=== Chunk Load Performance Report ===');
  for (const [key, report] of reports) {
    logger(`\n[Chunk ${key}] Total: ${report.totalMs.toFixed(2)}ms | ${report.blockCount} blocks | ${report.eventCount} events`);
    logger('  Phase breakdown:');
    for (const [phase, data] of Object.entries(report.phases)) {
      logger(`    ${phase}: ${data.durationMs.toFixed(2)}ms`);
    }
  }
  logger('=====================================\n');
}

/**
 * 帧级耗时监控：记录每帧中 chunk 相关操作的总耗时
 */
let _frameChunkPerfStart = 0;
let _frameChunkOperations = [];

export function startFrameChunkPerf() {
  _frameChunkPerfStart = globalThis.performance?.now?.() ?? Date.now();
  _frameChunkOperations = [];
}

export function markFrameChunkOp(label, durationMs, details = {}) {
  _frameChunkOperations.push({ label, durationMs, details });
}

export function endFrameChunkPerf(thresholdMs = 4) {
  const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - _frameChunkPerfStart;
  if (elapsed < thresholdMs) return;

  const totalChunkMs = _frameChunkOperations.reduce((sum, op) => sum + op.durationMs, 0);
  const report = {
    frameMs: elapsed,
    chunkTotalMs: totalChunkMs,
    chunkFraction: ((totalChunkMs / elapsed) * 100).toFixed(1) + '%',
    operations: {}
  };

  for (const op of _frameChunkOperations) {
    if (!report.operations[op.label]) {
      report.operations[op.label] = { count: 0, totalMs: 0 };
    }
    report.operations[op.label].count++;
    report.operations[op.label].totalMs += op.durationMs;
  }

  recordChunkPerf('frame.chunk-load-budget', elapsed, report);
}
