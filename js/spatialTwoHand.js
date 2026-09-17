import { SIGNAL_TUNING } from "./interactionSignals.js";
import { WORKSPACE, clamp, rotate, isLine } from "./spatialModel.js";

// Interaction tiers come from the central arbiter; gesture classification stays in GestureEngine.
export const TWO_HAND_TUNING = Object.freeze({
  armMs: SIGNAL_TUNING.joinMs, releaseMs: 200, maxGapMs: SIGNAL_TUNING.graceMs, armingTimeoutMs: 2000,
  minDistance: 0.08, minPalmDistance: 0.65,
  midpointDeadzone: 0.003, scaleDeadzone: 0.025, angleDeadzone: Math.PI / 90,
  quietTauMs: 90, fastTauMs: 30, intentMs: 120,
  maxMoveSpeed: 1.8, maxScaleSpeed: 2.5, maxAngleSpeed: 5
});
const degrees = radians => radians * 180 / Math.PI;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const pointOK = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const magnitude = v => Math.hypot(v.x, v.y);
const vector = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
const confirmed = hand => Boolean(hand?.interactionPinch?.surfaceReady);
function deadband(value, previous, size) {
  const d = value - previous;
  return Math.abs(d) <= size ? previous : value - Math.sign(d) * size;
}
function approach(previous, target, dt, speed, fastAt) {
  const activity = clamp(Math.abs(target - previous) / dt / fastAt, 0, 1);
  const tau = TWO_HAND_TUNING.quietTauMs + activity * (TWO_HAND_TUNING.fastTauMs - TWO_HAND_TUNING.quietTauMs);
  return previous + clamp((target - previous) * (1 - Math.exp(-dt * 1000 / tau)), -speed * dt, speed * dt);
}

