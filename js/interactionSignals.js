// Action evidence only. Does not change GestureEngine labels or game scoring.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const SIGNAL_TUNING = Object.freeze({
  enter: 0.27, exit: 0.385, uiMs: 140, surfaceMs: 200, joinMs: 220,
  graceMs: 280, latchMs: 240, latchRadius: 28, clickCooldownMs: 220,
  swipeDistance: 0.15, swipeDominance: 1.50, swipeConsistency: 0.76,
  swipeEfficiency: 0.68, swipeMs: 130, swipeWindowMs: 720,
  swipeCooldownMs: 650, neutralMs: 180, swipePoseGraceMs: 180,
  // A fast physical pinch can happen between two ~10 FPS camera samples. The
  // impulse detector never pretends a hold exists; it only exposes a one-shot
  // tap candidate that the arbiter may use for non-critical UI controls.
  fastTapNearPadding: 0.09, fastTapMinRise: 0.07, fastTapCloseVelocity: 0.55,
  fastTapOpenVelocity: 0.45, fastTapWindowMs: 340,
  fastTapPredictivePadding: 0.14, fastTapPredictiveCloseVelocity: 0.82,
  fastTapPredictiveOpenVelocity: 0.62, fastTapMinDrop: 0.10,
  // Release should feel immediate even though acquisition keeps hysteresis. A
  // decisive opening motion may release before the wide hysteresis exit is
  // reached; this avoids a visually/interaction-sticky pinch at low FPS.
  releaseAssistVelocity: 0.68, releaseAssistMargin: 0.050,
  // Slower opening gestures can otherwise remain latched until the wide exit
  // threshold. Two consecutive clearly-open samples release the hold without
  // weakening pinch acquisition or reacting to a single noisy sample.
  releaseSampleMargin: 0.060, releaseSampleCount: 2
});

