// All gesture rules, temporal state, motion recognition and spatial geometry live here.
// Coordinates use the original camera image unless a field is explicitly named "view".
export const GESTURE_DEFAULTS = Object.freeze({
  holdMs: 350, pinchHoldMs: 320, cooldownMs: 500, swipeCooldownMs: 700,
  confidenceThreshold: 0.70, candidateThreshold: 0.50,
  pinchEnter: 0.28, pinchExit: 0.40, pinchMinReach: 0.45,
  releaseMs: 150, maxFrameGapMs: 300, minConfirmFrames: 3,
  historyMs: 650, historyLimit: 32,
  swipeDistance: 0.20, swipeMinDurationMs: 120, swipeArmMs: 200,
  swipeMinSamples: 4, swipeConsistency: 0.82, swipeHorizontalRatio: 0.85,
  swipeRearmMs: 220, stationarySpeed: 0.12,
  candidateNoticeMs: 150, candidateNoticeCooldownMs: 500,
  confidenceSmoothingMs: 100
});

const FINGERS = Object.freeze({
  index: [5, 6, 7, 8], middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20]
});
const MAIN_FINGERS = Object.keys(FINGERS);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ramp = (value, low, high) => clamp((value - low) / (high - low));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const length = (v) => Math.hypot(v.x, v.y, v.z || 0);
const distance = (a, b) => length(subtract(a, b));
const distance2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a, b) => a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
const wrappedAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

function jointAngle(a, b, c) {
  const first = subtract(a, b);
  const second = subtract(c, b);
  const denominator = length(first) * length(second);
  if (denominator < 1e-10) return 0;
  return Math.acos(clamp(dot(first, second) / denominator, -1, 1)) * 180 / Math.PI;
}

export function emptyGesture() {
  return {
    raw: "UNKNOWN", candidate: null, confirmed: null,
    confidence: 0, displayConfidence: 0,
    candidateDurationMs: 0, stabilityMs: 0, stability: 0,
    confirmedAt: null, cooldownUntil: 0, cooldownRemainingMs: 0,
    releaseRequired: false, eligible: false
  };
}

function emptyPinch() {
  return {
    distance: null, raw: false, stable: false, confirmed: false,
    stabilityMs: 0, progress: 0, uiConfirmed: false, uiProgress: 0
  };
}

function emptySwipe() {
  return {
    candidate: null, confirmed: null, confidence: 0, stabilityMs: 0,
    progress: 0, cooldownUntil: 0, cooldownRemainingMs: 0, releaseRequired: false, evidence: null
  };
}

export function emptySpatial() {
  return {
    available: false, pairKey: null, coordinateSpace: "view; x/y normalized to image",
    primaryHandId: null, secondaryHandId: null,
    primaryPosition: null, secondaryPosition: null,
    primaryPinch: emptyPinch(), secondaryPinch: emptyPinch(),
    bothPinchingRaw: false, bothPinchingStable: false, bothPinchingConfirmed: false,
    distance: null, normalizedDistance: null, midpoint: null, relativeVector: null,
    angle: null, distanceDelta: null, angleDelta: null,
    distanceVelocity: null, angularVelocity: null,
    referenceDistance: null, scaleRatio: null, rotationFromReference: null,
    timestamp: null
  };
}

function validateConfig(options) {
  const config = { ...GESTURE_DEFAULTS };
  const ranges = {
    holdMs: [250, 600], pinchHoldMs: [250, 600], cooldownMs: [250, 1500],
    swipeCooldownMs: [500, 1500], confidenceThreshold: [0.60, 0.95],
    candidateThreshold: [0.45, 0.65], pinchEnter: [0.12, 0.60], pinchExit: [0.18, 0.80],
    pinchMinReach: [0.30, 0.65],
    releaseMs: [100, 400], maxFrameGapMs: [100, 400], minConfirmFrames: [3, 12],
    historyMs: [400, 1000], historyLimit: [12, 64],
    swipeDistance: [0.10, 0.40], swipeMinDurationMs: [100, 250], swipeArmMs: [150, 400],
    swipeMinSamples: [4, 12], swipeConsistency: [0.70, 0.95],
    swipeHorizontalRatio: [0.75, 0.98], swipeRearmMs: [150, 500],
    stationarySpeed: [0.05, 0.20], candidateNoticeMs: [100, 300],
    candidateNoticeCooldownMs: [350, 1000], confidenceSmoothingMs: [50, 250]
  };
  for (const [key, bounds] of Object.entries(ranges)) {
    if (Number.isFinite(options[key])) config[key] = clamp(options[key], ...bounds);
  }
  for (const key of ["historyLimit", "minConfirmFrames", "swipeMinSamples"]) {
    config[key] = Math.round(config[key]);
  }
  config.pinchExit = Math.max(config.pinchEnter + 0.04, config.pinchExit);
  config.candidateThreshold = Math.min(config.candidateThreshold, config.confidenceThreshold);
  return Object.freeze(config);
}

