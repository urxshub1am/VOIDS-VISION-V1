// Action evidence only. Does not change GestureEngine labels or game scoring.
export const SIGNAL_TUNING = Object.freeze({
  enter: 0.28, exit: 0.40, uiMs: 140, surfaceMs: 200, joinMs: 220,
  graceMs: 280, latchMs: 240, latchRadius: 28, clickCooldownMs: 220,
  swipeDistance: 0.16, swipeDominance: 1.65, swipeConsistency: 0.80,
  swipeEfficiency: 0.72, swipeMs: 140, swipeWindowMs: 650,
  swipeCooldownMs: 650, neutralMs: 180
});
export function createInteractionPinch() {
  const data = {
    rawPinch: false, on: false, interactionPinch: false, surfaceReady: false,
    confirmedGesturePinch: false, stableMs: 0, samples: 0, since: null,
    normalizedDistance: null, rawDistance: null, lastAt: null,
    closeSamples: 0, openSamples: 0, closeSince: null, openSince: null,
    transition: "OPEN"
  };
  function reset() {
    Object.assign(data, {
      rawPinch: false, on: false, interactionPinch: false, surfaceReady: false,
      stableMs: 0, samples: 0, since: null, lastAt: null,
      closeSamples: 0, openSamples: 0, closeSince: null, openSince: null,
      transition: "OPEN"
    });
  }
  return {
    data,
    reset,
    update(hand, now) {
      if (data.lastAt !== null && now <= data.lastAt) return data;
      if (data.lastAt !== null && now - data.lastAt > SIGNAL_TUNING.graceMs) reset();

      const g = hand.geometry;
      // Prefer the image-plane pinch metric. MediaPipe Z is useful for broad
      // gesture geometry but can jitter near camera edges and should not decide
      // whether visibly touching thumb/index tips count as a click.
      const d = g?.pinchDistance2D ?? g?.pinchDistance;
      const interval = data.lastAt === null ? 0 : now - data.lastAt;
      data.requiredMs = Math.max(90, SIGNAL_TUNING.uiMs - Math.min(50, interval / 2));
      data.lastAt = now;
      data.normalizedDistance = Number.isFinite(d) ? d : null;
      data.rawDistance = Number.isFinite(g?.pinchDistanceRaw2D) ? g.pinchDistanceRaw2D
        : Number.isFinite(d) && Number.isFinite(g?.pinchScale) ? d * g.pinchScale
        : Number.isFinite(d) && Number.isFinite(g?.scale) ? d * g.scale : null;
      data.confirmedGesturePinch = hand.gesture?.confirmed === "PINCH";

      const edge = g?.edgeAssist || 0;
      const enter = SIGNAL_TUNING.enter + 0.04 * edge;
      const exit = SIGNAL_TUNING.exit + 0.05 * edge;
      const strongEnter = Math.max(0.16, enter - 0.07);
      const strongExit = exit + 0.09;
      const reach = g?.pinchReach2D ?? g?.pinchReach;
      const fistLike = Boolean(g &&
        g.extension.thumb < 0.34 &&
        g.extension.index < 0.24 &&
        g.extension.middle < 0.42 &&
        g.extension.ring < 0.42 &&
        g.extension.pinky < 0.42);
      const canEnter = Boolean(g && !fistLike && Number.isFinite(d) &&
        Number.isFinite(reach) && reach >= Math.max(0.30, 0.39 - 0.035 * edge));

      data.rawPinch = Boolean(Number.isFinite(d) && d <= enter);

      if (!data.on) {
        data.openSamples = 0;
        data.openSince = null;
        if (canEnter && d <= enter) {
          data.closeSince ??= now;
          data.closeSamples += 1;
          // Very clear visual contact may engage on one trustworthy frame.
          // Otherwise require two observations so one noisy sample cannot click.
          if (d <= strongEnter || data.closeSamples >= 2 ||
              now - data.closeSince >= Math.max(75, data.requiredMs - 25)) {
            data.on = true;
            data.since = data.closeSince;
            data.samples = Math.max(data.closeSamples, 1);
            data.transition = "CLOSED";
            data.closeSamples = 0;
            data.closeSince = null;
          } else {
            data.transition = "CLOSING";
          }
        } else if (!Number.isFinite(d) || d > enter + 0.035 || fistLike) {
          data.closeSamples = 0;
          data.closeSince = null;
          data.transition = "OPEN";
        }
      } else {
        // Once a deliberate pinch is latched, do not require palm reach on every
        // frame. That gate is noisy near the frame edge and caused CLOSED/OPEN
        // flicker. Release is governed by a wider Schmitt threshold instead.
        data.closeSamples = 0;
        data.closeSince = null;
        if (!Number.isFinite(d) || d >= exit) {
          // Release should feel immediate. The wider exit threshold already
          // provides Schmitt hysteresis, so one trustworthy open observation
          // is enough to render/release the pinch without a sticky extra frame.
          data.on = false;
          data.since = null;
          data.samples = 0;
          data.transition = "OPEN";
          data.openSamples = 0;
          data.openSince = null;
        } else {
          data.openSamples = 0;
          data.openSince = null;
          data.samples += 1;
          data.transition = "CLOSED";
        }
      }

      if (data.on && data.since === null) data.since = now;
      data.stableMs = data.since === null ? 0 : Math.max(0, now - data.since);
      // One strong-contact frame can visually latch CLOSED, but actual normal UI
      // activation still needs time/sample evidence. This keeps actions precise.
      data.interactionPinch = data.on &&
        (data.samples >= 2 || data.stableMs >= data.requiredMs) &&
        data.stableMs >= Math.min(data.requiredMs, 100);
      data.surfaceReady = data.on &&
        (data.samples >= 2 || data.stableMs >= SIGNAL_TUNING.surfaceMs) &&
        data.stableMs >= SIGNAL_TUNING.surfaceMs;
      return data;
    }
  };
}

