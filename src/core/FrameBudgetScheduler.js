export class FrameBudgetScheduler {
  constructor(options = {}) {
    this.targetFps = options.targetFps || 100;
    this.targetFrameMs = 1000 / this.targetFps;
    this.safetyMarginMs = options.safetyMarginMs || 2;
    this.frameStart = 0;
    this.frameDeadline = 0;
  }

  beginFrame() {
    this.frameStart = globalThis.performance?.now?.() ?? Date.now();
    this.frameDeadline = this.frameStart + this.targetFrameMs - this.safetyMarginMs;
  }

  getRemainingMs() {
    const now = globalThis.performance?.now?.() ?? Date.now();
    return Math.max(0, this.frameDeadline - now);
  }

  hasTimeFor(estimatedMs) {
    return this.getRemainingMs() >= estimatedMs;
  }
}