function measureHand(hand, aspect, mirrored, previousFingers) {
  const landmarks = hand.landmarks;
  if (landmarks?.length !== 21 || !landmarks.every((point) =>
    [point.x, point.y, point.z].every(Number.isFinite))) return null;

  // MediaPipe x and z use image-width units. Convert y to those same units.
  const points = landmarks.map((point) => ({ x: point.x, y: point.y * aspect, z: point.z }));
  const points2D = landmarks.map((point) => ({ x: point.x, y: point.y * aspect }));
  const wristMiddle = distance(points[0], points[9]);
  const palmWidth = distance(points[5], points[17]);
  // General gesture geometry may use MediaPipe Z, but pinch is a screen-space
  // contact gesture. Z is substantially noisier near webcam frame edges and can
  // make visibly touching fingertips look far apart. Keep a separate robust 2D
  // palm scale for pinch sensing.
  const wristMiddle2D = distance2D(points2D[0], points2D[9]);
  const palmWidth2D = distance2D(points2D[5], points2D[17]);
  const boundedWrist = clamp(wristMiddle, palmWidth * 0.72, palmWidth * 1.45);
  const boundedWrist2D = clamp(wristMiddle2D, palmWidth2D * 0.72, palmWidth2D * 1.45);
  const scale = 0.68 * palmWidth + 0.32 * boundedWrist;
  const pinchScale2DBase = 0.72 * palmWidth2D + 0.28 * boundedWrist2D;
  if (!Number.isFinite(scale) || scale < 1e-6 || !Number.isFinite(pinchScale2DBase) || pinchScale2DBase < 1e-6) return null;

  const center = { x: 0, y: 0, z: 0 };
  for (const i of [0, 5, 9, 13, 17]) {
    center.x += landmarks[i].x / 5;
    center.y += landmarks[i].y / 5;
    center.z += landmarks[i].z / 5;
  }
  const metricCenter = { x: center.x, y: center.y * aspect, z: center.z };
  const extension = {};
  const angles = {};

  for (const [name, [mcp, pip, dip, tip]] of Object.entries(FINGERS)) {
    const pipAngle = jointAngle(points[mcp], points[pip], points[dip]);
    const dipAngle = jointAngle(points[pip], points[dip], points[tip]);
    const reach = distance(points[0], points[tip]) / Math.max(distance(points[0], points[mcp]), scale * 0.2);
    extension[name] = 0.55 * ramp(pipAngle, 100, 165) +
      0.25 * ramp(dipAngle, 110, 165) + 0.20 * ramp(reach, 1.0, 1.65);
    angles[name] = { pip: pipAngle, dip: dipAngle };
  }

  const thumbMcp = jointAngle(points[1], points[2], points[3]);
  const thumbIp = jointAngle(points[2], points[3], points[4]);
  const thumbSeparation = distance(points[4], metricCenter) / scale;
  const separationScore = ramp(thumbSeparation, 0.55, 1.05);
  const thumbStraight = 0.45 * ramp(thumbMcp, 100, 160) + 0.55 * ramp(thumbIp, 115, 170);
  extension.thumb = 0.60 * thumbStraight + 0.40 * separationScore;
  if (separationScore < 0.15) extension.thumb = Math.min(extension.thumb, 0.35);
  angles.thumb = { mcp: thumbMcp, ip: thumbIp };

  const fingerStates = {};
  for (const name of ["thumb", ...MAIN_FINGERS]) {
    // A small hysteresis band avoids rapidly alternating UP/DOWN labels.
    const score = extension[name];
    fingerStates[name] = score >= 0.62 ? "UP" : score <= 0.42 ? "DOWN"
      : previousFingers?.[name] || (score >= 0.55 ? "UP" : "DOWN");
  }

  const thumbDirection = subtract(points[4], points[2]);
  const thumbLength = length(thumbDirection);
  const pinchCenter = {
    x: (points[4].x + points[8].x) / 2,
    y: (points[4].y + points[8].y) / 2,
    z: (points[4].z + points[8].z) / 2
  };
  const rawPinchDistance3D = distance(points[4], points[8]);
  const rawPinchReach3D = distance(pinchCenter, metricCenter);
  const pinchCenter2D = {
    x: (points2D[4].x + points2D[8].x) / 2,
    y: (points2D[4].y + points2D[8].y) / 2
  };
  const metricCenter2D = { x: center.x, y: center.y * aspect };
  const rawPinchDistance2D = distance2D(points2D[4], points2D[8]);
  const rawPinchReach2D = distance2D(pinchCenter2D, metricCenter2D);
  // Lower-frame assistance is intentionally local, not a global threshold
  // relaxation. This is where webcam geometry becomes least reliable while the
  // pointer can still look perfectly stable.
  const lowerY = Math.max(landmarks[0].y, landmarks[4].y, landmarks[8].y, center.y);
  const bottomEdgeAssist = clamp((lowerY - 0.68) / 0.22);
  const sideX = Math.min(landmarks[4].x, landmarks[8].x, center.x,
    1 - landmarks[4].x, 1 - landmarks[8].x, 1 - center.x);
  const sideEdgeAssist = clamp((0.09 - sideX) / 0.09) * 0.35;
  const edgeAssist = Math.max(bottomEdgeAssist, sideEdgeAssist);
  const upward = thumbLength > 1e-8 ? -thumbDirection.y / thumbLength : 0;
  const view = (point) => ({ x: mirrored ? 1 - point.x : point.x, y: point.y, z: point.z });
  // Joint labels describe anatomy, so these rules work for either handedness.
  // A Left/Right model label is never inferred from screen X or CSS mirroring.
  return {
    scale, center, viewCenter: view(center),
    indexTip: { ...landmarks[8] }, thumbTip: { ...landmarks[4] },
    viewIndexTip: view(landmarks[8]), viewThumbTip: view(landmarks[4]),
    handedness: hand.handedness, extension, angles, fingerStates,
    pinchDistanceRaw: rawPinchDistance2D, pinchReachRaw: rawPinchReach2D,
    pinchDistanceRaw2D: rawPinchDistance2D, pinchReachRaw2D: rawPinchReach2D,
    pinchDistanceRaw3D: rawPinchDistance3D, pinchReachRaw3D: rawPinchReach3D,
    pinchDistance2D: rawPinchDistance2D / pinchScale2DBase,
    pinchReach2D: rawPinchReach2D / pinchScale2DBase,
    pinchDistance3D: rawPinchDistance3D / scale,
    pinchReach3D: rawPinchReach3D / scale,
    // Authoritative pinch metric is the image-plane contact distance. This
    // matches what the user physically sees and avoids noisy depth estimates.
    pinchDistance: rawPinchDistance2D / pinchScale2DBase,
    pinchReach: rawPinchReach2D / pinchScale2DBase,
    pinchScale2DBase, palmWidth, wristMiddle, palmWidth2D, wristMiddle2D, edgeAssist,
    frameZone: bottomEdgeAssist > 0.45 ? "BOTTOM_EDGE" : sideEdgeAssist > 0.2 ? "SIDE_EDGE" : "CENTER",
    thumbSeparation, upward, thumbReach: thumbLength / scale
  };
}