export function createInteractionPinch() {
  const calibration = {
    status: "LEARNING", confidence: 0, openMean: null, pinchMin: null,
    openSamples: 0, nearSamples: 0, adaptiveEnter: SIGNAL_TUNING.enter,
    adaptiveExit: SIGNAL_TUNING.exit, lastUpdateAt: null
  };
  const data = {
    rawPinch: false, on: false, interactionPinch: false, surfaceReady: false,
    confirmedGesturePinch: false, stableMs: 0, samples: 0, since: null,
    normalizedDistance: null, rawDistance: null, lastAt: null,
    closeSamples: 0, openSamples: 0, closeSince: null, openSince: null,
    transition: "OPEN", calibration,
    // Low-FPS diagnostics / quick-tap evidence. `fastTap` is true for one
    // update only and is deliberately NOT equivalent to a held pinch.
    distanceVelocity: 0, sampleIntervalMs: 0, fastTap: false, fastTapId: 0,
    fastTapAt: null, fastTapValley: null, fastTapState: "IDLE",
    releasedThisFrame: false, releaseReason: null, releaseAssist: false, visualContact: false,
    adaptiveGraceMs: SIGNAL_TUNING.graceMs, surfaceRequiredMs: SIGNAL_TUNING.surfaceMs
  };
  const impulse = { state: "IDLE", startedAt: null, startDistance: null, valley: null, valleyAt: null, closingPeak: 0 };
  let previousDistance = null, previousAt = null;

  function resetImpulse(label = "IDLE") {
    impulse.state = "IDLE"; impulse.startedAt = null; impulse.startDistance = null; impulse.valley = null;
    impulse.valleyAt = null; impulse.closingPeak = 0; data.fastTapState = label;
  }
  function reset({ keepCalibration = true } = {}) {
    Object.assign(data, {
      rawPinch: false, on: false, interactionPinch: false, surfaceReady: false,
      stableMs: 0, samples: 0, since: null, lastAt: null,
      closeSamples: 0, openSamples: 0, closeSince: null, openSince: null,
      transition: "OPEN", distanceVelocity: 0, sampleIntervalMs: 0,
      fastTap: false, fastTapAt: null, fastTapValley: null, fastTapState: "IDLE",
      releasedThisFrame: false, releaseReason: null, releaseAssist: false, visualContact: false,
      adaptiveGraceMs: SIGNAL_TUNING.graceMs, surfaceRequiredMs: SIGNAL_TUNING.surfaceMs
    });
    previousDistance = null; previousAt = null; resetImpulse();
    if (!keepCalibration) Object.assign(calibration, {
      status: "LEARNING", confidence: 0, openMean: null, pinchMin: null,
      openSamples: 0, nearSamples: 0, adaptiveEnter: SIGNAL_TUNING.enter,
      adaptiveExit: SIGNAL_TUNING.exit, lastUpdateAt: null
    });
  }
  function learn(d, canEnter, now) {
    if (!Number.isFinite(d) || data.on || data.transition === "CLOSING") return;
    if (d >= 0.48) {
      calibration.openSamples += 1;
      calibration.openMean = calibration.openMean === null ? d : calibration.openMean + (d - calibration.openMean) * 0.04;
    } else if (canEnter && d >= 0.24 && d <= 0.38) {
      calibration.nearSamples += 1;
      calibration.pinchMin = calibration.pinchMin === null ? d : Math.min(calibration.pinchMin + 0.002, d);
    }
    if (calibration.openSamples >= 8 && calibration.nearSamples >= 4 && Number.isFinite(calibration.pinchMin)) {
      const targetEnter = clamp(calibration.pinchMin + 0.045, 0.255, 0.33);
      calibration.adaptiveEnter += (targetEnter - calibration.adaptiveEnter) * 0.06;
      calibration.adaptiveExit = clamp(calibration.adaptiveEnter + 0.12, 0.37, 0.46);
      calibration.status = "READY";
      calibration.confidence = clamp(Math.min(calibration.openSamples / 24, 1) * 0.45 + Math.min(calibration.nearSamples / 12, 1) * 0.55, 0, 1);
      calibration.lastUpdateAt = now;
    }
  }
  function updateFastTap(d, velocity, canEnter, now, enter) {
    data.fastTap = false;
    if (impulse.state === "IDLE" && (!data.fastTapAt || now - data.fastTapAt > 250)) data.fastTapState = "IDLE";
    if (!Number.isFinite(d) || !Number.isFinite(velocity) || !canEnter || data.on) {
      if (impulse.state !== "IDLE" && impulse.startedAt !== null && now - impulse.startedAt > SIGNAL_TUNING.fastTapWindowMs) resetImpulse("TIMEOUT");
      return;
    }
    const near = clamp(enter + SIGNAL_TUNING.fastTapNearPadding, 0.32, 0.40);
    if (impulse.state === "IDLE") {
      const startedOpen = Number.isFinite(previousDistance) && previousDistance >= Math.max(0.46, near + 0.07);
      if (startedOpen && velocity <= -SIGNAL_TUNING.fastTapCloseVelocity) {
        impulse.state = "CLOSING"; impulse.startedAt = previousAt ?? now;
        impulse.startDistance = previousDistance;
        impulse.valley = d; impulse.valleyAt = now; impulse.closingPeak = Math.abs(velocity);
        data.fastTapState = "CLOSING";
      }
      return;
    }
    if (now - impulse.startedAt > SIGNAL_TUNING.fastTapWindowMs) { resetImpulse("TIMEOUT"); return; }
    if (d < impulse.valley) { impulse.valley = d; impulse.valleyAt = now; }
    if (velocity < 0) impulse.closingPeak = Math.max(impulse.closingPeak, Math.abs(velocity));
    data.fastTapValley = impulse.valley;
    data.fastTapState = "CLOSING";

    // A single sampled threshold crossing at low FPS is valuable evidence. Keep
    // it until the next sample: if the fingers immediately rebound before the
    // held-pinch path can collect a second sample, it is a safe quick-tap
    // candidate. If the pinch stays closed, normal held-pinch logic takes over.
    if (d <= enter) { impulse.state = "THRESHOLD"; data.fastTapState = "THRESHOLD_SAMPLE"; return; }

    const rebound = velocity >= SIGNAL_TUNING.fastTapOpenVelocity && d - impulse.valley >= SIGNAL_TUNING.fastTapMinRise;
    if (rebound) {
      const closeEnough = impulse.valley <= near;
      const decisiveClose = impulse.closingPeak >= SIGNAL_TUNING.fastTapCloseVelocity;
      // If a low-FPS camera misses the fully closed sample, a strong symmetric
      // close→open impulse can still represent a safe UI tap. This predictive
      // branch is consumed only by InteractionEngine's non-critical UI path; it
      // never synthesizes a held pinch for drawing, grabs, transforms or delete.
      const predictiveNear = clamp(enter + SIGNAL_TUNING.fastTapPredictivePadding, 0.38, 0.46);
      const drop = Number.isFinite(impulse.startDistance) ? impulse.startDistance - impulse.valley : 0;
      const predictive = impulse.valley <= predictiveNear &&
        impulse.closingPeak >= SIGNAL_TUNING.fastTapPredictiveCloseVelocity &&
        velocity >= SIGNAL_TUNING.fastTapPredictiveOpenVelocity &&
        drop >= SIGNAL_TUNING.fastTapMinDrop &&
        d - impulse.valley >= SIGNAL_TUNING.fastTapMinRise + 0.015;
      if ((closeEnough && decisiveClose) || predictive) {
        data.fastTap = true; data.fastTapId += 1; data.fastTapAt = now;
        data.fastTapValley = impulse.valley; data.fastTapState = predictive && !closeEnough ? "PREDICTED" : "CONFIRMED";
      } else data.fastTapState = closeEnough ? "WEAK_CLOSE" : "TOO_FAR";
      impulse.state = "IDLE"; impulse.startedAt = null; impulse.startDistance = null; impulse.valley = null;
      impulse.valleyAt = null; impulse.closingPeak = 0;
    }
  }

  return {
    data,
    reset,
    update(hand, now) {
      if (data.lastAt !== null && now <= data.lastAt) return data;
      data.releasedThisFrame = false; data.releaseReason = null; data.releaseAssist = false;
      // Keep one genuinely missed sample from destroying a held pinch on a
      // 7-15 FPS webcam. The allowance is based on the previously observed
      // sample interval and stays capped so stale holds never linger.
      const priorInterval = Number.isFinite(data.sampleIntervalMs) ? data.sampleIntervalMs : 0;
      const adaptiveGrace = Math.max(SIGNAL_TUNING.graceMs, Math.min(520, priorInterval * 2.8));
      data.adaptiveGraceMs = adaptiveGrace;
      if (data.lastAt !== null && now - data.lastAt > adaptiveGrace) reset();

      const g = hand.geometry;
      const d = g?.pinchDistance2D ?? g?.pinchDistance;
      const oldAt = data.lastAt;
      const interval = oldAt === null ? 0 : now - oldAt;
      const velocity = Number.isFinite(d) && Number.isFinite(previousDistance) && interval > 0
        ? (d - previousDistance) / (interval / 1000) : 0;
      data.sampleIntervalMs = interval;
      data.distanceVelocity = velocity;
      data.requiredMs = Math.max(90, SIGNAL_TUNING.uiMs - Math.min(50, interval / 2));
      // Critical captures still require at least two physical pinch samples.
      // At low FPS, time alone should not force a third frame before a grab can
      // start, otherwise 7-10 FPS feels broken even when the geometry is clean.
      data.surfaceRequiredMs = Math.max(130, SIGNAL_TUNING.surfaceMs - Math.max(0, interval - 45) * 0.78);
      data.lastAt = now;
      data.normalizedDistance = Number.isFinite(d) ? d : null;
      data.rawDistance = Number.isFinite(g?.pinchDistanceRaw2D) ? g.pinchDistanceRaw2D
        : Number.isFinite(d) && Number.isFinite(g?.pinchScale) ? d * g.pinchScale
        : Number.isFinite(d) && Number.isFinite(g?.scale) ? d * g.scale : null;
      data.confirmedGesturePinch = hand.gesture?.confirmed === "PINCH";

      const edge = g?.edgeAssist || 0;
      // Edge geometry may be noisier, but relaxing pinch too much near frame
      // edges makes an open OK-shaped hand look like a held pinch. Keep only a
      // tiny bounded edge assist and use quick-tap trajectory recovery for fast
      // clicks instead of widening the physical contact threshold.
      const enter = clamp(calibration.adaptiveEnter + 0.012 * edge, 0.235, 0.315);
      const exit = clamp(Math.max(enter + 0.085, calibration.adaptiveExit + 0.015 * edge), 0.345, 0.405);
      const visualThreshold = clamp(enter + 0.012, 0.245, 0.320);
      data.enterThreshold = enter; data.exitThreshold = exit;
      data.visualContact = Boolean(Number.isFinite(d) && d <= visualThreshold);
      const strongEnter = Math.max(0.16, enter - 0.07);
      const reach = g?.pinchReach2D ?? g?.pinchReach;
      const fistLike = Boolean(g &&
        g.extension.thumb < 0.34 && g.extension.index < 0.24 &&
        g.extension.middle < 0.42 && g.extension.ring < 0.42 && g.extension.pinky < 0.42);
      const canEnter = Boolean(g && !fistLike && Number.isFinite(d) &&
        Number.isFinite(reach) && reach >= Math.max(0.30, 0.39 - 0.035 * edge));

      learn(d, canEnter, now);
      updateFastTap(d, velocity, canEnter, now, enter);
      data.rawPinch = Boolean(Number.isFinite(d) && d <= enter);

      if (!data.on) {
        data.openSamples = 0; data.openSince = null;
        if (canEnter && d <= enter) {
          data.closeSince ??= now; data.closeSamples += 1; data.transition = "CLOSING";
          if (d <= strongEnter || data.closeSamples >= 2 ||
              now - data.closeSince >= Math.max(75, data.requiredMs - 25)) {
            data.on = true; data.since = data.closeSince; data.samples = Math.max(data.closeSamples, 1);
            data.transition = "PINCHED"; data.closeSamples = 0; data.closeSince = null;
            resetImpulse("NORMAL_PINCH");
            calibration.pinchMin = calibration.pinchMin === null ? d : Math.min(calibration.pinchMin, d);
            calibration.nearSamples += 1;
          }
        } else if (!Number.isFinite(d) || d > enter + 0.035 || fistLike) {
          data.closeSamples = 0; data.closeSince = null;
          if (data.transition !== "RELEASING") data.transition = "OPEN";
        }
      } else {
        data.closeSamples = 0; data.closeSince = null;
        const assistedRelease = Number.isFinite(d) &&
          velocity >= SIGNAL_TUNING.releaseAssistVelocity &&
          d >= Math.min(exit - 0.015, enter + SIGNAL_TUNING.releaseAssistMargin);
        const sampledOpenThreshold = Math.min(exit - 0.025, enter + SIGNAL_TUNING.releaseSampleMargin);
        if (Number.isFinite(d) && d >= sampledOpenThreshold && velocity >= -0.08) {
          data.openSince ??= now;
          data.openSamples += 1;
        } else if (!Number.isFinite(d) || d < sampledOpenThreshold - 0.015 || velocity < -0.20) {
          data.openSamples = 0;
          data.openSince = null;
        }
        const sampledRelease = Number.isFinite(d) &&
          data.openSamples >= SIGNAL_TUNING.releaseSampleCount &&
          d >= sampledOpenThreshold;
        if (!Number.isFinite(d) || d >= exit || assistedRelease || sampledRelease) {
          data.transition = "RELEASING";
          data.on = false; data.since = null; data.samples = 0;
          data.openSamples = 0; data.openSince = now;
          data.releasedThisFrame = true;
          data.releaseAssist = (assistedRelease || sampledRelease) && Number.isFinite(d) && d < exit;
          data.releaseReason = !Number.isFinite(d) ? "TRACKING_GAP"
            : assistedRelease ? "OPENING_VELOCITY"
            : sampledRelease ? "OPEN_SAMPLES"
            : "EXIT_THRESHOLD";
        } else {
          data.samples += 1; data.transition = "PINCHED";
          if (Number.isFinite(d)) calibration.pinchMin = calibration.pinchMin === null ? d : Math.min(calibration.pinchMin + 0.001, d);
        }
      }

      if (!data.on && data.transition === "RELEASING" && data.openSince !== null && now - data.openSince >= 30) data.transition = "OPEN";
      if (data.on && data.since === null) data.since = now;
      data.stableMs = data.since === null ? 0 : Math.max(0, now - data.since);
      data.interactionPinch = data.on &&
        (data.samples >= 2 || data.stableMs >= data.requiredMs) &&
        data.stableMs >= Math.min(data.requiredMs, 100);
      data.surfaceReady = data.on &&
        data.samples >= 2 &&
        data.stableMs >= data.surfaceRequiredMs;

      previousDistance = Number.isFinite(d) ? d : previousDistance;
      previousAt = now;
      return data;
    }
  };
}

