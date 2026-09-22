// Coordinate filtering only. Gesture rules and pinch confirmation stay in gestureEngine.js.
export const PRECISION_DEFAULTS = Object.freeze({
  pointerPrecision: "normal", adaptiveSmoothing: true, scrollSensitivity: "medium",
  dualHandUI: true, spatialDualPointer: true, magneticAimAssist: true, transformSensitivity: "medium",
  spatial3DTransformMode: "auto"
});
export function validatePrecisionPreferences(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, fallback] of Object.entries(PRECISION_DEFAULTS)) {
    const choices = key === "pointerPrecision" ? ["normal", "high"]
      : key === "spatial3DTransformMode" ? ["auto", "scale", "rotate", "free"]
      : ["low", "medium", "high"];
    result[key] = typeof fallback === "boolean" ? (typeof input[key] === "boolean" ? input[key] : fallback)
      : choices.includes(input[key]) ? input[key] : fallback;
  }
  return result;
}
export const PRECISION_TUNING = Object.freeze({
  // Cutoffs are Hz; beta is Hz per normalized-screen-unit/second.
  minCutoff: 1.6, highCutoff: 1.18, drawCutoff: 2.8,
  beta: 6.2, highBeta: 10.0, drawBeta: 8,
  derivativeCutoff: 1.8, maxGapMs: 260,
  deadzone: 0.0014, highDeadzone: 0.00315, drawDeadzone: 0.0006,
  releaseMs: 120, hoverMs: 85, hoverPadding: 7, trailLimit: 12,
  minimumGain: 0.70, highMinimumGain: 0.58, maximumGain: 1.14, highMaximumGain: 0.98,
  slowSpeed: 0.040, fastSpeed: 0.82, highFastSpeed: 0.58,
  renderTauMs: 18, renderMaxLag: 7.5
});
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * Math.max(0.01, cutoff) * dt));
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);

// Original implementation of Casiez/Roussel/Vogel's One Euro algorithm:
// filtered derivative -> speed-adaptive cutoff -> filtered value. Time is seconds.
export class OneEuroFilter {
  constructor() { this.reset(); }
  reset(value = null) { this.value = value; this.raw = value; this.derivative = 0; }
  update(value, seconds, { minCutoff = 1.6, beta = 5.5, derivativeCutoff = 1.8 } = {}) {
    if (this.value === null || !(seconds > 0)) { this.reset(value); return value; }
    const derivative = (value - this.raw) / seconds;
    this.derivative += alpha(derivativeCutoff, seconds) * (derivative - this.derivative);
    this.value += alpha(minCutoff + beta * Math.abs(this.derivative), seconds) * (value - this.value);
    this.raw = value;
    return this.value;
  }
}

// Reuses the former export name for the draw consumer; there is only ONE filter
// implementation. Normalized internal units make tuning independent of resolution.
export class AdaptivePointFilter {
  constructor() { this.x = new OneEuroFilter(); this.y = new OneEuroFilter(); this.reset(); }
  reset(point = null, now = null) {
    this.value = valid(point) ? { ...point } : null;
    this.previousRaw = this.value && { ...point }; this.lastAt = now;
    this.vx = this.vy = 0; this.pending = null; this.scale = null;
    this.x.reset(); this.y.reset();
    this.result = { point: this.value, dx: 0, dy: 0, speed: 0, speedPixels: 0,
      fastBlend: 0, deadzone: 0, outlierState: "NONE", reset: true, filterMode: "ONE EURO" };
  }
  update(point, now, { scale = 1000, high = false, adaptive = true, drawing = false,
    deadzoneScale = 1, responseScale = 1 } = {}) {
    if (!valid(point) || !Number.isFinite(now)) { this.reset(); return this.result; }
    scale = Math.max(1, scale);
    const ms = this.lastAt === null ? 0 : now - this.lastAt;
    if (!this.value || ms <= 0 || ms > PRECISION_TUNING.maxGapMs || (this.scale && this.scale !== scale)) {
      this.reset(point, now); this.scale = scale;
      this.x.reset(point.x / scale); this.y.reset(point.y / scale); return this.result;
    }
    this.scale = scale;
    if (this.x.value === null) { this.x.reset(this.previousRaw.x / scale); this.y.reset(this.previousRaw.y / scale); }
    const dt = ms / 1000, dx = point.x - this.previousRaw.x, dy = point.y - this.previousRaw.y;
    const travel = Math.hypot(dx, dy), priorSpeed = Math.hypot(this.vx, this.vy);
    // A single very large isolated sample is rejected. Sustained fast travel is
    // admitted on the next sample with a dt-aware cap, rather than frozen forever.
    const limit = scale * (0.04 + 3.8 * dt) + Math.min(priorSpeed, scale * 2.4) * dt * 0.32;
    let accepted = point, outlier = "NONE";
    if (travel > limit) {
      const continuing = this.pending && dx * this.pending.x + dy * this.pending.y > 0;
      if (!continuing && dt < 0.07 && travel > limit * 2 && priorSpeed < scale * 0.25) {
        accepted = this.previousRaw; outlier = "REJECTED";
      } else {
        accepted = { x: this.previousRaw.x + dx * limit / travel, y: this.previousRaw.y + dy * limit / travel };
        outlier = "CLAMPED";
      }
      this.pending = { x: dx, y: dy };
    } else this.pending = null;
    const baseCutoff = drawing ? PRECISION_TUNING.drawCutoff : high ? PRECISION_TUNING.highCutoff : PRECISION_TUNING.minCutoff;
    const baseBeta = drawing ? PRECISION_TUNING.drawBeta : high ? PRECISION_TUNING.highBeta : PRECISION_TUNING.beta;
    // At low camera FPS a legitimate fast movement arrives as a larger per-frame
    // step. Raise responsiveness from the raw trajectory BEFORE the filtered
    // derivative catches up; slow/still motion keeps the precision cutoffs.
    const rawSpeed = travel / Math.max(scale * dt, 1e-6);
    // High Precision should ignore micro-motion instead of treating every low-FPS
    // step as a fast gesture. Deliberate fast travel still unlocks a responsive
    // cutoff, but only after a higher normalized-speed threshold.
    const boostStart = high ? 0.38 : 0.22;
    const boostRange = high ? 1.15 : 1.05;
    const fastBoost = drawing ? 0 : clamp((rawSpeed - boostStart) / boostRange, 0, 1);
    responseScale = clamp(responseScale, 0.55, 1.15);
    deadzoneScale = clamp(deadzoneScale, 0.75, 2.4);
    const minCutoff = (baseCutoff + fastBoost * (high ? 2.0 : 1.35)) * responseScale;
    const beta = (baseBeta + fastBoost * (high ? 5.5 : 3.0)) * responseScale;
    const options = { minCutoff: adaptive ? minCutoff : 5, beta: adaptive ? beta : 0,
      derivativeCutoff: PRECISION_TUNING.derivativeCutoff };
    const filtered = { x: this.x.update(accepted.x / scale, dt, options) * scale,
      y: this.y.update(accepted.y / scale, dt, options) * scale };
    this.vx = this.x.derivative * scale; this.vy = this.y.derivative * scale;
    const speedPixels = Math.hypot(this.vx, this.vy), speed = speedPixels / scale;
    const radius = scale * (drawing ? PRECISION_TUNING.drawDeadzone : high ? PRECISION_TUNING.highDeadzone : PRECISION_TUNING.deadzone) * deadzoneScale;
    const fx = filtered.x - this.value.x, fy = filtered.y - this.value.y, length = Math.hypot(fx, fy);
    const weight = length > radius ? 1 - radius / length : 0;
    const movedX = fx * weight, movedY = fy * weight;
    this.value.x += movedX; this.value.y += movedY;
    this.previousRaw = { x: accepted.x, y: accepted.y }; this.lastAt = now;
    Object.assign(this.result, { point: this.value, dx: movedX, dy: movedY, speed, speedPixels,
      fastBlend: clamp((speed - PRECISION_TUNING.slowSpeed) /
        ((high ? PRECISION_TUNING.highFastSpeed : PRECISION_TUNING.fastSpeed) - PRECISION_TUNING.slowSpeed), 0, 1),
      deadzone: radius, outlierState: outlier, reset: false, filterMode: adaptive ? "ONE EURO" : "FIXED LOW PASS" });
    return this.result;
  }
}