function classifyStatic(geometry, rawPinch, config) {
  const e = geometry.extension;
  const main = MAIN_FINGERS.map((name) => e[name]);
  const folded = main.every((value) => value < 0.50);
  const foldScore = mean(main.map((value) => 1 - value));
  let name = "UNKNOWN";
  let score = 0;

  if (rawPinch) {
    name = "PINCH";
    score = 0.62 + 0.38 * (1 - clamp(geometry.pinchDistance / config.pinchExit));
  } else if (folded && (e.thumb < 0.55 || geometry.thumbSeparation < 0.70)) {
    name = "FIST";
    score = 0.85 * foldScore + 0.15 * Math.max(1 - e.thumb, 1 - ramp(geometry.thumbSeparation, 0.4, 0.9));
  } else if (folded && e.thumb >= 0.60 && geometry.upward >= 0.65 && geometry.thumbReach >= 0.45) {
    name = "THUMBS_UP";
    score = 0.55 * foldScore + 0.25 * e.thumb + 0.20 * ramp(geometry.upward, 0.45, 0.95);
  } else if (e.index >= 0.55 && e.middle >= 0.55 && e.ring < 0.50 && e.pinky < 0.50) {
    name = "TWO_FINGERS";
    score = mean([e.index, e.middle, 1 - e.ring, 1 - e.pinky]);
  } else if (main.every((value) => value >= 0.55)) {
    name = "OPEN_PALM";
    score = 0.90 * mean(main) + 0.10 * e.thumb;
  } else if (e.index >= 0.55 && e.middle < 0.50 && e.ring < 0.50 && e.pinky < 0.50) {
    name = "INDEX_ONLY";
    score = mean([e.index, 1 - e.middle, 1 - e.ring, 1 - e.pinky]);
  }
  return { name: score >= config.candidateThreshold ? name : "UNKNOWN", score: clamp(score) };
}

