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
    filterMode: "ONE EURO", calibration: "SAFE DEFAULT", armed: false, trail: [], role: null,
    motionConfidence: 0, poseConfidence: 0, acceleration: { x: 0, y: 0 }, direction: "STILL",
    movementConsistency: 0, trackingQuality: "POOR", mapping: null, pointerError: 0
  };
  let target = null, releaseSince = null, boundsKey = null, scope = null, lastTip = null;
  let active = false, lastRender = null, pinchedAt = null, releasedAt = null, previousPinch = false;
  // Fingertip landmarks are the noisiest part of an otherwise stable hand. Keep
  // a slowly learned index-to-palm offset so quiet aiming follows the much more
  // stable palm translation, while deliberate finger motion can still retarget.
  let aimOffset = null, aimPalm = null, aimAt = null, aimFreezeUntil = 0, sampleFps = 30;
  function disarm() { data.armed = false; releaseSince = null; hover.clear(); target = null; data.hoverTarget = null; }
  function lose() {
    active = false; data.visible = false; data.trackingState = "LOST"; data.pinchRaw = data.pinchConfirmed = false;
    data.trail.length = 0; filter.reset(); aimOffset = aimPalm = null; aimAt = null; aimFreezeUntil = 0; disarm();
  }
  function stabilizeTip(hand, tip, now, { drawing = false, captured = false, rawPinch = false, highPrecision = false } = {}) {
    const palm = hand?.geometry?.viewCenter;
    if (drawing || !palm || !Number.isFinite(palm.x) || !Number.isFinite(palm.y)) return tip;
    const relative = { x: tip.x - palm.x, y: tip.y - palm.y };
    if (!aimOffset || !aimPalm || !Number.isFinite(aimAt) || now <= aimAt || now - aimAt > 420) {
      aimOffset = { ...relative }; aimPalm = { ...palm }; aimAt = now; return tip;
    }
    const dtMs = Math.max(1, Math.min(180, now - aimAt));
    const relativeChange = Math.hypot(relative.x - aimOffset.x, relative.y - aimOffset.y);
    const palmChange = Math.hypot(palm.x - aimPalm.x, palm.y - aimPalm.y);
    const lowFpsBlend = clamp((18 - sampleFps) / 10, 0, 1);
    // While pinching/grabbing, FREEZE the learned fingertip offset and let the
    // palm drive the pointer. Updating the offset during a pinch slowly learns
    // the folded finger pose and re-introduces the very click/drag jump this
    // stabilizer is meant to remove.
    const releaseSettling = !rawPinch && (now < aimFreezeUntil || (hand?.geometry?.extension?.index ?? 1) < 0.68);
    if (!(rawPinch || captured || releaseSettling)) {
      let tauMs = highPrecision ? 105 + lowFpsBlend * 75 : 72 + lowFpsBlend * 45;
      // A clearly intentional relative finger change should not feel locked.
      if (relativeChange > 0.035 && relativeChange > palmChange * 1.25) tauMs *= 0.36;
      const a = 1 - Math.exp(-dtMs / Math.max(24, tauMs));
      aimOffset.x += (relative.x - aimOffset.x) * a;
      aimOffset.y += (relative.y - aimOffset.y) * a;
    }
    aimPalm = { ...palm }; aimAt = now;
    const stabilized = { x: palm.x + aimOffset.x, y: palm.y + aimOffset.y };
    const blend = rawPinch || captured ? 1 : highPrecision ? 0.60 + lowFpsBlend * 0.16 : 0.34 + lowFpsBlend * 0.10;
    return { x: tip.x + (stabilized.x - tip.x) * blend, y: tip.y + (stabilized.y - tip.y) * blend };
  }
  function recalibrate() {
    if (!lastTip || data.captureKind) return false;
    mapping.calibrate(lastTip); data.calibration = "SESSION REBASED";
    aimOffset = aimPalm = null; aimAt = null; aimFreezeUntil = 0; filter.reset(mapping.map(lastTip, ui.viewportBounds()), data.lastSeenAt); disarm(); return true;
  }
  function update(hand, now, { captured = false, drawing = false, reduced = false } = {}) {
    const bounds = ui.viewportBounds(), currentScope = ui.pointerScope();
    const key = [bounds.left, bounds.top, bounds.width, bounds.height].join(":");
    const tip = hand.geometry.viewIndexTip;
    if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) { lose(); return; }
    lastTip = tip;
    const rawPinch = Boolean(hand.interactionPinch?.on);
    const inferenceInterval = state.performance?.profile?.inferenceIntervalMs;
    const instantFps = Number.isFinite(inferenceInterval) && inferenceInterval > 0 ? 1000 / inferenceInterval
      : Number.isFinite(state.performance?.fps) ? state.performance.fps : 30;
    // Frame intervals on webcams are bursty. Smooth the tuning input itself so
    // the filter does not alternate between "low FPS" and "normal" behavior.
    sampleFps = clamp(sampleFps * 0.72 + clamp(instantFps, 4, 60) * 0.28, 4, 60);
    const highPrecision = state.settings.pointerPrecision === "high";
    if (rawPinch !== previousPinch) aimFreezeUntil = now + (rawPinch ? 140 : 360);
    const aimTip = stabilizeTip(hand, tip, now, { drawing, captured, rawPinch, highPrecision });
    mapping.observe(aimTip, !captured && !rawPinch && hand.tracking?.state === "TRACKING");
    const raw = mapping.map(aimTip, bounds);
    const adaptivePointerGrace = Math.max(SIGNAL_TUNING.graceMs,
      Number.isFinite(inferenceInterval) ? Math.min(520, inferenceInterval * 2.8) : SIGNAL_TUNING.graceMs);
    const gap = data.lastSeenAt !== null && now - data.lastSeenAt > adaptivePointerGrace;
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
    const fps = sampleFps;
    // V1.5.3 used a large low-FPS deadzone to suppress jitter. It was stable but
    // could feel sticky: motion accumulated, then jumped. Palm-relative aim now
    // handles most micro-jitter, so keep a smaller deadzone and more response.
    const lowFpsBlend = clamp((18 - fps) / 10, 0, 1);
    const deadzoneScale = 1 + lowFpsBlend * (highPrecision ? 0.34 : 0.26);
    const responseScale = 1 - lowFpsBlend * (highPrecision ? 0.11 : 0.08);
    const result = filter.update(raw, now, { scale: Math.min(bounds.width, bounds.height),
      high: highPrecision, adaptive: state.settings.adaptiveSmoothing !== false, drawing,
      deadzoneScale: drawing ? 1 : deadzoneScale, responseScale: drawing ? 1 : responseScale });
    const minimum = highPrecision ? PRECISION_TUNING.highMinimumGain : PRECISION_TUNING.minimumGain;
    const maximum = highPrecision ? PRECISION_TUNING.highMaximumGain : PRECISION_TUNING.maximumGain;
    // Precision mode must never amplify motion. Slow/micro movement receives a
    // stronger attenuation, while deliberate fast travel approaches 1:1.
    const lowFpsQuietGain = 1 - lowFpsBlend * (highPrecision ? 0.09 : 0.06) * (1 - result.fastBlend);
    const gain = drawing || captured ? 1 : (minimum + (maximum - minimum) * result.fastBlend) * lowFpsQuietGain;
    if (!settling && !result.reset) data.filtered = ui.clampPoint({
      x: data.filtered.x + result.dx * gain, y: data.filtered.y + result.dy * gain }, bounds);
    if (!captured && !rawPinch) {
      const hoverPoint = data.rendered || data.filtered;
      target = hover.update(hoverPoint, now, scope, state.settings.magneticAimAssist !== false);
    }
    data.hoverTarget = ui.targetLabel(target);
    Object.assign(data, { raw: { ...raw }, speed: result.speedPixels, velocity: { x: filter.vx, y: filter.vy }, gain,
      visible: true, lastSeenAt: now, trackingState: hand.tracking.state, gesture: hand.gesture.raw,
      pinchRaw: rawPinch, pinchConfirmed: Boolean(hand.pinch.confirmed),
      pinchProgress: Math.min(1, (hand.interactionPinch?.stableMs || 0) / (hand.interactionPinch?.requiredMs || SIGNAL_TUNING.uiMs)),
      outlierState: result.outlierState, filterMode: result.filterMode,
      motionConfidence: hand.motionState?.motionConfidence || 0,
      poseConfidence: hand.motionState?.poseConfidence || 0,
      acceleration: hand.motionState?.acceleration || { x: 0, y: 0 },
      direction: hand.motionState?.direction || "STILL",
      movementConsistency: hand.motionState?.movementConsistency || 0,
      trackingQuality: hand.motionState?.trackingQuality || "POOR",
      mapping: { center: { ...mapping.center }, width: mapping.width, height: mapping.height, samples: mapping.samples },
      sampleFps: fps,
      pointerError: data.rendered ? Math.hypot(data.filtered.x - data.rendered.x, data.filtered.y - data.rendered.y) : 0 });
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
    const distance = Math.hypot(dx, dy);
    const lowFpsBlend = clamp((18 - (Number.isFinite(data.sampleFps) ? data.sampleFps : 30)) / 10, 0, 1);
    // Resample chunky camera updates across display frames. The lag budget stays
    // bounded and collapses during pinch/capture so the visible cursor and the
    // interaction point cannot drift apart during an action.
    const actionLocked = data.pinchRaw || Boolean(data.captureKind);
    const maxLag = actionLocked ? 2.5 : PRECISION_TUNING.renderMaxLag + lowFpsBlend * 8.5;
    const tauMs = actionLocked ? 8 : PRECISION_TUNING.renderTauMs + lowFpsBlend * 24;
    if (distance <= maxLag) {
      const a = 1 - Math.exp(-dt / Math.max(4, tauMs));
      data.rendered.x += dx * a;
      data.rendered.y += dy * a;
    } else {
      // Do not visibly trail far behind a deliberate fast hand movement.
      const retain = Math.min(0.35, maxLag / Math.max(distance, 1));
      data.rendered.x = data.filtered.x - dx * retain;
      data.rendered.y = data.filtered.y - dy * retain;
    }
    data.pointerError = Math.hypot(data.filtered.x - data.rendered.x, data.filtered.y - data.rendered.y);
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