export function createSwipeIntent() {
  let history = [], cooldownUntil = 0, blocked = false, neutralSince = null, last = null;
  const data = { state: "IDLE", cancelReason: null, direction: null, dx: 0, dy: 0,
    distance: 0, dominance: 0, velocity: 0, samples: 0, duration: 0, cooldownRemaining: 0 };
  const clear = reason => { history = []; data.state = "IDLE"; data.cancelReason = reason; };
  return { data, reset(reason = "CONTEXT_CHANGED") { clear(reason); last = null; blocked = false; neutralSince = null; },
    update(hand, now, aspect = 0.75) {
      const center = hand.geometry?.viewCenter;
      if (!center || (last && now <= last.at)) return null;
      const e = hand.geometry.extension;
      const open = hand.gesture.raw === "OPEN_PALM" || [e.index,e.middle,e.ring,e.pinky].every(n => n >= 0.55);
      const speed = last ? Math.hypot(center.x-last.x, (center.y-last.y)*aspect) / Math.max((now-last.at)/1000, 0.001) : 0;
      if (last && now-last.at > SIGNAL_TUNING.graceMs) clear("TRACKING_GAP");
      last = { ...center, at: now };
      data.cooldownRemaining = Math.max(0, cooldownUntil-now);
      if (blocked) {
        if (!open || speed < 0.12) neutralSince ??= now; else neutralSince = null;
        if (now >= cooldownUntil && neutralSince !== null && now-neutralSince >= SIGNAL_TUNING.neutralMs) {
          blocked = false; history = []; neutralSince = null;
        } else { data.state = "REARM"; return null; }
      }
      if (!open || hand.interactionPinch?.on) { clear(open ? "PINCH_INTERRUPTED" : "POSTURE"); return null; }
      history.push({ ...center, at: now });
      history = history.filter(p => now-p.at <= SIGNAL_TUNING.swipeWindowMs).slice(-32);
      if (history.length < 2) { data.state = "CANDIDATE"; return null; }
      const first = history[0], end = history.at(-1), dx = end.x-first.x, dy = (end.y-first.y)*aspect;
      let xPath=0, yPath=0, path=0;
      for (let i=1;i<history.length;i++) { const x=history[i].x-history[i-1].x, y=(history[i].y-history[i-1].y)*aspect;
        xPath+=Math.abs(x); yPath+=Math.abs(y); path+=Math.hypot(x,y); }
      const duration=now-first.at, dominance=Math.abs(dx)/Math.max(Math.abs(dy),1e-6);
      const consistency=Math.abs(dx)/Math.max(xPath,1e-6), efficiency=Math.abs(dx)/Math.max(path,1e-6);
      Object.assign(data, { dx,dy,distance:Math.abs(dx),dominance,velocity:Math.abs(dx)/Math.max(duration/1000,0.001),
        samples:history.length,duration,state:"CANDIDATE",cancelReason:null });
      if (dominance < SIGNAL_TUNING.swipeDominance || xPath < SIGNAL_TUNING.swipeDominance*yPath) data.cancelReason="VERTICAL_OR_DIAGONAL";
      else if (consistency < SIGNAL_TUNING.swipeConsistency || efficiency < SIGNAL_TUNING.swipeEfficiency) data.cancelReason="INCONSISTENT_PATH";
      else if (Math.abs(dx) < SIGNAL_TUNING.swipeDistance) data.cancelReason="DISTANCE";
      else if (duration < SIGNAL_TUNING.swipeMs || history.length < 2) data.cancelReason="DURATION";
      else if (data.velocity < 0.20) data.cancelReason="TOO_SLOW";
      else {
        data.direction=dx>0?"SWIPE_RIGHT":"SWIPE_LEFT"; data.state="CONFIRMED";
        blocked=true; cooldownUntil=now+SIGNAL_TUNING.swipeCooldownMs; history=[];
        return {type:"gestureConfirmed",kind:"swipe",gesture:data.direction,handId:hand.id,at:now};
      }
      return null;
    }
  };
}