function newMemory(now) {
  return {
    lastAt: now, fingers: null, displayConfidence: 0,
    rawPinch: false, pinchSince: null, pinchScale: null,
    candidate: null, candidateSince: null, qualitySince: null, qualityFrames: 0,
    candidateNoticed: false, lastNoticeAt: -Infinity,
    confirmedAt: null, emittedForCandidate: false,
    latchedGesture: null, releaseSince: null, cooldownUntil: 0,
    history: [], swipeHistory: [], openSince: null, swipeReleaseSince: null,
    swipeLatched: false, stationarySince: null, swipeCooldownUntil: 0,
    swipeConfirmed: null, swipeConfirmedUntil: 0
  };
}

function motionSummary(history, aspect) {
  if (history.length < 2) return { direction: "STILL", dx: 0, dy: 0, travel: 0, consistency: 0 };
  const first = history[0], last = history[history.length - 1];
  const dx = last.x - first.x, dy = (last.y - first.y) * aspect;
  let path = 0;
  for (let i = 1; i < history.length; i += 1) {
    path += Math.hypot(history[i].x - history[i - 1].x, (history[i].y - history[i - 1].y) * aspect);
  }
  const travel = Math.hypot(dx, dy);
  const direction = travel < 0.025 ? "STILL"
    : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "RIGHT" : "LEFT") : (dy > 0 ? "DOWN" : "UP");
  return { direction, dx, dy, travel, consistency: path > 1e-8 ? clamp(travel / path) : 0 };
}

function addHistory(history, point, now, config) {
  history.push({ x: point.x, y: point.y, at: now });
  while (history.length > config.historyLimit ||
      (history.length && now - history[0].at > config.historyMs)) history.shift();
}

export class GestureEngine {
  constructor(options = {}) {
    this.config = validateConfig(options);
    this.hands = new Map();
    this.primaryHandId = null;
    this.frameKey = null;
    this.pair = null;
    this.ready = true;
  }

  configure(options = {}) {
    this.config = validateConfig({ ...this.config, ...options });
    this.reset();
  }

  reset() {
    this.hands.clear();
    this.primaryHandId = null;
    this.frameKey = null;
    this.pair = null;
  }

  clearHand(hand) {
    this.hands.delete(hand.id);
    hand.geometry = null;
    hand.handScale = null;
    hand.handCenter = null;
    hand.indexTip = null;
    hand.thumbTip = null;
    hand.fingerStates = null;
    hand.pinchDistance = null;
    hand.pinch = emptyPinch();
    hand.gesture = emptyGesture();
    hand.movementHistory = [];
    hand.movementDirection = null;
    hand.motion = { direction: "STILL", dx: 0, dy: 0, travel: 0, consistency: 0 };
    hand.swipe = emptySwipe();
  }

