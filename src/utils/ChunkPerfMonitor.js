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
