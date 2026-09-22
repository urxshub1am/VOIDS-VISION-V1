// Shared per-hand motion analysis. Gesture recognition remains in gestureEngine.js;
// this module only describes how a tracked hand is moving over time.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);

export const MOTION_TUNING = Object.freeze({
  maxGapMs: 420,
  historyMs: 520,
  stillSpeed: 0.025,
  fastSpeed: 0.75,
  qualityGraceMs: 300
});

function direction(vx, vy, speed) {
  if (speed < MOTION_TUNING.stillSpeed) return "STILL";
  if (Math.abs(vx) > Math.abs(vy) * 1.35) return vx > 0 ? "RIGHT" : "LEFT";
  if (Math.abs(vy) > Math.abs(vx) * 1.35) return vy > 0 ? "DOWN" : "UP";
  return "DIAGONAL";
}

export function createMotionTracker(handId) {
  const history = [];
  const data = {
    handId,
    position: null,
    palmPosition: null,
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    speed: 0,
    direction: "STILL",
    movementConsistency: 0,
    motionConfidence: 0,
    poseConfidence: 0,
    trackingContinuity: 0,
    trackingQuality: "POOR",
    lastValidTimestamp: null,
    sampleCount: 0
  };
  let last = null;

  function reset() {
    history.length = 0;
    last = null;
    Object.assign(data, {
      position: null, palmPosition: null, velocity: { x: 0, y: 0 }, acceleration: { x: 0, y: 0 },
      speed: 0, direction: "STILL", movementConsistency: 0, motionConfidence: 0,
      poseConfidence: 0, trackingContinuity: 0, trackingQuality: "POOR",
      lastValidTimestamp: null, sampleCount: 0
    });
  }

  function update(hand, now, aspect = 0.75) {
    const point = hand?.geometry?.viewCenter;
    if (!valid(point) || !Number.isFinite(now)) { reset(); return data; }
    const dtMs = last ? now - last.at : 0;
    if (dtMs <= 0 || dtMs > MOTION_TUNING.maxGapMs) {
      history.length = 0;
      last = { x: point.x, y: point.y, at: now, vx: 0, vy: 0 };
    }
    const dt = Math.max((last ? now - last.at : 0) / 1000, 0.001);
    const vx = last ? (point.x - last.x) / dt : 0;
    const vy = last ? ((point.y - last.y) * aspect) / dt : 0;
    const ax = last ? (vx - last.vx) / dt : 0;
    const ay = last ? (vy - last.vy) / dt : 0;
    const speed = Math.hypot(vx, vy);
    history.push({ x: point.x, y: point.y, at: now, vx, vy, speed });
    while (history.length && now - history[0].at > MOTION_TUNING.historyMs) history.shift();

    let path = 0, netX = 0, netY = 0;
    for (let i = 1; i < history.length; i++) {
      const dx = history[i].x - history[i - 1].x;
      const dy = (history[i].y - history[i - 1].y) * aspect;
      path += Math.hypot(dx, dy);
    }
    if (history.length > 1) {
      netX = history.at(-1).x - history[0].x;
      netY = (history.at(-1).y - history[0].y) * aspect;
    }
    const net = Math.hypot(netX, netY);
    const consistency = path > 1e-6 ? clamp(net / path, 0, 1) : 1;
    const speedEvidence = clamp((speed - MOTION_TUNING.stillSpeed) / (MOTION_TUNING.fastSpeed - MOTION_TUNING.stillSpeed), 0, 1);
    const continuity = dtMs > 0 ? clamp(1 - Math.max(0, dtMs - 45) / MOTION_TUNING.qualityGraceMs, 0, 1) : 1;
    const poseConfidence = clamp(hand?.gesture?.displayConfidence ?? hand?.gesture?.confidence ?? 0, 0, 1);
    const motionConfidence = clamp((0.50 * consistency) + (0.30 * speedEvidence) + (0.20 * continuity), 0, 1);
    const qualityScore = clamp(0.55 * continuity + 0.25 * (1 - Math.min(1, Math.abs(ax) + Math.abs(ay)) * 0.01) + 0.20 * poseConfidence, 0, 1);

    Object.assign(data, {
      position: hand.geometry.viewIndexTip ? { ...hand.geometry.viewIndexTip } : null,
      palmPosition: { ...point },
      velocity: { x: vx, y: vy }, acceleration: { x: ax, y: ay }, speed,
      direction: direction(vx, vy, speed), movementConsistency: consistency,
      motionConfidence, poseConfidence, trackingContinuity: continuity,
      trackingQuality: qualityScore >= 0.74 ? "GOOD" : qualityScore >= 0.48 ? "FAIR" : "POOR",
      lastValidTimestamp: now, sampleCount: history.length
    });
    last = { x: point.x, y: point.y, at: now, vx, vy };
    return data;
  }

  return { data, update, reset };
}