  update(hands, { timestamp, width, height, mirrored = true,
    primaryHandId = null, secondaryHandId = null, enabled = true } = {}) {
    const events = [];
    if (!Number.isFinite(timestamp) || !(width > 0) || !(height > 0)) {
      this.reset();
      hands.forEach((hand) => this.clearHand(hand));
      return { events, spatial: emptySpatial() };
    }
    const frameKey = width + ":" + height + ":" + mirrored;
    if (this.frameKey !== frameKey) {
      this.reset();
      this.frameKey = frameKey;
    }
    if (primaryHandId !== this.primaryHandId) {
      // Primary is a HUD role. Per-ID gesture continuity now belongs to each hand;
      // the interaction arbiter latches owners and safely handles role changes.
      this.primaryHandId = primaryHandId;
      this.pair = null;
    }

    const aspect = height / width;
    const presentIds = new Set();
    for (const hand of hands.slice(0, 2)) {
      presentIds.add(hand.id);
      const previous = this.hands.get(hand.id);
      const geometry = hand.tracking?.visible && !hand.tracking.ambiguous
        ? measureHand(hand, aspect, mirrored, previous?.fingers) : null;
      if (!geometry) {
        if (previous) events.push({ type: "trackingLost", handId: hand.id, at: timestamp });
        this.clearHand(hand);
        continue;
      }

      const eligible = enabled && hand.tracking.state === "TRACKING";
      let memory = previous;
      if (!memory || !eligible || timestamp <= memory.lastAt ||
          timestamp - memory.lastAt > this.config.maxFrameGapMs) {
        memory = newMemory(timestamp);
      }
      if (eligible && !previous) events.push({ type: "trackingRestored", handId: hand.id, at: timestamp });
      const dt = Math.max(0, timestamp - memory.lastAt);
      memory.lastAt = timestamp;
      memory.fingers = geometry.fingerStates;
      // Stabilize only the scale used by pinch geometry. This prevents the
      // thumb/index ratio from jumping when the wrist landmark degrades near a
      // camera edge, while still allowing real depth changes over a few frames.
      if (!Number.isFinite(memory.pinchScale)) memory.pinchScale = geometry.pinchScale2DBase;
      const edge = geometry.edgeAssist || 0;
      const step = edge > 0.25 ? 0.10 : 0.18;
      const boundedScale = clamp(geometry.pinchScale2DBase, memory.pinchScale * (1 - step), memory.pinchScale * (1 + step));
      const blend = edge > 0.25 ? 0.18 : 0.30;
      memory.pinchScale += (boundedScale - memory.pinchScale) * blend;
      geometry.pinchScale = memory.pinchScale;
      geometry.pinchDistance = geometry.pinchDistanceRaw2D / memory.pinchScale;
      geometry.pinchReach = geometry.pinchReachRaw2D / memory.pinchScale;
      geometry.pinchDistance2D = geometry.pinchDistance;
      geometry.pinchReach2D = geometry.pinchReach;
      // A closed fist can bring both tips together inside the palm. Require
      // a reachable thumb/index contact point, with hysteresis on release. Near
      // the lower frame edge we add a small local tolerance instead of loosening
      // pinch globally.
      const wasPinching = memory.rawPinch;
      const thumbIndexFolded = geometry.extension.thumb < 0.40 &&
        geometry.extension.index < 0.25;
      // Keep pinch contact conservative at frame edges. Fast UI taps are
      // recovered by interactionSignals' trajectory detector; the static
      // gesture label should not stay latched on a visibly open thumb/index gap.
      const edgeEnter = Math.min(0.315, this.config.pinchEnter + 0.012 * edge);
      const edgeExit = Math.min(0.395, Math.max(edgeEnter + 0.075, this.config.pinchExit + 0.012 * edge));
      const edgeReach = Math.max(0.36, this.config.pinchMinReach - 0.030 * edge);
      memory.rawPinch = geometry.pinchDistance <=
        (wasPinching ? edgeExit : edgeEnter) &&
        geometry.pinchReach >= edgeReach * (wasPinching ? 0.8 : 1) &&
        !thumbIndexFolded;
      const raw = classifyStatic(geometry, memory.rawPinch, this.config);
      const gesture = this.updateStatic(memory, raw, timestamp, dt, eligible, hand.id, events);
      const pinch = this.updatePinch(memory, geometry, gesture, timestamp, eligible);
      const swipe = this.updateSwipe(memory, geometry, raw, timestamp, aspect, eligible, hand.id, events);

      Object.assign(hand, {
        geometry, handScale: geometry.scale, handCenter: geometry.center,
        indexTip: geometry.indexTip, thumbTip: geometry.thumbTip,
        fingerStates: geometry.fingerStates, pinchDistance: geometry.pinchDistance,
        gesture, pinch, swipe,
        movementHistory: memory.history,
        motion: motionSummary(memory.history, aspect)
      });
      hand.movementDirection = hand.motion.direction;
      if (eligible) this.hands.set(hand.id, memory);
      else this.hands.delete(hand.id);
    }
    for (const id of this.hands.keys()) {
      if (!presentIds.has(id)) {
        events.push({ type: "trackingLost", handId: id, at: timestamp });
        this.hands.delete(id);
      }
    }

    // A swipe takes event priority if the static OPEN_PALM confirms on the same frame.
    const swipingIds = new Set(events.filter((event) => event.kind === "swipe").map((event) => event.handId));
    const filtered = events.filter((event) =>
      !(event.type === "gestureConfirmed" && event.kind === "static" && swipingIds.has(event.handId)));
    return {
      events: filtered,
      spatial: this.updateSpatial(hands, primaryHandId, secondaryHandId, timestamp, aspect)
    };
  }