export function createSwipeIntent() {
  let history = [], cooldownUntil = 0, blocked = false, neutralSince = null, last = null, postureLostAt = null;
  const data = { state: "IDLE", cancelReason: null, direction: null, dx: 0, dy: 0,
    distance: 0, dominance: 0, velocity: 0, samples: 0, duration: 0, cooldownRemaining: 0,
    consistency: 0, efficiency: 0, motionConfidence: 0, poseConfidence: 0, palm: null };
  const clear = reason => { history = []; data.state = "IDLE"; data.cancelReason = reason; postureLostAt = null; };
  return { data, reset(reason = "CONTEXT_CHANGED") { clear(reason); last = null; blocked = false; neutralSince = null; },
    update(hand, now, aspect = 0.75) {
      const center = hand.geometry?.viewCenter;
      if (!center || (last && now <= last.at)) return null;
      const e = hand.geometry.extension;
      const open = hand.gesture.raw === "OPEN_PALM" || [e.index,e.middle,e.ring,e.pinky].every(n => n >= 0.55);
      const speed = last ? Math.hypot(center.x-last.x, (center.y-last.y)*aspect) / Math.max((now-last.at)/1000, 0.001) : 0;
      if (last && now-last.at > SIGNAL_TUNING.graceMs) clear("TRACKING_GAP");
      last = { ...center, at: now }; data.palm = { ...center };
      data.cooldownRemaining = Math.max(0, cooldownUntil-now);
      data.poseConfidence = clamp(hand.motionState?.poseConfidence ?? hand.gesture?.displayConfidence ?? hand.gesture?.confidence ?? 0, 0, 1);
      if (blocked) {
        if (!open || speed < 0.12) neutralSince ??= now; else neutralSince = null;
        if (now >= cooldownUntil && neutralSince !== null && now-neutralSince >= SIGNAL_TUNING.neutralMs) {
          blocked = false; history = []; neutralSince = null;
        } else { data.state = "REARM"; return null; }
      }
      if (hand.interactionPinch?.on) { clear("PINCH_INTERRUPTED"); return null; }
      if (!open) {
        postureLostAt ??= now;
        if (!history.length || now - postureLostAt > SIGNAL_TUNING.swipePoseGraceMs) { clear("POSTURE"); return null; }
        data.state = "POSE_GRACE";
      } else postureLostAt = null;

      history.push({ ...center, at: now, open });
      history = history.filter(p => now-p.at <= SIGNAL_TUNING.swipeWindowMs).slice(-32);
      if (history.length < 2) { data.state = "CANDIDATE"; return null; }
      const first = history[0], end = history.at(-1), dx = end.x-first.x, dy = (end.y-first.y)*aspect;
      let xPath=0, yPath=0, path=0;
      for (let i=1;i<history.length;i++) { const x=history[i].x-history[i-1].x, y=(history[i].y-history[i-1].y)*aspect;
        xPath+=Math.abs(x); yPath+=Math.abs(y); path+=Math.hypot(x,y); }
      const duration=now-first.at, dominance=Math.abs(dx)/Math.max(Math.abs(dy),1e-6);
      const consistency=Math.abs(dx)/Math.max(xPath,1e-6), efficiency=Math.abs(dx)/Math.max(path,1e-6);
      const velocity=Math.abs(dx)/Math.max(duration/1000,0.001);
      const horizontalScore = clamp((dominance - 1) / 1.4, 0, 1);
      const distanceScore = clamp(Math.abs(dx) / SIGNAL_TUNING.swipeDistance, 0, 1);
      const velocityScore = clamp(velocity / 0.45, 0, 1);
      const motionConfidence = clamp(0.28*horizontalScore + 0.24*consistency + 0.20*efficiency + 0.16*distanceScore + 0.12*velocityScore, 0, 1);
      Object.assign(data, { dx,dy,distance:Math.abs(dx),dominance,velocity,samples:history.length,duration,
        consistency,efficiency,motionConfidence,state: postureLostAt ? "POSE_GRACE" : "CANDIDATE",cancelReason:null });
      if (dominance < SIGNAL_TUNING.swipeDominance || xPath < SIGNAL_TUNING.swipeDominance*yPath) data.cancelReason="VERTICAL_OR_DIAGONAL";
      else if (consistency < SIGNAL_TUNING.swipeConsistency || efficiency < SIGNAL_TUNING.swipeEfficiency) data.cancelReason="INCONSISTENT_PATH";
      else if (Math.abs(dx) < SIGNAL_TUNING.swipeDistance) data.cancelReason="DISTANCE";
      else if (duration < SIGNAL_TUNING.swipeMs || history.length < 2) data.cancelReason="DURATION";
      else if (velocity < 0.18) data.cancelReason="TOO_SLOW";
      else if (motionConfidence < 0.64) data.cancelReason="LOW_MOTION_CONFIDENCE";
      else {
        data.direction=dx>0?"SWIPE_RIGHT":"SWIPE_LEFT"; data.state="CONFIRMED";
        blocked=true; cooldownUntil=now+SIGNAL_TUNING.swipeCooldownMs; history=[]; postureLostAt=null;
        return {type:"gestureConfirmed",kind:"swipe",gesture:data.direction,handId:hand.id,at:now,motionConfidence};
      }
      return null;
    }
  };
}