// Session mapping: a comfortable region, softly increasing reach toward its edges.
// Input is deliberately UNCLAMPED. Only final cursor output is viewport-clamped;
// moving back inward therefore always works, even outside the camera control region.
export class PointerMapping {
  constructor() { this.reset(); }
  reset() {
    this.center = { x: 0.5, y: 0.48 }; this.width = 0.82; this.height = 0.70;
    this.calibrated = false; this.samples = 0;
    this.envelope = { minX: 0.28, maxX: 0.72, minY: 0.25, maxY: 0.71 };
  }
  calibrate(point) {
    if (!valid(point)) return false;
    this.center = { x: clamp(point.x, 0.25, 0.75), y: clamp(point.y, 0.30, 0.62) };
    this.envelope = { minX: this.center.x - 0.22, maxX: this.center.x + 0.22,
      minY: this.center.y - 0.21, maxY: this.center.y + 0.21 };
    this.width = 0.82; this.height = 0.70;
    this.samples = 0; this.calibrated = true; return true;
  }
  observe(point, canLearn = true) {
    if (!valid(point) || !canLearn) return;
    this.samples += 1;
    const e = this.envelope;
    const learn = this.samples < 80 ? 0.06 : 0.012;
    if (point.x < e.minX) e.minX += (point.x - e.minX) * learn;
    if (point.x > e.maxX) e.maxX += (point.x - e.maxX) * learn;
    if (point.y < e.minY) e.minY += (point.y - e.minY) * learn;
    if (point.y > e.maxY) e.maxY += (point.y - e.maxY) * learn;
    // Learn the user's reachable envelope without continuously moving the
    // pointer center under their hand. Auto-calibration may only EXPAND the
    // active region, which lowers sensitivity; it never shrinks the region and
    // therefore never amplifies small hand jitter into large cursor motion.
    if (this.samples >= 20) {
      const targetWidth = clamp((e.maxX - e.minX) * 1.60, 0.82, 0.92);
      const targetHeight = clamp((e.maxY - e.minY) * 1.70, 0.70, 0.86);
      const a = this.samples < 80 ? 0.010 : 0.0025;
      if (targetWidth > this.width) this.width += (targetWidth - this.width) * a;
      if (targetHeight > this.height) this.height += (targetHeight - this.height) * a;
      this.calibrated = true;
    }
  }
  map(point, bounds) {
    // Keep the edge curve restrained. Pointer filtering already accelerates
    // deliberate fast travel, so a strong spatial edge boost makes micro-motion
    // feel exaggerated.
    const edge = value => value + 0.045 * value * Math.min(Math.abs(value) / 0.5, 1);
    return { x: bounds.left + (0.5 + edge((point.x - this.center.x) / this.width)) * bounds.width,
      y: bounds.top + (0.5 + edge((point.y - this.center.y) / this.height)) * bounds.height };
  }
}