  updateStatic(memory, raw, now, dt, eligible, handId, events) {
    const config = this.config;
    const result = emptyGesture();
    result.raw = raw.name;
    result.confidence = raw.score;
    const alpha = 1 - Math.exp(-Math.max(dt, 1) / config.confidenceSmoothingMs);
    memory.displayConfidence += (raw.score - memory.displayConfidence) * alpha;
    result.displayConfidence = eligible ? memory.displayConfidence : raw.score;
    if (!eligible) return result;
    result.eligible = true;

    if (memory.latchedGesture && raw.name !== memory.latchedGesture) {
      memory.releaseSince ??= now;
      if (now - memory.releaseSince >= config.releaseMs) memory.latchedGesture = null;
    } else memory.releaseSince = null;

    const candidate = raw.name === "UNKNOWN" ? null : raw.name;
    if (candidate !== memory.candidate) {
      memory.candidate = candidate;
      memory.candidateSince = candidate ? now : null;
      memory.qualitySince = null;
      memory.qualityFrames = 0;
      memory.confirmedAt = null;
      memory.emittedForCandidate = false;
      memory.candidateNoticed = false;
    }
    const quality = candidate && raw.score >= config.confidenceThreshold;
    if (quality) {
      memory.qualitySince ??= now;
      memory.qualityFrames += 1;
    } else {
      memory.qualitySince = null;
      memory.qualityFrames = 0;
    }

    const duration = candidate === "PINCH" ? config.pinchHoldMs : config.holdMs;
    const stabilityMs = memory.qualitySince === null ? 0 : now - memory.qualitySince;
    const stable = stabilityMs >= duration && memory.qualityFrames >= config.minConfirmFrames;
    if (candidate && !memory.candidateNoticed &&
        now - memory.candidateSince >= config.candidateNoticeMs &&
        now - memory.lastNoticeAt >= config.candidateNoticeCooldownMs) {
      memory.candidateNoticed = true;
      memory.lastNoticeAt = now;
      events.push({ type: "gestureCandidate", handId, gesture: candidate, at: now, confidence: raw.score });
    }
    if (stable && !memory.emittedForCandidate &&
        candidate !== memory.latchedGesture && now >= memory.cooldownUntil) {
      memory.emittedForCandidate = true;
      memory.latchedGesture = candidate;
      memory.confirmedAt = now;
      memory.cooldownUntil = now + config.cooldownMs;
      events.push({ type: "gestureConfirmed", kind: "static", handId, gesture: candidate, at: now, confidence: raw.score });
    }
    if (stable && memory.latchedGesture === candidate && memory.confirmedAt === null) {
      memory.confirmedAt = now;
    }
    return Object.assign(result, {
      candidate,
      candidateDurationMs: memory.candidateSince === null ? 0 : now - memory.candidateSince,
      confirmed: stable && (memory.emittedForCandidate || memory.latchedGesture === candidate) ? candidate : null,
      confirmedAt: memory.confirmedAt,
      stabilityMs, stability: clamp(stabilityMs / duration),
      cooldownUntil: memory.cooldownUntil,
      cooldownRemainingMs: Math.max(0, memory.cooldownUntil - now),
      releaseRequired: memory.latchedGesture === candidate && candidate !== null
    });
  }

