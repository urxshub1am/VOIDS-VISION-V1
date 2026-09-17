import { createInteractionPinch, createSwipeIntent, SIGNAL_TUNING } from "./interactionSignals.js";
import { createHandPointer } from "./pointerMode.js";
import { createGestureScroll, SCROLL_TUNING } from "./gestureScroll.js";
import { PRECISION_TUNING } from "./precision.js";

// Gesture detection is evidence. Only this arbiter grants permission to act.
export const MODE_PERMISSIONS = Object.freeze({
  home: Object.freeze(["pointer", "click", "scroll", "pause"]),
  pointer: Object.freeze(["pointer", "click", "scroll", "pause"]),
  "air-draw": Object.freeze(["pointer", "click", "scroll", "draw", "pause", "tools"]),
  presentation: Object.freeze(["pointer", "click", "laser", "swipe", "confirm", "pause"]),
  "gesture-lab": Object.freeze(["pointer", "click", "scroll", "diagnostics"]),
  challenge: Object.freeze(["pointer", "click", "game"]),
  spatial: Object.freeze(["pointer", "click", "scroll", "object", "transform", "workspace", "pause"]),
  settings: Object.freeze(["pointer", "click", "scroll"])
});
export const INTERACTION_TUNING = Object.freeze({ clickMotion: 16, sameTargetMs: 300 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const activePinch = h => Boolean(h?.interactionPinch?.surfaceReady);
export function validInteractionHand(hand, now) {
  return Boolean(hand?.geometry?.viewIndexTip && hand.tracking?.visible &&
    hand.tracking.state === "TRACKING" && !hand.tracking.ambiguous && Number.isFinite(hand.tracking.lastSeenAt) &&
    now >= hand.tracking.lastSeenAt && now - hand.tracking.lastSeenAt <= SIGNAL_TUNING.graceMs);
}

export function createInteractionEngine(context) {
  const { state, ui, action, pause } = context;
  const inputs = new Map(), captures = new Map(), activated = new WeakMap();
  const scroll = createGestureScroll(context);
  const data = state.runtime.interaction = { mode: state.currentMode, allowed: [], laserOwner: null,
    swipeOwner: null, drawOwner: null, gameOwner: null, activeScrollTargets: [], lastActivationHandId: null };
  state.runtime.handPointers = {};
  let modes = {}, epoch = 0, scope = null, scopeMode = null, enabledBefore = false;
  let frameNow = 0, renderStart = 0, renderFrames = 0;
  let laserId = null, lastSwipeAt = -Infinity;
  const controller = () => modes[state.currentMode];
  const effectiveMode = () => ui.isModalOpen() ? "settings" : state.currentMode;
  const enabled = () => state.runtime.gesturesEnabled && !state.runtime.paused &&
    !state.runtime.backgrounded && !document.hidden && !state.runtime.error && !state.runtime.gestureError && state.readiness.trackerReady;
  const pointers = () => Object.values(state.runtime.handPointers);
  const handAt = id => state.hands.find(h => h.id === id);
  function inGrace(id, now) {
    const input = inputs.get(id), hand = handAt(id);
    return Boolean(input?.lastGood && hand && !hand.tracking.ambiguous && hand.tracking.state !== "LOST" &&
      now - input.lastGood.tracking.lastSeenAt <= SIGNAL_TUNING.graceMs);
  }
  function trustedHand(id, now) { return validInteractionHand(handAt(id), now) ? handAt(id) : inGrace(id, now) ? inputs.get(id).lastGood : null; }
  const note = (message) => (context.interactionEvent || action)(message);

  function permissions() {
    let list = MODE_PERMISSIONS[effectiveMode()] || [];
    if (state.runtime.handUI && state.currentMode === "air-draw") list = MODE_PERMISSIONS.settings;
    if (effectiveMode() === "air-draw" && data.drawOwner) list = list.filter(x => x !== "scroll");
    data.mode = effectiveMode(); data.allowed = [...list]; return list;
  }
  const permits = name => permissions().includes(name);
  function expose(id) {
    const input = inputs.get(id); if (!input) return;
    const c = captures.get(id), p = input.pointer.data;
    p.captureKind = c?.kind || null; p.capturedTarget = c?.label || null; p.owner = c?.owner || null;
    p.interactionPinch = input.pinch.data;
    p.swipeIntent = input.swipe.data;
    p.latchedTarget = c?.target ? c.label : null;
    p.latchAge = c ? Math.max(0, frameNow - c.startedAt) : 0;
    p.clickCandidate = Boolean(c && ["PINCH_ARMING", "CLICK_CAPTURE"].includes(c.kind) && !c.surface);
    p.cooldownRemaining = Math.max(0, input.lastActivation + SIGNAL_TUNING.clickCooldownMs - frameNow);
    p.intent = !p.visible ? "IDLE" : state.runtime.paused ? "PAUSED" : c?.kind || (p.hoverTarget ? "HOVER" : "AIM");
  }
  function release(id, reason = "RELEASED", notifyOwner = true) {
    const c = captures.get(id); if (!c) return;
    captures.delete(id); // Clear before a mode callback can reenter cancellation.
    if (c.kind === "SCROLL_CAPTURE") scroll.end(id);
    if (c.owner === "air-draw") { data.drawOwner = null; if (notifyOwner) modes["air-draw"].endPointer?.(id, reason); }
    if (c.owner === "spatial" && notifyOwner) modes.spatial.endPointer?.(id, reason);
    if (c.owner === "presentation") { data.swipeOwner = null;  }
    if (c.owner === "challenge") data.gameOwner = null;
    inputs.get(id)?.pointer.disarm();
    if (reason !== "RELEASED" && c.owner === "ui") note("PINCH CANCELLED · " + id + " · " + reason);
    expose(id);
    data.activeScrollTargets = Object.values(state.runtime.scroll.hands).map(x => x.target);
  }
  function cancelHand(id, reason = "TRACKING_LOST") {
    release(id, reason); const input = inputs.get(id);
    if (input) { input.pointer.lose(); input.pinch.reset(); input.swipe.reset("TRACKING_LOST"); input.lastGood = null; input.lastTarget = null; input.wasPinching = true; }
    if (laserId === id) { laserId = null; data.laserOwner = null; }
    expose(id);
  }
  function cancel(reason = "CANCELLED") {
    epoch++;
    for (const id of [...captures.keys()]) release(id, reason);
    for (const input of inputs.values()) { input.pointer.disarm(); input.pinch.reset(); input.swipe.reset(); input.lastGood = null; input.lastTarget = null; input.wasPinching = true; }
    laserId = data.laserOwner = data.drawOwner = data.swipeOwner = data.gameOwner = null;
    scroll.cancel(); ui.setHandHovers([]); ui.renderHandPointers(null);
  }
  function claim(id, kind, owner, label, { pending = false } = {}) {
    const input = inputs.get(id), old = captures.get(id);
    if (!enabled() || !input?.pointer.data.visible || !validInteractionHand(handAt(id), frameNow)) return false;
    if (old && old.owner !== owner && !(pending && old.kind === "PINCH_ARMING" && old.surface === "spatial")) return false;
    if (owner === "spatial" && !permits("object")) return false;
    const c = old || { start: { ...input.pointer.data.filtered }, startedAt: frameNow };
    Object.assign(c, { kind, owner, label, mode: effectiveMode(), scope: ui.pointerScope() });
    captures.set(id, c); expose(id); return true;
  }
  function claimPair(ids, kind, label) {
    if (ids.length !== 2 || ids[0] === ids[1] || !permits("workspace") || state.settings.dualHandUI === false) return false;
    for (const id of ids) {
      const c = captures.get(id), p = inputs.get(id)?.pointer.data;
      if (!p?.armed || !p.visible || !validInteractionHand(handAt(id), frameNow)) return false;
      if (c && !(c.owner === "spatial" && c.surface === "workspace") &&
          !(c.kind === "PINCH_ARMING" && c.surface === "spatial" && c.special === "workspace")) return false;
    }
    for (const id of ids) claim(id, kind, "spatial", label, { pending: true });
    return true;
  }
  function activate(input, capture) {
    const target = capture.target, now = frameNow, id = input.pointer.data.handId;
    if (!capture.ready || capture.moved > (capture.panel ? INTERACTION_TUNING.clickMotion : SIGNAL_TUNING.latchRadius) || !target?.isConnected ||
        !ui.boundsUnchanged(target, capture.bounds) || !ui.targetAtPoint(target, capture.start, capture.scope, PRECISION_TUNING.hoverPadding)) return;
    if (now - input.lastActivation < (capture.critical ? state.settings.clickCooldownMs : SIGNAL_TUNING.clickCooldownMs)) return;
    const previous = activated.get(target);
    if (previous && previous.id !== id && now - previous.at < INTERACTION_TUNING.sameTargetMs) return;
    activated.set(target, { id, at: now }); input.lastActivation = now;
    data.lastActivationHandId = id;
    if (context.activate(target, capture.start, capture.scope, { padding: PRECISION_TUNING.hoverPadding, handId: id })) action("CLICK CONFIRMED · " + id);
  }
  function beginCandidate(input, hand, now) {
    const p = input.pointer.data, target = input.pointer.target;
    if (!p.armed || !permits("click")) return;
    const hit = ui.hitTarget(p.filtered.x, p.filtered.y, ui.pointerScope());
    // A target must have been acquired before pinching. Empty panel space can
    // capture scroll; it cannot synthesize a button click under a moving cursor.
    const recent = input.lastTarget && now - input.targetSeenAt <= SIGNAL_TUNING.latchMs &&
      distance(p.filtered, input.targetPoint) <= SIGNAL_TUNING.latchRadius;
    const selected = recent && ui.targetAtPoint(input.lastTarget, input.targetPoint, ui.pointerScope(), PRECISION_TUNING.hoverPadding)
      ? input.lastTarget : target && ui.targetAtPoint(target, p.filtered, ui.pointerScope(), PRECISION_TUNING.hoverPadding) ? target : null;
    const clickPoint = selected && selected === input.lastTarget ? input.targetPoint : p.filtered;
    const surface = effectiveMode() === "spatial" && ui.element("spatial-surface").contains(hit)
      ? "spatial" : effectiveMode() === "air-draw" && !state.runtime.handUI && ui.pointInside(p.filtered, ui.element("draw-surface")) ? "draw" : null;
    let special = null;
    if (surface === "spatial") special = modes.spatial.captureTarget(hand.id, selected || hit, p.filtered);
    if (special === "blocked" || special === "object" && !selected) { input.pointer.disarm(); return; }
    const panel = !surface && permits("scroll") ? ui.resolveScrollTarget(effectiveMode(), p.filtered, selected) : null;
    if (!selected && !surface && !panel) return;
    captures.set(hand.id, { kind: "PINCH_ARMING", owner: "ui", label: ui.targetLabel(selected) || (panel ? ui.scrollLabel(panel) : surface),
      target: selected || (surface ? hit : null), bounds: selected ? ui.targetBounds(selected) : null,
      start: { ...clickPoint }, motionStart: { ...p.filtered }, palmStart: { ...hand.geometry.viewCenter }, startedAt: now, mode: effectiveMode(), scope: ui.pointerScope(),
      panel, rail: Boolean(panel && ui.scrollRailTarget?.(p.filtered) === panel), surface, special, ready: false, moved: 0, critical: ui.isCriticalTarget(selected) });
  }
  function updatePinch(input, hand, now) {
    const p = input.pointer.data, id = hand.id;
    let c = captures.get(id);
    if (c && c.kind !== "SWIPE_CAPTURE" && c.kind !== "GAME_CAPTURE" && !hand.interactionPinch.on) {
      const origin = c.motionStart || c.start;
      c.moved = Math.max(c.moved || 0, distance(p.filtered, origin));
      const dx = p.filtered.x - origin.x, dy = p.filtered.y - origin.y;
      const releasedDrag = c.panel && Math.abs(dy) >= SCROLL_TUNING.dragPixels && Math.abs(dy) > Math.abs(dx) * SCROLL_TUNING.verticalRatio;
      const click = hand.interactionPinch.normalizedDistance > SIGNAL_TUNING.exit &&
        (!c.palmStart || distance(hand.geometry.viewCenter, c.palmStart) <= 0.06) && !releasedDrag && (c.kind === "PINCH_ARMING" || c.kind === "CLICK_CAPTURE");
      release(id); if (click) activate(input, c); return;
    }
    if (!c && hand.interactionPinch.on && !input.wasPinching) { beginCandidate(input, hand, now); c = captures.get(id); }
    if (!c) return;
    if (c.scope !== ui.pointerScope() || c.mode !== effectiveMode()) { release(id, "CONTEXT_CHANGED"); return; }
    if (c.kind === "SCROLL_CAPTURE") { if (!scroll.update(id, p.filtered, now)) release(id, "TARGET_LOST"); return; }
    if (c.kind === "DRAW_CAPTURE") { modes["air-draw"].movePointer(id, p.filtered, now); return; }
    if (c.owner === "spatial" || c.kind === "SWIPE_CAPTURE" || c.kind === "GAME_CAPTURE") return;
    if (c.kind !== "PINCH_ARMING" && c.kind !== "CLICK_CAPTURE") return;
    c.moved = Math.max(c.moved, distance(p.filtered, c.motionStart || c.start));
    c.ready ||= p.outlierState === "NONE" && Boolean(c.critical ? hand.pinch.confirmed : hand.interactionPinch.interactionPinch);
    if (c.surface) {
      if (now - c.startedAt > 2000 || c.moved > SIGNAL_TUNING.latchRadius && c.special === "object") { release(id, "SURFACE_TARGET_LEFT"); return; }
      if (!(c.special === "manipulator" ? hand.interactionPinch.on : activePinch(hand)) || p.outlierState !== "NONE") return;
      if (c.surface === "draw") {
        if (data.drawOwner || !permits("draw")) { release(id, "DRAW_BUSY"); return; }
        c.owner = "air-draw"; c.kind = "DRAW_CAPTURE"; data.drawOwner = id;
        if (!modes["air-draw"].beginPointer(id, p.filtered, now)) release(id, "DRAW_UNAVAILABLE");
      } else {
        if (c.special === "manipulator") {
          c.kind = "TRANSFORM_CAPTURE"; c.owner = "spatial";
        } else {
          c.owner = "spatial"; c.kind = "OBJECT_CAPTURE";
          if (c.special === "workspace") c.surface = "workspace";
          const result = modes.spatial.beginPointer(c.target, p.filtered, { handId: id, at: now });
          if (result === "reject") release(id, "TARGET_LOST");
        }
      }
      expose(id); return;
    }
    if (now - c.startedAt > 2000) { release(id, "TIMEOUT"); return; }
    const origin = c.motionStart || c.start;
    const dx = p.filtered.x - origin.x, dy = p.filtered.y - origin.y;
    if (c.panel && c.ready && (c.rail || Math.abs(dy) >= SCROLL_TUNING.dragPixels && Math.abs(dy) > Math.abs(dx) * SCROLL_TUNING.verticalRatio)) {
      if (!permits("scroll")) { release(id, "SCROLL_NOT_ALLOWED"); return; }
      if (!scroll.begin(id, c.panel, p.filtered, now)) { release(id, "PANEL_BUSY"); return; }
      c.kind = "SCROLL_CAPTURE"; c.owner = "scroll"; c.label = ui.scrollLabel(c.panel); c.target = null;
      expose(id); return;
    }
    if (c.moved > SIGNAL_TUNING.latchRadius) { release(id, "LEFT_TARGET"); return; }
    if (c.ready && c.kind !== "CLICK_CAPTURE") { c.kind = "CLICK_CAPTURE"; note("CLICK CAPTURE · " + id); }
  }
  function updateSwipe(input, hand, now) {
    if (permits("diagnostics")) { input.swipe.update(hand, now, state.camera.height / state.camera.width || 0.75); return; }
    if (!permits("swipe") || !state.runtime.modeData.presentation?.started || captures.has(hand.id)) {
      input.swipe.reset("MODE_OR_CAPTURE"); return;
    }
    const event = input.swipe.update(hand, now, state.camera.height / state.camera.width || 0.75);
    if (!event || data.swipeOwner || now - lastSwipeAt < INTERACTION_TUNING.sameTargetMs) return;
    laserId = data.laserOwner = null;
    if (claim(hand.id, "SWIPE_CAPTURE", "presentation", "Slides")) {
      data.swipeOwner = hand.id; lastSwipeAt = now;
      modes.presentation.onGesture(event);
      note("SWIPE CONFIRMED · " + hand.id + " · " + event.gesture);
      release(hand.id, "SWIPE_COMPLETE");
    }
  }
  function ordinaryEvents(events, now) {
    const eventEpoch = epoch;
    for (const event of events) {
      if (eventEpoch !== epoch) return;
      if (event.type !== "gestureConfirmed") continue;
      const input = inputs.get(event.handId), hand = handAt(event.handId);
      if (!input?.pointer.data.visible || !validInteractionHand(hand, now)) continue;
      // A running Lab test observes evidence, but it never executes mode actions.
      if (permits("diagnostics")) modes["gesture-lab"].onGesture(event);
      const c = captures.get(event.handId);
      if (c || hand.interactionPinch.on && event.gesture !== "PINCH") continue;
      if (permits("game") && state.runtime.modeData.challenge?.running && state.runtime.modeData.challenge.input === "gestures") {
        if (data.gameOwner && data.gameOwner !== event.handId) continue;
        claim(event.handId, "GAME_CAPTURE", "challenge", "Challenge response"); data.gameOwner = event.handId;
        modes.challenge.onGesture(event);
        continue;
      }
      if (event.gesture === "FIST" && permits("pause")) { action("INTERACTION PAUSED · " + event.handId); pause(true); return; }
      if (event.gesture === "THUMBS_UP" && permits("confirm")) { modes.presentation.onGesture(event); }
      if (event.gesture === "TWO_FINGERS" && permits("tools") && !data.drawOwner) modes["air-draw"].onGesture(event);
    }
  }
  function update(hands, events, now, reduced = false) {
    frameNow = now;
    const nextScope = ui.pointerScope(), nextMode = effectiveMode();
    if (scope !== nextScope || scopeMode !== nextMode || !enabled()) {
      if (enabledBefore || captures.size) cancel("CONTEXT_CHANGED");
      scope = nextScope; scopeMode = nextMode;
    }
    enabledBefore = Boolean(enabled()); permissions();
    const present = new Set(hands.map(h => h.id));
    for (const [id, input] of inputs) {
      // Drawing/scroll never bridge an unobserved path. Hover/click/swipe may freeze briefly.
      if (!validInteractionHand(hands.find(h => h.id === id), now) &&
          ["DRAW_CAPTURE", "SCROLL_CAPTURE"].includes(captures.get(id)?.kind)) release(id, "TRACKING_SAMPLE_GAP");
      if (!enabledBefore || !validInteractionHand(hands.find(h => h.id === id), now) && !inGrace(id, now)) cancelHand(id);
      if (!present.has(id) && now - (input.pointer.data.lastSeenAt || 0) > 1000) { inputs.delete(id); delete state.runtime.handPointers[id]; }
    }
    if (!enabledBefore) return;
    const available = hands.filter(h => validInteractionHand(h, now));
    const single = state.settings.dualHandUI === false ? available.find(h => h.id === state.handInput.primaryHandId) || available[0] : null;
    for (const hand of available) {
      let input = inputs.get(hand.id);
      if (!input) {
        input = { pointer: createHandPointer({ handId: hand.id, state, ui }), wasPinching: true,
          pinch: createInteractionPinch(), swipe: createSwipeIntent(), lastGood: null, targetSeenAt: -Infinity, lastTarget: null, targetPoint: null,
          lastActivation: -Infinity };
        inputs.set(hand.id, input); state.runtime.handPointers[hand.id] = input.pointer.data;
      }
      if (single && hand !== single) { cancelHand(hand.id, "DUAL_UI_DISABLED"); continue; }
      hand.interactionPinch = input.pinch.update(hand, now);
      input.lastGood = { ...hand, tracking: { ...hand.tracking } };
      const c = captures.get(hand.id);
      input.pointer.update(hand, now, { captured: Boolean(c && !["PINCH_ARMING", "CLICK_CAPTURE"].includes(c.kind)),
        drawing: c?.kind === "DRAW_CAPTURE", reduced });
      if (!hand.interactionPinch.on && !c && input.pointer.target) {
        if (input.lastTarget !== input.pointer.target) note("TARGET ACQUIRED · " + hand.id + " · " + ui.targetLabel(input.pointer.target));
        input.lastTarget = input.pointer.target; input.targetSeenAt = now; input.targetPoint = { ...input.pointer.data.filtered };
      }
    }
    const currentEpoch = epoch;
    for (const hand of available) {
      const input = inputs.get(hand.id); if (!input.pointer.data.visible) continue;
      const c = captures.get(hand.id);
      if (c?.kind === "GAME_CAPTURE" && hand.gesture.raw !== c.gesture) release(hand.id);
      updatePinch(input, hand, now);
      if (currentEpoch !== epoch) return;
      updateSwipe(input, hand, now, events);
      input.wasPinching = Boolean(hand.interactionPinch.on); expose(hand.id);
    }
    if (permits("object")) modes.spatial.update({ pointers: state.runtime.handPointers, hands: available, now, reduced });
    if (currentEpoch !== epoch) return;
    if (laserId) {
      const h = handAt(laserId), p = inputs.get(laserId)?.pointer.data;
      if (!permits("laser") || !validInteractionHand(h, now) || h.interactionPinch?.on || h.gesture.raw !== "INDEX_ONLY" || captures.has(laserId) || !ui.pointInside(p.filtered, ui.element("presentation-stage"))) laserId = null;
    }
    if (permits("laser") && !laserId && !data.swipeOwner) {
      const hand = available.find(h => h.gesture.confirmed === "INDEX_ONLY" && !h.interactionPinch?.on &&
        inputs.get(h.id)?.pointer.data.visible && !captures.has(h.id) && !inputs.get(h.id).pointer.target &&
        ui.pointInside(inputs.get(h.id).pointer.data.filtered, ui.element("presentation-stage")));
      laserId = hand?.id || null;
    }
    data.laserOwner = laserId;
    if (permits("draw")) modes["air-draw"].preview?.(pointers());
    for (const p of pointers()) p.role = p.handId === laserId ? "LASER" : null;
    ordinaryEvents(events, now);
    for (const [id, c] of captures) {
      if (c.kind === "GAME_CAPTURE" && !c.gesture) c.gesture = handAt(id)?.gesture.raw;
      expose(id);
    }
    data.activeScrollTargets = Object.values(state.runtime.scroll.hands).map(x => x.target);
    const p = pointers().find(p => p.visible);
    if (p) { state.pointer.x = p.filtered.x; state.pointer.y = p.filtered.y; state.pointer.hoverTarget = p.hoverTarget; }
  }
  function tick(now, reduced = false) {
    for (const [id, input] of inputs) {
      if (!enabled() || !validInteractionHand(handAt(id), now) && !inGrace(id, now)) cancelHand(id);
      input.pointer.render(now);
    }
    const list = pointers();
    const control = state.currentMode === "spatial" && !ui.isModalOpen() ? state.runtime.modeData.spatial?.twoHand : null;
    ui.setHandHovers([...inputs.values()].filter(i => i.pointer.data.visible && !i.pointer.data.captureKind).map(i => i.pointer.target));
    ui.renderHandPointers({ pointers: list, control, reduced });
    renderFrames++;
    if (!renderStart) renderStart = now;
    if (now - renderStart >= 1000) { state.performance.renderFps = renderFrames * 1000 / (now - renderStart); renderStart = now; renderFrames = 0; }
  }
  return { data, update, tick, cancel, cancelHand, claim, claimPair, release, permits,
    setModes(value) { modes = value; }, trustedHand,
    capture: id => captures.get(id),
    canConsume: (id, owner) => !captures.has(id) || captures.get(id).owner === owner,
    isReady: id => Boolean(inputs.get(id)?.pointer.data.armed),
    recalibrate() { if (captures.size) return false; let done = false; for (const i of inputs.values()) done = i.pointer.recalibrate() || done; return done; }
  };
}