// ONE authoritative gesture manipulation controller. Native mouse handles remain
// in SpatialMode; they cancel this controller before obtaining document ownership.
export function createSpatialTwoHand({ state, model, action, viewContext, toWorld,
  joinTarget, workspaceTarget, beforeWorkspace, onManipulatorJoin, onManipulatorExit, interaction }) {
  const data = model.state.twoHand = {
    phase: "IDLE", ready: false, releaseRequired: true, progress: 0,
    anchorHandId: null, manipulatorHandId: null, lastAnchorHandId: null, lastManipulatorHandId: null, lastJoinTarget: null, target: null, lastTarget: null,
    pairKey: null, joinTarget: "NONE", joinZone: null, intent: "NONE",
    baselineDistance: null, baselineMidpoint: null, baselineAngle: null,
    midpointDelta: null, angleDelta: null, scaleRatio: null, appliedScale: null, appliedAngle: null,
    translation: null, resizeDelta: null, pointerDistance: null, limited: false,
    message: "Either hand grabs first = ANCHOR. The other may join the same object.", lastReason: null
  };
  let anchor = null, manipulator = null, workspace = null;
  let openSince = null, openPair = null, lastObserved = -Infinity, lastNow = 0;
  let lastIntentLog = -Infinity, blockedSecondary = null;
  const workspaceExclusive = () => Boolean(workspace);
  function handAt(id, now) {
    const hand = interaction.trustedHand(id, now);
    return hand?.geometry && hand.gesture?.eligible && hand.tracking?.visible &&
      hand.tracking.state === "TRACKING" && !hand.tracking.ambiguous && Number.isFinite(hand.tracking.lastSeenAt) &&
      now >= hand.tracking.lastSeenAt && now - hand.tracking.lastSeenAt <= TWO_HAND_TUNING.maxGapMs ? hand : null;
  }
  function phase(value, status) {
    data.phase = value;
    model.state.manipulation = anchor ? "anchor" : workspace ? "two-hand-workspace" : null;
    if (value === "DUAL_TRANSFORM") model.state.manipulation = "anchor-manipulator";
    if (status) model.state.status = status;
    model.changed();
  }
  function requireRelease() { data.ready = false; data.releaseRequired = true; openSince = null; openPair = null; }
  function clearMetrics() {
    Object.assign(data, { progress: 0, baselineDistance: null, baselineAngle: null, baselineMidpoint: null,
      midpointDelta: null, angleDelta: null, scaleRatio: null, appliedScale: null, appliedAngle: null,
      translation: null, resizeDelta: null, pointerDistance: null, intent: "MOVE", limited: false });
  }
  function contextMatches(context) { const current = viewContext(); return current && current.key === context.key; }

  function startPrimary({ handId, objectId, kind = "move", handle = null, point, now }) {
    if (anchor || workspace || !pointOK(point) || !confirmed(handAt(handId, now))) return false;
    const context = viewContext(); if (!context) return false;
    if (!interaction.claim(handId, "OBJECT_CAPTURE", "spatial", objectId, { pending: true })) return false;
    const started = kind === "move" ? model.startAnchor(objectId, point) : model.start(objectId, kind, point, handle);
    if (!started) { interaction.release(handId, "TARGET_UNAVAILABLE", false); return false; }
    anchor = { handId, objectId, kind, point: { ...point }, origin: { ...point }, context,
      zoom: model.state.zoom, pan: { ...model.state.pan } };
    data.lastAnchorHandId = handId;
    data.anchorHandId = handId; data.target = { kind: "object", id: objectId };
    data.lastReason = null; data.joinTarget = "NONE"; data.joinZone = null;
    clearMetrics(); requireRelease();
    phase("PRIMARY_GRAB", kind === "move" ? "ANCHOR LOCKED" : "PRIMARY " + kind.toUpperCase());
    data.message = kind === "move" ? "ANCHOR LOCKED · aim SECONDARY at this object, then pinch."
      : "PRIMARY handle control · release to finish.";
    action("PRIMARY GRAB → " + objectId + " · ANCHOR LOCKED"); return true;
  }
  function leaveManipulator(reason = "RELEASED", lost = false) {
    if (!manipulator || !anchor) return;
    const joined = data.phase === "DUAL_TRANSFORM";
    blockedSecondary = manipulator.handId;
    if (joined) model.endManipulator(anchor.point);
    const releasedId = manipulator.handId;
    manipulator = null; data.manipulatorHandId = null; data.progress = 0;
    data.joinTarget = "NONE"; data.joinZone = null; data.lastReason = reason;
    onManipulatorExit?.(releasedId);
    phase("PRIMARY_HOLD_AFTER_SECONDARY", "ANCHOR STILL ACTIVE");
    data.message = lost ? "SECONDARY LOST · ANCHOR CONTINUES"
      : joined ? "MANIPULATOR RELEASED · ANCHOR STILL ACTIVE" : "JOIN CANCELLED · ANCHOR STILL ACTIVE";
    action(lost ? "SECONDARY TRACKING LOST · ANCHOR CONTINUES"
      : joined ? "MANIPULATOR RELEASED · ANCHOR CONTINUES" : "SECONDARY JOIN CANCELLED");
  }
  function endPrimary(reason = "RELEASED", lost = false) {
    if (!anchor) return false;
    const old = anchor;
    const result = old.kind === "move" ? model.finishAnchor() : model.finish();
    blockedSecondary = manipulator?.handId || state.hands.find(h => h.id !== old.handId)?.id || null;
    const otherId = manipulator?.handId;
    anchor = null; manipulator = null; onManipulatorExit?.(otherId);
    interaction.release(old.handId, reason, false);
    data.lastTarget = data.target; data.target = null; data.anchorHandId = data.manipulatorHandId = null;
    data.joinTarget = "NONE"; data.joinZone = null; data.progress = 0; data.lastReason = reason;
    requireRelease(); phase(lost ? "LOST" : "RELEASING", lost ? "ANCHOR LOST · TRANSFORM ENDED" : "SELECTED");
    data.message = lost ? "ANCHOR LOST · TRANSFORM ENDED. Re-arm PRIMARY with INDEX ONLY."
      : "OBJECT DROPPED · hold INDEX ONLY before another grab.";
    action((lost ? "ANCHOR TRACKING LOST → " : "OBJECT DROP → ") + old.objectId + (result?.changed ? " · one edit committed" : " · unchanged"));
    return true;
  }
  function beginJoin(hand, cursor, target, now) {
    if (!interaction.claim(hand.id, "TRANSFORM_CAPTURE", "spatial", anchor.objectId, { pending: true })) return;
    manipulator = { handId: hand.id, zone: target, startedAt: now, lastStamp: hand.tracking.lastSeenAt,
      frames: 1, baseline: null, filter: null, intentCandidate: "MOVE", intentSince: now };
    data.lastManipulatorHandId = hand.id; data.lastJoinTarget = target.kind;
    data.manipulatorHandId = hand.id; data.joinTarget = target.kind; data.joinZone = { ...target };
    data.progress = 0; phase("SECONDARY_ARMING", "SECONDARY ARMING");
    data.message = "SECONDARY ARMING · hold steady on " + target.kind.replaceAll("_", " ") + ".";
    action("SECONDARY ARMING → " + anchor.objectId);
  }
  function activateManipulator(secondary, now) {
    const p = anchor.point, s = toWorld(secondary.position);
    if (!pointOK(s)) { leaveManipulator("INVALID_POINTER"); return; }
    const v = vector(p, s), d = magnitude(v), minimum = Math.max(8 / anchor.zoom, model.get(anchor.objectId).width * 0.04);
    if (d < minimum || !model.beginManipulator(p, s, manipulator.zone)) { leaveManipulator("HANDS_TOO_CLOSE"); return; }
    const rotation = model.get(anchor.objectId).rotation;
    manipulator.baseline = { primary: { ...p }, secondary: { ...s }, vector: v, distance: d,
      angle: Math.atan2(v.y, v.x), rotation, localVector: rotate(v, -rotation),
      midpoint: { x: (p.x + s.x) / 2, y: (p.y + s.y) / 2 } };
    manipulator.filter = { logScale: 0, angle: 0, sx: 1, sy: 1, desiredScale: 0, desiredAngle: 0,
      desiredX: 1, desiredY: 1, previousAngle: manipulator.baseline.angle, unwrapped: 0,
      previousDistance: d, timestamp: now };
    data.baselineDistance = d; data.baselineAngle = manipulator.baseline.angle;
    data.baselineMidpoint = { ...manipulator.baseline.midpoint };
    data.scaleRatio = data.appliedScale = 1; data.angleDelta = data.appliedAngle = 0; data.progress = 1;
    data.translation = data.resizeDelta = { x: 0, y: 0 };
    phase("DUAL_TRANSFORM", "MOVE + SCALE + ROTATE");
    data.message = "MANIPULATOR JOINED · " + manipulator.zone.kind.replaceAll("_", " ");
    onManipulatorJoin?.(manipulator.handId); action("MANIPULATOR JOINED → " + anchor.objectId);
  }
  function updateIntent(intent, now) {
    if (manipulator.intentCandidate !== intent) { manipulator.intentCandidate = intent; manipulator.intentSince = now; }
    if (data.intent !== intent && now - manipulator.intentSince >= TWO_HAND_TUNING.intentMs) {
      data.intent = intent; model.state.status = intent;
      if (now - lastIntentLog >= 700) { action("DUAL TRANSFORM → " + intent); lastIntentLog = now; }
    }
  }
  function objectTransform(secondary, now) {
    const base = manipulator.baseline, f = manipulator.filter, s = toWorld(secondary.position), p = anchor.point;
    if (!pointOK(s)) { leaveManipulator("INVALID_POINTER", true); return; }
    const dt = (now - f.timestamp) / 1000; if (dt <= 0) return;
    const v = vector(p, s), d = magnitude(v), angle = Math.atan2(v.y, v.x), step = wrap(angle - f.previousAngle);
    if (dt * 1000 > TWO_HAND_TUNING.maxGapMs || d < Math.max(4, base.distance * 0.12) ||
        Math.abs(Math.log(d / f.previousDistance)) > 0.5 + dt || Math.abs(step) > 1.15 + dt * 2) {
      leaveManipulator("GEOMETRY_DISCONTINUITY", true); return;
    }
    f.unwrapped += step; f.previousAngle = angle; f.previousDistance = d; f.timestamp = now;
    const sensitivity = { low: 0.8, medium: 1, high: 1.2 }[state.settings.transformSensitivity] || 1;
    const zone = manipulator.zone, old = model.anchorEdit.transform.original, localAnchor = model.anchorEdit.transform.anchorLocal;
    const stretching = zone.axes && !isLine(old) && !["circle", "square"].includes(old.type);
    let targetX = 1, targetY = 1, targetAngle = 0, targetScale = 0;
    if (stretching) {
      const local = rotate(v, -base.rotation), delta = vector(base.localVector, local);
      const [xSide, ySide] = zone.axes;
      const denomX = xSide * old.width / 2 - localAnchor.x, denomY = ySide * old.height / 2 - localAnchor.y;
      if (xSide && Math.abs(denomX) >= old.width * 0.15) targetX = clamp(1 + sensitivity * delta.x / denomX, 0.05, 4);
      if (ySide && Math.abs(denomY) >= old.height * 0.15) targetY = clamp(1 + sensitivity * delta.y / denomY, 0.05, 4);
    } else {
      if (zone.kind !== "ROTATION") targetScale = clamp(Math.log(d / base.distance) * sensitivity, -3, Math.log(4));
      targetAngle = f.unwrapped * sensitivity;
    }
    f.desiredScale = deadband(targetScale, f.desiredScale, TWO_HAND_TUNING.scaleDeadzone);
    f.desiredAngle = deadband(targetAngle, f.desiredAngle, TWO_HAND_TUNING.angleDeadzone);
    f.desiredX = deadband(targetX, f.desiredX, TWO_HAND_TUNING.scaleDeadzone);
    f.desiredY = deadband(targetY, f.desiredY, TWO_HAND_TUNING.scaleDeadzone);
    f.logScale = approach(f.logScale, f.desiredScale, dt, TWO_HAND_TUNING.maxScaleSpeed, 1.2);
    f.angle = approach(f.angle, f.desiredAngle, dt, TWO_HAND_TUNING.maxAngleSpeed, 2);
    f.sx = approach(f.sx, f.desiredX, dt, TWO_HAND_TUNING.maxScaleSpeed, 1.2);
    f.sy = approach(f.sy, f.desiredY, dt, TWO_HAND_TUNING.maxScaleSpeed, 1.2);
    const result = model.applyAnchoredTransform(p, { scaleX: stretching ? f.sx : Math.exp(f.logScale),
      scaleY: stretching ? f.sy : Math.exp(f.logScale), rotation: stretching ? 0 : degrees(f.angle) });
    if (!result) { leaveManipulator("TARGET_UNAVAILABLE"); return; }
    const moved = magnitude(vector(base.primary, p)) / Math.max(old.width, old.height, 1) > 0.04;
    const scaled = stretching ? Math.abs(f.sx - 1) + Math.abs(f.sy - 1) > 0.04 : Math.abs(f.logScale) > 0.04;
    const rotated = Math.abs(f.angle) > Math.PI / 45;
    const signals = [moved, scaled, rotated].filter(Boolean).length;
    updateIntent(signals > 1 ? "COMBINED" : stretching && scaled ? "RESIZE" : scaled ? "SCALE" : rotated ? "ROTATE" : "MOVE", now);
    Object.assign(data, { pointerDistance: d, scaleRatio: stretching ? f.sx : Math.exp(f.logScale), angleDelta: f.angle,
      appliedScale: result.scale, appliedAngle: result.rotation * Math.PI / 180,
      translation: result.translation, resizeDelta: result.resize, limited: result.limited,
      midpointDelta: { x: (p.x + s.x) / 2 - base.midpoint.x, y: (p.y + s.y) / 2 - base.midpoint.y } });
  }
  function updateAnchor(cursors, now) {
    const pHand = handAt(anchor.handId, now), p = cursors.primary;
    if (!pHand || p.handId !== anchor.handId || !p.visible) { endPrimary("ANCHOR_LOST", true); return; }
    if (!confirmed(pHand)) { endPrimary(); return; }
    if (!contextMatches(anchor.context) || model.state.selectedId !== anchor.objectId || model.state.zoom !== anchor.zoom ||
        model.state.pan.x !== anchor.pan.x || model.state.pan.y !== anchor.pan.y) { endPrimary("CONTEXT_CHANGED"); return; }
    const point = toWorld(p.position); if (!pointOK(point)) { endPrimary("INVALID_POINTER", true); return; }
    anchor.point = point;
    if (anchor.kind !== "move") { model.move(point); return; }
    if (data.phase !== "DUAL_TRANSFORM") model.moveAnchor(point);
    const s = cursors.secondary, sHand = handAt(manipulator?.handId || s.handId, now);
    if (manipulator) {
      if (!sHand || !s.visible || s.handId !== manipulator.handId) { leaveManipulator("SECONDARY_LOST", true); return; }
      if (!sHand.interactionPinch?.on) { leaveManipulator(); return; }
      if (data.phase === "DUAL_TRANSFORM") { objectTransform(s, now); return; }
      const target = joinTarget(s.position, anchor.objectId);
      if (!target || target.kind !== manipulator.zone.kind || target.key !== manipulator.zone.key) { leaveManipulator("JOIN_TARGET_CHANGED"); return; }
      if (sHand.tracking.lastSeenAt <= manipulator.lastStamp) return;
      manipulator.lastStamp = sHand.tracking.lastSeenAt; manipulator.frames++;
      data.progress = clamp((now - manipulator.startedAt) / TWO_HAND_TUNING.armMs, 0, 1);
      if (data.progress >= 1 && manipulator.frames >= 2) activateManipulator(s, now);
      return;
    }
    if (blockedSecondary && s.handId === blockedSecondary && s.armed && !sHand?.interactionPinch?.on) blockedSecondary = null;
    if (!sHand || !s.visible || !s.armed || s.handId === anchor.handId || blockedSecondary === s.handId || !sHand.interactionPinch?.on) return;
    const target = joinTarget(s.position, anchor.objectId);
    if (target?.kind === "DIFFERENT") { data.message = "SECONDARY TARGET DIFFERENT · ANCHOR CONTINUES"; blockedSecondary = s.handId; onManipulatorExit?.(s.handId); return; }
    if (target) beginJoin(sHand, s, target, now);
  }

  // Workspace navigation keeps the tested symmetric midpoint/distance behavior.
  function pairAt(now) {
    const pair = state.spatial, ids = state.handInput;
    if (!pair?.available || pair.primaryHandId !== ids?.primaryHandId || pair.secondaryHandId !== ids?.secondaryHandId ||
        pair.primaryHandId === pair.secondaryHandId || !handAt(pair.primaryHandId, now) || !handAt(pair.secondaryHandId, now) ||
        !Number.isFinite(pair.timestamp) || now < pair.timestamp || now - pair.timestamp > TWO_HAND_TUNING.maxGapMs ||
        !pointOK(pair.midpoint) || !Number.isFinite(pair.angle) || !(pair.distance >= TWO_HAND_TUNING.minDistance) ||
        !(pair.normalizedDistance >= TWO_HAND_TUNING.minPalmDistance)) return null;
    return pair;
  }
  function project(p, context) {
    const ratio = Math.min(WORKSPACE.width / context.width, WORKSPACE.height / context.height);
    const w = context.width * ratio, h = context.height * ratio;
    return { x: (WORKSPACE.width - w) / 2 + p.x * w, y: (WORKSPACE.height - h) / 2 + p.y * h };
  }
  function endWorkspace(reason = "RELEASED", lost = false) {
    if (!workspace) return;
    if (workspace.baseline) action("WORKSPACE TWO-HAND RELEASE → " + Math.round(model.state.zoom * 100) + "%");
    if (lost) action("TWO-HAND TRACKING LOST");
    const releasedIds = workspace.ids;
    workspace = null;
    for (const id of releasedIds) interaction.release(id, reason, false);
    data.lastTarget = data.target; data.target = null; data.progress = 0; data.lastReason = reason;
    requireRelease(); onManipulatorExit?.(); phase("RELEASING", lost ? "TWO-HAND CONTROL LOST" : "READY");
    data.message = "Workspace released · open both hands to re-arm.";
  }
  function updateWorkspace(now) {
    const pair = pairAt(now);
    if (!workspace) {
      if (!pair) { requireRelease(); return; }
      if (pair.timestamp <= lastObserved) return;
      lastObserved = pair.timestamp;
      if (!pair.primaryPinch.raw && !pair.secondaryPinch.raw) {
        if (openPair !== pair.pairKey || openSince === null) { openPair = pair.pairKey; openSince = now; }
        if (now - openSince >= TWO_HAND_TUNING.releaseMs) { data.ready = true; data.releaseRequired = false;
          if (["RELEASING", "LOST"].includes(data.phase)) phase("IDLE"); }
        return;
      }
      if (!data.ready || openPair !== pair.pairKey || !pair.primaryPinch.raw || !pair.secondaryPinch.raw || !workspaceTarget()) return;
      const context = viewContext(); if (!context) return;
      const ids = [pair.primaryHandId, pair.secondaryHandId];
      if (!interaction.claimPair(ids, "TRANSFORM_CAPTURE", "Workspace zoom / pan")) return;
      beforeWorkspace(); clearMetrics();
      workspace = { context, ids, pairKey: pair.pairKey, startedAt: now, stableSince: null, frames: 0, lastStamp: -Infinity, baseline: null };
      data.target = { kind: "workspace", id: null }; data.pairKey = pair.pairKey;
      phase("WORKSPACE_ARMING", "WORKSPACE ARMING"); data.message = "Hold both pinches to zoom/pan the empty workspace.";
    }
    if (!pair || pair.pairKey !== workspace.pairKey || !contextMatches(workspace.context)) { endWorkspace("TRACKING_OR_CONTEXT_LOST", true); return; }
    if (!pair.primaryPinch.raw || !pair.secondaryPinch.raw) { endWorkspace(); return; }
    if (pair.timestamp <= workspace.lastStamp) return;
    workspace.lastStamp = pair.timestamp;
    if (!workspace.baseline) {
      if (now - workspace.startedAt > TWO_HAND_TUNING.armingTimeoutMs) { endWorkspace("ARMING_TIMEOUT"); return; }
      if (!confirmed(handAt(pair.primaryHandId, now)) || !confirmed(handAt(pair.secondaryHandId, now))) {
        workspace.stableSince = null; workspace.frames = 0; data.progress = 0; return;
      }
      if (workspace.stableSince === null) workspace.stableSince = now;
      workspace.frames++; data.progress = clamp((now - workspace.stableSince) / TWO_HAND_TUNING.armMs, 0, 1);
      if (data.progress < 1 || workspace.frames < 3) return;
      workspace.baseline = { distance: pair.distance, projected: project(pair.midpoint, workspace.context),
        midpoint: { ...pair.midpoint }, zoom: model.state.zoom, pan: { ...model.state.pan } };
      workspace.filter = { x: pair.midpoint.x, y: pair.midpoint.y, logScale: 0,
        desiredX: pair.midpoint.x, desiredY: pair.midpoint.y, desiredScale: 0,
        previousDistance: pair.distance, previousMidpoint: { ...pair.midpoint }, timestamp: pair.timestamp };
      data.baselineDistance = pair.distance; data.baselineMidpoint = { ...pair.midpoint }; data.baselineAngle = pair.angle;
      data.scaleRatio = data.appliedScale = 1; data.appliedAngle = 0;
      phase("TWO_HAND_WORKSPACE", "WORKSPACE ZOOM + PAN"); data.message = "LOCKED · WORKSPACE ZOOM + PAN";
      action("WORKSPACE TWO-HAND ZOOM + PAN"); return;
    }
    if (!confirmed(handAt(pair.primaryHandId, now)) || !confirmed(handAt(pair.secondaryHandId, now))) { endWorkspace(); return; }
    const f = workspace.filter, b = workspace.baseline, dt = (pair.timestamp - f.timestamp) / 1000, aspect = workspace.context.height / workspace.context.width;
    if (!(dt > 0)) return;
    if (dt * 1000 > TWO_HAND_TUNING.maxGapMs || Math.abs(Math.log(pair.distance / f.previousDistance)) > 0.5 + dt ||
        Math.hypot(pair.midpoint.x - f.previousMidpoint.x, (pair.midpoint.y - f.previousMidpoint.y) * aspect) > 0.18 + dt * 0.6) {
      endWorkspace("GEOMETRY_DISCONTINUITY", true); return;
    }
    f.previousDistance = pair.distance; f.previousMidpoint = { ...pair.midpoint }; f.timestamp = pair.timestamp;
    f.desiredX = deadband(pair.midpoint.x, f.desiredX, TWO_HAND_TUNING.midpointDeadzone);
    f.desiredY = deadband(pair.midpoint.y, f.desiredY, TWO_HAND_TUNING.midpointDeadzone / aspect);
    f.desiredScale = deadband(Math.log(pair.distance / b.distance), f.desiredScale, TWO_HAND_TUNING.scaleDeadzone);
    f.x = approach(f.x, f.desiredX, dt, TWO_HAND_TUNING.maxMoveSpeed, 0.6);
    f.y = approach(f.y, f.desiredY, dt, TWO_HAND_TUNING.maxMoveSpeed / aspect, 0.6 / aspect);
    f.logScale = approach(f.logScale, f.desiredScale, dt, TWO_HAND_TUNING.maxScaleSpeed, 1.2);
    const projected = project(f, workspace.context), ratio = Math.exp(clamp(f.logScale, -4, 4)), zoom = clamp(b.zoom * ratio, 0.5, 2.5);
    const fixed = { x: (b.projected.x - b.pan.x) / b.zoom, y: (b.projected.y - b.pan.y) / b.zoom };
    const pan = { x: projected.x - fixed.x * zoom, y: projected.y - fixed.y * zoom };
    model.setViewTransform(zoom, pan);
    Object.assign(data, { scaleRatio: ratio, appliedScale: zoom / b.zoom, appliedAngle: 0,
      midpointDelta: { x: f.x - b.midpoint.x, y: f.y - b.midpoint.y },
      limited: zoom !== b.zoom * ratio || pan.x !== model.state.pan.x || pan.y !== model.state.pan.y });
  }
  function update({ cursors, now }) {
    lastNow = now;
    if (anchor) updateAnchor(cursors, now); else updateWorkspace(now);
    return workspaceExclusive();
  }
  function watchdog(now) {
    if (anchor) {
      const hand = handAt(anchor.handId, now);
      if (!hand) endPrimary("ANCHOR_LOST", true);
      else if (!confirmed(hand)) endPrimary();
      else if (!contextMatches(anchor.context)) endPrimary("CONTEXT_CHANGED");
      else if (manipulator && !handAt(manipulator.handId, now)) leaveManipulator("SECONDARY_LOST", true);
      else if (manipulator && !handAt(manipulator.handId, now)?.interactionPinch?.on) leaveManipulator();
    }
    if (workspace && (!pairAt(now) || !contextMatches(workspace.context))) endWorkspace("TRACKING_OR_CONTEXT_LOST", true);
  }
  return { data, startPrimary, endPrimary, update, watchdog, releaseManipulator: leaveManipulator,
    get exclusive() { return workspaceExclusive(); }, get holding() { return Boolean(anchor); },
    get anchorHandId() { return anchor?.handId || null; }, get manipulatorHandId() { return manipulator?.handId || null; },
    cancel() {
      const now = Math.max(lastNow, performance.now());
      if (anchor) endPrimary(handAt(anchor.handId, now) ? "CANCELLED" : "ANCHOR_LOST", !handAt(anchor.handId, now));
      endWorkspace("CANCELLED"); requireRelease();
    }
  };
}