  updatePinch(memory, geometry, gesture, now, eligible) {
    const quality = eligible && memory.rawPinch && gesture.confidence >= this.config.confidenceThreshold;
    if (quality) memory.pinchSince ??= now;
    else memory.pinchSince = null;
    const stabilityMs = memory.pinchSince === null ? 0 : now - memory.pinchSince;
    // Faster UI-only qualification, separate from the tested 320 ms action pinch.
    // Destructive actions, drawing and transforms retain the full confirmation.
    const strong = quality && gesture.confidence >= 0.85;
    if (strong) { memory.uiPinchSince ??= now; memory.uiPinchFrames = (memory.uiPinchFrames || 0) + 1; }
    else { memory.uiPinchSince = null; memory.uiPinchFrames = 0; }
    const uiDuration = memory.uiPinchSince === null ? 0 : now - memory.uiPinchSince;
    return {
      distance: geometry.pinchDistance, raw: memory.rawPinch,
      stable: quality && stabilityMs >= this.config.pinchHoldMs &&
        memory.qualityFrames >= this.config.minConfirmFrames,
      confirmed: gesture.confirmed === "PINCH",
      stabilityMs, progress: clamp(stabilityMs / this.config.pinchHoldMs),
      uiConfirmed: strong && uiDuration >= 160 && memory.uiPinchFrames >= 3,
      uiProgress: clamp(uiDuration / 160)
    };
  }

  updateSwipe(memory, geometry, raw, now, aspect, eligible, handId, events) {
    const config = this.config;
    const result = emptySwipe();
    if (!eligible) return result;
    const center = geometry.viewCenter;
    const previousPoint = memory.history[memory.history.length - 1];
    addHistory(memory.history, center, now, config);
    const isOpen = raw.name === "OPEN_PALM" && raw.score >= config.confidenceThreshold;
    const dt = previousPoint ? (now - previousPoint.at) / 1000 : 0;
    const speed = dt > 0
      ? Math.hypot(center.x - previousPoint.x, (center.y - previousPoint.y) * aspect) / dt : Infinity;

    if (!isOpen) {
      memory.openSince = null;
      memory.swipeHistory.length = 0;
      memory.stationarySince = null;
      memory.swipeReleaseSince ??= now;
      if (now - memory.swipeReleaseSince >= config.releaseMs) memory.swipeLatched = false;
    } else {
      memory.swipeReleaseSince = null;
      memory.openSince ??= now;
      if (memory.swipeLatched) {
        if (speed <= config.stationarySpeed) memory.stationarySince ??= now;
        else memory.stationarySince = null;
        if (memory.stationarySince !== null &&
            now - memory.stationarySince >= config.swipeRearmMs &&
            now >= memory.swipeCooldownUntil) {
          memory.swipeLatched = false;
          memory.swipeHistory.length = 0;
          memory.openSince = now;
          memory.stationarySince = null;
        }
      }
      if (!memory.swipeLatched) addHistory(memory.swipeHistory, center, now, config);
    }

    const history = memory.swipeHistory;
    if (isOpen && !memory.swipeLatched && history.length >= 2) {
      const first = history[0], last = history[history.length - 1];
      const dx = last.x - first.x, dy = (last.y - first.y) * aspect;
      let xPath = 0, yPath = 0, path = 0;
      for (let i = 1; i < history.length; i += 1) {
        const x = history[i].x - history[i - 1].x;
        const y = (history[i].y - history[i - 1].y) * aspect;
        xPath += Math.abs(x); yPath += Math.abs(y);
        path += Math.hypot(x, y);
      }
      const horizontal = Math.abs(dx) / Math.max(Math.hypot(dx, dy), 1e-8);
      const consistency = Math.abs(dx) / Math.max(xPath, 1e-8);
      const efficiency = Math.abs(dx) / Math.max(path, 1e-8);
      const duration = last.at - first.at;
      result.evidence = { dx, dy, xPath, yPath, path, samples: history.length, duration,
        openMs: now - memory.openSince, consistency, efficiency,
        dominance: Math.abs(dx) / Math.max(Math.abs(dy), 1e-6),
        pathDominance: xPath / Math.max(yPath, 1e-6) };
      result.candidate = Math.abs(dx) >= config.swipeDistance * 0.35
        ? (dx > 0 ? "SWIPE_RIGHT" : "SWIPE_LEFT") : null;
      result.confidence = clamp(0.35 * Math.min(Math.abs(dx) / config.swipeDistance, 1) +
        0.25 * consistency + 0.20 * horizontal + 0.10 * efficiency + 0.10 * raw.score);
      result.stabilityMs = duration;
      result.progress = Math.min(clamp(Math.abs(dx) / config.swipeDistance),
        clamp(duration / config.swipeMinDurationMs), clamp((now - memory.openSince) / config.swipeArmMs));
      if (result.candidate && history.length >= config.swipeMinSamples &&
          duration >= config.swipeMinDurationMs && now - memory.openSince >= config.swipeArmMs &&
          Math.abs(dx) >= config.swipeDistance && horizontal >= config.swipeHorizontalRatio &&
          consistency >= config.swipeConsistency && efficiency >= 0.70 &&
          result.confidence >= config.confidenceThreshold && now >= memory.swipeCooldownUntil) {
        memory.swipeConfirmed = result.candidate;
        memory.swipeConfirmedUntil = now + 180;
        memory.swipeCooldownUntil = now + config.swipeCooldownMs;
        memory.swipeLatched = true;
        memory.swipeHistory.length = 0;
        events.push({ type: "gestureConfirmed", kind: "swipe", handId,
          gesture: result.candidate, at: now, confidence: result.confidence });
      }
    }
    result.confirmed = now < memory.swipeConfirmedUntil ? memory.swipeConfirmed : null;
    result.cooldownUntil = memory.swipeCooldownUntil;
    result.cooldownRemainingMs = Math.max(0, memory.swipeCooldownUntil - now);
    result.releaseRequired = memory.swipeLatched;
    return result;
  }

