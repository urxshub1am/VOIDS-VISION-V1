import { SIGNAL_TUNING } from "./interactionSignals.js";
import { AdaptivePointFilter, PointerMapping, PRECISION_TUNING } from "./precision.js";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// A single common implementation, instantiated by InteractionEngine once per
// persistent hand ID. This object filters/aims; it cannot click or own a mode.
export function createHandPointer({ handId, state, ui }) {
  const filter = new AdaptivePointFilter(), mapping = new PointerMapping();
  const hover = ui.createStableHover(PRECISION_TUNING.hoverMs, PRECISION_TUNING.hoverPadding);
  const data = {
    handId, raw: null, filtered: null, rendered: null, velocity: { x: 0, y: 0 }, gain: 1, speed: 0,
    hoverTarget: null, capturedTarget: null, captureKind: null, owner: null, intent: "IDLE",
    pinchRaw: false, pinchConfirmed: false, pinchProgress: 0, gesture: "UNKNOWN",
    visible: false, lastSeenAt: null, trackingState: "LOST", outlierState: "NONE",
    filterMode: "ONE EURO", calibration: "SAFE DEFAULT", armed: false, trail: [], role: null
  };
  let target = null, releaseSince = null, boundsKey = null, scope = null, lastTip = null;
  let active = false, lastRender = null, pinchedAt = null, releasedAt = null, previousPinch = false;
  function disarm() { data.armed = false; releaseSince = null; hover.clear(); target = null; data.hoverTarget = null; }
  function lose() {
    active = false; data.visible = false; data.trackingState = "LOST"; data.pinchRaw = data.pinchConfirmed = false;
    data.trail.length = 0; filter.reset(); disarm();
  }
  function recalibrate() {
    if (!lastTip || data.captureKind) return false;
    mapping.calibrate(lastTip); data.calibration = "SESSION REBASED";
    filter.reset(mapping.map(lastTip, ui.viewportBounds()), data.lastSeenAt); disarm(); return true;
  }
  function update(hand, now, { captured = false, drawing = false, reduced = false } = {}) {
    const bounds = ui.viewportBounds(), currentScope = ui.pointerScope();
    const key = [bounds.left, bounds.top, bounds.width, bounds.height].join(":");
    const tip = hand.geometry.viewIndexTip;
    if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) { lose(); return; }
    lastTip = tip;
    const raw = mapping.map(tip, bounds), rawPinch = Boolean(hand.interactionPinch?.on);
    const gap = data.lastSeenAt !== null && now - data.lastSeenAt > SIGNAL_TUNING.graceMs;
    if (!active || key !== boundsKey || currentScope !== scope || gap) {
      disarm(); filter.reset(raw, now);
      if (!data.filtered) data.filtered = ui.clampPoint(raw, bounds);
      else data.filtered = ui.clampPoint(data.filtered, bounds);
      data.rendered = { ...data.filtered }; data.trail.length = 0; previousPinch = rawPinch;
    }
    active = true; boundsKey = key; scope = currentScope;
    if (rawPinch) releaseSince = null;
    else if (releaseSince === null) releaseSince = now;
    if (!captured && !rawPinch && hand.geometry.extension.index >= 0.45 &&
        releaseSince !== null && now - releaseSince >= PRECISION_TUNING.releaseMs) data.armed = true;
    if (rawPinch && !previousPinch) { pinchedAt = now; releasedAt = null; }
    if (!rawPinch && previousPinch) releasedAt = now;
    if (!rawPinch) pinchedAt = null;
    // Closing/opening the index finger changes its landmark even with a still
    // palm. Rebase that short convergence, not just its visible delta: otherwise
    // residual filter motion can misread a click as a drag or jump on release.
    const settling = (rawPinch && !captured && pinchedAt !== null && now - pinchedAt < 65) ||
      (!rawPinch && releasedAt !== null && now - releasedAt < 65);
    if (settling) filter.reset(raw, now);
    const result = filter.update(raw, now, { scale: Math.min(bounds.width, bounds.height),
      high: state.settings.pointerPrecision === "high", adaptive: state.settings.adaptiveSmoothing !== false, drawing });
    const minimum = state.settings.pointerPrecision === "high" ? PRECISION_TUNING.highMinimumGain : PRECISION_TUNING.minimumGain;
    const gain = drawing || captured ? 1 : minimum + (PRECISION_TUNING.maximumGain - minimum) * result.fastBlend;
    if (!settling && !result.reset) data.filtered = ui.clampPoint({
      x: data.filtered.x + result.dx * gain, y: data.filtered.y + result.dy * gain }, bounds);
    if (!captured && !rawPinch) target = hover.update(data.filtered, now, scope, state.settings.magneticAimAssist !== false);
    data.hoverTarget = ui.targetLabel(target);
    Object.assign(data, { raw: { ...raw }, speed: result.speedPixels, velocity: { x: filter.vx, y: filter.vy }, gain,
      visible: true, lastSeenAt: now, trackingState: hand.tracking.state, gesture: hand.gesture.raw,
      pinchRaw: rawPinch, pinchConfirmed: Boolean(hand.pinch.confirmed),
      pinchProgress: Math.min(1, (hand.interactionPinch?.stableMs || 0) / (hand.interactionPinch?.requiredMs || SIGNAL_TUNING.uiMs)),
      outlierState: result.outlierState, filterMode: result.filterMode });
    if (!captured && !rawPinch && (!data.trail.length || Math.hypot(data.filtered.x - data.trail.at(-1).x, data.filtered.y - data.trail.at(-1).y) > 0.6)) data.trail.push({ ...data.filtered });
    while (data.trail.length > (reduced ? 3 : PRECISION_TUNING.trailLimit)) data.trail.shift();
    if (captured || rawPinch || !state.settings.showTrail) data.trail.length = 0;
    previousPinch = rawPinch;
  }
  function render(now) {
    const dt = lastRender === null ? 16 : clamp(now - lastRender, 0, 50); lastRender = now;
    if (!data.filtered || !data.visible) return data;
    if (!data.rendered) data.rendered = { ...data.filtered };
    const dx = data.filtered.x - data.rendered.x, dy = data.filtered.y - data.rendered.y;
    const distance = Math.hypot(dx, dy), alpha = 1 - Math.exp(-dt / PRECISION_TUNING.renderTauMs);
    const amount = Math.max(alpha, distance ? 1 - PRECISION_TUNING.renderMaxLag / distance : 1);
    data.rendered.x += dx * amount; data.rendered.y += dy * amount;
    return data;
  }
  return { data, update, render, lose, disarm, recalibrate, get target() { return target; } };
}

// Home/Pointer behavior only. Selection is owned centrally, never duplicated here.
export function createPointerMode({ state, ui, action }) {
  const data = state.runtime.modeData.pointer = { status: "INDEX ONLY · aim with either hand", practiceHits: 0 };
  return {
    render() {
      const pointers = Object.values(state.runtime.handPointers || {}).filter(p => p.visible);
      data.status = state.runtime.paused ? "POINTER PAUSED" : pointers.map(p => p.handId + " · " + p.intent.replaceAll("_", " ")).join(" / ") || "INDEX ONLY · aim with either hand";
      ui.setText("pointer-mode-status", data.status);
    },
    onAction(name) {
      if (name !== "pointer-practice") return false;
      ui.setText("pointer-practice-count", ++data.practiceHits); action("POINTER PRACTICE → SELECT"); return true;
    }
  };
}