  updateSpatial(hands, primaryId, secondaryId, now, aspect) {
    const primary = hands.find((hand) => hand.id === primaryId);
    const secondary = hands.find((hand) => hand.id === secondaryId);
    const valid = (hand) => hand?.geometry && hand.tracking.visible &&
      hand.tracking.state === "TRACKING" && !hand.tracking.ambiguous;
    if (!valid(primary) || !valid(secondary) || primaryId === secondaryId) {
      this.pair = null;
      return emptySpatial();
    }
    const p = primary.geometry.viewCenter, s = secondary.geometry.viewCenter;
    const vector = { x: s.x - p.x, y: (s.y - p.y) * aspect };
    const separation = Math.hypot(vector.x, vector.y);
    const scale = (primary.handScale + secondary.handScale) / 2;
    const angle = separation > scale * 0.05 ? Math.atan2(vector.y, vector.x) : null;
    const pairKey = primaryId + ":" + secondaryId;
    const previous = this.pair;
    const continuous = previous && previous.key === pairKey &&
      now > previous.at && now - previous.at <= this.config.maxFrameGapMs &&
      previous.angle !== null && angle !== null;
    const distanceDelta = continuous ? separation - previous.distance : 0;
    const angleDelta = continuous ? wrappedAngle(angle - previous.angle) : 0;
    const seconds = continuous ? (now - previous.at) / 1000 : 0;
    const referenceDistance = continuous ? previous.referenceDistance : separation;
    const rotation = continuous ? previous.rotation + angleDelta : 0;
    this.pair = { key: pairKey, at: now, distance: separation, angle, referenceDistance, rotation };
    return {
      available: true, pairKey, coordinateSpace: "view; x/y normalized to image",
      primaryHandId: primaryId, secondaryHandId: secondaryId,
      primaryPosition: { ...p }, secondaryPosition: { ...s },
      primaryPinch: { ...primary.pinch }, secondaryPinch: { ...secondary.pinch },
      bothPinchingRaw: primary.pinch.raw && secondary.pinch.raw,
      bothPinchingStable: primary.pinch.stable && secondary.pinch.stable,
      bothPinchingConfirmed: primary.pinch.confirmed && secondary.pinch.confirmed,
      distance: separation, normalizedDistance: separation / scale,
      midpoint: { x: (p.x + s.x) / 2, y: (p.y + s.y) / 2 },
      relativeVector: vector, angle,
      distanceDelta, angleDelta: angle === null ? null : angleDelta,
      distanceVelocity: seconds ? distanceDelta / seconds : 0,
      angularVelocity: angle === null ? null : seconds ? angleDelta / seconds : 0,
      referenceDistance, scaleRatio: referenceDistance > 1e-6 ? separation / referenceDistance : null,
      rotationFromReference: angle === null ? null : rotation, timestamp: now
    };
  }
}
